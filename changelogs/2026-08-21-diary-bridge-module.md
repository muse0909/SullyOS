# 角色日记核心模块：utils/charDiary.ts

## 背景

SullyOS 日记 v1 步骤 2：新建 `utils/charDiary.ts`，5 个核心函数（miya 风格 + SullyOS 适配）。

## 新文件

### `utils/charDiary.ts` — 5 个导出函数

**1. `buildSystemPrompt(char)`**（miya 极简 system）
```
你是「{name}」，正在写私人日记。
必须用第一人称、角色口吻，中文撰写。
只输出 JSON，不要 markdown，不要思维链。
格式：{"title":"短标题8字以内","mood":"今日心情词","content":"正文"}。
正文约 750-850 字，具有生活感与日常感：可写饮食、天气、琐事、工作学习、偶遇、思绪、小确幸或烦恼。
不必只围绕用户展开；若今日有聊天可自然融入，无聊天则完全依据人设与生活轨迹书写。
禁止提及 AI、生成、系统、提示词；禁止打破第四面墙。
首字符必须是 {。
```

**2. `buildUserPrompt({char, todayIso, contextText})`**
```
【角色设定·用户信息·世界书·今日语境·必读】
请完整阅读后，以角色身份写一篇今日私人日记。

{contextText}

【写作要求】
- 日期：{todayIso}
- 角色：{char.name}
- 正文 750-850 字，分段自然，有日记私密感
- title 为当日日记标题，mood 为心情关键词
- 只输出 JSON
```

**3. `buildDiaryContext(char, {userProfile})`**

按顺序拼装：
1. 今日时间块（`YYYY-MM-DD HH:MM 周X`）
2. 角色块（名字 + systemPrompt）
3. 用户块（userProfile.name + bio）
4. 角色挂载的世界书（`char.mountedWorldbooks`）
5. 今日聊天（最近 50 条过滤当日，时间正序）
6. **无今日聊天 fallback**：最近 10 条文本消息

**4. `parseDiaryFromApi(text)`**（miya 同款 3 重 JSON 容错）
- 完整 `JSON.parse` → 宽松 `\{[\s\S]*\}` 提取 → 兜底（content=text, mood='平静', title=日期）
- 三个层都失败也保证不挂，最多 content 是 raw text

**5. `generateCharDiary(char, apiConfig, {userProfile})`**（主入口）
- 去重：今天已写过 → 抛 `今天已经写过日记了`
- 拼装 prompt + 调 `/v1/chat/completions`（OpenAI 兼容）
- `max_tokens: 8192, temperature: 0.92`
- 解析 → 写 IndexedDB `STORE_DIARIES`（`source: 'char-only'`）
- 返回 `DiaryEntry`

## 设计决策

- **utils 层不 `useOS()`**：API 配置和 userProfile 由调用方（JournalApp）传入，避免 hook 在非组件处用
- **不引入 miya 的"用户面具 / 关系网"**：SullyOS 是单用户模型
- **世界书用 `char.mountedWorldbooks`**：跟 SullyOS 现有 `useChatAI.ts:139` 的世界书机制一致
- **JSON 容错 3 重**：覆盖 LLM 偶尔不严格输出 JSON 的情况

## 不在本轮做的

- `apps/JournalApp.tsx` UI 改造 — 步骤 3-4
- 偷看机制 — v1.1
- 定时自动写（借 ProactiveChat）— v1.1
- 角色时区配置 — v1.1

## 验证

build 通过即可。功能验证在步骤 3 之后（点"现在让 TA 写一篇"按钮时调这个模块）。
