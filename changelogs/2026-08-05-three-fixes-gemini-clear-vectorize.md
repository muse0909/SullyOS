# 三连修复：Gemini 池重试 + 角色 API 清空 + 一键向量化计数

**日期**：2026-08-05
**涉及 commit**：`4797d4d`

## 改了什么

### 1. Gemini key 池重试 2 → 3 次

`hooks/useChatAI.ts:1913` `for (let attempt = 0; attempt < 2; attempt++)` → `attempt < 3`

**根因**：16 个 key 池，注释说"最多重试 1 次（避免无限循环）"。但 1 次太少 —— 1 个 key 失败就只剩 1 次机会切下一个，2/16 就放弃，剩 14 个 key 没用到。3 次是经验值（1 + 2 retry = 3 次），既不会无限循环又能跨过单个坏 key。

### 2. 角色 API 清空按钮 —— 强制清空 + 自动关抽屉

`apps/Chat.tsx:313-326` `handleClearPerCharApi`

**根因**：清空按钮点完后 `setPerCharApiGeminiUrl('https://generativelanguage.googleapis.com/v1beta')` 写了**默认 URL**（不是空）。如果用户清空后接着点"保存"，line 293 判断 `!perCharApiGeminiUrl.trim()` 因为默认 URL 不是空 → 走 else 分支 → 保存成"默认 Gemini 配置" → `char.apiConfig.geminiBaseUrl` 又被写入 → 触发 AI 还是走角色 API。

**修法**：
- 清空时把 Gemini URL/Key/Model 也设成 `''`（不用默认）
- 调 `updateCharApiConfig(id, undefined)` 显式清 char.apiConfig
- 加 `addToast` 给明确反馈（"已清空，下次发送用主 API"）
- 清空后**自动关抽屉**（跟保存一致），避免用户以为没生效

### 3. 一键向量化计数骗用户 —— 三处一起改

**根因（深度追查后）**：

`apps/Chat.tsx:1985` `handleForceVectorize` 跟 `utils/memoryPalace/pipeline.ts:1131` `processNewMessages` 用了**不同的 filter**：
- ForceVectorize：`m.type === 'text' && m.content?.trim()` —— 只 text 类型
- Pipeline：`isMessageSemanticallyRelevant` —— text + system + interaction + score_card + transfer

→ 算的"未处理消息数"完全对不上号。

**还叠加两个 bug**：
- `totalProcessed += batch.length` 加的是"要塞多少"（170），不是"真处理多少"（Pipeline 内部 processCount = buffer * 0.85 = 56）
- Pipeline `force` 模式阈值 10，第 2 轮 hwm 进入 hotZone 范围，buffer 只剩 9 条 → 永远跳不过 → Pipeline 跳过 → ForceVectorize 收到 `skipReason: 'threshold'` → break → 实际只跑 1 轮

**用户看到的现象**：点"一键向量化" → toast 弹"处理了 170 条" → 但删除弹窗说"还有 209 条没处理" → **骗用户**。

**三处修法**：

1. **`apps/Chat.tsx:1988`** ForceVectorize 改用 `isMessageSemanticallyRelevant`（动态 import），跟 Pipeline 同款 filter
2. **`apps/Chat.tsx:2014`** `totalProcessed` 累计改成 `pipelineResult.autoArchive.hideBeforeMessageId - hwm`（真处理条数），不是 `batch.length`
3. **`utils/memoryPalace/pipeline.ts:1151`** force 模式阈值 10 → 5，让小批次也能跑（hwm 进 hotZone 之后 buffer 经常 5-9 条）

## 动了哪些文件

- `apps/Chat.tsx` —— 清空按钮 + ForceVectorize filter + totalProcessed 累计
- `hooks/useChatAI.ts` —— Gemini 池重试 2 → 3
- `utils/memoryPalace/pipeline.ts` —— force 模式 buffer 阈值 10 → 5

## 踩坑 / 需要知道的

- **未修的相邻 bug**：
  - 副 API 默认模型 `gemini-2.5-flash`（MemoryPalaceApp.tsx:587）已被 Google 撤了，新用户 404。下次开窗口修：要么改默认 `gemini-2.0-flash`，要么在副 API 设置里加 deprecated 警告
  - 主动消息 history 500 条 + 完整 system prompt 太胖，token 暴涨真凶之一。暮色 2026-08-05 14:11 说"先暂放"
  - 温度 1.55 跟预设/备份恢复有关，Settings UI 加"恢复默认 0.85"按钮也先暂放

- **计数修法是单向收紧的**：之前 ForceVectorize 算的"剩余 209"是**只算 text 类型**，可能实际包含 system 等。改后是**含 system 的总数**。数字会变（变大），这是对的。

- **force 阈值 10 → 5 的影响**：5 是经验值 —— 一轮还能提取 1-2 条记忆。`< 5` 时确实没什么内容可挖，留着 skip 也合理。

- **build 验证**：`npm run build` 通过 ✓

## 备注

- 主动消息瘦身（暮色 8-5 说"先暂放"）—— 等这次跑稳了下次开
- 副 API 默认模型换名 —— 用户必须主动改
- Settings 加"恢复默认 0.85"按钮 —— 用户手动存预设后应该已经回到正常了
- 一键向量化改完后用户测：再点一次，看 toast 显示的"处理 X 条"是不是接近删除弹窗说"还有 Y 条没处理"里 Y 减少的值
