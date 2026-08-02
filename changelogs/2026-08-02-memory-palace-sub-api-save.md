# 记忆宫殿 副 API 设置 Gemini/Claude 协议下保存跳回旧值 + 预设按钮 OpenAI 没反应

**日期**：2026-08-02 18:10
**涉及 commit**：`c523efc`

## 改了什么

暮色 18:10 反馈：记忆宫殿副 API 设置里选 Gemini 协议填 URL，点保存后 input 跳回京东云（之前配的）。预设按钮 OpenAI 协议点了没反应。**只记忆宫殿里的副 API 设置坏了**（悬浮窗里的副 API 是好的）。

## 根因（3 处串起来）

记忆宫殿副 API 配 3 套独立字段（baseUrl / claudeBaseUrl / geminiBaseUrl），但保存 + 同步逻辑没处理对：

### 1. `handleSaveLightApi` baseUrl 字段保留旧值

`apps/MemoryPalaceApp.tsx:1059` 之前：
```ts
baseUrl: lightProtocol === 'openai' ? lightUrl.trim() : (memoryPalaceConfig.lightLLM.baseUrl || ''),
```

`lightProtocol !== 'openai'`（比如选了 gemini 协议）时，baseUrl 字段**保留旧值**（memoryPalaceConfig.lightLLM.baseUrl）—— 永远不被更新，**永远是上一次配的 OpenAI 协议下的 baseUrl**（京东云）。

暮色在 Gemini 协议下保存：
- `geminiBaseUrl` 字段 = 新值（Gemini URL）✅
- `baseUrl` 字段 = 旧值（京东云）❌

### 2. useEffect 同步永远读 baseUrl 字段

`apps/MemoryPalaceApp.tsx:655-657` 之前：
```ts
setLightUrl(memoryPalaceConfig.lightLLM.baseUrl || '');  // 永远读 baseUrl
setLightKey(memoryPalaceConfig.lightLLM.apiKey || '');
setLightModel(memoryPalaceConfig.lightLLM.model || '');
```

`useEffect` 在 `memoryPalaceConfig` 变化时跑，**永远读 `baseUrl` 字段**（不管当前 lightProtocol 是什么）→ input 显示 baseUrl（旧值，京东云）= "跳回京东云"。

### 3. 预设按钮 onClick OpenAI 分支没填预设值

`apps/MemoryPalaceApp.tsx:2469-2482` 之前：
```ts
onClick={() => {
    switchLightProtocol(proto);
    if (proto === 'claude') { ... }       // claude 协议填预设
    else if (proto === 'gemini') { ... }  // gemini 协议填预设
    // ⚠️ proto === 'openai' 什么都没做
}}
```

`switchLightProtocol('openai')` 内部 `setLightUrl(memoryPalaceConfig.lightLLM.baseUrl || '')` —— 从当前 memoryPalaceConfig 读，**不是从预设读**。所以 OpenAI 预设点了没反应。

## 修法

### 1. `handleSaveLightApi` 改

baseUrl/apiKey/model 字段**始终用 lightUrl/Key/Model 存**（不分协议）—— baseUrl 字段不再保留旧值。同时当前协议字段（geminiBaseUrl / claudeBaseUrl）也更新，其他协议字段保留 local*Url。

```ts
const api: any = {
    baseUrl: lightUrl.trim(),               // 暮色 8-2 18:10 修：始终用 lightUrl
    apiKey: lightKey.trim(),
    model: lightModel.trim(),
    protocol: lightProtocol,
    claudeBaseUrl: lightProtocol === 'claude' ? lightUrl.trim() : lightClaudeUrl,
    ...
    geminiBaseUrl: lightProtocol === 'gemini' ? lightUrl.trim() : lightGeminiUrl,
    ...
};
```

### 2. useEffect 改

按当前 `syncedProtocol` 读对应字段：

```ts
const syncedProtocol = (memoryPalaceConfig.lightLLM.protocol) || 'openai';
if (syncedProtocol === 'openai') {
    setLightUrl(_llm.baseUrl || '');
    ...
} else if (syncedProtocol === 'claude') {
    setLightUrl(_llm.claudeBaseUrl || '');
    ...
} else {
    setLightUrl(_llm.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    ...
}
```

### 3. 预设按钮 onClick OpenAI 分支补全

加 `else` 分支：OpenAI 协议也 setLightUrl/Key/Model 从预设读：

```ts
} else {
    // proto === 'openai'：直接填到 lightUrl/Key/Model
    setLightUrl(p.config.baseUrl || '');
    setLightKey(p.config.apiKey || '');
    setLightModel(p.config.model || '');
}
```

## 动了哪些文件

- `apps/MemoryPalaceApp.tsx` —— 3 处改动：`handleSaveLightApi` + 副 API useEffect 同步 + 预设按钮 onClick

## 踩坑 / 需要知道的

- **基址地址 / 接口密钥 / 模型**这些字段**始终用 lightUrl/Key/Model 存**（不分协议），跟 `geminiBaseUrl/claudeBaseUrl/baseUrl` 三个独立字段并存。这样 useEffect 同步时按协议读对应字段总能读到值。
- **悬浮窗里的副 API**（`components/os/ApiQuickFloat.tsx:handleSaveLightConfig`）是**好的**——暮色说只有记忆宫殿里的副 API 设置坏了。**没改 ApiQuickFloat**。
- 修完后预期：暮色在 Gemini 协议下填 URL → 点保存 → baseUrl + geminiBaseUrl 字段都更新（baseUrl 用 lightUrl，geminiBaseUrl 也用 lightUrl）→ useEffect 按协议读 geminiBaseUrl → input 显示新值（**不跳回**）。预设按钮 3 个协议都能切（OpenAI 协议也补上了 setLightUrl/Key/Model）。

## 备注

- 暮色 8-2 18:10 反馈"你又开始中英混搭了"——之前 16:32 那条标五颗星的"英文专业词全翻译"规则要严格执行。**之后所有回复严格只用中文专业词**。
- 暮色还说"我懂程序功能，不懂英文术语"——8-2 17:00 那条。**不重讲程序功能**。
