# 写模式重构：顶栏 5 按钮 + 一张 paper 卡片 + 自动回复

## 背景

暮色 8-22 反馈：
1. 归档失败 `Cannot read properties of undefined (reading 'text')` —— 老 entry 的 `userPage` 是 undefined
2. write 模式顶栏上方空档太大（`pt-12 h-24` 多余）
3. write 模式要按图 3 重构：取消底部两个 tab、5 个按钮放顶栏、user + char 接同一张 paper、textarea 拉长到底部
4. char-only 也要归档到记忆

## 改动

### 1. 归档 bug 修复（`apps/JournalApp.tsx:460-471`）

```ts
// 之前
await injectMemoryPalace(selectedChar, undefined, currentEntry.userPage.text);   // ← userPage undefined 崩
"${currentEntry.userPage.text}"   // ← 同样

// 现在
const userText = currentEntry.userPage?.text || '';
await injectMemoryPalace(selectedChar, undefined, userText);
"${userText}"
```

### 2. char-only 归档到记忆（`utils/charDiary.ts:268` 后）

```ts
await DB.saveDiary(entry);
// 暮色 2026-08-22：char-only 也归档到记忆宫殿（跟交换日记归档逻辑一致，但不弹按钮）
if (parsed.content && parsed.content.trim()) {
    try {
        await injectMemoryPalace(char, undefined, parsed.content);
    } catch (e) {
        console.warn('char-only 归档到记忆失败（不影响主流程）:', e);
    }
}
```

不弹归档按钮——自动调。`try/catch` 包住：归档失败不影响主流程（不写不进 IndexedDB 的"已生成"状态）。

### 3. write 模式大改（`apps/JournalApp.tsx:780-978`）

**新结构**：
- 顶栏（紧凑 `pt-10 pb-2`）：返回 · 4 信纸圈 · 贴纸 · 归档记忆 · 保存
- 主区域：一张 paper 卡片（顶到顶栏下方），里面 user 段（MY DIARY）+ char 段（REPLY · 角色名）上下接排
- 底部：textarea 输入框（拉长，min-h 100px，safe-area 留白）
- 贴纸面板：浮在底部之上（`absolute bottom-[140px]`）

**新 handler `handleSave`**：
```ts
const handleSave = async () => {
    if (!currentEntry) return;
    if (!currentEntry.userPage?.text?.trim()) {
        addToast('请先写下日记', 'info');
        return;
    }
    if (currentEntry.charPage) {
        // 已有回复，只保存 userPage 改动
        await DB.saveDiary(currentEntry);
        await loadDiaries(currentEntry.charId);
        addToast('日记已保存', 'success');
        return;
    }
    // 还没回复，调 handleExchange（它会保存 + 生成 charPage + 再保存）
    await handleExchange();
};
```

**自动回复流程**：用户点"保存" → 检查 charPage 是否存在 → 不存在则自动调 `handleExchange` 生成 AI 回复 → 存在则只保存 userPage。

**`activeTab` state 保留**（addSticker 用），但 UI 不显示 tab。

**JSX 结构**：
```tsx
return (
    <>
    <div className="h-full w-full bg-[#1a1a1a] flex flex-col relative overflow-hidden">
        <顶栏>
        <主区域：paper 卡片>
        <底部：textarea>
        {showStickerPanel && <浮层贴纸面板>}
    </div>
    <StickerImportModal />   ← 之前在 return 外，改成 <> 包裹
    <StickerDeleteModal />
    </>
);
```

### 4. return 结构调整

`Modal`（StickerImport / StickerDelete）原本是 write 模式 return 内的兄弟元素。我替换时**漏了** Modal 范围——L944-945 的 `</div></div>);` 重复了 outer container 关闭。修复：把 outer `<div>` + Modal 用 `<>...</>` fragment 包裹。

## 风险

- **handleSave 自动触发 handleExchange**：意味着用户点保存后必须等 LLM 返回（几秒到几十秒）。按钮变 "生成中..."，禁用——已有 `isThinking` 状态处理
- **老 entry 加载**：写模式 paperStyle 默认 fallback 到 `PAPER_STYLES[0]`（白纸）—— 不会崩
- **write 模式大改**：可能影响老用户熟悉度。**但**新流程更直接（不切 tab 就看 user + char 同屏）

## 你需要测的

1. 打开 JournalApp → 选江澈 → 选一条**老 exchange 日记**（可能 userPage 是 undefined）→ 写模式不崩
2. 点"归档记忆" → **不报错**了（之前会报 `Cannot read properties of undefined`）
3. **新建交换日记**：底部输入框写日记 → 点"保存" → 按钮变"生成中..." → AI 回复自动生成显示在 paper 卡片下半部分
4. **已经有回复的 entry**：再点"保存" → 只保存 userPage 改动（不重新生成 AI 回复）
5. 顶栏 5 个按钮横排：返回 · 4 信纸圈 · 贴纸 · 归档记忆 · 保存
6. paper 卡片顶到顶栏下方（**没空档**）
7. textarea 拉长到底部（`min-h-100px`）
8. 切信纸样式时只影响 userPage（`updatePage({ paperStyle }, 'user')`）—— AI 回复区不跟着变（用 userPage 的 paperStyle 渲染整张卡片）

## 不在本轮做的

- 老 entry 自动修复（无 userPage 字段）—— 不自动写，避免改用户数据
- 列表页 tab 切换（问题 3）—— 下一轮
