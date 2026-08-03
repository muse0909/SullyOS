# 见面 app：Claude 兼容思维链 + 思维链中文 + 输入框回填修复

**日期**：2026-08-03
**涉及 commit**：`待提交`

## 改了什么

### 1. Claude 兼容思维链

暮色反馈"用了 Claude thinking 模型但没显示思维链"。根因：

- 即享（`cn.jixiangai.xyz`）中转站有个「兼容思维链」开关——开启后，**所有模型**的思维链都被塞到 `content` 字段的 `<think>...</think>` 块里，而不是标准 OpenAI 的 `reasoning_content` 字段
- DateApp 之前只读 `data.choices[0].message.content`，**没 strip 掉 `<think>` 块**——结果就是 `<think>[思维链]</think>[实际回复]` 整段作为 narrative 行渲染到对话气泡里
- 即使能 extract 出思维链，content 里也**同时**混着 `<think>` 标签和思维链内容

**修复**：

- `utils/safeApi.ts:413` 新增 `extractContent`（**已经有**）—— 但 DateApp 没用，现在用上
- `utils/safeApi.ts:422-454` 新增 `extractThinking(data)` 工具函数，**兜底多字段**：
  1. `message.reasoning_content`（OpenAI 标准 / DeepSeek R1 / 官方 Qwen3）
  2. `message.reasoning`（少数中转的别名）
  3. 顶层 `data.reasoning_content`（极个别中转）
  4. `message.content` 里的 `<think>...</think>` 块（即享 / 部分中转 / 某些 Qwen 蒸馏小模型）
- `apps/DateApp.tsx:389, 469` 两处 fetch 改用 `extractContent(data)` 拿 content（自动 strip `<think>` 块），`extractThinking(data)` 拿 thinking

**附带修复**（虽然这次 DateApp 用不到，但作为基础设施）：

- `utils/safeApi.ts:357` 的 `anthropicResponseToOpenAI` 加了 Anthropic 思维链到 `reasoning_content` 的合成——以后 DateApp 走 Claude 协议时，`content[].type === 'thinking'` 块会被自动标准化到 `message.reasoning_content` 字段

### 2. 思维链中文

暮色反馈"思维链是英文的"。根因：Claude thinking 模型默认输出**英文**思考过程。

**修复**：

- `apps/DateApp.tsx:363-369, 449-453` 两处 system prompt 末尾加 `### 推理语言` 段：
  - "推理 / 思考内容必须用中文输出"
  - "即使内容引用英文术语 / 代码片段，思考和解释也用中文"
  - "最终回复（带 [emotion] 标签的部分）保持中文对话风格"

**注意**：Anthropic 官方说 thinking 是模型内部的推理过程，prompt 引导**有效但不一定 100% 听**。如果不灵，下一步选项：
- B. 显式 thinking 参数 + budget_tokens（要改 fetch body 格式）
- C. 客户端 UI 加翻译按钮

### 3. 输入框回填（接上次修 bug）

暮色之前反馈"这轮没收到回复，没办法直接重新发送请求，只能重新输入再发送"。

**修复**（在 commit `ab34d94` 之后、这次 commit 之前改的，这次一起提交）：

- `components/date/DateSession.tsx:537-541` `handleSend` catch 块加 `setInput(trimmed)` 回填上次发送的文本
- 用户体验：API 失败 → 输入框**自动**恢复成上次发的内容 → 直接按发送就能重试

## 动了哪些文件

- `utils/safeApi.ts:357-403` — `anthropicResponseToOpenAI` 加 reasoning_content 合成
- `utils/safeApi.ts:422-454` — 新增 `extractThinking` 工具函数（多字段兜底）
- `apps/DateApp.tsx:10` — import 加 `extractContent` / `extractThinking`
- `apps/DateApp.tsx:363-369` — handleSendMessage prompt 加「推理语言」段
- `apps/DateApp.tsx:385-394, 465-471` — 两处 fetch 改用 `extractContent` + `extractThinking`
- `apps/DateApp.tsx:449-453` — handleReroll prompt 加「推理语言」段
- `components/date/DateSession.tsx:536-541` — `handleSend` catch 块 `setInput(trimmed)` 回填

## 踩坑 / 需要知道的（重要）

- **"没折叠"的根因**：Vercel 部署可能没刷新到手机浏览器——之前暮色测的版本**没有** `extractContent` 这步 strip，所以 `<think>` 块直接渲染成了 narrative 行。**这次 push 后再测应该正常**。
- **extractThinking 第 4 个兜底**匹配 `<think>([\s\S]*?)<\/think>`（非贪婪），能正确处理**单个**思考块。如果中转站返回**多个** `<think>` 块（理论上不应该有），会**只 match 第一个**。后续要支持的话改 `[\s\S]*?` → `matchAll` 即可。
- **prompt 改动的范围**：只在 DateApp 两处加了。**聊天页**的 system prompt（`ContextBuilder.buildCoreContext`）**没改**——如果暮色要让聊天页的 thinking 也是中文，得改 `utils/context.ts` 那个全局 prompt。这次先按"见面 app 优先"做。
- **`.thinking` 字段的兜底逻辑**：在 anthropicResponseToOpenAI 里取的是 `block.thinking`（Anthropic 4.5+ 字段名），兜底 `block.text`（旧版兼容）。**单条 thinking 块 type 可能是 'redacted_thinking'**（用户主动隐藏的思维链），那种情况下 `block.thinking` 是空、`block.data` 是加密 blob——目前会被过滤掉（`.filter(s => s.length > 0)`），符合预期。
- **extractThinking 是 export 出来的**——`useChatAI` / MemoryPalace / Gallery 等其他模块后续要"显示思维链"可以直接用，不用各自实现多字段兜底。

## 备注

- "兼容思维链" / "返回思维链摘要" / "Claude 推理强度" 是**即享中转站**的开关，跟 SullyOS 没关系——暮色截图里都开着，行为已经覆盖 `<think>` 块场景
- "返回思维链摘要"开关=开 → 即享给**短摘要**；关 → 给**完整过程**。暮色目前开着（短摘要），token 成本低
- "Claude 推理强度"=高 → 模型想得更深，token 成本更高；想降低推理成本可以改"中"或"低"
- 后续要支持 Gemini 协议的 `parts[].thought: true` 字段，需要再写一个 `extractGeminiThinking`（参考 `geminiRequestBody` 路径下 fetch 后的解析）
- 这次 commit 也包含上次的"输入框回填修复"——上次没单独 commit 一起带了
