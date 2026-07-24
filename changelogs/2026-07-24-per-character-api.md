# 每个角色独立 API 配置

**日期**：2026-07-24
**涉及 commit**：（未提交）

## 改了什么

1. **每个角色可以独立配置 API**
   - `CharacterProfile.apiConfig` 新增（types.ts）
   - 字段：`baseUrl` / `apiKey` / `model` / `protocol`（OpenAI/Claude）/ `minimaxRegion`（国内/海外）
   - 没设的角色回退到全局 apiConfig
   - 角色级 API 触发 AI 时**优先**用，visionBaseUrl/R2/imgbb 等子资源仍走全局

2. **触发 AI 逻辑**（useChatAI.ts triggerAI）
   - 优先级：`overrideApiConfig` > `char.apiConfig`（如果设了 baseUrl）> `apiConfig`（全局）
   - protocol / minimaxRegion 也跟着角色走

3. **OSContext 加便捷函数**（context/OSContext.tsx）
   - `updateCharApiConfig(charId, apiConfig)` — 单独更新某个角色的 API，null/undefined 表示清空回退全局

4. **Settings UI 加"角色独立 API"section**（apps/Settings.tsx）
   - 在"API 配置"和"识图配置"之间
   - 每个角色一张卡片：默认折叠；设了 baseUrl 后卡片边框变绿、显示"已独立 API"
   - 卡片内容：Base URL / API Key（带显示切换）/ Model / 协议（OpenAI/Claude）/ MiniMax 区域
   - 协议/区域按钮跟"独立识图配置"的视觉风格一致
   - "清空（用全局）"按钮一键回退

5. **用法**
   - 江澈填 `https://api.anthropic.com/v1` + Claude protocol
   - 麦麦填 `https://api.minimaxi.com/v1` + 国内区域
   - 互不干扰——跟江澈说话走 Claude，跟麦麦说话走 MiniMax

## 动了哪些文件
- `types.ts` — `CharacterProfile` 加 `apiConfig?: { baseUrl, apiKey, model, protocol, minimaxRegion }`
- `hooks/useChatAI.ts` — `triggerAI` 优先用 `char.apiConfig`，merged 进 protocol/minimaxRegion
- `context/OSContext.tsx` — 加 `updateCharApiConfig` 便捷函数 + interface + context value
- `apps/Settings.tsx` — 新增 `PerCharApiCard` 组件 + "角色独立 API" section

## 踩坑 / 需要知道的（重要）

- **visionBaseUrl/R2/imgbb/image* 不参与角色级覆盖**——这些是工具/全局资源，不该按角色分。注释里写明了。
- **角色级 API 只覆盖主对话的 baseUrl/apiKey/model/protocol/minimaxRegion**。情绪副 API（emotionConfig.api）、主动消息副 API（proactiveConfig.secondaryApi）本来就是按角色分的不动。
- **协议（protocol）必须跟着角色走**——江澈填 Claude 但没设 protocol 会回退到全局 openai 协议，导致 400。卡片里默认选 OpenAI，记得手切到 Claude。
- **回退链路清晰**：`overrideApiConfig` > 角色 API（如果设了 baseUrl）> 全局。没设 baseUrl 的角色走全局，不报错。
- **useChatAI 里 effectiveApi 用 `(char as any).apiConfig`**——types.ts 里 `apiConfig` 是可选字段，但 useChatAI 调 `char.apiConfig.baseUrl` 时 TS 不会报错（可选链 + default）。不过代码里还是 cast 一下保险。

## 备注
- 验证：`npm run build` 通过（3.81s，无 error）
- 没动江澈/麦麦的现有 `apiConfig`——保持空状态，暮色在 SullyOS 里手动填
- 还没写"测试连接"按钮——复用全局那个太重，先观察要不要加
- 后续可以做：每个角色也能单独设"独立识图配置"（同样的拆分逻辑），但今晚先不做
