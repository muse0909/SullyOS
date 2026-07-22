# 小纸条 — 完全脱离小小窝 app（双系统方案 A）

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`11d6672`（第六轮：还原"私密记事" UI 文字）

## 改了什么
暮色 2026-07-22 反馈："**小纸条完全脱离小小窝 app**。之前是和小小窝里的私密记事连在一起的。**私密记事恢复成最早期没动过的样子**。**小字条单独独立出来**。"

暮色选 A：**双系统完全独立** — 新数据模型 / 新 hook / 新组件 / 新 token / 新 prompt 段 / 新 IndexedDB store。

### 4 步分阶段 commit

#### commit 1（`89807d3`）：数据层
- `types.ts` 加 `XiaoZhiTiao` / `XiaoZhiTiaoReply` 接口
- `utils/db.ts`：`DB_VERSION 62 → 63` + 新 store `xiao_zhi_tiaos`（独立 charId 索引）+ 3 个 CRUD（`getXiaoZhiTiaos` / `saveXiaoZhiTiao` / `deleteXiaoZhiTiao`）
- `hooks/useXiaoZhiTiao.ts` 新文件（仿 useRoomNotes 但操作新 store）
- **不动** RoomNote / useRoomNotes / room_notes store / 任何 PRIVATE_NOTE 相关代码

#### commit 2（`8304cd5`）：新组件
- `components/notes/XiaoZhiTiaoCard.tsx`：复制 NotebookCard 源码 + 改 type + 5 type 视觉 + styleImageUrl 背景图 + 文字居中
- `components/notes/XiaoZhiTiaoDetail.tsx`：复制 NotebookDetail 源码 + 改 type + 标题"小纸条" + 输入区交互
- **不动** NotebookCard / NotebookDetail（小小窝私密记事继续用）

#### commit 3（本 commit + Step 3+4）：prompt + token 解析 + 新页面
- `utils/notebookStyles.ts` → **改名** `utils/xiaoZhiTiaoStyles.ts`（独立命名 + key `sullyos_xiaoZhiTiaoStyles` + 类型/函数全改名）
- `utils/chatPrompts.ts`：
  - 加 `XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY` + `getCustomXiaoZhiTiaoPrompt()`
  - 加新"📝 小纸条"prompt 段（独立于"📒 私密记事"段 — 暮色说"完全脱离"，两段 prompt 都要保留）
  - 明确"私密记事 vs 小纸条"在 prompt 里说明
- `hooks/useChatAI.ts`：
  - 加 `[[XIAO_ZHI_TIAO: 内容 | type]]` token 解析（仿 PRIVATE_NOTE，但用 XiaoZhiTiao / DB.saveXiaoZhiTiao / pickRandomXiaoZhiTiaoImage）
  - **不动**现有 PRIVATE_NOTE 解析
- `apps/XiaoZhiTiaoPage.tsx` 新文件（仿 PrivateNotesPage 但用 useXiaoZhiTiao / XiaoZhiTiao / XiaoZhiTiaoCard / XiaoZhiTiaoDetail + 标题"小纸条" + 新 SettingsDrawer 引用 XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY 和 xiaoZhiTiaoStyles）
- `apps/PrivateNotesPage.tsx` **删除**（完全独立原则，发现页不再用）
- `apps/DiscoverPage.tsx`：
  - 改 import：`PrivateNotesPage` → `XiaoZhiTiaoPage`
  - 改 subPage key：`'private-notes'` → `'xiao-zhi-tiao'`

## 动了哪些文件
- `types.ts` — 加 XiaoZhiTiao / XiaoZhiTiaoReply
- `utils/db.ts` — DB_VERSION 63 + 新 store + 3 个 CRUD
- `hooks/useXiaoZhiTiao.ts` — 新文件
- `hooks/useChatAI.ts` — 加 XIAO_ZHI_TIAO token 解析
- `utils/chatPrompts.ts` — 加小纸条 prompt 段 + helper
- `utils/notebookStyles.ts` → `utils/xiaoZhiTiaoStyles.ts` — 改名
- `components/notes/XiaoZhiTiaoCard.tsx` — 新文件
- `components/notes/XiaoZhiTiaoDetail.tsx` — 新文件
- `apps/XiaoZhiTiaoPage.tsx` — 新文件
- `apps/PrivateNotesPage.tsx` — 删除
- `apps/DiscoverPage.tsx` — 改 import 路径 + subPage key

## 踩坑 / 需要知道的（重要）

### 影响面（按 memory lesson 提前分析）
- **`types.ts` 加新接口** — 跟 RoomNote/NoteReply 平级，**不引用** RoomNote/NoteReply。**完全独立**
- **`db.ts` IndexedDB schema 升级** — DB_VERSION 62 → 63，新增 store **不影响老 store**。老用户升级 IndexedDB 时新 store 自动创建，老数据保留
- **`useChatAI.ts` 加新 token 解析** — 是改**共享写入路径**（所有 LLM 调用最后都走这），但只**增加**新分支（5.9e），**不动**现有 5.9d PrivateNote 分支。**风险低**
- **`chatPrompts.ts` 加新 prompt 段** — 影响所有 LLM 调用，**但新段有条件 `${!isPureMode ? ... : ''}`**（纯聊天模式跳过），跟其他功能（朋友圈/日程/群聊）走同一种条件模板
- **`useRoomNotes`/`NotebookCard`/`NotebookDetail`/`RoomApp` 不动** — 小小窝的私密记事保持原样（暮色原话"恢复成最早期没动过的样子"）
- **删除 `apps/PrivateNotesPage.tsx`** — 这个文件**只是**发现页的"私密记事"入口（在 RoomApp 内部用 useRoomNotes 直接渲染，没用 PrivateNotesPage）。删它**不影响**小小窝侧边栏

### 命名一致性
- 文件：`XiaoZhiTiaoPage.tsx` / `XiaoZhiTiaoCard.tsx` / `XiaoZhiTiaoDetail.tsx` / `useXiaoZhiTiao.ts` / `xiaoZhiTiaoStyles.ts`
- 类型：`XiaoZhiTiao` / `XiaoZhiTiaoReply` / `XiaoZhiTiaoStyles`
- localStorage key：`sullyos_xiaoZhiTiaoStyles` / `sullyos_xiaoZhiTiaoPrompt`
- ID 前缀：`xzt-${Date.now()}`（区别于 `note-${Date.now()}` 私密记事）
- AI token：`[[XIAO_ZHI_TIAO: ...]]`（区别于 `[[PRIVATE_NOTE: ...]]`）
- Toast / console：📝 emoji（区别于 📒）

### 双系统并存
- 小小窝"私密记事"：RoomApp 侧栏 + 用 RoomNote / useRoomNotes / [[PRIVATE_NOTE]] / NotebookCard / NotebookDetail
- 发现页"小纸条"：XiaoZhiTiaoPage / 用 XiaoZhiTiao / useXiaoZhiTiao / [[XIAO_ZHI_TIAO]] / XiaoZhiTiaoCard / XiaoZhiTiaoDetail
- 数据完全分离（不同 store），UI 完全分离（不同组件），AI 写路径完全分离（不同 token + 不同 DB method + 不同 prompt 段）
- **用户在两边各自独立**：小小窝侧栏看不到发现页的"小纸条"，反之亦然

## 备注
- 暮色说"7881a0e 没有 push 上去" 实际 push 成功了（git log 确认 origin/preview HEAD = 7881a0e）。可能是 Vercel 部署延迟或浏览器没刷新
- 暮色说"私密记事恢复成最早期没动过的样子" — 第六轮（commit `11d6672`）已经把 5 处 UI 文字还原成"私密记事"，这轮不动
- 老用户安装时 IndexedDB 自动从 v62 升到 v63（既有 store 不动 + 新增 xiao_zhi_tiaos store）
- 测试重点：
  1. 小小窝侧栏"私密记事"功能完全没变（看老便签）
  2. 发现页"小纸条"独立 — 列表/详情/AI 写都走新数据
  3. 自定义样式（多分组 + 随机选图）只对"小纸条"生效
  4. 之前在私密记事设置里写的自定义 prompt 还在（老 key sullyos_privateNotesPrompt 没动）
