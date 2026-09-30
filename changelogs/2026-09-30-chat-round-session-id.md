# 主动消息分轮改用 sessionId —— 修「每个气泡都带头像」

**日期**：2026-09-30
**涉及 commit**：（见本文件提交）
**关联**：昨天那版 `changelogs/2026-09-29-chat-round-avatar-timestamp.md`（本文件更正其中一处判断）

## 改了什么

暮色 2026-09-30 实测反馈：**主动消息每个 AI 气泡都带头像，正常聊天不会**，一轮还是应该只有一个头像。

昨天那版把「主动消息每条 push 独立成轮」当成了正确行为，**方向错了**：`pushIdOf` 取的是 `metadata.activeMsg2.messageId`，而 2.0 里 messageId 的粒度是**一个气泡**，不是一轮。

这轮把 `pushIdOf` 换成 `roundIdOf`，按 `sessionId` 分轮。

## 根因

2.0 下发消息时，是把「一次对话」切成 `totalMessages` 条 push 逐条发的：

- 每条 push 一个 `messageIndex`（1..N）和一个 `messageId`
- **文字和每个 `[[SEND_EMOJI]]` 各占一条 push**
- 这些 push **共享同一个 `sessionId`**

所以 AI 一轮里发「一句文字 + 两个表情包」= 3 条 push = 3 个不同 messageId。

昨天按 messageId 分轮 → 3 个 messageId → 判定成 3 轮 → **每个气泡一个头像**。

正常聊天不受影响，是因为正常聊天那侧（`useChatAI` 路径）压根不写 `activeMsg2` 也没有 `sessionId`，两侧都取不到轮标识 → 全并成一轮 → 一个头像。**这就是"主动消息坏、正常聊天好"的原因。**

### 旁证（不是推测，是代码里现成的判据）

`utils/activeMsgRuntime.ts` 里两个函数都是按 `sessionId` 认"同一次对话"的：

- `holdUntilEarlierChunksLead`（等齐守卫）：`getInstantSessionId(other) === sessionId` 且 `other.messageId !== message.messageId` —— **明确证明同 session 下有不同 messageId 的 push**
- `findPersistedChunkIndexes`：按 `(sessionId, messageIndex)` 认领已落库的"段"

`applyAssistantPostProcessing.ts:740` 的注释也记着："后台主动消息会把每个 `[[SEND_EMOJI]]` 切成独立一条 push"。

## 新规则

```js
// 一次主动对话 = 一个 sessionId
const roundIdOf = (msg) => {
    const meta = msg.metadata || {};
    const a2 = meta.activeMsg2 || {};
    return meta.sessionId || a2.sessionId || a2.taskId || undefined;   // taskId 兜底
};
```

轮边界三条不变：

1. 角色切换
2. 戳一戳打断
3. 主动消息换了「一次对话」（sessionId 变了）

## 踩坑 / 需要知道的（重要）

### 1. 选分轮标识之前，先确认它的粒度

昨天的教训：**字段名不代表粒度**。`messageId` 看着像"消息编号"很自然拿来当轮次标识，但它的粒度比轮次细得多。定这类标识之前先找代码里现成的判据（`holdUntilEarlierChunksLead` / `findPersistedChunkIndexes` 就是），别靠字段名猜。

### 2. sessionId 在气泡 metadata 里的来源

链路：worker 下发 → SW `saveContentToInbox` 写进 `metadata` → `activeMsgRuntime` 的 `mcdInheritMeta` 用 `...(message.metadata || {})` 铺给每块气泡 → `applyAssistantPostProcessing` 的 `takeMeta(base)` 原样透传（`takeMeta` 只消费思维链 `firstMeta`，base 不动）。

⚠️ 若某条路径把 sessionId 放在 inbox message 的**顶层**而非 `metadata` 里，就铺不进气泡。所以留了 `taskId` 兜底 —— 同一唤醒任务至少是一轮，退化后仍是"一轮一个头像"，只是可能把同任务的多个 session 合成一轮。

### 3. 正常聊天那侧必须确认不写 sessionId

已经查过 `hooks/useChatAI.ts`：没有 sessionId。所以正常聊天两侧都取不到轮标识，走 `return false` 全并一轮，不受影响。**如果以后给正常聊天也加 sessionId，这里要重新验一遍**——同一轮内多条气泡若不共享 sessionId，会退化成今天这个 bug。

## 备注

- 1.0 老数据（无 sessionId / taskId）会并进相邻轮次，暮色确认过 1.0 不用了。
- `proactiveRoundStart` 那三处写入仍是死写入，暂未清。
