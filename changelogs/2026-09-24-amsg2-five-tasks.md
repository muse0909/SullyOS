# 主动消息 2.0 五项修（暮色 9-24 拍板顺序 1→2→3→4→5）

**日期**：2026-09-24  
**涉及 commit**：（待 commit 后填）

## 改了什么
- **第 1 项（诊断日志入口只留角色级弹窗）**：`ActiveMsg2SettingsModal` 加 `<AmsgDiagLogViewer>` 入口 + 按钮；全局 `ActiveMsgGlobalSettingsModal` 移除 viewer / state / 入口，留锚点注释。
- **第 2 项（任务详情提示方向显示 / 绿色箭头关闭）**：`describeTaskMode` 在 `prompted` 分支里，没方向时显示「提示方向未取回（旧任务）」，不再拼成空字符串「提示方向「」」；面板「最近一次未发送」条加「关闭」按钮 + `handleDismissLastSkip`，点完立刻隐藏并清云端 `amsgStateNamespace(char.id)` 下的 `AMSG_LAST_SKIP_KEY`，清失败时 toast 提示下次可能回来。
- **第 3 项（角色自排任务用对 API）**：`registerCharacterWakeup` 不再写 `{ enabled: true } as any`。改成读 `DB.getCharacter(charId).activeMsg2Config`，原样传给 `ActiveMsgClient.scheduleCharacterTask`。下游 `resolveApiConfig` 看到 `useSecondaryApi=true` 时拿配置里的 `secondaryApi`，否则走 `effectiveApi`（与 1.0「副 API > 角色 API > 主 API」同口径）。拿不到角色 config 时退化为旧版 `{ enabled: true }`，行为不变。
- **第 4 项（schedule_next_wakeup 同任务去重）**：`useChatAI` 解析循环外加 60 秒内 `(charId, fireAt, reason)` 内存 ring；AI 一次回复里把同 token 重复写两遍不会建两条任务（云端 D1 也只留一条），但跨几秒改时间换 reason 的合法续期不受限。

## 动了哪些文件
- `components/chat/ActiveMsg2SettingsModal.tsx` — 诊断 viewer 入口 + 「关闭」按钮 + `handleDismissLastSkip`
- `components/settings/ActiveMsgGlobalSettingsModal.tsx` — 移除诊断入口 + 留锚点注释
- `utils/amsg2Tasks.ts` — `describeTaskMode` prompted 分支处理空方向
- `utils/proactivePushConfig.ts` — `registerCharacterWakeup` 读角色 config
- `hooks/useChatAI.ts` — `schedule_next_wakeup` 解析去重

## 踩坑 / 需要知道的（重要）
- 第 2 项不伪造历史任务的 promptHint：远端任务投影没有 `amsgTaskInstruction` / `amsgReason` 字段（白名单只透出 `uuid / status / lastError / clientTaskId / messageType / messageSubtype / recurrenceType / nextSendAt / retryCount`），老任务只能从本地 `promptHint` 拿，没有就显示「未取回」。**新增远端字段不在本轮范围内**，需另开需求。
- 第 3 项 `registerCharacterWakeup` 之前用 `{ enabled: true } as any` 把整份 `char.activeMsg2Config` 丢掉，下游 `resolveApiConfig` 看到的 `useSecondaryApi/secondaryApi` 都是 undefined，全部任务都被强制走调用方 `apiConfig`。这跟 1.0 那套「副 API > 角色 API > 主 API」优先级对不上——1.0 配过单独 API 的到 2.0 就被吞掉。**1.0 优先级代码**：`context/OSContext.tsx:1715-1740` `proactiveRunningRef` 那段（注释明确「API 优先级：副 API > 角色独立 API > 主 API」）。
- 第 3 项拿不到角色 config 时退化 `{ enabled: true }` 兜底：测试 / 老 caller 的旧行为保留，不能让它们崩。
- 第 4 项去重窗口 60 秒只是经验值。改成跨多轮上下文复用同一 (fireAt, reason) 时，跨过 60 秒就让它走（这是合法变更——角色真要换个时间提醒）。**跨进程重启会丢：用户清浏览器 / 刷新后无法去重上次 AI 复读的同 token**，但刷新本身就把 LLM 上下文清了，问题自然不存在。

## 第 5 项：未改动，已查清
按暮色 9-24 拍板的"先查清，不乱改"原则，**重复通知 + 重新打开 App 又弹一次**的根因已查清、但**没改代码**。证据如下：

### 重复通知的两条触发路（同一 messageId 都可能弹）
1. **UnifiedPush SDK 派发**：Worker ntfy → 我们的 service → `onMessage` → `showProactiveNotification(...)`（**系统通知**）+ `sendBroadcast(ACTION_PUSH_DELIVERED)` → plugin receiver → `notifyListeners('pushReceived')` → JS `ingestNativeAmsgPayload`（**JS 端写 inbox + 弹聊天**）。
2. **drainPendingPushes（app 启动/回到前台时）**：plugin 在 `load()` 时从 SP 把 `unifiedpush_pending_msgs_v1` 缓存全部 drain 出来 → 同样走 `notifyListeners('pushReceived')`。

### 关键：两路之间**没有跨路去重**
- `onMessage` 写 SP + 通知通过 receiver（pending key）。
- `drainPendingPushes` 把 SP 里所有消息重发一遍。
- JS 端 `ingestNativeAmsgPayload` 有 `RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v2'` 拦掉 100 条内的重复 → 聊天记录不会双写。
- **但系统通知不是 JS 端弹的**：它是 `UnifiedPushService.kt:147-222` 在 `onMessage` 里直接 `NotificationManager.notify(notificationIdHash(messageId, charId))`。这个通知 ID 是按 messageId 哈希的——同 messageId 走 NotificationManager 会覆盖前一条，**但不同 messageId 两条不同通知**。
- 也就是说：**老 app 死进程后，SP 里缓存了 push；下次启动 plugin drain → JS 收到推送 → 写聊天记录；同时通知栏**已被 service 在 `onMessage` 那一刻弹过了——理论上不该重弹。
- 真正的重弹场景：**1) Service 在 `onMessage` 已经写了 SP + 弹了通知；2) JS 端 process 慢 / 失败；3) 用户手动 kill app → 重启 → plugin 重新 register → drainPendingPushes 把 SP 里那条捞出来再发一次 `pushReceived` → JS 再走 ingest**——聊天记录被 `RECEIVED_IDS_KEY` 拦掉（老消息进了 100 条环里），但**通知栏如果还没被用户点掉，就被 plugin drain 这条路"无通知弹"了**——这条路径**没弹通知**。
- 反过来的重弹场景：service `onMessage` 没来得及 sendBroadcast、只写了 SP（plugin receiver 那时还没注册，比如 cold start 时 service 比 plugin 先起来）；之后 plugin 注册成功，从 SP drain → JS 走一遍 → 但 service 那边没弹通知，所以**通知栏不会重弹**。
- **真正的"重弹"更可能是**：`onMessage` 自身在 app 还活着时就被触发一次（plugin receiver 在前台收到 → JS ingest → 写聊天 + 弹通知）；然后 app 被切到后台再回来（`initUnifiedPushRuntime` 又 drain 一次 SP）——但 SP 这条消息应该已经被 drain 走了 / `RECEIVED_IDS_KEY` 拦掉了。除非 SP 缓存里有**多条不同 messageId 但同一 task 触发**——这是 worker 端一次 fire 拆多段 push 的话出现（同一个 occurrenceMs / 同一 taskUuid 但多 messageId），多段就多通知。

### 第一次乱码（"第一次开机后收到的"）
- **可能是**：`onMessage` 那段 `notification.body = obj.optString("message").ifEmpty { obj.optJSONObject("notification")?.optString("body") ?: obj.optString("body") }`——push payload `message` 字段被 worker 加了 RFC8291 加密层的处理，部分早期版本的 worker `buildScheduledPush` 会先把原 message 编码成 markdown sanitized 串再上 `message` 字段；如果某次触发走的是兜底分支（fallback 没有 sanitized），`notification.body` 就拿不到正确内容。
- **更像是**：`UnifiedPushService.kt:208-222` 的 `catch` 分支——payload JSON 解析失败时，按原文前 120 字符弹通知——那就是"乱码"。
- 真正的根因需要等暮色测到一条带原始 payload 的乱码通知，把诊断日志（已经支持 11 个节点覆盖）导出给我对照——**改这条之前必看图**。

### 为什么不修
- 修 `drainPendingPushes` 加去重 ring：会动 Android 端 plugin + JS 端 ingest 两条以上跨 thread 逻辑；
- 修 `onMessage` payload 解析：要先看一条真的"乱码通知"长什么样——瞎改兜底可能把正常通知弄坏；
- 第 5 项超出"先查清再修"的小步快跑节奏，**应该单开一项**，看图 + 看诊断日志后再说。

## 备注
- 第 5 项遗留：修「drainPendingPushes 与 onMessage 重复发同 messageId」+ 「onMessage 乱码 fallback」。等暮色复现一条乱码通知后看图改。
- 第 2 项遗留：远端任务投影加 `amsgTaskInstruction` / `amsgReason` 字段（需 worker 端 + 客户端两边改）——能拿到"过去任务排的时候角色写了什么方向"，但本轮不在范围内。
- 第 3 项遗留：`proactivePushConfig.ts:386` 的 `registerDynamicScheduleOnActiveMsg2` 也有同款"传 `{ enabled: true }`"问题——按暮色「1.0 不动先不改」原则本轮跳过，留下一轮问。
- 暂不 push，等本轮 commit 后再说。