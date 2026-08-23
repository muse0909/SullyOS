# 2026-08-23 主动消息睡眠时间 UI（数据层 + 设置面板）

## 改了什么

### types.ts
- `proactiveConfig` 加 `quietHours?: { enabled, startHour, endHour }` 字段
- 注释说明：startHour/endHour 是 0-23 local 时区；跨午夜 startHour > endHour

### components/chat/ProactiveSettingsModal.tsx
- 新 state：`quietHoursEnabled` / `quietStartHour` (默认 23) / `quietEndHour` (默认 8)
- reset 逻辑（useEffect）：modal 打开时从 `char.proactiveConfig.quietHours` 读回
- `handleSave` 把 quietHours 一起写回
- **新 UI section**（位置：发送间隔下面、使用副 API 上面）：
  - 标题"睡眠时间" + 开关
  - 描述："设置后这段时间不触发主动消息，到点自动恢复。跨午夜：开始 > 结束（如 23-08 = 23:00 到次日 08:00）。"
  - 开启后展开：开始 hour 下拉 + "到" + 结束 hour 下拉（0-23 都列出）

## 视觉位置

弹窗从上到下：
1. 描述
2. 启用主动消息 开关
3. 发送间隔（grid 3x3）
4. **睡眠时间 开关 + 小时选择器** ← 新加
5. 使用副 API 开关
6. 使用角色独立 API 开关

## 默认值

| 字段 | 默认 | 暮色要求 |
|---|---|---|
| enabled | false | 默认关，自己开 |
| startHour | 23 | "默认 23:00-08:00 吧，然后我再自己调" |
| endHour | 8 | 同上 |

## 为什么拆 2 个 commit

- **commit 1（本）**：UI + 保存 — build 通过，弹窗能开关能存能读回
- **commit 2**：OSContext runProactive 加 quiet hours 检查 — 触发逻辑生效

按 8-16 工作流分步验证，避免一次大改翻车。

## 涉及文件

- `types.ts:1156` 字段
- `components/chat/ProactiveSettingsModal.tsx:42-44, 56-58, 67-79, 138-176` state + reset + save + UI
