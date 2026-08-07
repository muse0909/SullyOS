# 朋友圈 awareness + 真实世界感知窗口收窄

**日期**：2026-08-07 19:31
**暮色反馈**：
- 图上"### 最近朋友圈动态"每次都出现在请求体里 → 太长
- 真实世界感知（新闻/天气）说早晚各一次，现在好像每次都通知

## 改了什么

### 1. 朋友圈 awareness：只带新发朋友圈

**之前**：每次 buildSystemPrompt 都把最近 5 条 post 全塞进 prompt（重复 + 浪费 token）

**改后**：按 charId 持久化"已看到的最新 createdAt"，只返回 `createdAt > lastSeen` 的新发朋友圈
- 新文件 `utils/momentsAwarenessState.ts` 封装状态管理
- 首次构建：只给最新 1 条作为基线（避免一次性塞 5 条老 post）
- 后续：createdAt > lastSeen 的新发朋友圈全带（上限 5 条）
- **没新发朋友圈时** awareness 段**不出现**（节省 ~500 chars）
- 持久化这次的最新 createdAt，下次只带比这更新的

### 2. 真实世界感知（新闻/天气）：早/晚窗口判断 + 当日去重

**根因排查**：8-5 commit `8228f95` 的 commit message 明确写了"三个场景分开"——正常聊天 / 主动消息 / 早晚各一次主动推——但代码实现简化成 `shouldInjectRealtime = !!isProactive`，**所有**主动消息都带新闻/天气。"早晚窗口"判断完全没实现。暮色说的"改了又变回来"就是这个。

**改后**：
- 新文件 `utils/realtimeNotified.ts` 持久化"今日早/晚通知 timestamp"
- `shouldInjectRealtime = isProactive AND (早 5-9 / 晚 17-21 窗口 AND 当日该窗口未通知)`
- 早 5-9 / 晚 17-21 窗口内，**第一次**主动消息带新闻/天气 + mark
- 同窗口后续主动消息：notified 已设 → 跳过，不带
- 跨过窗口边界（如 20:59 触发 21:00 处理）：markRealtimeNotified 用 `new Date()` 重新判断当前窗口
- 非早/晚时段（中午/下午/凌晨）主动消息：永远不带新闻/天气

## 动了哪些文件
- **新增** `utils/momentsAwarenessState.ts` — 朋友圈 awareness 状态管理（持久化 lastSeenAt）
- **新增** `utils/realtimeNotified.ts` — 早/晚窗口通知状态管理（持久化 morningAt / eveningAt）
- **改** `utils/chatPrompts.ts` — `shouldInjectRealtime` 加窗口判断 + mark；朋友圈 awareness 改成只带新发 + mark

## 踩坑 / 需要知道的（重要）

### 1. 不是打补丁，是重新设计

暮色原话："所有修改都要查看整体逻辑，保证通顺，不要只打补丁。是改不是打补丁。"

**没做**（典型的打补丁思路）：
- 在 buildMomentsAwareness 内部加 if 过滤
- 在 hotNewsPromise 内部加 if (hour >= 5 && hour < 9) ...

**做了**（按整体逻辑改）：
- 朋友圈 awareness 状态 → 独立 util 管理持久化 + 过滤 + mark
- 真实世界感知窗口 → 独立 util 管理持久化 + 窗口判断 + mark
- chatPrompts 只负责"调 + 拼"，不管"哪些算新"和"窗口判断"

### 2. 朋友圈 awareness 的"新"定义

按 `createdAt > lastSeenAt` 判断——不是"按 post id 排序的最新 N 条"。

- 优点：跟"用户实际看到朋友圈的时间"更接近（createdAt = 发布时间）
- 边界：如果用户手动清 localStorage → 重新走"首次"流程 → 只给 1 条作基线
- 边界：如果朋友圈被删 → createdAt 还在记录里，但 post 不存在了 → next getNewPostsForAwareness 不会再带这条（已经 lastSeen > deleted.createdAt）
- 持久化 key：`sullyos_moments_awareness_seen_v1`，value `{ [charId]: { lastSeenAt, lastSeenId? } }`

### 3. 真实世界感知窗口的"早/晚"定义

代码注释里标了：
```
MORNING_START_HOUR = 5
MORNING_END_HOUR = 9
EVENING_START_HOUR = 17
EVENING_END_HOUR = 21
```

暮色没明说具体小时数。我用 5-9 / 17-21 是合理默认：
- 早 5-9：起床前 → 上班前
- 晚 17-21：下班后 → 睡前
- 其他时段：工作时间 / 深夜，主动消息**不带**新闻/天气（避免每次请求都重复 5 条 Hacker News）

如果暮色觉得窗口不对，调 `realtimeNotified.ts` 这两个常量就行（暂时没暴露到 settings UI）。

### 4. 持久化边界

两个 util 都用 localStorage（不是 IndexedDB）：
- 朋友圈 awareness：状态小（charId → lastSeenAt），localStorage 够用
- 早/晚通知：每天 ~50 bytes，localStorage 够用
- 持久化 key 命名规范：`sullyos_<feature>_<version>_v<N>`（跟项目其他 key 一致）

### 5. 跟 8-5 commit `8228f95` 的关系

- 8-5 commit 设计了"三个场景"：正常聊天 / 主动消息 / 早晚各一次主动推
- 但**代码**简化成 `shouldInjectRealtime = !!isProactive`，把"主动消息"和"早晚窗口"混在一起
- 这次 commit **补回**"早晚窗口"判断 + 加"当日去重"
- commit message 写的设计意图 vs 实际实现有 gap — 这次是补回 gap，不是重新设计

### 6. 朋友圈 awareness 与 chat awareness 的关系

- `changelogs/2026-07-04-moments-chat-awareness.md`：Chat ↔ Moments 互通（Layer 1）
  - 用户发朋友圈 → notifyQueue → 触发 AI chat 反应
  - AI 发朋友圈 → system message 进 chat
- 这次改的是**反向**：buildSystemPrompt 注入"最近朋友圈"段
- 两者不冲突：notifyQueue 触发 chat 反应（用户→AI）；awareness 注入让 AI 知道"现在朋友圈有什么"（背景信息）
- 但**新 awareness 段**会让 AI 觉得"暮色看到我的朋友圈了"（因为能看到暮色评论）→ 这就是暮色要避免的（"不要每次都出现"）

### 7. 朋友圈 awareness 段现在长这样

**之前**（每次都带）：
```
### 最近朋友圈动态（供你参考）
（以下是用户和所有角色最近发的朋友圈...）
- (ID: post-...) 作者: 江澈(你), 内容: "..."
  - 你评论说: "..."
- (ID: post-...) 作者: 暮色, 内容: "..."
  - 评论 暮色: "..."
- ... (5 条)

（重要：你已经看到这些朋友圈动态了...）
```

**之后**（只带新发）：
- 新发朋友圈时：只带新发的 1-5 条
- 没新发时：段**完全不出现**（节省 ~500 chars）

## 备注
- 持久化数据**不会自动迁移**——如果之前已经存了很多朋友圈，老 lastSeenAt 不存在 → 走"首次"流程 → 下一条主动消息只带 1 条最新朋友圈作基线
- 如果用户想"重置朋友圈 awareness"（让 AI 重新看所有朋友圈）：调用 `resetMomentsAwareness()`（暂未暴露到 UI）
- 早/晚窗口常量在 `realtimeNotified.ts` 顶部——如果暮色想改时段，调两个数字即可
- 跟 `proactiveCount`（每天每 char 3 次主动消息上限）独立：realtimeNotified 是"窗口级"，proactiveCount 是"调用级"
