package com.aetheros.simulator

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import org.unifiedpush.android.connector.UnifiedPush
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * AmsgUnifiedPush Capacitor 插件（2026-09-15 麦麦加）
 *
 * 对应前端 utils/unifiedPushPlugin.ts 的 registerPlugin("AmsgUnifiedPush")。
 * 暴露 5 个方法：
 *   - getStatus()            → 当前 distributor / subscription / lastError
 *   - register({vapidPublicKey})  → 触发 UnifiedPush.register
 *   - unregister()           → 触发 UnifiedPush.unregister
 *   - drainPendingPushes()   → 取走 SharedPreferences 里缓存的消息
 *   - addListener(...)        → Capacitor 标准事件订阅（pushReceived / notificationTapped / registrationChanged）
 *
 * UnifiedPush 接收端在 UnifiedPushService.kt（继承 org.unifiedpush.android.connector.PushService），
 * 在 AndroidManifest 注册为 service（exported=true）。SDK 自带的 MessagingReceiverImpl 在内部
 * bind 我们，把 ntfy 推送事件转发到 PushService 的 4 个回调。消息通过 SharedPreferences 在
 * service 和 plugin 之间共享。
 *
 * VAPID 密钥对（ECDSA P-256，公钥 → base64url）：
 *   UnifiedPush 协议要求客户端生成 VAPID 公钥发给 distributor，distributor 用它做 RFC8292
 *   服务端身份认证。Worker 端用同样的公钥生成签名，所以客户端要**保持密钥对持久化**
 *   （每次 register 都用同一对，否则 endpoint 变化会丢已有订阅）。
 */
@CapacitorPlugin(name = "AmsgUnifiedPush")
class AmsgUnifiedPushPlugin : Plugin() {

    companion object {
        const val TAG = "AmsgUnifiedPushPlugin"
        const val VAPID_PREFS = "unifiedpush_vapid_v1"
        const val VAPID_PRIVATE_KEY = "privateKey" // PKCS#8 encoded, base64
        const val VAPID_PUBLIC_KEY = "publicKey"   // SEC1 uncompressed, base64url
        const val ENDPOINT_PREFS = "unifiedpush_endpoint_v1"
        const val PENDING_PREFS = UnifiedPushService.PENDING_PREFS
        const val PENDING_KEY = UnifiedPushService.PENDING_KEY
        const val INSTANCE = "amsg2_main"
    }

    /**
     * 麦麦 2026-09-19：补 2.0 UnifiedPush 端到端链路 —
     *   UnifiedPushService.onMessage 解析 payload 后，
     *     1) 自己弹通知（系统通知栏，那条已修）
     *     2) sendBroadcast(ACTION_PUSH_DELIVERED) 让本 receiver 收到
     *   receiver 在收到后调 notifyListeners('pushReceived', JSObject) 派给 JS 端。
     *   JS 端 utils/unifiedPushRuntime.ts addListener('pushReceived') 已经定义好——
     *   缺的就是这条 broadcast→receiver→notifyListeners 直达通道。
     *
     * 之前 receiver 不存在，注释说"分发靠 drain 轮询"但前端 initUnifiedPushRuntime
     * 从未被调过。补这个 receiver 等于把桥架上：app 在前台时 (plugin 必然已 load)，
     * receiver 一定已注册；后台时 receiver 没注册时退路是 SP 缓存 + 下次启动 drain。
     */
    private val pushReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            val action = intent?.action
            if (action != UnifiedPushService.ACTION_PUSH_DELIVERED) return
            val payload = intent.getStringExtra(UnifiedPushService.EXTRA_PAYLOAD) ?: return
            try {
                val jsObj = JSObject()
                jsObj.put("payload", payload)
                jsObj.put("receivedAt", System.currentTimeMillis())
                notifyListeners("pushReceived", jsObj)
                Log.i(TAG, "pushReceived 派发到 JS（payload 头 ${payload.take(40)}）")
            } catch (e: Exception) {
                Log.e(TAG, "notifyListeners pushReceived 失败", e)
            }
        }
    }

    private var pushReceiverRegistered = false

    /**
     * Capacitor 在 plugin 挂载时调 load()，仅在 Activity 起来时跑一次。
     * Activity 跨前后台切换一般不会重跑 load，receiver 一次性注册、跨前后台复用。
     */
    override fun load() {
        super.load()
        // 暮色 2026-09-19 13:50 临时注释：registerPushReceiver 让 Android 14 上锁屏卡死？
        // registerPushReceiver()
    }

    override fun handleOnDestroy() {
        try {
            if (pushReceiverRegistered) {
                context.unregisterReceiver(pushReceiver)
                pushReceiverRegistered = false
            }
        } catch (e: Exception) {
            Log.w(TAG, "unregisterReceiver 失败", e)
        }
        super.handleOnDestroy()
    }

    private fun registerPushReceiver() {
        if (pushReceiverRegistered) return
        try {
            val filter = IntentFilter(UnifiedPushService.ACTION_PUSH_DELIVERED)
            // Android 13+ 强制要求 RECEIVER_EXPORTED 或 RECEIVER_NOT_EXPORTED flag
            // service 在我们 app 内，所以 NOT_EXPORTED 就够，外部 app 发不进来。
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(pushReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(pushReceiver, filter)
            }
            pushReceiverRegistered = true
            Log.i(TAG, "pushReceiver 已注册（监听 ${UnifiedPushService.ACTION_PUSH_DELIVERED}）")
        } catch (e: Exception) {
            Log.w(TAG, "registerReceiver 失败", e)
        }
    }

    /**
     * 返回当前 UnifiedPush 状态（distributor / subscription / lastError）。
     * permission 由前端用 LocalNotifications.checkPermissions() 拼装，不在这里管。
     */
    @PluginMethod
    fun getStatus(call: PluginCall) {
        try {
            val ret = JSObject()
            val distributors = UnifiedPush.getDistributors(context).toList()
            ret.put("native", true)
            ret.put("distributors", JSONArray(distributors))
            ret.put(
                "distributor",
                UnifiedPush.getAckDistributor(context)
                    ?: UnifiedPush.getSavedDistributor(context)
            )

            val sp = context.getSharedPreferences(ENDPOINT_PREFS, android.content.Context.MODE_PRIVATE)
            val endpoint = sp.getString("endpoint", null)
            val lastError = sp.getString("lastError", null)

            val vapidSp = context.getSharedPreferences(VAPID_PREFS, android.content.Context.MODE_PRIVATE)
            // 麦麦 2026-09-19 13:08 修：subscription.vapidPublicKey 跟前端比对用的入参是 worker
            //   公钥（utils/unifiedPushPlugin.ts:100 subscription.vapidPublicKey === vapidPublicKey）。
            //   之前这里读 client 自己生成的公钥（VAPID_PUBLIC_KEY 字段），跟 worker 公钥永远不等，
            //   导致 ensureUnifiedPushSubscription 60 次轮询全失败 → "UnifiedPush 注册超时"。
            //   改读 register() 时存的 workerVapidPublicKey，无则 fallback client 公钥（兼容老数据）。
            val workerVapidPublicKey = vapidSp.getString("workerVapidPublicKey", null)
                ?: vapidSp.getString(VAPID_PUBLIC_KEY, null)

            if (endpoint != null && workerVapidPublicKey != null) {
                val sub = JSObject()
                sub.put("endpoint", endpoint)
                val keys = JSObject()
                // UnifiedPush 协议不用 p256dh/auth（distributor 已经替我们做了 RFC8291 加密）
                // 但前端代码统一用 Web Push Subscription 形态，这里塞占位字段保接口形状。
                // p256dh 也跟着改成 worker 公钥 —— 跟 subscription.vapidPublicKey 同源，
                // 避免下次有人改成读 p256dh 字段时再撞同一个 bug。
                keys.put("p256dh", workerVapidPublicKey)
                keys.put("auth", "")
                sub.put("keys", keys)
                sub.put("distributor", ret.getString("distributor") ?: "")
                sub.put("temporary", false)
                sub.put("vapidPublicKey", workerVapidPublicKey)
                ret.put("subscription", sub)
            } else {
                ret.put("subscription", null)
            }

            ret.put("lastError", lastError)
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "getStatus 失败", e)
            call.reject("getStatus 失败：${e.message}")
        }
    }

    /**
     * 触发 UnifiedPush 注册。
     *   1. 读 / 生成 VAPID 密钥对（持久化）
     *   2. 调 UnifiedPush.register(context, instance, messageForDistributor, vapid)
     *
     * vapid 字符串是 base64url(SEC1 uncompressed public key) — UnifiedPush SDK 接受这个格式。
     */
    @PluginMethod
    fun register(call: PluginCall) {
        try {
            val vapidPublicKeyFromWorker = call.getString("vapidPublicKey", null)
            // worker 给我们传过来的 VAPID 公钥先记一下（虽然 UnifiedPush 客户端用的是自己的，
            // 但前端拿到 subscription.endpoint 会去 worker 验证时用 worker 公钥）
            Log.i(TAG, "register 入参 vapidPublicKeyFromWorker.length=${vapidPublicKeyFromWorker?.length ?: 0}")
            if (!vapidPublicKeyFromWorker.isNullOrEmpty()) {
                val sp = context.getSharedPreferences(VAPID_PREFS, Context.MODE_PRIVATE)
                sp.edit().putString("workerVapidPublicKey", vapidPublicKeyFromWorker).apply()
            }

            val ourVapid = ensureOrGenerateVapidKey()
            val instance = INSTANCE
            Log.i(TAG, "register 用 client vapid (${ourVapid.take(20)}...) + instance=$instance")

            // 提示用户允许 / 选 distributor
            // tryUseCurrentOrDefaultDistributor 会启动一个 translucent activity
            UnifiedPush.tryUseCurrentOrDefaultDistributor(context) { success ->
                Log.i(TAG, "tryUseCurrentOrDefaultDistributor callback success=$success")
                if (!success) {
                    call.reject("未检测到 UnifiedPush distributor。请先安装并打开 ntfy 的无 Firebase 版本。")
                    return@tryUseCurrentOrDefaultDistributor
                }
                try {
                    // "拾光机" = 提示语，distributor 会显示在 UI 上
                    UnifiedPush.register(
                        context,
                        instance,
                        "拾光机主动消息 2.0",
                        ourVapid
                    )
                    Log.i(TAG, "UnifiedPush.register() 已调, 等 distributor 回调 onNewEndpoint")
                    val ret = JSObject()
                    ret.put("pending", true)
                    call.resolve(ret)
                } catch (e: Exception) {
                    Log.e(TAG, "register 失败", e)
                    call.reject("register 失败：${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "register 顶层失败", e)
            call.reject("register 失败：${e.message}")
        }
    }

    /**
     * 注销。删除 SharedPreferences 里的 endpoint，触发 UnifiedPush.unregister。
     */
    @PluginMethod
    fun unregister(call: PluginCall) {
        try {
            UnifiedPush.unregister(context, INSTANCE)
            val sp = context.getSharedPreferences(ENDPOINT_PREFS, android.content.Context.MODE_PRIVATE)
            sp.edit().clear().apply()
            call.resolve()
        } catch (e: Exception) {
            Log.e(TAG, "unregister 失败", e)
            call.reject("unregister 失败：${e.message}")
        }
    }

    /**
     * 取走 SharedPreferences 里缓存的消息（receiver 在 onMessage 里塞的）。
     * 前端 UnifiedPushRuntime 启动时会 drain 一次，启动后靠 addListener 监听 pushReceived。
     * 但实际 receiver 在 plugin 之外，没法直接 notifyListeners，所以这里**主动 query**：
     *   - drain PendingPushes 时如果有新消息 → 调 notifyListeners('pushReceived')
     *   - 启动 payload 一次性返回（launchPayload 字段）
     */
    @PluginMethod
    fun drainPendingPushes(call: PluginCall) {
        try {
            val sp = context.getSharedPreferences(PENDING_PREFS, android.content.Context.MODE_PRIVATE)
            val raw = sp.getString(PENDING_KEY, "[]") ?: "[]"
            val arr = try {
                JSONArray(raw)
            } catch (e: Exception) {
                Log.w(TAG, "drain 解析 pending 失败", e)
                JSONArray()
            }

            val messages = JSArray()
            for (i in 0 until arr.length()) {
                val item = arr.getJSONObject(i)
                val msg = JSObject()
                msg.put("payload", item.getString("payload") ?: "")
                msg.put("receivedAt", item.optLong("receivedAt", System.currentTimeMillis()))
                messages.put(msg)
                // 顺便通知 listener（让前端能实时收到）
                notifyListeners("pushReceived", msg)
            }

            // 清空 pending
            sp.edit().putString(PENDING_KEY, "[]").apply()

            // 启动 payload
            val launchPayload = UnifiedPushService.consumeLaunchPayload(context)

            val ret = JSObject()
            ret.put("messages", messages)
            if (launchPayload != null) ret.put("launchPayload", launchPayload)
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "drainPendingPushes 失败", e)
            call.reject("drainPendingPushes 失败：${e.message}")
        }
    }

    /**
     * Capacitor 标准 listener。前端 addListener('pushReceived', ...) 就能收到。
     * 我们没有"通知被点"概念（LocalNotifications 是前端自己弹的，前端自己处理点击），
     * 但为了接口形状完整，留一个 registrationChanged 事件。
     */
    @PluginMethod
    override fun addListener(call: PluginCall) {
        // Capacitor 默认实现
        super.addListener(call)
    }

    /**
     * Capacitor 标准 listener 移除。
     */
    @PluginMethod
    override fun removeListener(call: PluginCall) {
        super.removeListener(call)
    }

    // ----- helpers -----

    /**
     * 读或生成 VAPID 密钥对。返回 SEC1 uncompressed 公钥的 base64url 字符串。
     * 持久化在 SharedPreferences 里（重新 install app 会丢，但同一次 install 内复用）。
     */
    private fun ensureOrGenerateVapidKey(): String {
        val sp = context.getSharedPreferences(VAPID_PREFS, android.content.Context.MODE_PRIVATE)
        val existing = sp.getString(VAPID_PUBLIC_KEY, null)
        if (existing != null) return existing

        val kpg = KeyPairGenerator.getInstance("EC")
        kpg.initialize(ECGenParameterSpec("secp256r1"), SecureRandom())
        val pair: KeyPair = kpg.generateKeyPair()
        val pub = pair.public as ECPublicKey
        // W = public point (affine x, y)，每个 32 字节
        val x = pad32(pub.w.affineX.toByteArray())
        val y = pad32(pub.w.affineY.toByteArray())
        // SEC 1 uncompressed = 0x04 || X || Y = 65 字节
        val sec1 = ByteArray(1 + x.size + y.size)
        sec1[0] = 0x04
        System.arraycopy(x, 0, sec1, 1, x.size)
        System.arraycopy(y, 0, sec1, 1 + x.size, y.size)
        val pubB64u = base64UrlEncode(sec1)

        val privPkcs8 = pair.private.encoded
        val privB64 = Base64.encodeToString(privPkcs8, Base64.NO_WRAP)

        sp.edit()
            .putString(VAPID_PUBLIC_KEY, pubB64u)
            .putString(VAPID_PRIVATE_KEY, privB64)
            .apply()

        Log.i(TAG, "生成新 VAPID 密钥对（pub 头 ${pubB64u.take(20)}）")
        return pubB64u
    }

    private fun pad32(bytes: ByteArray): ByteArray {
        // BigInteger.toByteArray 可能带符号位 0x00 或截短，要 pad 到 32 字节
        return when {
            bytes.size == 32 -> bytes
            bytes.size == 33 && bytes[0] == 0.toByte() -> bytes.copyOfRange(1, 33)
            bytes.size < 32 -> ByteArray(32 - bytes.size) + bytes
            else -> bytes.copyOfRange(bytes.size - 32, bytes.size)
        }
    }

    private fun base64UrlEncode(bytes: ByteArray): String =
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
            .replace('+', '-')
            .replace('/', '_')

    /** 让 JSObject / JSArray 在 Plugin 内部易用的便利类型（Capacitor 6 提供） */
    private class JSArray : org.json.JSONArray() {
        // JSONArray 已经够了，不需要特别继承。仅为类型可读性。
    }
}

/** org.json 内部 helper，方便 plugin 把 JSONObject 转成 JSObject */
private fun JSONObject.toJSObject(): JSObject {
    val js = JSObject()
    val keys = this.keys()
    while (keys.hasNext()) {
        val k = keys.next()
        when (val v = this.get(k)) {
            is JSONObject -> js.put(k, v.toJSObject())
            is org.json.JSONArray -> js.put(k, v.toJSArray())
            else -> js.put(k, v)
        }
    }
    return js
}

private fun org.json.JSONArray.toJSArray(): org.json.JSONArray {
    val arr = org.json.JSONArray()
    for (i in 0 until this.length()) {
        when (val v = this.get(i)) {
            is JSONObject -> arr.put(v.toJSObject())
            is org.json.JSONArray -> arr.put(v.toJSArray())
            else -> arr.put(v)
        }
    }
    return arr
}