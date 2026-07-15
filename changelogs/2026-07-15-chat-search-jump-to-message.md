# 聊天记录搜索 → 跳转定位

**日期**：2026-07-15
**涉及 commit**：`fb32f83`

## 改了什么

聊天页搜索抽屉点结果 → 跳到那条消息位置 + 2 秒琥珀色高亮。

**用户视角**：
- 打开搜索抽屉（聊天页右上角放大镜）输入关键词
- 看到结果列表，每条结果卡片**整张可点**
- 点一下：抽屉关闭、聊天页面滚到那条消息、消息背景闪一下琥珀色（2 秒自动消失）
- 长消息点展开按钮（卡片底部的 ↕）= 展开/收起，不触发跳转（按钮 stopPropagation 隔开了）

**复用原则**：
- 收藏页"定位到聊天"早就有 `jumpToMessage` + `pendingHighlightMessageIdRef` + `scrollIntoView` + 琥珀色 CSS 高亮这一整套机制（`apps/Chat.tsx:38-91`）
- **不重写 scroll 逻辑**，新加一条"Chat 已在前台时"的快捷路径：只设 highlight ref + counter，不切角色/不切 app

## 动了哪些文件

- `context/OSContext.tsx` —— 新增 `requestHighlightMessage(messageId)` + `highlightRequestId` counter state + interface 字段
- `apps/Chat.tsx` —— 从 `useOS` 多拿两个值；consume effect deps 从 `[activeCharacterId]` 扩到 `[activeCharacterId, highlightRequestId]`；给 Drawer 注入 `onJumpToMessage` 回调（关 drawer + 触发 highlight）
- `components/chat/ChatSearchDrawer.tsx` —— props 加 `onJumpToMessage?: (messageId: string) => void`；整张结果卡片可点跳转（`cursor-pointer` + `active:scale-[0.99]` + 键盘 `role="button"`/`Enter`/`Space` 支持）；展开按钮 `e.stopPropagation()` 防误触

## 踩坑 / 需要知道的（重要）

### 1. 为什么不直接复用 `jumpToMessage`

`jumpToMessage` 会**同时** `setActiveCharacterId` + `setActiveApp(AppID.Chat)`。在搜索抽屉场景里：
- 用户**已经在 Chat 页** + 当前角色
- 调 jumpToMessage 会触发 `setActiveCharacterId` 重新跑 consume effect（依赖该值）
- 还会 `setActiveApp(Chat)`，虽然值不变但走一遍 React reconciliation

所以另开 `requestHighlightMessage`：只设 `pendingHighlightMessageIdRef` + 自增 `highlightRequestId` counter，Chat 用 useEffect 监听 counter 重新跑 consume。**同角色场景零副作用**。

### 2. Chat 消费 effect 的 deps 改了

原代码（`apps/Chat.tsx:43`）：
```ts
useEffect(() => { ... }, [activeCharacterId]);
```
改成：
```ts
useEffect(() => { ... }, [activeCharacterId, highlightRequestId]);
```

**风险**：`activeCharacterId` 变 + `highlightRequestId` 变 会在同一次 render 触发两次 effect？不，React 会**合并 deps 变化到一次 effect 执行**。安全。

**新行为**：当用户在 Chat 页点搜索结果 → `highlightRequestId++` → consume effect 重跑 → 重新调 `consumePendingHighlightMessageId()` 拿到新值 → setHighlightMessageId → 2 秒后清高亮 + scrollIntoView。

### 3. 老消息可能滚不到（已知问题，未修）

`apps/Chat.tsx` 聊天列表有 `visibleCount`（默认 30）只渲染最近 30 条。scrollIntoView 找 `[data-message-id=...]` 找不到时**最多 retry 3 次**（900ms），再找不到就放弃。

**如果目标消息在 30 条之外**（用户翻很久才到的旧消息），跳转可能无效。

**临时方案**：用户可以**先向上滚**聊天列表触发 `loadMore` 加载更多消息（Chat.tsx 已有"加载更多"机制），再点搜索结果。

**长期方案**（未做）：Chat 端收到 highlight request 时，先**主动扩大 visibleCount 直到包含该 messageId**，再 scrollIntoView。需要改 visibleCount 逻辑，影响面较大，独立 issue 处理。

### 4. 卡片可点的 a11y 处理

整张卡片可点 = 给 `role="button"` + `tabIndex={0}` + `onKeyDown`（Enter/Space 触发）。键盘用户和读屏用户都能用。

`onJumpToMessage` 未传时（防御性）所有可点击属性都不加，卡片降级为普通展示。

## 备注

- commit `fb32f83` 已 push 到 `origin/preview`，Vercel 自动部署
- 测试场景：当前角色 + 当前 Chat 页 + 目标消息在最近 30 条内 → 应完美工作
- 失败场景：目标消息在第 30 条之外 → 见"踩坑 #3"
- 没改：jumpToMessage 本身、scrollIntoView 实现、高亮 CSS 样式 — 全部复用
- 跨应用没动：`highlightMessageId` 仍是 string 类型（从 `m.id` 显式 `String()` 转换）
