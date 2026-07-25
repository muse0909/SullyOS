# 备份：exportFullData 补读记忆宫殿 8 个 store

**日期**：2026-07-25
**涉及 commit**：`1cbc97f`

## 改了什么

`utils/db.ts:exportFullData` 之前**根本没读** memoryPalace 相关的 IndexedDB store，导致无论 full 备份还是 text_only 轻量备份，memoryPalace **都不会被导出**——这是 7/24 memoryNodes 神秘丢失的根因之一（7/2 → 7/24 之间导出的 zip 里 memoryNodes 一直是 0，暮色误以为数据被 wipe，实际是导出 bug）。

**修法**：

1. `Promise.all` 数组里加 7 个 `getAllFromStore` 读取：
   - `memory_nodes`（记忆节点）
   - `memory_vectors`（向量）
   - `memory_links`（关系）
   - `topic_boxes`（主题盒）
   - `anticipations`（期盼）
   - `event_boxes`（事件盒）
   - `memory_batches`（批次）

2. 加读 `memoryPalaceHighWaterMarks`（高水位线）—— 这字段存在 `localStorage`（key 模式 `mp_lastMsgId_<charId>`），不是 IndexedDB store。exportFullData 之前也漏读

3. return 对象加 8 个字段

`importFullData` 之前已经处理这些字段（`utils/db.ts:1928+`），所以**导入链路原本就齐了**——这次只是把导出链路补齐。

## 动了哪些文件
- `utils/db.ts` — `exportFullData` 函数

## 踩坑 / 需要知道的（重要）

- **bug 存在时间**：3 月 19 日 `exportFullData` 写出来就有这个缺口——5 个月没人发现
- **7/24 早上导出的 zip memoryNodes=0 不是数据丢失，是导出 bug**。所以今晚恢复 memoryPalace 时其实数据**没丢**——只是没在 zip 里。7/2 备份的 1505 个还在本地 IndexedDB
- **memoryPalaceHighWaterMarks** 是 `localStorage` 不是 IndexedDB——其他字段都是 IndexedDB。要注意 store / localStorage 的区分
- **text_only 模式和 full 模式**都走 `exportFullData`——所以这个 bug 同时影响两种模式

## 备注
- 验证：`npm run build` 通过（3.69s）
- 云端同步（7/20 加的）也有 `subscribeNewMemories` 没人订阅的 bug，暮色说云端同步一直连不上——这条等下次再处理
- memoryPalace 数据被导出后，`memoryVectors` 是 base64 压缩的（暮色 7/21 改的）—— 备份体积不会爆增
