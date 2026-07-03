# 朋友圈 trigger 流程修正 + 签名点击修复

**日期**：2026-07-03
**涉及 commit**：(本次)

## 改了什么

### 1. Trigger 流程：发完朋友圈立即触发（不是等聊天下一轮）—— 暮色 2026-07-03 修正
暮色反馈"toast 弹'已通知 AI'但没有收到评论和点赞"——根因是我之前的实现**错了**：

**之前**（错的）：
- 用户发朋友圈 → push notify queue
- 等用户在 Chat 里**再发一条消息触发 AI 回复** → 消费 queue → 跑 trigger
- 如果用户**只发朋友圈不聊** → queue 一直挂着，AI 不反应 ❌

**现在**（对的）：
- 用户发朋友圈 → **立即**调 `triggerAIReaction`（1 次 API，fire-and-forget）
- 不依赖 Chat 页面是否打开
- 不依赖用户是否继续聊天

### 2. Trigger 流程改用 CustomEvent 解耦
暮色要的"AI 决定要不要主动发消息"——AI 发的消息**写进 IndexedDB**（持久化，下次进 Chat 也能看到）+ **`window.dispatchEvent('sullyos:direct-ai-message')`** 通知 Chat（如果在 mount）

Chat 内 useEffect 监听事件 → 立即 `setMessages` prepend → 用户立刻看到主动消息

**为什么用 CustomEvent 而不是 notify queue**：
- queue 走 `isTyping` 钩子 → 必须 Chat 在 + 必须聊天触发
- event 走 window 广播 → Chat 在就能收到，**不在也没事**（DB 里有，下次进 Chat 也能看到）
- event 跟 `isTyping` 钩子解耦，不会卡聊天

### 3. 简化 trigger 决策 prompt
暮色 2026-07-03 反馈"提醒一次就够了，prompt 不用再限制 0/1 条"：
- 删掉"只能发 0 或 1 条消息"那段铁律
- 改成简单的"不要每次都主动发（看情况决定）"

**为什么 OK**：每条朋友圈只 push 一次、只触发 1 次 API，**流程本身已经保证了一次**，prompt 不需要再限制。

### 4. 签名点击修复
暮色反馈"签名还是没办法编辑，我手机上也试过了"：
- **之前**：`<div onClick>` + `tabIndex=0` + 键盘 onKeyDown
- **现在**：`<button type="button">` + `touchAction: manipulation` + `relative z-10`

**为什么 div onClick 不稳**：
- iOS Safari 对 `<div onClick>` 在某些嵌套 absolute + 滚动容器场景下不响应
- `<button>` 是 iOS/Android 通用的可点击元素，**触摸响应有保证**
- `touchAction: manipulation` 阻止双击缩放延迟 + 避免误触滚动
- `relative z-10` 保险：防止被绝对定位的工具栏/封面图元素意外覆盖

### 5. 删 Chat 里的 notify queue 消费钩子
之前 Chat.tsx 里有个 useEffect 监听 `isTyping` 消费 notify queue，**现在 trigger 流程不依赖 queue**了，删掉这个 effect。

Chat 里**只剩**：
- AI 自动发朋友圈钩子（一轮对话完后跑，跟 trigger 流程无关）
- CustomEvent 监听（主动消息直接 prepend）

## 动了哪些文件
- `utils/momentsAI.ts`：
  - 新增 `triggerAIReaction()` 封装完整 trigger 流程（点赞 + 评论 + 决定主动发消息）
  - `generateTriggerDecision` prompt 去掉"0/1 条"铁律
- `apps/MomentsPage.tsx`：
  - `handlePublish` 末尾立即调 `triggerAIReaction`（不通过 queue）
  - 主动消息回调：`DB.saveMessage` + `dispatchEvent('sullyos:direct-ai-message')` + toast
  - 签名点击：`<div onClick>` → `<button>` + `touchAction: manipulation` + `relative z-10`
- `apps/Chat.tsx`：
  - 删 notify queue 消费 useEffect（queue 不用了）
  - 删 queue 相关 import
  - 新增 CustomEvent 监听 useEffect
- `utils/momentsStorage.ts`：没动（queue 函数保留无害，但已无 caller）

## 踩坑 / 需要知道的
- **暮色的"提醒一次"机制不是 prompt 限制，是流程保证**：每条朋友圈走一次 `handlePublish` → 走一次 `triggerAIReaction` → 完事。**不是 LLM 自律**，是代码流程控制
- **CustomEvent 跨 tab 不工作**：只在同一 tab 有效。SullyOS 是单 tab 跑（Capacitor WebView + PWA），没问题
- **AI 主动消息的 metadata 标记** `{source: 'moments_trigger'}`：方便后续追踪，**未来要加"这条是 AI 主动发的"视觉提示时可以用**
- **Chat 不在时 trigger 仍然能跑**：因为 `triggerAIReaction` 在 MomentsPage 内调，**不依赖 Chat mount 状态**。但 AI 主动消息只能在 DB 看到（用户下次进 Chat 才看到）。**这是符合暮色预期的**（"AI 决定要不要主动发消息" → AI 发了 → 用户下次看到）
- **签名 `<button>` vs `<div>`**：未来所有可点击的非导航区域**统一用 `<button>`**，iOS/Android 都稳（参考这个坑）
- **删 queue 函数没连带删**：保留 `pushNotifyQueue` / `popNotifyQueue` / `getNotifyQueue` / `clearNotifyQueue` / `MomentNotifyItem` 接口。**没有 caller 了**，等下一轮清理时一起删

## 备注
- 测试流程：
  1. 朋友圈设置 → 确认"发完通知 AI"开着
  2. 朋友圈发一条（**不要发完就跑**，等一下）
  3. 几秒内应该弹 toast "已通知 AI" + "X 评论了你的朋友圈" + "X 赞了你的朋友圈"（顺序：已通知 AI → 触发 API → 完成后弹评论/赞）
  4. 决定主动发消息时弹 "X 主动发来了一条消息"
  5. 签名点击：点签名行（不光是字）→ 弹全屏编辑器
- 老用户在 queue 残留怎么办：没影响，queue 函数保留但 Chat 不消费了
- **下一轮可以做的清理**：
  - 删 momentsStorage.ts 的 notify queue 函数（无 caller）
  - 加"AI 主动发的消息"视觉提示（用 metadata.source 判断）
  - 加生图实际调用（按暮色 2026-07-03 暂放）
