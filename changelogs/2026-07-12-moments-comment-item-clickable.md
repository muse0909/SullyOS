# 主页评论项可点击 → 弹输入框（嵌套回复 replyTo）

**日期**：2026-07-12
**涉及 commit**：`798b7c9`

## 改了什么
暮色 2026-07-12 反馈："用户回复角色评论这个点不了。这个改成用户点角色评论就弹出输入框可以回复。"

## 根因
之前 PostCard 主页评论列表只显示评论文字（line 838-845）——**没有"回复"按钮**。详情页 PostDetailModal 才有"回复"按钮（line 985-989），但暮色没注意到。

暮色在主页（看截图就是主页）看到江澈的评论想回复，但**没入口**。

## 改动
- PostCard 加 `replyTarget: {id, name} | null` state
- `openComment(target?)` 接受可选 reply target 参数
- 评论项从 `<div>` 改成 `<button onClick>`：
  - 触发 `handleCommentItemClick({id, authorType, charId})` → 调 `openComment({id, name})`
  - 视觉：hover bg-slate-100 + active bg-slate-200/60 + 圆角 + cursor pointer
  - 不影响其他 post 数据（长按、点赞按钮独立）
- 输入框：
  - 有 replyTarget 时上方显示"回复 @某角色"标记 + "取消回复"按钮
  - placeholder 改成"回复 @某角色"
  - 发送时传 `replyTarget.id`（→ commentPostAsUser 的 replyTo 字段）
- 长按 post 内容进详情（已有）不变

## 主页 vs 详情页

| 入口 | 主页 PostCard | 详情页 PostDetailModal |
|---|---|---|
| 列表底部 💬 按钮 | ✓ 弹输入框（无 replyTo） | N/A（详情页有自己的输入框） |
| 评论项点击 | **新增** 弹输入框（带 replyTo） | 详情页"回复"按钮也带 replyTo |
| 视觉提示 | 整条评论项 hover 高亮 | 评论项旁边文字"回复"按钮 |

## 踩坑 / 需要知道的（重要）

### 1. 评论项改成 `<button>` 可能影响点击事件冒泡
评论项现在是 `<button>`，包在 PostCard 的 `<div className="flex gap-3 p-3 ...">` 里。
- 评论项 onClick 不会触发 PostCard 的 onClick（PostCard 长按 onClick 是绑在 post 内容 div 上，不是 PostCard 外层）
- 评论项 onClick 不会触发长按的 onPointerDown（绑定位置不同）
- 不会触发表情、点赞按钮（独立 button，事件 stopPropagation 默认行为）
**安全**。

### 2. 评论项的 hover 高亮
之前评论是普通 `<div>`，没 hover 反馈。改成 `<button>` 后加了 hover bg-slate-100 + active bg-slate-200/60——让用户知道"这能点"。
**视觉**：post 内容底色是白，评论列表底色是 slate-50，hover 时评论项变 slate-100，active 时 slate-200/60——对比度够。

### 3. 主页只显示前 2 条评论（已有逻辑）
`post.comments.slice(0, 2)` 限制——其他评论要进详情页才能看到。
**当前可接受**：暮色截图里江澈的评论就在前 2 条之内。
**未来优化**（暮色没要求）：主页显示全部评论 + 嵌套缩进。

## 备注
- 待办未变
- 测试方式：
  1. 主页看到江澈的评论"图像数据分析完毕..."
  2. 点这条评论 → 输入框在 PostCard 卡片内出现 + 显示"回复 @江澈"标记 + 键盘弹起
  3. 输入"我的数据呢" → 发送 → 嵌套评论写入（replyTo = 原评论 id）
  4. 详情页看到嵌套关系："暮色 回复 江澈：我的数据呢"
  5. 再次点同一条评论 → 再次弹输入框（replyTo 还是同一条评论）
  6. 点"取消回复"按钮 → 输入框回到无 replyTo 状态
