// KeepAliveService — 轻量前台保活服务（暮色 2026-08-27 P0 第 5 项）
//
// 目的：防止系统在后台把 WebView 进程杀掉 — 消息推送 / 主动唤醒依赖进程存活。
// 实现：起一个 IMPORTANCE_LOW 的常驻通知（"运行中"），不发声不弹横幅，
//   用户在通知栏里能看到一条静默通知，划不掉（ongoing）。
//
// Android 14 (API 34) 要求：
//   - manifest 里 FOREGROUND_SERVICE + FOREGROUND_SERVICE_SPECIAL_USE 权限
//   - <service> 上声明 android:foregroundServiceType="specialUse"
//   - PROPERTY_SPECIAL_USE_FGS_SUBTYPE property 说明用途
//   - startForeground 时传 FOREGROUND_SERVICE_TYPE_SPECIAL_USE
//
// 暮色 2026-08-29 P0 第二步新增（不动现有前台保活逻辑）：
//   - 业务通知渠道 "主动消息"（IMPORTANCE_HIGH 弹横幅+声音，独立于 keep_alive_channel）
//   - OkHttp WebSocket 长连接，跟 Cloudflare Worker 保持双向通道
//   - 应用层心跳：30s ping，60s 无消息 → close 触发重连
//   - 指数退避重连：2s → 4s → 8s → ... → 60s 上限
//   - 收到 proactive_message 主动弹通知，点击跳回 MainActivity

package com.aetheros.simulator

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
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
        private const val CHANNEL_ID = "keep_alive_channel"
        private const val NOTIFICATION_ID = 1001

        // 暮色 2026-08-29 P0 第二步：WebSocket 推送通道（客户端）
        // 连接地址先硬编码 — 后续 worker/proactive-push 部署后改这里
        private const val WS_URL = "wss://PLACEHOLDER_URL/ws/push"
        // 暮色 2026-08-29 P0 第三步配套：服务端 CLIENT_TOKEN 占位
        //   跟 worker wrangler.toml 里的 CLIENT_TOKEN 保持一致 — 部署后改这里
        private const val WS_TOKEN = "PLACEHOLDER_TOKEN"
        // SharedPreferences 存 userId（UUID）的 prefs 文件名
        private const val PREFS_NAME = "keep_alive_prefs"
        // userId 在 prefs 里的 key
        private const val KEY_WS_USER_ID = "ws_user_id"
        // 应用层心跳：每 30s 发 {"type":"ping"}
        private const val PING_INTERVAL_MS = 30_000L
        // 60s 内没收到任何服务端消息 → 主动 close 触发重连
        private const val TIMEOUT_MS = 60_000L
        // 重连指数退避：2s → 4s → 8s → ... → 60s 上限
        private const val INITIAL_BACKOFF_MS = 2_000L
        private const val MAX_BACKOFF_MS = 60_000L

        // 业务通知渠道（独立于 keep_alive_channel）
        private const val PROACTIVE_CHANNEL_ID = "proactive_message_channel"
        // 通知 ID 起始偏移（避免跟保活通知 ID 1001 撞）
        // 同角色新消息覆盖旧通知（用 abs(characterId.hashCode()) 做 ID）
        private const val PROACTIVE_NOTIFICATION_ID_OFFSET = 2000
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("手抓糯米机")
            .setContentText("运行中")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)                 // 划不掉
            .setSilent(true)                  // 不出声、不弹横幅、不闪灯
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        // Android 14+ 必须显式传 FGS 类型，老版本走单参数重载
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // 暮色 2026-08-29 P0 第二步：注册业务通知渠道（独立于 keep_alive_channel）
        createProactiveMessageChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY：万一进程真被杀了，系统重启时会拉回这个服务
        // 暮色 2026-08-29 P0 第二步：每次 onStartCommand 都尝试初始化 WebSocket
        //   幂等：webSocket != null 时直接 return
        if (webSocket == null) {
            connectWebSocket()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        // 暮色 2026-08-29 P0 第二步：清理 WebSocket + 心跳 + 延迟任务
        handler.removeCallbacks(pingRunnable)
        handler.removeCallbacks(connectRunnable)
        webSocket?.close(1000, "service destroyed")
        webSocket = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "保持运行",
                NotificationManager.IMPORTANCE_LOW   // 静默，不出现在锁屏顶部大字提示里
            ).apply {
                description = "维持 SullyOS 后台运行与消息推送"
                setShowBadge(false)                  // 角标不加
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    // ==================== 暮色 2026-08-29 P0 第二步：WebSocket 推送通道 ====================

    /** 主线程 Handler — 用来发心跳 / 延迟重连 */
    private val handler = Handler(Looper.getMainLooper())

    /** WebSocket 客户端 — 用 lazy 延迟到第一次连接时创建 */
    private val okHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // 关掉 OkHttp 自带的协议层 ping — 我们用应用层文本 ping 帧
            .pingInterval(0, TimeUnit.MILLISECONDS)
            // WebSocket 长连接不超时（0 = 不过期）
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }

    /** 当前 WebSocket 实例，null 表示未连接 */
    private var webSocket: WebSocket? = null

    /** 上次收到任何服务端消息的时间戳（onOpen / onMessage 时更新） */
    private var lastMessageTime: Long = 0L

    /** 当前重连退避（毫秒），连接成功后重置为 INITIAL_BACKOFF_MS */
    private var currentBackoff: Long = INITIAL_BACKOFF_MS

    /**
     * 心跳 Runnable：
     *   - 检查超时：距 lastMessageTime > 60s → 主动 close 触发 onFailure 重连
     *   - 发应用层 ping 文本帧
     *   - 30s 后再跑
     */
    private val pingRunnable = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            if (lastMessageTime > 0L && now - lastMessageTime > TIMEOUT_MS) {
                // 60s 没消息了，主动 close → 走 onFailure → scheduleReconnect
                webSocket?.close(1000, "client timeout 60s")
                return
            }
            webSocket?.send("{\"type\":\"ping\"}")
            handler.postDelayed(this, PING_INTERVAL_MS)
        }
    }

    /** 延迟重连 Runnable */
    private val connectRunnable = Runnable { connectWebSocket() }

    /**
     * 注册业务通知渠道"主动消息"（独立于 keep_alive_channel）
     *  - IMPORTANCE_HIGH：弹横幅 + 声音 + 锁屏顶部大字
     *  - setShowBadge(true)：桌面图标角标
     */
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
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    /**
     * 建立 WebSocket 连接
     * 幂等 — 已有 webSocket 时不重复创建
     */
    private fun connectWebSocket() {
        // 避免重复连接
        if (webSocket != null) return

        // 暮色 2026-08-29 P0 第三步配套：userId 从 SharedPreferences 读
        //   没存过就 UUID.randomUUID() 生成一个写回去，后续复用（同一台手机同一个）
        val userId = getOrCreateUserId()
        val fullUrl = "$WS_URL?userId=$userId&token=$WS_TOKEN"
        val request = Request.Builder().url(fullUrl).build()
        webSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                lastMessageTime = System.currentTimeMillis()
                currentBackoff = INITIAL_BACKOFF_MS
                // 启动心跳循环
                handler.removeCallbacks(pingRunnable)
                handler.postDelayed(pingRunnable, PING_INTERVAL_MS)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                lastMessageTime = System.currentTimeMillis()
                handleMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                scheduleReconnect()
            }
        })
    }

    /**
     * 调度重连 — 指数退避
     * 退避在 scheduleReconnect 里翻倍（postDelayed 用当前 currentBackoff 然后翻倍）
     * 连接成功（onOpen）时 currentBackoff 会被重置回 INITIAL_BACKOFF_MS
     */
    private fun scheduleReconnect() {
        handler.removeCallbacks(pingRunnable)
        this.webSocket = null
        val delay = currentBackoff
        currentBackoff = (currentBackoff * 2).coerceAtMost(MAX_BACKOFF_MS)
        handler.postDelayed(connectRunnable, delay)
    }

    /**
     * 解析服务端消息 — 当前只认 proactive_message
     * 其他 type 静默忽略（兼容服务端未来扩展）
     */
    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")
            if (type != "proactive_message") return
            val characterId = json.optString("characterId")
            val content = json.optString("content")
            if (characterId.isEmpty() || content.isEmpty()) return
            showProactiveNotification(characterId, content)
        } catch (e: Exception) {
            // 解析失败忽略 — 避免把服务搞挂
        }
    }

    /**
     * 弹系统通知
     *  - 标题用 characterId（后续会改成角色名）
     *  - 内容用 content
     *  - 点击 PendingIntent 跳回 MainActivity
     *  - 同角色新消息覆盖旧通知（用 abs(hashCode) 做 ID）
     */
    private fun showProactiveNotification(characterId: String, content: String) {
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
        getSystemService(NotificationManager::class.java).notify(notificationId, notification)
    }

    /**
     * 暮色 2026-08-29 P0 第三步配套：从 SharedPreferences 拿持久化 userId
     *   没存过就 UUID.randomUUID() 生成一个写回去
     *   一台手机一个，卸载重装会变（跟 Web Push endpoint 行为一致）
     *   Service 是单线程（默认在主线程），不需要锁
     */
    private fun getOrCreateUserId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val existing = prefs.getString(KEY_WS_USER_ID, null)
        if (existing != null) return existing
        val newId = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_WS_USER_ID, newId).apply()
        return newId
    }
}
