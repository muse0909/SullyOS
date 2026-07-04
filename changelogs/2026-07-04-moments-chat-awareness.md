# 朋友圈 ↔ Chat Awareness 互通（Layer 1）+ 设置入口迁移

**日期**：2026-07-04
**涉及 commit**：`5792133`

## 改了什么

暮色 2026-07-04 反馈："评论触发了，主动消息也触发了。但是ai并不知道给我评论了。"

**根因**：之前 `ChatPrompts.buildSystemPrompt` 拼 system prompt 时完全没有朋友圈 awareness。trigger 流程（`utils/momentsAI.ts:triggerAIReaction`）调 LLM 评论时 prompt 上下文说"用户发了动态，请你评论"，AI 当时知道；但**评论完之后**，下一轮 chat 调 LLM 时 `chat.history` 没有这条事件，system prompt 也没有朋友圈 awareness → AI 完全不知道"我刚评论了用户的朋友圈 X"。

按暮色指示"参考 330 中的，提示词也可以照搬"，扒 muse-330-ui `modules/ai-response.js:2599-2673` 的 postsContext 模式补回：

### 功能改动

| 文件 | 改动 |
|---|---|
| `utils/momentsStorage.ts` | 新增 `getRecentPosts(limit=5)` helper，按 createdAt desc 排序 |
| `utils/chatPrompts.ts` | 新增 `buildMomentsAwareness(char, user, posts)` 拼接 "### 最近朋友圈动态" section；`buildSystemPrompt` 并发拉 5 条 posts 拼到 systemPrompt（实时信息后、日程前） |
| `apps/MomentsPage.tsx` | 顶部工具栏相机**左边**加齿轮按钮（暮色原话："放相机左边"）；新增 `showSettings` state；齿轮触发渲染 `MomentsSettingsPage` |
| `apps/DiscoverPage.tsx` | 删齿轮入口（原 header 右上角），保留占位 div 维持 header 三栏对齐；删 Gear import |

### 文档改动

| 文件 | 作用 |
|---|---|
| `notes/muse-330-ui-report.md` | 桌面 muse-330-ui 调研 — 暮色说的 "330" 是这个文件夹不是 SullyOS upstream |
| `notes/wechat-contacts-page-status.md` | 联系人页改造进度 — Step 1 框架壳完成 / 右上齿轮未绑 / Step 2+ wishlist |
| `notes/moments-chat-integration-plan.md` | 朋友圈互通方案 A/B/C/D + UI 改动 + 影响面分析 |

## postsContext 拼接规则

参考 330 `ai-response.js:2599-2673`：

- 自己发的：`{char.name} (你)`
- 用户发的：`{user.name}`
- 其他角色发的：`另一位角色 (id: {charId})` —— 当前 chat 视角下没名字 lookup，标 id，暮色后期可补
- 自己评论的：`你评论说: "..."`
- 别人评论：`评论 {名字}: "..."`
- 点赞：`点赞: {名字列表}`

content 评论截断：post 50 字、comment 80 字。

末尾加引导语："你已经看到这些朋友圈动态了；如果它们跟当前聊天话题相关，可以自然地提及或回应；如果不相关，就当背景信息，不要硬扯进来。"

## 踩坑 / 需要知道的

### 1. 不污染 `buildCoreContext` 的同步签名

`utils/context.ts` 的 `ContextBuilder.buildCoreContext` 是**同步**的（line 110-275 纯 string concat）。如果加异步 posts 读取，所有调用点（Chat / GroupChat / JournalApp / RoomApp / StudyApp / MemoryDiveMode）都得改。

**解决方案**：在 `ChatPrompts.buildSystemPrompt` 里**单独拼**朋友圈 section，不动 buildCoreContext。这样：
- Chat.tsx 走 ChatPrompts → 自动生效（暮色当前主诉场景）
- 其他 app 走 buildCoreContext → 暂不生效（它们是日记/见面/学习等场景，朋友圈 awareness 优先级低）

未来如果要扩散到其他 app，照搬 buildMomentsAwareness 到对应 buildXxxContext 即可。

### 2. 朋友圈数据放 localStorage（同步读）

`getRecentPosts` 走 `getAllPosts` 从 `localStorage.getItem('sullyos_moments_posts_v1')` 读，**同步**，0 延迟。不需要 IndexedDB 不需要异步包装（用 `Promise.resolve().then(() => ...)` 是为了放进 `Promise.all` 的并发数组，行为等价同步）。

### 3. 工具栏按钮组用 `flex gap-1.5 pointer-events-auto`

暮色要求"放相机左边"——改成按钮组：
```tsx
<div className="flex items-center gap-1.5 pointer-events-auto">
  <button ... Gear />
  <button ... Camera />
</div>
```
注意外层容器是 `pointer-events-none`（让封面图触觉穿透），按钮组本身要 `pointer-events-auto` 才能点击。

### 4. DiscoverPage 删齿轮后保留占位 div

```tsx
<div className="w-9 h-9" aria-hidden />
```
保持 header 三栏布局对称（按钮-标题-占位），不然标题会左偏。`aria-hidden` 让屏幕阅读器忽略这个空 div。

### 5. asset hash 验证

`npm run build` 后 `dist/assets/index-*.js` hash 从之前变成 `index-jkqdoxHw.js`，**hash 变了 = runtime 确实变了 = 修复有效**（暮色之前踩过"只加 prop 到 interface、没加到 destructure → asset hash 不变 → 部署后用户看不到效果"的坑）。

## 备注

### 暮色可能想问的

- **为什么不直接 push hidden system message 到 chat.history**（330 Layer 2）？
  - Layer 1 已经覆盖"AI 后续对话 awareness 朋友圈发生过什么"，因为 triggerAIReaction 写的 post（含 AI 评论）就在最近 5 条里
  - Layer 2 是"事件立刻推"——更精细，但有"重复 push"和"累积上限"问题（参考 notes §4.3）
  - 暮色没明确要求，**先做最小方案**

- **其他角色发的 post 怎么显示名字**？
  - 当前显示 `另一位角色 (id: xxx)`——SullyOS 的 MomentPost 没存 charName，要查需要拉 characters 列表
  - chatPrompts.ts 没 characters 参数（避免影响签名），简单方案是显示 id
  - 暮色要补的话可以传 characters 参数或修改 MomentPost 加 charName 字段

### 未做（暮色未明确要求，等下一轮）

- Layer 2 事件 push hidden system message
- 主动触发朋友圈 [发朋友圈] 指令（AI 能响应"发朋友圈"）
- 朋友圈可见性过滤（330 有 groupId / visibleTo）
- 联系人页右上齿轮按钮绑 onClick（WeChat.tsx:127-134 还没绑）
- 联系人页"我" tab 的 UserApp 适配（详见 notes/wechat-contacts-page-status.md）

### 其他 AI 留下的 changelog 还没 commit

`changelogs/2026-07-02-comfyui-local-deploy-and-openai-bridge.md` / `orangechat-tool-calling-comparison.md` / `pony-v6xl-deploy-and-mps-nan.md` 是 2026-07-02 同步 master 跳过的 3 个 docs（按暮色当时指示"生图相关的不要动"）。功能 commit 在 preview 上，但 docs 没 commit。**当前 commit 也没管它们**，等暮色明确决定再处理。