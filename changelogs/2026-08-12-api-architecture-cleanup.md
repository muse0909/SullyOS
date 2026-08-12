# API 架构梳理 + 5 项清理

**日期**:2026-08-12
**涉及 commit**:`53209b1c` `c42f36cb` `69659217` `202a74fa` `fead079b`

## 改了什么

### 任务 1：主动消息协议分支修复（最高优先级）
`context/OSContext.tsx` `runProactive` 函数（约行 1675）之前永远只读 OpenAI 字段的 `api.baseUrl / api.apiKey / api.model`，不根据当前 `apiProtocol` 切换。

修复后：
- 引入 `activeApi` 临时变量（不 mutate 原 `api` 引用避免污染 React state），按 `apiProtocol` 选 baseUrl/apiKey/model
  - OpenAI 协议：主字段
  - Gemini 协议：`geminiBaseUrl / geminiApiKey / geminiModel`
- OpenAI 协议下 baseUrl 走 `normalizeApiUrl`（写对版，缺 `/v1` 时自动补）
- Gemini 协议下请求 URL 改为 `${baseUrl}/models/{model}:generateContent?key=xxx`（跟 useChatAI Gemini 分支同款结构）
- 复用 `utils/geminiKeyPool` 的 key 池轮询（最多 3 次，401 不重试，429 切下一个）
- Gemini 协议下 fetch 走裸 fetch + 手动解析响应（`candidates[0].content.parts[0].text`）再合成 OpenAI 格式给下游
- 日志段（`sullyos:lastProactiveReqLog`）的 url / model / msgCount 也按协议分支，避免 Gemini 协议日志显示 OpenAI 字段的 url
- catch 块（`sullyos:proactiveLastError`）的 model / msgCount / firstMsgRole / lastMsgRole 也按协议分支

### 任务 2：删除 Claude 协议
- `types.ts`:
  - 删 `claudeBaseUrl / claudeApiKey / claudeModel` 字段
  - 删 `visionClaudeBaseUrl / visionClaudeApiKey / visionClaudeModel` 字段
  - `protocol` 类型从 `'openai' | 'claude' | 'gemini'` 改为 `'openai' | 'gemini'`
  - `visionProtocol` 类型同步改
- `components/os/ApiQuickFloat.tsx`:
  - `PROTOCOL_TABS` 从 `['openai', 'claude', 'gemini']` 改为 `['openai', 'gemini']`
  - `labelMap / colorMap` 删 claude
  - 删 main API 的 `localClaudeUrl / localClaudeKey / localClaudeModel` state
  - 删 vision API 的 `localVisionClaudeUrl / localVisionClaudeKey / localVisionClaudeModel` state
  - `syncedProtocol` 删 claude 分支
  - `switchMainProtocol` / `switchVisionProtocol` 签名改 `'openai' | 'gemini'`，删 claude 分支
  - `handleSaveAndClose` / `handleSavePreset` main+vision 分支删 claude* 字段
  - `loadPreset` main+vision 分支删 vProto/mProto claude 段
  - `isPresetActive` main+vision 分支删 claude 三元
  - `useEffect` deps 删 `apiConfig.claudeBaseUrl / claudeApiKey / claudeModel / visionClaudeBaseUrl / Key / Model`
  - **不动** `lightLLM` 副 API 的 Claude 字段（不在本任务范围）
- `hooks/useChatAI.ts`:
  - 删 `useClaudeProtocol / claudeSystemField` 构造
  - 删 Claude 协议 system 转 user 逻辑（行 1101-1134 整段）
  - 删 Claude 协议 system 字段分支（`baseReqBody.system = claudeSystemField`）
  - 删 Claude 协议强制 stream=false 分支
  - 删 Claude 协议不挂 tool 分支（`!useClaudeProtocol` 改 `!useGeminiProtocol`）
  - `useVisionClaudeProtocol` / `visionActiveUrl/Key/Model` 删 claude 三元
  - `logEntry.apiProtocol` 直接用变量
  - `charApiProtocol` 删 claude 分支（行 764-784 三元）
  - `mainProtocol` protoResolved 删 claude 分支
- `context/OSContext.tsx` `runProactive`:
  - 删 `charApiProtocol === 'claude'` 分支
  - `charApiBaseUrl` 三元删 claude
  - `!api.baseUrl && ...` 删 `claudeBaseUrl` 检查
- **不动** `utils/safeApi.ts` 里 `safeFetchJson` 的 Claude 处理（任务 2 明确保留）
- **不动** `utils/memoryPalace/llmCall.ts` Claude 分支（独立封装）

### 任务 3：删除生图多余协议选项
- `types.ts`: 删 `imageProtocol` 字段、`imageClaudeBaseUrl / imageClaudeApiKey / imageClaudeModel / imageGeminiBaseUrl / imageGeminiApiKey / imageGeminiModel` 字段
- `components/os/ApiQuickFloat.tsx`:
  - 删 `localImageProtocol / localImageClaude* / localImageGemini*` state
  - 删 `switchImageProtocol` 整个函数
  - 删 JSX 里的生图 `ProtocolTabs` 按钮
  - `handleSaveAndClose` 里 `imageUpdates` 只剩 `imageBaseUrl/imageApiKey/imageModel`
  - `handleSavePreset` image 分支只存 OpenAI 字段
  - `loadPreset` image 分支简化（只读 imageBaseUrl/Key/Model）
  - `isPresetActive` image 分支简化
  - `useEffect` deps 删 `apiConfig.imageProtocol / imageClaude* / imageGemini*`
- **不动** `useChatAI.ts` 里生图发送逻辑（本来就只走 OpenAI）
- **不动** `Settings.tsx`（之前已删除 Gemini 那块 UI）

### 任务 4：记忆宫殿副 API 预设长按删除
对比 `ApiQuickFloat` 的 `PresetChip` 行为（550ms 长按触发 onRequestDelete + 短按触发 onLoad），让 `apps/MemoryPalaceApp.tsx` 副 API 预设按钮行为一致。

实现：
- `apps/MemoryPalaceApp.tsx`:
  - `import` 加 `useRef`
  - 从 `useOS` 解构 `removeApiPreset`
  - 加 `PRESET_LONG_PRESS_MS = 550` 常量
  - 加 `lightPresetPendingDelete` state
  - 复制 `PresetChip` 行为到本地 `LightPresetChip` 组件（计时器 + `longPressedRef` 标志位 + `pressing` 缩放反馈 + `useEffect(() => () => clearPress())` 卸载清理）
  - 替换 `lightPresets.map` 里的 `<button>` 为 `<LightPresetChip>`
  - 加删除确认弹窗（fixed inset-0 + 遮罩 + 圆角白卡 + 取消/删除按钮，跟 `ApiQuickFloat` 行 1711-1740 同款结构）
- **不动** `ApiQuickFloat.tsx` 的 `PresetChip` 组件（任务 4 明确不动悬浮窗）

### 任务 5：localStorage 调试日志加开关
- 新增 `isApiLogEnabled()` helper（`useChatAI.ts:40-49` + `OSContext.tsx:22-31`）：
  ```ts
  const isApiLogEnabled = (): boolean => {
      try {
          return typeof localStorage !== 'undefined'
              && localStorage.getItem('sullyos:enableApiLog') === 'true';
      } catch { return false; }
  };
  ```
- `useChatAI.ts` 包住的写入点：
  - `sullyos:lastVisionReqLog`（`saveVisionReqLog` 函数）
  - `sullyos:lastApiReqLog` 4 段 hash 写入（行 1124-1135）
  - `sullyos:lastApiReqLog` 主 API 完整请求体写入 + `console.log`（行 1763-1782）
- `OSContext.tsx` 包住的写入点：
  - `sullyos:lastProactiveReqLog`（行 1854-1866）
  - `sullyos:proactiveLastError`（行 2075-2081）
  - 失败时开关没开也打一行精简 `console.warn`（避免失败原因被默默吞掉）

## 动了哪些文件

- `context/OSContext.tsx` —— 任务 1（+175/-29）+ 任务 2（部分）
- `types.ts` —— 任务 2（-12 字段）+ 任务 3（-7 字段）
- `components/os/ApiQuickFloat.tsx` —— 任务 2（-110 字段/state/handler）+ 任务 3（-96 行生图协议选项）
- `hooks/useChatAI.ts` —— 任务 2（删 Claude 分支）+ 任务 5（开关 helper + 3 处包住）
- `apps/MemoryPalaceApp.tsx` —— 任务 4（+109 行：LightPresetChip + 弹窗 + 长按计时）
- `changelogs/2026-08-12-api-architecture-cleanup.md` —— 本文件

## 踩坑

1. **OSContext 任务 1 不能 mutate `api` 引用**：第一版写成 `api.baseUrl = (api as any).geminiBaseUrl || api.baseUrl` 这种原地修改，编译过、运行也过，但会污染 React state（`api` 直接引用 `currentApiConfig` 或 `charApiConfig` state）。改用 `activeApi` 临时对象承载本轮生效字段。

2. **normalizeApiUrl 不能直接复制 useChatAI 的**：`useChatAI.ts:41-46` 写反了（`!` 写错），复制过来 bug 还在。任务 1 目标是"防止缺 /v1 的问题"，所以**写对版**：
   ```ts
   if (/\/v\d+$/i.test(raw)) return raw;   // 已 /v1 结尾 → 原样
   return `${raw}/v1`;                    // 否则补 /v1
   ```

3. **Gemini 协议请求体序列化**：`useChatAI.ts:1785-1786` 之前 8-4 加 key 池时往 `geminiRequestBody` 上挂了 `__pickedKeyIndex / __pickedKeyShort` 闭包变量，序列化时 Google 收到未知字段报 400。任务 1 写 Gemini fetch 时**先剥掉**这两个内部字段，只发标准字段（跟 useChatAI 行 1941-1945 同款）。

4. **任务 2 范围严格**：
   - `lightLLM` 副 API 的 Claude 字段不动（保留兼容老数据）
   - `imageClaude* / imageGemini*` 不动（任务 3 范围）
   - `PROTOCOL_TABS` 是 4 个区域共用 const，改了之后 lightLLM 也没 Claude tab 按钮——这是协议删除的副作用，不算"动 lightLLM"
   - `useChatAI.ts` 里的 `useGeminiProtocol` 任务 2 也确认保留（任务 1 还在用）

5. **任务 4 长按计时器**：复制 `PresetChip` 逻辑时，`useEffect(() => () => clearPress(), [])` 这个 cleanup 容易被漏——不写的话组件 unmount 后 timer 还在跑，会触发已卸载组件的 setState 警告。

6. **任务 5 失败兜底**：开关没开时 `proactiveLastError` 不写 localStorage，但**仍**打一行精简 `console.warn(errMessage)`，避免用户看不到失败原因。完全沉默会让主动消息静默失败。

## 用户操作（任务 5 开关）

- **默认行为**：完整请求体不写入 localStorage，console.log 也不打
- **打开调试日志**：
  ```js
  // DevTools 控制台
  localStorage.setItem('sullyos:enableApiLog', 'true');
  // 之后所有 API 请求都会写 sullyos:lastApiReqLog / sullyos:lastVisionReqLog / sullyos:lastProactiveReqLog / sullyos:proactiveLastError
  ```
- **关闭**：localStorage.removeItem('sullyos:enableApiLog')（不删已写入的数据）
- **清已写入的数据**：localStorage.removeItem('sullyos:lastApiReqLog') 等 4 个 key 各自删

## 验证方法

- 任务 1：API 浮窗切到 Gemini tab，触发主动消息 → DevTools Network 应该看到 `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=***` 而不是 OpenAI 地址
- 任务 2：API 浮窗打开 → 应该只有 2 个 tab（OpenAI / Gemini），没有 Claude
- 任务 3：API 浮窗生图区 → 没有 tab 切换按钮，只有 URL/Key/Model 3 个输入框
- 任务 4：记忆宫殿设置页副 API 预设 → 长按 550ms 弹"删除预设"确认弹窗
- 任务 5：默认不写 localStorage → DevTools Application → Local Storage 看不到 sullyos:lastApiReqLog 等 4 个 key
