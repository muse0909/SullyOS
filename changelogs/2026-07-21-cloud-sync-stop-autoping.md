# 云端同步默认不启动 — 停止自动打 ping

**日期**：2026-07-21
**涉及 commit**：`6a9fdef`

## 改了什么

`hooks/useCloudSync.ts:getEngine()` —— 删掉 `_engine.start()` 自动调用。云端同步改为"手动模式"。

## 动了哪些文件

- `hooks/useCloudSync.ts:462-474` —— `getEngine()` 单例工厂里只 `new CloudSyncEngine()`，不调 start

## 踩坑 / 需要知道的（重要）

### 根因

暮色 2026-07-21 反馈：每次保存消息/记忆/打开设置页，Vercel 调试终端都会弹一次：
```
NETWORK signal is aborted without reason
URL: /api/sync?_action=ping
```

`getEngine()` 在 3 个时机被调：
1. `utils/db.ts:492` — `enqueueUploadMessage()`（保存聊天消息时）
2. `utils/memoryPalace/db.ts:133, 153` — `enqueueUploadMemory()`（保存记忆宫殿时）
3. `components/settings/SyncSettings.tsx:75` — `useCloudSync()` hook mount

第一次调 `getEngine()` 会触发 `_engine.start()` → `checkBackend()` → `checkBackendAvailable()` → `fetchSync('?_action=ping')`——**自动打一次 ping**。

### 为什么 ping 会 fail

`/api/sync?_action=ping` 是 Vercel Function（`api/sync.ts:11` 注释的端点），返回 `{ok:true}` 表示 Neon DB 已配。**signal is aborted** 是 Vercel 那边 10 秒超时的副产品（之前 memory 记过：Vercel Hobby 套餐 10 秒函数超时硬限制）。

加上暮色同时反馈"京东云也登不上去了"——他当天网络/云服务整体抽风，ping 必失败。

### 改法选择

暮色原话："不自己启动，只能手动刷新"。

- **方案 A（采用）**：`getEngine()` 删掉 `start()`。只 `new` 不 start。
  - enqueueUpload* 累积在 `pendingMessages` / `pendingMemories` 队列（不丢消息）
  - 设置页"立即同步"按钮 (`forceSyncNow`) 触发时统一 flush
- **方案 B（否决）**：保留 start()，但去掉 checkBackend() 里的 ping 调用
  - 问题：用户失去"后端配没配"的状态判断
  - 保留：可能让用户不知道后端挂了还傻等

### 副作用

- **保存消息/记忆不会自动同步**——累积在内存 queue
- **用户必须打开"云端同步"设置页点"立即同步"**才会上传
- **多端实时同步不工作**（轮询没了）——直到用户手动触发
- **没有任何"自动恢复"机制**——这是暮色明确要求的行为

## 备注

- 队列里的消息**不会被丢失**——`enqueueUploadMessage` 内部 `if (!enabled || !pairCode) return` guard 后 push 到 `this.pendingMessages` 数组
- 队列上限 `MAX_PENDING_MESSAGES`（代码里有具体数字）
- 暮色想恢复自动同步时：把 `_engine.start()` 加回来就行
- 配合 `forceSyncNow()` 看效果——点"立即同步"按钮 → pollAll → flushUploads → 把 queue 里所有消息一次性发出去
