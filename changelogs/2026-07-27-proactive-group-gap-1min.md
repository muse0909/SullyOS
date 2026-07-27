# 主动消息 group 边界：30 分钟 → 1 分钟（proactive 永远独立）

**日期**：2026-07-27
**涉及 commit**：`f0a80c0`

## 改了什么

暮色反馈 7/23 改的"主动消息时间戳每条独立"还是不准——主动消息之间会挤同一个 group（0 秒间隔的连发多条看着像一条），主动消息和 user 消息也按 30 分钟 group gap 算边界，看着"合并"。

### Group 边界新规则（`apps/Chat.tsx:2861-2884`）

| 场景 | Gap 规则 | 备注 |
|---|---|---|
| 普通 user/AI 对话 | **30 分钟**（保持不变） | 原节奏 |
| 主动消息（isProactive=true）之间 | **永远独立 group**（哪怕 0 秒） | 新加的——AI 一次性生成多 chunk 时不会挤一起 |
| 主动消息 ↔ 普通消息 | **1 分钟** gap | 暮色原话"超过 1 分钟都打时间戳" |

### 实现细节

- 把 `breaksWithPrevious` / `breaksWithNext` 抽成共用 helper `calcBreaks(cur, neighbor)`——避免两侧判断逻辑漂移
- `breaksWithNext(m)` 等价于 `breaksWithPrevious(m_next)`，两个用同一个 helper 计算
- `metadata.isProactive` 由 7/23 改的 OSContext 三处 saveMessage 已经标记好了，不用改

## 动了哪些文件

- `apps/Chat.tsx` — `displayMessages.map` 里 `breaksWithPrevious` / `breaksWithNext` 重写

## 踩坑 / 需要知道的（重要）

- **breaksWithNext 和 breaksWithPrevious 必须用同一个 helper**：之前两份独立代码容易漂移。改完两边一定一致（`calcBreaks(nextMessage, m)` 对应"m 的 breaksWithNext"）
- **role 不同时还是 break**：`if (neighbor.role !== cur.role) return true;`——user/AI 切换本来就不在同一 group，跟时间间隔无关
- **同 role 才走 gap 逻辑**：role 相同才看时间间隔或 proactive 规则
- **不是 1 分钟全覆盖**：暮色说"超过 1 分钟都打时间戳"我**没**改成全局 1 分钟——那会让正常聊天的 5 条连发（每条 30 秒）被算成 5 个独立 group，视觉很乱
- **7/23 改的"主动消息每条打时间戳"还在**：跟这次互补，7/23 解决"显示问题"，这次解决"结构问题"

## 备注

- 没动 7/23 改的 `MessageItem.tsx:559` 的时间戳渲染条件（`isLastInGroup || m.metadata?.isProactive`），保持兼容
- 历史消息（保存时还没 isProactive 标记的）这次也不会自动补救——7/23 changelog 也提到过，要补救得跑 migration
- 这次 commit 完立刻 push（之前 1+4 改完忘 push，暮色 8 点提醒的，记着这个 lesson）
