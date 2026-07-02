# Launcher widget 直跳 Chat + 项目级 Modal 标准落实

**日期**：2026-07-02  
**涉及 commit**：`1cb0e20`

## 改了什么

暮色反馈 2 项：

1. **桌面"New Character / 点击继续设定..."的 CharacterWidget 点进去变成联系人页了**，要保留原行为（直接进聊天，跳过联系人列表）
2. **API 弹窗尺寸按项目级 Modal（components/os/Modal.tsx）的尺寸来，以后所有新弹窗默认都用这个标准**

---

### 1. Widget 直跳 Chat 实现

由于 PhoneShell 路由 `case AppID.Chat: return <WeChat />`，所有进 Chat 的入口都先经过 WeChat 联系人列表。暮色要求"桌面图标/dock 进 WeChat，但 widget 直接进 Chat"——同 AppID 不同行为。

**方案**：在 OSContext 加 transient ref `pendingDirectChatRef` + 两个 API：
- `jumpToChat(charId)`: 设 ref + 切 activeCharacterId + openApp(AppID.Chat)
- `consumePendingDirectChat()`: 读 ref + 清空

`Launcher.tsx` widget onClick：`openApp(AppID.Chat)` → `jumpToChat(widgetChar.id)`
`WeChat.tsx` mount 时 `useEffect` 调 `consumePendingDirectChat()`，有值就 `setOpenedCharId(pending)`，跳过联系人列表

桌面图标 / dock / QQ 桥接等其他入口保持 `openApp(AppID.Chat)`，因为不调 jumpToChat，所以 WeChat mount 时 consumePendingDirectChat 返回 null，仍然显示联系人列表 ✅

### 2. 项目级 Modal 标准落实

暮色拍板：以后所有新弹窗默认按 `components/os/Modal.tsx` 的视觉规格。

**标准参数**（写入 AGENTS.md §5.5）：

```
容器
  fixed inset-0 z-[100] flex items-center justify-center
  p-6 animate-fade-in

背景
  absolute inset-0 bg-black/40  (无 backdrop-blur)

卡片
  relative w-full max-w-sm bg-white
  rounded-[2.5rem] shadow-2xl border border-white/20
  overflow-hidden animate-slide-up
```

**ApiQuickFloat panel 已对齐到该标准**：
- 容器从 `flex items-end sm:items-center` → 居中（`flex items-center justify-center`）
- 卡片宽度 `w-[min(88vw,360px)]` → `w-full max-w-sm`
- 圆角 `rounded-3xl` → `rounded-[2.5rem]`
- 背景 `bg-slate-900/45 backdrop-blur-[1px]` → `bg-black/40`
- 入场动画 keyframes 删除，改用 tailwind `animate-fade-in` + `animate-slide-up`
- z-index 保留 `[110]`（ApiQuickFloat 是 floating 工具，不在 AppID 路由内）

## 动了哪些文件

- `context/OSContext.tsx` —— `interface` 加 `jumpToChat` + `consumePendingDirectChat`；provider 加 ref + 实现；value 注入
- `apps/Launcher.tsx` —— destruct 加 `jumpToChat`；widget onClick 改 `jumpToChat(widgetChar.id)`
- `apps/WeChat.tsx` —— destruct 加 `consumePendingDirectChat`；mount effect 读 pending → `setOpenedCharId`
- `components/os/ApiQuickFloat.tsx` —— panel 容器 + 卡片按项目级 Modal 重写
- `AGENTS.md` —— 新增 §5.5 弹窗 / Modal 标准

## 踩坑 / 需要知道的（重要）

1. **`pendingDirectChatRef` 用 useRef 而非 useState**：避免触发任何 re-render。OSContext 不应该因这个一次性 transient 状态而重渲染整个组件树。
2. **不是所有 AppID.Chat 入口都直跳**：只 widget 用 `jumpToChat`；桌面图标 / dock / 通知中心等保持原 `openApp(AppID.Chat)` 走 WeChat 标准路径。这条"分流"靠"是否调用 jumpToChat"区分。
3. **consumeOnce**：WeChat mount 时调一次，`consumePendingDirectChat` 内部立即清空 ref。即使 WeChat 因为状态变化 unmount/remount，第二次也是 null，不重复触发 setOpenedCharId。
4. **jaccardBigramSimilarity 等没碰**：这次没改 useChatAI，没影响上次心声去重功能。
5. **微信式心声弹窗保持原状**：`ChatHeaderShell.tsx` 的心声弹窗用 `w-[min(88vw,360px)] + rounded-[2rem]`——这是另一种风格（暮色单独认可过的"卡片化"），不在新 Modal 标准覆盖内。AGENTS.md §5.5 末尾标注了这种例外。

## 备注

- 暮色"今天先这样"——后续 Step 2（联系人卡片接真实数据）+ Step 3（回 Chat 滚动状态保留）+ 发现页 等都留到下次。
- AGENTS.md §5.5 是这份项目未来所有新弹窗的统一参考。后续如果有新弹窗没遵守标准，会被暮色一眼看出来。
