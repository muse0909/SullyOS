# 主动消息 2.0 提示词路径定位标记

## 背景

暮色 9-17 反馈主动消息 2.0 通道能 push 通知（14:24 schedule_next_wakeup 任务准时触发、设置页"已连接"），但收到的提示词还是旧的 1.0 格式"你被唤醒了，想到什么就说"那套，不是 2.0 character 视角。

排查思路：之前麦麦怀疑 AMSG_SERVER_TOKEN 丢了走前端 fallback，但 2.0 通道迹象都对（设置页已连接 + push 能弹），矛盾。改用"加标记看走哪条"的方法定位。

## 改动

三条路径分别加不同前缀标记，部署后看手机收到哪个标记就知道走的是哪条：

| 标记 | 路径 | 位置 |
|---|---|---|
| 【标记A-CHARACTER】 | Worker 端 character 分支（江澈 schedule_next_wakeup 排的） | `worker/amsg/src/index.ts` `onBeforeFire` taskInstruction 拼装处，`source='character' && reason` 时 |
| 【标记B-MANUAL】 | Worker 端 manual/默认分支（用户手动建任务，或 source 字段空） | 同上，else 分支 |
| 【标记C-FRONTEND】 | 前端 1.0 fallback（`context/OSContext.tsx` `runProactive`） | 前端兜底提示词开头 |

只加标记，不改其他逻辑。定位完三条路径后会清掉标记、改对的代码。

## 测试方案

1. **测试1 — character 路径**：江澈用 `schedule_next_wakeup` 设置一个 2 分钟后的唤醒
   - 收到 A → 路径对，问题在别处（比如 renderFirePack 把 taskInstruction 丢了）
   - 收到 B → schedule_next_wakeup 写入的 task metadata 没带 `source='character'` 或 `reason` 字段
   - 收到 C → schedule_next_wakeup 没真写进 D1 / Worker 没 fire / 走了前端兜底

2. **测试2 — manual 路径**：暮色在 2.0 设置页手动建一个任务
   - 收到 B → 路径对
   - 收到 C → 手动建任务也没走 Worker 端 fire

## 文件

- `worker/amsg/src/index.ts` — 加 A/B 标记（第 2026-2040 行）
- `context/OSContext.tsx` — 加 C 标记（第 1776 行）