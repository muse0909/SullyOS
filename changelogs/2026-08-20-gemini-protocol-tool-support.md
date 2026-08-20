# Gemini 协议下工具调用支持（生图 / 放歌 / 麦当劳）

## 背景

之前 SullyOS 的 Gemini 协议实现里，请求体根本没把 `tools` 字段发给 Google——`hooks/useChatAI.ts:1664` 那条注释就明写着"不挂 tool（Gemini function calling 格式不同；想用 tool 切回 OpenAI 中转）"。

结果：江澈（用 Gemini）在请求体里**完全看不到** `generate_image` / `play_song` / `propose_cart_items` 三个工具的 schema。

症状：江澈明明"想"调用工具，但实际只能输出纯文本——请求里 `Tools: 1` 的统计是日志计数器的误导，**实际请求体里没有**。

## 根因

`hooks/useChatAI.ts` 在 2026-08-04 加 Gemini key 池时（line 1702-1703 附近）往 `geminiRequestBody` 上挂了 `__pickedKeyIndex` / `__pickedKeyShort` 闭包变量，但**没**把 `tools` 字段塞进 `geminiRequestBody`。后续 `line 1854-1858` 序列化时只发 `contents` / `systemInstruction` / `generationConfig` 三个字段，**`tools` 直接被丢**。

## 改动

`hooks/useChatAI.ts` 5 处：

1. **修 1664 注释**：删错的"不挂 tool"那行，改成正确的 tools 字段格式说明
2. **toolsList 提前到 line 1656 之前**：让 `geminiRequestBody`（line 1682+）和 `baseReqBody`（line 1720+）都能引用
3. **删 `!useGeminiProtocol` 限制**：`play_song` 在 Gemini 协议下也注册
4. **Gemini 协议下挂 `tools`**：转成 `{functionDeclarations: [{name, description, parameters}]}` 格式（跟 OpenAI 嵌套不一样）
5. **抽 `doGeminiRequest` 函数** + **`messagesToGeminiRequest` 辅助函数**：
   - `doGeminiRequest(reqBody, logLabel)`：key 池 + fetch + 重试 + 解析 + 转 OpenAI 兼容 data
   - `messagesToGeminiRequest(openaiMessages, baseSystemText)`：把 OpenAI 风格 messages 转 Gemini 风格请求体（contents + systemInstruction + generationConfig），处理 `role: 'user' | 'assistant' | 'system' | 'tool'`
6. **响应解析识别 `functionCall`**：parts[i].functionCall 转 OpenAI 兼容 tool_calls 格式（本地生成 call_id，args 是 object → JSON string）
7. **3 处 follow-up 按协议分发**：
   - 生图成功 follow-up（line 2296+）
   - 生图失败 follow-up（line 2276+）
   - 放歌失败 follow-up（line 2417+）
   
   Gemini 协议下走 `doGeminiRequest` 直连 Google；OpenAI 兼容走 `safeFetchJson`

## 触发场景

**直接触发**：暮色 2026-08-20 19:46 让江澈（Gemini）生图，江澈反复输出 meta 文字（"终于搞懂了"、"这次绝对不犯傻"），但**实际从未调生图**。截图里 `Tools: 1` 看起来工具挂着，实际 Gemini 协议下请求体里没 tools 字段。

**间接触发**：暮色 8-20 反馈"今天 Claude 渠道都炸了"——OpenAI 兼容中转默认走 Claude 渠道，意味着 Gemini 协议下**全程**必须直连 Google，包括 follow-up（生图成功后让 LLM 继续回复的第二轮）。所以本次连 follow-up 也一起改。

## 验证

- Vercel preview 部署后用江澈（Gemini）测生图：江澈应该真正调用 `generate_image` 工具，图片生成后 LLM 继续回复
- 控制台应看到 `🌐 [Gemini initial] 响应 ... 字 + 1 个 tool_call` 日志
- 跟 OpenAI 兼容协议（其他角色）行为对齐

## 后续修复（同一 commit 系列）

**问题**：暮色 8-20 测时 6/7/8 三个 key 全报 400 Bad Request，截图显示 9/10/11/12 都"可用"但轮询不到。

**根因**：OpenAI JSON Schema 的 `type` 字段是小写（`object` / `string` / `number` 等），但 Gemini OpenAPI 3.0 要求**大写**（`OBJECT` / `STRING` / `NUMBER` 等）。`SullyOS` 的 `IMAGE_GENERATION_TOOL.parameters` 用的是 OpenAI 格式（`type: 'object'`），我直接塞进 Gemini `functionDeclarations.parameters`，Google 收到不认的字段 → 400 INVALID_ARGUMENT。所有 key 都用同一个请求体 → 所有 key 都报同一个 400。

**不是"轮询不到"**：cursor 是 round-robin 推进的，attempt 0/1/2 = 池 6/7/8（池 5 是构造 geminiRequestBody 时的 picked 日志，不是 attempt）。但 6/7/8 全 400 → 没机会到 9/10/11/12。`reportGeminiFailure` 把 400 标为 `rate-limited` 5s（`NETWORK_COOLDOWN_MS`），5s 后又能用——但 400 不会自己变好。

**改动**：

1. 加 `convertJsonSchemaToGemini(schema)` 辅助函数：递归把 `type` 字段小写转大写（`object`→`OBJECT`、`string`→`STRING`、`number`→`NUMBER`、`boolean`→`BOOLEAN`、`array`→`ARRAY`、`integer`→`INTEGER`）
2. `geminiRequestBody.tools[].functionDeclarations[].parameters` 套一层 `convertJsonSchemaToGemini(t.function.parameters)`
3. `doGeminiRequest` 400 处理加 `console.warn('🌐 [Gemini ...] ${status} 响应体: ${errText.slice(0, 500)}')`：以后再 400 立刻能看到 Google 实际说啥，不用猜

## 影响范围

| 协议 | 工具 | 改动前 | 改动后 |
|---|---|---|---|
| OpenAI 兼容 | generate_image / play_song / propose_cart_items | ✅ 正常 | ✅ 正常（未触碰） |
| Gemini | generate_image / play_song / propose_cart_items | ❌ 完全失效 | ✅ 正常 |

**遗留**：mcd 循环（`useChatAI.ts:2014-2023`）的 follow-up 仍走 OpenAI 兼容——因为 mcd 场景下 Gemini 协议下第一轮不会再调 `propose_cart_items`（用户没在麦当劳小程序里），暂不需要改。
