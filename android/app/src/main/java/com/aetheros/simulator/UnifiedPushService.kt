package com.aetheros.simulator

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService

/**
 * 拾光机 主动消息 2.0 后台推送 — UnifiedPush Service 端（2026-09-15 麦麦加）
 *
 * UnifiedPush android-connector 3.0.0 的现代 API 是 PushService 不是 MessagingReceiver：
 *   1. ntfy 发 broadcast 给我们 app
 *   2. SDK 自带的 MessagingReceiverImpl（在 SDK manifest 里）接收
 *   3. SDK 在内部 bind 我们这个 PushService 把事件转过来
 *   4. 我们这 4 个方法被调
 *
 * 上一版用的 MessagingReceiver（UnifiedPushReceiver.kt）错的：SDK 的 receiver 被我们的
 * intent-filter 抢占了，SDK 那个根本不运行，所以事件没人转发。现在改用 PushService 模式。
 *
 * 消息持久化跟之前的 Receiver 版一样：用 SharedPreferences（unifiedpush_pending_msgs_v1）
 * 缓存。AmsgUnifiedPushPlugin.drainPendingPushes() 会拉走。
 */
class UnifiedPushService : PushService() {

    companion object {
        const val TAG = "UnifiedPushService"
        const val PENDING_PREFS = "unifiedpush_pending_msgs_v1"
        const val PENDING_KEY = "messages"
        const val LAUNCH_PAYLOAD_PREFS = "unifiedpush_launch_payload_v1"
        const val LAUNCH_PAYLOAD_KEY = "payload"
        const val MAX_PENDING = 100

        /**
         * 追加一条 pending 消息到 SharedPreferences。
         * 在 Service 里调 + 也给可能外部调（兜底）。
         */
        fun appendPendingMessage(context: android.content.Context, payload: String) {
            val prefs = context.getSharedPreferences(PENDING_PREFS, android.content.Context.MODE_PRIVATE)
            val raw = prefs.getString(PENDING_KEY, "[]") ?: "[]"
            val arr = try {
                JSONArray(raw)
            } catch (e: Exception) {
                Log.w(TAG, "pending prefs 解析失败，重置", e)
                JSONArray()
            }
            val entry = JSONObject().apply {
                put("payload", payload)
                put("receivedAt", System.currentTimeMillis())
            }
            arr.put(entry)
            while (arr.length() > MAX_PENDING) {
                arr.remove(0)
            }
            prefs.edit().putString(PENDING_KEY, arr.toString()).apply()
            Log.i(TAG, "已缓存 1 条 UP 消息（队列 ${arr.length()}）")
        }

        fun consumeLaunchPayload(context: android.content.Context): String? {
            val prefs = context.getSharedPreferences(LAUNCH_PAYLOAD_PREFS, android.content.Context.MODE_PRIVATE)
            val value = prefs.getString(LAUNCH_PAYLOAD_KEY, null)
            if (value != null) prefs.edit().remove(LAUNCH_PAYLOAD_KEY).apply()
            return value
        }
    }

    /**
     * 收到推送时（消息已是 RFC8291 解密后的明文）。
     */
    override fun onNewEndpoint(endpoint: org.unifiedpush.android.connector.data.PushEndpoint, instance: String) {
        val url = endpoint.url
        Log.i(TAG, "新 endpoint (instance=$instance): ${url.take(60)}...")
        val sp = getSharedPreferences("unifiedpush_endpoint_v1", android.content.Context.MODE_PRIVATE)
        sp.edit()
            .putString("endpoint", url)
            .putString("instance", instance)
            .putString("publicKey", endpoint.pubKeySet?.pubKey ?: "")
            .putString("auth", endpoint.pubKeySet?.auth ?: "")
            .remove("lastError")
            .apply()
        // endpoint 改变就是注册成功，唤醒 WakeLock 让 plugin 的 15s 轮询尽快拿到
        // （plugin 实际上在 250ms 间隔轮询，不用额外动作）
    }

    /**
     * 收到推送消息。
     */
    override fun onMessage(message: org.unifiedpush.android.connector.data.PushMessage, instance: String) {
        try {
            val bytes = message.content
            val payload = String(bytes, Charsets.UTF_8)
            appendPendingMessage(applicationContext, payload)
            // 也调 plugin 的 notifyListeners（plugin 在 bridge 拿到 pushReceived 事件）
            notifyAmsg2PushReceived(payload)
        } catch (e: Exception) {
            Log.e(TAG, "处理推送消息失败", e)
        }
    }

    /**
     * 注册失败。
     */
    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        Log.w(TAG, "注册失败 (instance=$instance): $reason")
        val sp = getSharedPreferences("unifiedpush_endpoint_v1", android.content.Context.MODE_PRIVATE)
        sp.edit()
            .putString("lastError", reason.name)
            .apply()
    }

    /**
     * 被 distributor 注销。
     */
    override fun onUnregistered(instance: String) {
        Log.i(TAG, "已注销 (instance=$instance)")
        val sp = getSharedPreferences("unifiedpush_endpoint_v1", android.content.Context.MODE_PRIVATE)
        sp.edit()
            .remove("endpoint")
            .putString("lastError", "UNREGISTERED")
            .apply()
    }

    /**
     * 通知 AmsgUnifiedPushPlugin 收到推送（让前端实时收到 pushReceived 事件）。
     * 在 Service 里拿不到 Capacitor plugin 实例，所以通过 SharedPreferences 共享状态——
     * 实际通知走 plugin 端的 drainPendingPushes 轮询，drain 时它自己 notifyListeners。
     */
    private fun notifyAmsg2PushReceived(payload: String) {
        // 留空 — 真正的事件分发在 plugin.drainPendingPushes 里。
        // 如果你看到这里想要主动 emitJS，可改成：
        //   val bridge = (applicationContext as? BridgeActivity)?.bridge ?: return
        //   bridge.getPlugin("AmsgUnifiedPush")?.notifyListeners("pushReceived", JSObject().put("payload", payload))
        // ——但 BridgeActivity 不一定能从 Service 里拿，所以这里保守用轮询方案。
        Log.d(TAG, "pushReceived 缓存好（payload 头 ${payload.take(40)}）")
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)
}