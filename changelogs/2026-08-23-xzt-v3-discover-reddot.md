# 2026-08-23 小纸条 v3 星星红点

## 改了什么

### context/OSContext.tsx
- 加 `discoverUnread: { momentsNew, diaryNew, xztVisibleUnread }` state
- 加 `incrementDiscoverUnread(key, delta=1)` 函数
- 加 `markDiscoverSeen()` 函数 — 清零 + 写 localStorage `discover_last_seen_at`
- 暴露给 context value
- **挂全局桥接** `window.__SULLYOS_INCREMENT_DISCOVER__` — 让非 OSContext 组件（useChatAI / utils 函数）也能触发增量
- 朋友圈解析（useChatAI 调 parseMomentsActions 后） → `momentsResult.posted > 0` 时 incrementDiscoverUnread('momentsNew')
- 主动消息路径同款
- 小纸条 visible 写入 → incrementDiscoverUnread('xztVisibleUnread', 1)（藏信不计）

### utils/charDiary.ts
- `generateCharDiary` 加 `onCreated?: (entry) => void` 回调
- 成功写完调 `deps.onCreated?.(entry)`（在归档到记忆宫殿之后）

### utils/proactiveDiary.ts
- `defaultTrigger` 调 `generateCharDiary` 时传 `onCreated: () => window.__SULLYOS_INCREMENT_DISCOVER__?.('diaryNew', 1)`

### apps/JournalApp.tsx
- "让他写一篇"按钮（`handleGenerateCharDiary`）传 `onCreated: () => incrementDiscoverUnread('diaryNew', 1)`
- useOS 解构加 `incrementDiscoverUnread`

### utils/momentsActionParser.ts
- `parseMomentsActions` 返回类型从 `string` 改成 `ParseMomentsActionsResult`（`{cleaned, posted, liked, commented}`）
- 给 caller 拿 `posted` 数算红点

### apps/WeChat.tsx
- useOS 解构加 `discoverUnread, markDiscoverSeen`
- 切到"发现"tab 时调 `markDiscoverSeen()` 清零
- "发现"tab 文字右上角渲染红点（条件：`momentsNew + diaryNew + xztVisibleUnread > 0`）

## 暮色确认范围

朋友圈 + 日记 + 小纸条 visible = 红点增量
藏信（HIDDEN/TIMED）**不**参与（暮色"藏的功能体现在不通知"）

## 暮色行为

- 写新朋友圈 post → `momentsNew++` → 星星红点
- 写新日记（自动 + 手动）→ `diaryNew++` → 星星红点
- AI 写新 visible 小纸条 → `xztVisibleUnread++` → 星星红点 + addToast
- AI 写藏信（HIDDEN/TIMED）→ **不** incrementDiscoverUnread + **不** addToast（暮色"藏的功能体现在不通知"）
- 切到发现 tab → 3 项清零 + 写 `discover_last_seen_at` + 红点消失
- 暮色进发现 tab 期间，DiscoverPage 也会调 `markJournalRead` 走 `journal_last_seen_at`（之前日记红点逻辑）
- 暮色**打开**日记 App → JournalApp 进 calendar 模式也会写 `journal_last_seen_at`

## 涉及文件

- `context/OSContext.tsx` state + 函数 + 桥接 + 朋友圈增量 + 小纸条 visible 增量
- `utils/charDiary.ts` onCreated 回调
- `utils/proactiveDiary.ts` 传 onCreated
- `apps/JournalApp.tsx` "让他写一篇"传 onCreated + useOS
- `utils/momentsActionParser.ts` 返回值结构
- `apps/WeChat.tsx` tab 切换 + 红点渲染

## 验证

- build 通过（4.17s）
- 测试：
  1. 跟角色聊，让 AI 主动发朋友圈 → 星星红点显示
  2. 触发"让他写一篇"日记 → 红点 + 1
  3. AI 写 visible 小纸条 → 红点 + 1（同时 addToast）
  4. AI 写藏信（HIDDEN）→ **不**红点 + **不**toast
  5. 切到发现 tab → 红点消失 + `discover_last_seen_at` 写入
  6. 再写新内容 → 红点再次显示
