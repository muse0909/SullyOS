# 角色 API 重开抽屉时输入框不同步

**日期**：2026-07-31
**涉及 commit**：`f6a1b1b`

## 改了什么
- `apps/Chat.tsx` 角色 API useEffect 同步逻辑重写：同步完 3 套独立缓存（Claude*/Gemini*/BaseUrl*）+ protocol 之后，**按当前 protocol 把对应那组填进 `perCharApiBaseUrl/Key/Model`**（之前永远从 `char.apiConfig.baseUrl/apiKey/model` 读，tab 是 Gemini/Claude 时显示空）
- useEffect deps 补全 `protocol` / `claudeBaseUrl` / `claudeApiKey` / `claudeModel` / `geminiBaseUrl` / `geminiApiKey` / `geminiModel` 7 个字段（之前只有 baseUrl/apiKey/model，保存时这三个未必变 → useEffect 不重跑 → 同字符切回时拿到旧值）

## 踩坑 / 需要知道的（重要）
- **数据其实是保存了的**，没保存是错觉：
  1. 用户选 Gemini 预设 → handleLoadPresetIntoPerChar 把 Gemini 字段填进 state（包括 `perCharApiBaseUrl/Key/Model`）
  2. 点"保存并关闭" → handleSavePerCharApi 写 `char.apiConfig.geminiBaseUrl/Key/Model` 进 DB
  3. 关掉抽屉再开 → useEffect 读 `char.apiConfig.baseUrl/apiKey/model`（OpenAI 字段）填进 `perCharApiBaseUrl/Key/Model`
  4. tab 已经在 Gemini 但输入框显示空 → 暮色以为没保存
- 之前 795fae0 加 3 tab 协议时 useEffect 只补了 3 套独立缓存的 setter，**漏了"按 protocol 同步当前 tab 输入框"这一步**——跟 `switchPerCharApiProtocol` 切 tab 的逻辑不一致（那个有，这边没有）
- 治本建议：把"3 套独立缓存 → 当前 tab 输入框"的同步逻辑抽成一个 helper（`syncActiveTabFromCache(protocol, sets)`），让 `switchPerCharApiProtocol` 和 useEffect 都调它，避免下次加东西又串
- **附带修了一个隐藏 bug**：useEffect deps 之前只有 `baseUrl/apiKey/model` 3 字段。如果用户存的是 Gemini，OpenAI 那 3 个字段可能没变 → useEffect 不重跑 → 字符本身没切换但 apiConfig 内部更新了，输入框拿到旧值。现在 9 字段全在 deps 里，任意字段变化都会触发

## 备注
- 暮色体感"保存不了"实际上是"重开看不到"，不是写入失败
- 修完后：选 G3.6 (Gemini) 预设 → 保存 → 关掉 → 再开，应该看到 tab 在 Gemini + URL/KEY/MODEL 都填好了
- 同理 Claude tab 也修了——之前选 Claude 预设保存再重开，tab 在 Claude 但输入框是空的
- 没动 useChatAI.ts 的 triggerAI 角色 API 读取逻辑（line 650-652 还是用 `charApi.baseUrl` 判断），这次只修 UI 同步
