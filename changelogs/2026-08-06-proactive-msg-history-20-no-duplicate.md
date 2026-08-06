# 主动消息上下文去重（最终版）— messages 20 条 + system prompt 末尾"最近聊天"段去掉

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

暮色 8-6 19:42 反馈：**messages 数组和 system prompt 末尾"最近聊天（10 轮）"的内容是重复的**（都是最近的聊天记录），**只保留一个就行**。

**之前 3 个 commit 都错了**：
- `1171c6c` — messages 数组清空 + system prompt 末尾 10 轮（去重过度，暮色说"正文全没了"）
- `2de5308` — messages 数组 8 条 + system prompt 末尾 10 轮（两段都保留，**暮色说内容重复**）
- 现在 — messages 数组 20 条 + system prompt 末尾"最近聊天"段去掉（**只保留一个**）

**改**：
- `context/OSContext.tsx:1555-1557` — 删 `recentChatContext` 整个变量定义（13 行）
- `context/OSContext.tsx:1583-1585` — 删 hintLines 里 `recentChatContext ? \`【最近聊天（10 轮）— 写消息时可以参考】\\n${recentChatContext}\` : '【你们最近没什么聊天记录】'` 那一行
- `context/OSContext.tsx:1610-1611` — `historyForBuild` 从 8 → 20 条
- `context/OSContext.tsx:1654-1658` — `buildMessageHistory(historyForBuild, 20, ...)` 第二个参数 8 → 20

**结果**：
- `fullMessages = [system, ...20条user/assistant]`
- system prompt 不再注入"【最近聊天（10 轮）】"段
- 上下文唯一来源 = messages 数组 20 条 history（user/assistant role 标准格式）
- LLM 既能看对话流接续上一句，又不重复 token

## 动了哪些文件

- `context/OSContext.tsx` — 4 处改动（13 行 + 1 行 + 2 行 + 1 行）

## 踩坑 / 需要知道的（重要）

### 我之前 3 次理解错方向
- 1171c6c：以为"两段是同一段对话构造了两次"，**直接全删了 messages 数组** —— 暮色说"正文全没了"
- 2de5308：以为"两段是不同用途（对话流 vs 写作素材）"，**都保留** —— 暮色说"内容是重复的，只保留一个"
- 现在：暮色明确"只保留一个"，**保留 messages 数组（20 条，更长）**，**去掉 system prompt 末尾段**

### 为什么 20 条（不是 8 条 / 10 条 / 50 条）
- 暮色拍板 20，没给具体理由
- 推测：8 条太短（AI 主动发消息接不上 30 分钟前的语境），50 条太长（token 浪费），20 条是个平衡点
- 实际验证：暮色 Vercel 部署后看 AI 主动发消息的"接续感"对不对

### 之前 user memory 里记的"messages 数组 history 跟 system prompt 末尾段是两套机制"是错的
- 之前 memory 7-23 / 7-27 / 6edc7fc changelog 都说"两段用途不同" —— **实际就是同一段对话的两个格式**
- 我 2de5308 commit 写"两套机制不同用途"是错的
- 这次 commit 注释里改回正确描述："上下文唯一来源 = messages 数组"

## 备注
- 这是这一轮 3 个 commit 反复横跳的最终版（1171c6c / 2de5308 / 现在）
- 后续如果再改 messages 数组 history 条数 / system prompt 注入内容，**先确认有没有跟 messages 数组重复**
- 7-23 / 7-27 / 6edc7fc 旧 changelog 仍保留作历史
