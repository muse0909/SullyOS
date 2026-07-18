# API 协议分支 + OpenAI 协议去掉 cache_control 字段 + Claude 协议完整实现

**日期**：2026-07-17
**涉及 commit**：（待提交）
**根因**：即享站长反馈"走 openai 接口不能加 claude 字段，会被 newapi 丢弃"

## 改了什么

### 1. `types.ts` — `APIConfig` 加 `protocol` 字段
```ts
protocol?: 'openai' | 'claude';
// 'openai' (默认): /v1/chat/completions，不发 cache_control
// 'claude':         /v1/messages，发 4 断点 cache_control
// Missing → 'openai'（老用户无缝兼容）
```

### 2. `utils/safeApi.ts` — 加协议分支
- `safeFetchJson` 加第 5 个参数 `protocol: 'openai' | 'claude' = 'openai'`
- **OpenAI 协议**（默认）：原样转发
- **Claude 协议**：
  - 路径切到 `/v1/messages`（自动从 caller URL 提取 base）
  - headers 加 `x-api-key` + `anthropic-version: 2023-06-01`（如果有 `Authorization: Bearer` 也会转成 x-api-key）
  - 响应体内部转 OpenAI 格式合成对象返回（`anthropicResponseToOpenAI`）
- **`anthropicResponseToOpenAI` 转换函数**：
  - `data.content[0].text` → `data.choices[0].message.content`
  - `stop_reason: 'end_turn' / 'max_tokens' / 'tool_use'` → `'stop' / 'length' / 'tool_calls'`
  - `usage` 字段透传（包括 cache_creation_input_tokens / cache_read_input_tokens）
  - **关键**：上层 19 处 `data.choices[0]...` **一行不用改**

### 3. `hooks/useChatAI.ts` — 4 断点 cache + 主 chat 协议分支
- 读 `effectiveApi.protocol ?? apiConfig.protocol ?? 'openai'`
- `useClaudeCache` 决定 4 断点是否带 cache_control
- **OpenAI 协议**（默认）：
  - system content 退化成 string（newapi 不接受 array of blocks）
  - **不发 cache_control 字段**（之前不管什么协议都发，被 newapi 默默丢弃）
  - history 最后一条也不打 cache_control
- **Claude 协议**：
  - 保留 4 断点 cache_control 块（bp1/bp2/bp3 system + bp4 history）
  - 1h TTL 标记
- **Claude 协议时不挂 tool**（Anthropic tool_use 协议格式跟 OpenAI tool_calls 不同，等以后真用 Claude 协议 + tool 再补）
- **Claude 协议时强制 stream=false**（safeApi 的 SSE 解析只支持 OpenAI 协议）
- 主 chat + tool_calls 重试两处 `safeFetchJson` 调用都传 `apiProtocol`

### 4. `apps/Settings.tsx` — 加 UI 切换
- 加 `localProtocol` state
- 在"高级"折叠面板里加 **OpenAI / Claude** 双选按钮组
- 切到 Claude 时显示琥珀色警告
- `handleSaveApi` 保存 `protocol: localProtocol`
- 加载 main 预设时也恢复 `protocol` 字段

### 5. `scripts/test-jixiangai-claude.sh` — 验证脚本
- bash 脚本，跑两次 curl 测试即享 `/v1/messages` 端点
- 暮色用真实 key 替换 `sk-REPLACE-ME` 后跑 `./test-jixiangai-claude.sh`
- 看响应 `usage.cache_creation_input_tokens` 和 `usage.cache_read_input_tokens` 是否 > 0

## 踩坑 / 需要知道的（重要）

1. **Sully 18:06 命中 38K cache 的真相**：
   - 不是我们打的 `cache_control` 起效，是 **Anthropic Messages API 内置的 5m 默认 TTL cache**（跟 cache_control 字段无关）
   - Sully 18:06 → 18:07 间隔 1.5 分钟，正好在 5 分钟内
   - 江澈 5 轮 19:36-19:48 间隔 1-2 分钟到 5-7 分钟，**跨过 5m TTL cache 自然失效**
   - 我们的 cache_control 一直被 newapi 默默丢弃，从来没生效过

2. **暮色跑的 curl 验证证实了"newapi 不透传 cache_control"**：
   - 同样 system 提示跑两次
   - 第 1 次 `cache_creation_input_tokens` = 0（应该 > 0 → 字段被丢）
   - 第 2 次 `cache_read_input_tokens` = 0（因为第 1 次没创建 cache）
   - ccmax2 0.6x 控制台两次都 45 input token 全价计费
   - **结论**：即享 newapi 端点**不管 OpenAI 还是 Claude 协议都丢 cache_control 字段**
   - 已发反馈给即享站长，等修

3. **Claude 协议分支暂不实现的范围**：
   - **不挂 tool**（MCD_PROPOSE_TOOL / IMAGE_GENERATION_TOOL）—— 切到 Claude 模式时这两个 tool 都不生效
   - **不实现流式**（强制 stream=false）—— safeApi 的 SSE 解析只支持 OpenAI 协议
   - **响应体解析走合成**（anthropicResponseToOpenAI）—— 19 处 `data.choices[0]...` 不改
   - **错误处理**（`data?.error?.message` 在两种协议下都 OK）—— 不用改
   - **多模态（图片）**：messages 字段格式一致（role + content array），SullyOS 现有逻辑会自动用 OpenAI image_url 格式——**Claude 协议下要换成 image 块才能识图**（暂未实现，会出现"图片未识别"问题）

4. **协议切换是配置项**：
   - 默认 OpenAI，老用户无需任何操作
   - 暮色切到 Claude 模式前需要确认：①服务端支持 /v1/messages 端点 ②服务端支持 cache_control 透传
   - 即享 ccmax2 0.6x 当前两个都不支持，**别切**（等站长修）

5. **重要新发现：model 路由**：
   - 暮色 curl 跑 claude-opus-4-6，响应返回 `"model": "claude-opus-4-8"`
   - ccmax2 0.6x 控制台显示 claude-opus-4-6
   - **响应里的 model 字段不可信**（newapi 自己填的或透传错的），**计费时显示的才是真实跑的 model**

6. **没改的地方**：
   - 没改 stream / temperature / 其他字段
   - 没改生图 / 识图 / 副 API 那些独立通道（它们本就按 OpenAI 协议发）
   - 没动 4 断点 cache 拼接逻辑（Claude 协议分支还在原位）
   - 没动 `chatPrompts.ts` 里的 `bp1Tools / bp2Rules / bp3Context` 拆分（那段跟协议无关）

## 备注

- **等即享修好后**：
  - 暮色在 Settings 切到 Claude 模式
  - 用江澈发消息，看 ccmax 控制台是否出现"缓存↓"字段
  - 如果出现 → cache 命中，验证 4 断点方案
  - 如果没出现 → 跟即享确认 Claude 端点是否真支持 cache_control 透传

- **预期收益**（假设即享 Claude 端点 + cache_control 透传都支持）：
  - 即享 ccmax: 0% 命中率 → 90%+ 命中率
  - 5 轮 50K input 0.20 美元/次 → 50K cache prefix 命中 0.02 美元/次
  - 10 倍省钱

- **如果即享加完 Claude 端点但 cache_control 还不透传**：
  - 备选：直接接 Anthropic 官方 API（贵但 cache 真有效）
  - 备选：再找别的 Claude 兼容中转站

- **未来要补的（按优先级）**：
  1. Claude 协议工具调用（tool_use / tool_result 块）—— 麦当劳 / 生图
  2. Claude 协议流式响应（content_block_delta 事件）—— 跟 OpenAI SSE 不同
  3. Claude 协议多模态（image 块 vs OpenAI image_url）—— 图片消息
