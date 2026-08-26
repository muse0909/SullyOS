// PhoneUsagePlugin — 角色查手机 Capacitor 插件（2026-08-26）
// 暮色 2026-08-26 项目"角色查手机" — P0 第 1 步
//
// 暴露 4 个方法 + 2 个权限方法：
//   - getCurrentApp()           当前前台 app
//   - getAppUsageToday()        今日各 app 时长（top 10，非系统 app）
//   - getTotalScreenTimeToday() 今日总屏幕时间 + 解锁次数
//   - getRecentApps({limit})    最近切换的 N 个 app（去重，倒序）
//   - checkPermission()         是否开了 PACKAGE_USAGE_STATS
//   - requestPermission()       跳"使用情况访问"设置页
//
// 权限：PACKAGE_USAGE_STATS 是特殊权限，不能在 AndroidManifest 申请，
//   必须通过 Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS) 让用户手动开。
//
// 数据源：UsageStatsManager（系统级，Android 5.0+ 都支持）
//
// 注意：插件是只读，不开后台 service，不持续监听 — 按需查
//   （P2 阈值主动关心是另外的 service 思路）

package com.aetheros.simulator

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.Calendar

@CapacitorPlugin(name = "PhoneUsage")
class PhoneUsagePlugin : Plugin() {

    private val usageStatsManager: UsageStatsManager by lazy {
        context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    }

    private val packageManager: PackageManager by lazy {
        context.packageManager
    }

    // ==================== 权限相关 ====================

    /**
     * 检查是否有 PACKAGE_USAGE_STATS 权限
     * 该权限是特殊权限，运行时无法直接获取，需要用户手动去设置开启
     */
    @PluginMethod
    fun checkPermission(call: PluginCall) {
        val granted = hasUsageStatsPermission()
        val ret = JSObject()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    /**
     * 跳转到"使用情况访问权限"设置页
     * 用户需要在该页找到 SullyOS 手动开启
     */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("无法跳转到权限设置页：${e.message}")
        }
    }

    // ==================== 数据查询 ====================

    /**
     * 当前前台 app
     * 返回 { packageName, appName, timestamp }
     *
     * 实现：queryEvents 取最近 60 秒内最近的 MOVE_TO_FOREGROUND 事件
     * 不用 AccessibilityService（避免后台 service 的电量成本）
     */
    @PluginMethod
    fun getCurrentApp(call: PluginCall) {
        if (!hasUsageStatsPermission()) {
            call.reject("无 PACKAGE_USAGE_STATS 权限")
            return
        }

        try {
            val now = System.currentTimeMillis()
            // 查最近 60 秒 — 短一点减少事件流
            val events = usageStatsManager.queryEvents(now - 60_000L, now)
            val event = UsageEvents.Event()
            var lastForegroundTime = 0L
            var lastPackageName = ""

            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    if (event.timeStamp > lastForegroundTime) {
                        lastForegroundTime = event.timeStamp
                        lastPackageName = event.packageName
                    }
                }
            }

            if (lastPackageName.isEmpty()) {
                call.reject("未检测到最近的前台 app（最近 60 秒内无应用切换事件）")
                return
            }

            val ret = JSObject()
            ret.put("packageName", lastPackageName)
            ret.put("appName", getAppName(lastPackageName))
            ret.put("timestamp", lastForegroundTime)
            call.resolve(ret)
        } catch (e: SecurityException) {
            call.reject("无 PACKAGE_USAGE_STATS 权限：${e.message}")
        } catch (e: Exception) {
            call.reject("查询失败：${e.message}")
        }
    }

    /**
     * 今日各 app 使用时长
     * 返回 { apps: [{ appName, packageName, minutes }] }
     *
     * 实现：queryUsageStats(INTERVAL_DAILY, todayStart, now)
     * 过滤系统 app + launcher，按时长降序，取 top 10
     */
    @PluginMethod
    fun getAppUsageToday(call: PluginCall) {
        if (!hasUsageStatsPermission()) {
            call.reject("无 PACKAGE_USAGE_STATS 权限")
            return
        }

        try {
            val (startTs, _) = todayRange()
            val now = System.currentTimeMillis()

            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startTs,
                now
            )

            val apps = stats
                .filter { it.totalTimeInForeground > 0 }
                .filter { !isSystemApp(it.packageName) }
                .sortedByDescending { it.totalTimeInForeground }
                .take(10)
                .map { usage ->
                    val app = JSObject()
                    app.put("appName", getAppName(usage.packageName))
                    app.put("packageName", usage.packageName)
                    app.put("minutes", usage.totalTimeInForeground / 60_000L)
                    app
                }

            val ret = JSObject()
            ret.put("apps", JSArray(apps))
            call.resolve(ret)
        } catch (e: SecurityException) {
            call.reject("无 PACKAGE_USAGE_STATS 权限：${e.message}")
        } catch (e: Exception) {
            call.reject("查询失败：${e.message}")
        }
    }

    /**
     * 今日总屏幕时间 + 解锁次数
     * 返回 { totalMinutes, unlockCount }
     *
     * 实现：
     *   - 屏幕时间 = 所有非系统 app 时长汇总
     *   - 解锁次数 = queryEvents 数 KEYGUARD_HIDDEN
     */
    @PluginMethod
    fun getTotalScreenTimeToday(call: PluginCall) {
        if (!hasUsageStatsPermission()) {
            call.reject("无 PACKAGE_USAGE_STATS 权限")
            return
        }

        try {
            val (startTs, _) = todayRange()
            val now = System.currentTimeMillis()

            // 屏幕时间
            val stats = usageStatsManager.queryUsageStats(
                UsageStatsManager.INTERVAL_DAILY,
                startTs,
                now
            )
            val totalMs = stats
                .filter { it.totalTimeInForeground > 0 }
                .filter { !isSystemApp(it.packageName) }
                .sumOf { it.totalTimeInForeground }

            // 解锁次数
            val events = usageStatsManager.queryEvents(startTs, now)
            val event = UsageEvents.Event()
            var unlockCount = 0
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.KEYGUARD_HIDDEN) {
                    unlockCount++
                }
            }

            val ret = JSObject()
            ret.put("totalMinutes", totalMs / 60_000L)
            ret.put("unlockCount", unlockCount)
            call.resolve(ret)
        } catch (e: SecurityException) {
            call.reject("无 PACKAGE_USAGE_STATS 权限：${e.message}")
        } catch (e: Exception) {
            call.reject("查询失败：${e.message}")
        }
    }

    /**
     * 最近切换的 N 个 app（去重，按 switchedAt 倒序）
     * 返回 { apps: [{ appName, packageName, switchedAt }] }
     *
     * 实现：queryEvents 倒序取最近 24 小时内的 MOVE_TO_FOREGROUND
     *   相邻同 app 算一次切换（去重）
     *
     * 参数：limit（默认 5）
     */
    @PluginMethod
    fun getRecentApps(call: PluginCall) {
        if (!hasUsageStatsPermission()) {
            call.reject("无 PACKAGE_USAGE_STATS 权限")
            return
        }

        // getInt 返回 Int?，兜底默认 5（虽然 spec 默认值是 5，但 Kotlin 签名是 nullable）
        val limit = call.getInt("limit", 5) ?: 5

        try {
            val now = System.currentTimeMillis()
            // 查最近 24 小时
            val events = usageStatsManager.queryEvents(
                now - 24L * 60L * 60L * 1000L,
                now
            )
            val event = UsageEvents.Event()

            // 用 List 收集所有切换（按事件流顺序）
            val switches = mutableListOf<Pair<String, Long>>()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
                    switches.add(event.packageName to event.timeStamp)
                }
            }

            // 按时间倒序 + 去重
            val seen = mutableSetOf<String>()
            val result = mutableListOf<JSObject>()
            for ((pkg, ts) in switches.sortedByDescending { it.second }) {
                if (pkg !in seen) {
                    seen.add(pkg)
                    val app = JSObject()
                    app.put("appName", getAppName(pkg))
                    app.put("packageName", pkg)
                    app.put("switchedAt", ts)
                    result.add(app)
                    if (result.size >= limit) break
                }
            }

            val ret = JSObject()
            ret.put("apps", JSArray(result))
            call.resolve(ret)
        } catch (e: SecurityException) {
            call.reject("无 PACKAGE_USAGE_STATS 权限：${e.message}")
        } catch (e: Exception) {
            call.reject("查询失败：${e.message}")
        }
    }

    // ==================== 私有辅助 ====================

    /**
     * 检查 PACKAGE_USAGE_STATS 权限
     * Android 10+ 用 unsafeCheckOpNoThrow（旧 checkOpNoThrow 已弃用）
     */
    private fun hasUsageStatsPermission(): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * 是否系统 app（launcher / systemui / 设置等）
     * 过滤掉这些 — 它们不计入"用户实际使用"
     */
    private fun isSystemApp(packageName: String): Boolean {
        // 常见系统 app 白名单（不管 flag，都排除）
        val sysPackages = setOf(
            "com.android.systemui",
            "com.android.launcher3",
            "com.android.launcher",
            "com.google.android.launcher",
            "com.android.settings",
            "com.android.permissioncontroller",
            "com.android.shell",
            "com.android.keyguard",
            "com.android.providers.settings",
            "com.google.android.permissioncontroller",
        )
        if (packageName in sysPackages) return true

        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            // FLAG_SYSTEM 是真系统 app，FLAG_UPDATED_SYSTEM_APP 是原系统但被升级过
            // 两者都算"系统级"，过滤掉
            (appInfo.flags and (ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0
        } catch (e: PackageManager.NameNotFoundException) {
            // 找不到的包当系统 app 过滤
            true
        }
    }

    /**
     * 包名 → 显示名（app label）
     * 找不到时返回包名
     */
    private fun getAppName(packageName: String): String {
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString()
        } catch (e: PackageManager.NameNotFoundException) {
            packageName
        }
    }

    /**
     * 今日 0 点 ~ now 的时间戳
     */
    private fun todayRange(): Pair<Long, Long> {
        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        cal.set(Calendar.MILLISECOND, 0)
        return cal.timeInMillis to System.currentTimeMillis()
    }
}
