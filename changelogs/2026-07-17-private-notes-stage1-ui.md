# 私密记事独立成发现页子页（阶段 1：UI）

**日期**：2026-07-17
**涉及 commit**：`bbc9825`（已 commit，**push 暂未成功**，github.com 端口连不上，待重试）

## 改了什么

把 RoomApp 侧边栏"生活碎片 → 私密记事"模块抽出来，做成发现页里独立的"私密记事"入口和子页。**当前只完成 UI 阶段，AI 还不会主动写**（阶段 2 才做）。

### 新增

- **`apps/PrivateNotesPage.tsx`**：独立页面，4 种视图（列表/详情）+ 角色筛选 + 搜索
- **`hooks/useRoomNotes.ts`**：共用 hook（抽离 RoomApp 的加载/删除/回复），两边共用
- **`components/notes/NotebookCard.tsx`**：5 种 type 对应 5 种便签样式（暮色参考图）
- **`components/notes/NotebookDetail.tsx`**：全屏详情 + 回复气泡 + 输入框
- **`components/notes/NoteSearchBar.tsx`**：关键词 + 日期范围
- **`components/notes/NotebookBackground.tsx`**：用户上传背景图（base64 存 localStorage）+ 3 种 CSS 默认风格

### 改动

- **`types.ts`**：RoomNote 加 `replies?: NoteReply[]` 字段 + 新 `NoteReply` interface
- **`apps/DiscoverPage.tsx`**：加"私密记事"入口（4 个：朋友圈 / 收藏 / 私密记事 / 日记占位）
- **`apps/RoomApp.tsx`**：改用 `useRoomNotes` hook，**UI 完全不变**（暮色选了 keep-both）

## 5 种便签视觉（暮色参考图）

| type | 中文 | 视觉 |
|---|---|---|
| `thought` | 感想 | 蓝色便签 + 左上角蓝圆钉 |
| `doodle` | 涂鸦 | 白色方格纸 + 右上角粉色折角 |
| `search` | 搜索 | 牛皮纸 + 顶部黑色小钉 |
| `lyric` | 歌词 | 粉色便签 + 顶部回形针 |
| `gossip` | 八卦 | 黄色便签 + 顶部胶带 + 横线 |

每张轻微旋转（-1.2°~+1.2°，按 note.id 哈希稳定不抖动），hover 时归正+放大。

## 3 种默认背景

- 奶油信纸（虚线横线）
- 点状网格
- 牛皮纸

用户可右上角齿轮 → 上传自己的图（自动压到 1080px JPEG 80%，存 localStorage）。

## 当前体验

- 发现页 → 私密记事 → 看到空状态（**因为 AI 还不会主动写**，阶段 2 才做）
- 小小窝侧边栏"生活碎片 → 私密记事" tab 行为/视觉/写入流程**完全不变**（暮色选了 keep-both）
- 用户能对单条便签**回复**（输入框 + 气泡），AI 写的不能编辑

## 踩坑 / 需要知道的

1. **`useRoomNotes` 抽离但 RoomApp 暂保留旧 prompt 注入**：
   - 阶段 1：RoomApp 仍用 `RoomApp.tsx:569` 的 `notebookEntry` schema 写新 note，hook 只接管读/删
   - 阶段 2：删除 RoomApp 旧写入逻辑，AI 改在 `useChatAI` 聊天时通过 `[[PRIVATE_NOTE:...|type]]` token 主动写
   - **避免双处写入冲突**：阶段 2 切换前不要让两路同时写

2. **`RoomNote.replies` 存进 RoomNote 字段不单独建表**：
   - 删除 note 时 `replies` 自动级联
   - 不增加 DB 复杂度
   - 限制：单 note 回复不能太多（< 100 条），目前没限制但心里有数

3. **背景图存 base64 进 localStorage**：
   - 上传时压到 1080px / JPEG 80%
   - 5MB 限制下能存约 10+ 张背景图，够用
   - 不存到 IndexedDB（避免增加同步复杂度，背景只是临时视觉）

4. **`NotebookCard` 旋转角度按 note.id 哈希**：
   - 保证稳定不抖动（每次渲染角度一致）
   - 不随机——避免 React re-render 时便签"跳"

5. **暮色原本"我要手帐信纸" → 改成"用户自己上传背景"**：
   - 暮色中途改主意：原案"暮色提供几张信纸图"，后改"用户自己上传"
   - 实现里保留 3 种 CSS 默认风格兜底（用户没上传时还能用）

## 未完成（阶段 2）

按暮色决定，**阶段 1 先停，UI 测过 OK 再开阶段 2**：

1. `utils/chatPrompts.ts` 加"📒 私密记事"工具说明段（仿朋友圈 line 716-748）
2. `hooks/useChatAI.ts` 加 `[[PRIVATE_NOTE: 内容 | type]]` token 解析（仿 MOMENT_POST 解析 line 2231-2300）
3. `bp3Context` 补 RoomNote 最近列表（让 AI 知道"自己写过的"避免重复）
4. 新建 `utils/noteReminder.ts` 定时提醒工具（localStorage 存提醒时间 + lastReminderDate）
5. useChatAI 接入定时提醒（到点后下次聊天时 system prompt 多"今天 20:00 提醒"段）
6. RoomApp 删旧 `notebookEntry` prompt 注入和解析（走法 1：聊天时 AI 决定写不写）
7. 朋友圈 prompt 确认已有聊天上下文注入（已确认：`useChatAI.ts:698` 的 `limit = char.contextLimit || 500`，**不需要额外改**）

## 备注

- **push 暂未成功**：github.com:443 连不上，可能是代理节点问题。commit `bbc9825` 已在本地，等网络恢复重试。
- 暮色可以本地 `git log` 看 commit hash，部署侧 Vercel 还没拉到这次 commit（push 没成功）。
- 发现页那个"日记"占位**保持原样**（暮色明确说"日记是日记，私密记事是私密记事，不是一个东西"）。
- AI 主动写的具体触发场景清单（暮色确认版）：
  - ✅ 用户某句话触动了你
  - ✅ 看到/听到某事想"沉淀一下"
  - ✅ 距离上次写超过 6 小时且内心有情绪波动
  - ✅ 节日/纪念日/特殊事件
  - ❌ 早上刚醒 / 晚上睡前（暮色去掉）
