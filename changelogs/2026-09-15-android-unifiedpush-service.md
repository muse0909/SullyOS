## 拾光机 Android UnifiedPush 改用 PushService（2026-09-15）

暮色 9-15 14:00 测试反馈：
- "开启通知和推送"按钮 → 没有弹窗选 ntfy → 直接显示处理中 → 过一会儿
  提示"注册超时"，但 ntfy 那边已经建了订阅主题（`up6w887RJSthEf`）
- 同时聊天页一直弹"Cannot read properties of undefined (reading 'length')"

### 根因

第一版用了 UnifiedPush android-connector 的 `MessagingReceiver`（继承
`org.unifiedpush.android.connector.MessagingReceiver`）。3.0.0 实际架构：

```
ntfy broadcast
  ↓
SDK 自带的 MessagingReceiverImpl（exported=true + priority=-500，
                在 SDK 自己的 AndroidManifest 里注册）
  ↓
SDK 内部 bind 我们 app 注册的 PushService（继承
        org.unifiedpush.android.connector.PushService）
  ↓
我们这 4 个方法被调：onNewEndpoint / onMessage /
onRegistrationFailed / onUnregistered
```

**问题**：我之前在 app 的 manifest 里声明了自己的 UnifiedPushReceiver
（继承 MessagingReceiver），**intent-filter 跟 SDK 那个匹配**——Android
会让我们这个跑，SDK 的 MessagingReceiverImpl **根本不运行**——所以事件
没人转发给我们的 receiver——我们永远收不到 NEW_ENDPOINT。

文档说："if a receiver with this intent filter is declared in your manifest,
the one declared in the library won't run."——这话确认了我的判断。

所以：
- ✅ ntfy 收到注册请求、创建了订阅主题
- ❌ 我们的 receiver 没收到 NEW_ENDPOINT 回调
- ❌ 前端轮询 60 次 250ms 等不到 subscription，超时返回

### 修法

- 删 `UnifiedPushReceiver.kt`
- 新建 `UnifiedPushService.kt`（继承 `org.unifiedpush.android.connector.PushService`）
- AndroidManifest 把 receiver 换成 service（`exported=true` 让 SDK bind 得上）
- AmsgUnifiedPushPlugin 引用从 `UnifiedPushReceiver.*`` 改成 `UnifiedPushService.*`

### 验证

- `./gradlew :app:compileDebugKotlin` ✓
- `./gradlew :app:assembleDebug` ✓

### 还没诊断的另一个问题

聊天页一直弹 "Cannot read properties of undefined (reading 'length')"——
这是 ActiveMsgClient / 聊天发消息路径的 bug，跟 UnifiedPush 无关。看起来
是 buildSystemPrompt / sendChatRequest 时某个返回值是 undefined，代码没判
空就调 `.length`。

可能是 Worker 端没部署（sully-mush 拿不到 D1 / fetch vapi 失败）返回了空，
前端 retry 时 crash。这个跟 Worker 部署到 Cloudflare 还没做有关。

### 未触动

- Worker bundle 没部署到 Cloudflare
- Android 端 FCM 暂放
- AmsgUnifiedPushPlugin 的 VAPID 公钥格式修正（之前的 SUBSCRIPTION 里 p256dh 用了自己生成的 VAPID 公钥，但 UnifiedPush 协议这里本该是 distributor 返回的 Web Push 兼容的 p256dh，需要实际跑一遍端到端看 UnifiedPushService.onNewEndpoint 收到的 endpoint 对象长什么样再修）