# 主动消息 4 修 — 误删回滚 + "没想好说什么" 改系统消息 + 角色隔离 bug + Gemini 直连修复收尾

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

### 1. 主动消息 messages 数组 history 误删回滚（1171c6c commit 改错了）

暮色 8-6 反馈 **"主动消息你怎么把两个全删了？现在只有上面的预设了。正文全没了"** —— 我之前 1171c6c commit 误把 messages 数组里的 8 条 user/assistant history 删了。

**两个用途完全不同，不能去重**：
- **messages 数组 history**（user/assistant role）= **对话流**，让 LLM 接续上一句
- **system prompt 末尾"最近聊天（10 轮）"** = **写作素材**，文本格式"【江澈】...【暮色】..."

我之前以为"两段是同一段对话构造了两次"是重复的——错了，是**两套不同机制**。

**改**：
- 恢复 `const historyForBuild = await DB.getRecentMessagesByCharId(charId, 8)`（line 1614）
- 恢复 `buildMessageHistory(historyForBuild, 8, ...)`（line 1654）
- **保留** system prompt 末尾"最近聊天（10 轮）"段

### 2. "没想好说什么" 从 toast 改成 system 消息推聊天流

暮色 8-6 19:09 反馈：**"我要的不是这样的弹窗提示，是像连接中断那样的，在聊天页里的系统提示"**

之前是 `addToast('麦麦 这次没想好说什么', 'bell')` —— 弹窗。
现在改成 `DB.saveMessage({ role: 'system', type: 'text', content: '[系统: 麦麦 这次没想好说什么]' })` —— 推聊天流，渲染成铃铛胶囊，跟 [连接中断: ...] / [系统: xxx] / 图床警告同款。

**为什么用 `[系统: ...]` 不是 `[连接中断: ...]`**：
- "[连接中断: ...]" 语义是网络问题
- "没想好说什么" 语义是 AI 主动选择不发（不是技术故障）
- "[系统: ...]" 语义中性，跟图床警告、小纸条同款 prefix

**为啥 addToast 兜底**：DB.saveMessage 失败时（比如 IDB quota）还是要弹 toast 提醒用户。

### 3. 角色隔离 bug 修 — 真清 schedule，不光 skip

暮色 8-6 反馈：**"全部角色都关了的情况下也出现过收到主动消息的情况"**

**根因**：
- `OSContext.runProactive` line 1427 检查 `char.proactiveConfig.enabled` → false 时只 `return`（skip 一次）
- **ProactiveChat 里的 schedule 还在 localStorage + listener 还在主线程**（每 20 秒 fire 一次）
- schedule fire → runProactive 调起 → enabled=false skip → 死循环
- 用户感受："关了还触发" / "全部关了还收到"

**修法**（**2 处**）：
- `context/OSContext.tsx:1427-1431` — enabled=false 时**主动调 `ProactiveChat.stop(charId)`**，真删 schedule + 删 last fire + 同步 SW
- `hooks/useChatAI.ts:4501-4506` — `startProactiveChat` 加防御：char.proactiveConfig.enabled=false 时不 start

### 4. Gemini 直连 400 真凶（1171c6c commit 上一轮没写 changelog，补上）

8-4 加 key 池时（commit `e6ca29e`）往 `geminiRequestBody` 上挂了 `__pickedKeyIndex` / `__pickedKeyShort` 闭包变量，line 1943 `JSON.stringify(geminiRequestBody)` 把这俩字段也发出去。Google 收到未知字段 → 400 INVALID_ARGUMENT。

**修法**：line 1940-1948 序列化前只构造 Gemini 标准 3 字段的对象。

这个其实在 commit `05de4fd` 那个 changelog 里有写（"时间戳每条都画 + Gemini 400 真凶 + 温度写死 0.85 + 主动消息请求体 log"），这里再写一遍因为它跟"接口不混"是同一类问题。

## 动了哪些文件

- `context/OSContext.tsx` — 3 处改动：
  - line 1427-1431：runProactive enabled=false 时主动 stop
  - line 1611-1624：恢复 historyForBuild 拉 8 条
  - line 1655-1665：恢复 buildMessageHistory(historyForBuild, 8, ...)
  - line 1832-1855：没想好说什么 → 推 [系统: ...] 消息
- `hooks/useChatAI.ts` — 1 处改动：
  - line 4501-4506：startProactiveChat 加 enabled 防御

## 踩坑 / 需要知道的（重要）

### 紫色视觉标记
**我之前 7-27 changelog "proactive 永远独立 group + 紫色视觉标记" 里写的"紫色"是我自己加的**，不是暮色要求的。**暮色从来没要过紫色**，他要的就是灰色。7-27 changelog 那次"加紫色"是我自己脑补的（基于"proactive 永远独立 group"的视觉区分需要），**错了**。

**结论**：
- 紫色 = 我加的（**作废**）
- 灰色 = 暮色要的标准（保留）
- 7-23 / 7-27 / 6edc7fc (8-2) 几个 changelog 跟"按轮"叠加产生副作用，**实际产品方向**：每条都画 + 灰色 + 头像下（已 commit 05de4fd 改完）

### 接口不要搞混了
暮色担心**"Gemini 协议发到京东云端点"**——OSContext.runProactive 走的协议分支确实有隐患：
- `safeFetchJson` (utils/safeApi.ts:197) 类型签名只接受 `'openai' | 'claude'`，**不处理 'gemini'**
- 主动消息的 `apiProtocol = (api as any).protocol ?? 'openai'` —— 如果配了 'gemini'，safeFetchJson 走 default（openai）路径
- 主动消息 reqBody 永远是 OpenAI 格式（line 1667-1674），没有像主 API line 1754 `if (useGeminiProtocol)` 的分支
- **如果 baseUrl 是 Google 官方** + protocol=gemini → 京东云会 400 / Google 会 400（请求体不匹配端点）

**这次京东云 400 的真正根因不是协议问题**，是 **model `GLM-5.2` 在京东云 zai 不识别**（OpenAI 协议下京东云拒收未知 model 名）。OpenAI 协议下 Claude 能正常（暮色测过）也佐证协议分支没问题。

**接口不混的真正修法**（下一轮建议）：
- `safeFetchJson` 加 Gemini 协议分支（跟 OpenAI / Claude 平级）
- 主动消息 reqBody 构造时加 `if (apiProtocol === 'gemini')` 走 Gemini 格式

这个改动较大，本轮没做。**暮色看到的 400 是 model 名问题，不是协议问题**。

### 角色隔离修法的取舍
为什么在 `runProactive` 里加 stop 而不是改 ProactiveChat.start？
- ProactiveChat.start 只接受 `(charId, intervalMinutes)`，不知道 enabled 状态
- 在 callback 里加 enabled 检查 → callback 已经 fire，schedule 还在跑
- 改 ProactiveChat.start 接口需要传更多参数，影响所有调用点
- **在 runProactive 里加 stop** 是最局部的修法：每次 fire 走 runProactive → 检查 enabled → 如果 false → stop，下次 fire 不会发生

副作用：stop 是幂等的（重复调没影响），即使 schedule 已经被清，再调一次 stop 也只是 no-op。

## 备注
- 紫色视觉标记 = 我自己加的（7-27 changelog 错），不是暮色要求，作废
- 接口不混的根因（safeFetchJson 不处理 Gemini）本轮没修，下一轮处理
- GLM-5.2 京东云不识别 = 暮色自己 model 配错了，去 API 浮窗改成 GLM-4-Plus / GLM-4-Flash 等
- 1171c6c commit 误删 messages 数组 history 已回滚
