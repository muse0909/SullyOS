# WeChat 嵌套 Chat 双返回修复 + API 浮窗居中

**日期**：2026-07-02  
**涉及 commit**：`b31b0bb`

## 改了什么

暮色反馈 2 项：

1. **嵌套 Chat 时顶栏左侧出现两个返回按钮**（ChatHeaderShell 自己的 onClose + WeChat 覆盖按钮）
   - 删 WeChat 的覆盖按钮（最简方案）
   - ChatHeaderShell 的 onClose 走 `closeApp → handleBack → WeChat 的 registerBackHandler` → 回联系人列表（Android Back / iOS 点 Chat onClose 都正确）
   - 但 ChatHeaderShell 的 onClose hover 有白圈——新建 `onCloseButtonClass` 去掉 `hover:bg-*`（settings 按钮保留 hover 反馈）

2. **API 快捷切换弹窗贴底 + 缺左右留白**
   - panel 从 `flex items-end sm:items-center` 改为居中（fixed inset-0 + 卡片 absolute 居中）
   - 卡片宽度：`w-[min(88vw,360px)]`（跟微信心声弹窗一致）
   - 圆角：`rounded-3xl`（统一微信式卡片风格）
   - 背景遮罩：`bg-slate-900/45 backdrop-blur-[1px]`（跟微信心声弹窗一致）
   - 入场动画：从底部滑上来改为居中淡入（fade + 8px 上浮）

## 动了哪些文件

- `apps/WeChat.tsx` —— 删嵌套 Chat 时的覆盖按钮
- `components/chat/ChatHeaderShell.tsx` —— 加 `onCloseButtonClass` 变量（无 hover bg），line 343 / 371 改用新变量
- `components/os/ApiQuickFloat.tsx` —— panel 容器居中 + 卡片宽度 + 圆角 + 入场动画

## 踩坑 / 需要知道的（重要）

1. **iOS Safari 怎么从嵌套 Chat 回联系人列表**：靠点 Chat 顶栏自己的 onClose 按钮（仍然在左上）。它会调 `closeApp → handleBack`，我们的 `registerBackHandler` 已经注册了优先级最高的回退逻辑——所以点 Chat 自己的 onClose 会回到联系人列表，**不会**回到 launcher。这是 WeChat 第一版就做好的，暮色现在测就能感觉到。
2. **`registerBackHandler` 的清理保证**：WeChat 嵌套 Chat 时不 unmount 自己，只是切了 `openedCharId` state，所以 useEffect cleanup 不会触发，handler 一直有效 ✅。
3. **API 弹窗动画 keyframes**：保留原来的 `<style>` 标签写法（panel 内部有 scope），只改了 keyframes 名（`apiQuickFloatSlide` → `apiQuickFloatFade`）和位移曲线。
4. **`border border-white/40` 加在 panel 卡片上**：跟微信心声弹窗的描边一致，浅色描边让卡片在遮罩上更精致。

## 备注

- AGENTS.md 里"Chat.tsx 不动"这条约定没变——动的是 `ChatHeaderShell.tsx`（Chat 的子组件，独立的可改组件）。
- WeChat.tsx 嵌套逻辑现在变简单（不需要 z-index 调戏），未来要再加任何"嵌套层"也只用注册 backHandler 即可。
