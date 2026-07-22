# memoryLinks 每月自动修剪（30 天间隔）+ topN 50 → 70

**日期**：2026-07-22
**涉及 commit**：（pending）

## 改了什么

承接 2026-07-21 的 topN 修剪工具，加 3 件事：

**1. App 启动时自动跑一次修剪**（暮色 2026-07-22 拍板）

- 触发时机：每次打开 App（OSContext 启动 3 秒后）
- 距上次修剪 < 30 天 → 跳过，不弹任何东西
- 跑了一次且删了东西 → 弹 success toast：`已自动修剪 N 条冗余记忆关系（每节点最多 70 条）`
- 失败 / 跑空 → 静默
- 不阻塞首屏，挂载 3 秒后才跑

**2. topN 默认值 50 → 70**

暮色担心砍太多影响联想。改 70 是折中——比之前 bug 累积的 ~140 条/node 安全很多，比 50 保留更多弱关联。

改了 4 处：
- `utils/memoryPalace/links.ts` — `pruneMemoryLinksByTopN(links, topN=70, ...)`
- `utils/memoryPalace/db.ts` — `MemoryLinkDB.pruneAllByTopN(topN=70)`
- `context/OSContext.tsx:2551` — 备份导出 `pruneMemoryLinksByTopN(processedData, 70)`
- `utils/db.ts:1920` — 备份恢复 `pruneMemoryLinksByTopN(data.memoryLinks, 70)`

**3. 30 天间隔核实程序**

新加 `utils/memoryPalace/autoPrune.ts`：
- `localStorage.mp_lastLinkPruneAt` 存上次修剪时间戳
- 启动检查：`Date.now() - lastPruneAt < 30 * 86400_000` → 跳过
- 否则调 `MemoryLinkDB.pruneAllByTopN(70)`，写回时间戳
- 失败也写时间戳（避免每次启动都重试，30 天后再试）
- 二次开发辅助：`resetAutoPruneTimestamp()` / `getLastPruneTimestamp()`

## 动了哪些文件

- `utils/memoryPalace/links.ts` — `pruneMemoryLinksByTopN` 默认 50 → 70
- `utils/memoryPalace/db.ts` — `pruneAllByTopN` 默认 50 → 70
- `utils/memoryPalace/autoPrune.ts` — **新增**（97 行）
- `context/OSContext.tsx` — import + 备份硬编码 50 → 70 + 新 useEffect 跑 autoPrune
- `utils/db.ts` — import 注释更新 + 恢复硬编码 50 → 70

## 踩坑 / 需要知道的（重要）

- **间隔是相对时间，不是"每月 1 号"**：暮色给了两个选项（每月 1 号 / 30 天），选了 30 天。理由：
  - 跨时区 / 跨启动时间不会出现"刚过 0 点就跑了"这种诡异行为
  - 30 天整除性好记
  - 实现简单（一个 localStorage 时间戳），不需要日历计算

- **不阻塞首屏**：3 秒延迟启动，跟旁边那个"向量化迁移"一致的策略。如果用户秒进秒出，可能错过本月自动修剪——下个月启动会跑（30 天早就过了）。

- **跑空也更新时间戳**：如果 `pruneAllByTopN` 跑出 `removed=0`（数据已经很健康），也写时间戳——避免每次启动都跑全表扫描。30 天后再跑一次确认。

- **失败也更新时间戳**：避免错误状态下每次启动都重试。30 天后再试。

- **新增了未跟踪的 `scripts/inspect-idb.html`**：这是之前调试 IDB 时本地用的，不是这次任务产物，**不会进 commit**。

- **changelog 里没说的细节**：
  - 用户主动跑 `__SULLYOS_DB__.memoryLinkDB.pruneAllByTopN(N)` 也会**更新 lastPruneAt 时间戳**（因为底层调的是同一个 MemoryLinkDB.pruneAllByTopN）—— 等等，**不会**。autoPrune.ts 写时间戳是在 maybeAutoPruneMemoryLinks 里，console 手跑的 pruneAllByTopN 不会走这条路。两者独立。如果想"手跑也算"，要加个 setLastPruneTimestamp 公开 API。
  - 这意味着手跑 console 命令会绕过 30 天间隔检查——这是合理的，手跑就是用户主动意愿。

- **没加新依赖**，没改 UI（toast 沿用现有 success 样式）。

## 备注

- 想改间隔时长：调 `AUTO_PRUNE_INTERVAL_MS` 常量（30 天）或在 `maybeAutoPruneMemoryLinks` 第二个参数传
- 想看时间戳：开发者工具 console 跑 `localStorage.getItem('mp_lastLinkPruneAt')`
- 想强制下次跑：`localStorage.removeItem('mp_lastLinkPruneAt')` 或调 `resetAutoPruneTimestamp()`
- 下次发现 70 也太多 / 太少，单独改这个常量
- autoPrune.ts 跟 OSContext 没有循环依赖（autoPrune 只依赖 MemoryLinkDB）
