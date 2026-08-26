# 2026-08-26 角色查手机 — P0 第 1 步：Capacitor 原生插件

暮色 2026-08-26 决定做"角色查手机"功能：让 AI 角色（江澈）能查询暮色的手机使用情况，用于主动关心（催休息、催喝水、判断在忙什么）。

## 暮色需求规格

暮色 8-26 18:12 给的完整实现指令（已落地 commit 1）：

> 目标：让 AI 角色（江澈）能查询暮色的手机使用情况
> 架构：Capacitor 原生插件（Android/Kotlin），前端注册为 LLM function calling 工具

## 拆分 4 commit

按 8-20 那条 memory "一次改太大易炸" 原则，暮色选**按 4 commit 拆**：

1. **commit 1（本 commit）**：Capacitor plugin Kotlin 骨架 + 4 个方法 + 集成文档
2. **commit 2**：前端 Capacitor 桥 + `get_phone_usage` 工具 schema + useChatAI dispatch（current_app 链路）
3. **commit 3**：扩展 4 个 type + 设置页 toggle + 权限引导 UI
4. **commit 4**：AI prompt 补充（P1）

P2 持续监听 + 阈值主动关心，**下周**做。

## 这次落地内容

### Kotlin 插件（`native-plugins/PhoneUsagePlugin/android/PhoneUsagePlugin.kt`）

`@CapacitorPlugin(name = "PhoneUsage")`，package `com.aetheros.simulator`（**跟 MainActivity 同 package**）。

暴露 6 个方法：

| 方法 | 用途 | 返回 |
|---|---|---|
| `checkPermission()` | 是否开了 `PACKAGE_USAGE_STATS` | `{ granted: boolean }` |
| `requestPermission()` | 跳"使用情况访问"设置页 | - |
| `getCurrentApp()` | 当前前台 app | `{ packageName, appName, timestamp }` |
| `getAppUsageToday()` | 今日各 app 时长 top 10（非系统） | `{ apps: [{ appName, packageName, minutes }] }` |
| `getTotalScreenTimeToday()` | 今日总屏幕时间 + 解锁次数 | `{ totalMinutes, unlockCount }` |
| `getRecentApps({limit})` | 最近切换的 N 个 app（去重） | `{ apps: [{ appName, packageName, switchedAt }] }` |

### 关键实现点

1. **`PACKAGE_USAGE_STATS` 是特殊权限**——不能在 AndroidManifest 申请，必须跳设置页让用户手动开
2. **Android 10+ 用 `unsafeCheckOpNoThrow`**（旧 `checkOpNoThrow` 已 deprecated）
3. **系统 app 过滤**——`FLAG_SYSTEM` / `FLAG_UPDATED_SYSTEM_APP` + 常见白名单（launcher / systemui / settings / permissioncontroller 等）
4. **不持续监听**——按需查，AI 调一次查一次，省电
5. **不依赖 AccessibilityService**——只用 `UsageStatsManager`，无需后台 service

### 集成文档（`native-plugins/PhoneUsagePlugin/INTEGRATION.md`）

3 步集成：
1. `cp` Kotlin 文件到 `android/app/src/main/java/com/aetheros/simulator/`
2. 在 `MainActivity` 的 `onCreate` 加 `registerPlugin(PhoneUsagePlugin.class)`
3. AndroidManifest **不**用加权限

带验证步骤（Console 跑 `Capacitor.Plugins.PhoneUsage.checkPermission()`）和已知坑表。

## 暮色下一步

1. **跑 `npx cap add android`**（如果还没跑过）— 生成 `android/` 目录
2. **按 `INTEGRATION.md` 集成** — 3 步
3. **Android Studio 编译** — 验证 Kotlin 代码
4. **真机/模拟器跑权限流程** — 验证 4 个方法能调
5. 编译/跑通后告诉麦麦，commit 2 开干（前端 + mock 链路）

## 关联

- 8-20 memory：改协议层拆 4 步（一次大改易炸）
- 7-31 memory：AI 感知 system 消息分类（情侣空间/主动行为 ✅，技术状态 ❌）— "手机使用" 算用户行为，**可以**主动引用
- 8-02 memory：英文专业词翻译 — 后面跟暮色讲 Kotlin / UsageStats 时要翻成"前台应用"/"使用情况统计"等
