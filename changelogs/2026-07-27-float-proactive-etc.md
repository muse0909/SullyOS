# 悬浮球/主动消息 5 处补全 + loadedProto bug 修

**日期**：2026-07-27
**涉及 commit**：`bdbc685`

## 改了什么
暮色 2026-07-27 第二轮反馈 5 件事 + 一个编译错：

### 1. 修编译错：loadedProto is not defined
- 根因：副 API 预设加载时 `loadedProto` 在 `onClick` 内部 `const` 声明，title 属性（外层）访问不到
- 修法：把 `loadedProto` 提到 `lightPresets.map` 顶部用 `proto` 复用（两个名字合一）

### 2. 悬浮球点预设不切 protocol
- 之前 `loadPreset(preset, 'main')` 只填 baseUrl/apiKey/model，不动 protocol
- 改 `loadPreset`：main / vision / lightLLM 三种预设加载都先按 `preset.config.protocol` 调对应 `switch*Protocol()` handler，再填 3 套独立字段
- 加 toast 提示协议名（"已加载 API 预设: G3.6 (Gemini)"）

### 3. 悬浮球加「保存为预设」按钮（4 个 API）
- 加通用 `handleSavePreset(target, defaultName)` 函数
- target 支持 'main' / 'image' / 'vision' / 'lightLLM'
- UI 位置：
  - 浮窗底部 3 个「保存 XX 为预设」按钮（主 API / 识图 / 生图，水平排列）
  - 副 API 卡片内跟「保存副 API 配置」并排一个「保存为预设」按钮
- 预设 schema 跟 Settings.tsx 一致：存 protocol + 3 套独立字段

### 4. 悬浮球识图 + 副 API 加 3 tab 协议
- 识图：localVisionProtocol + 3 套 state + switchVisionProtocol + UI（绿/橙/蓝小圆点）
- 副 API：localLightProtocol + 3 套 state + switchLightProtocol + UI
- 协议判断逻辑跟主 API 一样
- fetchModelsFor 自动识别 Gemini 端点走 `?key=` 参数，model name 剥 `models/` 前缀
- isPresetActive 跨 tab 比较（解决"切回来预设上没有高亮"的问题）

### 5. 角色设置点保存就关闭侧拉栏
- `handleSavePerCharApi` 保存成功后：
  - `setShowChatSettingsDrawer(false)` 关侧拉栏
  - `addToast('角色 API 配置已保存', 'success')` 提示

### 6. 主动消息 API 优先级 + 角色 API 开关
- 之前 `runProactive` 写死「useSecondary ? 副 API : currentApiConfig」，**角色独立 API 永远不会被主动消息用上**
- 改 3 层优先级：
  1. 副 API 开关打开 + 配了 baseUrl → 走副 API
  2. 角色独立 API 开关打开 + 角色配了 baseUrl → 走 `char.apiConfig`
  3. 都没开 → 走全局主 API
- ProactiveSettingsModal 加「使用角色独立 API」开关（副 API 开关下面）
- 角色没配独立 API 时显示 ⚠️ 提示
- log 加 `API source: char (protocol=gemini)` 标记实际走哪条

## 动了哪些文件
- `types.ts` — `proactiveConfig` 加 `useCharApi` 字段
- `context/OSContext.tsx` — `runProactive` 3 层优先级 + 日志增强
- `components/chat/ProactiveSettingsModal.tsx` — useCharApi state + UI 开关
- `components/os/ApiQuickFloat.tsx` — 4 个 API 加 3 tab 协议 + 预设加载切 protocol + 4 个「保存为预设」按钮 + isPresetActive 跨 tab
- `components/chat/ChatSettingsDrawer.tsx` — (无新改，prop 已传)
- `apps/Chat.tsx` — handleSavePerCharApi 保存后关侧拉栏
- `apps/MemoryPalaceApp.tsx` — loadedProto 修

## 踩坑 / 需要知道的
- **`isPresetActive` 跨 tab 比较**：
  - 之前只比 `baseUrl + apiKey + model`，同 baseUrl 中转站有 3 个预设会一起亮
  - 现在按 `protocol + 该协议对应那组的 URL/Key/Model` 比较
  - 切 tab 时 `localUrl/Key/Model` 重新填对应缓存 → isPresetActive 自动判断当前 tab 的字段是否匹配预设
  - **切回 tab 自动恢复高亮**（不需要额外存 selectedPresetId）
- **`loadedProto is not defined`** 根因：
  - 之前我在 MemoryPalaceApp.tsx 加 lightPresets 加载逻辑时，写法是 `const loadedProto = ...` 在 onClick 内部
  - 但同一行下面的 title 属性 `${loadedProto}` 在 map 闭包外层访问 → 编译能过、运行时崩
  - 修法：把 loadedProto 提到 map 顶部，用 `proto` 变量复用
- **主动消息的 protocol 字段**：`char.apiConfig` 已经带 `protocol` 字段（之前 3 tab 改造时加的），所以 `useCharApi` 走 `char.apiConfig` 时不需要额外选 protocol，直接读
- **`useChatAI.ts` 之前 3 tab 协议判断**：`useGeminiProtocol = apiProtocol === 'gemini'`（之前是看 URL，现在看字段）—— 主动消息走 `api = char.apiConfig` 时同样走 useChatAI.ts 协议判断逻辑

## 备注
- 4 个 API 都有「保存为预设」按钮了
- 4 个 API 都有 3 tab 协议（生图暮色说不用 3 tab，保持 OpenAI 兼容，所以生图块不加 3 tab，但加「保存为预设」按钮）
- 主动消息的 API 优先级：副 API > 角色独立 API > 主 API。**全空走主 API**
- 角色独立 API 跟主动消息的关系：开了「使用角色独立 API」开关后，主动消息会用这个角色在「这个角色的 API」里配的 URL/Key/Model/Protocol
