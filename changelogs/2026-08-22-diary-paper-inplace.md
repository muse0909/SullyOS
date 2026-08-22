# 写模式 paper 卡片一体 + char-only 详情页手动归档

## 背景

暮色 8-22 反馈：
1. 输入框不要，直接把信纸拉到底，输入光标直接在信纸上
2. 1-7 OK 了
3. char-only 详情页没看到归档按钮，加一个手动归档

## 改动

### 1. 写模式 paper 卡片一体（`apps/JournalApp.tsx:859-907`）

**之前**：顶栏 + paper 卡片（中间）+ textarea 独立底部
**现在**：顶栏 + paper 卡片（一直延伸到屏幕底部，无独立 textarea）

```tsx
// 之前：底部独立 textarea
<div className="shrink-0 bg-[#222] border-t ... pb-safe">
    <textarea ... />   // 用户在 textarea 里写
</div>

// 现在：MY DIARY 段里 textarea + paper 卡片 flex-1
<textarea
    value={currentEntry?.userPage?.text || ''}
    onChange={e => updatePage({ text: e.target.value }, 'user')}
    placeholder="写下今天的日记..."
    className="w-full bg-transparent resize-none outline-none leading-loose text-[15px] placeholder:opacity-30 no-scrollbar ${currentPaperStyle.text}"
    style={{ minHeight: '180px' }}
/>
```

**关键**：
- paper 卡片**flex-1**（中间区域占满到屏幕底部）
- MY DIARY 段里 textarea **bg-transparent + border-none + resize-none**——视觉上跟 paper 一体
- 光标"在信纸上" = 在 paper 卡片里的 textarea 上
- REPLY 段在 MY DIARY 下方，readOnly

### 2. char-only 详情页手动归档

**新 handler**（`apps/JournalApp.tsx:544-562`）：

```ts
const handleArchiveCharOnly = async () => {
    if (!viewingCharOnly || !selectedChar) return;
    const content = viewingCharOnly.charPage?.text;
    if (!content) { addToast('没有内容可归档', 'info'); return; }
    setIsArchiving(true);
    try {
        await injectMemoryPalace(selectedChar, undefined, content);
        const updated = { ...viewingCharOnly, isArchived: true };
        setViewingCharOnly(updated);
        await DB.saveDiary(updated);
        await loadDiaries(selectedChar.id);
        addToast('已归档至记忆库', 'success');
    } catch (e: any) {
        addToast(`归档失败: ${e.message}`, 'error');
    } finally {
        setIsArchiving(false);
    }
};
```

**与 handleArchive 的区别**：
- `handleArchive`（写模式）调 LLM 摘要后加到 `char.memories`
- `handleArchiveCharOnly`（详情页）**直接**调 `injectMemoryPalace` 存原文（不摘要）

**UI**：`viewingCharOnly` 顶栏加"归档"按钮（删除按钮**之前**），已归档不显示。

## 风险

- **paper 卡片一体 + textarea 嵌入**：textarea 默认有滚动条（`no-scrollbar` 解决）、resize 把手（`resize-none` 解决）、背景色（`bg-transparent` 解决）、边框（默认无）。**可能** 在某些 paperStyle 下视觉略有违和
- **char-only 归档**走和写模式归档不同的逻辑（不调 LLM 摘要）—— 暮色如果想要统一可以反馈

## 你需要测的

1. **写模式新 UI**：
   - paper 卡片**直接拉到屏幕底部**（没独立 textarea）
   - 顶部 MY DIARY 段里点 → 光标在 paper 上 → 直接打字（无独立输入框）
   - paper 卡片里 user + char 内容**接在同一个 paper**
   - **REPLY 段**在 MY DIARY 下方，是只读的
2. **char-only 详情页手动归档**：
   - 点 char-only 卡片进详情页
   - 顶栏中间是角色名，**右边是「归档」按钮 + 删除按钮**
   - 点归档 → toast "已归档至记忆库" → 按钮消失
   - 已归档的日记**不显示**归档按钮

## V1 收工

日记 v1 整体收工。包含：
- AI 角色自动写日记（手动触发）
- 用户日记 + AI 回复同屏 write 模式
- char-only 详情页 + 下载 + 归档
- 栈式 JSON 容错 + `` 标签剥离
- OSContext parent 字段（相册/情侣空间返回发现页）
- WeChat tab 持久化
- 发现页加相册入口
- 相册 3 tab：用户图 / AI 图（chip 切）
- 详情页 + 下载按钮（详情 + 多选）

**下一步候选**（暮色原话："然后下一步该做什么了？"）：
1. 列表页 tab 分隔（暮色 8-22 说"3 重新写方案，下一轮做"）
2. 定时自动写（借 ProactiveChat）
3. 偷看机制（聊天时按概率%触发）
4. RoomApp 记事簿 UI Markdown 解析器还原（8-7 存的）
5. 其他暮色想做的
