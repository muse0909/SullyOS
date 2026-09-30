# Push C 方案 commit 计划（调整版）

**日期**：2026-09-05
**作者**：Mavis
**状态**：计划，暮色确认后开干

**调整点**（暮色反馈）：
- 改动 1：长持 Wakelock → 心跳前后短持有 + AlarmManager 兜底
- 改动 2：心跳 30s 保持，不动
- 改动 3：Worker 真实在线 + 离线消息持久化到 D1 — 不变
- 补充：客户端恢复时拉取离线消息要**去重**（防 WS 瞬间 + D1 补发双发）

---

## Commit 1：KeepAliveService 心跳前后短持 Wakelock + 周期 Alarm 兜底

**改什么**：

1. **去掉 `showProactiveNotification` 里那把 10s 临时锁**（之前那版）
2. **加新方法** `acquirePingWakelock()`：
   - 心跳 `pingRunnable` 跑之前 `acquire(8_000L)` 短持（8 秒内必须收到 pong 自动 release）
   - 收到 pong 后 `release()`（要 refcount=false）
3. **加新方法** `schedulePeriodicRestartAlarm()`：
   - `AlarmManager.setExactAndAllowWhileIdle(ELAPSED_REALTIME_WAKEUP, ...)` 每 **30 分钟**一次
   - PendingIntent 拉起**自己**（`KeepAliveService`），不是 Activity
   - service 正常活着时 `cancel()`，死了/卡了被 alarm 拉起重连
4. **`onStartCommand`** 里：alarm 触发也走这里（intent.action 是自定义字符串），进来后 cancel 下一次 alarm + 重连 WS
5. **`onCreate`** 里首次 `schedulePeriodicRestartAlarm()`
6. **`onDestroy`** 里 cancel alarm + release 锁

**为什么**：
- 短持 Wakelock 不会被 vivo 标记异常
- 周期 Alarm 兜底：service 被杀也能被系统拉起
- 30 分钟间隔：vivo 异常网络检测不会触发

**怎么测**：
- logcat 看 `PING_WAKELOCK_ACQUIRE` / `PING_WAKELOCK_RELEASE` / `ALARM_RESTART_TRIGGERED`
- 杀 app → 等 30 分钟 → 看是否被 alarm 拉起（logcat 有 `ALARM_RESTART_TRIGGERED`）
- 收到 pong 的延迟应该在 50-300ms（8s 锁够用）

**改的文件**：
- `android/app/src/main/java/com/aetheros/simulator/KeepAliveService.kt`

---

## Commit 2：Worker WsHub 记录 lastPingAt + "真实在线"判断

**改什么**：

1. **WsHub 内部**：
   - `Map<userId, lastPingAt>`（in-memory）
   - `onMessage` 收到 `{"type":"ping"}` 时更新 `lastPingAt[userId] = Date.now()`
   - `onClose` / `onError` 时 `delete lastPingAt[userId]`
2. **新方法** `isReallyOnline(userId)`：
   - 30 秒内有 ping 才算在线
   - 暴露给外部 cron handler 调
3. **D1 新表** `proactive_offline_messages`：
   - schema: `id` (uuid, primary) / `user_id` / `char_id` / `content` / `character_name` / `created_at` / `expires_at` (默认 +7 天)
   - 加 `idx_user_id_created_at` 索引
4. **runScheduledSweep 改造**：
   - 当前：先 WS broadcast（delivered > 0 跳过 Web Push）
   - 改成：先 WS broadcast → 检查 WsHub.isReallyOnline(userId)
     - **真在线**（30s 内有 ping）→ 走 WS 路径（和现在一样）
     - **不在线** → 写入 D1 `proactive_offline_messages` 表
     - **完全没连接**（offline 状态）→ 也写 D1

**为什么**：
- WsHub 当前数 socket 数不可靠（socket 在但 client 冻住也算"送达"）
- 真实在线 = 30s 内有 ping 双向确认
- 不在线的消息持久化到 D1，等客户端上线时拉取

**怎么测**：
- Worker 测试：连上一个 mock client 不发 ping → cron 触发 → 消息进 D1 不走 WS
- Worker 测试：连上 client 发 ping → 30s 内 cron 触发 → 走 WS
- D1 表查询：手动 SQL 看是否写入

**改的文件**：
- `worker/proactive-push/src/wsHub.ts`
- `worker/proactive-push/src/index.ts`（runScheduledSweep）
- `worker/proactive-push/schema.sql`（加新表）

---

## Commit 3：客户端恢复时拉取 D1 离线消息 + 去重

**改什么**：

1. **客户端主线程启动时**（`index.tsx` `KeepAlive.init()` 之后）：
   - 调 `GET /api/offline-messages?userId=...&since=...`（since 是上次成功拉取的时间戳）
   - 拉取后逐条 dispatch 给主线程的 `onProactiveTrigger` 处理器（跟 SW push 走同一条路径）
   - 更新本地 `lastOfflineFetchAt` 存 IDB

2. **WebSocket 重连成功后**：
   - **不要**立即拉取 D1（避免和 server 端的 broadcast 双发）
   - 用一个"待拉取"标记：WS 重连 5 秒后还没收到 server 主动重发队列里的，才拉 D1
   - 或者更简单：完全用 messageId 去重，**双发也不怕**

3. **去重机制（关键）**：
   - Worker 端生成消息时用 `crypto.randomUUID()` 生成 `messageId`，附在 payload 里
   - 客户端收到每条消息（无论是 WS 还是 D1 拉取）写入 IDB 前先查 messageId 是否已存在
   - 已存在 → 跳过
   - 不存在 → 写入
   - **幂等键：messageId**

4. **改 showProactiveNotification**：
   - 现在的 `notificationId = PROACTIVE_NOTIFICATION_ID_OFFSET + Math.abs(characterId.hashCode())` 每次都覆盖同一条
   - 改成 `notificationId = PROACTIVE_NOTIFICATION_ID_OFFSET + Math.abs(messageId.hashCode())` **每条消息独立**
   - 这样多条离线消息同时到也能全部显示

5. **改 sw-keep-alive.js**：
   - 收到 push 时带 messageId → main thread 透传
   - main thread 写 IDB 时先查重

**为什么**：
- WS 重连瞬间 + D1 拉取可能同时到达（去重必须）
- 同一 messageId 不写两次
- notification 用 messageId 区分，避免多条消息被覆盖成一条

**怎么测**：
- 杀 app → curl 推 2 条 → 杀期间收 2 条进 D1
- 重启 app → 拉 D1 → 2 条都收到，2 条都显示
- 同时手动 WS 推一条带相同 messageId → 客户端只显示一次
- 测：手动触发 offline 拉取两次（手动 refresh）→ 不重复入 IDB

**改的文件**：
- `index.tsx`（加 fetch 逻辑）
- `public/sw-keep-alive.js`（透传 messageId）
- `utils/keepAlivePlugin.ts` 或新 `utils/offlineMessages.ts`（拉取 + 去重封装）
- `android/.../KeepAliveService.kt`（showProactiveNotification 用 messageId 算 notificationId）

---

## Commit 4：Worker 加 GET /api/offline-messages 端点

**改什么**：

1. **新路由** `GET /api/offline-messages`：
   - query: `userId`（必填）/ `since`（可选，默认 0）
   - 认证：用现有的 `X-Client-Token` 头
   - 返回：`{ messages: [{ messageId, charId, characterName, content, createdAt }, ...] }`
2. **D1 查询**：
   - `WHERE user_id = ? AND created_at > ? AND expires_at > now`
   - ORDER BY created_at ASC
   - LIMIT 100
3. **可选**：客户端拉到后给 D1 删/标记，避免下次重复拉
   - **MVP 不做**，依赖 `since` 时间戳去重就行
   - expires_at +7 天自动过期，不删也无所谓

**为什么**：
- 客户端要能拉到自己离线时的消息
- 现有 WsHub 只有"实时"通道，没"补发"通道

**怎么测**：
- curl `GET /api/offline-messages?userId=xxx&since=0` → 拿到 D1 里的消息
- curl 传不存在的 userId → 返空数组
- 不传 token → 401

**改的文件**：
- `worker/proactive-push/src/index.ts`

---

## Commit 5：端到端验证（不写代码，暮色 + 麦麦一起测）

**测试场景**：

1. **基线（commit 1 后）**
   - 杀 Sully app → 等 5 分钟 → curl 推 → 收到？
   - 锁屏 → 等 5 分钟 → curl 推 → 收到？
   - 杀 + 等 30 分钟（周期 alarm 触发时间）→ curl 推 → 收到？

2. **commit 2+3 后**（Worker 真实在线判断 + 客户端 D1 拉取）
   - 杀 Sully app → 等 1 分钟 → curl 推 2 条 → **不在线**：写 D1
   - 重启 app → 主线程启动 → 拉 D1 → 2 条都显示
   - **同步测试**：app 切后台 → WS 还活着 → curl 推 → WS 收到（不写 D1）→ 通知弹
   - **边界测试**：杀 app → 等 30 分钟（alarm 触发）→ curl 推 → D1 写入
   - **去重测试**：手动 WS 推一条 messageId=X，D1 也有 messageId=X → 客户端只显示一次

3. **暮色手机真机验证**
   - vivo 后台高耗电 ✅
   - 自启动 ✅
   - 省电模式关掉 ✅
   - 实操：杀 Sully → 等 1 分钟 → curl → 重启 app → 看到通知？

**暮色已经做过的**（不需要再做）：
- 后台高耗电 ✅
- 自启动 ✅
- 省电模式关掉 ✅

---

## 总览

| Commit | 改什么 | 风险 | 时间 |
|---|---|---|---|
| 1 | KeepAliveService 短持 Wakelock + 周期 Alarm 兜底 | 低 | 半天 |
| 2 | Worker WsHub 真实在线 + D1 表 + cron 走 D1 | 中（动 cron 逻辑） | 半天 |
| 3 | 客户端拉 D1 + messageId 去重 | 中（动通知 ID 算法） | 半天 |
| 4 | Worker GET /api/offline-messages 端点 | 低 | 1 小时 |
| 5 | 端到端真机验证 | — | 半天 |

**总时间**：1-1.5 天（含验证）

**最重要的 2 个 commit**：
- **Commit 1**：客户端存活（不靠 30 分钟一次 alarm，2-3 分钟响应）
- **Commit 3**：去重不漏不重（用户最终体验由这条决定）

---

## 暮色确认事项

1. **Commit 顺序 OK 吗**（先客户端 / 再 worker / 再客户端拉取）？
2. **周期 Alarm 30 分钟** 间隔接受吗（vivo 检测 / 折中点）？
3. **Wakelock 短持 8 秒** 够吗（ping/pong 正常延迟 < 1s，8s 留 7s 缓冲）？
4. **离线消息保留 7 天** 太短/太长？

确认后我开干。
