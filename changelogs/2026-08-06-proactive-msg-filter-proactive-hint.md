# 主动消息 — history 过滤 proactiveHint（修 AI 完全不接 history 末尾话题）

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

暮色 8-6 20:09 反馈：**messages 数组里有 20 条 history，但 AI 的主动消息"完全断裂"**——AI 不接 history 末尾的"重写一版"话题，另起炉灶聊天气。

### 根因

`OSContext.runProactive` line 1594-1600 把 system hint（"现在几点了 / 暮色没找你说话多久 / 你是你自己的..."）**以 `role: 'user', metadata: { proactiveHint: true, hidden: true }` 存到 IDB**。

然后 line 1611 `DB.getRecentMessagesByCharId(charId, 20)` 拉 20 条 —— **没过滤 proactiveHint 标记**。

**结果**：
- messages 数组最末尾 1 条 = 刚 push 的 system hint（伪装成 user 消息）
- AI 看到这条当成"用户最新说的话"
- 但内容是"暮色已经 10分钟没找你说话。你今天有自己的事。想发啥就发什么..."
- AI 严格遵守 system prompt 的"角色哲学" + 看到 system hint 的"不接用户话题"暗示 → **不接 history 末尾的"重写一版"话题**

暮色原话：**"这不是历史记录够不够的问题，是完全被忽略了"** —— 完全正确。

### 修法

拉 history 时**手动过滤 proactiveHint**：
- 拉 25 条（多 5 条兜底，防 hint 消息过多导致过滤后不足 20 条）
- filter `m.metadata?.proactiveHint === true` 排除
- slice(-20) 取最后 20 条

```ts
const rawHistory = await DB.getRecentMessagesByCharId(charId, 25);
const historyForBuild = rawHistory
    .filter(m => !m.metadata?.proactiveHint)
    .slice(-20);
```

## 动了哪些文件

- `context/OSContext.tsx:1602-1620` — 拉 history 时过滤 proactiveHint

## 踩坑 / 需要知道的（重要）

### `buildMessageHistory` 内部已有 proactiveHint 处理，但不完整
- `utils/chatPrompts.ts:1132` 计算 timeGapHint 时跳过 hint 消息
- **但 effectiveHistory 本身没过滤 hint** → hint 消息照样进 messages 数组
- 主 API 聊天没影响（hint 只在 runProactive 路径存）
- runProactive 路径**有影响**（hint 是最新一条，AI 必看）

### 为什么不在 `buildMessageHistory` 内部修
- 全局过滤会影响所有调用点
- 主动消息 hint 是 OSContext 的"自我实现细节"，不应该污染 buildMessageHistory
- 局部修（在 OSContext.runProactive 拉 history 时过滤）更符合"谁产生问题谁修"原则

### 之前 3 个 commit 反复横跳的本质原因
- 1171c6c：去重过度（清空 messages）— 暮色说"正文全没了"
- 2de5308：两段都保留（去重不足）— 暮色说"内容重复"
- 0cd01b5：去掉 system prompt 末尾段，messages 20 条 — 暮色说"内容被忽略"
- **0cd01b5 commit 让 hint 消息进 messages 数组，AI 被 hint 误导** —— 这次修

### 之前 4 次没查出来的"hint 消息进 messages" bug
- 8-5 改 history 截断 500 → 8 条（commit `9d2f3cf`）
- 8-6 改 history 8 → 20 条（本 commit 前）
- **都没意识到 hint 消息会被算进 history 末尾**
- "现在想想为什么 AI 之前主动消息一直像在'重启'而不是'接续'"

## 备注
- 这次改完，AI 主动消息应该能接住 history 末尾话题
- 但 AI 是否真的"接住"还要看 system prompt（"角色哲学"vs"接住用户话题"）的权重 — 暮色 Vercel 部署后实测
- 如果 AI 仍然不接 history 末尾话题（"才佳，外面29度" vs "重写一版"），那要 system prompt 改一下，加一句"延续最近的话题，用你的方式"—— 这个等暮色反馈再决定
