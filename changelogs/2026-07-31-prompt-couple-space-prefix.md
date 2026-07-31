# Prompt 区分 — 情侣空间 vs 系统状态前缀（暮色 2026-07-31 反馈）

**日期**：2026-07-31
**涉及 commit**：`fix: 区分 system 消息前缀 — 情侣空间 vs 系统状态`

## 改了什么

暮色 2026-07-31 反馈"改 prompt 这个不行啊，情侣空间的可以，连接中断这样的就别了"。

**问题**：`hooks/useChatAI.ts` 的 Claude 协议分支把所有 `role: 'system'` 消息统一加 `[系统消息] ` 前缀转 user 角色。结果 AI 模型**全部都能感知**（连接中断、call 摘要、情侣空间事件...），AI 会主动回应"连接中断"这种技术状态，**暮色不想要**。

**修法**：根据 `m.type` 区分前缀：
- `type === 'couple_space_invite' || 'couple_space_event'` → `[情侣空间事件]`（让 AI 主动引用）
- 其他 → `[系统状态]`（AI 不要主动引用）

```diff
- return { role: 'user', content: `[系统消息] ${text}` };
+ // 暮色 2026-07-31：只对情侣空间事件用 [情侣空间事件] 前缀（让 AI 主动引用），
+ //   其他技术状态消息用 [系统状态] 前缀（AI 不要主动回应"连接中断"这类）
+ const isCoupleSpace = m.type === 'couple_space_invite' || m.type === 'couple_space_event';
+ const prefix = isCoupleSpace ? '[情侣空间事件]' : '[系统状态]';
+ return { role: 'user', content: `${prefix} ${text}` };
```

## 动了哪些文件

- `hooks/useChatAI.ts` — line 998-1004 改 system 消息前缀

## 踩坑 / 需要知道的

1. **只改 Claude 协议分支**——OpenAI 协议下 system 消息走顶层 system 字段，不经这个 map。暮色主用 Claude（中转站 kiro/即享）所以 Claude 协议优先。
2. **call 摘要** = `type: 'call-end-popup'`，暮色问"是什么"——SullyOS `CallApp.tsx` 打完电话后生成的总结消息，存为 system 消息。这次也归到 `[系统状态]`（AI 不要主动引用）。
3. **暮色要的是"前缀区分"**——不是 prompt 里写"只回应情侣空间事件"。前缀更直接，LLM 一看就知道。
4. **memory 同步**——4 条 user memory 记了（不要粉色 / 列 todo / 不简化 / AI 感知范围），跨项目适用。

## 备注

- **未完成 / 下次再说**：
  - 修邀请流程（暮色 2026-07-31 反馈"点开通直接进空间"——还没修）
  - UI 改非粉色 + 参考 miya 杂志风（暮色要什么细节待问）
  - 解除情侣空间已做（commit 33b3571）
  - 改开始日已做（commit 33b3571）
