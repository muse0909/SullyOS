# 2026-08-22 ProactiveDiary 定时器模块

## 改了什么

新文件 `utils/proactiveDiary.ts`（约 260 行），借 ProactiveChat 机制做独立定时器：
- 频率：每天 1 篇，22:00（miya 模式）
- 独立 storage：`proactive_diary_schedules`（charId → { lastFire, nextFire }）
- 复用机制：精确 setTimeout + 主线程 20s polling + visibility/focus catchup + 1 分钟去重
- 接口：`start(charId)` / `stop(charId)` / `resume()` / `onTrigger(cb)` / `setDeps(provider)` / `isActiveFor(charId)` / `getSchedule(charId)` / `fireNow(charId)`（测试用）
- 默认 trigger callback 兜底：拿 deps（characters / apiConfig / userProfile / addToast）→ 调 `generateCharDiary` → 写成功后 addToast → 失败静默
- 控制台暴露 `window.__ProactiveDiary__` 给调试用

`index.tsx` 在 `KeepAlive.init().then()` 回调里加 `ProactiveDiary.resume()`（跟 ProactiveChat.resume() 同位置）。

## 22:00 算法

```ts
function nextTriggerAt(now: number): number {
  const d = new Date(now);
  d.setHours(22, 0, 0, 0);
  if (d.getTime() <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}
```

今天 22:00 已过 → 明天 22:00；没过 → 今天 22:00。

## 为什么独立于 ProactiveChat

- ProactiveChat 是"主动消息"（30~60 分钟一次，可调）
- ProactiveDiary 是"自动写日记"（每天 22:00 一次）
- 两个 schedule 完全独立：开主动消息不会自动开日记；关主动消息也不会关日记
- 各自 storage / 各自 timer / 各自 lastFire，不混

## 涉及文件

- `utils/proactiveDiary.ts`（新文件）
- `index.tsx`（加 import + resume 调用）

## commit 1 vs commit 2/3

- **commit 1（本）**：模块 + 启动 — build 通过，模块已可 `import` / `.resume()`，但**默认 callback 的 depsProvider 是 null**（要 commit 2 接 OSContext 数据）
- **commit 2**：ChatSettingsDrawer 加开关 + Chat.tsx 处理 `handleToggleAutoDiary`（同时调 `setDeps` 喂数据）
- **commit 3**：DiscoverPage 加 JournalEntry + 小红点 + placeholder 删除

## 验证

- build 通过（4.05s）
- 控制台：`__ProactiveDiary__.start('char-xxx')` → 等 22:00 自动写（要看 commit 2 配 setDeps）
- 控制台：`__ProactiveDiary__.fireNow('char-xxx')` → 立即触发（commit 2 后才能跑通，目前会 warn `depsProvider not registered`）

## 单角色控制

每个 charId 独立 schedule：开 A 角色不会影响 B 角色；关 A 不影响 B。`char.autoDiaryEnabled` 字段在 commit 2 加上，跟 `emotionEnabled` 同款。
