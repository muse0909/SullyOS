# 事件盒规则细化 + 管理 UI

**日期**：2026-08-14
**涉及 commit**：(本任务，4 个 commit)

## 改了什么

暮色 8-14 反馈两件事：

### 1. 事件盒规则细化

**提取端**（`buildRelatedToRule` 第 10 条）：新增"单盒累计条数上限"——正常 10 条以内，硬上限 15 条。超过 15 条后该事件盒封盒，不再追加新记忆，同主题后续新事一律新建独立事件盒。

**压缩端**：按盒内最高重要性分级控制 summary 字数：

| 最高 importance | 理想 | 上限 |
|---|---|---|
| 1-3 | 100 字 | 200 字 |
| 4-6 | 300 字 | 400 字 |
| 7-10 | 500 字 | 600 字 |

压缩时如果当前 summary 超出对应上限，强制再精炼 2 轮（最多 3 次 LLM 调用）。3 轮后还超就硬截断兜底。

### 2. 事件盒管理 UI

清理混乱事件盒用。303 个事件盒的列表加"管理事件盒"入口，单盒加"管理"按钮。

**红框（顶部"管理事件盒"）**：
- 点开进入批量管理态：每盒出现勾选框，顶部出现"全选/取消全选 + 解散 N 个盒"
- 退出管理回到普通视图

**黄框（单盒"管理"按钮）**：弹菜单支持
- 编辑盒名 / 编辑盒标签（真改 IDB + vec 不动）
- 一键复活所有 archived 节点到活池
- 移出活节点到地上
- 解散此盒（summary 删 + archived 复活 + live 释放 + 删盒）

## 三个改动面

### 1. 提取端（`utils/memoryPalace/extraction.ts`）
- `buildRelatedToRule` 第 10 条追加"单盒累计条数上限"规则
- 跟 22:00 那次新规则整合

### 2. 压缩端（`utils/memoryPalace/eventBoxCompression.ts` + `types.ts`）
- `types.ts`：`EVENT_BOX_SUMMARY_HARD_MAX_CHARS` 从 800 调到 600（按 7-10 档兜底）
- `eventBoxCompression.ts`：
  - 加 `getSummarySizeForImportance(maxImportance)` helper
  - `callCompressionLLM` 加 `summarySize` 参数，prompt 字限动态化
  - `compressEventBox` 算 `summarySize` 并传给 LLM，调完超 hardMax 时调 `refineSummaryContent` 最多 2 轮
  - 加 `refineSummaryContent` 函数（专门精炼已有 content）
  - `recompressOversizedSummary` 同样按重要性分级判断 + 强制再精炼 1 轮

### 3. 事件盒管理（`utils/memoryPalace/eventBox.ts` + `apps/MemoryPalaceApp.tsx`）

**数据层**（`eventBox.ts`）：
- 加 `deleteMemoryNode(nodeId, remoteVectorConfig?)` 工具函数（完整清理链：解绑 + 清 links + 清 vec + 远程 sync + 删 node）
- 加 `dissolveEventBox(boxId, options?)` 公共 API（summary 走清理链 + archived 复活到地上 + live 释放 + 删盒）
- 加 `reviveAllArchivedInBox(boxId)` 公共 API（archived 全部复活到 live 池，盒保留）
- 抽 `MemoryPalaceApp.deleteMemory` 调 `deleteMemoryNode`（行为不变）

**UI 层**（`MemoryPalaceApp.tsx`）：
- 6 个新 state：`isManageMode` / `selectedBoxIds` / `boxMenuBoxId` / `boxEditMode` / `boxEditValue` / `boxWorking`
- 13 个新 handler：管理态切换、批量解散、单盒菜单、改名/改 tag、解散、复活等
- 顶部红框：管理态 / 普通态切换
- 盒卡片黄框：单盒"管理"按钮 + 弹窗菜单
- `boxMenuBtnStyle` helper 统一弹窗按钮样式

## 涉及文件

- `utils/memoryPalace/extraction.ts` — 规则细化
- `utils/memoryPalace/types.ts` — 字数硬上限常量调整
- `utils/memoryPalace/eventBoxCompression.ts` — 分级 + 精炼
- `utils/memoryPalace/eventBox.ts` — 管理数据层
- `apps/MemoryPalaceApp.tsx` — 管理 UI
- `changelogs/2026-08-14-eventbox-rules-and-management.md` — 本文件

## 踩坑 / 需要知道的

### 1. 提取端规则描述跟 code 阈值不严格对齐
暮色说"正常 10 / 硬上限 15"是给 LLM 看的**期望行为**。code 实际有 `EVENT_BOX_LIVE_HARD_CAP = 15`（满员时开新盒带 `predecessorBoxId`）和 `EVENT_BOX_SEAL_THRESHOLD = 12`（archived + live 满时 `sealed=true`）。**没改 code 常量**——LLM 自觉 + code 兜底双保险。

### 2. vec 不重做（这次没动）
`vectorizeAndStore` 用 `node.content` 算 vec（`vectorStore.ts:38`）。改名 / 改标签 → vec 不动。复活 archived → vec 不动。**只有 summary.content 改动**会触发 `embedded = false` 重做 vec（已有逻辑覆盖）。

### 3. 压缩端"强制再精炼 2 轮"是 LLM 调用次数上限
不是 2 轮后放弃，是 2 轮后还超就硬截断（`content.slice(0, hardMax) + '……'`）。3 次 LLM 调用是最多成本（1 次初压 + 2 次精炼 + 0 次截断）。

### 4. 解散盒 ≠ 删记忆
`dissolveEventBox`：summary 走 `deleteMemoryNode` 删，archived 复活到地上（archived=false，eventBoxId=null），live 释放到地上（eventBoxId=null），盒记录删。**记忆全部保留**，只是脱离组织。

### 5. `recompressOversizedSummary` 阈值从固定 800 改成按重要性
扫描时仍用 `EVENT_BOX_SUMMARY_HARD_MAX_CHARS` (=600) 作为默认 threshold（拿 7-10 档兜底）。`recompressOversizedSummary` 内部按盒内最高 importance 算真上限——低重要性盒会被更严格地压短。
