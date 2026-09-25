package com.aetheros.simulator

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService

/**
 * 拾光机 主动消息 2.0 后台推送 — UnifiedPush Service 端（2026-09-15 麦麦加，09-19 补完整）
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
 * **2026-09-19 麦麦补** — 把这条路径补到跟 1.0 KeepAliveService.showProactiveNotification
 * 一样完整。之前 onMessage 只调 appendPendingMessage 缓存到 SP + notifyAmsg2PushReceived
 * 占位空实现，导致 (1) 通知栏不弹 (2) Chat 不自动刷新 — 前端 ingest 链路根本启动
 * (initUnifiedPushRuntime 在项目里从未被调过)。
 *
 * 现在 onMessage 三件事一起做：
 *   1) 弹系统通知：解析 payload → NotificationCompat.Builder → NotificationManager.notify()
 *   2) 派发给前端 JS：通过 broadcast intent 触发 AmsgUnifiedPushPlugin 内部的 receiver，
 *      receiver 调 notifyListeners('pushReceived', ...) → JS addListener('pushReceived')
 *      → ingestNativeAmsgPayload → saveInboxMessage → flushInboxToChat → 派 active-msg-received
 *      → OSContext setLastMsgTimestamp → Chat.tsx useEffect reloadMessages
 *   3) 缓存到 SP 兜底：app 不在前台 / plugin receiver 没注册时，重启后 initUnifiedPushRuntime
 *      drain 出来补上
 */
class UnifiedPushService : PushService() {

    companion object {
        const val TAG = "UnifiedPushService"
        const val PENDING_PREFS = "unifiedpush_pending_msgs_v1"
        const val PENDING_KEY = "messages"
        const val LAUNCH_PAYLOAD_PREFS = "unifiedpush_launch_payload_v1"
        const val LAUNCH_PAYLOAD_KEY = "payload"
        const val MAX_PENDING = 100

        // 通知 channel (Android 8+ 必须 channel，name 用户在系统设置能看到)
        const val NOTIFICATION_CHANNEL_ID = "amsg2_unifiedpush_v1"
        const val NOTIFICATION_CHANNEL_NAME = "主动消息 2.0"

        // 内部 broadcast — AmsgUnifiedPushPlugin 的 receiver 监听这个 action。
        // 用 application 包内限定 setPackage，防外部触发。
        const val ACTION_PUSH_DELIVERED = "com.aetheros.simulator.AMSG2_PUSH_DELIVERED"
        const val EXTRA_PAYLOAD = "payload"

        /**
         * 追加一条 pending 消息到 SharedPreferences。
         * 在 Service 里调 + 也给可能外部调（兜底）。
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
            while (arr.length() > MAX_PENDING) {
                arr.remove(0)
            }
            prefs.edit().putString(PENDING_KEY, arr.toString()).apply()
            Log.i(TAG, "已缓存 1 条 UP 消息（队列 ${arr.length()}）")
        }

        fun consumeLaunchPayload(context: Context): String? {
            val prefs = context.getSharedPreferences(LAUNCH_PAYLOAD_PREFS, Context.MODE_PRIVATE)
            val value = prefs.getString(LAUNCH_PAYLOAD_KEY, null)
            if (value != null) prefs.edit().remove(LAUNCH_PAYLOAD_KEY).apply()
            return value
        }

        // 通知 ID 哈希，跟 KeepAliveService.notificationIdHash 用同一份算法。
        // 同一 char+msgId 不重弹。
        fun notificationIdHash(messageId: String, charId: String): Int {
            val key = if (messageId.isNotEmpty()) messageId else charId
            return Math.abs(key.hashCode())
        }
    }

    /**
     * 收到推送时（消息已是 RFC8291 解密后的明文）。
     */
    override fun onNewEndpoint(endpoint: org.unifiedpush.android.connector.data.PushEndpoint, instance: String) {
        // 暮色 2026-09-19 14:18 修：之前用 .apply() 异步写, 如果 SDK 紧接着调下一个
        //   service callback 把进程卡住 (Android 14 上偶发), apply 可能没刷盘就被丢。
        //   改 .commit() 同步写, 一次几十毫秒, 不会卡 UI 主线程 (onNewEndpoint 在主线程)。
        //   同步写保证 endpoint 落地后, 下一帧 getStatus 立刻能读到。
        try {
            val url = endpoint.url
            Log.i(TAG, "onNewEndpoint 被调 (instance=$instance, url=${url.take(80)})")
            if (url.isNullOrEmpty()) {
                Log.e(TAG, "onNewEndpoint 拿到空 url, 写 lastError 让前端能看到")
                getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
                    .edit().putString("lastError", "ENDPOINT_URL_EMPTY")
                    .commit()
                return
            }
            getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
                .edit()
                .putString("endpoint", url)
                .putString("instance", instance)
                .putString("publicKey", endpoint.pubKeySet?.pubKey ?: "")
                .putString("auth", endpoint.pubKeySet?.auth ?: "")
                .remove("lastError")
                .commit()
            Log.i(TAG, "onNewEndpoint 写 endpoint 完成 (urlLen=${url.length})")
        } catch (e: Throwable) {
            Log.e(TAG, "onNewEndpoint 抛错 (但 SDK 不会 retry, 这次注册就废了)", e)
            try {
                getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
                    .edit().putString("lastError", "ON_NEW_ENDPOINT_FAILED: ${e.javaClass.simpleName}: ${e.message?.take(80)}")
                    .commit()
            } catch (_: Throwable) { /* 兜底 */ }
        }
    }

    /**
     * 收到推送消息 — 2026-09-19 改：
     *   1) 解析 payload → 拿 title/body/charId/messageId
     *   2) 弹系统通知（Android 8+ 创建专属 channel）
     *   3) sendBroadcast 给 plugin 的 receiver → notifyListeners('pushReceived', JSObject)
     *   4) 缓存到 SP 兜底（plugin receiver 没注册时下次启动 drain）
     */
    override fun onMessage(message: org.unifiedpush.android.connector.data.PushMessage, instance: String) {
        try {
            val bytes = message.content
            val payload = String(bytes, Charsets.UTF_8)

            // 麦麦 2026-09-23 22:50：诊断日志 — 节点 4 wakeup-android-receive（UnifiedPush SDK 派发）
            //   先做最浅的解析拿到 msgId / charId / taskId 用于日志，其余字段后面再读。
            val rawMeta = try {
                JSONObject(payload).optJSONObject("metadata")
            } catch (_: Throwable) { null }
            val rawCharId = rawMeta?.optString("charId") ?: ""
            val rawMessageId = try {
                JSONObject(payload).optString("messageId")
            } catch (_: Throwable) { "" }
            val rawTaskUuid = try {
                JSONObject(payload).optString("taskUuid")
            } catch (_: Throwable) { "" }
            AmsgDiagLog.append(
                context = applicationContext,
                stage = "wakeup-android-receive",
                msgId = rawMessageId.ifEmpty { null },
                taskId = rawTaskUuid.ifEmpty { null },
                charId = rawCharId.ifEmpty { null },
                ok = true,
            )

            // 1) 先弹通知 — 不等 JS 端，慢路径也能落通知栏。
            //    payload 长这样 (worker/amsg/src/agentic.ts buildScheduledPush)：
            //      { messageKind:'content', messageType, source:'scheduled',
            //        message, title, contactName, avatarUrl,
            //        messageSubtype:'chat', taskId, metadata:{charId, charName, ...},
            //        notification:{title, body} }
            try {
                val obj = JSONObject(payload)
                val meta = obj.optJSONObject("metadata")
                val charId = meta?.optString("charId") ?: ""
                val messageId = obj.optString("messageId").ifEmpty {
                    "${charId}-${System.currentTimeMillis()}"
                }
                // title 优先级：contactName > metadata.charName > notification.title > "主动消息"
                val title = obj.optString("contactName").ifEmpty {
                    meta?.optString("charName") ?: obj.optString("title")
                }.ifEmpty { "主动消息" }
                // body 优先级：message > notification.body > body
                val body = obj.optString("message").ifEmpty {
                    obj.optJSONObject("notification")?.optString("body") ?: obj.optString("body")
                }
                if (body.isNotEmpty()) {
                    showProactiveNotification(title, body, charId, messageId)
                    // 麦麦 2026-09-23 22:50：诊断日志 — 节点 10 wakeup-system-notification
                    //   安卓本地弹通知完成（与前端的 wakeup-system-notification 并列，不重复算节点）
                    AmsgDiagLog.append(
                        context = applicationContext,
                        stage = "wakeup-system-notification",
                        msgId = messageId,
                        taskId = rawTaskUuid.ifEmpty { null },
                        charId = charId.ifEmpty { null },
                        ok = true,
                    )
                }
            } catch (e: Exception) {
                // 暮色 2026-09-25 19:12 拍板 B：catch 时不再 fallback 弹乱码通知。
                //   理由：同一条推送的 payload 在 Kotlin JSONObject 解析失败，但 JS 端 JSON.parse 更宽松
                //   能正常 ingest → 消息会进 chat；让 Android 弹乱码通知反而误导用户"刚才没收到"。
                //   JS ingest 失败兜底由 OSContext.sendProactiveNativeNotification 走 messageId 覆盖（同 A3）。
                //   注意：这里只跳过弹通知，下面的 deliverPushToPlugin + appendPendingMessage 仍然执行，
                //   让 JS drain 能补上这条消息。
                val bytesLen = try { bytes.size } catch (_: Throwable) { -1 }
                val payloadLen = payload.length
                // 安全 hex 摘要：前 16 字节 + 后 16 字节（不打印完整敏感内容）
                val headBytes = try {
                    payload.substring(0, minOf(16, payloadLen)).toByteArray(Charsets.UTF_8)
                } catch (_: Throwable) { ByteArray(0) }
                val tailBytes = try {
                    payload.substring(maxOf(0, payloadLen - 16)).toByteArray(Charsets.UTF_8)
                } catch (_: Throwable) { ByteArray(0) }
                val headHex = headBytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
                val tailHex = tailBytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
                val payloadHexSummary = "head(${headBytes.size}B)=$headHex tail(${tailBytes.size}B)=$tailHex"
                // 在 bytes 里粗搜 "messageId":"..." —— cipher bytes 单字节解码成 latin1 字符串（不再次 UTF-8 替换）
                val guessMessageId = try {
                    val raw = String(bytes, Charsets.ISO_8859_1)
                    Regex(""""messageId"\s*:\s*"([^"\\]{1,80})"""").find(raw)?.groupValues?.get(1)
                } catch (_: Throwable) { null }
                Log.w(
                    TAG,
                    "payload 解析失败 — bytes=$bytesLen payloadLen=$payloadLen guessMsgId=$guessMessageId hex=$payloadHexSummary exc=${e.javaClass.simpleName}: ${e.message?.take(120)}",
                    e,
                )
                AmsgDiagLog.append(
                    context = applicationContext,
                    stage = "wakeup-android-receive",
                    msgId = guessMessageId,
                    ok = false,
                    error = "payload 解析失败: bytes=$bytesLen payloadLen=$payloadLen guessMsgId=$guessMessageId hex=$payloadHexSummary exc=${e.javaClass.simpleName}: ${e.message?.take(80)}",
                )
                // 暮色 2026-09-25 19:12：新增诊断节点 wakeup-push-noisy-skip —— 标记"Android 原生解析失败
                //   因此跳过弹通知"。跟前一个 wakeup-android-receive ok=false 配对，便于排查哪些推送
                //   走了这条路径。后续 VAPID/ntfy byte 损坏根因修复后这个 stage 应该消失。
                AmsgDiagLog.append(
                    context = applicationContext,
                    stage = "wakeup-push-noisy-skip",
                    msgId = guessMessageId,
                    ok = true,
                    error = "skip noisy fallback notification: bytes=$bytesLen payloadLen=$payloadLen guessMsgId=$guessMessageId hex=$payloadHexSummary (JS drain 兜底)",
                )
            }

            // 2) sendBroadcast 给 plugin 的 receiver — 触发 JS 端 ingest 链路（关键 UI 自动刷新）
            deliverPushToPlugin(payload)

            // 3) 缓存到 SP 兜底 — app 没启动 / receiver 没注册时这条 pending 等下次启动 drain
            appendPendingMessage(applicationContext, payload)
        } catch (e: Exception) {
            Log.e(TAG, "处理推送消息失败", e)
            AmsgDiagLog.append(
                context = applicationContext,
                stage = "wakeup-android-receive",
                ok = false,
                error = "onMessage 顶层抛错：${e.javaClass.simpleName}: ${e.message?.take(80)}",
            )
        }
    }

    /**
     * 注册失败。
     */
    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        Log.w(TAG, "注册失败 (instance=$instance): $reason")
        val sp = getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
        sp.edit()
            .putString("lastError", reason.name)
            .apply()
    }

    /**
     * 被 distributor 注销。
     */
    override fun onUnregistered(instance: String) {
        Log.i(TAG, "已注销 (instance=$instance)")
        val sp = getSharedPreferences("unifiedpush_endpoint_v1", Context.MODE_PRIVATE)
        sp.edit()
            .remove("endpoint")
            .putString("lastError", "UNREGISTERED")
            .apply()
    }

    /**
     * 弹系统通知。跟 KeepAliveService.showProactiveNotification 是同一种通知（标题+正文+小图标+点开回 App），
     * 但走 UnifiedPushService 自身系统 channel "amsg2_unifiedpush_v1"，跟 1.0 老通道区分。
     */
    private fun showProactiveNotification(
        title: String,
        body: String,
        charId: String,
        messageId: String,
    ) {
        try {
            ensureNotificationChannel()
            // 点击通知 → 拉起 MainActivity（launcher intent）
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            val pi = if (launchIntent != null) {
                PendingIntent.getActivity(
                    this,
                    0,
                    launchIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
            } else null

            val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(applicationInfo.icon)
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()

            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notifId = notificationIdHash(messageId, charId)
            mgr.notify(notifId, notification)
            Log.i(TAG, "弹 UP 通知 id=$notifId char=$charId msgId=$messageId title=$title bodyLen=${body.length}")
        } catch (t: Throwable) {
            Log.e(TAG, "showProactiveNotification 失败", t)
        }
    }

    /**
     * Android 8+ 必须先建 channel，channel id 在 app 里复用同一个 OK。
     */
    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(NOTIFICATION_CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            NOTIFICATION_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "主动消息 2.0 通过 UnifiedPush 通道到达的系统通知。"
            enableVibration(true)
        }
        mgr.createNotificationChannel(channel)
    }

    /**
     * 用 broadcast 通知 AmsgUnifiedPushPlugin 收到推送。
     * plugin 在 load() 里注册 receiver，receiver 调 notifyListeners('pushReceived', ...) 派给 JS。
     *
     * 之前这函数是空实现，注释说"分发靠 plugin 端 drain 轮询" — 但前端 initUnifiedPushRuntime
     * 从未调用过，drain 永不启动，所以是两条断路。现在的写法走 sendBroadcast 实时触发，
     * app 在前台时 receiver 一定已注册；后台时 receiver 可能未注册，但 SP 缓存兜底——
     * 重启后 initUnifiedPushRuntime 拉走。
     */
    private fun deliverPushToPlugin(payload: String) {
        try {
            val intent = Intent(ACTION_PUSH_DELIVERED).apply {
                putExtra(EXTRA_PAYLOAD, payload)
                setPackage(packageName)
            }
            applicationContext.sendBroadcast(intent)
            Log.d(TAG, "sendBroadcast action=$ACTION_PUSH_DELIVERED payloadLen=${payload.length}")
        } catch (e: Exception) {
            Log.w(TAG, "sendBroadcast 失败", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = super.onBind(intent)
}
