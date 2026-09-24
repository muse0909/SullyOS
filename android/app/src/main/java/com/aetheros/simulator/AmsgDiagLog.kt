package com.aetheros.simulator

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * 麦麦 2026-09-23 22:50：主动消息 2.0 Android 端诊断日志 ring buffer。
 *
 * 用 SharedPreferences 存 200 条 JSON 字符串，超出丢最老的。
 * 与前端 utils/amsgDiag.ts 的 localStorage ring buffer 走同样的设计：
 *   - 独立 key `amsg_diag_log_v1`，不复用 instant trace
 *   - 三写：Logcat / SP ring / 前端 dump（通过 PluginMethod dumpAmsgDiag 导出）
 *   - 敏感字段：apiKey / masterKey / VAPID priv / endpoint 全文 / 消息内容
 *     一律不写。endpoint 只截前 30 字。
 *
 * 不依赖 Coroutine / Lifecycle，纯静态方法调用。失败一律静默：诊断不能反过来打断正常链路。
 */
object AmsgDiagLog {
    private const val TAG = "AmsgDiag"
    private const val SP_NAME = "amsg_diag_log_v1"
    private const val KEY_ENTRIES = "entries"
    private const val LIMIT = 200

    /** 追加一条。失败静默。 */
    fun append(
        context: Context,
        stage: String,
        msgId: String? = null,
        taskId: String? = null,
        charId: String? = null,
        ok: Boolean = true,
        error: String? = null,
    ) {
        val entry = JSONObject().apply {
            put("ts", isoNow())
            put("stage", stage)
            if (msgId != null) put("msgId", msgId)
            if (taskId != null) put("taskId", taskId)
            if (charId != null) put("charId", charId)
            put("ok", ok)
            if (error != null) put("error", error.take(120))
        }
        try {
            Log.i(TAG, "$stage ok=$ok charId=$charId msgId=$msgId taskId=$taskId${if (error != null) " error=$error" else ""}")
        } catch (_: Throwable) {
            /* ignore */
        }
        try {
            val sp = context.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE)
            val raw = sp.getString(KEY_ENTRIES, "[]") ?: "[]"
            val arr = try {
                JSONArray(raw)
            } catch (_: Throwable) {
                JSONArray()
            }
            arr.put(entry)
            // 超出 LIMIT 丢最老的
            while (arr.length() > LIMIT) {
                arr.remove(0)
            }
            sp.edit().putString(KEY_ENTRIES, arr.toString()).apply()
        } catch (_: Throwable) {
            /* ignore */
        }
    }

    /** 清空 ring buffer。失败静默。 */
    fun clear(context: Context) {
        try {
            context.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE)
                .edit().remove(KEY_ENTRIES).apply()
        } catch (_: Throwable) {
            /* ignore */
        }
    }

    /** 读 ring buffer 全部条目，返回 JSON 字符串（数组）。失败时返回 "[]"。 */
    fun dump(context: Context): String {
        return try {
            val raw = context.getSharedPreferences(SP_NAME, Context.MODE_PRIVATE)
                .getString(KEY_ENTRIES, "[]") ?: "[]"
            val arr = try {
                JSONArray(raw)
            } catch (_: Throwable) {
                JSONArray()
            }
            arr.toString()
        } catch (_: Throwable) {
            "[]"
        }
    }

    private fun isoNow(): String {
        // 跟前端 utils/amsgDiag.ts 对齐：ISO 8601 + ms
        return try {
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.format(java.util.Date())
        } catch (_: Throwable) {
            System.currentTimeMillis().toString()
        }
    }
}