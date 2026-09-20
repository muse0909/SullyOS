# 2026-09-19 bg 触发 chat UI 刷新 + 通知覆盖修复

## 问题

暮色 9-19 22:20 反馈 schedule_next_wakeup 测试现象：

1. 通知栏弹系统通知，但通知内容仍是 `char-1784463346142`（应是 AI 真实回复）
2. 点进聊天页面后会出现"麦麦正在写新消息"，持续一会儿后消失
3. 真实主动消息最终确实生成并保存了，但**当前聊天页面不会立即显示**
4. 返回桌面再重新进入后，之前生成的消息才出现

## 根因（暮色 22:20 拍板排查后静态审计 + logcat 双重确认）

### A. 消息实际生成/保存 ✅ 正常

- `OSContext.tsx:2268` / `:2243` 调 `DB.saveMessage({role: 'assistant', type: 'text', metadata: {isProactive: true}})` → IndexedDB
- "麦麦正在写新消息" 出现 → 消失 = `proactiveComposingChars` set → 清掉 = runProactive 完整跑通

### B. 聊天 UI 刷新 ❌ 阻塞：bg 触发不接 chat UI 刷新机制

- `Chat.tsx:1049` 是 chat 重读 messages 的**唯一被 proactive 事件触发的** trigger（`useEffect([lastMsgTimestamp])`）
- `lastMsgTimestamp` 只在 `OSContext.tsx:1401` 的 `proactive-message-sent` handler 里被 set
- `runProactive` bg 触发末尾（`OSContext.tsx:2298-2309`）**只派发 `sullyos:bgProactiveReady`，不派发 `proactive-message-sent`**（设计上为"防双弹"）
- → `lastMsgTimestamp` 不变 → `Chat.tsx:1049` useEffect 不触发 → `reloadMessages` 不跑 → 当前 chat UI 不刷新
- 用户返回桌面再重进 chat = Chat.tsx 重 mount → `useEffect([activeCharacterId])` 重跑 → reloadMessages → 看到新消息

### C. 系统通知内容 ❌ 阻塞：LLM > 30s, JS callback 晚到, pending 已被 remove

logcat 21:50:41 完整事件链验证：
```
21:50:11 前后  BG_TRIGGER_TIMEOUT 触发 → pendingProactive.remove → 弹 charId 占位通知 (notificationId=hash(messageId, charId))
21:50:41.108  [Proactive/BgTrigger] WebView generated content (runProactive 跑完)
21:50:41.108  [BgProactive/JS] bgProactiveReady 收到 → 调 notifyProactiveComplete (真实 content=preview)
21:50:41.146  notifyProactiveComplete resolved
21:50:41.146  JS_CALLBACK_LATE ... no pending (timeout already fired), drop   ← handleJsProactiveResult:789
```

LLM 耗时 > 30s → `BG_TRIGGER_TIMEOUT` 已删 pendingProactive → JS callback 到达时 `pendingProactive.remove(messageId) ?: firstOrNull { charId == charId }` 都找不到 → drop → 用户看到的是 30s 时刻弹的 charId 占位通知。

## 修复（最小改动，2 处）

### 改 1：`context/OSContext.tsx:2300-2309` 加 `setLastMsgTimestamp`

bg 触发末尾，dispatch `sullyos:bgProactiveReady` 之前**额外调一次** `setLastMsgTimestamp(Date.now())`。

```diff
  if (wasBg) {
      console.log(`🔔 [Proactive/BgTrigger] WebView generated content for ${char.name} (background), forwarding to Service`);
+     // 复用 OSContext:1401 那条 lastMsgTimestamp 链路，让 Chat.tsx:1049 useEffect 触发 reloadMessages
+     // 不派发 proactive-message-sent（会重复弹通知 + setUnreadMessages + addToast）
+     setLastMsgTimestamp(Date.now());
      window.dispatchEvent(new CustomEvent('sullyos:bgProactiveReady', {
          detail: { charId, charName: char.name, body: preview, triggerSource: 'background_service' }
      }));
  } else {
      ...
  }
```

为什么不全派发 `proactive-message-sent`：
- `OSContext:1397` handler 会跑 `sendProactiveNativeNotification` + Web Notification + `setUnreadMessages` + `addToast`
- 会**重复弹系统通知**（`index.tsx:66` 已经走 Service 通道弹了一条）
- bg 路径只需要 setLastMsgTimestamp 一个效果，单独 setState 副作用最小

### 改 2：`android/app/src/main/java/com/aetheros/simulator/KeepAliveService.kt:710-734` timeout 不立即 remove pending

`timeoutRunnable` 触发时改 `pendingProactive.remove(requestId)` → `pendingProactive[requestId]`，pending 留在 map 里让后续 JS callback 仍能找到。

```diff
- // 4) 30s 超时：到点如果 pendingProactive 还在 → 降级
+ // 4) 30s 超时：到点如果 pendingProactive 还在 → 降级（pending 不删，让 JS callback 仍能找到）
  val requestId = messageId.ifEmpty { "${characterId}_${ts}" }
  val timeoutRunnable = Runnable {
-     val pending = pendingProactive.remove(requestId)
+     val pending = pendingProactive[requestId]
      if (pending != null) {
-         Log.w("PROACTIVE", "BG_TRIGGER_TIMEOUT ... — 30s no JS callback, fallback to placeholder")
+         Log.w("PROACTIVE", "BG_TRIGGER_TIMEOUT ... — 30s no JS callback, show placeholder (pending kept for late JS callback)")
          showProactiveNotification(
              pending.charId,
              content.ifEmpty { pending.charId },
              pending.messageId,
              triggerSource = "${pending.scheduleType}_fallback_timeout"
          )
          if (pending.messageId.isNotEmpty()) markMessageSeen(pending.messageId)
      }
      ...
  }
```

`handleJsProactiveResult` (line 782-802) 不动 —— 它原本就支持 `firstOrNull { charId == charId }` 兜底找 pending。

## 修后行为

### 场景 1 — LLM < 30s（正常情况）
1. `triggerProactiveFromBackground` → BG_TRIGGER_EVALJS → JS dispatchEvent bgProactiveTrigger
2. OSContext 监听收到 → runProactive → DB.saveMessage → `setLastMsgTimestamp` → 派发 bgProactiveReady
3. Chat.tsx:1049 useEffect 触发 → reloadMessages → **chat UI 立即看到新消息** ✅
4. JS 派发 bgProactiveReady → index.tsx:66 → notifyProactiveComplete → Service handleJsProactiveResult → showProactiveNotification(真实 content) → **通知栏弹真实内容** ✅
5. handleJsProactiveResult 找到 pending → remove pending

### 场景 2 — LLM > 30s
1. 30s 触发 BG_TRIGGER_TIMEOUT → showProactiveNotification(charId 占位, notificationId=hash(messageId, charId)) → pending 留在 map
2. LLM 返回 → runProactive 跑完 → setLastMsgTimestamp → 派发 bgProactiveReady
3. Chat.tsx reloadMessages → **chat UI 立即看到新消息** ✅
4. notifyProactiveComplete → handleJsProactiveResult → firstOrNull { charId } 找 pending → **showProactiveNotification(content=真实, notificationId 同上)** → **覆盖占位通知** ✅
5. 用户最终看到真实通知 + chat UI 立即刷新

### 场景 3 — LLM 永久 hang + Service 不死
- pendingProactive 累积 1 条 → Service onDestroy 时 `cancelAllPendingProactive` (line 808) 清空
- OS 进程被杀也会清（OS 层面兜底）
- markMessageSeen 幂等（line 937 Set.add 幂等）

## 副作用检查（暮色 9-19 22:33 限制）

| 要求 | 满足 |
|---|---|
| 不修改 schedule_next_wakeup 入口 | ✅ |
| 不修改 1.0 Worker 调度链 | ✅ |
| 不修改 VAPID / UnifiedPush | ✅ |
| 不改变普通前台主动消息逻辑 | ✅ else 分支不动；前台 triggerAI 不调 triggerProactiveFromBackground |
| 不改变 AMSG2_ENABLED | ✅ |
| 不重复生成/保存消息 | ✅ setLastMsgTimestamp 只触发 reloadMessages（只读 DB + setMessages） |
| 不重复弹系统通知 | ✅ 不派发 proactive-message-sent |
| bgProactiveReady 保留 | ✅ |

## 文件改动汇总

- `context/OSContext.tsx` — 加 1 行 `setLastMsgTimestamp(Date.now())` + 4 行注释
- `android/app/src/main/java/com/aetheros/simulator/KeepAliveService.kt` — 改 `pendingProactive.remove(requestId)` → `pendingProactive[requestId]` + 改 log 文案 + 加 6 行注释
- 其他文件未动

## 待验证

APK 重装后：
- A: bg 触发完成后当前 chat UI 立即看到新消息（不需返回桌面再重进）
- C: LLM > 30s 时通知栏占位通知被真实通知覆盖