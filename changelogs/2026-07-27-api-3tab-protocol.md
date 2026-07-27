# API 配置 3 tab 协议平等切换（OpenAI / Claude / Gemini）

**日期**：2026-07-27
**涉及 commit**：`1901abe` `aaaacde`

## 改了什么
- **第一版（1901abe）**：Gemini 走独立折叠块 + OpenAI/Claude 在高级里二选一 → 暮色反馈"不平等"+"Gemini 直连没法保存预设"
- **第二版（aaaacde）**：改成 3 tab 平等切换（OpenAI / Claude / Gemini），每个 tab 独立 URL/Key/Model
  - **主 API**：3 tab 切换协议 + 一组 URL/Key/Model 缓存（3 套独立）
  - **识图**：同样 3 tab 切换
  - **生图**：保持现状不动（OpenAI 兼容 + Gemini 直连折叠块）
  - **API 预设**：保存时记当前选定的协议 + 3 套 URL/Key/Model，加载预设自动切回对应协议

## 3 tab 切换逻辑
- 顶部 3 个 tab（OpenAI / Claude / Gemini）
- 切 tab 时：把当前输入框值存到**旧协议缓存** + 从**新协议缓存**读取填入
- 选 Gemini 时如果 geminiBaseUrl 为空，自动填 Google 官方 URL（`https://generativelanguage.googleapis.com/v1beta`）
- 选 OpenAI / Claude 不自动填，让用户自己填
- 3 套缓存（claudeBaseUrl/apiKey/model + geminiBaseUrl/apiKey/model + baseUrl/apiKey/model）独立保存，**切回 tab 不丢之前的值**

## 协议判断逻辑（useChatAI.ts）
- **第一版（1901abe）**：URL 含 `generativelanguage.googleapis.com` 自动判断走 Gemini
- **第二版（aaaacde）**：直接读 `protocol` 字段（`'openai' | 'claude' | 'gemini'`），不再看 URL
- 主 API 注入 effectiveApi 时根据 protocol 选 baseUrl/claude*/gemini* 三组中的对应那组
- 识图类似，根据 visionProtocol 选 vision*/visionClaude*/visionGemini*
- 生图 Gemini 仍走独立 imageGemini* 配置（暮色说生图不改）

## 协议分支实现
- **OpenAI 协议**（默认）：`/v1/chat/completions`，标准 OpenAI 请求体，可挂 tool（麦当劳、生图）
- **Claude 协议**：`/v1/messages`，Anthropic 标准，system 字段在顶层，不挂 tool
- **Gemini 协议**：`/v1beta/models/{model}:generateContent?key=xxx`，Google 官方协议
  - 请求体 `contents/parts` + `systemInstruction` 顶层
  - Key 走 URL 参数（不是 Authorization header）
  - 不挂 tool（function calling 格式不同）

## UI 改造
- 主 API 卡片顶部加 3 tab 切换器（OpenAI / Claude / Gemini 横向 3 列）
- 切 tab 时输入框 + 提示文字同步更新
- 删掉之前的"Gemini 折叠块"和"GPT 直连快捷入口"（被 3 tab 取代）
- 识图卡片同样 3 tab 切换
- ApiQuickFloat 浮窗同步 3 tab

## 动了哪些文件
- `types.ts` — APIConfig 加 6 字段（claudeBaseUrl/Key/Model + geminiBaseUrl/Key/Model），protocol 扩展为 3 选项
- `hooks/useChatAI.ts` — 协议判断从 URL 改为读 protocol；effectiveApi 注入时按 protocol 选对应那组
- `apps/Settings.tsx` — 主 API / 识图两处 3 tab UI + state + 保存 handler + API 预设记 3 套字段
- `components/os/ApiQuickFloat.tsx` — 浮窗主 API 同步 3 tab

## 踩坑 / 需要知道的
- **保存配置时同时存 3 套**：之前 bug 是"切到 OpenAI tab 点保存时，claude/gemini 缓存会丢"。修复：handleSaveApi 一次性存 3 套（即使当前不在那组），不然切回 tab 时之前的配置会丢
- **API 预设 schema 兼容**：`handleSavePreset` 时把当前 3 套字段都存进预设对象，加载时按预设里记的 protocol 自动切回对应那组
- **角色独立 API 走 OpenAI 协议**（暮色明确说"这个不用改"）：`char.apiConfig` 只有 baseUrl/apiKey/model 三个字段，没有 protocol / claude* / gemini*。useChatAI 在角色覆盖 baseUrl 时不应用 3 tab 协议切换逻辑（保持原行为）
- **Gemini 流式输出没做**：Gemini 分支强制非流式（流式响应是不同事件格式）
- **Gemini 模式不挂 tool**（function calling 格式跟 OpenAI 不同），想用 tool 切回 OpenAI

## 暮色审美相关
- 3 tab 用「小圆点 + 文字」组合（绿点 = OpenAI / 橙点 = Claude / 蓝点 = Gemini），跟 TTS 那套配色保持一致
- 选中 tab 用 `bg-white text-slate-700 shadow-sm ring-1 ring-slate-200`，圆角 `rounded-xl`
- tab 容器 `bg-slate-50/60 rounded-2xl p-1 flex gap-1 border border-slate-200/50`
- 协议切换提示文字用 `text-[10px] text-slate-400 leading-relaxed pl-1 -mt-2`

## 备注
- 旧字段 `visionGeminiBaseUrl/apiKey/model`（第一版加的）已删除，迁到新的 `visionGeminiBaseUrl`（保持兼容）—— 老用户数据从 localStorage 自动迁移（不存旧字段值就用空字符串兜底）
- `protocol === 'claude'` 仍走 Anthropic 协议，cache_control 透传依赖服务端支持（即享 ccmax2 0.6x 当前 OpenAI 协议，切 Claude 前先确认服务端有 /v1/messages 端点）
- 后续要做：3 tab 平台扩展（Vertex AI / DeepSeek / OpenRouter / Grok）—— 等暮色确认是否需要
