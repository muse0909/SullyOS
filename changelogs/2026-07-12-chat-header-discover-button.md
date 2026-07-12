# 聊天页头部加发现页入口（星星按钮）

**日期**：2026-07-12
**涉及 commit**：`e415b5b`

## 改了什么
暮色 2026-07-12 要求："在聊天页的头像栏里设置按钮左边增加一个发现页的按钮。图标要个星星，点一下进入发现页。"

## 触发流程
- 用户在 ChatHeaderShell 点星星 → `requestOpenDiscoverTab()` → `discoverTabRequestId++`
- WeChat `useEffect` 监听 id 变化 → `setOpenedCharId(null) + setTab('discover')`
- 渲染切到 WeChat 联系人列表 + 发现 tab 内容（DiscoverPage 组件）

## 动了哪些文件

### 1. `components/chat/ChatHeaderShell.tsx` —— UI
- 加 `onOpenDiscover?` prop
- import `Star` from `@phosphor-icons/react`
- 2 处设置按钮左边（line 360-372 centered header + line 385-397 standard header）加 Star 按钮
- 用 `iconButtonClass` 跟其他按钮样式一致

### 2. `apps/Chat.tsx` —— 接 prop
- useOS 解构加 `requestOpenDiscoverTab`
- `<ChatHeader onOpenDiscover={() => requestOpenDiscoverTab()} />`

### 3. `context/OSContext.tsx` —— 全局 state + API
- 加 `pendingDiscoverTabRef`（防重复 trigger）
- 加 `discoverTabRequestId` state（counter，WeChat 用 useEffect 监听）
- 加 `requestOpenDiscoverTab()` + `consumePendingDiscoverTab()` 函数
- type 定义 + context value 暴露

### 4. `apps/WeChat.tsx` —— 监听 + 切 tab
- useEffect 监听 `discoverTabRequestId` 变化
- 触发时 consume + `setOpenedCharId(null) + setTab('discover')`

## 踩坑 / 需要知道的（重要）

### 1. 仿 `consumePendingDirectChat` 模式
暮色 2026-07-12 之前已经有的 `consumePendingDirectChat` / `jumpToChat` 是用 ref + consume 的模式。
我用类似模式（ref 防重复 + counter 让 WeChat useEffect 监听）。
**为什么不用纯 ref 轮询**：ref 变化不触发 re-render，需要轮询（hack interval）；state counter 让 useEffect 自然触发，更干净。

### 2. ChatHeaderShell 有 2 处设置按钮
- `centered info` 风格（line 350-374）：头像居中，右侧固定位置放按钮
- `standard` 风格（line 376-400）：头像 + 名字一行，右侧 ml-auto 推到底
两处都要加星星按钮，**否则切换 headerStyle 时会出现"只有一处有星星"的视觉 bug**。

### 3. discoverTabRequestId 初始 0
- useEffect 加 `if (discoverTabRequestId === 0) return` 跳过初始 mount——避免进 WeChat 时误触
- requestOpenDiscoverTab() 内部 `setDiscoverTabRequestId(n => n + 1)` 永远 > 0

### 4. 物理返回键行为
- 星星按钮触发后：`openedCharId = null` + `tab = 'discover'`
- 按物理返回键：WeChat backHandler（line 60-61）→ `return false` → closeApp → 回 launcher
- 行为合理：用户从"联系人列表的发现 tab"按返回直接回桌面

## 备注
- 待办未变
- **未动**：ChatHeaderShell 的"返回箭头"按钮（line 349/377）调 `onClose = closeApp` 直接回 launcher——跟物理返回键行为不一致（物理返回键会回 WeChat 联系人列表）。这是已存在的不一致，不是这次任务的一部分，暮色没问就没动。
- 测试方式：进任意角色聊天 → 顶栏右上角看到 ⭐ 按钮（在 ⚙️ 左边）→ 点击 → 回到联系人列表 + 切到"发现"tab
