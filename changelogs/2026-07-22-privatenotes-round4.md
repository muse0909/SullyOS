# 私密记事 — 第四轮：时间戳+回复按钮贴便签右下角 + prompt 加 emoji/颜文字

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`6721379`（第三轮：修报错 + 输入框交互改造）

## 改了什么

### 1. 时间戳 + 回复按钮挪到便签右下角
暮色看图一：原来时间戳在便签**外**下面居中，回复按钮也在便签**外**下面居中 — 跟便签纸**没关系**。
暮色要："调到图1箭头指着的位置。右下角" — 都贴便签**纸内部右下角**。

操作：
- FullNoteCard 内部新增右下角容器（`absolute bottom-2 right-3 flex items-center gap-2 z-10`）
  - 回复按钮：💬 圆形小胶囊（w-7 h-7）
  - 时间戳：10px 灰字 font-mono
- FullNoteCard 外部 NotebookDetail 不再渲染时间戳 + 回复按钮（删除原代码）
- FullNoteCard 接 `onReplyClick` + `hideReplyButton` props（父组件传 isReplying 控制显隐）
- FullNoteCard padding 改 `p-6` → `p-6 pb-12`（给底部右下角留位置，避免内容贴边）

### 2. prompt 加 emoji / 颜文字指引
暮色放弃"简笔画小表情装饰"思路，改成"在 prompt 里加一行"。

**默认 prompt「核心精神」块末尾加**：
> 正文里偶尔加个 emoji 或颜文字点缀（例：˃̵͈̑ᴗ˂̵͈̑、ʕ •ᴥ•ʔ、*ଘ(੭*ˊᵕˋ)੭*、🥺、☁️、❀）— 别用太多，1-3 个就够，不要每句都加

不夹英文术语（用颜文字举例，不写 "kaomoji"），且强调"别用太多"避免 AI 写满屏 emoji。

## 动了哪些文件
- `components/notes/NotebookDetail.tsx` — FullNoteCard 内部加右下角时间戳+回复按钮 + NotebookDetail 外部对应删除 + FullNoteCard 加 props
- `utils/chatPrompts.ts` — 默认 prompt 段「核心精神」块末尾加 1 行 emoji/颜文字

## 踩坑 / 需要知道的（重要）
- **FullNoteCard padding 留底部** — 改了 `p-6` → `p-6 pb-12`（多 24px 底部内边距），不然时间戳会和正文内容贴边重叠
- **绝对定位 + flex 容器** — 右下角容器用 `flex items-center gap-2` 让时间戳和按钮水平居中
- **z-10 不要漏** — 装饰物（蓝圆钉 -top-2 -left-2）已经 z-10，右下角容器也要 z-10 避免某些 type 装饰物盖住
- **emoji 提示**用颜文字示例 + 简单 emoji，不用专业术语（"颜文字"就行，不写 "kaomoji"）— 暮色全中文偏好

## 备注
- 暮色提到 3 件事里：
  - ✅ 任务 1：时间戳+回复按钮位置 — 已做
  - ⏳ 任务 2：小纸条自定义样式（多分组 + 随机选）— **待拍板**（见下面方案）
  - ✅ 任务 3：prompt 加 emoji/颜文字 — 已做
- 任务 2 方案：
  - localStorage key: `sullyos_notebookStyles: { groups: { [name]: string[] }, activeGroup: string }`
  - SettingsDrawer 加 section：上传按钮 + 分组管理（增/删/重命名）+ 激活组选择
  - 渲染分支：note 渲染时读 activeGroup，从该 group urls 里**渲染时**随机选一张图当便签背景
  - 不动 useChatAI（写入时不存 imageUrl，渲染时随机）
  - **风险**：用户截图导出便签时背景图丢失（因为不是 note 的一部分）
  - 暮色拍板就开干
