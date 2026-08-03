# 见面 app：失败时重发最后一条 user 消息（v2 修复）

**日期**：2026-08-03
**涉及 commit**：`待提交`

## 改了什么

暮色反馈上一版"catch 块加 setInput(trimmed) 回填"**是错的**：

> "失败了上一条消息会重新回到输入框，再点发送就会变成发送了两条相同的消息。"

**根因**（不是发送键锁，是架构问题）：

- DateApp 的 `handleSendMessage` 是**"先入库再发请求"**架构（line 302：`DB.saveMessage(user msg)` 在 fetch 之前）
- 失败时库里已经有一条 "hello"
- 上一版让输入框回填 "hello" → 用户再点发送 → 走 onSendMessage 路径 → 库里**再**入库一条 "hello"
- → **库里有两条相同消息**

**这次修复 v2**：

1. **回退**之前 v1 的 `setInput(trimmed)` —— 不再污染输入框
2. **新增 `onResendLastUserMessage` 路径** —— DateApp 那边
   - 拿库里最后一条 user 消息（source='date'）
   - **不**重复入库
   - 复用 handleSendMessage 的"context + fetch + save AI"逻辑
   - 跟"重 roll"一个套路：重发请求但不写新 user 消息
3. **新增 `hasPendingUserMessage` 判断** —— DateSession 这边
   - 用 useMemo 从 messages 末尾检测"最后一条是 user 消息"
   - 用于决定"空内容 + 点发送"的去向
4. **改 `handleSend` 空内容分支**（暮色 v2）：
   - canReroll → 走重 roll（之前）
   - hasPendingUserMessage → 走重发（新）
   - 其他 → 什么都不做
5. **改发送按钮 `disabled` 条件**（暮色 v2）：
   - `(!input.trim() && !canReroll && !hasPendingUserMessage) || isTyping`
   - 三个 false 三个 true 都不锁

**用户视角**：

- 发 "hello" → 失败 → 输入框保持空（不回填了）→ 发送键仍然**可点**
- 点发送 → 走 handleResend → 库里那条 "hello" 的请求**重新发一遍** → 成功时拿到 AI 响应
- 库里仍然只有**一条** "hello" + 一条 AI 响应

## 动了哪些文件

- `components/date/DateSession.tsx:86-91` — props 加 `onResendLastUserMessage`
- `components/date/DateSession.tsx:100-113` — 解构新 props
- `components/date/DateSession.tsx:362-373` — 新增 `hasPendingUserMessage` useMemo
- `components/date/DateSession.tsx:512-588` — `handleSend` 改（v2）+ 新增 `handleResend` 函数
- `components/date/DateSession.tsx:1213` — 发送按钮 `disabled` 条件加 `!hasPendingUserMessage`
- `apps/DateApp.tsx:296-414` — `handleSendMessage` 返回类型从 `Promise<string>` 改成 `Promise<{ content, thinking? }>`
- `apps/DateApp.tsx:417-528` — 新增 `handleResendLastUserMessage` 函数
- `apps/DateApp.tsx:744` — `<DateSession>` 传 `onResendLastUserMessage`

## 踩坑 / 需要知道的（重要）

- **"先入库后发请求"架构没改**——依然是 DateApp 自己的设计，只是这次多了"不重复入库"的重发路径
- **`handleResend` 不在 DateApp 抽公共函数**——而是直接复制了 handleSendMessage 的"context + fetch + save AI"部分（约 110 行）。**好处**：简单、不影响主路径。**坏处**：以后改 prompt 时要记得两处都改（这次就一处没改：reroll 那块的"### 推理语言"段还在 handleReroll 里）。后续重构时应该抽出 `callDateApiCore(text, systemPrompt, historyMsgs)` 内部函数。
- **`hasPendingUserMessage` 用 `messages` 不是 `sessionMessages`**：因为 sessionMessages 被 `openingIndex` 切过，**没收到 AI 回复的 user 消息**（位于 opening 之后）**会**在 sessionMessages 末尾——但**如果用户中途用 `handleHistoryLongPress` 删了一些消息**，sessionMessages 可能不对。所以直接用 `props.messages`（最权威）。
- **`isTyping` 期间 hasPendingUserMessage 强制 false**：避免"输入还卡着请求"时让按钮看起来可以重发。UX 上合理——按钮恢复可用 == 失败了。
- **`handleResend` 成功时清掉 input**——其实 input 本来就是空的（失败时 setInput('') 没回填），但保险起见…… 等等，我没 setInput('')——因为 input 本来就是空的（用户什么都没输）。OK 没问题。
- **测试覆盖**：
  - build 过了
  - TDZ 家族无新风险（新 useMemo 引用现有 isTyping/messages，不 forward ref）
  - **要手动验证**：
    - 见面 app 发送消息 → 故意断网/触发 fail → 看到 "(连接中断)"
    - 输入框**空** → 发送键**仍然可点**
    - 点发送 → 库里 user 消息**数量不变**（不会多一条重复）→ AI 响应能正常收到
    - 成功收到响应后：hasPendingUserMessage 变 false（最后一条变成 assistant）→ 输入框空 + 发送键**重新锁定**

## 备注

- **Prompt 同步问题**：handleSendMessage 和 handleResendLastUserMessage 的 system prompt **完全一致**（"### 推理语言"段两边都加了）。**handleReroll 的 system prompt 是简化版**（"### 推理语言"段已经加了但格式略简）——下次要重构时一起对齐。
- **v1 → v2 反思**：暮色 8-2 那条"用户懂程序功能不懂英文术语"反过来理解——我也**懂程序逻辑不懂用户场景**。v1 的"setInput 回填"看着代码合理，但**没考虑"先入库后发请求"架构**——这是个**架构层面**的 bug，不是 UI 层面的。下次遇到类似"重发"需求，先问"消息存哪了？"。
- **后续可选优化**：
  - 把发送键在"重发模式"下显示一个"↻"图标——现在空输入框 + 可点发送键，用户可能误以为是"发新消息"
  - 失败时显示一个"重发"小提示（toast 形式）
  - 抽象出 `callDateApiCore` 内部函数消除重复
