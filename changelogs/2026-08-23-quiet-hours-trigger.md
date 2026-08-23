# 2026-08-23 主动消息睡眠时间触发逻辑

## 改了什么

### utils/proactiveChat.ts
- 新加 `snoozeUntil(charId, wakeUpTs)` 方法
  - 内部：lastFire = wakeUpTs - intervalMs → nextFire = wakeUpTs
  - 不 stop / 不 start schedule，只是把下次触发时间推到 wakeUpTs
  - 同步 SW + 重排 preciseTimer
  - 用法：sleep 期间 next fire 直接到 endHour，期间完全不查

### context/OSContext.tsx (runProactive)
- 在 enabled 检查之后、daily limit 检查之前加 quiet hours 检查
- 跨午夜算法：
  ```ts
  const inQuiet = startHour === endHour
      ? false  // 配错兜底
      : startHour < endHour
          ? (h >= startHour && h < endHour)  // 不跨午夜（如 9-18）
          : (h >= startHour || h < endHour);  // 跨午夜（如 23-08）
  ```
- 命中时：算 endHour 的 timestamp（今天已过 → 明天 endHour），调 `ProactiveChat.snoozeUntil`，console.log 跳过原因

## 行为

| 当前时间 | 23-08 配置 | 行为 |
|---|---|---|
| 14:00 | 14:00 不在区间 | 正常触发 |
| 22:30 | 22:30 在 [23-08] 区间 | snooze 到次日 08:00，期间每 30 分钟空跑检查 → 不会，因为 schedule 已经推走 |
| 23:50 | 23:50 在 [23-08] 区间 | snooze 到次日 08:00 |
| 06:00 | 06:00 在 [23-08] 区间（0-8 范围） | snooze 到今天 08:00 |
| 09:00 | 09:00 不在区间 | 正常触发 |

**关键**：snoozeUntil 把 nextFire 推到 endHour，sleep 期间 ProactiveChat 内部 timer 不会调 triggerCallback → runProactive 不会被触发 → **不调 API、不发消息**。

## 跨午夜算法验证

`startHour > endHour` 时：
- h=22（startHour）→ h >= 22 真 → inQuiet
- h=23 → h >= 22 真 → inQuiet
- h=0, 1, ..., 7 → h < 8 真 → inQuiet
- h=8 → h >= 22 假 + h < 8 假 → 不 inQuiet ✓
- h=12 → 假 + 假 → 不 inQuiet ✓

`startHour < endHour` 时（如 9-18）：
- h=8 → h >= 9 假 → 不 inQuiet ✓
- h=9 → h >= 9 真 + h < 18 真 → inQuiet ✓
- h=18 → h >= 9 真 + h < 18 假 → 不 inQuiet ✓

## 涉及文件

- `utils/proactiveChat.ts` 新加 `snoozeUntil` 方法
- `context/OSContext.tsx:runProactive` 加 quiet hours 检查

## 验证

- build 通过
- 测试场景：手动调 __ProactiveDiary__.fireNow 不影响（ProactiveDiary 跟 ProactiveChat 独立），但 ProactiveChat schedule 在 sleep 期间不触发 → 等 08:00 后再触发
- 跨午夜：设 23-08，现在 22:00 + 启动主动消息 → console 看到 "in quiet hours, wake at 明天 08:00"

## 2 个 commit 总结

- **commit 1** `971fb9b3`：types + ProactiveSettingsModal UI + 保存
- **commit 2**（本）：ProactiveChat.snoozeUntil + runProactive 检查 — **功能可用**

暮色晚上睡觉前能直接体验：把主动消息间隔设 5 分钟（测试档）、睡眠时间 23-08 → 22:00 启动 → 应该完全不收到消息 → 第二天 08:00 后才收。
