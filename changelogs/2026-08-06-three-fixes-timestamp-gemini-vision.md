# 8-6 三连修复 — 时间戳 v3 + Gemini 400 真凶 + 温度 0.85 写死 + 主动消息请求体 log

**日期**：2026-08-06
**涉及 commit**：（待提交）

## 改了什么

### 1. 时间戳 — 每条都画（v3，暮色最终拍板版）
- 暮色原话："**时间戳都放头像下，用户放头像下，AI也放头像下**"
- 暮色原话："**没有紫色的事。就是灰色的**"
- 暮色原话："**全都正常显示时间戳。每次请求都是当时的时间戳**"
- 实际场景：5 条消息（3 用户 + 2 AI）= 5 个时间戳（每个头像下都画一个）

**改了**：
- `components/chat/MessageItem.tsx:736-753` — AI 头像下时间戳：去掉 `isLastInGroup` 判断，永远画
- `components/chat/MessageItem.tsx:797-806` — 用户头像下时间戳：去掉 `isLastInGroup` 判断，永远画
- 保持灰色样式（`text-slate-600` + `bg-slate-100/80`），去掉紫色
- 保留 `showTimestamp === 'never'` 兜底（用户手动关掉时全部不画）

**错的 changelog 记录**（按暮色要求"删掉不要覆盖"——这次不改旧 changelog 文件，加这个新文件说清楚）：
- 7-23 changelog "主动消息时间戳每条独立" — 当时只对主动消息画，方向对但范围太窄
- 7-27 changelog "proactive 永远独立 group + 紫色" — **紫色标记完全去掉**（暮色明确不要），group 独立语义保留
- 6edc7fc (8-2) "calcBreaks 改成按轮" — **方向反了**（按轮 = 1 轮 1 个时间戳，暮色要每条都画）
- 6edc7fc 那个 30 分钟兜底（apps/Chat.tsx:3103）也错，**保留** calcBreaks 本身（头像/间距依赖），但**时间戳画法不依赖 isLastInGroup 了**

### 2. Gemini 400 真凶 — `__pickedKeyIndex` 字段污染请求体
- 8-4 加 key 池（`e6ca29e`）时往 `geminiRequestBody` 上挂了 `__pickedKeyIndex` / `__pickedKeyShort` 闭包变量
- 8-4 之前 Gemini 协议一直正常
- 8-4 之后所有 Gemini 请求都 400（不论 2.0 / 3.6 model）
- Google 收到未知字段 → 400 INVALID_ARGUMENT
- **为什么 16 个 key 池全 400**：每个 key 都被切到，每个 key 都发同一个污染的 body，全部 400

**改**：`hooks/useChatAI.ts:1940-1948` — 序列化前先 destruct，只发 Gemini 标准 3 字段：
```ts
body: JSON.stringify({
    contents: geminiRequestBody.contents,
    systemInstruction: geminiRequestBody.systemInstruction,
    generationConfig: geminiRequestBody.generationConfig,
}),
```

### 3. 温度 0.85 写死 — 暮色产品决定
- 暮色原话："**温度这个除了主 API，其他底层直接写死 0.85，省的来回调麻烦死了**"
- 改了 2 处：
  - `hooks/useChatAI.ts:1529` — 识图 Gemini 协议 generationConfig：`temperature: 0.3 → 0.85`
  - `hooks/useChatAI.ts:1631` — 识图 OpenAI 协议 requestBody：`temperature: 0.3 → 0.85`
- 主 API 温度（line 1740 `userTemp`）保持从 `effectiveApi.temperature` 读，不动

### 4. 主动消息请求体 log — 跟主 API 一样能看完整 body
- 暮色原话："**你给主动消息也加一个可以查看请求体的，我看一下都发了什么**"
- 之前 7-22 主动消息只存元数据（msgCount/字符数），不存 body
- 改 `context/OSContext.tsx:1686-1719` — 跟主 API 完全一样的格式：
  - key: `sullyos:lastProactiveReqLog`（主 API 是 `sullyos:lastApiReqLog`）
  - 存完整 `requestBody: reqBody` 字段
  - console 紫色高亮提示 + `copy(JSON.parse(localStorage.getItem('sullyos:lastProactiveReqLog')))`

## 动了哪些文件

- `hooks/useChatAI.ts` — Gemini 400 真凶修（20 行改）+ 识图温度 0.3→0.85（2 处）
- `components/chat/MessageItem.tsx` — 时间戳每条都画（29 行改）
- `context/OSContext.tsx` — 主动消息完整请求体 log（28 行改）

## 踩坑 / 需要知道的（重要）

### Gemini 400 真凶诊断过程
- 暮色一开始怀疑 model 名（`gemini-3.6-flash`），我误判说 Google 不存在这个 model → 错的
- 暮色纠正：副 API 走同 model + 同 key 正常 → 排除 model/URL/key
- 真正原因：`__pickedKeyIndex` / `__pickedKeyShort` 内部字段污染了请求体
- **Google Gemini API 对未知字段敏感**（不忽略），跟 OpenAI 不一样
- 教训：往请求体上挂内部字段前，先想清楚"如果序列化时不分发怎么办"——挂到 **闭包变量**而不是 body 对象

### 时间戳语义反复改
- 7-23：主动消息每条独立画（方向对但范围窄）
- 7-27：proactive 永远独立 group + 紫色（紫色错，group 独立对）
- 8-2 (6edc7fc)：按轮 1 轮 1 个时间戳 + 30 分钟兜底（**方向反了**，跟暮色最初需求矛盾）
- 8-6：每条都画 + 灰色 + 头像下（最终版）
- 根本原因：暮色不擅长"工程化"表达需求，**靠图纠正**。以后类似 UI 行为，先让暮色画 1 张 ASCII 图或者给 1 张参考截图，比写需求 doc 高效 10 倍

### "刚改好的 bug 合并后又出现"
- 之前我误判是分支并行 / codex 覆盖
- 实际 git 层面 preview HEAD 50e3678 干净，没有覆盖
- 真实原因：Vercel 部署缓存 / 浏览器缓存 / localStorage 残留
- 暮色记错"昨天修了"——实际 8-3 ~ 8-6 没有任何 commit 修 Gemini 400
- 教训：**查 git log 比查记忆可靠**。暮色说"修了"先 `git log --grep` 验证

## 备注
- 时间戳每条都画会让聊天视觉变密（之前是稀疏的 2-3 个变 5+ 个）— 暮色主动要的，等他 Vercel 部署后看实际效果
- 主动消息 log key 改名 `proactiveLastReq` → `lastProactiveReqLog`，跟主 API 格式对齐
- 这次 commit 没改 7-23 / 7-27 / 6edc7fc 任何旧 changelog 文件——按暮色要求"不要覆盖"，新加这个 changelog 把历史说清楚
