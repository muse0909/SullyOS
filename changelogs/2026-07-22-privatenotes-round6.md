# 私密记事 — 第六轮：还原"私密记事" UI 文字（小纸条仅留发现页）

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`7881a0e`（第五轮：改名"小纸条"）

## 改了什么
暮色 2026-07-22 反馈："**小纸条完全脱离小小窝 app。之前是和小小窝里的私密记事连在一起的。** 私密记事恢复成最早期没动过的样子。小字条单独独立出来。"

—— 上一轮（`7881a0e`）我把 6 处用户可见文字全改成"小纸条"，**过度了**。这次只保留发现页入口"小纸条"，其他 5 处还原成"私密记事"。

### 还原的 5 处（恢复成"私密记事"）
- `apps/PrivateNotesPage.tsx:87` confirm 弹窗：「确定删除这条私密记事？回复也会一起删除。」
- `apps/PrivateNotesPage.tsx:117` 列表页标题：`<h1>私密记事</h1>`
- `apps/PrivateNotesPage.tsx:355` 空状态文案：「私密记事还是空的」
- `apps/RoomApp.tsx:1190` 小小窝侧边栏按钮：「私密记事」
- `components/notes/NotebookDetail.tsx:102` 详情页标题：`${charName} · 私密记事`

### 保留的 1 处
- `apps/DiscoverPage.tsx:117` 发现页入口：**「小纸条」**（独立功能的名字）

### 没动的
- `types.ts` / `utils/notebookStyles.ts` / `hooks/useChatAI.ts` / `NotebookCard` / `FullNoteCard` 的 `styleImageUrl` 自定义样式功能 — 上一轮的 UI 改造，**跟"小纸条/私密记事"命名无关**，保留
- SettingsDrawer 里的「小纸条样式」section — 保留
- prompt 段「📒 私密记事（你给 ${userProfile.name} 留的小纸条）」 — 保留（AI 写便签的内部标识）
- 注释 / 文件名 / 内部变量

## 动了哪些文件
- `apps/PrivateNotesPage.tsx` — 3 处文字还原
- `apps/RoomApp.tsx` — 1 处还原
- `components/notes/NotebookDetail.tsx` — 1 处还原

## 踩坑 / 需要知道的（重要）
- **上轮改"小纸条"是过度了** — 没充分理解暮色"小纸条完全脱离小小窝"的边界
- **发现页入口 = 小纸条** — 入口命名变了，但**功能页面**(`PrivateNotesPage.tsx`) 内仍叫"私密记事"—— 出现**入口名和页面名不一致**的奇怪情况，待暮色拍板是否要进一步拆
- **「完全脱离」的具体含义** — 见下面"待办"，需要暮色明确

## 备注
- 暮色还说"7881a0e 没有 push 上去" — 实际 push 成功了（git log 确认 origin/preview HEAD = 7881a0e，git push 返 "Everything up-to-date"）。可能是 Vercel 部署延迟或暮色浏览器没刷新
- 待办：暮色说"完全脱离小小窝 app"——具体什么意思？需要拍板
