# 日记 v1 步骤 4：容错增强 + char-only 详情页

## 背景

暮色 8-21 23:09 反馈：
1. **卡片内容是 `<think>Let me analyze the context car...`** —— LLM（Qwen/DeepSeek/GLM）默认带 <think>...</think> 思维链，3 重 JSON 容错全部失败，content 兜底为 raw text
2. **char-only 卡片点不进去** —— 步骤 3 暂用 toast 占位，步骤 4 改真正的详情页

## 改动文件

### 1. `utils/charDiary.ts` — 容错增强

加 `stripThinkTags(text)`，在 JSON 解析前先剥掉 `<think>...</think>`：

```ts
function stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
```

`parseDiaryFromApi` 改成：
```ts
const cleaned = stripThinkTags(text);
// 后面 3 重容错全用 cleaned
```

兜底也用 `cleaned`（不再用 raw text）。

### 2. `types.ts:1370` — `DiaryEntry` 加 `title` 字段

```ts
title?: string;   // 角色独白日记存 JSON 里的 title
```

老数据（步骤 1 之前生成的、含 think 标签的坏数据）`title` 是 undefined → 详情页显示 `(无标题)` 占位。

### 3. `utils/charDiary.ts` — `generateCharDiary` 存 title

```ts
const entry: DiaryEntry = {
    ...
    mood: parsed.mood,
    title: parsed.title,   // ← 之前丢了，现在存
};
```

### 4. `apps/JournalApp.tsx` — char-only 详情页浮层

**state**：
```ts
const [viewingCharOnly, setViewingCharOnly] = useState<DiaryEntry | null>(null);
```

**卡片点击改**：
```tsx
onClick={() => {
    if (isCharOnly) {
        setViewingCharOnly(d);   // 打开详情页浮层
        return;
    }
    openEntry(d.date);
}}
```

**handleDeleteDiary 末尾**：如果删的是当前查看的，关闭浮层
```ts
if (viewingCharOnly?.id === deletingDiary.id) {
    setViewingCharOnly(null);
}
```

**浮层 UI**（黑底 inset-0 z-50，calendar 视图末尾）：
- 顶栏：返回按钮 / 日期 / 删除按钮
- 主体：白纸背景（点阵底纹，跟 JournalApp 整体风格一致）
  - 大标题（`viewingCharOnly.title`）
  - 心情 badge（`viewingCharOnly.mood`）+ 日期小字
  - 正文（`charPage.text`，whitespace-pre-wrap 保留换行）

## 风险

- **老坏数据（步骤 1 之前的）**：title 是 undefined，详情页显示 `(无标题)`；content 是 raw think 文本
  - **不自动清理**（避免自动修改用户数据），暮色手动删
- **重生成的新数据**：title 字段已存 + 容错剥 think 标签 → 干净

## 你需要测的

打开 JournalApp → 选江澈：
1. **手动删掉旧的坏数据**（点那张紫色卡片旁边垃圾桶 → 确认删除）
2. 点"现在让 TA 写一篇" → 重新生成
3. **新卡片预览**应该**不包含** `<think>` 字样，是干净的 JSON 解析结果
4. 点新卡片 → 详情页浮层打开 → 看到：
   - 标题（h2 大字）
   - 心情（紫色 badge）
   - 日期
   - 完整正文（保留换行）
5. 详情页右上删除按钮 → 弹出确认 → 删完浮层自动关，列表更新
6. 老的交换日记卡片**完全没坏**

## 不在本轮做的

- tab 切换（"交换日记" / "TA 的日记"）— 暂时不需要，目前两个都混在列表里，靠 badge 区分
- 定时自动写（借 ProactiveChat）— v1.1
- 偷看机制 — v1.1
