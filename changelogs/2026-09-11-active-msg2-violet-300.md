# 2026-09-11 归档：主动消息 2.0 弹窗按钮换成浅紫（violet-300）

## 改了什么

暮色 9-11 反馈"原作者主动消息 2.0 按钮是玫红色（`bg-fuchsia-500`）要换成浅紫色"，对应文件是 `components/chat/ActiveMsg2SettingsModal.tsx`（不是 `ProactiveSettingsModal.tsx`，那是 1.x 时代老弹窗）。

把所有 fuchsia 改成 violet-300（浅紫罗兰），文字 `text-white` 改 `text-violet-800`（深紫+浅紫对比度好）。

## 涉及文件

### components/chat/ActiveMsg2SettingsModal.tsx（主动消息 2.0 弹窗）
- 主按钮（保存/关闭 2.0）：`bg-fuchsia-500 text-white` → `bg-violet-300 text-violet-800`
- 推送状态框背景：`bg-fuchsia-50 border-fuchsia-100` → `bg-violet-50 border-violet-100`
- 推送状态文字：`text-fuchsia-600` → `text-violet-600`
- 启用 2.0 开关（启用时）：`bg-fuchsia-500` → `bg-violet-300`
- 模式选项（选中时）：`bg-fuchsia-500 text-white border-fuchsia-500` → `bg-violet-300 text-violet-800 border-violet-300`
- 模式选项副文字（选中时）：`text-fuchsia-50` → `text-violet-50`
- recurrence 选项（选中时）：`bg-fuchsia-500 text-white border-fuchsia-500` → `bg-violet-300 text-violet-800 border-violet-300`
- 副 API 开关（开启时）：`bg-fuchsia-500` → `bg-violet-300`

## 验证

`npx vite build` 通过 4.34s

## 跟之前那笔的关系

之前 commit `b18ad881`（`style(proactive): 主按钮/开关/选择按钮换成浅紫 violet-300`）改的是 `ProactiveSettingsModal.tsx`（1.x 老弹窗），原色就是 `bg-violet-500` 紫罗兰，**不是 2.0 弹窗**。暮色 9-11 明确说"主动消息 2.0 按钮原色是玫红色"——指的就是 `ActiveMsg2SettingsModal.tsx`。

**这笔把 1.x 老弹窗的改动也一起带上了**（不撤）——因为 1.x 老弹窗原色（紫罗兰）跟 2.0 弹窗原色（玫红）本来就是不同色系，1.x 改成浅紫不冲突。如果你想让 1.x 弹窗保留原色（紫罗兰），跟我说一声我 revert `b18ad881`。

## 完整色系

| 弹窗 | 主按钮原色 | 改后 |
|---|---|---|
| 主动消息 1.x（`ProactiveSettingsModal`）| violet-500 紫罗兰 | violet-300 浅紫罗兰 |
| 主动消息 2.0（`ActiveMsg2SettingsModal`）| fuchsia-500 玫红 | violet-300 浅紫罗兰 |
| 主动消息全局设置（`ActiveMsgGlobalSettingsModal`）| violet-500 紫罗兰 | violet-300 浅紫罗兰 |
