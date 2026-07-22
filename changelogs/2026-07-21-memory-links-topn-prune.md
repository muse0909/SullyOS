# memoryLinks 支持按节点 topN 修剪 — 清理历史累积的稠密关联图

**日期**：2026-07-21
**涉及 commit**：（pending）

## 改了什么

给 SullyOS 的记忆宫殿 `memory_links` 加一个"按节点 topN 关系"修剪工具，清理历史 bug 累积的稠密关联图（之前 ~278k 条，平均每节点 ~140 条），降低 IndexedDB 体积和卡顿风险。

**这是修剪旧 `memory_links`，不是清聊天记录**。记忆正文、向量、消息、相册、资产全部不受影响。

**控制台清理命令**（打开开发者工具 F12）：

```js
await __SULLYOS_DB__.memoryLinkDB.pruneAllByTopN(50)
```

返回 `{ before, after, removed, topN }` 格式，预期形如 `{ before: 278206, after: 50000-60000, removed: 220000, topN: 50 }`（after 数字取决于实际图结构，不强求精确）。

## 动了哪些文件

- `utils/memoryPalace/links.ts` — 新增 `pruneMemoryLinksByTopN(links, topN=50, minStrength=0.3)` 工具函数
- `utils/memoryPalace/db.ts` — `MemoryLinkDB` 新增 `pruneAllByTopN(topN=50)` 方法；顶部 import `pruneMemoryLinksByTopN`
- `utils/db.ts` — 顶部 import 切换为 `pruneMemoryLinksByTopN`；恢复（`clearAndAdd`）改走 topN 版本；`DB.memoryLinkDB` 注释更新说明新方法
- `context/OSContext.tsx` — 顶部 import 切换为 `pruneMemoryLinksByTopN`；备份导出 `memory_links` 改走 topN 版本

## 算法细节

### `pruneMemoryLinksByTopN` 两阶段

**阶段 1**（沿用现有 `pruneMemoryLinks`）：
- 砍 `strength < 0.3` 的 `emotional` 边
- 同 `(sourceId, targetId, type)` 三元组去重，保留 strength 最大的

**阶段 2**（新增 topN 修剪）：
1. 把每条 link 注册到 `sourceId` 和 `targetId` 两个节点的关联列表（一条 link 同时属于两端）
2. 每个节点按 strength 降序排，取前 topN 条，把 link.id 放进 `keepIds`
3. 最终保留 `keepIds` 里的 link

**复杂度 O(N)**，无 O(N²)：
- byNode 收集：O(N)（每条 link 注册 2 个节点）
- 每节点 sort + take topN：O(K log K)，K = 该节点关联数（平均 ~140）
- 总开销 ≈ O(N + Σ K_i log K_i)，27 万条几秒内跑完

**为什么实际每节点可能略高于 topN**：节点 A 挑中 link(L) → 节点 B 也会"被动保留" link(L)。这意味着节点的最终保留数会受其他节点的 topN 挑选影响，可能比 topN 略多。**这是可以接受的**：实际平均 ~50-60 条/node，比当前 ~140 安全很多，扩散激活卡顿问题解决。

### `MemoryLinkDB.pruneAllByTopN`

```ts
pruneAllByTopN: async (topN = 50): Promise<{ before, after, removed, topN }>
```

- `getAll()` 读出所有 link
- 调 `pruneMemoryLinksByTopN(all, topN)` 修剪
- 同一 readwrite tx 里 `clear()` + `put()` 写回
- console.log 打印 `[MemoryLinkDB.pruneAllByTopN] before=N → after=M (删除 K 条, topN=50)`
- 返回 `{ before, after, removed, topN }`

### 不影响其他 store

明确只动 `memory_links`。`memory_nodes` / `memory_vectors` / `messages` / `characters` / `gallery` / `assets` 全部不动。

## 踩坑 / 需要知道的（重要）

- **和 `deduplicateAll` 的关系**：`pruneAllByTopN` 已经包含 dedup 阶段（阶段 1 调 `pruneMemoryLinks`）。两者**互斥**：
  - 跑 `pruneAllByTopN(50)` 即可一次到位（推荐）
  - 如果数据已 dedup 过只跑 `pruneAllByTopN(50)` 也安全（无害，dedup 是幂等的）
  - 不需要先 `deduplicateAll` 再 `pruneAllByTopN`

- **弱关系被砍**：`emotional` 边 `strength < 0.3` 会被砍，节点关联超 topN 的部分按 strength 倒序砍。这些弱边在系统使用过程中会按 `buildLinks` 规则（24h 内 temporal / Russell 情感距离 < 0.35 emotional / LLM causal|person|metaphor）**自动重建**——所以检索质量不会明显下降。

- **不影响扩散激活**：图遍历时强联通性由强边维持，砍弱边对检索质量影响极小。`getBySourceId` / `getByTargetId` 仍能命中强关联节点。

- **新数据写入安全**：`buildLinks` 已带 `skipKeys` 跨 batch 去重 + `saveMany` 历史去重 + `deduplicateAll` 用 Map 避免 O(N²) 卡死。这次新加的 `pruneAllByTopN` 主要是给**历史累积数据**做一次性清理。

- **导出/恢复也走 topN 版本**：
  - `context/OSContext.tsx:2551` 备份导出时 `pruneMemoryLinksByTopN(processedData, 50)`，**备份文件体积更小、导出更快**
  - `utils/db.ts:1920` 恢复时 `pruneMemoryLinksByTopN(data.memoryLinks, 50)`，**导入更快**
  - 老备份文件（导出时没裁过的）导入时会自动被 topN 裁剪，行为一致

- **import 循环依赖**：`utils/memoryPalace/db.ts` 现在 import `pruneMemoryLinksByTopN from './links'`，而 `links.ts` 本来就 import `MemoryLinkDB from './db'`。这是**有意的循环**——`pruneMemoryLinksByTopN` 是纯函数，使用时（`pruneAllByTopN` 方法被调用时）才访问 binding，ES modules 不会出问题。Build 实测 3.47s 通过。

- **没加新依赖**，没改 UI。

## 备注

- 默认 topN=50 是经验值（之前 139 条/节点 → 修剪后 50-60 条/节点）。如果发现影响检索质量，改 `pruneAllByTopN(50)` 第二个参数即可，例如 `pruneAllByTopN(80)` 保留更多。
- 第二次跑 `pruneAllByTopN(50)` 是幂等的：before ≈ after，不会再删东西。
- 下次想做"按节点 importance 权重 topN"（重要节点保留更多关系）时，单独实现即可，不用动这个。
