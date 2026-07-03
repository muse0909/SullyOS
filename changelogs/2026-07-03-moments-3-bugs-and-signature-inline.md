# 朋友圈 4 个 bug 修复 + 签名 inline 编辑

**日期**：2026-07-03
**涉及 commit**：（本次即将创建）

## 改了什么

### Bug A：React error #31 + 右上角 `[object Object]`（最严重）
- 表面：暮色截屏右上角渲染了 `[object Object]`，整个 React 树报 #31 "Objects are not valid as a React child"
- React error #31 的 object 是 SyntheticEvent（带 _reactName/nativeEvent/target/currentTarget/clientX 等 keys）
- **根因排查**：找不到 1 个直接渲染 object 的 JSX 点（grep 了 30+ 文件）。最可能是 console.error hook 接到 React 内部抛错，args 里包含 SyntheticEvent，写入 systemLogs → StatusBar SYSTEM ERROR 按钮
- **修复（防御性）**：`addToast(message, type?, duration?)` 内部加 `String(message)` 防御 + **支持第 3 个参数 duration**（暮色代码传 2000/3000 之前被静默忽略，toast 都按 3 秒才消失，视觉上"挂着"）
- `id` 也加了 random suffix（防止同一毫秒多次调用 id 冲突）

### Bug B：点赞只显示 "1 人赞过" 不显示角色名
- 表面：PostCard / PostDetailModal 渲染 `{post.likes.length} 人赞过`，没显示具体谁赞的
- 暮色要 "X 赞了你的朋友圈" 在 PostCard 列表也看到
- **修复**：改成 `.map((l) => l.authorType === 'user' ? userProfile.name : characters.find(c => c.id === l.charId)?.name).join('、')`
- 例：`Sully、暮色`（如果用户自己也点了赞）

### Bug C：签名点进去要全屏编辑器（暮色要 inline 编辑）
- 表面：暮色点签名弹全屏编辑器
- 暮色要：**点签名直接变 input 框**，blur / Enter 保存，Esc 取消
- **修复**：签名 button 改成 input（编辑模式）+ button（显示模式）切换
  - 编辑模式：autoFocus + value/onChange + onBlur 保存 + Enter 保存 + Esc 取消
  - 显示模式：button + 点击切换到编辑模式
- 删 FullScreenEditor import（不再用）

### Bug D：trigger 跑了一半（点赞成功但评论失败）
- 表面：暮色发朋友圈后只收到 1 个点赞 toast，没评论 toast
- 根因：`generateComment` / `generateTriggerDecision` 调 LLM API 失败
- trigger 内部有 try/catch，单个失败不影响其他步骤
- result.liked=true → "赞了你的朋友圈" toast 触发
- result.comment=undefined → "评论了你的朋友圈" toast 不触发（条件判断）
- **这不是代码 bug**，是 LLM API（中转站）问题
- 修不了，等暮色测时再观察 API 状态

## 动了哪些文件
- `context/OSContext.tsx` — `addToast` 加 String() 防御 + duration 参数
- `apps/MomentsPage.tsx` — PostCard / PostDetailModal 点赞显示角色名 + 签名 inline 编辑

## 踩坑 / 需要知道的（重要）
- **toast 一直挂着** 实际上不是 bug，是 addToast 第 3 个参数被忽略 → 全部按 3 秒消失。暮色在 3 秒内连续发多条 → 多个 toast 叠加
- **React error #31 + [object Object]** 找不到精确的 1 个渲染点。可能是 console.error 间接触发 → systemLogs → SYSTEM ERROR 按钮
- **防御性 String() 包装**是兜底 — 下次任何 addToast 调用方传了 object，至少不会炸 React
- **签名 inline 编辑**：input autoFocus + onBlur 保存有个小坑 — 如果用户从 input 点外部（比如点相机），会触发 onBlur 自动保存。暮色可能想"点外部不保存"，但这跟"不点保存按钮"是同样行为。如果暮色不喜欢再说

## 备注
- 暮色要的"评论增加 NPC 互动"是新功能，等他想清楚怎么交互再开
- 暮色 2026-07-03 看到"2 个已发表 toast 一直挂着 + [object Object]" 的根本原因：
  1. addToast 第 3 个参数被忽略 → 2 个 toast 都按 3 秒
  2. 暮色 3 秒内发了多条朋友圈 → 多个 toast 视觉上叠加
  3. [object Object] 可能来自 console.error hook 抓 React 内部抛错
