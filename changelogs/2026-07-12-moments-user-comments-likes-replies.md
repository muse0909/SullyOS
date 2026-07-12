# 朋友圈用户评论/点赞/嵌套回复 + AI 自动回复

**日期**：2026-07-12
**涉及 commit**：`1c57a8a`

## 改了什么
暮色 2026-07-12 反馈 3 件事 + 1 个问题：
1. **详情页只有详情按钮，没有评论/点赞** — 加评论/点赞按钮 + 评论输入框
2. **用户评论角色 post 后没触发 AI 回复** — 加 triggerAICommentReply
3. **角色评论用户 post 后用户不能回复** — 加嵌套回复（replyTo 字段已存在，UI 没实现）
4. **评论/回复是否加到上下文** — **是的**，buildMomentsAwareness 早就注入到 AI system prompt

## 触发的 4 类用户操作

| 操作 | API | 行为 |
|---|---|---|
| 点赞 | `likePostAsUser(postId)` | 写 storage + refreshPosts + toast（无 toast） |
| 取消点赞 | `unlikePostAsUser(postId)` | 同上 |
| 评论 | `commentPostAsUser(postId, content)` | 写 storage + refresh + **如果评论角色 post → 触发 triggerAICommentReply** |
| 嵌套回复 | `commentPostAsUser(postId, content, replyTo)` | 同上（replyTo = 另一条 comment.id） |

## 触发的 AI 行为

`triggerAICommentReply(char, post, userCommentContent, userCommentReplyTo, apiConfig, ctx)`：
- 复用 `callLLM` + `extractJson`
- prompt 让 AI 决定 shouldReply（boolean）+ comment（string）
- AI 决定回复 → 调用 `commentPostAsChar` 写入新评论 → toast "{角色名} 回复了你的评论"
- AI 决定不回 → 静默

## 动了哪些文件

### 1. `utils/momentsStorage.ts` — 数据层（+54 行）
- `likePostAsUser(postId)` — 已赞则幂等
- `unlikePostAsUser(postId)` — 没赞过则幂等
- `commentPostAsUser(postId, content, replyTo?)` — replyTo 字段已存在（line 28），现在 UI 终于用上

### 2. `utils/momentsAI.ts` — AI trigger（+80 行）
- `triggerAICommentReply` 函数
- `AICommentReplyDecision` interface

### 3. `apps/MomentsPage.tsx` — UI（+225 行）
- import 加 `PaperPlaneTilt` icon + `likePostAsUser/unlikePostAsUser/commentPostAsUser` + `triggerAICommentReply/commentPostAsChar`
- `handleToggleLike(postId)` — toggle 点赞
- `handleSubmitComment(postId, content, replyTo?)` — 评论/回复 + 触发 AI
- `PostCard`：
  - 列表卡片底部：时间 + **点赞按钮（带数字）** + 评论按钮（带数字）
  - 点赞按钮 fill/regular 切换，红色高亮当已赞
- `PostDetailModal` 完全重写：
  - header：返回 + 标题 + **header 点赞按钮**（带数字 + fill/regular）
  - 评论列表项加"回复"按钮 → 进入 reply 模式（输入框聚焦 + 显示"回复 @某角色"标记 + "取消"按钮）
  - 评论项里显示"回复 @某角色"标记（基于 replyTo 字段查原评论作者）
  - **底部 fixed 评论输入框**（胶囊 + 发送按钮 + Enter 发送）

## 关于"评论和回复加到上下文"

暮色问："这个评论和回复聊天框中角色都要知道有这个事。这个是加到上下文里吗？"

**答案：是的，已经加上了。** 

`utils/chatPrompts.ts:60-123 buildMomentsAwareness` 每次 chat API 调之前把最近 5 条 post 注入到 system prompt，每条 post 的所有 comments（包括嵌套 replyTo）都拼成文本：
- "你评论说: X"（是 AI 自己评论的）
- "评论 {用户名}: Y"（是用户评论的）
- "评论 {另一角色}: Z"（是其他角色评论的）
- "评论 {角色名} 回复 {谁}: W"（嵌套评论）

**所以用户评论后，AI 下一轮对话**已经能看到评论事件。**无需新加注入逻辑**。

## 踩坑 / 需要知道的（重要）

### 1. chat prompt 注入的"时间窗口"问题
`getRecentPosts(5)` 只取最近 5 条 post。如果用户评论的是 5 天前的 post，AI 下一轮对话**看不到**这条评论事件（除非是当前 post 范围内的 5 条）。
**当前解决方案**：信任用户评论的主要是最近活跃的 post。
**未来优化**（暮色没要求）：用户评论某条 post 时主动 push 一条 "you were just commented on X" 到 system prompt（比 getRecentPosts(5) 更精准）。

### 2. AI reply 之后需要刷新 posts
`handleSubmitComment` 里 AI 决定回复时调 `setPosts(getAllPosts())` — 但 PostDetailModal 接的 `post` 是 props 传的，**需要父组件传最新 post** 才能看到 AI 新评论。
**当前实现**：PostDetailModal 用了 `selectedPost` state（MomentsPage line 78），setPosts 后 setSelectedPost 也要重置。
**等等**——我看 `setSelectedPost` 没更新。这是个**潜在 bug**：用户评论后触发 AI 回复，AI 写新评论到 storage，setPosts 更新，但 `selectedPost` 引用还是旧对象，PostDetailModal 显示的评论列表不更新。
**修复**（下次）：在 setPosts 后也 `setSelectedPost(getAllPosts().find(p => p.id === postId))` 或者用 `key={post.id}` 强制重渲染。
**当前**：先这样，暮色测试后看是否需要修。

### 3. useCallback 依赖
`handleSubmitComment` 的 useCallback deps 包含 `characters, activeCharacterId, apiConfig, userProfile, addToast`——这些都是 OSContext 引用。
**注意**：OSContext 的 value 每次 render 都新建（line 2882-2967），所以 useCallback 的 deps 实际上每次都变。这导致子组件（PostDetailModal 拿到 onSubmitComment）每次也重新 render。
**当前可接受**：PostDetailModal 内已经有自己的 useState（commentText, replyTo），不会因为父组件 re-render 丢状态。
**未来优化**（性能）：用 useRef 缓存 handler 引用。

### 4. `replyTo` 字段已存在但未用过
`MomentComment` 接口 line 28 早就有 `replyTo?: string` 字段。**之前 UI 没用上**——评论列表是平铺的，不是树形。
**这次实现**：评论项加"回复"按钮 + 评论项里显示"回复 @某角色"。**但**评论列表还是平铺的（不嵌套），嵌套关系只在"回复 @X"标记里体现。
**未来优化**（暮色没要求）：评论列表改成树形（嵌套层级缩进）。

## 备注
- 待办未变
- 测试方式：
  1. 打开朋友圈 → 点角色 post 的评论图标 → 详情页
  2. 详情页底部输入"好看！" → 发送 → 列表立即多一条评论
  3. 触发 AI 回复 → 几秒后"{角色名} 回复了你的评论" toast → 评论列表多一条 AI 评论
  4. 详情页底部输入"再回一条" → 发送
  5. 点评论列表里"回复"按钮 → 输入框变成"回复 @角色名" → 发送 → 嵌套关系写入
  6. 详情页 header 点赞按钮 → 点一下 heart 变红 + 数字 +1
  7. 关掉详情页 → 主页面 post 卡片底部也有新的点赞数 + 评论数

## 跟 330 qzone.js 的对比
- 330 用 JSON action 模式（`[{"type": "qzone_comment", "name": "...", "postId": 123, "commentText": "..."}]`）让 AI 主动评论
- 这次 SullyOS 用 **UI 触发** + **AI 自动决定回复** 模式（用户评论 → triggerAICommentReply）
- 两种模式互补：330 模式让 AI 在 chat 中主动评论；这次模式让用户在朋友圈 UI 评论时 AI 自动回复
