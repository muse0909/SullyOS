# 收藏页返回按钮"点着没反应" — Header h1 -ml-9 覆盖 button

**日期**：2026-07-02
**涉及 commit**：`0d66bd9`
**前置 commit**：`4ad59f3`（preview HEAD）

---

## 问题

暮色反馈：
- 收藏页左上角 CaretLeft 返回按钮"点着没反应"
- **朋友圈 / 日记 的返回按钮都正常**（同样的 onBack={() => setSubPage('list')} 模式）
- 硬刷新 + 无痕模式 + 两个浏览器都试了都不行

## 根因

`apps/FavoritesPage.tsx` 第 60-71 行 Header 用了"标题居中"常见写法：

```tsx
<div className="flex items-center px-3 py-3 bg-white ...">
  <button onClick={onBack} className="w-9 h-9 ...">←</button>
  <h1 className="flex-1 text-center ... -ml-9">收藏</h1>   ← 问题在这
  <div className="w-9 h-9" />
</div>
```

**问题分解**：
- `flex-1` 让 h1 占满剩余空间 = container - 36 - 36 = container - 72
- `-ml-9` (margin-left: -36px) 把 h1 盒子**向左推 36px**
- 结果：h1 实际从 left=0 开始，**完全覆盖 button 区域**（button 是 left=0..36）
- DOM 顺序 button → h1 → div，h1 在 z 轴上层
- 点 button 时事件**冒泡到 h1**，h1 没有 onClick → 事件被吃掉 → 没反应

## 为什么朋友圈/日记正常

- `apps/MomentsPage.tsx` 第 233 行：`flex items-center justify-between` + 没有 -ml-X
- `apps/DiscoverPage.tsx` 第 31 行（日记占位页）：`flex items-center justify-between` + 没有 -ml-X

这两个用 `justify-between` 三栏分散对齐，h1 不需要负 margin 居中，**完全不重叠**，所以正常。

## 修法

跟朋友圈/日记保持一致：

```tsx
<div className="flex items-center justify-between px-3 py-3 bg-white ...">
  <button onClick={onBack} className="w-9 h-9 ...">←</button>
  <h1 className="text-base font-semibold ...">收藏</h1>
  <div className="w-9 h-9" />
</div>
```

- 去掉 `flex-1 + -ml-9`
- 加 `justify-between`
- h1 自动居中（自然占中间），无重叠

## 排查过程

1. 第一轮：看代码 + build 验证 + 搜 pointer-events / z-index / backdrop-filter → 都 OK，build 通过
2. 第二轮：硬刷新 / 无痕 / 跨浏览器都试了 → 还不行
3. 第三轮（找到根因）：对比朋友圈/日记的 Header，发现**只有收藏页用 -ml-9**，朋友圈/日记用 justify-between → 计算 h1 盒子位置 → 发现 h1 完全覆盖 button → 验证 z 轴顺序 → 确认事件冒泡被吃

**教训**：CSS 负 margin + DOM 顺序 的组合陷阱，肉眼不可见但实际影响事件分发。
- 排查时优先用"对比正常工作的兄弟组件"找差异点（朋友圈/日记 vs 收藏页）
- 不要被"代码看起来对 / build 通过"误导，runtime 的事件分发不在静态分析范围内

## 文件改动清单

- `apps/FavoritesPage.tsx`：Header 改 justify-between，去掉 h1 flex-1 + -ml-9
  - 第 60-71 行 → 第 61-72 行（净 +1 行：注释说明）

## 备注

- 这是 CSS 通用坑，跨项目适用 —— memory 里之前没记到，已尝试 append 但 mavis daemon 卡了，下次顺手补上
- 类似模式（`-ml-X` 让标题居中）如果项目里还有其他地方，需要 audit 一下