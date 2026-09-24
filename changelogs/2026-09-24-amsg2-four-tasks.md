# 主动消息 2.0 顺序处理 4 项（暮色 9-24 拍板 1→2→3→4）

**日期**：2026-09-24  
**涉及 commit**：`4ff3e194` `9c53e760` `456aac9c`

## 第 1 项：修复主动消息重复设定 — 任务级去重
**已查清**：schedule_next_wakeup token 解析→`registerCharacterWakeup`→`ActiveMsgClient.scheduleCharacterTask`→远端 D1 + 本地落账。worker 端只判 uuid 撞车（`reason: 'duplicate'`），**不判 (charId, fireAt)**；客户端 60 秒内存 ring 只能防同一回复复读，跨轮 / 跨 token 入口失效。

**改动位置**：`utils/activeMsgClient.ts` scheduleCharacterTask 入口查一次远端 `listRemoteTasksForChar`，按绝对时刻 ±60 秒比对，未触发的同 (charId, fireAt) 已存在时 **source='character' 复用不新建**（命中打 `wakeup-dedup-hit` 诊断日志）；source='manual' 不去重——用户面板排的是主动行为优先级最高。60 秒窗是 cron 整分对齐 + 跨进程时钟漂移的容差，不是去重基准。

**commit `4ff3e194`**（51 行净增）

## 第 2 项：用户发消息 → 取消 character wakeup
**已查清**：现有 `cancelDynamicScheduleOnWorker` 只走 1.x `/cancel-dynamic-schedule`，schedule_next_wakeup 9-17 之后走的是 2.0 amsg 通道，老接口碰不到——这是暮色报"已应该取消的任务 Worker 继续执行触发"的根因。

**改动位置**：
- `utils/activeMsgClient.ts` 新加 `cancelCharacterWakeups(char)`：本地 `char.activeMsg2Config.tasks` 过滤 `source='character' + status='scheduled' + isPendingTask`，逐条走 `cancelTask`（同面板取消同一条 2.0 cancelTask 路径），成功打 `wakeup-cancelled-by-user-message` 诊断日志。
- `apps/Chat.tsx` `handleSendText` 在 `DB.saveMessage` 之后 `cancelDynamicScheduleOnWorker` 旁边 fire-and-forget 调 `ActiveMsgClient.cancelCharacterWakeups(char)`，失败静默。

**为什么用本地 tasks 判定来源**：远端投影白名单不透出 `amsgSource` / `amsgSelfScheduled`，本地是 source 唯一权威；本地落后于远端时 cancelTask 远端回 404 alreadyGone 也走幂等路径。

**本地账本短期不一致**：远端成功但本地 tasks 记录没立即清——等下次面板打开对账时 `pruneFiredTasks` 按 `knownRemoteUuids` 移走。不强求同步避免阻塞消息保存。

**commit `9c53e760`**（78 行净增）

## 第 3 项：角色页"关闭主动消息" → 已有未触发任务也不能继续触发
**已查清**：
- 关闭开关（`handleToggleEnabled` 关方向）**不**就地落盘——按设计必须走底部"关闭 2.0"按钮（注释明确）。该按钮走 `handleSubmit`，里面有 `if (!enabled)` 分支调 `cancelAllTasksForChar`（远端清单优先），已经覆盖"已有任务取消"。
- Worker 端 `selfScheduleEnabled` 只控制 fire 里能不能调工具，**不**拦到点 fire 触发。
- 真正漏掉的：**新任务不该被创建**——`scheduleCharacterTask` / `registerCharacterWakeup` / 工具桥 `handleSchedule` 三个入口都没查 enabled。

**改动位置**：
- `utils/activeMsgClient.ts` `scheduleCharacterTask` 加 `enabledOverride` 参数，入口第一行做闸：`!charEnabled` → throw。
- 三个入口都传 `enabledOverride`：
  - `components/chat/ActiveMsg2SettingsModal.tsx` handleSubmit：`enabledOverride: enabled`
  - `utils/amsg2ToolBridge.ts` handleSchedule：`isAmsg2EnabledForChar(char)`
  - `utils/proactivePushConfig.ts` registerCharacterWakeup：`isAmsg2EnabledForChar(storedChar)`

**对 worker 的态度**：worker 端不在本轮范围（暮色 9-17 拍板不动）。关闭态的硬拦截必须在客户端做。

**commit `456aac9c`**（45 行净增）

## 第 4 项：重复通知 + 第一条乱码 — **未改**
按暮色 9-24 拍板："暂时不要修改" + "等前面 3 项完成后，再利用已有诊断日志抓一条真实案例"。

### 已查清的状态（不是结论，等真实 trace）

**重复通知的两条触发路**：
1. **UnifiedPush SDK 派发**：Worker ntfy → service → `onMessage` → `showProactiveNotification(...)`（**系统通知**）+ `sendBroadcast(ACTION_PUSH_DELIVERED)` → plugin receiver → `notifyListeners('pushReceived')` → JS `ingestNativeAmsgPayload`（**JS 端写 inbox**）。
2. **drainPendingPushes**（app 启动/回到前台时）：plugin 在 `load()` 时把 SP 里 `unifiedpush_pending_msgs_v1` 全 drain → `notifyListeners('pushReceived')`。

**两路之间**没有跨路去重：
- JS `ingestNativeAmsgPayload` 用 `RECEIVED_IDS_KEY = 'amsg2_native_received_ids_v2'`（100 条 ring）拦掉了**聊天记录双写**。
- **系统通知**走 Android `NotificationManager.notify(notificationIdHash(messageId, charId))` —— 同 messageId 会**覆盖**前一条，不同 messageId 弹两条。

**第一次乱码可能路径**（待确认）：`UnifiedPushService.kt:208-222` 的 catch 分支——payload JSON 解析失败时按原文前 120 字符弹通知。**修之前需要看一条真的乱码通知的 payload 形状**——瞎改兜底可能把正常通知弄坏。

### 下一步需要暮色配合的事
1. 复现一条乱码通知，导出诊断日志（角色级弹窗 →「查看日志」 → 复制 / 导出）。  
   log key：`amsg_diag_log_v1`，覆盖节点：`wakeup-android-receive / wakeup-push-received / wakeup-payload-parsed / wakeup-save-message / wakeup-event-dispatched / wakeup-chat-ui / wakeup-system-notification` 7 个 + 加上第一项新加的 `wakeup-dedup-hit`、第二项新加的 `wakeup-cancelled-by-user-message`。
2. 如果有重弹的同 messageId：在同一条 messageId 上看 `wakeup-android-receive` 出现几次、每次的 receivedAt 差多少、配套的 `wakeup-payload-parsed` 有没有对应的「已在 receivedIds 中」记录。

## 备注
- 1.x `registerDynamicScheduleOnWorker` / `cancelDynamicScheduleOnWorker` 仍存在但**没有调用方**（9-17 切完后 useChatAI 只调 `registerCharacterWakeup`）。它们是死代码，按暮色"1.0 不动先不改"原则保留。
- 第 1 项的 60 秒 ring（`useChatAI.ts:3714`）保留——它防同回复里复读，前端层面；任务级去重在排程接口层。两条防线不同层。
- 第 2 项的本地账本清空：下一次面板对账自动完成，不需要单独触发。
- 未 push。