# 朋友圈 ↔ Chat 互通 + 设置入口迁移 — 方案档案

**日期**：2026-07-04
**暮色原话**：
> 朋友圈设置放到朋友圈页面，放相机左边。
> 我跟ai说让他发个朋友圈他说看不到。是不是底层逻辑还是没通？
> 评论触发了，主动消息也触发了。但是ai并不知道给我评论了，这个底层逻辑参考330中的，提示词也可以照搬。
> 现在是聊天和朋友圈没有通，你需要了解一下连接的逻辑，聊天框要连接到朋友圈。

**目标**：
1. UI 改动：朋友圈设置入口从 DiscoverPage 移到 MomentsPage 顶部工具栏（相机左边）
2. 底层逻辑：chat ↔ moments 互通（AI 后续对话 awareness 朋友圈事件）

---

## 0. 现状摸底

### 0.1 SullyOS 朋友圈架构（已存在）

| 文件 | 状态 |
|---|---|
| `apps/MomentsPage.tsx` (773 行) | ✅ 朋友圈主页（v3 修复版） |
| `apps/MomentsSettingsPage.tsx` (340 行) | ✅ 设置页 |
| `apps/DiscoverPage.tsx` (~150 行) | ✅ WeChat 内嵌子页，含朋友圈入口 + 设置入口（齿轮） |
| `utils/momentsStorage.ts` | ✅ 数据存储（localStorage） |
| `utils/momentsAI.ts` (436 行) | ✅ AI 朋友圈工具（2026-07-03 暮色拍板） |
| `utils/context.ts` | ❌ `ContextBuilder.buildCoreContext` **没有朋友圈 awareness section** |
| `apps/Chat.tsx` (2815 行) | ❌ `chat.history` **没有 isHidden 系统消息机制** |

### 0.2 已实现的 trigger 流程（暮色 2026-07-03 拍板）

`utils/momentsAI.ts:321-373`：

```javascript
export async function triggerAIReaction(char, post, settings, apiConfig, ctx, onAIDirectMessage) {
  // 1) 点赞（autoCommentMine 时）
  // 2) AI 评论（generateComment，调 LLM 一次）
  // 3) AI 决定是否主动发聊天消息（generateTriggerDecision，调 LLM 一次）
}
```

`apps/MomentsPage.tsx:204-280`：用户发朋友圈后**立即触发** triggerAIReaction（不等聊天下一轮）。

### 0.3 暮色说的"评论触发了，主动消息也触发了" — 已验证

- ✅ 评论：触发 `triggerAIReaction` 调 LLM 评论 → 写 IndexedDB
- ✅ 主动消息：调 LLM 决定是否发 → `onAIDirectMessage` 回调写进 Chat messages

### 0.4 暮色说的"AI 不知道给评论了" — **真问题**

AI 评论朋友圈时 LLM **当时知道**（因为 prompt 上下文说"用户发了动态，请你评论"），但**评论完之后**，下一次 chat 调 LLM 时：

- `chat.history` 里没有这条事件
- system prompt 里没有朋友圈 awareness
- AI 后续对话**完全不知道**"我刚评论了用户的朋友圈 X"

**这就是暮色反馈的"聊天和朋友圈没有通"的根因。**

---

## 1. 暮色说的"参考 330 中的" — 真正的原型

详见 `notes/muse-330-ui-report.md` §3.2，**330 的解决方案是 2 层叠加**：

### Layer 1：每次 Chat System Prompt 注入朋友圈 awareness

`muse-330-ui/modules/ai-response.js:2599-2673`：

```javascript
const allRecentPosts = await db.qzonePosts.orderBy('timestamp').reverse().limit(5).toArray();
const postsContext = "### 最近的动态列表:\n- (ID: ...) 作者: ..., 内容: ...\n  - 你评论说: ...\n  - 评论: @X: ...\n";
```

然后在 `prompt-manager.js:55` 的 singleChat 模板里 `${postsContext}` 占位符注入。

**效果**：AI 每次 chat 都 awareness 最近 5 条朋友圈 + 自己的评论。

### Layer 2：事件驱动 push hidden system message

`muse-330-ui/modules/qzone.js:528-541`：

```javascript
const historyMessage = {
  role: 'system',
  content: '[系统提示：xxx 在你的动态下评论了 ...]',
  isHidden: true,
  timestamp: Date.now()
};
chat.history.push(historyMessage);  // 给所有非群聊 chat
```

**效果**：刚发生的事件立刻 push 给所有 chat，下次 LLM 调用自动看到。

---

## 2. SullyOS 移植方案 — 暮色没选 A/B/C/D，存档备选

### 方案 A：全套（Layer 1 + Layer 2 + UI + 主动触发朋友圈指令）

**改动**：
1. `utils/context.ts` — `ContextBuilder.buildCoreContext` 加 `### 最近朋友圈动态` section
2. `utils/momentsAI.ts` — `triggerAIReaction` 加 hook，push isHidden system message 到 `chat.history`
3. `apps/Chat.tsx` / `apps/GroupChat.tsx` 等 — 调 `buildCoreContext` 时传最近的 posts 数据
4. `apps/MomentsPage.tsx` — 工具栏相机左边加齿轮入口（详见 §3）
5. system prompt 加"你有朋友圈功能" + Chat 拦截 [发朋友圈] 触发 `aiGeneratePost`

**工作量**：3-4 个 commits，1-2 天

**效果**：AI 知道朋友圈存在，能响应"发朋友圈"指令；每次 chat awareness 最近朋友圈；评论完 push 事件到下一轮

---

### 方案 B：只做 Layer 1（朋友圈 awareness 注入）+ UI

**改动**：
1. `utils/context.ts` — 加 `### 最近朋友圈动态` section（接 posts 数据）
2. 所有 `buildCoreContext` 调用点传 posts 数据
3. UI 改动（齿轮入口）

**工作量**：2 个 commits，半天

**效果**：AI 每次 chat 知道最近朋友圈 + 自己评论过什么；不响应"发朋友圈"指令（AI 仍认为没这个功能）

**暮色当前最可能选这个**（先解决"AI 不知道给评论了"这个具体 bug）

---

### 方案 C：只做 Layer 2（事件 push hidden message）+ UI

**改动**：
1. `utils/momentsAI.ts` — `triggerAIReaction` 末尾加 `chat.history.push({ role: 'system', isHidden: true, ... })`
2. `apps/Chat.tsx` — 拼 messages 时**保留** hidden message（不被 filter 掉）；拼 system prompt 时**单独读** hidden message 拼成段
3. UI 改动

**工作量**：2-3 个 commits，1 天

**效果**：朋友圈事件立刻 push，下一轮 chat awareness；不是每次 chat 都 awareness 最近朋友圈

---

### 方案 D：只做 UI 改动

**改动**：仅齿轮入口迁移到 MomentsPage 顶部

**工作量**：1 个 commit，10 分钟

**效果**：解决"设置入口位置"问题，底层逻辑不动

---

### 推荐路径（麦麦建议）

**先 B（朋友圈 awareness 注入）+ UI**，因为：

1. **暮色当前最痛的点**是"AI 不知道给评论了" — Layer 1 直接命中
2. Layer 1 实现简单（context.ts 加一段，所有 buildCoreContext 调用点传一个参数）
3. UI 改动同时做（暮色明确要的）
4. Layer 2（事件 push）和"主动触发朋友圈"等下一轮再补

**理由**：
- Layer 1 已经覆盖"AI 后续对话 awareness 朋友圈发生过什么"的需求
- Layer 2 是"事件立刻推" — Layer 1 的 5 条最近 post 已经覆盖大部分场景
- 主动触发朋友圈（[发朋友圈] 指令）需要 system prompt 大改 + Chat 拦截逻辑，工作量大且优先级低于"AI 知道朋友圈发生过"

**但是暮色没说选哪个** — 2026-07-04 让我"开个新窗口继续"，所以**新窗口里先问他选哪个，再动手**。

---

## 3. UI 改动方案 — 朋友圈设置入口迁移

### 3.1 现状

**DiscoverPage 列表里**（`apps/DiscoverPage.tsx`）：

```
朋友圈
收藏
日记
⚙ 朋友圈设置   ← 这行要删
```

**MomentsPage 顶部工具栏**（`apps/MomentsPage.tsx:298-314`）：

```
[← 返回]                                [📷 相机]   ← 相机右边加齿轮？
```

### 3.2 暮色原话

> 朋友圈设置放到朋友圈页面，**放相机左边**

意思：MomentsPage 工具栏改为：

```
[← 返回]       [⚙ 设置] [📷 相机]   ← 齿轮在相机左边
```

### 3.3 改动

**`apps/MomentsPage.tsx:298-314`** 改：

```diff
 {/* 顶部工具栏（只留相机） */}
 <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-2 py-2 pointer-events-none">
   <button onClick={onBack} ...>
     <CaretLeft size={20} weight="bold" />
   </button>
+  <button
+    className="w-9 h-9 mr-1 rounded-full bg-black/30 backdrop-blur flex items-center justify-center text-white pointer-events-auto active:scale-95 transition-transform"
+    aria-label="朋友圈设置"
+    onClick={() => setShowSettings(true)}  // ← 新增 state
+  >
+    <Gear size={18} weight="bold" />
+  </button>
   <button className="..." aria-label="发表朋友圈" onClick={() => setShowPublisher(true)}>
     <Camera size={18} weight="bold" />
   </button>
 </div>
```

**注意**：当前工具栏是 `justify-between`（返回在左，相机在最右）。齿轮加在相机**左边**需要：

- 改成 `justify-end gap-2`（齿轮 + 相机都靠右，中间用 gap）
- 或者改成 `flex justify-end` 三个按钮都靠右

**暮色审美偏好**（来自 AGENTS.md）：
- 圆形 button（`rounded-full`），背景 `bg-black/30 backdrop-blur`
- `pointer-events-none` 容器 + `pointer-events-auto` 按钮（保留封面图触觉）

**`apps/DiscoverPage.tsx`**：

```diff
 // 移除齿轮入口（约 line X-X）
- <button onClick={() => setSubPage('moments-settings')}>齿轮 + 朋友圈设置</button>
```

**`apps/MomentsSettingsPage.tsx`**：

```diff
+ // 接受 onBack prop，齿轮入口在 MomentsPage 内点击触发
```

等等，MomentsSettingsPage 已经接受 `onBack` prop（line 18：`const MomentsSettingsPage: React.FC<{ onBack: () => void }>`）。所以从 MomentsPage 跳过去，**onBack 要传"回到 MomentsPage"而不是"回到 DiscoverPage"**。

---

## 4. 改动影响面 — 按 暮色"改底层前先讲影响面"的规矩

### 4.1 UI 改动（齿轮入口迁移）

| 文件 | 改动 |
|---|---|
| `apps/MomentsPage.tsx` | 加齿轮 button + onClick 打开 SettingsPage（用 createPortal 或 state 控制）|
| `apps/DiscoverPage.tsx` | 删齿轮入口（约 5-10 行） |
| `apps/MomentsSettingsPage.tsx` | 可能改 onBack 语义（确认下当前实现） |

**风险**：
- 暮色审美对齐（圆角、按钮背景色、间距）— 已知偏好的，写完自查
- 视觉跳动：齿轮从 DiscoverPage 列表到 MomentsPage 工具栏，暮色可能想看 preview 截图

### 4.2 Layer 1（朋友圈 awareness 注入到 ContextBuilder）

| 文件 | 改动 |
|---|---|
| `utils/context.ts` | `buildCoreContext` 加 `postsContext` 参数 + 拼成 `### 最近朋友圈动态` section |
| `apps/Chat.tsx` (line ?) | 调 `buildCoreContext` 时传 posts |
| `apps/GroupChat.tsx` (line 733) | 调 `buildCoreContext` 时传 posts |
| `apps/JournalApp.tsx` (line 319/427) | 同上 |
| `apps/RoomApp.tsx` (line 427/518) | 同上 |
| `apps/StudyApp.tsx` (line 727/815/1091) | 同上 |
| `apps/pixelHome/MemoryDiveMode.tsx` (line 72) | 同上 |
| `utils/momentsStorage.ts` | 加 helper `getRecentPosts(limit, viewerId)` |

**风险**：
- **聊天页延迟**：每次 chat 调 LLM 前都要读 IndexedDB 拿 posts（async）— 可能加 50-200ms
- **上下文膨胀**：5 条 post + 评论可能加 500-1500 chars
- **跨群角色**：当前 `buildCoreContext` 不知道"哪个角色看哪些 post"（暮色要不要加可见性过滤？）
- **isHidden 过滤**：现有 `chat.history` filter 逻辑（line 600/615/686/2042）要看 hidden message 怎么处理

### 4.3 Layer 2（事件 push hidden system message）

| 文件 | 改动 |
|---|---|
| `utils/momentsAI.ts` | `triggerAIReaction` 末尾 + `publishPostAsChar` 末尾 加 hook push hidden message |
| `apps/Chat.tsx` | 拼 messages 时保留 hidden message 到 system prompt（不被 filter 掉） |

**风险**：
- **重复 push**：triggerAIReaction 1 次 → push 1 条；用户发朋友圈多次 → push 多条（要不要去重？）
- **hidden message 太多**：长期累积，prompt 越来越长（要不要 cap 到最近 N 条？）
- **330 用 isHidden flag 是为了过滤掉** — SullyOS 现在 chat history 没用 isHidden，**移植要重新设计 flag 的语义**

### 4.4 "主动触发朋友圈"功能（[发朋友圈] 指令）

| 文件 | 改动 |
|---|---|
| `utils/chatPrompts.ts` | system prompt 加"你有朋友圈功能" + 触发语法 |
| `apps/Chat.tsx` | 解析 [发朋友圈] 指令 → 调 `aiGeneratePost` → 跳到 MomentsPage |
| `apps/MomentsPage.tsx` | 接受外部传入的 `initialContent` 自动填 |

**风险**：
- 用户对 AI 说"发个朋友圈" → AI 怎么知道是触发指令而不是聊天内容？
- 要不要走 Chat.tsx 的 function calling 机制（暮色之前调研过 orangechat 的工具调用，详见 `changelogs/2026-07-02-orangechat-tool-calling-comparison.md`）

---

## 5. 新 Mavis 窗口接手时的 quick start

**新窗口里按这个顺序跟暮色确认：**

1. **先问选 A / B / C / D 哪个**（方案 §2）— 暮色没拍板，**别直接动**
2. 如果选 B 或 A：先做 **UI 改动**（齿轮入口迁移，§3）— 这个 10 分钟搞定
3. 再做 Layer 1（context.ts 加 awareness section）— 半天
4. Layer 2 / 主动触发朋友圈 等下一轮

**关键文件先读**：

- `utils/context.ts` — `buildCoreContext` 是改的核心
- `utils/momentsAI.ts` — trigger 流程的归宿
- `utils/chatPrompts.ts` — 跟 system prompt 拼装相关，看 Chat.tsx 怎么用
- `apps/Chat.tsx:1712` 附近的 fetch 调用 — 看 messages 怎么拼装（决定 hidden message 怎么注入）
- `notes/muse-330-ui-report.md` §3.2 — 330 的原型（必读）
- `changelogs/2026-07-02-wechat-bug-fixes.md` — Chat 内 chars 面板切角色的坑，避免重踩

**踩坑提醒**（暮色踩过的）：

- **删 useState 必须搜全部 JSX 引用点** — 删 Layer 1 时如果改 context.ts 签名，调用点都要同步改
- **改接口/字段前先讲影响面** — 暮色规矩，**N 个 caller 的改动先讲清楚**
- **build 后看 asset hash 变没变** — Vercel 缓存坑
- **isHidden message 跟现有 filter 的兼容性** — 现有 `chat.history.filter(m => !(hideSystemLogs && m.role === 'system'))` 逻辑会不会吃掉新加的 hidden message？要确认

---

## 6. 待暮色确认的问题

> 新窗口接手时直接问暮色：

1. **选哪个方案**？A / B / C / D？
2. **朋友圈可见性过滤**要不要做？（330 有按 groupId 过滤，SullyOS 当前没有）
3. **isHidden message 累积上限**？（要不要 cap 最近 10 条？）
4. **齿轮入口**用什么 icon？（Gear from phosphor-icons？跟 DiscoverPage 一致）
5. **暮色测试路径**：是先让他 preview 测 UI 改动，再继续底层？还是一次性推上去？