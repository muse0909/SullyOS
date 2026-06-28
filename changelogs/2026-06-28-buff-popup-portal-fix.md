# 心声弹窗贴顶修复（createPortal）

**日期**：2026-06-28
**涉及 commit**：见下方

## 问题
暮色在 Android Chrome 上点心声 chip → 弹窗"卡在顶上"，心声卡片从 ChatHeader 下方一条一条往下铺，没有居中卡片、没有标题"Sully·心声"、看不到背景遮罩。iOS Safari / macOS Safari 表现正常。

## 根因
**CSS 规范**：`backdrop-filter` 会成为 `position: fixed` 元素的 containing block（跟 `transform` 等价）。

- ChatHeader 是 `position: sticky` + `backdrop-blur-xl`（CSS `backdrop-filter: blur(24px)`）
- Android Chromium 完整实现了这个规范 → ChatHeader 成了心声弹窗的 containing block
- 弹窗外层 `fixed inset-0` 被锚定到 ChatHeader 容器（72px 高 × 视口宽）→ 遮罩只盖 72px → 内容溢出固定容器 → 看着"卡在顶上"
- iOS / macOS Safari 的实现行为跟 Chromium 不一致（历史上对这条规范的实现摇摆过），所以表现正常

## 修复
`components/chat/ChatHeaderShell.tsx`：心声弹窗外层 `div`（line 366）改用 `createPortal` 挂到 `document.body`，跟已有的删除确认弹窗（line 428）一致。

```diff
-{isBuffListExpanded && emotionHistory.length > 0 && (
+{isBuffListExpanded && emotionHistory.length > 0 && typeof document !== 'undefined' && createPortal(
     <div className="fixed inset-0 z-[100] bg-slate-900/45 backdrop-blur-[1px]" onClick={...}>
         ...
-    </div>
+    </div>,
+    document.body
 )}
```

弹窗内容、外层 className 完全不变——只是 DOM 挂载点从 ChatHeader 子节点移到 `body` 末尾，绕开 ChatHeader 的 `backdrop-filter` containing block。

## 动了哪些文件
- `components/chat/ChatHeaderShell.tsx` —— 改 2 行（开始条件 + 末尾 `, document.body`）

## 踩坑 / 需要知道的（重要）

### 1. `backdrop-filter` 跟 `transform` 等价——会吃 `position: fixed`
任何有 `backdrop-filter`（除 `none` 外）的祖先元素，都会成为 fixed 定位的 containing block。
等价规则参考：CSS Containment Spec [§4](https://www.w3.org/TR/css-contain-2/#containment-bounds)。

会建立 fixed containing block 的 CSS 属性（容易忘的）：
- `transform`（含 `none` 之外的任何 transform）
- `perspective`（除 `none` 外）
- `filter`（除 `none` 外）
- `backdrop-filter`（除 `none` 外） ← 这次踩的
- `will-change` 设了以上任一属性
- `contain: paint/layout/strict/content`

**经验**：写 `position: fixed` 弹窗时，先 grep 整个祖先链的这些属性——只要任何一个命中，弹窗就得用 `createPortal` 挂到 `document.body`，否则在不同浏览器上位置会乱。

### 2. Safari 对这条规范的实现不一致
iOS / macOS Safari 历史上对 `backdrop-filter` 是否建立 fixed containing block 的行为跟 Chromium 不一样（Webkit bug 历史 + spec 摇摆），所以"我 Safari 上看着正常但 Android Chrome 上挂掉"是经典陷阱。
**永远以 Chromium 行为为准**——Android Chrome + iOS Chrome 都是这个规则。

### 3. `useEffect` 监听 document mousedown 关闭弹窗的兼容性
`useEffect` 在 `isBuffListExpanded` 变化时安装 mousedown 监听——不影响这次修复，因为监听是 document 级别，不受 portal 影响。
但**理论上**Android 上 touch→click 的 mousedown 时序可能让 chip 自己的 mousedown 触发后 listener 立即关弹窗（useEffect 装监听比 setState 渲染晚一帧）。当前测试没复现，先观察；如果暮色再说"点 chip 弹窗闪一下就关"，再加 `touchstart` 兼容。

## 备注
- AGENTS.md 第 6.2 节提过这个坑（sticky 容器 = 滚动祖先），但没提 `backdrop-filter` 这个——下次更新 AGENTS.md 时建议把"backdrop-filter 也吃 fixed"加进去
- 本次改动极小（2 行），不需要新建 changelog 索引项——但为了 trace 还是建了
