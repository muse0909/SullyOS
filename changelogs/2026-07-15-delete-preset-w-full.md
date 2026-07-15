# 删除预设 Modal 按钮加 w-full — 真正铺开

**日期**：2026-07-15
**涉及 commit**：`d9587cb`（待 push）

## 改了什么
- 删除预设 Modal 的两个按钮加 `w-full`，从"两个小圆挤在列左"变成平铺占满整行

## 动了哪些文件
- `components/os/ApiQuickFloat.tsx` —— API 配置悬浮面板里的删除预设 Modal，按钮加 `w-full`
- `apps/Settings.tsx` —— 设置页里的删除预设 Modal，按钮加 `w-full` + grid 容器加 `w-full`

## 踩坑 / 需要知道的（重要）

**为什么前面 4 次都没成功（暮色原话"改了 4 次都没成功"）**

4 个 commit 的演进：
1. `631dd49`：`flex gap-3` → `flex gap-3 mx-2`（按钮被 modal 圆角切，加 mx 让出）
2. `bce3336`：`mx-2` → `mx-4`（24+16=40px = 圆角，胶囊左半圆不被切）
3. `64610e5`：flex → `grid grid-cols-2 gap-3 mx-4`（Settings.tsx）
4. `d5a9854`：同上 pattern 套到 ApiQuickFloat.tsx

**根因**：4 次都只改了 footer **容器**（flex → grid，加 mx-2/mx-4/px-2），漏了按钮本身。

- `grid grid-cols-2` 只是把容器**分两列**，**按钮还得 `w-full` 才能填满列宽度**
- 没 `w-full` 时按钮宽度 = 文字宽度（"取消"/"删除" 各 2 个汉字 + `py-3`），渲染成 ~60px 的小圆
- 两个小圆 + 12px gap 看着就是"挤在列左"，视觉上没"平铺开"

**Settings.tsx 比 ApiQuickFloat.tsx 多一步**

- ApiQuickFloat.tsx 的 modal 是**自定义** div（`relative w-full max-w-sm ... p-5`），grid 容器是 block 子项，**默认撑满**，只加按钮 `w-full` 就够
- Settings.tsx 的 modal 用**项目级 `Modal` 组件**，`components/os/Modal.tsx:34` 把 footer 包在 `<div className="px-6 pb-6 flex gap-3 shrink-0">` 里 —— grid 容器是 **flex 子项，默认不撑满**
- 所以 Settings.tsx 的 grid 容器本身也得加 `w-full`，否则 flex 容器不知道给 grid 多少宽度，flex 子项会按内容收缩

**参考 pattern**：`components/chat/ChatModals.tsx:435` 消息操作弹窗
```jsx
<div className="grid grid-cols-2 gap-3">
  <button className="w-full py-3 ...">...</button>
  <button className="w-full py-3 ...">...</button>
</div>
```
注意：那个弹窗 `footer={<></>}`（不放 footer），按钮放在 body 里。body 是 block 容器，grid 子项默认撑满，所以不需要额外 `w-full`。**我们这个 case 是 footer，grid 在 flex 容器里，要多一步。**

## 备注
- 暮色 2026-07-15 反馈"挤在一起"，明确要"平铺开像左边的消息操作弹窗"
- 视觉对照：左边消息操作弹窗（ChatModals.tsx:435）6 按钮 2 列 × 3 行，每按钮 w-full 填满列
- 后续如果再写"两个按钮的 footer"，**直接抄 Settings.tsx 这个 pattern**：`grid` 容器 + `w-full`，按钮也 `w-full`
