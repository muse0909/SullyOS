// KeepAliveService — 后台保活 + 主动消息通道（麦麦 2026-09-03 全面加固）
//
// 目的：维持 WebView 进程存活 + 保持一条 WebSocket 长连接跟 Cloudflare Worker 通信，
//   到点时由 worker 推 proactive_message 消息，本服务调 WebView JS 让前端生成真实内容，
//   前端通过 Bridge 回传真实 content 后本服务弹系统通知。
//
// 麦麦 2026-09-06 混合方案：Worker 只发唤醒信号，Service 调 WebView.generateProactiveMessage(charId)
//   - 改前：直接弹占位通知（用 char_id 当 content 字符串）
//   - 改后：调 WebView.evaluateJavascript("window.__sullyosTriggerProactive('char-xxx')")
//           WebView 跑 OSContext.runProactive 完整流程（含 LLM + 记忆宫殿 + 状态面板 + 聊天历史）
//           生成完成后通过 Capacitor.Plugins.KeepAlive.notifyProactiveComplete 回传
//           Service 用真实 content 弹通知
//   - 降级：30 秒内没收到 JS 回传 → 弹占位通知（triggerSource=fallback_timeout）+ log
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
//   - 收到 proactive_message → 调 WebView JS，JS 回传后弹系统通知
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
import android.webkit.WebView
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

        // 麦麦 2026-09-06：WebView JS 触发主动消息后，30 秒内没回传就降级弹占位通知
        //   30 秒是经验值：LLM 调 Gemini 协议含记忆宫殿通常 5-15s，复杂 case 30s 够
        //   超时说明 WebView 进程死了 / Doze 冻住 / JS 抛了，必须降级
        private const val JS_RESPONSE_TIMEOUT_MS = 30_000L

        // 麦麦 2026-09-03：检测当前 build 是不是占位符
        //   @JvmStatic 让 Java 端可以直接 KeepAliveService.isPlaceholderBuild() 调，
        //   不写就得 KeepAliveService.Companion.isPlaceholderBuild()（Kotlin 风格）
        @JvmStatic
        fun isPlaceholderBuild(): Boolean {
            return BuildConfig.WS_URL.contains(PLACEHOLDER_URL_MARKER) ||
                   BuildConfig.WS_TOKEN == PLACEHOLDER_TOKEN_MARKER
        }

        // 麦麦 2026-09-06：单例 Service 引用，方便 Plugin 调静态方法时拿到实例
        //   Service 是 startService / bindService 单实例的，instance 指向 self
        //   Plugin 调 KeepAliveService.onProactiveGeneratedFromJs 时通过 instance 转发
        @Volatile
        private var instance: KeepAliveService? = null

        /**
         * 麦麦 2026-09-06：WebView 端通过 Capacitor.Plugins.KeepAlive.notifyProactiveComplete
         *   回传真实内容时调这里。Plugin 收到 JS 调用后调此静态方法（避免 Plugin 直接持 Service 引用）。
         */
        @JvmStatic
        fun onProactiveGeneratedFromJs(charId: String, content: String, messageId: String, charName: String) {
            val svc = instance
            if (svc == null) {
                Log.w(TAG, "PROACTIVE_JS_CALLBACK service instance null, drop char=$charId")
                return
            }
            svc.handler.post {
                svc.handleJsProactiveResult(charId, content, messageId, charName)
            }
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

    // 麦麦 2026-09-06：主动消息触发 WebView JS 时的状态
    //   - proactiveWakeLock: 短持 PARTIAL_WAKE_LOCK 包住 evaluateJavascript + 30s 超时
    //   - pendingProactive: map<requestId, PendingProactive> 跟踪在途触发
    //   - requestId 唯一 key：同一角色短时间内多次触发（WS 重连补发）要分别超时
    //   - timeoutRunnable: 30s 到点时降级弹占位通知
    // 麦麦 2026-09-06：加 scheduleType（dynamic/fixed）— 透传到最终 triggerSource 标记
    //   暮色 9-6 21:00 需求：triggerSource 标 dynamic_schedule / fixed_schedule 区分
    //   实际实现：triggerSource 拼成 "${scheduleType}_${source}" 形式
    //   例：dynamic_js_callback / fixed_offline_fetch / dynamic_fallback_timeout
    private var proactiveWakeLock: PowerManager.WakeLock? = null
    private data class PendingProactive(
        val charId: String,
        val content: String,
        val messageId: String,
        val scheduleType: String,
        val timeoutRunnable: Runnable
    )
    private val pendingProactive: MutableMap<String, PendingProactive> = mutableMapOf()

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
        instance = this  // 麦麦 2026-09-06：暴露 instance 给静态入口
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
        // 麦麦 2026-09-06：清掉所有挂起的 proactive 触发（不然下一次起 Service 还会跑旧定时器）
        cancelAllPendingProactive()
        handler.removeCallbacks(pingRunnable)
        handler.removeCallbacks(connectRunnable)
        cancelPeriodicRestartAlarm()  // 麦麦 2026-09-05：service 死时取消周期 alarm
        releasePingWakelock()  // 麦麦 2026-09-05：释放可能还持着的心跳锁
        if (proactiveWakeLock?.isHeld == true) {
            try { proactiveWakeLock?.release() } catch (_: Exception) {}
        }
        webSocket?.close(1000, "service destroyed")
        webSocket = null
        if (instance === this) instance = null  // 麦麦 2026-09-06
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
            // 麦麦 2026-09-06：content 不再校验非空 —— worker 端现在发的是 char_id 占位，
            //   真实内容由 WebView 跑完整流程后回传
            val content = json.optString("content")
            val messageId = json.optString("messageId")
            // 麦麦 2026-09-06：江澈动态注册 vs 固定梯度区分（暮色 9-6 21:00 需求）
            //   dynamic_schedule = 江澈 [schedule_next_wakeup] 注册的单次定时
            //   fixed_schedule   = 30 分钟/1 小时/4 小时固定梯度兜底
            //   Service 端透传到 triggerProactiveFromBackground → showProactiveNotification log
            val scheduleType = json.optString("scheduleType").ifEmpty { "fixed" }
            if (characterId.isEmpty()) {
                logW("proactive_message missing characterId, ignore")
                return
            }
            // 麦麦 2026-09-05 commit 3：messageId 去重（commit 2 worker 端已经生成 UUID）
            if (messageId.isNotEmpty() && isMessageSeen(messageId)) {
                logD("dup messageId=$messageId, skip")
                return
            }
            // 麦麦 2026-09-06：混合方案 —— 改前直接弹占位通知，改后调 WebView JS 生成真实内容
            //   失败时由 triggerProactiveFromBackground 内部 30s 超时降级弹占位
            triggerProactiveFromBackground(characterId, content, messageId, scheduleType)
        } catch (e: Exception) {
            logE("handleMessage parse failed", e)
        }
    }

    /**
     * 麦麦 2026-09-06：混合方案核心
     *   1. 短持 PARTIAL_WAKE_LOCK 30s 包住 evaluateJavascript 调用
     *      — 避免 Doze 进入瞬间 CPU sleep 打断 WebView 渲染
     *      — 30s 跟 JS_RESPONSE_TIMEOUT_MS 一致，到点强制 release
     *   2. 调 WebView.evaluateJavascript("window.__sullyosTriggerProactive('char-xxx')")
     *      — JS 端挂这个全局函数（index.tsx 启动时挂）
     *      — 函数内部 dispatchEvent 'sullyos:bgProactiveTrigger' → OSContext.runProactive
     *   3. 启动 30s 超时定时器
     *      — 到点如果没收到 JS 回传 → 弹占位通知 + log（triggerSource=fallback_timeout）
     *      — 收到 JS 回传则由 handleJsProactiveResult 弹真实通知
     *   4. 失败的边界：MainActivity 没起（WebView=null）→ 立即降级弹占位
     */
    private fun triggerProactiveFromBackground(characterId: String, content: String, messageId: String, scheduleType: String) {
        val ts = System.currentTimeMillis()
        // 麦麦 2026-09-06：triggerSource 拼接 scheduleType — 区分 dynamic vs fixed
        //   实际 marker：`${scheduleType}_${source}` 如 dynamic_js_callback / fixed_offline_fetch
        val baseSource = "background_service"
        Log.i("PROACTIVE", "BG_TRIGGER_ENTER ts=$ts char=$characterId msgId=$messageId scheduleType=$scheduleType triggerSource=${scheduleType}_$baseSource thread=${Thread.currentThread().name}")

        // 1) 拿 WebView 引用（MainActivity 静态 getter）
        val webView = MainActivity.getWebViewInstance()
        if (webView == null) {
            Log.w("PROACTIVE", "BG_TRIGGER_NO_WEBVIEW char=$characterId — MainActivity not running, fallback immediately")
            showProactiveNotification(characterId, content.ifEmpty { characterId }, messageId, triggerSource = "${scheduleType}_fallback_no_webview")
            if (messageId.isNotEmpty()) markMessageSeen(messageId)
            return
        }

        // 2) 短持 PARTIAL_WAKE_LOCK 30s
        acquireProactiveWakeLock()

        // 3) 拼 JS 字符串（用 JSON 转义防 charId 含引号）
        val escapedCharId = JSONObject.quote(characterId)
        val js = "window.__sullyosTriggerProactive($escapedCharId);"
        Log.i("PROACTIVE", "BG_TRIGGER_EVALJS ts=${System.currentTimeMillis()} char=$characterId scheduleType=$scheduleType")

        // 4) 30s 超时：到点如果 pendingProactive 还在 → 降级
        val requestId = messageId.ifEmpty { "${characterId}_${ts}" }
        val timeoutRunnable = Runnable {
            val pending = pendingProactive.remove(requestId)
            if (pending != null) {
                Log.w("PROACTIVE", "BG_TRIGGER_TIMEOUT ts=${System.currentTimeMillis()} char=$characterId scheduleType=${pending.scheduleType} — 30s no JS callback, fallback to placeholder")
                showProactiveNotification(
                    pending.charId,
                    content.ifEmpty { pending.charId },
                    pending.messageId,
                    triggerSource = "${pending.scheduleType}_fallback_timeout"
                )
                if (pending.messageId.isNotEmpty()) markMessageSeen(pending.messageId)
            }
            // 释放 wakelock（如果是这把锁触发的）
            if (pendingProactive.isEmpty()) {
                releaseProactiveWakeLock()
            }
        }
        pendingProactive[requestId] = PendingProactive(characterId, content, messageId, scheduleType, timeoutRunnable)
        handler.postDelayed(timeoutRunnable, JS_RESPONSE_TIMEOUT_MS)

        // 5) 调 WebView（异步，不阻塞 Service）
        try {
            webView.post {
                try {
                    webView.evaluateJavascript(js, null)
                } catch (t: Throwable) {
                    Log.e("PROACTIVE", "BG_TRIGGER_EVALJS_THROWN char=$characterId ${t.javaClass.simpleName}: ${t.message}")
                    // 立即触发降级（不等 30s）
                    handler.post {
                        val pending = pendingProactive.remove(requestId)
                        if (pending != null) {
                            handler.removeCallbacks(pending.timeoutRunnable)
                            showProactiveNotification(
                                pending.charId,
                                content.ifEmpty { pending.charId },
                                pending.messageId,
                                triggerSource = "${pending.scheduleType}_fallback_evaljs_throw"
                            )
                            if (pending.messageId.isNotEmpty()) markMessageSeen(pending.messageId)
                        }
                        if (pendingProactive.isEmpty()) releaseProactiveWakeLock()
                    }
                }
            }
        } catch (t: Throwable) {
            Log.e("PROACTIVE", "BG_TRIGGER_POST_THROWN char=$characterId ${t.javaClass.simpleName}: ${t.message}")
            handler.post {
                val pending = pendingProactive.remove(requestId)
                if (pending != null) {
                    handler.removeCallbacks(pending.timeoutRunnable)
                    showProactiveNotification(
                        pending.charId,
                        content.ifEmpty { pending.charId },
                        pending.messageId,
                        triggerSource = "${pending.scheduleType}_fallback_post_throw"
                    )
                    if (pending.messageId.isNotEmpty()) markMessageSeen(pending.messageId)
                }
                if (pendingProactive.isEmpty()) releaseProactiveWakeLock()
            }
        }
    }

    /**
     * 麦麦 2026-09-06：WebView 端调 Capacitor.Plugins.KeepAlive.notifyProactiveComplete 回传后
     *   Plugin 调静态入口 → 这里处理（handler 切到主线程）
     *   - 用 messageId 在 pendingProactive 里找对应请求，找不到说明已经超时降级了
     *   - 找到：取消 30s 定时器 + 弹真实通知（triggerSource=js_callback）
     *   暮色 9-6 21:00：triggerSource 拼 scheduleType — 区分 dynamic vs fixed
     */
    private fun handleJsProactiveResult(charId: String, content: String, messageId: String, charName: String) {
        val ts = System.currentTimeMillis()
        // 找对应请求：先用 messageId 找，找不到用 charId 找最后一条
        val pending = pendingProactive.remove(messageId)
            ?: pendingProactive.entries.firstOrNull { it.value.charId == charId }?.also {
                pendingProactive.remove(it.key)
            }?.value
        if (pending == null) {
            // 已经超时降级过了（或者被 cancelAllPendingProactive 清了）— 不再弹通知，避免双弹
            Log.w("PROACTIVE", "JS_CALLBACK_LATE ts=$ts char=$charId — no pending (timeout already fired), drop")
            return
        }
        handler.removeCallbacks(pending.timeoutRunnable)
        // 麦麦 2026-09-06：JS_CALLBACK_OK 带 scheduleType（dynamic / fixed） — 暮色 9-6 21:00 需求
        Log.i("PROACTIVE", "JS_CALLBACK_OK ts=$ts char=$charId msgId=$messageId scheduleType=${pending.scheduleType} thread=${Thread.currentThread().name}")
        // 用真实 content 弹通知（charName 用作 title）
        //   triggerSource 拼成 "${scheduleType}_js_callback" 形式
        showProactiveNotification(charId, content, messageId, charNameOverride = charName, triggerSource = "${pending.scheduleType}_js_callback")
        if (messageId.isNotEmpty()) markMessageSeen(messageId)
        if (pendingProactive.isEmpty()) releaseProactiveWakeLock()
    }

    /**
     * 麦麦 2026-09-06：onDestroy 时清掉所有挂起的 proactive 触发
     *   不然 service 重启后旧定时器还跑，会触发已死的 webView
     */
    private fun cancelAllPendingProactive() {
        if (pendingProactive.isEmpty()) return
        for ((_, p) in pendingProactive) {
            handler.removeCallbacks(p.timeoutRunnable)
        }
        pendingProactive.clear()
        releaseProactiveWakeLock()
    }

    /**
     * 麦麦 2026-09-06：PARTIAL_WAKE_LOCK 短持 JS_RESPONSE_TIMEOUT_MS
     *   不许持有超过 30s（避免 vivo 标记长持锁为异常）
     *   acquire 时如果上一把锁没释放先 release（异常路径）
     */
    private fun acquireProactiveWakeLock() {
        try {
            if (proactiveWakeLock?.isHeld == true) return  // 已有锁在持（多个并发触发）
            val pm = getSystemService(PowerManager::class.java) ?: return
            val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SullyOS:proactive")
            wl.setReferenceCounted(false)
            wl.acquire(JS_RESPONSE_TIMEOUT_MS)
            proactiveWakeLock = wl
            Log.i("PROACTIVE", "WAKELOCK_ACQUIRE ${JS_RESPONSE_TIMEOUT_MS / 1000}s")
        } catch (t: Throwable) {
            Log.e("PROACTIVE", "WAKELOCK_ACQUIRE_FAILED ${t.javaClass.simpleName}: ${t.message}")
        }
    }

    private fun releaseProactiveWakeLock() {
        if (proactiveWakeLock?.isHeld == true) {
            try { proactiveWakeLock?.release() } catch (_: Exception) {}
            Log.i("PROACTIVE", "WAKELOCK_RELEASE")
        }
        proactiveWakeLock = null
    }

    private fun showProactiveNotification(
        characterId: String,
        content: String,
        messageId: String,
        charNameOverride: String = "",
        triggerSource: String = "unknown"
    ) {
        // 麦麦 2026-09-05：去掉了之前的 10s 临时锁（9-4 加的）— 暮色 9-5 反馈"长持反而被 vivo 标记异常"
        //   现在心跳短持（8s）已经覆盖 CPU 唤醒需求，不再需要这里重复持锁
        Log.i("PROACTIVE", "SHOW_ENTER ts=${System.currentTimeMillis()} char=$characterId msgId=$messageId triggerSource=$triggerSource contentLen=${content.length} thread=${Thread.currentThread().name}")

        if (!hasNotificationPermission()) {
            logW("POST_NOTIFICATIONS not granted, cannot show proactive notification (characterId=$characterId)")
            Log.i("PROACTIVE", "NO_PERMISSION_SKIP char=$characterId triggerSource=$triggerSource")
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
            // 麦麦 2026-09-06：title 优先 charNameOverride（来自 JS 回传的角色名），没有用 characterId
            val title = charNameOverride.ifEmpty { characterId }
            val notification: Notification = NotificationCompat.Builder(this, PROACTIVE_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            val notificationId = PROACTIVE_NOTIFICATION_ID_OFFSET + notificationIdHash(messageId, characterId)
            Log.i("PROACTIVE", "BEFORE_NOTIFY id=$notificationId char=$characterId msgId=$messageId triggerSource=$triggerSource contentLen=${content.length}")
            notificationManager.notify(notificationId, notification)
            Log.i("PROACTIVE", "AFTER_NOTIFY id=$notificationId triggerSource=$triggerSource")
            logD("proactive notification shown: char=$characterId id=$notificationId msgId=$messageId triggerSource=$triggerSource")
        } catch (t: Throwable) {
            Log.i("PROACTIVE", "THROWN ${t.javaClass.simpleName}: ${t.message} triggerSource=$triggerSource")
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
                    showProactiveNotification(charId, content, msgId, triggerSource = "offline_fetch")
                    markMessageSeen(msgId)
                }
            }
        } catch (t: Throwable) {
            logE("parseAndDispatchOfflineMessages failed", t)
        }
    }
}
