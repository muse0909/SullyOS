# 主动消息加 1 分钟测试档

**日期**：2026-07-21
**涉及 commit**：`314d4f0`

## 改了什么

主动消息设置档位放开到 1 分钟（之前最小 30 分钟），方便暮色快速测试 CORS 修复效果。

## 动了哪些文件

- `utils/proactiveChat.ts:30` —— `ProactiveSchedule` interface 注释更新（"must be multiple of 30" → "放开 1 分钟档"）
- `utils/proactiveChat.ts:308-313` —— `start()` 的 clamp 逻辑分两段：
  - `< 30` 直接 round（1-29 整数都行）
  - `>= 30` 仍按 30 步长对齐（30/60/120/240/...）
- `components/chat/ProactiveSettingsModal.tsx:14-23` —— `INTERVAL_OPTIONS` 数组前加 `{ label: '1 分钟（测试）', value: 1 }`

## 踩坑 / 需要知道的（重要）

### 1 分钟档只适合"前台测试"用

页面**在前台**时，1 分钟 timer 准得很（`setTimeout` 1 分钟 + 20s `setInterval` 兜底 + `visibilitychange`/`focus` 立刻 checkOverdue）。

页面**切后台**后：
- 浏览器 throttle setTimeout/setInterval（Chrome 最低 1 分钟 1 次，但**不准**，可能延迟数分钟）
- 这时候要靠 Cloudflare Worker 推送唤醒（`proactivePushConfig`），但**最小 cron 也是 1 分钟**——也就跟本地兜底差不多
- 真要后台 1 分钟准点醒，需要 Service Worker 存活 + Web Push，**目前依赖云端 push 配置**，没配 push 的后台会晚很多

### 生产建议仍 ≥ 30 分钟

中转站（youzi.today 等）对频繁主动消息请求会限流（昨天那个 CORS 假象的根因之一）。
暮色自己写的"频繁触发"1 分钟档仅供**测试时**用，长期挂设仍按 30 分钟起步。

### Grid 排布变了

8 个选项 + `grid-cols-3` = 3+3+2，最后一行 2 个居左。看着不挤（之前 7 个是 3+3+1）。
如果觉得不齐，改 `grid-cols-4` 也可以（4+4 = 8 整齐），但 modal 宽度 384px 每格 ~88px，4 列会挤字。

## 备注

- 1 分钟档 UI 上标了"（测试）"——**用户自己能看到是测试用**
- 没改 `ProactiveSchedule.interface` 字段名/类型，只改了注释
- 没改云端 push 逻辑（`registerScheduleOnWorker` 那边 intervalMs 直接传，没 30 分钟硬限制）
- 配合 commit `4964a2c`（CORS 修复）一起测：modal 选 1 分钟 → 等 1 分钟 → 应该能看到角色主动发消息进聊天流
