# 主动消息上下文去重（messages 数组 8 条 → 0）+ system prompt 末尾改 10 轮

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

暮色 8-6 看了 `sullyos:lastProactiveReqLog` 完整 body，发现上下文**重复了**：

- **图 1** = `messages` 数组里的 8 条 user/assistant history（line 1654 `buildMessageHistory` 拉的）
- **图 2** = system prompt 文本里 `【最近聊天（8 条）— 写消息时可以参考】` 段（line 1591 拼的，line 1555 实际拉 50 条）

两个是同一段对话被构造了两次，浪费 token。

**改后**：
- `messages` 数组只放 1 条 system + AI 回复（`apiMessages = []`）
- system prompt 末尾"最近聊天（10 轮）"段作为**唯一**上下文来源
- label "8 条" → "10 轮"（line 1591，跟实际 .slice(-10) 对齐）
- 之前 8-5 改的 50 条没文档化（label 写 8 实际拉 50）—— 这次统一成 10

## 动了哪些文件

- `context/OSContext.tsx` — 4 处改动：
  - line 1555 `.slice(-50)` → `.slice(-10)`
  - line 1591 label "8 条" → "10 轮"
  - line 1614 删 `const historyForBuild = ...`（不再拉 history）
  - line 1654 `buildMessageHistory(historyForBuild, 8, ...)` → `buildMessageHistory([], 0, ...)`

## 踩坑 / 需要知道的（重要）

### 为什么之前会有 8-5 那个"history 截断 8 条"
- 8-5 之前是"主动消息 history 500 条 → token 炸"（每次主动消息 5-10w tokens）
- 8-5 改成 8 条（`9d2f3cf`）—— 解决了 token 爆炸，但**没意识到跟 system prompt 的"最近聊天"段重复**
- 暮色 8-6 看完整 body 才看出来
- **教训**：token 优化时，先列"上下文来源清单"再砍，避免砍了 A 还有 B 重复

### memory palace injectRecentMsgs 不动
- line 1613 `injectRecentMsgs = 30 条` 保留（记忆宫殿 query 上下文用，不影响 top 5 结果）
- 这条跟 messages 数组的 history 是**两套机制**（一个给向量检索，一个给 LLM），不重复
- 不动

## 备注
- 角色隔离 + 全部关了还触发的 bug 暮色说"下一轮继续"，本 changelog 不处理
- 8-2 那个 calcBreaks "按轮" 也没动（不依赖 isLastInGroup 了，时间戳每条都画）—— 但代码残留不影响
