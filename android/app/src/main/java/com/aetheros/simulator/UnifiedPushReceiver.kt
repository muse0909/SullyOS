package com.aetheros.simulator

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.MessagingReceiver

/**
 * UnifiedPush 接收端（2026-09-15 麦麦加）
 *
 * 上游（friedsully.com / 拾光机原版的拾光机 .ccwu.cc 站）保留在 D:\CHICK\CHICK2 私有壳仓库
 * 没暴露在公开仓库。SullyOS 这边需要在 android/ 里写 Kotlin 桥接把 UnifiedPush 事件
 * 接进前端用的 Capacitor 通道。
 *
 * 工作链路：
 *   1. ntfy 收到推送 → 发广播给我们 → 我们存 SharedPreferences
 *   2. 前端 unifiedPushPlugin.ts 通过 NativeUnifiedPush.drainPendingPushes() 把缓存拉走
 *   3. 前端用 LocalNotifications 显示通知
 *
 * 消息持久化用 SharedPreferences（unifiedpush_pending_msgs_v1），不依赖 SQLite / Room。
 */
class UnifiedPushReceiver : MessagingReceiver() {

    companion object {
        const val TAG = "UnifiedPushReceiver"
        const val PENDING_PREFS = "unifiedpush_pending_msgs_v1"
        const val PENDING_KEY = "messages"
        const val LAUNCH_PAYLOAD_PREFS = "unifiedpush_launch_payload_v1"
        const val LAUNCH_PAYLOAD_KEY = "payload"
        const val MAX_PENDING = 100

        /**
         * 把收到的消息追加到 SharedPreferences（receiver 和 plugin 都能调）。
         * receiver 里用 — 不直接调 notifyListeners，避免 Capacitor bridge 持有问题。
         */
        fun appendPendingMessage(context: Context, payload: String) {
            val prefs = context.getSharedPreferences(PENDING_PREFS, Context.MODE_PRIVATE)
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
            // 截短到 MAX_PENDING 条（FIFO）
            while (arr.length() > MAX_PENDING) {
                arr.remove(0)
            }
            prefs.edit().putString(PENDING_KEY, arr.toString()).apply()
            Log.i(TAG, "已缓存 1 条 UP 消息（队列 ${arr.length()}）")
        }

        fun readLaunchPayload(context: Context): String? {
            val prefs = context.getSharedPreferences(LAUNCH_PAYLOAD_PREFS, Context.MODE_PRIVATE)
            return prefs.getString(LAUNCH_PAYLOAD_KEY, null)
        }

        fun consumeLaunchPayload(context: Context): String? {
            val prefs = context.getSharedPreferences(LAUNCH_PAYLOAD_PREFS, Context.MODE_PRIVATE)
            val value = prefs.getString(LAUNCH_PAYLOAD_KEY, null)
            if (value != null) prefs.edit().remove(LAUNCH_PAYLOAD_KEY).apply()
            return value
        }
    }

    /**
     * 收到推送时调用（消息已经是 RFC8291 解密后的明文）。
     * 存 SharedPreferences 让前端 drainPendingPushes 拉走。
     */
    override fun onMessage(context: Context, message: org.unifiedpush.android.connector.data.PushMessage, instance: String) {
        try {
            val bytes = message.content
            val payload = String(bytes, Charsets.UTF_8)
            appendPendingMessage(context, payload)
        } catch (e: Exception) {
            Log.e(TAG, "处理推送消息失败", e)
        }
    }

    /**
     * 注册成功 / endpoint 变化时调用。
     * 我们这里把 endpoint 存 SharedPreferences（plugin getStatus 时读）。
     */
    override fun onNewEndpoint(context: Context, endpoint: org.unifiedpush.android.connector.data.PushEndpoint, instance: String) {
        val url = endpoint.url
        Log.i(TAG, "新 endpoint: ${url.take(40)}...")
        val sp = context.getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
        sp.edit().putString("endpoint", url).apply()
    }

    /**
     * 注册失败。
     */
    override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
        Log.w(TAG, "注册失败：$reason")
        val sp = context.getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
        sp.edit()
            .putString("lastError", reason.name)
            .apply()
    }

    /**
     * 被 distributor 注销。
     */
    override fun onUnregistered(context: Context, instance: String) {
        Log.i(TAG, "已注销")
        val sp = context.getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
        sp.edit()
            .remove("endpoint")
            .putString("lastError", "UNREGISTERED")
            .apply()
    }
}