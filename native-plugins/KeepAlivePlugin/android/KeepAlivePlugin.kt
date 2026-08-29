// KeepAlivePlugin — 前后台保活控制入口（2026-08-29）
//
// 暴露 start() / stop() 两个方法，让前端可以在 App 切回前台时确保
// KeepAliveService 还活着。MainActivity 8-27 已在 onCreate 直启了服务，
// 这个插件只是"兜底重启"用的。
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
}
