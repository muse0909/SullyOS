# Gemini 直连的 baseUrl 全量归一化 —— 100 多处调 API 的地方一次性接上

**日期**：2026-09-30
**涉及 commit**：（见 git log，`fix/call-voice` 分支）

## 改了什么

暮色反馈：「Gemini 直连还是识别不到，今天主动消息修过这个增加一个 OpenAI 兼容的那个后缀就行。
然后你查一下所有调用 API 的地方，还有哪些地方有这个问题，都接上。」

- **新增 `utils/chatApiCompat.ts`** —— 「聊天 API 按协议归一化」的全项目唯一出处。
  - `resolveChatApiTriplet()`：按 `protocol` 取当前真正生效的 baseUrl / apiKey / model，
    Gemini 走 `gemini*` 三件套（密钥池优先），并补 Google 官方 OpenAI 兼容层 `/openai` 后缀。
  - `withEffectiveChatApi()`：把生效值**映**进 `baseUrl/apiKey/model`，`gemini*` 原样保留。
  - `normalizeChatBaseUrl()`：Gemini 感知的 `normalizeApiUrl`。
- **`context/OSContext.tsx`**
  - 交给使用方的那份 `apiConfig` 改成归一化后的（`exposedApiConfig`），
    100 多处按 OpenAI 那种调法读 `apiConfig.baseUrl` 的地方**一行都不用改**。
  - `apiConfigRef` 也改成存归一化那份，修「彼方」`runVRSession`（纯 OpenAI 调法，原先拿的是原始配置）。
  - `updateApiConfig` 加护栏：挡住归一化派生的值落盘（见下）。
  - 本地 `normalizeApiUrl` 改成薄封装，转发到共享实现。
- **`hooks/useChatAI.ts`**：本地那份重复的 `normalizeApiUrl` 同样改成转发。
- **`utils/amsgLlmCredentials.ts`**：`resolveAmsgApiTriplet` 改成调共享实现，
  删掉重复的 `/openai` 规则（语义不变，缺字段照样返回 null）。
- **`utils/activeMsgRuntime.ts` / `utils/instantToolRunner.ts`**：这俩跑在 React 之外、
  直接读 `localStorage['os_api_config']`（拿不到 context 归一化那份），各自补一次
  `withEffectiveChatApi`。

## 为什么不是「逐个改 100 多处」

同一个逻辑字段在 `APIConfig` 里存了两套名字（`baseUrl/apiKey/model` vs
`geminiBaseUrl/geminiApiKey/geminiModel`），设置页保存时按当前协议只写「那一套」、另一套清空。
于是 `protocol === 'gemini'` 时 `apiConfig.baseUrl` **是空的**，而全项目 100 多处都按
「读 baseUrl + 拼 `/chat/completions` + `Authorization: Bearer`」发请求，且都不判协议
→ Gemini 直连用户点哪坏哪。打电话只是最先撞上的那个。

逐个改不现实（下一个人加新功能还会再犯），所以改成**在数据出口归一化**：
交出去的那份 `apiConfig` 里 `baseUrl/apiKey/model` 一律是当前协议生效的值。

## 踩坑 / 需要知道的（重要）

### 1. 归一化和 `/v1` 补全必须成对改，只改一个照样打错

项目里到处是 `normalizeApiUrl()`：地址不以 `/v数字` 结尾就补 `/v1`，防中转站根路径 404。
但 Gemini 的地址是 `.../v1beta`，`v1beta` 不是 `v1`（正则 `/\/v\d+$/` 匹配不上，后面还有字母）
→ 补完变成 `.../v1beta/v1`，Google 那边没这个路径。补了 `/openai` 之后也一样会被补成
`.../v1beta/openai/v1`。

所以这次是**两处一起改**：地址补 `/openai` + 补全函数对 Gemini 形状的地址不补 `/v1`。
只改一个会得到 `.../v1beta/v1/chat/completions` 这种更长的错地址。

### 2. 为什么是「映」而不是「换」

Gemini 原生调用（`:generateContent`，见 `useChatAI` 的 `useGeminiProtocol`、
`utils/memoryPalace/llmCall.ts`）读的是 `gemini*` 字段。把生效值**映**一份到
`baseUrl/apiKey/model`，两种读法同时成立，谁都不用改。

### 3. 派生值落盘会变成看不见的脏数据

设置页有一堆 `updateApiConfig({ ...apiConfig, 改别的字段 })` 的保存（识图 / 图床 / 生图 /
TTS / 语音识别…）。那个展开带进来的 `baseUrl` 是**归一化产物**，一旦落盘就成了脏数据——
Gemini 用户哪天切回 OpenAI，`baseUrl` 里就躺着一个 `.../v1beta/openai`，界面上还显示得好好的。

`updateApiConfig` 里加了 `keepStoredIfDerived` 护栏，判据只认一种：**新值恰好等于我们交出去的那个派生值**。
只挡派生源，别的一律照旧——设置页显式写 `''`（切协议时清另一套）、预设加载、备份恢复全都原样放行。
一开始想的是「非当前协议那组一律以存储为准」，那样会连备份恢复的 `baseUrl` 一起吃掉，是个真回归，已放弃。

### 4. 主动消息（原生 Gemini）行为不变

`apiConfigRef` 现在存的是归一化那份，但主动消息那条路径自己按 `protocol` 选字段，
Gemini 读 `geminiBaseUrl` 走原生 `:generateContent`——镜像没动 `gemini*`，行为不变。
改 ref 是为了顺带修「彼方」（`runVRSession` 是纯 OpenAI 调法，拿原始配置会 `no-api` 直接不跑）。

### 5. 非 Gemini 协议时对象身份不变

`withEffectiveChatApi` 在 `protocol !== 'gemini'` 时返回**原对象引用**（不是副本），
依赖引用比较的 memo / effect 不会被白白打醒。

## 备注

- 归一化只管**主聊天 API**。识图（`visionProtocol` / `visionGeminiBaseUrl`）、
  记忆宫殿副 API（`memoryPalaceConfig.lightLLM`）是各自独立的配置，
  `useChatAI` / `llmCall` 里本来就有自己的 Gemini 分支，没动。
- 角色独立 API（`char.apiConfig`）和 API 预设是各自的配置对象，走各自的抽屉，不在这次范围内。
- 待验证：Gemini 直连下打电话、朋友圈、写作等原先报「请先在设置里配置聊天 API URL」的地方是否都活了。
