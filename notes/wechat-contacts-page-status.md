# 联系人页面改造 — 进度档案

**日期**：2026-07-04
**目标**：把旧的"联系人列表 = launcher widgets 一坨"改成微信式「消息/发现/我」三 Tab + 真实交互
**当前状态**：**Step 1 框架壳完成（5 commits），Step 2+ 待做**

---

## 0. 涉及文件（顶层）

```
apps/WeChat.tsx          # 联系人页主组件（234 行，2026-07-02 wechat-bug-fixes 后）
apps/DiscoverPage.tsx    # "发现" tab 内嵌子页（朋友圈/收藏/日记/设置入口）
apps/UserApp.tsx         # "我" tab 个人档案
apps/Chat.tsx            # 嵌套聊天页（被 WeChat 嵌套调用）
components/chat/         # Chat 内部组件
context/OSContext.tsx    # 全局 OS 状态（activeCharacterId / pendingDirectChatRef 等）
```

---

## 1. 已完成的改造（commit 历史）

| 日期 | commit | 改动 |
|---|---|---|
| 2026-07-01 | wechat-step1 | 仿微信 Step 1 框架壳 — 创建 `WeChat.tsx`，三 Tab 占位 + 联系人卡片列表 |
| 2026-07-02 | wechat-step1-tweaks | Tab 移底 / 留白 / 去白圈 / "我" 接档案 / 撕档案桌入 / API 换 WiFi |
| 2026-07-02 | wechat-once-back-and-api-centered | 嵌套 Chat 单返回修复 + API 浮窗居中 |
| 2026-07-02 | favorites-v4-and-2-new-bugs | 收藏页 v4 改造 + 2 个新 bug 交接（联系人页 + chars 面板切换） |
| 2026-07-02 | wechat-bug-fixes | WeChat 两个 bug 修复 — 联系人页被反向同步 effect 破坏 + Chat 内 chars 面板切不了 |

详细报告见 `changelogs/2026-07-01-wechat-step1.md` ~ `changelogs/2026-07-02-wechat-bug-fixes.md`。

---

## 2. 当前 WeChat.tsx 结构（2026-07-02 bug-fixes 后）

### 2.1 顶层布局

```
┌─────────────────────────────────────┐
│ [←]  联系人            [⚙]        │  ← 顶部 header（line 116-135）
├─────────────────────────────────────┤
│                                     │
│   ┌─[头像]──┐                       │
│   │ Sully   │  点击开始聊天…  ›    │  ← 联系人卡片（MessagesTab）
│   └─────────┘                       │
│   ┌─[头像]──┐                       │
│   │ 琪琪    │  点击开始聊天…  ›    │
│   └─────────┘                       │
│                                     │
│  ...                                │
├─────────────────────────────────────┤
│   消息    发现    我                │  ← 底部 Tab bar（line 149-167）
└─────────────────────────────────────┘
```

### 2.2 三个 Tab

| Tab | 内容 | 现状 |
|---|---|---|
| **消息** (`messages`) | `MessagesTab` — 角色卡片列表（`ContactCard`） | ✅ 完成 |
| **发现** (`discover`) | `<DiscoverPage onClose={() => setTab('messages')} />` | ⚠️ 半完成（详见 §3） |
| **我** (`me`) | `<UserApp />`（个人档案） | ⚠️ 适配未确认（详见 §3） |

### 2.3 关键交互

- **点角色卡** → `setOpenedCharId(char.id)` → WeChat 整页 unmount，渲染嵌套 `<Chat />`
- **聊天页返回** → 走 `registerBackHandler`：
  - widget 直跳入口 → 直接 closeApp 回桌面
  - 联系人列表点入 → 回联系人列表（再返回才到桌面）
- **点 Tab** → `setTab(x)` → 切换内容
- **右上齿轮** → ⚠️ **没绑 onClick**（line 127-134）

---

## 3. 未完成 / 待做（暮色当前 wishlist）

### 3.1 右上齿轮按钮（WeChat.tsx:127-134）

**状态**：按钮渲染了，**onClick 没绑**

**可选方案**（待暮色拍板）：
- A. 打开"微信设置"页（WeChatSettingsPage？）— 需要新建
- B. 打开全局"设置"页（已有的 settings）
- C. 暂不绑，等 Step 2 一起做

### 3.2 "发现" tab 的 DiscoverPage

**当前实现**（`apps/DiscoverPage.tsx`）：3 入口列表 — 朋友圈 / 收藏 / 日记 + 齿轮（→ 朋友圈设置）

**待暮色拍板的改动**（2026-07-04 提的）：
> 朋友圈设置放到朋友圈页面，放相机左边

**含义**：从 DiscoverPage 列表里**移走齿轮入口**，改成在 MomentsPage 顶部工具栏相机按钮**左边**加齿轮按钮。

**影响**（详见 `notes/moments-chat-integration-plan.md`）：
- `apps/DiscoverPage.tsx` 移除齿轮入口（防重复）
- `apps/MomentsPage.tsx` 工具栏加齿轮 button（line 298-314 `absolute top-0 ... justify-between` 区间）
- `apps/MomentsSettingsPage.tsx` 不动

### 3.3 "我" tab 的 UserApp 适配

**状态**：UserApp 直接渲染，但它是**为 launcher 写的**（从桌面 widget 进），不是为 WeChat 内嵌写的。**样式适配未确认**。

**待查**：
- UserApp 顶部返回按钮：可能在 launcher 下显示，在 WeChat 下不应该显示（用 WeChat 的"我" Tab 就好）
- UserApp 的 closeApp 行为：在 WeChat 下应该切到 messages Tab，不是 closeApp

### 3.4 PlaceholderTab 占位组件（WeChat.tsx:227-232）

**状态**：定义了但**永远没用上**（实际渲染走 DiscoverPage）

**建议**：可以删，或者保留到 Step 2 做"空 Tab"时的兜底

### 3.5 Step 2+ 想要的功能（暮色 wishlist）

按 2026-07-04 之前暮色提的 + 当前需求：

- [ ] **群聊入口**：联系人列表 → 群聊（参考 330 ai-group.js）— 未开始
- [ ] **朋友圈入口**：从联系人列表/聊天页 → 直接进朋友圈（暮色提过）— 未开始
- [ ] **搜索联系人**：联系人列表顶部加搜索框 — 未开始
- [ ] **新建联系人 / 邀请码**：从 launcher 神经链接 → 直接生成 QR — 局部在做
- [ ] **消息未读数 / 时间戳**：联系人卡片显示最后消息和未读 — 未开始
- [ ] **sticky 搜索栏**：滚动时吸顶 — 未开始

---

## 4. 给新 Mavis 窗口的 quick reference

**接手联系人页改造时，先读这三份：**

1. `apps/WeChat.tsx` 全文（234 行）
2. `changelogs/2026-07-02-wechat-bug-fixes.md`（最近一次 bug 修复的根因，避免重复踩）
3. `changelogs/2026-07-01-wechat-step1.md` + `changelogs/2026-07-02-wechat-step1-tweaks.md`（设计原意）

**特别注意**（暮色踩过的坑）：

- **不要加 `activeCharacterId → openedCharId` 反向同步 effect** — 会破坏联系人列表显示（详见 wechat-bug-fixes）
- **Chat.tsx 内 chars 面板切角色不要走 `setActiveCharacterId` 触发 WeChat 反向同步** — 已修，但任何新加的 effect 都要看 deps 是不是只 `[openedCharId]`
- **`useLayoutEffect` 同步消费 pendingDirectChat** — 不能用 `useEffect`，会跳帧（跳转错位）
- **Android 物理返回键走 `registerBackHandler`**，不是 `window.history.back()`（已统一）

---

## 5. 关联 wishlist

| 来源 | 状态 |
|---|---|
| 联系人页面改造（复杂待定）— AGENTS.md wishlist | 🔄 进行中（Step 1 完成） |
| 朋友圈（微信式）— AGENTS.md wishlist | 🔄 进行中（基础已做） |
| 情侣空间 — AGENTS.md wishlist | ❌ 未开始 |
| 群聊（多角色同时聊天）— AGENTS.md wishlist | ❌ 未开始（WeChat 有 ai-group.js 参考） |