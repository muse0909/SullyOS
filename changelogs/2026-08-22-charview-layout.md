# char-only 详情页：顶栏布局调整 + 信纸固定框

## 背景

暮色 8-22 反馈：
- 顶栏：角色名字靠左，归档靠右挨着删除
- 信纸像用户日记那样固定框，文字在信纸中滑动

## 改动（`apps/JournalApp.tsx:782-836`）

### 1. 顶栏布局

```tsx
// 之前
<div className="flex items-center justify-between">
    <button>←</button>
    <h1>{name}</h1>     {/* 居中 */}
    <div>归档 + 删除</div>
</div>

// 现在
<div className="flex items-center">
    <button>←</button>
    <h1 className="ml-2">{name}</h1>   {/* 靠左，紧贴返回 */}
    <div className="ml-auto flex items-center gap-2">归档 + 删除</div>   {/* 靠右 */}
</div>
```

去掉了 `justify-between`（不再三段平均分布），角色名直接贴在返回按钮右边，归档和删除用 `ml-auto` 推到最右。

### 2. 信纸固定框 + 文字区独立滚动

```tsx
// 之前
<div className="flex-1 overflow-y-auto ...">       {/* 外层滚动 */}
    <div className="bg-[#fffdf5] ... min-h-full">  {/* paper 拉满屏幕 */}
        ... 整段内容放里面，外层滚动
    </div>
</div>

// 现在
<div className="flex-1 overflow-hidden flex flex-col">  {/* 外层不再滚动 */}
    <div className="bg-[#fffdf5] ... flex-1 min-h-0 flex flex-col overflow-hidden">  {/* paper 固定大小 */}
        <div className="shrink-0">标题 + 心情 + 日期</div>  {/* 固定不滚 */}
        <div className="flex-1 overflow-y-auto no-scrollbar">  {/* 只有正文区滚动 */}
            {content}
        </div>
    </div>
</div>
```

**关键**：
- paper 容器 `flex-1 min-h-0 overflow-hidden`（占满中间区域，自身不滚）
- 标题/心情/日期 `shrink-0`（固定不滚）
- 正文区 `flex-1 overflow-y-auto`（独立滚动）

## 风险

- 老 entry 没 `title` / `mood` 字段 → 头部 `shrink-0` 区域可能极小，正文区几乎占满 paper —— OK
- 短日记（< 1 屏）→ 正文区不会出现滚动条 —— OK

## 测点

1. 进 char-only 详情页：顶栏"江澈"靠左（紧贴返回），"归档"和"删除"在右侧
2. 短日记：信纸固定不出现滚动条
3. 长日记：信纸**不滚动**，但**正文区**内部能上下滚动
4. 标题 + 心情 + 日期固定不动，只有正文滚
