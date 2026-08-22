# 2026-08-22 自动写日记开关 + Chat.tsx 接入

## 改了什么

### types.ts
- `CharacterProfile` 加 `autoDiaryEnabled?: boolean` 字段
- 默认 false（用户主动开才生效）— 跟 emotionEnabled 默认 true 相反
- 单角色独立：A 角色开关不影响 B 角色

### components/chat/ChatSettingsDrawer.tsx
- 接口加 `autoDiaryEnabled: boolean` + `onToggleAutoDiary: () => void`（跟生图/放歌同款）
- 心声 section 下面加新 section：自动写日记开关
- 描述文案："开启后，角色会在每天 22:00 自动写一篇第一人称日记。仅当前角色生效。"

### apps/Chat.tsx
- import `ProactiveDiary`
- `handleToggleAutoDiary`：
  - 读取 `char.autoDiaryEnabled === true`
  - 切换 → `updateCharacter({ autoDiaryEnabled: !isOn })`
  - 开 → `ProactiveDiary.start(char.id)` + toast "明天 22:00 生效"
  - 关 → `ProactiveDiary.stop(char.id)` + toast "已关闭"
- `useEffect` 调 `ProactiveDiary.setDeps(() => ({ characters, apiConfig, userProfile, addToast }))`
  - deps 包含 `char?.id`（角色切换时重设；其他字段也跟着重设但实际引用稳定）
- ChatSettingsDrawer 调用点加 `autoDiaryEnabled` / `onToggleAutoDiary` props

## 为什么

commit 1 已经把 ProactiveDiary 模块跑通，但 defaultTrigger 的 depsProvider 是 null（要 commit 2 接 OSContext 数据）。Chat.tsx 是首次 mount OSContext 已就绪的组件，最适合挂 setDeps。

## 单角色独立

`char.autoDiaryEnabled` 存在每个角色自己的记录上，`ProactiveDiary.start/stop(charId)` 也是按 charId 操作 storage：
- A 角色开 → `localStorage['proactive_diary_schedules']` 有 A 的 entry
- B 角色开 → 同一 key 有 A 和 B 两个 entry，互不影响
- 关 A → 只删 A 的 entry，B 不动
- 即使同时开关，schedule map 里的 entry 是独立的 lastFire / nextFire

## 涉及文件

- `types.ts:1234` 加字段
- `components/chat/ChatSettingsDrawer.tsx:40-42, 449-462` 接口 + UI
- `apps/Chat.tsx:22, 1734-1754, 2956-2957` handle + props + setDeps

## 验证

- build 通过（3.94s）
- 打开聊天设置 → 心声下面能看到"自动写日记"开关
- 切到开 → 控制台 `[ProactiveDiary] Started: char-xxx, next at 2026-xx-xx 22:00:00` + toast
- 切到关 → 控制台 `[ProactiveDiary] Stopped: char-xxx` + toast
- 控制台 `__ProactiveDiary__.fireNow('char-xxx')` 立即触发（不卡 22:00）：等 ~10s 应该出现 toast "江澈 写了一篇日记" + 日记列表新增一条

## commit 1 vs 2/3

- **commit 1** `3f9a1fef`：模块 + 启动
- **commit 2**（本）：UI 开关 + Chat 接入 + setDeps — **功能可用**
- **commit 3**：DiscoverPage 加 JournalEntry + 小红点 + placeholder 删除
