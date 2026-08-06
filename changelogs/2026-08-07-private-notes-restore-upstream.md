# 私密记事 — 恢复上游原作者逻辑 + 提示词

**日期**：2026-08-07
**范围**：`apps/RoomApp.tsx` + `hooks/useChatAI.ts` + `utils/chatPrompts.ts` + `types.ts` + 删 4 文件

## 改了什么

### 恢复的"小窝主动生成"机制（核心）

- `apps/RoomApp.tsx` — `initializeDay` 重新实现原作者"4 段 prompt + JSON schema 加 notebookEntry"
  - prompt 模板加 `### 4. 记事簿随笔 (Notebook Entry)` 段
  - JSON schema 末尾加 `"notebookEntry": { "content": "markdown string...", "type": "thought" }`
  - LLM 返 notebookEntry → 先 save system 消息（拿到 id）→ 用 id 作 relatedMessageId 存 RoomNote → 列表前置
- `apps/RoomApp.tsx` — `handleDeleteNote` 还原成"删 note + 删 relatedMessageId 的 system 消息"
- `apps/RoomApp.tsx` — 还原 `useState<RoomNote[]>`，**去掉 `useRoomNotes` hook 依赖**

### 删的"聊天时 token 触发"机制

- 删 `hooks/useChatAI.ts` 里的 `[[PRIVATE_NOTE:...|type]]` token 解析（5.9d 段，约 38 行）
- 删 `hooks/useChatAI.ts` 里的 `privateNotesText` 注入逻辑 + 相关注释
- 删 `hooks/useChatAI.ts` 里的 noteReminder import + 注入块
- 删 `utils/noteReminder.ts` 整个文件（21:00 定时提醒）
- 删 `utils/chatPrompts.ts` 里的 prompt 段 9（"📒 私密记事"工具段，约 38 行）
- 删 `utils/chatPrompts.ts` 里的 awareness 段（"最近写过的私密记事"列表，约 27 行）
- 删 `utils/chatPrompts.ts` 里的 `PRIVATE_NOTES_PROMPT_STORAGE_KEY` + `getCustomPrivateNotesPrompt`
- 删 `utils/chatPrompts.ts` 里的 `privateNotesText` 返回字段

### 删的私有化扩展

- 删 `components/notes/NotebookCard.tsx` + `NotebookDetail.tsx`（NotebookBackground / NoteSearchBar 保留，小纸条在用）
- 删 `hooks/useRoomNotes.ts`（共用 hook）
- `types.ts` — RoomNote 还原成 `type: 'thought'` 单一种；删 `replies` 字段；删 `styleImageUrl` 字段；删 `NoteReply` 接口
- 删 `privateNotesEnabled` 字段引用（chatPrompts.ts 之前用，TypeScript 类型里没找到，但代码分支也删了）

## 动了哪些文件

- `apps/RoomApp.tsx` — import 删 + useState 还原 + prompt 模板加段 4 + 还原 3. Handle Notebook 块 + handleDeleteNote 还原
- `hooks/useChatAI.ts` — 删 noteReminder import / 删 reminder 注入 / 删 privateNotesText 引用 / 删 PRIVATE_NOTE 解析
- `utils/chatPrompts.ts` — 删 PRIVATE_NOTES_PROMPT_STORAGE_KEY 等 4 项 / 删 awareness 段 / 删 prompt 段 9 / 删 dynamicTail.privateNotesText
- `types.ts` — RoomNote type 还原 + 删 3 字段
- `components/notes/NotebookCard.tsx` (D)
- `components/notes/NotebookDetail.tsx` (D)
- `hooks/useRoomNotes.ts` (D)
- `utils/noteReminder.ts` (D)

## 保留（独立功能，不动）

- `apps/XiaoZhiTiaoPage.tsx` / `useXiaoZhiTiao` / `XIAO_ZHI_TIAO` token / `XiaoZhiTiaoCard` / `XiaoZhiTiaoDetail` / `xzt_xxx` store / `styleImageUrl` 字段（XiaoZhiTiao 上）/ `xiaoZhiTiaoStyles.ts` / 发现页"小纸条"入口
- `components/notes/NotebookBackground.tsx` / `NoteSearchBar.tsx`（小纸条在用）
- `types.ts` 的 `XiaoZhiTiao` 类型 + `XiaoZhiTiaoReply` 接口

## 踩坑 / 需要知道的

### 1. 数据库旧数据兼容

删字段后**不影响运行时**（IndexedDB schemaless，数据库里 RoomNote 记录还可能有 `replies` / `styleImageUrl` 字段，运行时只是不读）。但**新数据不再写这些字段**。

**潜在问题**：旧 RoomNote 的 `type` 可能是 `'doodle' | 'search' | 'lyric' | 'gossip'`（5 种），新 TypeScript 类型是 `'thought'` 单一 literal。读旧数据时 TS 类型不严格，运行时是 string 不炸。

### 2. prompt 不再带"最近 5 条私密记事"

- `dynamicTail` 5 段变 4 段：bilingual reminder / realtimeText / innerState / recentEmotions / memoryPalace
- AI 不知道"自己之前写过什么"——可能产生重复。**预期**：进小窝时新生成的 note 应该会跟最近的内容不一样（因为 LLM 会避免重复），但聊天时 AI 没有 awareness 列表了。
- 风险低：私密记事现在只在进小窝时生成，不是高频操作。

### 3. `renderNotebookContent` 函数没还原

RoomApp 里的 Markdown 解析函数（177 行起）跟 upstream 不一样——暮色 fork 后改过。**没动**（暮色没明确要求，且 UI 视觉暮色已经验收过）。

### 4. `char.privateNotesEnabled` 字段

之前 7-17 暮色加的"私密记事开关"，代码里也用 `${!isPureMode && char.privateNotesEnabled !== false ? ...}`。**这次删 prompt 段 9 时一并删了**——但 types.ts 里没找到这个字段声明（可能只在运行时设默认值），所以没动 types。

## 备注

- Build 已验证通过（`npm run build` ✓ 4.01s）
- 未提交，待暮色 review diff 后再 push
- 小纸条的 `pickRandomStyleImage` 引用之前在 useChatAI.ts:3255 是个未定义的引用（没 import，但代码用了），这次删 PRIVATE_NOTE 段时一起删了，TS 不再报这个未定义错
- 暮色 8-7 00:13 说"省着用额度"——这次改动没增加 prompt 长度，反而**减少**了（删了段 9 + awareness 段 + dynamicTail 1 段，净省 ~80-100 行 prompt + 1 次 IndexedDB 读 + 21:00 定时器）
