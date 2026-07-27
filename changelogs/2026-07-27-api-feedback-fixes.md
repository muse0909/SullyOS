# 3 个 API 反馈修复（生图 / 副 API / 角色 API）

**日期**：2026-07-27
**涉及 commit**：`795fae0`

## 改了什么
暮色 2026-07-27 反馈 3 个问题，本 commit 全部修完：

### 1. 删生图 Gemini 折叠块
暮色原话"生图这边还有个 Gemini，去掉吧"。

- 删 `Settings.tsx` 的「Gemini 直连（生图）」折叠块
- 删 `useChatAI.ts` 生图 Gemini 协议分支（useImageGeminiProtocol + Gemini 多模态生图 + Imagen 3 `:predict` 端点 + b64 提取）
- 删 `types.ts` `imageGeminiBaseUrl/apiKey/model` 字段
- 生图现在**只走 OpenAI 兼容协议**（暮色之前明确说"生图不用"3 tab 切换）

### 2. 记忆宫殿副 API 加 3 tab 切换
暮色原话"记忆宫殿的副 API 这里没有加 3 个 tab 切换"。

- `lightLLM` 类型加 `protocol` 字段 + `claudeBaseUrl/apiKey/model` + `geminiBaseUrl/apiKey/model` 6 字段
- `MemoryPalaceApp.tsx` 加 3 tab UI（OpenAI/Claude/Gemini）+ 3 套独立 state
- `switchLightProtocol` handler 切 tab 自动存当前值到旧缓存
- 副 API 预设也记 protocol 字段，加载时按 protocol 切 tab
- 抽统一 `callLLM` helper（`utils/memoryPalace/llmCall.ts`）支持 3 协议
- 6 处散落的 OpenAI 兼容 fetch 调用改成 `callLLM`：
  - `extraction.ts`（缓冲区记忆提取）
  - `migration.ts`（老数据迁移）
  - `eventBoxCompression.ts`（EventBox 摘要压缩）
  - `digestion.ts`（消化审查 + 性格风格检测）
- `fetchLightModels` 自动识别 Gemini 端点走 `?key=` 参数

### 3. 角色独立 API 加 3 tab 切换（修 Gemini 预设 401 bug）
暮色原话"图二角色单独 API 设置中切换到 Gemini 预设会报错"。

**根因**：
- 角色 API 区只有 1 组 URL/Key/Model
- 切到 Gemini 预设时，baseUrl 被填了 `https://generativelanguage.googleapis.com/v1beta`
- 但 apiKey 还是 OpenAI 协议（中转站）的 Key
- 刷新模型列表时 → `GET https://generativelanguage.googleapis.com/v1beta/models 401 Unauthorized`

**修复**：
- 加 `perCharApiProtocol` + `perCharApiClaude*` + `perCharApiGemini*` 7 字段
- `switchPerCharApiProtocol` handler 切 tab 自动存当前值到旧缓存
- `handleLoadPresetIntoPerChar` 按预设里记的 `protocol` 同步切 tab + 填对应那组 URL/Key/Model
- 预设 active 判断按 `protocol` + 3 套字段比较（修显示串色 — 之前 baseUrl 一样就 3 个一起亮）
- `handleRefreshPerCharModels` 自动识别 Gemini 端点走 `?key=` 参数，模型 name 剥 `models/` 前缀
- `handleSavePerCharApi` 同时存 3 套（切回 tab 不丢之前的值）
- `ChatSettingsDrawer` 加 3 tab UI（OpenAI/Claude/Gemini + 绿/橙/蓝小圆点）

## 动了哪些文件
- `types.ts` — 删 `imageGemini*` 3 字段
- `hooks/useChatAI.ts` — 删生图 Gemini 分支（~90 行）
- `apps/Settings.tsx` — 删生图 Gemini 折叠块 + state + 同步
- `context/OSContext.tsx` — `lightLLM` 加 protocol + 6 字段
- `apps/MemoryPalaceApp.tsx` — 副 API 加 3 tab + switchLightProtocol + 预设按 protocol 切
- `components/chat/ChatSettingsDrawer.tsx` — 角色 API 加 3 tab + 预设按 protocol 切
- `apps/Chat.tsx` — 角色 API state 扩展 + 3 tab handler + 预设加载按 protocol 切
- `utils/memoryPalace/llmCall.ts` (新) — 统一 3 协议 LLM 调用 helper
- `utils/memoryPalace/pipeline.ts` — `LightLLMConfig` 加 `protocol` 字段
- `utils/memoryPalace/extraction.ts` `migration.ts` `eventBoxCompression.ts` `digestion.ts` — 6 处散落 fetch 改 `callLLM`

## 踩坑 / 需要知道的
- **build 报错**：
  - `Expected "finally" but found ")"`：第一次改 `handleRefreshPerCharModels` 加 Gemini 分支时把 `});` 留了重复
  - `The symbol "isGemini" has already been declared`：line 333 重复声明（同函数内 fetch 分支有 `isGemini`，后面 models 解析又声明）→ 改名 `isGeminiResp`
- **6 处迁移到 callLLM helper**：每处大约 5-15 行减少，逻辑统一在一个文件里；以后改协议只改 helper
- **`callLLM` 走 dynamic import**（`await import('./llmCall')`）避免循环引用（pipeline 已经被多个文件 import）
- **Gemini 协议响应解析**：
  - OpenAI: `data.choices[0].message.content`
  - Claude: `data.content[0].text` + `usage.input_tokens/output_tokens`
  - Gemini: `data.candidates[0].content.parts[0].text` + `usageMetadata.promptTokenCount/candidatesTokenCount`
  - helper 返回 `text` + `raw` + `usage`，调用方按需取
- **角色 API 预设 active 判断**（修显示串色）：
  - 之前 `baseUrl + apiKey + model` 三者相等就亮 → 同 baseUrl 中转站有 3 个预设（如「即享p克 / 即享free / 青羽」）会 3 个一起亮
  - 现在按 `protocol + 该协议对应那组的 baseUrl/apiKey/model` 比较 → 互不串
- **loadPreset 切 tab 顺序**：先 `switchPerCharApiProtocol(loadedProto)` 切 tab，再 set 该组的值，再 set 当前的 baseUrl/Key/Model（switch 内部会自动从缓存读旧值填入，但需要重新设一次以匹配新值）

## 备注
- **未改**：生图相关代码（暮色原话"生图不用"），保持只走 OpenAI 兼容
- **未改**：角色 API 自动跟随全局 protocol 的逻辑（暮色之前说"不用改"，仍按 baseUrl/apiKey/model 覆盖）
- **生图 Gemini 用户**：如果之前配过 `imageGemini*` 字段，现在删了——生图会回退到 OpenAI 兼容配置（如果没配则会报"生图 API 配置不完整"）
- **副 API / 角色 API 老用户**：localStorage 里老 `lightLLM.baseUrl/apiKey/model` 仍生效，切到 OpenAI 协议即可继续用
