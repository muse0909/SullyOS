# 列表卡片 in-page 评论输入框 + 长按进详情（仿微信）

**日期**：2026-07-12
**涉及 commit**：`933264e`

## 改了什么
暮色 2026-07-12 要求：
1. 列表卡片评论按钮（💬）改成"点一下浮出输入框"——仿微信朋友圈
2. 长按朋友圈内容进入详情页

## 1. in-page 评论输入框

**触发**：点 PostCard 右下角 💬 按钮
**实现**：
- PostCard 加 `commenting/commentDraft` state + `commentInputRef`
- onClick → `setCommenting(true)` + setTimeout focus（等 DOM 渲染）
- 输入框 inline 渲染在 PostCard 卡片内（**不是** fixed bottom）
- placeholder "评论 {作者名}..."
- Enter 发送 / Escape 关闭
- onBlur 时**空内容**自动关闭（避免误关）
- 发送后 `setCommenting(false) + setCommentDraft('')` + 触发 `onSubmitComment`

**为什么 inline（不是 fixed bottom）**：
- 暮色原话："上面出现个输入框"——"上面"暗示在 post 上方（卡片内）
- 每个 PostCard 独立，状态简单
- 不用管键盘弹起定位（iOS WebView 的 fixed + keyboard 是已知坑，参考 AGENTS.md 5.5）
- 暮色测试后如果想 fixed bottom 跟我说，10 行代码改完

## 2. 长按 500ms 进详情

**替代**之前的"短按 onClick 进详情"——避免点按冲突

**实现**：
- `longPressTimerRef` + `longPressTriggeredRef`
- `onPointerDown` 启动 timer（500ms）
- `onPointerUp/Leave/Cancel` 清掉 timer
- 500ms 后 setRef=true + 触发 onOpenDetail
- `onClick` 检查 ref=true 不再触发 onOpenDetail

**短按 vs 长按行为**：
- 短按：onPointerDown 启动 timer → onPointerUp 清掉 → onClick 触发 ✓
- 长按：onPointerDown 启动 timer → 500ms 后 timer 触发 onOpenDetail + ref=true + timer=null → onPointerUp 不动 → onClick 检查 ref=true 跳过 ✓

**为什么不用 touchstart/touchend**：pointer events 兼容鼠标 + 触屏，单一 API 更稳。

## 踩坑 / 需要知道的（重要）

### 1. onBlur 自动关闭的 100ms 延迟
```ts
onBlur={() => {
  if (!commentDraft.trim()) {
    setTimeout(() => closeComment(), 100);  // ← 100ms 延迟
  }
}}
```
**为什么延迟**：避免"点取消/发送"按钮时按钮 onClick 触发时输入框已经 unmount 的竞态。
**副作用**：用户输入完直接点别处（点别 post 的 💬）可能短暂看到两个输入框（current 关、new 开）——100ms 后就只剩新的。
**接受**：测试没看到明显闪烁，可接受。

### 2. 长按不响应 click
之前 PostCard 的 post 内容是 `<button onClick={onOpenDetail}>` 短按进详情。现在改成 `<div onClick + onPointerDown>` 长按 500ms 进详情。
**含义变了**：短按**不**进详情了，必须长按。**这是暮色明确要求的**。
**可能影响**：用户习惯短按进详情的会不适应——暮色测试看。

### 3. 输入框焦点 + 键盘
`setTimeout(() => inputRef.current?.focus(), 50)`：50ms 等 React 渲染完 input DOM。
**Android Chrome WebView**：focus() 会自动弹键盘（autofocus 行为）。
**iOS Safari WebView**：可能不弹，需要 click 触发——但我们是从 💬 onClick 触发的，focus() 紧接着 click 事件应该 ok。
**当前可接受**：暮色测试看。

## 跟微信朋友圈的真实差异

| 微信 | SullyOS 这次 |
|---|---|
| 输入框 fixed bottom | in-page（卡片内） |
| 键盘弹起时输入框跟键盘一起上 | 输入框位置不变，浏览器自动 scroll |
| 点空白处关闭输入框 | 失焦且空内容时关 |
| 长按 post 进详情 | 长按 post 进详情 ✓ |

**主要差异**是输入框位置——**暮色测试后看要不要改成 fixed bottom**。

## 备注
- 待办未变
- 测试方式：
  1. 点 post 卡片右下角 💬 → 输入框在该 post 下方出现 + 自动 focus + 键盘弹起
  2. 输入"好看！" → Enter 发送 → 输入框关闭 + 评论列表多一条
  3. 长按 post 内容（500ms）→ 进 PostDetailModal
  4. 短按 post 内容 → 不会进详情（长按才进）
  5. 点 💬 打开输入框后点其他 post 的 💬 → 前一个输入框关闭 + 新的打开（state 隔离）
