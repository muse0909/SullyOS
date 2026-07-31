# 角色独立 API 在 3 tab 协议下被全局顶掉

**日期**：2026-07-31
**涉及 commit**：`e781ede`

## 改了什么
- `hooks/useChatAI.ts` `triggerAI` 角色 API 优先级判断扩展到 3 套 baseUrl：
  - `charHasAnyApi`：判断 `charApi.baseUrl || claudeBaseUrl || geminiBaseUrl` 任意一个非空
  - 构造 `effectiveApi` 时按 `charApi.protocol` 选对应那组的 URL/Key/Model
  - `charApiOverridesMain` 用同一个 `charHasAnyApi` 判断（之前是 `charApi && charApi.baseUrl`，漏了 Claude/Gemini）

## 踩坑 / 需要知道的（重要）
- **症状**：UI 上保存了 Gemini 角色 API（URL/KEY/MODEL 都填好），但实际 API 调用走的是全局主 API（柚子 youzi.today gemini-2.5-pro）。保存无效的错觉
- **根因**：之前 795fae0 加 3 tab 协议时，`useChatAI.ts:650-652` 的判断还是只看 `charApi.baseUrl`（OpenAI 字段）：
  ```ts
  let effectiveApi = overrideApiConfig
      || (charApi && charApi.baseUrl
          ? { ...apiConfig, baseUrl: charApi.baseUrl, ... }
          : null)
      || apiConfig;
  ```
  - 用户设了 Gemini 角色 API → `charApi.geminiBaseUrl` 有值，但 `charApi.baseUrl` 是空（之前没设过 OpenAI）
  - 整个 `charApi && charApi.baseUrl` 短路成 `null`
  - `effectiveApi = apiConfig`（全局）
  - 全局 apiConfig 是柚子的 Gemini 配置 → 实际调的是 `https://youzi.today/v1/chat/completions` + `gemini-2.5-pro`
- **同类风险**：3 tab 协议下的 Claude 角色 API 也是同一个雷，之前没用户反馈只是因为没人在用
- 治本建议：抽一个 `resolveCharApi(char, globalApi) → effectiveApi` helper，让 `triggerAI` 和未来其他用 API 的地方（主动消息、生图、识图）都调它，避免下次加功能又各写各的判断

## 备注
- 跟 7/31 之前 3 个 changelog（null msg guard / destructure / reopen sync）不是同一个 bug，是另一个独立问题
- 之前那个 reopen sync 修的是"重开抽屉视觉上没值"，这个修的是"就算视觉上没值，实际 API 调用时也根本没用角色 API"——两个问题独立
- 修完后：设了 Gemini 角色 API 的角色，API Request Log 里 URL 会变成 `https://generativelanguage.googleapis.com/...`、Model 会变成 `gemini-3.6-flash`
- 没动 `useChatAI.ts:650-681` 后面那段（protoResolved block），只在 if/else 的判断条件上改了
