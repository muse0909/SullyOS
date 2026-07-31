# 情侣空间 AI 真决策（LLM 完整请求体）+ 状态胶囊带名字

**日期**：2026-08-01  
**涉及 commit**：`b168584`

## 改了什么

### 1. 卡片视觉修订（状态胶囊带名字）

暮色 2026-08-01 反馈"按钮变成相应状态"——按钮**消失**变**状态胶囊**：

| 状态 | 视觉 |
|---|---|
| pending | 接受（粉）+ 拒绝（白）两个胶囊按钮 |
| accepted | 按钮消失 → "**X** 已接受你的邀请。" 胶囊（绿） |
| declined | 按钮消失 → "**X** 已拒绝你的邀请。" 胶囊（灰） |

胶囊里的 **X** = `senderName`：
- 暮色主动邀请（role=system）→ X = userProfile.name（"暮色"）
- AI 主动邀请（role=assistant）→ X = 角色名（"江澈" / "Sully"）

### 2. AI 真决策（核心修复）

暮色 2026-08-01 反馈：
- "**完全没聊天记录**还是邀请了"——"让 ta 邀请我"路径无 AI 决策
- "**什么情况都接受**，拒绝设置没意义"——之前 `requestCoupleSpaceDecision` 60s 超时默认 accept = 假 AI 决策

**新方案**：`OSContext.decideCoupleSpaceInvite(charId, scenario, annivDate)`

- 复用 `ChatPrompts.buildSystemPrompt(char, userProfile, groups, [], [], history, realtimeConfig, ..., 'pure')` 拿**完整请求体**（向量化记忆 + 角色卡 + 世界书 + userProfile）
- pure 模式跳过朋友圈/音乐/群聊/日记/笔记/心声底色（情侣空间邀请**不**需要这些 awareness）
- history 用 `DB.getRecentMessagesByCharId(charId, char.contextLimit || 100)` 完整上下文（暮色说不限制多少条）
- OpenAI 协议 fetch，60s timeout
- prompt 末尾加暮色定的 instruction：
  - respond（用户发邀请让角色决定）：`你是 X。用户向你发出情侣空间邀请。基于你们的关系，真判断接受还是拒绝。可以接受也可以拒绝。返回 JSON: {action, message}`
  - invite（让 ta 邀请我，决定是否想发）：`你想主动发情侣空间邀请给用户吗？基于你们的关系判断。...返回 JSON: {action, message}`
- parse LLM 返回的 JSON → `{action: 'accept'|'decline', message: string} | null`
- **失败 fallback = null** → 保持 pending，等用户手动按按钮（**不**默认 accept）

### 3. "让 ta 邀请我"路径（`requestCoupleSpaceInviteFromChar`）调 LLM 决策

| LLM 决定 | 行为 |
|---|---|
| accept | 标 pending + 推 invite 卡（用 LLM 写的邀请文案）|
| decline | **不**发邀请卡，写一条 assistant 消息（"我跟你还不熟"）|
| 失败 | **不**发邀请卡，写一条 assistant 消息（"我需要想想"）|

### 4. "邀请 ta 开通"路径（`handleConfirmInvite`）调 LLM 决策

| LLM 决定 | 行为 |
|---|---|
| accept | 自动 `acceptInvite` + 改 message status='accepted' + 写 assistant 心情消息 |
| decline | 自动 `declineInvite` + 改 message status='declined' + 写 assistant 拒绝消息（说明原因）|
| 失败 | 保持 pending，等用户手动按按钮 |

## 动了哪些文件

- `context/OSContext.tsx`
  - 新增 `decideCoupleSpaceInvite(charId, scenario, annivDate)` 函数（~110 行）：完整请求体 + LLM fetch + parse JSON
  - `requestCoupleSpaceInviteFromChar` 重写：先调 `decideCoupleSpaceInvite('invite')` → 根据 action 决定发卡 / 写拒绝消息
  - 接口加 `decideCoupleSpaceInvite` 字段
  - value 对象暴露 `decideCoupleSpaceInvite`
- `apps/CoupleSpaceApp.tsx`
  - `handleConfirmInvite` 重写：先发邀请卡，再 fire-and-forget 调 `decideCoupleSpaceInvite('respond')` → 根据 action 自动 accept/decline + 改 message status + 写 assistant 回应消息
  - 删原来"心情回复"那段 LLM 调用（commit a4e93fb 加的）—— 暮色要的"AI 决策"包含回应消息，不再单独写心情
  - useOS 解构加 `decideCoupleSpaceInvite`
- `components/chat/MessageItem.tsx`
  - 邀请卡 `couple_space_invite` 渲染拆成 2 段：accepted/declined → 状态胶囊；pending → 原版带按钮

## 踩坑 / 需要知道的

### "完整请求体"复用 ChatPrompts.buildSystemPrompt

`ChatPrompts.buildSystemPrompt` 是 useChatAI 内部的 800+ 行函数，包含向量化记忆注入、世界书、朋友圈、音乐、群聊、日记、心声底色等 awareness。直接调它**完全**复用所有 awareness 逻辑。

**pure 模式**（`chatMode='pure'`）：
- 跳过朋友圈/音乐/群聊/日记列表/笔记列表/心声底色 + 工具层 Notion/飞书/小红书/搜索
- **保留**：记忆宫殿（`char.memoryPalaceInjection`）+ 角色人设 + 世界书 + user profile + realtime + behavior rules

**对"情侣空间"场景够用**——决策不需要朋友圈/音乐 awareness，但需要"角色跟暮色关系"（记忆宫殿 + 历史聊天）。

### "完全没聊天记录还是邀请"真凶

之前 `requestCoupleSpaceInviteFromChar`：
- 暮色点"让 ta 邀请我" → markPending → **直接**调 LLM 生成邀请文案（用 50 条上下文）→ 发邀请卡
- 问题：**没**问 LLM"你想不想发"——直接发
- 隐身窗下 Sully 没跟暮色聊过天，**LLM 也照生成邀请文案**（"暮色，向你走来..."），sully 也"接受了"

**修法**：先 `decideCoupleSpaceInvite('invite')` 让 LLM 真判断想不想发：
- LLM 看上下文发现没聊天记录 → decline（"我跟你还不熟，暂时不发"）
- 写 assistant 消息 + **不**发邀请卡

### "什么情况都接受"真凶

之前 `requestCoupleSpaceDecision`：
- 暮色发邀请后 fire-and-forget 调，60s 超时
- 60s 内 LLM 没返回 → **catch 块 fallback accept**（"AI 默认接受"）
- 暮色看到"自动开通"

**修法**：
- 删 `requestCoupleSpaceDecision`（commit 51b1818 已删）
- 新 `decideCoupleSpaceInvite` **不**有 fallback default action
- LLM 失败 / 无 API / JSON parse 失败 → 返 null → 调用方**不**自动 accept
- 调用方保持 pending + 等用户手动按按钮

### LLM 只支持 OpenAI 协议（暂）

暮色默认 OpenAI 兼容 API（中转站）。`decideCoupleSpaceInvite` 调 `/v1/chat/completions` + `Authorization: Bearer xxx`。

**不**支持 Claude / Gemini 协议——这两个协议 LLM 调用格式不同（Claude 的 system 字段在顶层、Gemini 的 `systemInstruction` 也在顶层），需要单独写。如果用户用 Claude/Gemini 会拿到 HTTP 400 → 返 null → fallback pending → 用户手动按按钮。

**等暮色反馈**再补 Claude/Gemini 协议（参考 useChatAI.ts:976-1000 的 3 套协议处理）。

### scenario='respond' 跟 scenario='invite' 的 prompt 区别

- `respond`（用户主动邀请，角色决定接/拒）：
  - 用户已经发出邀请卡
  - LLM 决定接/拒 + 写接受/拒绝的话
  - 接受 → 自动开通；拒绝 → 写拒绝消息
- `invite`（让 ta 邀请我，角色决定想不想发）：
  - 用户**没**发邀请卡（"让 ta 邀请我"是触发器，不是邀请卡本身）
  - LLM 决定想/不想发 + 写邀请文案 / 拒绝理由
  - 想发 → 写邀请卡；不想 → 写拒绝消息

**两套** prompt 措辞不同，**不能**混用。

## 备注

- 暮色今天明确"过过脑子"——**先**讲方案、**再**动手，不再自作主张简化
- 暮色测：隐身窗 1）点"让 ta 邀请我" Sully（没聊天记录）→ 应该 decline，写一条消息"我跟你还不熟"；2）点"邀请 ta 开通" 江澈（已经聊过）→ LLM 应该 accept，写心情消息；3）拒绝的话 → 状态胶囊"暮色 已拒绝你的邀请" + 角色回应消息
- 没改：`coupleSpaceAccept` / `coupleSpaceDecline`（手动覆盖路径，commit ecd04e0 改的）—— 保持手动按钮**不**调 LLM
