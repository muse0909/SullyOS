# 轻量备份：memoryVectors base64 压缩 + 增量恢复

**日期**：2026-07-21  
**涉及 commit**：`29f0c17`

## 改了什么

暮色 2026-07-21 14:46 反馈两个问题：
1. 轻量备份 16M 太大（"聊越久数据越大"）
2. 想要"只导上次恢复时间点之后的数据"（"恢复之前的不动，直接覆盖上"）

### 1. memoryVectors vector 字段 base64 压缩（减体积 62%）

**16M 真凶**：导出端 `Uint8Array → number[]` —— 1024 维向量在磁盘 4 字节/维紧凑，导出 JSON 时变 14 字节/维（每个数字带逗号/负号/小数点/方括号），**膨胀 3.5x**。

**修法**：
- **导出端** `context/OSContext.tsx`：vector 字段用 base64 字符串（5.4 字节/维）
  - 1000 向量：14M → 5.4M
  - 1500 向量：21M → 8M
- **导入端** `utils/db.ts`：识别 3 种格式（base64 字符串 / 老 number[] / 已 Uint8Array），全部还原成 Uint8Array 写入磁盘
  - 100% 向后兼容老备份

**基64 编码 helper**（`uint8ToBase64`）：分块 32K 字节 + `btoa()`，避免 `String.fromCharCode.apply` 单次 65535 字符限制。

### 2. text_only 模式增量恢复

**设计**：
- `localStorage['sullyos:lastRestoreAt']` 存上次恢复时间戳
- 首次（lastRestoreAt = 0）→ 全量导出
- 后续（lastRestoreAt > 0）→ 增量导出：只导时间戳 > lastRestoreAt 的数据
- **只对 text_only 模式生效**：full / media_only 永远全量（整机恢复场景）

**导出端过滤**（`context/OSContext.tsx`）：
- `messages`: `timestamp > lastRestoreAt`
- `memory_nodes`: `createdAt > lastRestoreAt`
- `memory_vectors`: 关联的 `memoryId` 在增量 memoryNodes 子集里（先处理 memory_nodes 记录 ID set，再处理 memory_vectors 过滤）
- **其他 store 全量导**（characters / themes / worldbooks / user profile / assets / emojis 等，体积小）

**导入端**（`utils/db.ts:importFullData`）：
- `tx.oncomplete` 时写 `lastRestoreAt = Date.now()`（只在 `backupMode === 'text_only'`）
- 写在事务完成后：失败不写（避免把 lastRestoreAt 写到一半）

### 3. A2 留 V2（按 hideBeforeMessageId 过滤老的 memoryNodes）

**没做**：
- MemoryNode 跟 messageId 关联字段不明（`sourceId` 字段是"源记忆"不是源消息）
- `mp_lastMsgId_<charId>`（highWaterMark）存的是 messageId 不是 timestamp，需要二次跳转
- **决定先看 A1 + B 实际效果**，再决定要不要做 A2

## 动了哪些文件

- `context/OSContext.tsx` —— exportSystem 函数改造
  - line ~2047-2060: 加 `uint8ToBase64` helper + `lastRestoreAt` / `isIncremental` / `incrementalMemoryNodeIds` 状态
  - line ~2365-2370: 加 rawData 增量过滤（messages / memory_nodes / memory_vectors）
  - line ~2382-2404: memory_vectors 处理改 base64 压缩
- `utils/db.ts` —— importFullData 函数改造
  - line ~1878-1914: memoryVectors 识别 3 种格式（base64 / number[] / Uint8Array）
  - line ~1960-1972: tx.oncomplete 写 lastRestoreAt

## 踩坑 / 需要知道的（重要）

### 1. 16M 真凶是 number[] JSON 膨胀，不是 memoryVectors 本身

```
磁盘（Uint8Array）：1024 维 × 4 字节 = 4 KB
JSON 老格式（number[]）：1024 维 × 14 字节 = 14 KB（每个数字 JSON 化膨胀 3.5x）
JSON 新格式（base64）：1024 维 × 5.4 字节 = 5.4 KB（base64 编码 4/3 倍）
```

**base64 vs number[] 节省 62%**。

### 2. 增量恢复的边界场景

| 场景 | 行为 |
|---|---|
| 首次（lastRestoreAt = 0） | 全量导出 |
| 后续（lastRestoreAt > 0） + text_only | 增量（messages / memoryNodes / memoryVectors 按时间过滤） |
| 后续 + full | 全量（整机恢复场景，重置 lastRestoreAt 语义） |
| 后续 + media_only | 全量（图片备份，不跟时间走） |

**注意**：lastRestoreAt 只在 text_only 模式写入 → full / media_only 恢复后**不更新** lastRestoreAt → 下次 text_only 还会是上次 text_only 恢复的时间点。

### 3. 100% 向后兼容老备份

`utils/db.ts` 导入端识别 3 种格式：
- `typeof v.vector === 'string'` → base64（新格式）
- `v.vector instanceof Uint8Array` → 已经是紧凑形态
- `Array.isArray(v.vector)` → 老 number[] 格式

老备份（导出时是 number[]）导入时自动转 Uint8Array，**不需要迁移**。

### 4. A2 复杂度（留 V2）

MemoryNode 跟 messageId 关联字段不清楚：
- `sourceId` 字段是"消化衍生记忆的源记忆"——记忆之间的引用，**不是**消息引用
- `highWaterMark`（`mp_lastMsgId_<charId>`）是 messageId 不是 timestamp
- 需要 `messages.find(m => m.id === highWaterMark).timestamp` 二次跳转

如果做 A2：
- 拿到每个 char 的 highWaterMark 对应 message 的 timestamp
- memoryNodes 中 `createdAt < 该 timestamp` 的不导出
- memoryVectors 关联的 memoryId 不在增量 memoryNodes 范围的也不导出

**预计效果**：8M → 1-3M。但**实现成本**高（要 3 处表关联 + 字符串解析）。**先看 A1 + B 实际效果**再决定。

## 备注

- **未做**：A2（按 hideBeforeMessageId / highWaterMark 过滤老 memoryNodes）— 见上"踩坑 4"
- **未做**：A2 之外的体积优化（聊天记录无上限、character.avatar 大量 R2 URL 等）— 不是 text_only 主要瓶颈
- **待验证**：A1 + B 实际效果（首次 16M → 8M，后续 8M → 几百 KB）— 暮色测了看实际数字
- **配套改**：之前 7-21 dc4e80a 修的 user profile / emoji 覆盖 bug + 这次 A1/B — 一起覆盖 text_only 模式的体积 / 增量 / 覆盖三大问题
