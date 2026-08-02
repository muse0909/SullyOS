# 悬浮窗 useOS 漏解构 addApiPreset + 副 API 保存跳回 OpenAI 协议

**日期**：2026-08-02 19:00
**涉及 commit**：`e5fb24e` `1caef81`

## 改了什么

### 1. 悬浮窗 ReferenceError 修复

暮色 19:00 控制台报错 `addApiPreset is not defined`，点保存预设按钮抛错。

**根因**：`components/os/ApiQuickFloat.tsx:181` 的 useOS 解构漏了 `addApiPreset`。`handleSavePreset` 调 `addApiPreset(name, ...)` 引用未声明的标识符。

**为什么之前没报**：5e33a07 commit（暮色 7-15 副 API 接入悬浮窗）引入 `handleSaveLightPreset` 时调 `addApiPreset(name, ...)` 但 useOS 解构没加 `addApiPreset`——free variable 错误。**TS 不严格检查**（项目 `strict: false`）+ **Vite build 保留 free variable 原名**——runtime ReferenceError。

Vercel 部署有 cache，暮色之前没测到这个 commit 的版本。8-2 19:00 测到，报错。

**修**：`useOS` 解构加 `addApiPreset`。

### 2. 副 API 设置保存跳回 OpenAI 协议修复

暮色 19:00 反馈：在副 API 设置选 Gemini 直连预设（URL/Key/Model 都填好了），点保存又跳回 OpenAI 协议。

**根因**：`syncEmotionApiToAllCharacters` 内部（`context/OSContext.tsx:1958`）：

```ts
lightLLM: { baseUrl: api.baseUrl, apiKey: api.apiKey, model: api.model }
// ⚠️ 只用 3 字段重建，丢 protocol / claude* / gemini* 字段
```

调用链：
1. `handleSaveLightApi` → `updateMemoryPalaceConfig({ lightLLM: 完整 api })`（含 protocol='gemini'）
2. `syncEmotionApiToAllCharacters(...)` → 内部 `setMemoryPalaceConfig` 用 3 字段重置 lightLLM
3. 之前存的 'gemini' protocol 字段变成 undefined
4. memory palace app 的 useEffect 同步跑（`apps/MemoryPalaceApp.tsx:650`）
5. `syncedProtocol = memoryPalaceConfig.lightLLM.protocol || 'openai'` → 'openai' fallback
6. `setLightProtocol('openai')` → 协议跳回 OpenAI

**修**：先 spread 旧 lightLLM（保留所有字段）再覆盖 3 个字段。

### 3. 附带问题（不是代码 bug）

暮色测试 Gemini API 报 404：`This model models/gemini-2.5-flash is no longer available to new users`。**这是 Gemini 官方对 gemini-2.5-flash 这个 model 限制新用户使用**——不是代码 bug。暮色把 model 换成 `gemini-2.0-flash` 或 `gemini-2.5-pro` 应该能解决。

## 动了哪些文件

- `components/os/ApiQuickFloat.tsx` —— useOS 解构加 addApiPreset
- `context/OSContext.tsx` —— `syncEmotionApiToAllCharacters` 内部 lightLLM 构造先 spread 旧字段

## 踩坑 / 需要知道的

- **跟 8-1 / 8-2 那些 ReferenceError 同一个家族**——加新引用时没同步加 import / destructure。**写代码当下要养成肌肉记忆**：加任何新引用前先看顶部 import / destructure 列表。
- **TS strict: false 不检查 free variable**——build 通过，runtime 才崩。**这意味着**以后这种 bug 不能靠 TS 拦截，必须靠人查。
- **`syncEmotionApiToAllCharacters` 内部 lightLLM 构造**之前一直丢字段（8-1 8-2 那些轮次都没发现），是个**潜伏 bug**。今天暴露是因为暮色选 Gemini 协议保存测试才看到。
- **`useEffect` 依赖项**=`memoryPalaceConfig`，**每次** lightLLM 变都跑协议同步——如果 lightLLM.protocol 丢了，会 fallback 到 'openai'。这是"跳回"症状的直接触发点。

## 备注

- 暮色说"我又被搞复杂了"——之前 18:10 / 18:29 修过 lightLLM 字段丢失，但没修这个潜伏 bug。**今天**才暴露。**这个潜伏 bug 之前没暴露**是因为暮色之前都是 OpenAI 协议下配，丢 protocol 不影响；今天第一次在 Gemini 协议下配，丢 protocol 就跳回 OpenAI 了。
- 暮色 8-2 19:00 控制台报错（第一个图）是 ReferenceError——跟 8-1 / 8-2 那些 ReferenceError 是同一类。**根因都是"加新引用时没同步"**。**写代码当下要养成肌肉记忆**。
- 测试 Gemini API 报 404（第二个图）不是代码 bug——是 Gemini 官方对 gemini-2.5-flash 限制新用户。**暮色换 model 就能解决**（gemini-2.0-flash / gemini-2.5-pro）。
