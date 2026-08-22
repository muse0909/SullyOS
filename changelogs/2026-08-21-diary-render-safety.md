# 日记渲染保护 + 详情页 UI 收紧

## 背景

暮色 8-21 23:25 反馈 3 件事：
1. 写日记界面崩溃（`Cannot read properties of undefined (reading 'paperStyle')`）
2. 详情页顶栏到白纸距离太大
3. 详情页顶栏角色名字太小

## 改动

### 1. `renderPage` 加保护（修崩溃）

**根因**：8-21 步骤 1 改 `DiaryEntry.userPage` 为 optional 后，JournalApp L822 调用处没加保护：
```tsx
{activeTab === 'user' && currentEntry && renderPage(currentEntry.userPage, 'user')}
```

老 entry 加载时 `userPage` 可能是 undefined → `renderPage(undefined, 'user')` → 访问 `page.paperStyle` 崩。

**修法 1**（L822 + L526）：
```ts
// renderPage 类型改成 optional，加 early return
const renderPage = (page: DiaryPage | undefined, side: 'user' | 'char') => {
    if (!page) return null;
    ...
};

// L822 加保护（跟 L825 charPage 的保护一致）
{activeTab === 'user' && (
    currentEntry?.userPage ? renderPage(currentEntry.userPage, 'user') : (
        <div className="w-full h-full bg-[#252525] rounded-3xl border border-white/5 flex items-center justify-center text-white/40 text-sm">
            等待你的日记
        </div>
    )
)}
```

### 2. 详情页 UI 收紧

```tsx
// 顶栏：pt-12 → pt-10, pb-3 → pb-2（少 12px）
<div className="pt-10 pb-2 px-4 ...">

// 角色名：text-base → text-xl 加大
<h1 className="text-xl font-bold text-white tracking-wide">{selectedChar?.name}</h1>

// 白纸：p-6 → p-5, 容器 px-6 → px-4, pb-6 → pb-4（少 8px）
<div className="flex-1 overflow-y-auto px-4 pb-4 ...">
<div className="bg-[#fffdf5] ... p-5 ...">
```

## 风险

- 老 entry（没有 userPage 但有 charPage）：进入 write 模式时 user tab 显示"等待你的日记"提示，**不崩**——用户可以重新编辑
- 老 entry 反序列化时没 source/title/mood → 详情页 `viewingCharOnly.title` 是 undefined → 不显示标题——OK

## 你需要测的

1. 打开 JournalApp → 选江澈 → 点"写今天的日记" → **不崩溃**（之前会崩）
2. 写点东西保存 → 切到 REPLY 标签 → 等 AI 回复或者直接看老的回复
3. 点 char-only 卡片 → 详情页：
   - 顶栏距白纸距离**缩短**（之前 84px → 现在 ~64px）
   - 角色名**加大**（之前 text-base → 现在 text-xl）
4. 删除详情页里的日记 → 浮层自动关
5. 老的交换日记**没坏**

## 不在本轮做的

- 老 entry 自动修复（无 userPage 字段）——不自动写，避免改用户数据
