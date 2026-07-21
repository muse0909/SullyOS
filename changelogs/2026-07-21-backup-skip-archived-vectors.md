# 轻量备份 A2 优化：archived memoryNode 不导 vector（省 50-60% vectors）

**日期**：2026-07-21  
**涉及 commit**：`ce072af`

## 改了什么

暮色 2026-07-21 15:14 反馈："memoryVectors 还有办法精简优化吗？"

### 关键洞察：archived memoryNode 不召回

`utils/memoryPalace/pipeline.ts:108-115`：
```ts
if (n.archived && n.eventBoxId) {
    const box = await EventBoxDB.getById(n.eventBoxId);
    if (box?.summaryNodeId) {
        if (seen.has(box.summaryNodeId)) continue;
        const sum = await MemoryNodeDB.getById(box.summaryNodeId);
        if (sum && !sum.archived) {
            seen.add(sum.id);
            out.push(sum);
            continue;  // ← 关键：路由到 summary 后 continue，不返回 archived 节点本身
        }
    }
    // 没有 summary 就跳过
    continue;
}
```

**archived 节点本身不参与召回**——召回实际走 EventBox 的 `summaryNodeId` 指向的 summary 节点（`isBoxSummary: true`）。

→ **archived 节点的 vector 在备份里是浪费体积**——A1 base64 压缩后 8M，archived 节点向量估计占一半（4M+）。

### 实现

**导出端** `context/OSContext.tsx:exportSystem`：
- 顶部加 `const archivedMemoryNodeIds: Set<string> = new Set()` — **不分 mode** 总是收集
- 处理 `memory_nodes` 时遍历 rawData，把 `n.archived === true` 的 id 收集进 set
- 处理 `memory_vectors` 时 `filter` 掉 `archivedMemoryNodeIds.has(v.memoryId)` 的项
- 8M → 3-4M（省 50-60%，取决于 archived 节点占比）

**所有 mode 都生效**（full / media_only / text_only）—— archived 节点不召回是不分 mode 的事实。

**导入端不动**：`utils/db.ts:importFullData` 走 `clearAndAdd`（store.clear() + put 列表），memoryNode + memoryVector 是两个独立 store：
- 缺 vector 不影响 memoryNode 导入
- 罕见的"复活 archived 节点"操作会失去 vector（但反正不召回，影响极小）

## 动了哪些文件

- `context/OSContext.tsx` —— exportSystem 函数改造
  - line ~2055-2064: 加 `archivedMemoryNodeIds` 状态
  - line ~2397-2402: 处理 memory_nodes 时收集 archived IDs
  - line ~2418-2426: 处理 memory_vectors 时 filter archived 对应 vector

## 踩坑 / 需要知道的（重要）

### 1. EventBox 不存 messageId，所以 A2 备选 1 不可行

之前担心的"按 hideBeforeMessageId 过滤老的 memoryNodes"实际上**不可能实现**——EventBox 系统**根本不存** memoryNode 跟 message 的关联（只有 `liveMemoryIds` / `archivedMemoryIds` 记忆之间的引用）。

**唯一可行的关联字段**：
- 旧 `TopicBox.messageIds: number[]`（已 deprecated，@deprecated）—— 只有用旧系统的才有
- `MemoryNode.createdAt` —— 跟 message.timestamp 大致同时（精度不够，多 node 可能同时间创建）

A2 只能走"按 archived 状态过滤"这条路。

### 2. archived 节点不召回 = vector 没用

`pipeline.ts:108-115` 的 `if (n.archived)` 分支**只路由到 summary**，不返回 archived 节点本身。也就是：
- 用户跟 AI 聊天时**永远不会**因 archived 节点被召回
- archived 节点只作为"历史归档"存在，**没人主动去看**
- → vector 完全是浪费体积

### 3. 跨设备 archived 状态可能不一致

**场景**：
- phone A 用了 1 年，有 600 archived 节点（压缩过的老记忆）
- phone B 没用过这个角色，0 archived 节点
- phone A 导出：filter archived → 备份没 archived 节点的 vector
- phone B 导入：**phone A 备份里有 memoryNode（archived=true）但没 vector**
- phone B 现在的状态：archived 节点没 vector（但反正不召回，OK）

**复活场景**（极罕见）：
- 用户在 phone B 上"复活"了某个 archived 节点（恢复成活节点）
- 但 phone B 上**没有 vector**（备份没导，phone B 自己也没算过）
- → 复活后召回不到这条记忆（直到重新 embedding）

**判断**：这个 trade-off **可接受**——"复活 archived 节点"是非常罕见的操作。

### 4. 三层优化叠加效果

| 优化 | 节省 | 备注 |
|---|---|---|
| A1 base64 压缩 | 62% | number[] 14 字节/维 → base64 5.4 字节/维 |
| A2 archived 不导 | 50-60% vectors | 取决于 archived 节点占比 |
| B 增量恢复 | 80-90% 后续备份 | 只含 lastRestoreAt 之后的数据 |

**叠加预期**：
- 首次轻量备份：16M（A1 前）→ 8M（A1 后）→ 3-4M（A1 + A2）
- 完整备份：~36M → ~15M（同样叠加）
- 后续增量：8M → 几百 KB

## 备注

- 这次 A2 是 A1 + B 之外的**第三个**优化，三件套覆盖了"首次体积 / 后续体积 / 恢复语义"三大问题
- 之前 changelog `2026-07-21-backup-base64-and-incremental.md` 是 A1 + B
- 这次 changelog 是 A2
- B 量化（Float32 → Int8）方案**未做**——暮色没选，副作用是精度损失
