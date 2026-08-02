# 放歌工具成功路径省第二次主 API

**日期**：2026-08-03
**涉及 commit**：`6ebec0a`

## 改了什么
- `hooks/useChatAI.ts:2270-2365` play_song 工具处理：成功路径不再调第二次主 API
- 失败路径仍调 followup，让大语言模型知道失败并自然道歉
- 成功时用现有 toast + 系统消息 + music_card 三件套替代大语言模型总结

## 动了哪些文件
- `hooks/useChatAI.ts` —— 把 followup 段从 `if (playSongSnap)` 之外移进 `else` 分支，成功路径直接结束

## 踩坑 / 需要知道的（重要）
- 成功路径下 `aiContent` 是空字符串（OpenAI 协议下 tool_call 响应的 content 字段本来就空）
- 所以这一轮**没机会输出** `<emotion>` 心声 / `[[MOMENT_POST:...]]` 朋友圈 / `[[PRIVATE_NOTE:...]]` 私密记事 / `[[ACTION:POKE]]` 戳一戳等附带动作
- **下一轮**用户输入触发主 API 时这些标记会正常输出——不影响
- **副 API 情绪评估照常跑**（独立于主 API，不受影响）
- description 里的"拿不准就不调"**保留**——7-22 收紧的初衷没改

## 备注
- 省 5-7w token / 次（按每次放歌 10 次 / 天算，一天省 50-70w token）
- 失败路径不变，LLM 还能道歉
- 这是 1A 模式在 OpenAI 协议下的"成功路径"实现——既保留 LLM"知道有工具"的结构，又省了无谓的第二次请求
- 生图 / MCD propose 工具**不改**——它们强依赖"看到结果再总结/决策"
