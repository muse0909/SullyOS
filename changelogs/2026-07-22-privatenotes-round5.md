# 私密记事 — 第五轮：改名"小纸条" + 自定义样式方案 B + 文字居中避盖图

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`c8c194d`（第四轮：右下角 + emoji/颜文字）

## 改了什么

### 1. 全局 UI 改名："私密记事" → "小纸条"
暮色 2026-07-22：UI 文字全改（不改文件/类型/注释）。

6 处用户可见文字：
- `apps/PrivateNotesPage.tsx:87` confirm 弹窗："确定删除这条小纸条？回复也会一起删除。"
- `apps/PrivateNotesPage.tsx:117` 列表页标题：`<h1>小纸条</h1>`
- `apps/PrivateNotesPage.tsx:355` 空状态文案："小纸条还是空的"
- `apps/RoomApp.tsx:1190` 小小窝侧边栏按钮："小纸条"
- `apps/DiscoverPage.tsx:117` 发现页入口："小纸条"
- `components/notes/NotebookDetail.tsx:102` 详情页标题：`${charName} · 小纸条`

不动的：文件/类型名（`PrivateNotesPage.tsx`/`NotebookDetail.tsx`/`RoomNote`/`PRIVATE_NOTE` token）、开发注释、内部变量。

### 2. 自定义小纸条样式（方案 B）
暮色选 B：写入时存图，便签背景稳定。

#### 数据结构
`localStorage['sullyos_notebookStyles']`:
```ts
{
  groups: { [groupName: string]: string[] },  // 分组名 → base64 列表
  activeGroup: string | null,                  // 激活分组（null = 用 type 默认）
}
```

#### 新增文件 `utils/notebookStyles.ts`
- `getStoredNotebookStyles()` / `setStoredNotebookStyles()` — 安全读写（try/catch + 字段校验）
- `pickRandomStyleImage()` — useChatAI 解析 PRIVATE_NOTE 时调
- `compressImageForNote(file)` — 1080px 宽压缩，PNG 保留 alpha

#### `types.ts` RoomNote 加 optional 字段
```ts
styleImageUrl?: string;  // 写入时随机选图存，便签背景用图覆盖
```

#### `hooks/useChatAI.ts` 解析 PRIVATE_NOTE 时
```ts
const newNote: RoomNote = {
    id: `note-${Date.now()}`,
    charId: char.id,
    timestamp: Date.now(),
    content,
    type,
    styleImageUrl: pickRandomStyleImage(),  // ← 新增
};
```

#### `NotebookCard` / `FullNoteCard` 渲染分支
- `note.styleImageUrl` 存在 → `backgroundImage: url(xxx); backgroundSize: cover; backgroundPosition: center`
  - 文字 `text-center` + 白色 + `drop-shadow`（深浅背景都看得清）
  - 加大 padding（`p-8 pb-14` FullNoteCard / `pt-7` NotebookCard）让出四周装饰空间
- 不存在 → fallback type 默认色 + 左对齐（保留原视觉）

### 3. SettingsDrawer 加「小纸条样式」section
位置：在"背景区"和"AI 写小纸条的指导"之间。

UI 元素：
- 描述：白话 + 提示「推荐 PNG 格式，四周留白多一点，文字会居中」
- 激活分组下拉框（"未激活" + 已有分组）
- "删组"按钮（删当前激活组及里面所有图）
- 新建分组输入框 + "新建"按钮（重名会 alert）
- 当前组图片缩略图网格（点击 `×` 删除单图）
- "上传图片到当前组"按钮（PNG 优先 / 其他图片格式 fallback JPEG）
- 底部状态："当前激活：XXX（N 张）" / "未激活分组 — 用 type 默认颜色"

### 4. 文字居中 + 加大 padding（避免盖到四周图）
暮色画的"四周有图那种"——padding 加大（FullNoteCard `p-6` → `p-8 pb-14`，NotebookCard `p-3.5 pt-7` 保持）+ 文字 `text-center` + 白字 + drop-shadow，让四周装饰图有空间不被文字压。

## 动了哪些文件
- `apps/PrivateNotesPage.tsx` — 3 处改名 + SettingsDrawer 加新 section + 新 state/handler
- `apps/RoomApp.tsx` — 1 处改名
- `apps/DiscoverPage.tsx` — 1 处改名
- `components/notes/NotebookDetail.tsx` — 1 处改名 + FullNoteCard 渲染分支
- `components/notes/NotebookCard.tsx` — 渲染分支
- `utils/chatPrompts.ts` — 不动（之前已通用化）
- `utils/notebookStyles.ts` — **新文件**（90 行）
- `types.ts` — RoomNote 加 styleImageUrl
- `hooks/useChatAI.ts` — 解析 PRIVATE_NOTE 时调 pickRandomStyleImage

## 踩坑 / 需要知道的（重要）

### 影响面（按 memory lesson 提前分析）
- **`types.ts` RoomNote 加 optional 字段** — 旧数据没有这个字段，TypeScript 读 `note.styleImageUrl` 时 undefined，渲染走 fallback 分支，**完全向后兼容**
- **`useChatAI.ts` 改 PRIVATE_NOTE 写入逻辑** — 这是改**共享写入路径**（所有 LLM 调用的最后都走这）。但只**增加一个字段赋值**，不改 token 解析、不改 push message、不改其他 token 处理。**风险低**，但要重点回归测试
- **localStorage 容量** — base64 图每张 ~100-300KB（1080px 宽 JPEG 80%），5-10MB 上限能放 30-100 张图。压缩到 1080px 宽已经够用，**不要让用户传原图**
- **activeGroup 引用稳定性** — `pickRandomStyleImage()` 用 `Math.random()` 选图，**新 note 创建时一次决定**，存到 `note.styleImageUrl` 永久稳定。换激活组只影响**新便签**，老便签背景不变（这是方案 B 的核心优势）

### 命名/UI 一致性
- **不绑死暮色名字** — UI 描述用「对方」不用「暮色」，琪琪那边也通用
- **全中文文案** — SettingsDrawer 描述用白话："上传你自己画的小纸条图，AI 写时从激活分组里随机选一张当背景，文字会居中显示"，不夹英文
- **PNG 优先** — `compressImageForNote` 检查 file.type，原图是 PNG 用 PNG 输出（保留 alpha），其他用 JPEG 80%
- **文字 + drop-shadow 适配深浅背景** — 暮色的图可能不均匀，单纯白字 + drop-shadow 比"自选深浅"实现简单，视觉也稳

### 渲染顺序
- **不挡装饰物** — FullNoteCard 内部右下角容器 z-10，便签纸内 z-10 在背景图之上；蓝圆钉等 type 装饰物也是 z-10 不变
- **缩略图 object-cover** — 上传的图片可能比例不一，缩略图统一 object-cover 看起来整齐

## 备注
- 暮色提的 3 件事全做完了
- 任务 2 范围比较大（改了 types/useChatAI/2 个渲染组件/SettingsDrawer/新建 utils 文件），但都是"增加 optional 字段"或"增加新 section"，**不破坏现有数据**
- 下次回归重点：
  1. 列表页 + 详情页老便签（无 styleImageUrl）走 type 默认色 — 应无变化
  2. AI 写新便签时如果激活组有图 → 新便签有 styleImageUrl → 背景用图
  3. SettingsDrawer 上传 PNG → 缩略图显示 → 删除单图 → 删除整组 — 都正常
  4. "AI 写小纸条的指导"prompt 设置还在
- 暮色 2026-07-14 全中文偏好继续遵守（描述、提示、按钮文字都不夹英文）
