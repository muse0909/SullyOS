# 写模式内容隔离 + calendar 顶栏两行重排

## 背景

暮色 8-22 反馈 2 件事：
1. 写模式 REPLY 段错误显示 char-only 内容（图 1）—— 写今天的日记**总是**新建 exchange，不复用 char-only
2. calendar 顶栏改成两行：第一行返回+名字，第二行两个按钮（不和返回键同一行）

## 改动（`apps/JournalApp.tsx`）

### 1. 写模式内容隔离 bug

**根因**：`openEntry(getLocalDateStr())` 走"写今天的日记"，但如果今天**已有** entry（**包括 char-only**）会**复用**——导致写模式 REPLY 段错误显示 char-only 内容。

**修法**：拆成两个函数
- `openEntry(date)`：**只**复用 source != 'char-only' 的已有 entry（列表点 exchange 卡片用）
- `openExchangeForToday()`：**总是**新建 exchange entry，不复用任何东西

```ts
const openEntry = (date: string) => {
    const existing = diaries.find(d => d.date === date && d.source !== 'char-only');
    if (existing) {
        setCurrentEntry(existing);
        setActiveTab(existing.charPage ? 'char' : 'user');
    } else {
        // 新建 exchange
    }
    ...
};

const openExchangeForToday = () => {
    setCurrentEntry({
        id: `diary-${Date.now()}`,
        ...
        source: 'exchange',  // ← 显式标记
    });
    setMode('write');
};
```

"写今天的日记"按钮 onClick 改成 `openExchangeForToday`，列表卡片 onClick 用 `openEntry(d.date)`。

### 2. calendar 顶栏两行重排

**之前**：
```
[←]                                    [江澈 536]
EXCHANGE DIARY
江澈
（顶栏结束）
+ 写今天的日记        ← 大虚线按钮
+ 现在让 TA 写一篇   ← 大虚线按钮
（日记列表）
```

**现在**：
```
[←] 江澈 536                          [count]
[+写今天的日记]    [+让他写一篇]   ← 第二行紧凑按钮
（日记列表）
```

**代码**：
```tsx
<div className="pt-12 pb-4 px-6 bg-amber-500 ...">
    {/* 第一行：返回 + 角色名（紧贴）+ count */}
    <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setMode('select')}>←</button>
            <h1 className="text-2xl font-bold tracking-tight text-white truncate">{selectedChar.name}</h1>
        </div>
        <div className="text-white/70 text-xs font-mono shrink-0 ml-2">
            {diaries.filter(d => d.source !== 'char-only').length}
        </div>
    </div>
    {/* 第二行：两个按钮（横排，紧凑） */}
    <div className="flex gap-2">
        <button onClick={openExchangeForToday} className="flex-1 py-2.5 ...">+ 写今天的日记</button>
        <button onClick={handleGenerateCharDiary} className="flex-1 py-2.5 ...">✨ 让他写一篇</button>
    </div>
</div>
```

**关键决策**：
- 删除"EXCHANGE DIARY"副标题——简化为角色名
- 角色名 `truncate` 防止长名字挤压按钮
- 第二行按钮**横排** + `flex-1` 等分宽度
- "写今天的日记"边框白色（跟背景协调），"让他写一篇"边框紫色（区分来源）

## 风险

- 长角色名 truncate 显示"..."（最多 6-8 个字）
- count 数字跟角色卡片列表角标（536）可能不同——这里显示的是"exchange 数量"
- "写今天的日记"按 `openExchangeForToday` **总是新建**——如果今天已有 exchange entry，会创建第二条（id 不同 date 相同），同一天多条是允许的（v1.1 改去重）

## 测点

1. **写模式隔离**：点"写今天的日记" → REPLY 段显示"写完点保存"（不再误显示 char-only 内容）
2. **写模式自动回复**：写日记 → 点保存 → AI 回复显示在 REPLY 段（是 handleExchange 生成的，不是 char-only）
3. **顶栏两行**：
   - 第一行：返回 + "江澈 536"（角色名）
   - 第二行：两个按钮并排
   - 角色名不挤压按钮
4. **写今天的日记按钮**：点 → 进入写模式，REPLY 段干净（不显示历史 char-only 内容）
5. **让他写一篇按钮**：点 → loading → toast + 列表出现新日记
6. **老数据兼容**：列表里的 exchange 卡片能正常打开（openEntry 走复用流程）

## V1 收工确认

日记 v1 + 这两个修复 = 完整闭环。
