# 2026-09-06 主 API 预设 + 角色独立 API 预设删除逻辑分工

## 暮色原话（9-6 11:11）
"昨天改的 API 预设删除改错位置了，我是要在角色独立 API 预设上加长按删除，你一直改的都是主 API 设置里的预设。

1. 把主 API 预设中的 X 按钮删掉。只保留长按删除。
2. 在聊天设置中的角色独立 API 的预设上增加长按删除逻辑。"

## 改前现状
昨天（9-5）麦麦在 `apps/Settings.tsx` PresetChip 上一路加：
- 21:15 `f50f1f26`：加右键删除（双保险）
- 21:28 `ceeda5c0`：加始终可见 X 按钮（替代长按）

→ 主 API 预设（系统设置）有"长按 + 右键 + X 三个都能删"。但**角色独立 API 预设**（聊天设置抽屉 `components/chat/ChatSettingsDrawer.tsx`）**根本没删除入口**——只能点加载，删不掉。

暮色要的：**主 API 预设的 X 是多余的，只留长按；角色独立 API 预设加长按删除**。

## 改了什么

### 1. `apps/Settings.tsx` — PresetChip 删 X 按钮（主 API 预设）

把 div+双 button 退回到单 button：
- 删 `<button>×</button>`（行 179-194）
- title 改成"点击加载，长按 / 右键删除"
- 长按 550ms 触发 `onRequestDelete` + 右键触发（保留）

主 API 预设现在只剩"长按删除"（桌面右键备选）。

### 2. `components/chat/ChatSettingsDrawer.tsx` — 角色独立 API 预设加长按删除

新加 `PerCharPresetChip` 子组件（行 9-83）：
- 跟 `apps/Settings.tsx` PresetChip 同样的长按 550ms 逻辑（`onPointerDown` + `setTimeout` + `longPressedRef`）
- 点击加载 / 长按删 / 右键删
- 不抽到共享组件是因为 ChatSettingsDrawer 的 active 状态来源是 perCharApi 状态（按 protocol + 2 套字段匹配），跟主 API 那边不同

Props 加 `onDeletePreset: (id: string) => void`，destructure + 传 `onDeletePreset={removeApiPreset}`。

新加 `presetPendingDelete` state + 确认 Modal（zIndex 220，跟一键向量化 Modal 错开）。

### 3. `apps/Chat.tsx` — useOS 解构 + 传 prop

- 解构加 `removeApiPreset`
- `<ChatSettingsDrawer ... onDeletePreset={removeApiPreset} />`

## 判定 / 踩坑

- 第一次在 `<button>` 上写了**两个** `title` 属性（一个默认"点击加载，长按/右键删除"，一个带 proto/activeUrl）—— TS 报"JSX elements cannot have multiple attributes with the same name"。合并成含 proto 信息的那条。
- 写 props 时严格按 8-22 / 8-23 教训：加 `onDeletePreset` 必须 4 处同改（interface / destructure / UI / 调用点）。这次 4 处全改完，TS 编译无新错。

## 没动什么

- `apps/Settings.tsx` PresetChip 内部逻辑（长按 + 右键）保持不变，只删 X
- `components/chat/ChatSettingsDrawer.tsx` 其他 props / state 全保留
- 共享 PresetChip 组件没抽（active 状态来源不同，硬抽会引入 prop 复杂度）

## 验证

- `npx tsc --noEmit` —— ChatSettingsDrawer 4 处新错全过（仅剩 2 处历史 any 错误，stash 验证过未改动时也报）
- `npm run build` —— ✓ 4.02s 通过
