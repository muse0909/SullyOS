// KeepAlivePlugin — 前后台保活控制入口（2026-08-29）
//
// 暴露 start() / stop() / notifyProactiveComplete 三个方法。
//   - start() / stop()：前后台保活服务控制
//   - notifyProactiveComplete（麦麦 2026-09-06）：WebView 跑完主动消息生成后，
//     通过这个方法把真实内容回传给 KeepAliveService，Service 用真实 content 弹系统通知
//
// 注意：
//   - start() 是幂等的 — Android 不会因重复 startForegroundService 而崩
//   - stop() 会真的停掉前台服务，可能导致 App 后台被系统杀
//   - 当前 MainActivity onCreate 已经会自动启动服务，**前端默认不要调 start()**，
//     只在 appStateChange 切回前台时调一次确认服务还活着

package com.aetheros.simulator

import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "KeepAlive")
class KeepAlivePlugin : Plugin() {

    /**
     * 启动保活前台服务（幂等）
     * Android 8+ 走 startForegroundService，KeepAliveService.onCreate
     * 内部会立即调 startForeground 满足 5 秒规则
     */
    @PluginMethod
    fun start(call: PluginCall) {
        try {
            val intent = Intent(context, KeepAliveService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            val ret = JSObject()
            ret.put("started", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("启动保活服务失败：${e.message}")
        }
    }

    /**
     * 停止保活前台服务
     */
    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            val intent = Intent(context, KeepAliveService::class.java)
            context.stopService(intent)
            val ret = JSObject()
            ret.put("stopped", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("停止保活服务失败：${e.message}")
        }
    }

    /**
     * 麦麦 2026-09-06：WebView 跑完主动消息后回传真实内容，Service 弹通知用
     *
     * 调用方：index.tsx 监听到 `proactive-message-sent` 事件后调
     * 入参：charId / content（preview 前 120 字符）/ messageId / charName
     * 出参：{ delivered: true }
     *
     * Service 端用静态方法 KeepAliveService.onProactiveGeneratedFromJs 接收，
     * 这样 Service 在自己的进程内就能处理，不依赖 Activity 前台。
     */
    @PluginMethod
    fun notifyProactiveComplete(call: PluginCall) {
        try {
            val charId = call.getString("charId", "") ?: ""
            val content = call.getString("content", "") ?: ""
            val messageId = call.getString("messageId", "") ?: ""
            val charName = call.getString("charName", "") ?: ""
            if (charId.isEmpty() || content.isEmpty()) {
                call.reject("charId/content 不能为空")
                return
            }
            KeepAliveService.onProactiveGeneratedFromJs(charId, content, messageId, charName)
            val ret = JSObject()
            ret.put("delivered", true)
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("notifyProactiveComplete 失败：${e.message}")
        }
    }
}
