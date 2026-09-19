# UnifiedPush 端到端补完整 — 通知栏 + Chat 自动刷新

**时间**：2026-09-19 12:00
**操作**：麦麦
**分支**：master（apk 跑 master）
**暮色拍板**：方案 A，跟 1.0 KeepAliveService 一样完整

## 背景

暮色 2026-09-19 09:55 反馈两个 2.0 主动消息 bug：

1. **通知栏不弹** — 主动消息到了前端，但系统通知栏没提醒。
2. **Chat 不自动刷新** — 聊天页已打开时不显示，需要手动发消息或切换才能看到。

正常的回复消息（用户发消息→AI 回复）走 WebSocket 没问题，所以诊断收窄到 **2.0 UnifiedPush 通道**。

## 根因（三层叠加 bug）

| 层级 | 代码位置 | 现状 |
|---|---|---|
| 1. Kotlin Service 不弹通知 | `UnifiedPushService.kt:91 onMessage` | `notifyAmsg2PushReceived()` 是空实现（line 131-138 注释说"留空"） |
| 2. Service 不给前端派事件 | 同上 + `AmsgUnifiedPushPlugin.kt` | Service 不调 `Plugin.notifyListeners('pushReceived', ...)`；Service 也拿不到 BridgeActivity 实例（注释提过） |
| 3. 前端 init 函数从未被调 | `utils/unifiedPushRuntime.ts:13 initUnifiedPushRuntime` | grep 全项目——这个函数只在自己文件 self-import，**没有任何 import 它的调用点**。`drainPendingPushes` 不跑，SP 缓存永远不被前端拉走 |

主动消息走 UnifiedPush 路径因为这三条 bug 同时存在，整条管道没接通。之前能"收到"是巧合走的 SW/Web Push 路径（sully-os.vercel.app 上的 SW `public/sw-keep-alive.js:280` 处理 push 时会同时调 `showNotification` + 写 inbox DB + 通知页面），跟 UnifiedPush 无关。

## 改动清单

### 1. `android/app/src/main/java/com/aetheros/simulator/UnifiedPushService.kt`

- `onMessage` 重写：
  - 解析 payload JSON → 拿 `contactName`/`charName`/`title`（title 优先级）、`message`/`body`/`notification.body`（body 优先级）、`metadata.charId`、`messageId`
  - `showProactiveNotification(...)` 弹系统通知（NotificationCompat.Builder，点击回 launcher）
  - `deliverPushToPlugin(payload)` 通过 `sendBroadcast(ACTION_PUSH_DELIVERED)` 派发给 plugin receiver
  - `appendPendingMessage(...)` 缓存到 SP 兜底（receiver 没注册时下次启动 drain）
- 新加 `ensureNotificationChannel()` — Android 8+ 必需，channel id `amsg2_unifiedpush_v1`（跟 1.0 通道区分）
- 新加 `showProactiveNotification(...)` — 跟 1.0 `KeepAliveService.showProactiveNotification` 算法一致（content intent 回 launcher、PRIORITY_HIGH、autoCancel）
- 新加 `deliverPushToPlugin(...)` — `Intent(...).apply { putExtra + setPackage(packageName) }`
- 新加 companion 字段：`NOTIFICATION_CHANNEL_ID/_NAME`、`ACTION_PUSH_DELIVERED`、`EXTRA_PAYLOAD`
- 修复一处历史 typo（`endpoint.pubKeySet?.pubKeySet?.auth` — 多写了一次 `pubKeySet`）

### 2. `android/app/src/main/java/com/aetheros/simulator/AmsgUnifiedPushPlugin.kt`

- 新加 imports：`BroadcastReceiver` / `Context` / `Intent` / `IntentFilter` / `Build`
- 新加内部 `pushReceiver`（对象表达式继承 `BroadcastReceiver`）：
  - 监听 `UnifiedPushService.ACTION_PUSH_DELIVERED`
  - 收到后构造 `JSObject { payload, receivedAt }` 调 `notifyListeners("pushReceived", jsObj)` 派给 JS
- 新加 `load()` override：调 `registerPushReceiver()` 在 Activity 起来时一次注册
- 新加 `handleOnDestroy()` override：`context.unregisterReceiver(pushReceiver)`
- 新加 `registerPushReceiver()` helper：
  - Android 13+（TIRAMISU）强制 `RECEIVER_NOT_EXPORTED` flag（防外部 app 触发）
  - `< 13` 用旧式 registerReceiver

### 3. `index.tsx`

- 加 `import { initUnifiedPushRuntime } from './utils/unifiedPushRuntime';`
- 在 `KeepAlive.init().then(...)` 内 `void ActiveMsgRuntime.init()` 后加 `void initUnifiedPushRuntime();`
- 启动时同时跑三件事：
  - 注册 `pushReceived` listener（实时：Service → broadcast → receiver → JS → ingest）
  - 注册 `notificationTapped` listener（用户点通知跳到对应角色 chat）
  - `drainUnifiedPushMessages()` 拉走 SP 残留（app 被杀重启后补漏）

### 没动的部分

- AndroidManifest.xml — 不需改 manifest。BroadcastReceiver 是 plugin 内 registerReceiver，用 `Context.RECEIVER_NOT_EXPORTED` 限定包内（不需要在 manifest 注册）
- worker/amsg/src — worker 已经发对 `notification: {title, body}` 字段，不需要改
- Web Push 路径（SW）— 已完整工作，不动

## 不动的事（暮色明确）

- 1.0 KeepAliveService 不动
- SW 路径（公共/sw-keep-alive.js）不动
- 2.0 任务状态机（schedule_next_wakeup 这套）不动

## 验证

- `./gradlew :app:compileDebugKotlin` — ✅ BUILD SUCCESSFUL in 9s（Kotlin 编译过）
- `npx vite build` — ✅ 4.64s，新指纹 `index.DMkqTSn_.js`
- `npx cap sync android` — ✅ 同步 OK

## 风险点

1. **首次启动 receiver 还没注册** — `registerPushReceiver` 在 `load()` 时跑，**只有 Activity 起来时跑一次**。如果推送到达时 app 完全没启动（比如 ntfy 后台唤醒新装的 app），receiver 不在，**靠 SP 缓存兜底**——重启后 initUnifiedPushRuntime drain。这种情况罕见（用户通常已经点过 app 进过 launcher）。
2. **Capacitor 6 plugin 跨进程** — pushReceiver 跟 Service 是同一个进程，sendBroadcast 同进程内不必实际发 OS broadcast，但 IntentFilter 还是必须注册（Capacitor 内部用 LocalBroadcastManager）。**实测后再确认**。
3. **Channel 权限** — Android 13+ 弹通知需要用户授权 `POST_NOTIFICATIONS` 权限（已在 manifest 声明但需用户首次启动时手动允许）。老版本（<13）默认允许。

## 测试方法

1. pull + 重新打 APK（`./gradlew assembleDebug` 或 Android Studio）
2. 装到手机，确保 app 在前台 + 在 chat 页跟某角色聊
3. 让云端 worker 触发 `proactive-wake` 推送（或者发即时对话定时任务）
4. 预期：
   - 系统通知栏出现"XX 主动发来了一条"通知（带消息 body）
   - 点通知回 app 切到对应角色 chat 页
   - 不用切页时直接在原 chat 页看到 AI 主动消息冒出来（消息列表不刷新 = bug）
