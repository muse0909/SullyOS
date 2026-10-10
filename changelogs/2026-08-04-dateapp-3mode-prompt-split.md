# 见面 app 3 模式 prompt 拆分 — 去掉 novel/longform 的 `[emotion]` 标签

**日期**：2026-08-04
**涉及 commit**：(本任务)

## 改了什么

见面 app 有 3 个模式：`gal`（视觉 GalGame，**有立绘**）、`novel`（小说阅读，**纯文字**）、`longform`（长文，**纯文字**）。之前 3 个模式共用同一份"VN 模式" prompt，每一行强制 `[emotion]` 标签。但 novel / longform 模式**前端根本不解析 emotion 字段**——`cleanTextForDisplay`（`DateSession.tsx:22-27`）正则 `text.replace(/\[.*?\]/g, '')` 一刀切把所有 `[xxx]` 剥光，导致：

- AI 写 5-10 行 → 每行带 5-10 字符的 `[emotion]` → 一轮浪费几十 token
- 标签噪声压住自然段落的连贯性（每行都要以 `[emotion]` 开头，写作被卡住）
- 标签完全不被前端使用

**改完后 3 份 prompt 分发**：
- **gal**：保留原 VN 脚本 prompt（`[emotion]` 切立绘）
- **novel**：文学段落流（无标签，动作 / 心理 / 环境 / 台词自然混写，长段细腻）
- **longform**：口语长文（无标签，短句为主，动作驱动）

## 动了哪些文件

- `apps/DateApp.tsx`
  - 顶部加 `buildDateSystemPrompt(char, userProfile, viewMode)` helper（模块级，line 22-114）—— 按 viewMode 返回 3 份 prompt 中的 1 份
  - 加 `getDateUserNote(viewMode, action)` helper（line 116-138）—— User 消息末尾的 system note 也按模式分
  - `handleSendMessage` / `handleResendLastUserMessage` / `handleReroll` 3 个 handler 加 `viewMode: 'gal' | 'novel' | 'longform' = 'gal'` 参数
  - 3 个 handler 内部硬编码的 VN prompt 块（80+ 行）删掉，改成 `buildDateSystemPrompt(char, userProfile, viewMode)`
  - 3 个 handler 内部 user 消息末尾的硬编码 system note 改成 `getDateUserNote(viewMode, 'send' | 'resend' | 'reroll')`
  - 顺手修了 `handleReroll` 的返回类型 bug（之前签名 `Promise<string>` 实际返回 `{ content, thinking }`）—— 改回 `Promise<{ content: string; thinking?: string }>`
  - 顶部 import 加 `UserProfile`（helper 需要类型）

- `components/date/DateSession.tsx`
  - 3 个 callback 类型签名加 `viewMode` 参数（line 82-84）
  - 3 个调用点（line 645/683/710）传 `viewMode` 进去

## 踩坑 / 需要知道的

### 1. 前端解析逻辑完全不用动
- `cleanTextForDisplay`（`DateSession.tsx:22-27`）本来就对所有文本剥光 `[xxx]`，novel/longform 模式一直在用
- `parseDialogue`（`DateSession.tsx:48-73`）只在 gal 模式被调用（line 514/655/691/718），把 emotion 解给立绘用
- novel/longform 模式用的渲染（line 896 longform / line 1107-1108 novel）都只走 `cleanTextForDisplay`，不需要 emotion
- **所以**前端没动一行。

### 2. 历史消息不洗，按暮色要求
- DB 里所有历史 date 消息还带 `[emotion]` 前缀（gal 时代写的）
- 切到 novel/longform 模式后，`cleanTextForDisplay` 会把 `[emotion]` 剥掉再展示，用户看到的是干净的纯文本
- 不写回填脚本（暮色选"不洗"）

### 3. 模式切换是 state 同步的
- `DateSession.tsx:113-120` `useState` 初始化 viewMode 从 `char.dateViewMode` 或 `initialState.viewMode`
- `DateSession.tsx:1319` 切换模式时 `setViewMode(m); updateCharacter(char.id, { dateViewMode: m })` 同步到角色设置
- 也就是说：用户切到 novel 模式 → 角色设置里 dateViewMode = 'novel' → 下次进入用 novel prompt
- handler 接收的 `viewMode` 是**用户当前**的模式，不是角色的默认模式

### 4. gal 模式完全保持现状
- prompt 1:1 搬进 `buildDateSystemPrompt` 的 `if (viewMode === 'gal')` 分支
- examples / 错误示范 / 正向示范都保留
- user note 也 1:1 保留

### 5. handleReroll 返回类型顺手修了
- 之前：`Promise<string>` —— 错的，函数实际 return `{ content, thinking }`
- TS 没报错是因为 DateSession 那边调用 `await onReroll()` 直接拿 `result.content` 不在乎类型
- 现在改成 `Promise<{ content: string; thinking?: string }>` 跟另外两个 handler 一致

## 备注

- **token 节省预估**：每轮 5-10 行 × 5-10 字符 ≈ 几十 token 纯标签（仅在 novel/longform 模式有效）
- **写作质量预期**：novel 应该更长更细腻（长段描写 / 心理交织），longform 应该更口语更短促（动作驱动）
- 没跑过实际生成（暮色不在本地），要等 Vercel 部署后暮色测效果
- 后续如果发现某模式 prompt 风格还需要微调（暮色说"还是要轻一点"之类），直接改 `buildDateSystemPrompt` 里对应分支的字符串即可
