# 每个角色独立 API 配置

**日期**：2026-07-24
**涉及 commit**：（未提交）

## 改了什么

1. **每个角色可以单独配 baseUrl/apiKey/model**
   - `CharacterProfile.apiConfig?` 新增（types.ts）
   - 只覆盖 baseUrl/apiKey/model，**协议（OpenAI/Claude）、minimaxRegion、visionBaseUrl/R2/image* 都是全局的**
   - 没设的角色回退到全局 apiConfig
   - 触发 AI 时**优先**用角色级 baseUrl/apiKey/model，其他字段从全局取

2. **触发 AI 逻辑**（useChatAI.ts triggerAI）
   - 优先级：`overrideApiConfig` > `char.apiConfig`（如果设了 baseUrl）> `apiConfig`（全局）
   - 用 `{...apiConfig, baseUrl, apiKey, model}` 合并，保留全局的 protocol/minimaxRegion

3. **OSContext 加便捷函数**（context/OSContext.tsx）
   - `updateCharApiConfig(charId, apiConfig)` — 单独更新某个角色的 API，null/undefined 表示清空回退全局

4. **UI 放在"聊天设置"抽屉里**（components/chat/ChatSettingsDrawer.tsx）
   - 在"HTML 自定义提示词"section 之后、"管理上下文"section 之前
   - 标题："🔌 这个角色的 API"
   - 三个输入框：Base URL / API Key（带显示切换）/ Model
   - "保存" / "清空（用全局）"两个按钮
   - 不在这里改协议——协议还是去全局"设置"里改

5. **Chat.tsx 加 state + handler**（apps/Chat.tsx）
   - 打开抽屉时同步当前角色的 apiConfig 到本地 state
   - 监听 char.id 变化时重新同步（切角色会重置）
   - 6 个新 props 传给 ChatSettingsDrawer

## 动了哪些文件
- `types.ts` — `CharacterProfile` 加 `apiConfig?: { baseUrl, apiKey, model }`
- `hooks/useChatAI.ts` — `triggerAI` 优先用 `char.apiConfig`，merged 时保留全局其他字段
- `context/OSContext.tsx` — 加 `updateCharApiConfig` 便捷函数 + interface + context value
- `components/chat/ChatSettingsDrawer.tsx` — interface 加 6 个新 props + 解构 + 新增"这个角色的 API"section
- `apps/Chat.tsx` — useOS 解构加 `updateCharApiConfig` + 加 4 个 useState + 1 个 useEffect + 2 个 handler + 6 个 props 传给 ChatSettingsDrawer
- `apps/Settings.tsx` —（撤销：之前误放在"设置"里的 section 已删）

## 踩坑 / 需要知道的（重要）

- **第一版我误解了需求**：放在"设置"里 + 加 protocol/minimaxRegion 字段。暮色纠正后我撤回：协议/区域还是全局的（江澈也走 OpenAI 协议，只是 baseUrl 不同）
- **协议/区域/工具资源（vision/R2/image*）都是全局的**——只有 baseUrl/apiKey/model 是角色级。注释里写明了
- **回退链路清晰**：`overrideApiConfig` > 角色 API（如果设了 baseUrl）> 全局。没设 baseUrl 的角色走全局，不报错
- **useChatAI 合并用 `{...apiConfig, baseUrl, apiKey, model}`**——保留全局的 protocol/minimaxRegion，温度/流式等。避免遗漏字段
- **打开抽屉时同步 state**——用户切角色后，state 要重置。用 useEffect 监听 `char.id` 和 `apiConfig` 三个字段
- **第一版已经在 preview 部署过**——暮色测了，发现位置不对才让我改。本次是 fixup

## 备注
- 验证：`npm run build` 通过（3.68s，无 error）
- 没动江澈/麦麦的现有 `apiConfig`——保持空状态，暮色在 SullyOS 里手动填
- 协议选择（OpenAI/Claude）依然在"设置"主页面，不在"聊天设置"里
- 后续可以做的：副 API（emotionConfig.api、proactiveConfig.secondaryApi）本来就已经是按角色分的，不动
