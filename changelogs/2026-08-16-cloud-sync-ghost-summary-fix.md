# 修幽灵整合回忆 + 加扫描工具

**日期**：2026-08-16
**涉及 commit**：(本任务，1 个 commit)

## 改了什么

暮色 8-16 反馈：解散事件盒后看到 1.8 万字超长整合回忆（"记忆系统重建全程"盒的 summary 节点）没被删，作为独立记忆残留。

## 根因

`removeMemoryFromBox` 对 summary 节点走"降级保存"路径（`isBoxSummary=false, archived=false, eventBoxId=null` 保存到 IDB），触发 `enqueueUploadMemory(node, false)` 上传云端（**`deleted=false`** 当新记忆）。然后 `deleteMemoryNode` 接着 `MemoryNodeDB.delete` 才上传 `deleted=true` 软删标记。

云端按时间序：先 false（降级 summary 节点作为新记忆）→ 后 true（软删标记）。`useCloudMemories` 拉取时：
- 收到 false：`MemoryNodeDB.save(cm as MemoryNode)` → **降级 summary 节点复活到本地**
- 收到 true：保守策略不删本地

**结果**：summary 节点永久复活成独立记忆。

## 修复

### 1. `removeMemoryFromBox` 改 summary 节点走"直接删"路径（`eventBox.ts`）

之前：所有节点走同一路径（先"降级保存"再让调用方决定删不删）。  
改后：summary 节点**走单独分支** —— 断 box 引用 + `MemoryNodeDB.delete` + 上传 `deleted=true` 软删标记 —— **绕过"降级保存"上传**。

普通节点原流程不变（移出但不删）。

### 2. 加 `scanGhostSummaries` 工具函数（`eventBox.ts`）

扫某角色所有 `isBoxSummary=true` 但 `eventBoxId` 指向 null / 不存在盒的记忆 —— 这些是云端同步复活的幽灵 summary 节点。按 content 长度倒序返回。

### 3. 加 `deleteGhostSummary` 工具函数（`eventBox.ts`）

调 `deleteMemoryNode` 删单条幽灵 summary。

### 4. UI 入口（`MemoryPalaceApp.tsx`）

事件盒视图顶部"管理事件盒"按钮旁加"🔍 扫描幽灵 summary"按钮：

- 永远显示（独立于 `allBoxes.length`，因为幽灵 summary 跟盒数量无关）
- 点击 → 扫描 → 弹窗列出
- 弹窗逐条显示长度/重要性/创建日期/前 200 字预览 + 单条"删除"按钮
- 顶部"批量删除全部"按钮（双重 confirm）
- 删完即时刷新列表

## 涉及文件

- `utils/memoryPalace/eventBox.ts` — 修 `removeMemoryFromBox` + 加 `scanGhostSummaries` + 加 `deleteGhostSummary`
- `apps/MemoryPalaceApp.tsx` — 加 state / handlers / 按钮 / 弹窗

## 踩坑 / 需要知道的

### 1. 不是改 `deleteMemoryNode` 本身
`deleteMemoryNode` 是**通用**函数（`MemoryPalaceApp.deleteMemory` 和 `dissolveEventBox` 都用）。改它内部行为风险大。改 `removeMemoryFromBox` 的 summary 节点分支 + `dissolveEventBox` 已经足够覆盖主路径。

### 2. 旧幽灵 summary 节点怎么清
修了这个 bug 后，**新解散**盒不会再产生幽灵 summary。但暮色 IDB 里**已经存在**的幽灵 summary（之前 303 个盒解散留下的）需要手动清。**修了这个 bug 后，暮色手机端进入事件盒视图 → 点"🔍 扫描幽灵 summary" → 弹窗逐条删 / 批量删**。

### 3. `useCloudMemories` 的"保守策略"仍可优化（次要 bug）
云端 `deleted=true` 软删标记到达时，本地有这条仍不删。这是为避免"云端延迟造成的误删"。但对 summary 节点场景仍会保留幽灵 —— **主 bug 修后这个场景不再触发**（不再有 false 先到的情况）。保留保守策略作为防御。
