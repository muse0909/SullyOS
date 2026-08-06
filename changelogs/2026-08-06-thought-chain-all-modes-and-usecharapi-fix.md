# 思维链 2 修 — 正常聊天也加 + 主动消息 prompt 加回 + 角色独立 API 走主 API bug

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

### 1. 思维链：正常聊天 + 主动消息都加

暮色 8-6 22:00 反馈：

> 思维链是要的。那个改回来，给正常聊天也加上思维链。

**之前 7-27 的"思维链（可选）"段只在主动消息 prompt**（OSContext.runProactive hintLines）里，主动消息 system prompt 的 Chat App Rules 段没写。**正常聊天完全没提示**，LLM 不知道可以写 `[[THOUGHT:...]]`。

**这次的修法**：
- `utils/chatPrompts.ts:610-618` —— **bp1Tools 公共段**加 5.5 思维链规则（位置在 5 环境感知和 6 动作之间）：
  - 主动消息 system prompt 拼 `sp.bp1Tools`（OSContext.tsx:1634），自动拿到
  - 正常聊天 system prompt 拼 `bp1Tools`（useChatAI:916），自动拿到
  - **一处定义，两处生效**，避免之前"主动消息 hint 写一遍，system prompt 又写一遍"的重复
- `context/OSContext.tsx:1597-1602` —— **主动消息 hintLines 也加回 7-27 那段**（暮色"那个改回来"明确要求）
  - 跟公共段有 60% 重复，但暮色明确说"改回来"，**保留**避免他再问"为什么没加回"
  - 重复 token 大约 200 字，system prompt + hint 总共也就 2-3k 字符，可控

### 2. 正常聊天解析 `[[THOUGHT:...]]` → `metadata.thought`

暮色要的"正常聊天也加思维链"光加 prompt 不够——还得在解析时提取标签存到 metadata，前端才能渲染折叠的"💭 思维链"。

**OSContext.runProactive 主动消息路径** 早就有这机制（line 1726-1730 `thoughtMatch` + line 1774 `thought: thoughtContent`）。**useChatAI 正常聊天路径之前没**。

**这次的修法**：
- `hooks/useChatAI.ts:4241-4248` —— 在 `ChatParser.sanitize(aiContent)` 之前加 `thoughtMatch` 提取，存 `thoughtContent`
- `hooks/useChatAI.ts:4280-4288` —— 加 `buildChunkMeta()` helper，**本轮首条消息**的 metadata 挂 `thought: thoughtContent`（后续 chunk 不挂，避免重复）
- `hooks/useChatAI.ts` —— 6 处 `metadata: mcdInheritMeta` 改成 `metadata: buildChunkMeta()`（replace_all）

**跟主动消息的"轮首挂一个"不同**：正常聊天没"轮"概念，简单点——**每轮只挂到第一条 assistant 消息**。LLM 一条消息输出多个 bubble，第一个 bubble 显示思维链，后面不显示。

### 3. MessageItem 取消 `proactiveRoundStart` 限制

之前 MessageItem 渲染思维链的 check：

```jsx
const isNewFormat = 'proactiveRoundStart' in meta;
const showThought = meta.thought && (
    isNewFormat ? !!meta.proactiveRoundStart : true
);
```

**老数据**（c613e54 之前，没 `proactiveRoundStart` 标记）：每条都显示
**新主动消息数据**（c613e54 之后）：只在 `proactiveRoundStart === true` 的轮首显示
**正常聊天**：完全不显示（因为没有 `proactiveRoundStart` 标记）

暮色 8-6 22:00 要"正常聊天也加" → 改成"所有 assistant 消息只要有 `metadata.thought` 就显示"：

`components/chat/MessageItem.tsx:752-765` 简化成：

```jsx
{!isUser && (m as any).metadata?.thought && (
    <ThoughtFold thought={(m as any).metadata.thought} />
)}
```

**妥协**：老主动消息数据（c613e54 之前，没 `proactiveRoundStart` 标记）每条都显示——这个行为没变。
**新主动消息数据**（c613e54 之后）：之前轮首显示，现在每条都显示（如果 thought 重复挂到每条，UI 上会重复）。但主动消息的 OSContext 路径只把 thought 挂到轮首（line 1774 `isFirstChunk && thoughtContent`），所以**主动消息在主动消息路径下行为不变**。
**正常聊天**：之前完全不显示，现在每轮首条显示。

### 4. 修"角色独立 API 走主 API"bug

暮色 8-6 22:00 截图反馈：主动消息设置里 "使用角色独立 API" 开关开了，但触发后调的是主 API。

**根因**：

`context/OSContext.tsx:1497`（修前）：

```js
const useCharApi = !useSecondary && !!(pCfg?.useCharApi && char.apiConfig?.baseUrl);
```

`char.apiConfig.baseUrl` 是 **OpenAI 套的 baseUrl**。但角色 API 7-27 起分 3 套协议（OpenAI/Claude/Gemini）：

| protocol | baseUrl 字段 |
|---|---|
| `'openai'`（默认） | `char.apiConfig.baseUrl` |
| `'claude'` | `char.apiConfig.claudeBaseUrl` |
| `'gemini'` | `char.apiConfig.geminiBaseUrl` |

暮色角色的 API 配的是 Claude 协议（`char.apiConfig.protocol = 'claude'`），`baseUrl` 是空，`claudeBaseUrl` 有值。
useCharApi 误判成 false → 走 `currentApiConfig`（主 API）。

**修法**：

`context/OSContext.tsx:1495-1530` 按 protocol 选 baseUrl：

```js
const charApiConfig = char.apiConfig;
const charApiProtocol = (charApiConfig as any)?.protocol ?? 'openai';
const charApiBaseUrl = charApiProtocol === 'claude'
    ? (charApiConfig as any)?.claudeBaseUrl
    : charApiProtocol === 'gemini'
    ? (charApiConfig as any)?.geminiBaseUrl
    : charApiConfig?.baseUrl;
const useCharApi = !useSecondary && !!(pCfg?.useCharApi && charApiBaseUrl);
```

防御性 check `if (!api.baseUrl && !((api as any).claudeBaseUrl || (api as any).geminiBaseUrl))` 也补全（防止 3 套都没配时仍然继续）。

**未修的相邻 bug**（下一轮建议）：
- `context/OSContext.tsx:1671` 硬写 `${api.baseUrl}/chat/completions` —— 对 Claude/Gemini 协议 URL 错误（应该是 `/v1/messages` 或 `:generateContent`）
  - 8-2 changelog "接口不混" 提到了 `safeFetchJson` 不支持 Gemini，这次修 useCharApi 判定没动 fetch URL
  - 这次暮色没要求修，先记下

## 动了哪些文件

- `utils/chatPrompts.ts` —— bp1Tools 公共段加 5.5 思维链规则（line 610-618）
- `context/OSContext.tsx` —— 主动消息 hintLines 加 7-27 那段思维链（line 1597-1602）+ 修 useCharApi 判定按 protocol 选 baseUrl（line 1495-1533）
- `hooks/useChatAI.ts` —— 正常聊天解析 `[[THOUGHT:...]]` 存 metadata（line 4241-4248）+ 6 处 `mcdInheritMeta` → `buildChunkMeta()`（line 4308/4324/4343/4355/4370/4407）
- `components/chat/MessageItem.tsx` —— 思维链 check 简化，去掉 `proactiveRoundStart` 限制（line 752-765）

## 踩坑 / 需要知道的（重要）

### 公共段 vs 路径专属段

暮色说"那个改回来，给正常聊天也加上"——我拆成两层：
- 公共段（chatPrompts.bp1Tools 5.5）：正常聊天 + 主动消息自动覆盖
- 主动消息 hintLines 路径专属段：暮色要"改回来"，保留

**权衡**：公共段已经覆盖主动消息，主动消息 hintLines 加回 7-27 那段是**重复**。但暮色明确要"改回来"，**保留**避免他下次又问"为什么没加"。

**下次类似情况**：如果暮色既要 A 又要 B，**先按字面都加上**（他工作流偏好之一："不要简化"），不要擅自"用公共段覆盖"省事。

### 主动消息路径只挂轮首，正常聊天只挂首条

主动消息有"轮"概念（proactiveRoundStart），正常聊天没"轮"。处理方式：
- 主动消息：thought 只挂到轮首（`isFirstChunk && thoughtContent`，line 1774）
- 正常聊天：thought 只挂到本轮第一条 assistant 消息（`globalMsgIndex === 0 && thoughtContent`）

**结果**：两边都是"一个轮/一轮一条 thought"，不重复显示。MessageItem 渲染时每条都查 `metadata.thought`，但因为只挂了一条，UI 上也只显示一个。

### useCharApi 判定要看哪套 baseUrl

3 套协议并行后，baseUrl 字段从 1 个变 3 个。所有判定 baseUrl 存在的地方都得按 protocol 选：

- `context/OSContext.tsx:1497`（修前）→ `1495-1530`（修后）
- `utils/handbookGenerator.ts:461/703` `apiConfig.baseUrl` —— 9 处（未审，可能有同类问题）

**下次写"角色 API 存在性"判定时**，先选 protocol 再读 baseUrl：
```js
const url = proto === 'claude' ? cfg.claudeBaseUrl : proto === 'gemini' ? cfg.geminiBaseUrl : cfg.baseUrl;
```

## 备注

- 暮色 8-6 22:00 三件事（思维链 / 角色独立 API bug / 清 todo）都修了
- 角色独立 API 3 套协议 fetch URL bug 没动（下一轮）
- 清空的 todo 列表（8-5/8-6 累积的 backlog）—— 按暮色"现在先清掉吧，等我问你再查"指示，不再生效
