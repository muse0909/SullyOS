# 2026-08-22 发现页接日记 + 小红点

## 改了什么

### utils/journalSeenAt.ts（新文件）
- 全局时间戳 `journal_last_seen_at`（localStorage）
- `getJournalLastSeenAt()` / `setJournalLastSeenAt(ts = Date.now())`
- 跨 tab / 跨刷新都靠 localStorage 持久化

### apps/DiscoverPage.tsx
- placeholder 子页（'journal' + 整套 SVG + "敬请期待"）整段删除
- SubPage type 去掉 'journal'
- 加 `JournalEntry` 组件（同 GalleryEntry / CoupleSpaceEntry 模式）：
  - onClick = onClose() + setTimeout(openApp(AppID.Journal, AppID.Chat), 50)
  - parent=AppID.Chat 让 closeApp 回 WeChat（看到发现页）
- 加小红点：
  - `useEffect` 在 list 子页时遍历 characters → Promise.all 查每 char 最新 diary → 取 max(timestamp)
  - 跟 `getJournalLastSeenAt()` 比：`seenAt > 0 && maxTs > seenAt` → 显示红点
  - 红点：`<span className="w-2 h-2 rounded-full bg-red-500">` 放在 CaretRight 左边
- 删 `BookOpen` import（已不用）

### apps/JournalApp.tsx
- 加 `setJournalLastSeenAt` import
- 新 useEffect：`mode === 'calendar' || mode === 'write'` 时调 `setJournalLastSeenAt()`（标记已读）
- 'select' 模式不写（用户还没进角色，没真正"看"日记）

## 流程

1. 用户进 WeChat → 发现页 → 看到"日记"入口
2. 写日记（手动或自动）→ localStorage 存 entry，timestamp = Date.now()
3. 用户切走 WeChat 再回来 → DiscoverPage remount → useEffect 重查
4. 查 max(timestamp) > seenAt → 显示小红点
5. 用户点日记 → openApp(Journal) → JournalApp 启动 useEffect 写 seenAt = Date.now()
6. 用户回 WeChat → 发现页 remount → max ≤ seenAt → 红点消失

## 单角色独立 / 全局红点

- **schedule 独立**（commit 1 已做）：每个 charId 独立 schedule
- **红点全局**：跨所有角色统一显示"有新日记" — 不区分是哪篇哪个角色
- 这是暮色要的语义："发现页角标显示小红点" = 有新日记（不分角色）

## 涉及文件

- `utils/journalSeenAt.ts`（新文件）
- `apps/DiscoverPage.tsx:1-50, 121-123, 165-185` 接入 + JournalEntry
- `apps/JournalApp.tsx:1-13, 93-99` 写 seenAt

## 验证

- build 通过（4.09s）
- 流程：
  1. 打开 WeChat → 发现页 → 看到"日记"入口（无红点，seenAt 还没写或 = 0）
  2. 进聊天设置 → 开启"自动写日记"
  3. 控制台 `__ProactiveDiary__.fireNow('char-xxx')` 立即触发一篇
  4. 等 toast 出现
  5. 切走再回发现页（不点日记）→ 看到"日记"右边红点
  6. 点日记 → JournalApp 进入 calendar 模式 → 写 seenAt
  7. 切回发现页 → 红点消失
- 手动写也走同样流程（写日记时 charPage 写入 DB，timestamp = Date.now()）
- **注意**：JournalApp 进 select 模式时 seenAt 不更新（用户没真正"看"日记），保持红点状态

## 3 个 commit 总结

| commit | 内容 | 验证点 |
|---|---|---|
| `3f9a1fef` | ProactiveDiary 模块 + index.tsx resume | 控制台 `__ProactiveDiary__` 可见 |
| `bbf877d1` | 开关 + Chat.tsx handleToggle + setDeps | 切开关有 toast + log |
| `本 commit` | DiscoverPage 接入 + 小红点 | 写完日记 → 切走 → 红点显示 |
