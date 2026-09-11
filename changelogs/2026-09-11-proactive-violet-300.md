# 2026-09-11 归档：主动消息弹窗按钮换成浅紫（violet-300）

## 改了什么

暮色要"浅紫色"按钮，把 `bg-violet-500`（#8b5cf6 紫罗兰）全部换成 `bg-violet-300`（#c4b5fd 浅紫罗兰），文字 `text-white` 改 `text-violet-800`（深紫，跟浅紫背景配，对比度好）。

## 涉及文件

### components/chat/ProactiveSettingsModal.tsx（主动消息弹窗）
- 主按钮（保存/启动）：`bg-violet-500 text-white` → `bg-violet-300 text-violet-800`
- 启用开关（启用时）：`bg-violet-500` → `bg-violet-300`
- 状态指示器小点：`bg-violet-500` → `bg-violet-300`
- 间隔选择按钮（选中时）：`bg-violet-500 text-white` → `bg-violet-300 text-violet-800`
- 睡眠时间开关（开启时）：`bg-violet-500` → `bg-violet-300`
- 副 API 开关（开启时）：`bg-violet-500` → `bg-violet-300`
- 角色独立 API 开关（开启时）：`bg-violet-500` → `bg-violet-300`

### components/settings/ActiveMsgGlobalSettingsModal.tsx（主动消息全局设置）
- "开启通知与推送"按钮：`bg-violet-500 text-white` → `bg-violet-300 text-violet-800`

## 没改的

- `text-violet-500`（文字色，#8b5cf6）：保留 — 跟浅紫背景反差够，文字能看清
- `text-violet-600`（状态文字色）：保留
- `bg-violet-50/95` `bg-violet-500/15` `bg-violet-50`：已经是浅紫色，保留
- ChatHeaderShell / ChatInputArea 里的 `bg-violet-500/15` 等透明度用法：保留 — 视觉无变化
- 停止按钮 `bg-red-500`：保留 — 跟"危险操作"语义一致

## 验收方式

1. 打开主动消息弹窗（点角色 → 主动消息）
2. 看主按钮、开关、间隔选择按钮 —— 应该是**浅紫罗兰色**（淡紫色）
3. 点开关 → 开启时背景变浅紫，关闭时变灰

## 编译

`npx vite build` 通过（4.26s，打包 4.8MB）

## 没做的事（下次再说）

暮色 todo 里的"主动消息 2.0 UI 弹窗 + 调试面板 cherry-pick"**没做**——因为这些文件（`components/Amsg2DebugPanel.tsx`、`components/settings/PushSubscriptionPanel.tsx`）强依赖推送链路（`utils/amsgDiagnostics.ts`、`utils/pushSubscribeShared.ts`、`utils/pushDiagnosticsView.ts`），SullyOS 当前没有这些依赖。**等推送方案定了再 cherry-pick**（要么走糯糯糯糯五 ntfy 路线，要么自己实现）。

"删 9-6 commit 51353640 混合方案"**没做**——暮色在问卷里选了"先 cherry-pick UI 部分，ntfy 方案下次再说"，但 UI 部分 cherry-pick 阻塞，所以这个 commit 也暂时保留（混合方案是 SullyOS 当前推送的核心实现，不删）。
