# 便利贴（pinDays）升级为自动状态面板

**日期**：2026-08-14
**涉及 commit**：(本任务，2 个 commit)

## 改了什么

旧机制：每条 `MemoryNode` 自带一个 `pinnedUntil` 字段（pinDays 天数换算的时间戳），到点自动解 pin。**用户手动 pin 任意条记忆 + 置顶期内优先注入 prompt**。

新机制：全局一个 `user_status_panel`（localStorage），固定 5 个槽位的键值对：
- `location` 所在地
- `health` 身体
- `schedule` 在忙
- `mood` 情绪
- `reminder` 约定/待办

LLM 提取时按槽位粒度判断变化 → 每次只覆盖有变化的那一格。**LLM 自主维护，不是用户手动 pin**。

跨设备/跨角色共享同一份面板（per-user，非 per-character）。

## 三个改动面

### 1. 提取端（`utils/memoryPalace/extraction.ts`）
- `buildRulesBlock` 整段按暮色 8-14 新版重写（第一人称真实体感叙事、重要性分级 20-60/60-120/120-200 字、7 个房间细化、mood 加 conflicted）
- 删除原第 8 条 pinDays 规则
- 输出 JSON 改为**顶层结构**：`{ "memories": [...], "statusUpdate": {...} | null }`
- `statusUpdate` 规则：整批无变化填 `null`；变化时填一个对象，5 个槽位独立判断（无变化填 `null`、结束填 `"[清除]"`、新值填字符串）
- 5 槽位全 `null` → 整个 `statusUpdate` 填 `null`
- 提取端 system prompt 头部注入"## 当前状态面板"区块（仅在有内容时），让 LLM 看到当前面板以判断本轮变化
- 删除 unpin 解析（`{unpin: "P0"}` 标记） + `PinnedMemoryRef` 接口

### 2. 存储端
- 新建 `utils/memoryPalace/statusPanel.ts`：
  - 5 槽位类型 + `UserStatusPanel` / `StatusUpdate` 类型
  - localStorage 读写（`STORAGE_KEY = 'user_status_panel'`）
  - `applyStatusUpdate(update)`：整个 null 不动；某槽位 `"[清除]"` 删；某槽位字符串覆盖
  - `buildStatusPanelSectionForExtraction` / `buildStatusPanelSectionForInjection`：两个 helper，分别拼提取端/注入端的 markdown 区块，全空返回 `''`
  - `ensureLegacyPinnedCleared()`：一次性解 pin 所有 `pinnedUntil > now` 的节点，用 `localStorage` flag 标记只跑一次（lazy 触发，第一次 extraction 调用时执行）

### 3. 注入端（`utils/memoryPalace/formatter.ts`）
- 删除便利贴块（`pinnedNodes` 收集 + 4a 显示卡片 + 摘除按钮）
- 在 4a 位置（记忆宫殿标题后、按房间分组渲染前）拼 `📌 当前状态面板\n[所在地] xxx | [身体] xxx | ...` 一行
- 全空不注入
- 不再"置顶不占 15 条名额"——状态面板本来就是独立行，不走 15 条名额

## 动了哪些文件

**commit 1（基础设施）**：
- `utils/memoryPalace/statusPanel.ts` — 新建
- `utils/memoryPalace/types.ts` — 删 `MemoryNode.pinnedUntil` 字段

**commit 2（迁移 + 清理）**：
- `utils/memoryPalace/extraction.ts` — `buildRulesBlock` 重写 + 输出格式改顶层 + 删 pinDays/unpin + 解析 statusUpdate
- `utils/memoryPalace/pipeline.ts` — 删 `pinnedRefs` 收集 / `unpinIds` 处理；`extractionResult.statusUpdate` 由 extraction 内部 apply
- `utils/memoryPalace/formatter.ts` — 删便利贴块 + 加状态面板注入
- `utils/memoryPalace/supabaseVector.ts` — 不读不写 `pinned_until`
- `utils/memoryPalace/groupExtraction.ts` — 删 pinDays 提及
- `utils/memoryPalace/vectorSearch.ts` — 删 `pinnedUntil` 字段
- `api/sync.ts` — 删 `pinnedUntil` 字段 + INSERT/UPDATE SQL 不再写 `pinned_until` 列
- `hooks/useCloudSync.ts` — 删 `pinnedUntil` 同步
- `utils/syncClient.ts` — 删 `pinnedUntil` 字段
- `apps/MemoryPalaceApp.tsx` — 删便利贴 UI 整块（手动 pin 面板 + 摘除按钮）+ 4 处 `pinnedUntil` 引用

## 踩坑 / 需要知道的

### 1. 老便利贴数据不会被覆盖
- IDB `memory_nodes` 表里老节点的 `pinnedUntil` 字段保留
- Supabase D1 `memory_vectors` 表的 `pinned_until` 列保留
- Vercel D1 `memory_palace_items` 表的 `pinned_until` 列保留
- 新代码不读不写这些字段，DB 数据自然保留

### 2. 一次性解 pin 触发时机
- 第一次调用 `extractMemoriesFromBuffer` 时自动跑（`ensureLegacyPinnedCleared()` lazy 触发）
- 用 `localStorage` flag `user_status_panel_pinned_cleared_v1 = '1'` 标记已执行
- **失败重试**：网络/DB 异常时重置 promise，下一次 extraction 重试
- 老节点（带 `pinnedUntil` 字段的）→ cast 成 `Array<MemoryNode & { pinnedUntil?: number | null }>`，filter 出来置 null，**不带 pinnedUntil 字段**写回

### 3. 状态面板只走 localStorage，不上云
- 单条 key-value 性质不值得独立 IDB store
- 多端同步按需再做（暮色没明确要求）

### 4. 提取端响应格式改变
- 旧：`[{memory1}, {memory2}, ...]`（裸 JSON 数组）
- 新：`{"memories": [...], "statusUpdate": ...}`（顶层对象）
- 顶层对象解析失败时 fallback 空对象（**状态面板丢可接受，memories 才是主目标**）
- 加了 `safeParseJsonObject` helper（extraction.ts 内部，剥离 markdown + 找 `{...}` + JSON.parse + 兜底空对象）

### 5. formatter 召回回执
- 不再记 `pinnedIds` 进 `injectedIds`（状态面板不是 memory_id，不在 recallReceipt 表里）
- 状态面板 per-user，recallReceipt 是 per-character + per-memoryId，**两个体系不交叉**

### 6. MemoryPalaceApp 便利贴 UI 整块删
- 删除的"便利贴置顶"卡片 UI 是用户能看到的"手动 pin"功能
- 状态面板是 LLM 自动维护的，**没有用户手动入口**——这是产品设计决定，不是技术决定
- 暮色 8-14 拍板："整块删掉，便利贴完全靠状态面板"

### 7. buildRulesBlock 新增"mood 列表加 conflicted"
- 暮色 8-14 反馈：括号举例里提到 conflicted 但正式列表里没有，LLM 可能会不敢用
- 已加入：happy, sad, angry, anxious, tender, excited, peaceful, confused, **conflicted**, hurt, grateful, nostalgic, neutral

## 验证

- `npx tsc --noEmit`：跟改动文件相关的错误数 0（pre-existing 错误是 Neon 类型 + MemoryPalaceApp 的 `char` undefined 旧问题，跟本次无关）
- `npm run build`：通过，3.81s
- 全项目搜 `pinDays / unpinIds / pinnedRefs / PinnedMemoryRef / pinnedTotalChars / pinnedNodes / setPinnedNodes` = 0（仅 statusPanel.ts 文档/迁移代码有）
- 全项目搜 `pinnedUntil / pinned_until` = 剩余 5 处（supabaseVector.ts DDL 字段保留 + statusPanel.ts 迁移代码）
