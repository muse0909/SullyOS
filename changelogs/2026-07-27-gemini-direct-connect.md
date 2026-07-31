# Gemini 直连（Google 官方协议）主 API / 识图 / 生图三通道

**日期**：2026-07-27
**涉及 commit**：`1901abe`

## 改了什么
- **新增 Gemini 直连通道**：填 Google AI Studio Key + URL 走官方协议，不依赖中转站
- **覆盖三个位置**：
  - 主 API（聊天 / 约会）— `geminiBaseUrl/Key/Model`
  - 识图（独立通道）— `visionGeminiBaseUrl/Key/Model`
  - 生图（Google Imagen / Gemini Image）— `imageGeminiBaseUrl/Key/Model`
- **GPT 直连快捷入口**（主 API）：一键填 `https://api.openai.com/v1` + `gpt-4o-mini` 到现有主 API 字段
- **OpenAI 兼容 / Claude 协议完全保留**，没动

## 协议分支逻辑（useChatAI.ts）
- 自动检测：URL 含 `generativelanguage.googleapis.com` → 走 Gemini 协议
- 请求体：OpenAI `messages` 格式 → Gemini `contents/parts` 格式
  - system 消息 → 顶层 `systemInstruction` 字段
  - role: 'assistant' → 'model'
  - 字符串 content → `{ text: '...' }`
- 端点：OpenAI `/v1/chat/completions` → Gemini `/v1beta/models/{model}:generateContent?key=xxx`
- Key 位置：`Authorization: Bearer xxx` → URL 参数 `?key=xxx`
- 响应：Gemini `candidates[].content.parts[].text` → 转成 OpenAI `choices[].message.content`（下游代码零改动）

## 识图 Gemini 直连（独立 Key）
- 优先用 `visionGeminiBaseUrl/Key/Model`（独立配置）
- 否则用现有 `visionBaseUrl`（URL 含 Google 官方时也走 Gemini 协议）
- base64 dataURL 拆 `mimeType + inlineData`
- 外链 HTTPS 图片走 `fileData.fileUri`（Google 端能直接 fetch）

## 生图 Gemini 直连（双模型支持）
- `gemini-2.0-flash-exp` 等多模态生图：
  - 端点 `:generateContent` + `generationConfig.responseModalities: ['TEXT', 'IMAGE']`
  - 响应 `candidates[].content.parts[].inlineData` 提取 base64
- `imagen-3.0-generate-002` 专用：
  - 端点 `:predict` + `instances[].prompt` + `parameters.aspectRatio`
  - 响应 `predictions[].bytesBase64Encoded` 提取 base64
- b64 拿到后走现有图床上传链（imgbb）转永久 URL，没配图床用 data URL 兜底

## UI 改造
- 三处"Gemini 直连"折叠卡片（绿色调 `bg-emerald-50/50 border-emerald-200/50`），默认收起不打扰
- 各自独立保存按钮（不依赖主 API 的"保存配置"）
- 模型列表拉取自动识别 Gemini 端点走 `?key=` 参数

## 动了哪些文件
- `types.ts` — APIConfig 加 9 个字段
- `hooks/useChatAI.ts` — 主 API Gemini 分支 + 识图 Gemini 分支 + 生图 Gemini 分支（双模型）
- `apps/Settings.tsx` — state + save handler + 三个折叠 UI 块 + GPT 直连快捷入口 + fetchModels 端点适配
- `components/os/ApiQuickFloat.tsx` — state 同步 + handleSaveAndClose 带 Gemini 字段

## 踩坑 / 需要知道的
- **Gemini 协议不支持 tool 挂载**（function calling 格式跟 OpenAI 不同），所以 Gemini 模式下：
  - 麦当劳小程序 propose_cart_items 工具不挂
  - 生图工具不挂（生图走独立 Gemini 通道，不在主 API 走）
  - 想用 tool 时切回 OpenAI 中转即可
- **流式输出未实现**：Gemini 流式响应是不同事件格式（content_block_delta 等），当前 Gemini 分支强制非流式
- **不抢现有逻辑**：主 API URL 走中转站（cm.jixiangai.xyz）时仍然走原 OpenAI/Claude 协议，完全不影响现有用户
- **fetchModels 改了一行**：Gemini 端点会判断 `generativelanguage.googleapis.com` 自动用 `?key=` 参数拉模型列表
- **备份零改动**：apiConfig 整块 localStorage 序列化（OSContext.tsx:1710），新字段自动包含

## 暮色审美相关
- Gemini 直连卡片用绿色调（`emerald-50/200/500/700`）跟主 API 蓝色调区分
- 标题 + 小图标 + 副标题一行（"🌐 Gemini 直连" + "Google 官方协议 · 独立于 OpenAI / Claude"）
- 折叠按钮右侧 chevron 旋转动画（showGemini ? 'rotate-180' : ''）
- 保存按钮圆角胶囊（`rounded-2xl` + 居中文字 + `active:scale-95`）

## 备注
- 没做：Gemini 流式输出、function calling 支持、Imagen 视频生成（Veo）
- 用户测试建议：
  1. 主 API 填 `https://generativelanguage.googleapis.com/v1beta` + Google AI Studio Key + `gemini-2.0-flash`，发消息看是否走 Gemini 协议
  2. 识图发图看是否走 visionGemini
  3. 生图触发 `generate_image` tool 看是否走 imageGemini（注意：主 API 不能挂生图 tool，所以生图 Gemini 必须独立配）
- 出错看控制台：🌐 [Gemini] / 🌐 [Vision Gemini] / 🌐 [ImageGen Gemini] 三个 prefix 的 log
