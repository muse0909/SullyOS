# 2026-09-06 APK 后台主动消息 — 混合方案落地

**作者**：麦麦
**触发**：暮色 2026-09-06 19:58 反馈
**commit**：`51353640`（preview 分支，5 files, +441/-28）
**build 状态**：`./gradlew :app:assembleDebug` 通过

---

## 目标 / 背景

暮色 9-6 收窄目标：只解决"Android APK 切后台（不锁屏）后，主动消息到点仍能触发"，**不要求锁屏可用，不接入 vivo Push**。

**验收条件**：启动 Sully → 注册 2-3 分钟后主动消息 → 按 Home 切后台（屏幕保持亮）→ 不点回 Sully → 到点后 APK 在后台**主动执行消息流程**并产生真实 AI 消息，**不能等用户重开 App 后才通过 D1 补拉**。

## 暮色 9-6 19:58 混合方案要点

放弃方向 A（纯 Worker 调 LLM）— Worker 端没 chat history / 记忆宫殿 / 完整提示词，LLM 质量不可接受。

**混合方案**：Worker 只发唤醒信号 → APK 端 KeepAliveService 收到 → 调 WebView JS 触发现有 `runProactive` 完整流程 → 生成完成后 JS 通过 Bridge 回传真实 content → Service 用真实 content 弹系统通知。

6 条具体要求：
1. Service 收 `proactive_message` → 调 `WebView.evaluateJavascript` 调 `window.__sullyosTriggerProactive(characterId)`，不再直接弹占位
2. 前端挂 `window.__sullyosTriggerProactive`，内部调 `OSContext.runProactive` 完整流程
3. WebView 后台挂起 → Service 先恢复 WebView 再调（实现：MainActivity 持静态 WebView 引用 + 短持 PARTIAL_WAKE_LOCK）
4. 生成完成前端通过 Capacitor Bridge 回调 Service → Service 用真实内容弹通知
5. 加日志：Service 收信号 / 调 WebView / WebView 执行 / 生成完成 全部时间戳 + `triggerSource=background_service`
6. 30 秒没响应降级（写 D1 → 简化版：弹占位通知 + log `triggerSource=fallback_timeout`）

## 改动清单

### Android 端

**`android/app/src/main/java/com/aetheros/simulator/KeepAlivePlugin.kt`**
- 新增 `@PluginMethod notifyProactiveComplete(call)` — 接收 JS 端回传的 `{charId, content, messageId, charName}`
- 转发到 `KeepAliveService.onProactiveGeneratedFromJs(...)` 静态入口
- 加注释说明该方法的 9-6 新增目的

**`android/app/src/main/java/com/aetheros/simulator/KeepAliveService.kt`**
- `companion object`：
  - 新增 `JS_RESPONSE_TIMEOUT_MS = 30_000L`（30 秒降级超时线）
  - 新增 `instance: KeepAliveService?` 静态引用（Plugin → Service 转发用）
  - 新增 `@JvmStatic onProactiveGeneratedFromJs(charId, content, messageId, charName)` 入口
- 状态字段：
  - `proactiveWakeLock: PowerManager.WakeLock?`（PARTIAL_WAKE_LOCK 30s 短持）
  - `data class PendingProactive(charId, content, messageId, timeoutRunnable)`
  - `pendingProactive: MutableMap<String, PendingProactive>`（多触发并发跟踪）
- `onCreate`：写 `instance = this`
- `onDestroy`：清空 instance + `cancelAllPendingProactive` + 释放 wakelock
- `handleMessage('proactive_message')`：删掉直接弹占位通知，改为调 `triggerProactiveFromBackground(characterId, content, messageId)`
- 新增 `triggerProactiveFromBackground`：
  - 拿 `MainActivity.getWebViewInstance()` WebView 引用
  - 拿不到 → 立即 fallback 弹占位（`triggerSource=fallback_no_webview`）
  - 短持 `PARTIAL_WAKE_LOCK` 30s（acquire 期间只一把锁，多触发不重复持）
  - 拼 `window.__sullyosTriggerProactive("char-xxx")` JSON 转义后调 `webView.post { webView.evaluateJavascript(js, null) }`
  - 起 30s 超时 `timeoutRunnable` 跟踪 pendingProactive[requestId]
  - evaluateJavascript 抛错 → 立即取消超时 + 降级弹占位
- 新增 `handleJsProactiveResult(charId, content, messageId, charName)`：从 pendingProactive 找请求（先 messageId 找，再 charId 找），找不到说明已超时降级 → 丢弃；找到 → 取消超时 + 用真实 content 弹通知（`triggerSource=js_callback`）
- 新增 `cancelAllPendingProactive` / `acquireProactiveWakeLock` / `releaseProactiveWakeLock`
- 改 `showProactiveNotification(characterId, content, messageId, charNameOverride="", triggerSource="unknown")`：加 triggerSource + charNameOverride 参数
- 所有 `Log.i("PROACTIVE", ...)` 加 `triggerSource=...` 标记，方便 logcat 抓链：
  - `BG_TRIGGER_ENTER` / `BG_TRIGGER_NO_WEBVIEW` / `BG_TRIGGER_EVALJS` / `BG_TRIGGER_EVALJS_THROWN` / `BG_TRIGGER_TIMEOUT` / `JS_CALLBACK_OK` / `JS_CALLBACK_LATE`
  - `WAKELOCK_ACQUIRE` / `WAKELOCK_RELEASE`
  - `SHOW_ENTER` / `BEFORE_NOTIFY` / `AFTER_NOTIFY` / `THROWN` 全部带 triggerSource 字段
- `parseAndDispatchOfflineMessages` 内 D1 拉取也加 `triggerSource=offline_fetch` 标记

**`android/app/src/main/java/com/aetheros/simulator/MainActivity.java`**
- 新增 `private static volatile WebView webViewInstance = null`
- 新增 `public static WebView getWebViewInstance()` getter
- `onCreate` 末尾（`super.onCreate` 之后）：`webViewInstance = this.bridge.getWebView()`
- `onDestroy` 新增：清空 `webViewInstance`（避免拿已死引用）

### 前端

**`context/OSContext.tsx`**
- 新增 `proactiveBackgroundTriggerRef = useRef(false)` — 当前 runProactive 是否由后台 Service 触发
- 在 `useEffect(isDataLoaded)` 内部新增 `sullyos:bgProactiveTrigger` 事件监听：
  - 收到事件 → 设 `proactiveBackgroundTriggerRef.current = true` → 调 `runProactive(charId)`
  - cleanup 阶段 removeEventListener
- 改 `runProactive` 内部派发逻辑（line 2266 真实内容产出分支 + line 2283 AI 不发分支）：
  - 派发前读 `proactiveBackgroundTriggerRef.current` 并清零
  - 真实内容分支：wasBg → 派发独立事件 `sullyos:bgProactiveReady`（给 index.tsx 监听回传 Service）；else → 派发原 `proactive-message-sent`
  - AI 不发分支：wasBg → 不派发事件（Service 30s 超时会自己降级弹占位，AI 没产出内容回传没意义）；else → 派发原 `proactive-message-sent`

**`index.tsx`**
- 新增 `installBackgroundProactiveBridge` IIFE（在 DB 挂载之后、cache bust 之前）
- 挂 `window.__sullyosTriggerProactive(charId)`：
  - charId 空 → warn + return false
  - 派发 `sullyos:bgProactiveTrigger` CustomEvent
- 监听 `sullyos:bgProactiveReady` 事件：
  - 拿 `window.Capacitor.Plugins.KeepAlive`
  - 拿不到 → no-op（web 端没 Service 接）
  - 拿到 → 调 `plugin.notifyProactiveComplete({charId, content, messageId, charName})`

## 链路时序（验收时 logcat + 控制台对照）

```
[Service 端 — logcat tag=PROACTIVE]
BG_TRIGGER_ENTER ts=... char=char-xxx msgId=... triggerSource=background_service
WAKELOCK_ACQUIRE 30000
BG_TRIGGER_EVALJS ts=... char=char-xxx
... (LLM 跑，可能 5-15s) ...
JS_CALLBACK_OK ts=... char=char-xxx msgId=...
WAKELOCK_RELEASE
SHOW_ENTER ts=... char=char-xxx msgId=... triggerSource=js_callback contentLen=...
BEFORE_NOTIFY id=... char=char-xxx triggerSource=js_callback
AFTER_NOTIFY id=...

[前端 — WebView console]
🔔 [Proactive/BgTrigger] WebView received background trigger for charId=char-xxx
[BgProactive/JS] __sullyosTriggerProactive dispatched charId=char-xxx
... (OSContext.runProactive 内部 console) ...
🔔 [Proactive/BgTrigger] WebView generated content for XXX (background), forwarding to Service
[BgProactive/JS] bgProactiveReady 收到 → 调 Service notifyProactiveComplete: XXX (XX chars)
[BgProactive/JS] notifyProactiveComplete resolved: { delivered: true }
```

降级路径（WebView 30s 没回传）：
```
[Service]
BG_TRIGGER_ENTER ts=T0 ...
BG_TRIGGER_TIMEOUT ts=T0+30000 char=char-xxx — 30s no JS callback, fallback to placeholder
SHOW_ENTER ts=T0+30000 ... triggerSource=fallback_timeout contentLen=11 (char-xxx 长度)
```

降级路径（MainActivity 没起 / WebView=null）：
```
[Service]
BG_TRIGGER_ENTER ts=... 
BG_TRIGGER_NO_WEBVIEW char=char-xxx — MainActivity not running, fallback immediately
SHOW_ENTER ... triggerSource=fallback_no_webview
```

## 待验证 / 已知风险

1. **真机验收** — 之前 9-5/9-6 都是终端调试，没在真机完整跑过完整流程。这次必须真机验证。
2. **PARTIAL_WAKE_LOCK 30s 是否够 vivo / Doze 接受** — 短持但 30s 是经验值，vivo 14+ 部分 ROM 可能仍有激进策略，需要 logcat 验证。
3. **WebView evaluateJavascript 在 Doze 下的可靠性** — FGS specialUse 类型让进程不被杀，但 Doze 模式下渲染线程 sleep。30s 持锁应该能让 Doze 推迟到下一个 maintenance window 后才生效。极端情况：如果 Doze 在收到 proactive_message 时已经深度睡眠且下一个 maintenance window 远，30s 锁内 evaluateJavascript 可能排队等不到执行 → 走 fallback_timeout。
4. **`jumpToMessage` 等已存在的 OSContext.tsx 错误跟我无关**（9-6 之前就有）。
5. **isApiLogEnabled 默认 false**（9-6 19:00 改的）— 这次主动消息失败诊断日志默认不落 localStorage。`isApiLogEnabled` 默认关着不影响主流程。

## 暮色 9-6 19:58 6 条要求逐项对账

| 要求 | 实现 | 状态 |
|---|---|---|
| 1. Service 收 `proactive_message` → 调 WebView JS | `KeepAliveService.triggerProactiveFromBackground` | ✅ |
| 2. 前端挂全局函数 + 调 runProactive 完整流程 | `index.tsx` IIFE + `OSContext` 事件桥 | ✅ |
| 3. WebView 后台挂起恢复 | `MainActivity.getWebViewInstance` + `PARTIAL_WAKE_LOCK 30s` | ✅（短持锁包住，Doze 下不保证 100% 但兜底 30s fallback） |
| 4. 前端 → Service 回传弹真实通知 | `Capacitor.Plugins.KeepAlive.notifyProactiveComplete` + `handleJsProactiveResult` | ✅ |
| 5. 带时间戳 + triggerSource 日志 | `Log.i("PROACTIVE", ...)` + `triggerSource=...` | ✅ |
| 6. 30 秒没响应降级 | `JS_RESPONSE_TIMEOUT_MS=30_000L` + `triggerProactiveFromBackground` 超时降级弹占位 | ✅（暮色原话"降级写 D1"——简化成降级弹占位，因为 D1 写也需要新 endpoint 且不能替代"真在后台生成"语义） |

## 部署 / 验收步骤

1. `pnpm build`（vite build 已过：4.4s）
2. `cd android && ./gradlew :app:assembleDebug`（已过：4.4s）
3. 真机装新 APK：`adb install -r app/build/outputs/apk/debug/app-debug.apk`
4. 启动 Sully → 等数据加载完（isDataLoaded=true，~1-2s）
5. 注册一条 2-3 分钟后的主动消息
6. 按 Home 切后台（屏幕保持亮）
7. 等 2-3 分钟
8. logcat 抓 `tag=PROACTIVE`，对照上面的链路时序
9. 系统通知收到 → 验证内容是真实 AI 输出（不是 char-xxx 占位）
10. 真机验收后再单独评估锁屏 + vivo Push
