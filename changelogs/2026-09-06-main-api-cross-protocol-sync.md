# 2026-09-06 修主 API 悬浮窗 ↔ 系统设置跨协议不同步

## 现象

在悬浮窗（ApiQuickFloat）里切主 API 预设时：
- 同协议切换（OpenAI → OpenAI）→ 系统设置页能跟着变 ✅
- 跨协议切换（OpenAI → Gemini 直连）→ 系统设置页仍显示切换前的 OpenAI 预设 ❌

## 根因

`apps/Settings.tsx` 行 523-572 的 useEffect（deps `[apiConfig]`，负责把 OSContext 的 apiConfig 同步到本地表单 state）**漏了同步 `localProtocol`**：

- 同步了：`setLocalUrl`、`setLocalKey`、`setLocalModel`、`setLocalGeminiUrl/Key/Model`
- 同步了识图协议：`setLocalVisionProtocol`（行 556）
- **漏了主协议：`setLocalProtocol` 没在 useEffect 里**

后果链：
1. ApiQuickFloat.loadPreset 选 Gemini 直连预设 → `localProtocol = 'gemini'`
2. ApiQuickFloat.handleSaveAndClose → `updateApiConfig({ protocol: 'gemini', geminiBaseUrl: ..., ... })`（写侧 OK，mainUpdates 第 1 行就是 `protocol: localProtocol`）
3. OSContext.apiConfig 更新
4. Settings 收到新 apiConfig → useEffect 跑 → 同步了 `localGeminiUrl/Key/Model` 等字段 → **但 `localProtocol` 还停在 `'openai'`**
5. UI 仍展示 OpenAI tab，但下面输入框是 Gemini 的字段值 → 用户看到"系统设置没跟着切协议"

vision 没这个 bug 是因为之前修过 `setLocalVisionProtocol`（行 556），main 这次没修就被漏了。

## 修复

`apps/Settings.tsx` 行 523 起的 useEffect 加一行：
```ts
setLocalProtocol(apiConfig.protocol === 'gemini' ? 'gemini' : 'openai');
```

## 调试日志

- `apps/Settings.tsx` 行 533：useEffect 内打 `[Settings][main][sync-effect]`，每次 apiConfig 变化都打（看 Settings 实际读到的 protocol/baseUrl/apiKey/model/gemini* 是什么）
- `components/os/ApiQuickFloat.tsx` 行 609：handleSaveAndClose 内打 `[ApiQuickFloat][main][save]`，每次保存都打（看悬浮窗实际写入的 protocol/baseUrl/apiKey/model/gemini* 是什么）
- API key 只 log `exists` 布尔，不打印完整密钥

## 验收步骤

1. 打开悬浮窗，选一个 OpenAI 预设保存 → console 应看到 `[ApiQuickFloat][main][save]` protocol=openai
2. 进系统设置 → console 应看到 `[Settings][main][sync-effect]` protocol=openai，UI 显示 OpenAI tab
3. 回悬浮窗，切到 Gemini 直连预设保存 → console 应看到 `[ApiQuickFloat][main][save]` protocol=gemini
4. 进系统设置 → console 应看到 `[Settings][main][sync-effect]` protocol=gemini，**UI 现在正确切到 Gemini tab 并显示 gemini 那组字段**
5. 反向同样验：系统设置切 Gemini 预设 → 悬浮窗重新进入 → 应显示 Gemini 那组

## 涉及文件

- `apps/Settings.tsx`：useEffect 同步 main 协议 + 加调试日志
- `components/os/ApiQuickFloat.tsx`：加 main 保存调试日志（写入逻辑原本就 OK）

## 涉及 storage key

`os_api_config`（OSContext 统一存储 key，本轮没变）
