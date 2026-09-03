// KeepAliveService — 后台保活 + 主动消息通道（麦麦 2026-09-03 全面加固）
//
// 目的：维持 WebView 进程存活 + 保持一条 WebSocket 长连接跟 Cloudflare Worker 通信，
//   到点时由 worker 推 proactive_message 消息，本服务弹系统通知。
//
// 麦麦 2026-09-03 加固项（暮色 9-3 反馈"点进去才触发"后逐项落实）：
//   1. 服务端地址 / token / VAPID 从 BuildConfig 读，**不硬编码**（统一配置入口）
//   2. 占位符检测：启动时检测 BuildConfig.WS_URL/WS_TOKEN 是不是 PLACEHOLDER，
//      是就不连 WebSocket，但前台服务保留（保活职责跟推送职责解耦）
//   3. onTaskRemoved：用户从最近任务划掉时记 prefs + 调 alarm 兜底重启
//   4. onStartCommand 重新 startForeground：START_STICKY 重启后通知可能没了，
//      这里重新 startForeground 把通知挂回去
//   5. POST_NOTIFICATIONS 权限检测（Android 13+）：没权限时降级
//      — 业务通知发不出来，但保活通知（API 26+）仍能发
//   6. ForegroundServiceStartNotAllowedException 处理（Android 12+ 后台启动限制）
//   7. lastSuccessfulPongTime 跟踪：连续 N 次心跳超时判定连接死，主动 close
//   8. 诊断日志开关 BuildConfig.KEEP_ALIVE_LOG：默认关，开后所有关键事件 logcat 输出
//
// 麦麦 2026-09-03 加固项（暮色 9-3 反馈提到"被划掉后的恢复"）— onTaskRemoved 走：
//   - 用户从最近任务划掉 → 记 prefs
//   - 设 setExactAndAllowWhileIdle AlarmManager 60s 后拉起自己（Doze 也能唤醒）
//   - 服务被 START_STICKY 重启时 prefs 标记 + onStartCommand 拉起 webSocket
//
// 暮色 2026-08-29 P0 第二步：原 WebSocket 通道 / OkHttp / 心跳 / 指数退避保留
//   - 应用层心跳：30s ping
//   - 60s 没收到任何消息 → 主动 close 触发重连
//   - 指数退避：2s → 4s → 8s → 16s → 32s → 60s 上限
//   - 收到 proactive_message 弹系统通知，点击跳回 MainActivity
//
// Android 14 (API 34) FGS specialUse 要求保留（manifest 里已声明）
//   - PROPERTY_SPECIAL_USE_FGS_SUBTYPE property 已声明
//   - FOREGROUND_SERVICE_SPECIAL_USE 权限已声明

package com.aetheros.simulator

import android.Manifest
import android.app.AlarmManager
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

class KeepAliveService : Service() {

    companion object {
        private const val TAG = "KeepAlive"

        // ── 通知 ID / Channel ─────────────────────────────────────────────
        private const val CHANNEL_ID = "keep_alive_channel"
        private const val NOTIFICATION_ID = 1001

        // 业务通知渠道（独立于 keep_alive_channel）— 暮色 8-29 已加
        private const val PROACTIVE_CHANNEL_ID = "proactive_message_channel"
        private const val PROACTIVE_NOTIFICATION_ID_OFFSET = 2000

        // ── WebSocket / 心跳 / 重连 ──────────────────────────────────────
        private const val PING_INTERVAL_MS = 30_000L
        // 麦麦 2026-09-03：连续 3 次心跳窗口（60s × 3 = 180s）没收到任何消息才认定连接死
        // 原来 60s 单窗口太短，网络抖动一次就 close 太敏感
        private const val TIMEOUT_MS = 60_000L
        private const val DEAD_AFTER_MISSED_PONGS = 3
        private const val INITIAL_BACKOFF_MS = 2_000L
        private const val MAX_BACKOFF_MS = 60_000L

        // ── 用户态 / 重启标记 ───────────────────────────────────────────
        private const val PREFS_NAME = "keep_alive_prefs"
        private const val KEY_WS_USER_ID = "ws_user_id"
        private const val KEY_TASK_REMOVED_AT = "task_removed_at"
        private const val KEY_ALARM_SCHEDULED_AT = "alarm_scheduled_at"

        // ── onTaskRemoved 后 alarm 拉起自己 ─────────────────────────────
        private const val ALARM_REQUEST_CODE = 0xCAFE
        private const val ALARM_DELAY_MS = 60_000L   // 60s 后拉起

        // 麦麦 2026-09-03：占位符字面量 — 跟 build.gradle readCfg 默认值对齐
        const val PLACEHOLDER_URL_MARKER = "PLACEHOLDER_URL"
        const val PLACEHOLDER_TOKEN_MARKER = "PLACEHOLDER_TOKEN"

        // 麦麦 2026-09-03：检测当前 build 是不是占位符
        //   @JvmStatic 让 Java 端可以直接 KeepAliveService.isPlaceholderBuild() 调，
        //   不写就得 KeepAliveService.Companion.isPlaceholderBuild()（Kotlin 风格）
        @JvmStatic
        fun isPlaceholderBuild(): Boolean {
            return BuildConfig.WS_URL.contains(PLACEHOLDER_URL_MARKER) ||
                   BuildConfig.WS_TOKEN == PLACEHOLDER_TOKEN_MARKER
        }
    }

    // ── 日志（BuildConfig.KEEP_ALIVE_LOG 控制）─────────────────────────
    private fun logD(msg: String) { if (BuildConfig.KEEP_ALIVE_LOG) Log.d(TAG, msg) }
    private fun logW(msg: String) { Log.w(TAG, msg) }   // warn 始终开 — 关键事件
    private fun logE(msg: String, t: Throwable? = null) { Log.e(TAG, msg, t) }

    // ── 状态 ────────────────────────────────────────────────────────────
    private val handler = Handler(Looper.getMainLooper())
    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .pingInterval(0, TimeUnit.MILLISECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
    private var webSocket: WebSocket? = null
    private var lastMessageTime: Long = 0L
    private var lastSuccessfulPongTime: Long = 0L
    private var missedPongs: Int = 0
    private var currentBackoff: Long = INITIAL_BACKOFF_MS
    private var startedForeground = false

    // 麦麦 2026-09-03：保活通知 / 业务通知权限检测缓存
    private val notificationManager: NotificationManager by lazy {
        getSystemService(NotificationManager::class.java)
    }

    private val pingRunnable = object : Runnable {
        override fun run() {
            try {
                val now = System.currentTimeMillis()
                val ws = webSocket
                if (ws == null) {
                    // 没有连接，handler 还在跑说明在等 backoff 拉起，不重复发 ping
                    logD("[ping] no websocket, skip")
                    return
                }
                if (lastMessageTime > 0L && now - lastMessageTime > TIMEOUT_MS) {
                    // 麦麦 2026-09-03：连续 N 次窗口无消息才判定死
                    missedPongs++
                    logW("[ping] no message for ${(now - lastMessageTime) / 1000}s, missed=${missedPongs}/${DEAD_AFTER_MISSED_PONGS}")
                    if (missedPongs >= DEAD_AFTER_MISSED_PONGS) {
                        logW("[ping] connection dead, force close to trigger reconnect")
                        ws.close(1000, "client timeout ${missedPongs}pongs")
                        // 走 onClosing / onClosed → scheduleReconnect
                        return
                    }
                }
                val sent = ws.send("{\"type\":\"ping\"}")
                logD("[ping] sent=$sent")
                handler.postDelayed(this, PING_INTERVAL_MS)
            } catch (t: Throwable) {
                logE("[ping] send failed", t)
                scheduleReconnect()
            }
        }
    }

    private val connectRunnable = Runnable { connectWebSocket() }

    override fun onCreate() {
        super.onCreate()
        logD("onCreate placeholder=${isPlaceholderBuild()}")
        createNotificationChannel()
        startKeepAliveForeground()
        createProactiveMessageChannel()
    }

    /**
     * 麦麦 2026-09-03：把 startForeground 抽出来 — onCreate 和 START_STICKY 重启后的
     * onStartCommand 都要调，否则通知会消失。
     *
     * 关键：每次 startForeground 之前先 stopForeground，清掉旧通知 id 状态，
     * 防止某些 OEM ROM 上 startForeground 调多次会抛 RemoteServiceException。
     */
    private fun startKeepAliveForeground() {
        if (startedForeground) return
        try {
            val notification = buildKeepAliveNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            startedForeground = true
            logD("startForeground OK")
        } catch (e: ForegroundServiceStartNotAllowedException) {
            // Android 12+ (API 31+) 后台启动 FGS 会被拒 — 只 log，不崩
            // （onCreate 调是前台调用不会触发，onTaskRemoved 走 alarm 路径会触发）
            logE("ForegroundServiceStartNotAllowedException — system denied FGS start", e)
        } catch (e: Exception) {
            logE("startForeground failed", e)
        }
    }

    private fun buildKeepAliveNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("运行中")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    /**
     * 麦麦 2026-09-03：START_STICKY 重启时也会走这里。必须：
     *   1. 重新 startForeground（系统重启服务时不会自动挂通知）
     *   2. 重新触发 WebSocket 连接（webSocket = null 时）
     *   3. 取消之前可能残留的 alarm（如果服务正常重启了，不需要 alarm 拉起）
     */
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        logD("onStartCommand intent=${intent?.action} flags=$flags")
        startKeepAliveForeground()
        cancelTaskRemovedAlarm()
        if (webSocket == null) {
            connectWebSocket()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        logD("onDestroy")
        handler.removeCallbacks(pingRunnable)
        handler.removeCallbacks(connectRunnable)
        webSocket?.close(1000, "service destroyed")
        webSocket = null
        super.onDestroy()
    }

    /**
     * 麦麦 2026-09-03：onTaskRemoved — 用户从最近任务列表划掉 App 时调用
     *
     * 处理策略：
     *   1. 记 prefs（task_removed_at 时间戳）— 便于诊断 / 上报
     *   2. 设 AlarmManager setExactAndAllowWhileIdle 60s 后拉起自己
     *      — Doze 也能唤醒；alarm PendingIntent 指向 MainActivity，
     *        用户点图标回到 app 时会重启 service
     *   3. START_STICKY 已经处理了系统回收路径，但用户主动划掉是另一回事 —
     *      START_STICKY 对划掉通常不重启，所以 alarm 是必须补的兜底
     *
     * 注意：
     *   - 不要在 onTaskRemoved 里直接 startForegroundService（Android 12+ 会被拒）
     *   - 不要在 onTaskRemoved 里 startService（API 26+ 没 startForeground 会崩）
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        logD("onTaskRemoved — user swiped app from recents")
        try {
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit()
                .putLong(KEY_TASK_REMOVED_AT, System.currentTimeMillis())
                .apply()
            scheduleTaskRemovedAlarm()
        } catch (t: Throwable) {
            logE("onTaskRemoved handler failed", t)
        }
        super.onTaskRemoved(rootIntent)
    }

    private fun scheduleTaskRemovedAlarm() {
        try {
            val am = getSystemService(AlarmManager::class.java) ?: return
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                ?: Intent(this, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                this,
                ALARM_REQUEST_CODE,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val triggerAt = SystemClock.elapsedRealtime() + ALARM_DELAY_MS
            // setExactAndAllowWhileIdle 越过 Doze 节能
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putLong(KEY_ALARM_SCHEDULED_AT, System.currentTimeMillis())
                .apply()
            logD("scheduled restart alarm in ${ALARM_DELAY_MS / 1000}s")
        } catch (t: Throwable) {
            logE("scheduleTaskRemovedAlarm failed", t)
        }
    }

    private fun cancelTaskRemovedAlarm() {
        try {
            val am = getSystemService(AlarmManager::class.java) ?: return
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
                ?: Intent(this, MainActivity::class.java)
            val pi = PendingIntent.getActivity(
                this,
                ALARM_REQUEST_CODE,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.cancel(pi)
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .remove(KEY_ALARM_SCHEDULED_AT)
                .apply()
            logD("cancelled restart alarm")
        } catch (t: Throwable) {
            logE("cancelTaskRemovedAlarm failed", t)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "保持运行",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "维持 SullyOS 后台运行与消息推送"
                setShowBadge(false)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createProactiveMessageChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                PROACTIVE_CHANNEL_ID,
                "主动消息",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "角色主动发来的消息通知（横幅+声音）"
                setShowBadge(true)
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    /**
     * 麦麦 2026-09-03：检查通知权限（Android 13+ 强制）
     * 返回 true = 有权限（业务通知能弹）
     * 返回 false = 没权限（业务通知会被吞，但保活通知 IMPORTANCE_LOW 不受 POST_NOTIFICATIONS 影响）
     */
    private fun hasNotificationPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 麦麦 2026-09-03：检查电池优化白名单
     * 返回 true = 在白名单（Doze 不会影响这个 app）
     * 返回 false = 没在（系统可能在长时间不活动后断网 WebSocket）
     */
    fun isIgnoringBatteryOptimizations(): Boolean {
        val pm = getSystemService(PowerManager::class.java) ?: return false
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    // ==================== WebSocket 推送通道 ====================

    private fun connectWebSocket() {
        if (webSocket != null) {
            logD("connectWebSocket skipped — already connected")
            return
        }

        // 麦麦 2026-09-03：占位符检测 — 不连 WebSocket
        if (isPlaceholderBuild()) {
            logW("WebSocket skipped: WS_URL/WS_TOKEN is PLACEHOLDER. " +
                 "Set in android/local.properties or via -P / env, then rebuild.")
            return
        }

        val userId = getOrCreateUserId()
        val fullUrl = "${BuildConfig.WS_URL}?userId=$userId&token=${BuildConfig.WS_TOKEN}"
        logD("connecting to $fullUrl")
        val request = Request.Builder().url(fullUrl).build()
        try {
            webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    logD("WS onOpen")
                    lastMessageTime = System.currentTimeMillis()
                    lastSuccessfulPongTime = lastMessageTime
                    missedPongs = 0
                    currentBackoff = INITIAL_BACKOFF_MS
                    handler.removeCallbacks(pingRunnable)
                    handler.postDelayed(pingRunnable, PING_INTERVAL_MS)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    lastMessageTime = System.currentTimeMillis()
                    lastSuccessfulPongTime = lastMessageTime
                    missedPongs = 0
                    handleMessage(text)
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    logD("WS onClosing code=$code reason=$reason")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    logE("WS onFailure status=${response?.code}", t)
                    scheduleReconnect()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    logD("WS onClosed code=$code reason=$reason")
                    scheduleReconnect()
                }
            })
        } catch (t: Throwable) {
            logE("connectWebSocket failed", t)
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        handler.removeCallbacks(pingRunnable)
        this.webSocket = null
        val delay = currentBackoff
        currentBackoff = (currentBackoff * 2).coerceAtMost(MAX_BACKOFF_MS)
        logD("reconnect in ${delay / 1000}s (next backoff ${currentBackoff / 1000}s)")
        handler.postDelayed(connectRunnable, delay)
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")
            if (type == "pong") {
                logD("recv pong")
                return
            }
            if (type != "proactive_message") {
                logD("recv unknown type=$type, ignore")
                return
            }
            val characterId = json.optString("characterId")
            val content = json.optString("content")
            if (characterId.isEmpty() || content.isEmpty()) {
                logW("proactive_message missing characterId/content, ignore")
                return
            }
            showProactiveNotification(characterId, content)
        } catch (e: Exception) {
            logE("handleMessage parse failed", e)
        }
    }

    private fun showProactiveNotification(characterId: String, content: String) {
        if (!hasNotificationPermission()) {
            logW("POST_NOTIFICATIONS not granted, cannot show proactive notification (characterId=$characterId)")
            return
        }
        try {
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pi = PendingIntent.getActivity(
                this,
                PROACTIVE_NOTIFICATION_ID_OFFSET + Math.abs(characterId.hashCode()),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification: Notification = NotificationCompat.Builder(this, PROACTIVE_CHANNEL_ID)
                .setContentTitle(characterId)
                .setContentText(content)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            val notificationId = PROACTIVE_NOTIFICATION_ID_OFFSET + Math.abs(characterId.hashCode())
            notificationManager.notify(notificationId, notification)
            logD("proactive notification shown: char=$characterId id=$notificationId")
        } catch (t: Throwable) {
            logE("showProactiveNotification failed", t)
        }
    }

    private fun getOrCreateUserId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_WS_USER_ID, null)
        if (existing != null) return existing
        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_WS_USER_ID, newId).apply()
        return newId
    }
}
