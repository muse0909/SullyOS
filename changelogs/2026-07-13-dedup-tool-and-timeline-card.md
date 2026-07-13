# 记忆宫殿：按日期时间线 + 查重工具

**日期**：2026-07-13
**涉及 commit**：（提交后填）

## 改了什么

1. **第 8 格卡片「按日期时间线」**（窗台右边空位，浅蓝 `#0ea5e9`）
   - 占满之前 2 列网格的空格，跟 7 房间并列
   - 点进去是新视图：按月 → 按日 → 日内按时间倒序
   - 同一份数据，不同排列：底层都是 `memory_nodes` 表，不重复存储

2. **顶部新增「查重」按钮**（浅蓝 `#0891b2`）
   - 跟「查看全部记忆 / 查看事件盒」并列
   - 点进去是独立组件 `DedupView`，自管 state

3. **`DedupView` 查重工具**（两个 tab）
   - **Tab 1：🔍 找重复**
     - 选相似度阈值（0.75 / 0.80 / 0.85 / 0.90，默认 0.80）
     - 选房间（全部 / 单房间）
     - 点「开始找重复」→ 跑两两 cosine 比对（按 room 分桶）
     - 结果按相似度降序，每对可 [合并到同一事件盒] / [都保留]
     - 合并调现有 `manuallyBindMemories`（不引入新合并机制）
   - **Tab 2：🧹 低访问清理**
     - 选访问次数档位（全部 / 0次 / 1-5次 / 5次以上，默认 0次）
     - 选房间
     - 列表可单条勾选或全选，底部 sticky 工具栏 [删除选中]（带 confirm）
     - 删除完整链路：EventBox 移除 → MemoryLink 删 → 向量删（本地+远程）→ Node 删

4. **新建 `utils/memoryPalace/dedup.ts`**（~160 行）
   - `findDuplicates(charId, threshold, { roomFilter, onProgress })` → `DuplicatePair[]`
   - `filterByAccess(nodes, range)` → `MemoryNode[]`
   - `DEDUP_THRESHOLDS` / `ACCESS_RANGES` 导出（UI 用）
   - 复用现有 `cosineSimilarity` + `MemoryVectorDB.getAllByCharId` + `ensureFloat32`

## 动了哪些文件

- `utils/memoryPalace/dedup.ts` —— 新增（后端算法 + 类型 + 阈值常量）
- `utils/memoryPalace/index.ts` —— 导出 `findDuplicates` / `filterByAccess` / `DEDUP_THRESHOLDS` / `ACCESS_RANGES` + 3 个 type
- `apps/MemoryPalaceApp.tsx` —— 加 view 类型 `'timeline' | 'dedup'` + 第 8 卡片 + 顶部查重按钮 + `openTimeline()` + `reloadAllNodes()` + 时间线视图（约 95 行） + 查重视图入口（约 8 行） + 文件末尾 `DedupView` 组件（约 320 行）

## 踩坑 / 需要知道的（重要）

- **查重入口设计**：「开始找重复」按钮**手动触发**，不默认进视图就跑。1794 条全量两两比约 20s（按 room 分桶后），跑的时候会有进度条（`onProgress` 回调）。如果以后 token 数涨到几千条，要考虑搬到 web worker 跑（已有 `vectorSearchWorker.ts` 可借鉴）。

- **同 room 才比**：跨 room 的两条记忆即使向量相似也不该合并（"客厅的加班" vs "书房的加班" 是不同分类）。这是 `dedup.ts:findDuplicates` 的设计——按 `room` 分桶后桶内两两比。

- **合并方式选 A**（合并到同一事件盒，**不**合并成一条 MemoryNode）：因为 A 复用现有 `manuallyBindMemories` + EventBox 机制，不引入新概念；拼接 content 容易乱（一周 3 天提加班拼成 1 条大段文字反而不好用），而且 A 召回时整盒 1 个名额（**这才是去重的真正意义**）。

- **Tab 2 删除走完整链路**：跟现有 `deleteMemory`（line 1265）做完全一样的事——EventBox 移除 → MemoryLink 删 → MemoryVector 删（本地+远程 fire-and-forget）→ Node 删。但我没复用 `deleteMemory`（它在 `MemoryPalaceApp` 内部闭包），在 `DedupView` 里**重新写了一份 inline**。两份代码会飘移的风险存在，后续如果改 `deleteMemory` 逻辑，记得 `DedupView` 这份也要同步。

- **找重复 + 低访问清理是两个独立操作**：用户可以分开用（只想清理 0 次访问的、或者只想合并重复的），不会互相影响。Tab 切换会重置当前 tab 的 state（`useState` 局部）。

- **没有引入新数据模型字段**：`mergedFrom?: string[]` 之前考虑过加到 `MemoryNode`，但 A 方案用 EventBox 已经记录了关联，**不重复追踪**。如果未来想做"反向查某条记忆被合并自哪几条"，再补这个字段。

- **build 验证**：`npm run build` 通过（memory-palace chunk 173.90 kB / 64.90 kB gzip），0 errors。chunk size warning 是历史的（>2000 kB 是 `index-CcaLMIYd.js` 2807 kB），不是这次引入的。

## 备注

- **没动底层提取/合并逻辑**：之前调研发现的 5 道防线（`pipeline.ts:1285` `skipDedup: true`、跨天 relatedTo 看不见等）这次都没改。这次只加了"手动查重"工具作为兜底出口，不动 chat 路径的 skipDedup 决策（暮色当时权衡过"宁可重复也不误杀"）。
- **下一波可优化**（暮色说"先做边查"，等用户反馈再调）：
  - 找重复 web worker 化（1794 条以上需要）
  - 查重对"合并到同一事件盒"后，能不能自动给新 box 起个名字（现在 box 是空名 `manuallyBindMemories` 不传 name）
  - 低访问 tab 加"按重要性排序"（现在默认按 accessCount 升序）
- **设计对齐 AGENTS.md 5.5 节 Modal 标准**：DedupView 用了 max-w-sm 等价（容器 100% 宽度、卡片 12px 圆角），整体居中布局。
