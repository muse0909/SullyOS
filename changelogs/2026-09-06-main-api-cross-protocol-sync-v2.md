# 2026-09-06 修主 API/识图 跨协议不同步（v2 写侧清干净 + 读侧按协议同步）

## 背景

v1 (`52d5be8a`) 修了一半 — 只在 Settings useEffect 同步 `localProtocol`，但没修读侧按协议切显示源，也没修写侧字段清干净。用户实测发现仍不对：

- 切到 Gemini 预设保存后，Settings tab 是 Gemini 高亮了（v1 修对了）
- 但 URL 输入框仍显示 OpenAI 那组的 URL、KEY 是 OpenAI 那组的（读侧没修）
- MODEL 又显示 Gemini 预设的 model（巧合，因预设数据不规范）

## 根因（重新分析 console 日志 + 代码）

**主 API**：
1. 写侧：`ApiQuickFloat.handleSaveAndClose` 的 `mainUpdates`（旧 575-583）`baseUrl` 字段在 `localProtocol === 'gemini'` 时保留 `apiConfig.baseUrl` 不动 → `os_api_config` 里 `protocol='gemini'` 但 `baseUrl` 还是 OpenAI 协议的 URL（数据自相矛盾）
2. 读侧：`Settings` useEffect 同步 `setLocalUrl(apiConfig.baseUrl)` 永远拿 OpenAI 那组 → 渲染 `value={localUrl}` 显示 OpenAI 协议的 URL（跟当前协议不一致）

**识图**：
1. 写侧：`ApiQuickFloat.handleSaveAndClose` 的 `visionUpdates`（旧 587-593）同款 bug
2. 读侧：`ApiQuickFloat` useEffect 同步 vision 时 `setLocalVisionUrl(apiConfig.visionBaseUrl)` 永远拿 OpenAI 那组（**8-04 暮色修过 main 同款但 vision 漏了**）

## 修复（写侧清干净 + 读侧按协议同步）

### 写侧（清干净）

- `components/os/ApiQuickFloat.tsx` `handleSaveAndClose.mainUpdates`：
  - `baseUrl/apiKey/model`：`localProtocol === 'openai' ? localUrl/localKey/localModel : ''`（gemini 时清空）
  - `geminiBaseUrl/geminiApiKey/geminiModel`：`localProtocol === 'gemini' ? localUrl/localKey/localModel : ''`（openai 时清空）
- `components/os/ApiQuickFloat.tsx` `handleSaveAndClose.visionUpdates`：同款
- `apps/Settings.tsx` `handleSaveApi` 的 `mainFieldUpdates`：同款
- `apps/Settings.tsx` `handleSaveVisionApi` 的 `visionFieldUpdates`：同款

**取舍**：切协议时清空"非当前协议"那组字段。**用户切回旧协议时字段是空的**（需要重新加载预设或重新填），但 `os_api_config` 数据自洽（protocol 跟字段一致），不会让 useChatAI 拿到矛盾值。**用 useChatAI 已有 fallback**（行 843-857）：`geminiBaseUrl || baseUrl` — 即便某次保存时 protocol 切了字段没清空，调用也 OK，但**写侧清干净更稳**。

### 读侧（按协议同步）

- `apps/Settings.tsx` useEffect 同步 main：`apiConfig.protocol === 'gemini' ? setLocalUrl(apiConfig.geminiBaseUrl) : setLocalUrl(apiConfig.baseUrl)`（localKey/localModel 同款）
- `apps/Settings.tsx` useEffect 同步 vision：`apiConfig.visionProtocol === 'gemini' ? setLocalVisionUrl(apiConfig.visionGeminiBaseUrl) : setLocalVisionUrl(apiConfig.visionBaseUrl)`
- `components/os/ApiQuickFloat.tsx` useEffect 同步 vision 同款（`syncedVisionProtocol` 跟 8-04 main 行的 `syncedProtocol` 同模式）

**渲染不需改**：`value={localUrl}` 保持原样，因为 useEffect 现在按协议选字段赋给 `localUrl`，所以 `localUrl` 永远 = 当前协议那组的字段值。

## 调试日志

- `[Settings][main][sync-effect]` / `[Settings][vision][sync-effect]`：每次 apiConfig 变都打，含 mainProto / visionProto 和各字段
- `[ApiQuickFloat][main][save]` / `[ApiQuickFloat][vision][save]`：保存时打，含 protocol 和各字段
- `[ApiQuickFloat][vision][sync-effect]`：ApiQuickFloat useEffect 跑时打，**这次也加了 visionGemini* 字段方便对比**
- API key 只 log `exists` 布尔

## 验收步骤

1. 打开悬浮窗，选 OpenAI 预设保存 → console: `[ApiQuickFloat][main][save]` protocol=openai，baseUrl/apiKey/model 有值，gemini* 全空
2. 进系统设置 → console: `[Settings][main][sync-effect]` protocol=openai，URL/Model 框显示 OpenAI 预设的字段 ✓
3. 回悬浮窗切 Gemini 直连预设保存 → console: `[ApiQuickFloat][main][save]` protocol=gemini，baseUrl/apiKey/model 全空（`''`），gemini* 有值
4. 进系统设置 → console: `[Settings][main][sync-effect]` protocol=gemini，URL/Model 框显示 Gemini 预设的字段 ✓
5. 反向验：系统设置切 Gemini 预设 → 回悬浮窗应显示 Gemini 那组
6. **新加**：用户切回 OpenAI 协议时，URL/Key/Model 输入框是空的（写侧清空）— 预期行为，需要重新加载 OpenAI 预设

## 涉及文件

- `apps/Settings.tsx`（useEffect 按协议同步 main + vision + 写侧 mainFieldUpdates/visionFieldUpdates 清干净）
- `components/os/ApiQuickFloat.tsx`（useEffect 同步 vision 改用 syncedVisionProtocol + 写侧 mainUpdates/visionUpdates 清干净）

## 涉及 storage key

`os_api_config`（OSContext 统一存储 key，本轮没变）
