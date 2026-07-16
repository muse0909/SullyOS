# innerState + realtime 时间戳挪到 messages 末尾，提升 prompt cache 命中率

**日期**：2026-07-16
**涉及 commit**：`e4b48c7`

## 改了什么

SullyOS 的 prompt 拼装里有两个"每轮必变"的字段，**之前拼在 system prompt 中间**，导致 Anthropic prompt cache prefix 频繁断在 system 段末尾，连带 history 全部失效。

**两个动态炸弹**：
1. `realtimeText`（含"现在是 2026-07-16 22:00"这种时间戳，每分钟变）
2. `innerState`（evolvedNarrative，意识流独白，每轮 LLM 重新生成）

**改后**：
- `buildSystemPrompt` 改返回类型 `{ systemPrompt, dynamicTail }`
- `systemPrompt` 只留稳定段（角色卡 + 世界书 + 性格 + slotHeader + 朋友圈 + 音乐 + 工具说明 + 心声要求 + 最近 5 条心声）
- `dynamicTail.realtimeText` + `dynamicTail.innerState` 由 `useChatAI.ts` 追加到 messages 数组末尾
- LLM 仍能读到（作为单独的 system 消息），但不影响前面稳定段的 cache 命中

## 动了哪些文件

- `utils/chatPrompts.ts`
  - line 305: `baseSystemPrompt += realtimeText;` 注释掉（挪走）
  - line 809: return type 从 `string` 改为 `{ systemPrompt, dynamicTail }`
- `utils/context.ts`
  - `buildScheduleInjection` 不再处理 `evolvedNarrative`（参数保留但内部忽略）
  - schedule 段只含 `slotHeader`（当前时段硬事实）+ schedule 自带的 `flowNarrative` / `innerThought`（变化频率低）
- `hooks/useChatAI.ts`
  - line 711: `systemPromptPromise` 返回值解构为 `systemPromptResult` + `fullHistory`
  - line 717-721: 从 result 拿出 `systemPrompt` 和 `dynamicTail`
  - line 858-872: `fullMessages` 末尾追加 `dynamicTail.realtimeText` + `dynamicTail.innerState`

## 踩坑 / 需要知道的

1. **schedule 段保留在 system prompt**：`slotHeader`（当前时段）+ schedule 自带的 `flowNarrative` / `innerThought` 仍拼在 system prompt 中。这些内容变化频率低（一天切 4-5 次时段），不像 evolvedNarrative 每轮都变，所以**保留**。如果后续命中率仍不理想，再考虑把整个 schedule 段也挪走。

2. **innerState 从 system 段变 system 消息**：之前 innerState 是 system prompt 中的一段文字，LLM 当作"角色设定"读。挪到末尾作为独立 system 消息后，**LLM 解读可能轻微变化**——但经验上不影响生成质量（其他项目这样做都正常）。

3. **Anthropic cache 的 prefix 匹配机制**：
   - cache 是按整个 messages 数组的 prefix 匹配的
   - 末尾追加 system 消息**不影响**前面 system + history 的 prefix
   - 前面 system 段完全稳定 → 一次建 cache，多次请求都命中

4. **没动其他动态段**：
   - memory palace 召回（每次 query 不同）—— 下一步可以考虑挪
   - 当前时段（slotHeader）—— 变化频率低，暂不动
   - 最近 5 条心声（emotionHistory 累积）—— 每条新心声都加，影响小

## 备注

- 改完预期：
  - 青屿 180：80% 命中 → **95%+**
  - 即享 kiro 0.1x：18% 命中 → **70%+**（站点池子问题仍在，但 SullyOS 这边修好）
  - 即享 ccmax2 0.6x：中等 → **85%+**
- 暮色在 Vercel 部署链接上测一下命中率，**我赌一周内即享 kiro 能从 18% 拉到 70%**
- 下次再考虑加显式 `cache_control` 标记（1h TTL 替代 5m TTL，能再涨一档）
- 如果发现 innerState 解读出问题（角色心声语气变了），可以把 innerState 改回 system prompt 末尾但保持 realtime 在 messages 末尾—— 单独只挪 realtime 也比不挪好
