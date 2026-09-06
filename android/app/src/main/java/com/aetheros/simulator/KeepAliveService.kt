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

        // 麦麦 2026-09-05：周期 alarm 兜底（service 被杀后 30 分钟拉起重连）
        //   暮色 9-5 确认：30 分钟是 vivo Alarm 频率安全线（再短系统会合并或忽略）
        //   action 自定义，PendingIntent 拉 Service 本身（不是 Activity）→ 走 onStartCommand
        private const val PERIODIC_ALARM_REQUEST_CODE = 0xBEEF
        private const val PERIODIC_ALARM_INTERVAL_MS = 30L * 60L * 1000L  // 30 分钟
        private const val ACTION_PERIODIC_RESTART = "com.aetheros.simulator.PERIODIC_RESTART"

        // 麦麦 2026-09-03：占位符字面量 — 跟 build.gradle readCfg 默认值对齐
        const val PLACEHOLDER_URL_MARKER = "PLACEHOLDER_URL"
        const val PLACEHOLDER_TOKEN_MARKER = "PLACEHOLDER_TOKEN"

        // 麦麦 2026-09-05 commit 3：去重 + 离线拉取相关
        //   存已展示的 messageId（SharedPreferences 简单实现，commit 4 升级 IDB 再说）
        private const val PREFS_SEEN_MSGS = "proactive_seen_msgs"
        //   保留最近 N 条防 prefs 无限增长
        private const val SEEN_MSGS_MAX = 200
        //   离线拉取 worker URL（commit 4 GET /api/offline-messages）
        //   与 WS_URL 同源：去掉 ws:// → https://，去掉 /ws/push
        private const val OFFLINE_FETCH_DELAY_MS = 3_000L  // 启动 3 秒后拉

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
                // 麦麦 2026-09-05：心跳前后短持 Wakelock（暮色指定 8s buffer）
                //   避免 vivo 标记长持锁为异常
                //   8s 内没收到 pong → release + 标记重连（不死等）
                acquirePingWakelock()
                val sent = ws.send("{\"type\":\"ping\"}")
                logD("[ping] sent=$sent")
                handler.postDelayed(this, PING_INTERVAL_MS)
            } catch (t: Throwable) {
                logE("[ping] send failed", t)
                scheduleReconnect()
            }
        }
    }

    // 麦麦 2026-09-05：心跳 Wakelock 状态字段
    private var pingWakelock: PowerManager.WakeLock? = null
    private var pingTimeoutRunnable: Runnable? = null

    // 麦麦 2026-09-05 commit 3：拉取离线消息 runnable + handler
    private val offlineFetchRunnable = Runnable { fetchOfflineMessages() }
    private val offlineFetchHandler = android.os.Handler(Looper.getMainLooper())

    /**
     * 心跳前 acquire PARTIAL_WAKE_LOCK 8 秒。
     * 8 秒内如果收到 pong（在 onMessage 里调 releasePingWakelock）→ 提前 release
     * 8 秒内没收到 → 强制 release + scheduleReconnect 重连
     */
    private fun acquirePingWakelock() {
        try {
            // 如果上一把锁没释放（异常路径），先 release
            if (pingWakelock?.isHeld == true) {
                try { pingWakelock?.release() } catch (_: Exception) {}
            }
            val pm = getSystemService(PowerManager::class.java) ?: return
            val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SullyOS:ping")
            wl.setReferenceCounted(false)
            wl.acquire(8_000L)
            pingWakelock = wl
            logD("PING_WAKELOCK_ACQUIRE 8s")

            // 8s 超时兜底：到点如果锁还持着，说明没收到 pong，强制释放 + 重连
            val timeoutRunnable = Runnable {
                if (pingWakelock?.isHeld == true) {
                    logW("PING_TIMEOUT_RELEASE 8s no pong → reconnect")
                    try { pingWakelock?.release() } catch (_: Exception) {}
                    pingWakelock = null
                    scheduleReconnect()
                }
            }
            pingTimeoutRunnable = timeoutRunnable
            handler.postDelayed(timeoutRunnable, 8_000L)
        } catch (t: Throwable) {
            logE("PING_WAKELOCK_ACQUIRE_FAILED ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    /**
     * 收到 pong 时调（onMessage 里的 pong 分支）。
     * 取消 8s 超时兜底 + 提前 release 锁。
     */
    private fun releasePingWakelock() {
        pingTimeoutRunnable?.let { handler.removeCallbacks(it) }
        pingTimeoutRunnable = null
        if (pingWakelock?.isHeld == true) {
            try { pingWakelock?.release() } catch (_: Exception) {}
            logD("PING_WAKELOCK_RELEASE (pong received)")
        }
        pingWakelock = null
    }

    private val connectRunnable = Runnable { connectWebSocket() }

    override fun onCreate() {
        super.onCreate()
        logD("onCreate placeholder=${isPlaceholderBuild()}")
        createNotificationChannel()
        startKeepAliveForeground()
        createProactiveMessageChannel()
        schedulePeriodicRestartAlarm()  // 麦麦 2026-09-05：周期 alarm 兜底（30 分钟，vivo 安全线）
        // 麦麦 2026-09-05 commit 3：启动 3 秒后拉离线消息（避开 WS 还在握手的瞬间）
        offlineFetchHandler.postDelayed(offlineFetchRunnable, OFFLINE_FETCH_DELAY_MS)
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
        // 麦麦 2026-09-05：周期 alarm 触发的识别（service 死后被拉起来重连）
        if (intent?.action == ACTION_PERIODIC_RESTART) {
            logW("ALARM_RESTART_TRIGGERED periodic")
        }
        if (webSocket == null) {
            connectWebSocket()
        } else {
            // WS 还活着 — 重新排下一个 30 分钟周期 alarm
            schedulePeriodicRestartAlarm()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        logD("onDestroy")
        handler.removeCallbacks(pingRunnable)
        handler.removeCallbacks(connectRunnable)
        cancelPeriodicRestartAlarm()  // 麦麦 2026-09-05：service 死时取消周期 alarm
        releasePingWakelock()  // 麦麦 2026-09-05：释放可能还持着的心跳锁
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

    // 麦麦 2026-09-05：周期 alarm 兜底（30 分钟）— service 死后被系统拉起重连 WS
    private fun schedulePeriodicRestartAlarm() {
        try {
            val am = getSystemService(AlarmManager::class.java) ?: return
            val intent = Intent(this, KeepAliveService::class.java).apply {
                action = ACTION_PERIODIC_RESTART
            }
            val pi = PendingIntent.getService(
                this,
                PERIODIC_ALARM_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val triggerAt = SystemClock.elapsedRealtime() + PERIODIC_ALARM_INTERVAL_MS
            // setExactAndAllowWhileIdle 越过 Doze 节能
            am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
            logD("scheduled periodic restart alarm in ${PERIODIC_ALARM_INTERVAL_MS / 60_000}min")
        } catch (t: Throwable) {
            logE("schedulePeriodicRestartAlarm failed", t)
        }
    }

    private fun cancelPeriodicRestartAlarm() {
        try {
            val am = getSystemService(AlarmManager::class.java) ?: return
            val intent = Intent(this, KeepAliveService::class.java).apply {
                action = ACTION_PERIODIC_RESTART
            }
            val pi = PendingIntent.getService(
                this,
                PERIODIC_ALARM_REQUEST_CODE,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            am.cancel(pi)
            logD("cancelled periodic restart alarm")
        } catch (t: Throwable) {
            logE("cancelPeriodicRestartAlarm failed", t)
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
                    // 麦麦 2026-09-04：诊断日志（gpt 9-3 那轮）— 抓到消息的瞬间打时间戳
                    //   和 SHOW_ENTER / BEFORE_NOTIFY / AFTER_NOTIFY 对比 = 卡哪一箭一眼看出来
                    Log.i("PROACTIVE", "WS_ONMSG ts=${System.currentTimeMillis()} text=$text thread=${Thread.currentThread().name}")
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
                releasePingWakelock()  // 麦麦 2026-09-05：pong 来了，释放心跳 Wakelock
                return
            }
            if (type != "proactive_message") {
                logD("recv unknown type=$type, ignore")
                return
            }
            val characterId = json.optString("characterId")
            val content = json.optString("content")
            val messageId = json.optString("messageId")
            if (characterId.isEmpty() || content.isEmpty()) {
                logW("proactive_message missing characterId/content, ignore")
                return
            }
            // 麦麦 2026-09-05 commit 3：messageId 去重（commit 2 worker 端已经生成 UUID）
            if (messageId.isNotEmpty() && isMessageSeen(messageId)) {
                logD("dup messageId=$messageId, skip")
                return
            }
            showProactiveNotification(characterId, content, messageId)
            if (messageId.isNotEmpty()) markMessageSeen(messageId)
        } catch (e: Exception) {
            logE("handleMessage parse failed", e)
        }
    }

    private fun showProactiveNotification(characterId: String, content: String, messageId: String) {
        // 麦麦 2026-09-05：去掉了之前的 10s 临时锁（9-4 加的）— 暮色 9-5 反馈"长持反而被 vivo 标记异常"
        //   现在心跳短持（8s）已经覆盖 CPU 唤醒需求，不再需要这里重复持锁
        Log.i("PROACTIVE", "SHOW_ENTER ts=${System.currentTimeMillis()} char=$characterId msgId=$messageId thread=${Thread.currentThread().name}")

        if (!hasNotificationPermission()) {
            logW("POST_NOTIFICATIONS not granted, cannot show proactive notification (characterId=$characterId)")
            Log.i("PROACTIVE", "NO_PERMISSION_SKIP char=$characterId")
            return
        }
        try {
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pi = PendingIntent.getActivity(
                this,
                // 麦麦 2026-09-05 commit 3：notificationId 用 messageId 算（commit 2 之前是 charId.hashCode）
                //   每条消息独立 notificationId → 不会互相覆盖，多条离线消息同时显示
                PROACTIVE_NOTIFICATION_ID_OFFSET + notificationIdHash(messageId, characterId),
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
            val notificationId = PROACTIVE_NOTIFICATION_ID_OFFSET + notificationIdHash(messageId, characterId)
            Log.i("PROACTIVE", "BEFORE_NOTIFY id=$notificationId char=$characterId msgId=$messageId content=$content")
            notificationManager.notify(notificationId, notification)
            Log.i("PROACTIVE", "AFTER_NOTIFY id=$notificationId")
            logD("proactive notification shown: char=$characterId id=$notificationId msgId=$messageId")
        } catch (t: Throwable) {
            Log.i("PROACTIVE", "THROWN ${t.javaClass.simpleName}: ${t.message}")
            logE("showProactiveNotification failed", t)
        }
    }

    // 麦麦 2026-09-05 commit 3：notificationId 算法
    //   messageId 不空时用 messageId 算（每条消息独立）
    //   messageId 空时退回 characterId 算（兼容旧路径）
    private fun notificationIdHash(messageId: String, characterId: String): Int {
        val key = if (messageId.isNotEmpty()) messageId else characterId
        return Math.abs(key.hashCode())
    }

    private fun getOrCreateUserId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_WS_USER_ID, null)
        if (existing != null) return existing
        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_WS_USER_ID, newId).apply()
        return newId
    }

    // ==================== Commit 3：去重 + 离线拉取 ====================

    /**
     * 检查 messageId 是否已展示过（去重）。
     * 暮色 9-5 commit 3 强调：客户端恢复瞬间 + D1 补发可能同时到达，必须去重。
     * 用 SharedPreferences 简单实现（commit 4 升级 IDB 再说）。
     */
    private fun isMessageSeen(messageId: String): Boolean {
        if (messageId.isEmpty()) return false
        return try {
            val prefs = getSharedPreferences(PREFS_SEEN_MSGS, Context.MODE_PRIVATE)
            prefs.getStringSet("ids", null)?.contains(messageId) ?: false
        } catch (t: Throwable) {
            logE("isMessageSeen failed", t)
            false
        }
    }

    /**
     * 标记 messageId 为已展示。
     * 用 Set 存 + 超 SEEN_MSGS_MAX 清空重建（防 prefs 无限增长）。
     */
    private fun markMessageSeen(messageId: String) {
        if (messageId.isEmpty()) return
        try {
            val prefs = getSharedPreferences(PREFS_SEEN_MSGS, Context.MODE_PRIVATE)
            val current = prefs.getStringSet("ids", null)?.toMutableSet() ?: mutableSetOf()
            current.add(messageId)
            if (current.size > SEEN_MSGS_MAX) {
                logW("seen msgs Set 超 $SEEN_MSGS_MAX 上限，清空重建")
                current.clear()
                current.add(messageId)
            }
            prefs.edit().putStringSet("ids", current).apply()
        } catch (t: Throwable) {
            logE("markMessageSeen failed", t)
        }
    }

    /**
     * 麦麦 2026-09-05 commit 3 + 4：拉取 D1 离线消息。
     * 启动时（onCreate 3 秒后）调一次，WS 恢复后也会调。
     * userId 用 getOrCreateUserId()（跟 WS 握手 userId 一致）— commit 2 简化用 endpoint 占位，
     *   生产前需要再让 schedule 表带 user_id 字段。当前先跑通链路。
     */
    private fun fetchOfflineMessages() {
        if (isPlaceholderBuild()) {
            logD("fetchOfflineMessages skip: placeholder build")
            return
        }
        val userId = try { getOrCreateUserId() } catch (_: Throwable) { return }
        // WS_URL 形如 wss://host/ws/push → 推 baseUrl = https://host
        val wsUrl = BuildConfig.WS_URL
        val baseUrl = wsUrl.replaceFirst("wss://", "https://").replaceFirst("ws://", "http://")
            .replaceFirst("/ws/push.*$".toRegex(), "")
        val url = "$baseUrl/api/offline-messages?userId=${java.net.URLEncoder.encode(userId, "UTF-8")}&since=0"
        logD("OFFLINE_FETCH url=$url")

        val fetchThread = Thread {
            try {
                val conn = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8_000
                    readTimeout = 8_000
                    setRequestProperty("X-Client-Token", BuildConfig.WS_TOKEN)
                }
                val code = conn.responseCode
                if (code != 200) {
                    logE("OFFLINE_FETCH_HTTP_$code")
                    return@Thread
                }
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                parseAndDispatchOfflineMessages(body)
            } catch (t: Throwable) {
                logE("OFFLINE_FETCH_FAILED ${t.javaClass.simpleName}: ${t.message}")
            }
        }
        fetchThread.name = "offline-fetch"
        fetchThread.start()
    }

    /**
     * 麦麦 2026-09-05 commit 3：解析 D1 拉到的消息 → 弹通知 + 存去重。
     * 用 handler 切回 main thread 弹通知（NotificationManager 跨线程有限制）。
     */
    private fun parseAndDispatchOfflineMessages(body: String) {
        try {
            val json = org.json.JSONObject(body)
            if (!json.optBoolean("ok", false)) {
                logE("OFFLINE_FETCH ok=false body=$body")
                return
            }
            val arr = json.optJSONArray("messages") ?: return
            logD("OFFLINE_FETCH got ${arr.length()} messages")
            for (i in 0 until arr.length()) {
                val m = arr.getJSONObject(i)
                val msgId = m.optString("messageId")
                val charId = m.optString("charId")
                val content = m.optString("content")
                if (msgId.isEmpty() || charId.isEmpty() || content.isEmpty()) continue
                if (isMessageSeen(msgId)) {
                    logD("OFFLINE_FETCH_DUP msgId=$msgId skip")
                    continue
                }
                offlineFetchHandler.post {
                    showProactiveNotification(charId, content, msgId)
                    markMessageSeen(msgId)
                }
            }
        } catch (t: Throwable) {
            logE("parseAndDispatchOfflineMessages failed", t)
        }
    }
}
