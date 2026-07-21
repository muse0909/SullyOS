# 记忆宫殿 memoryLinks 暴增 bug 修复 + dedup API

**日期**：2026-07-21  
**涉及 commit**：`d0744f9`

## 改了什么

暮色 2026-07-21 15:30 问"数据定期压缩吗"——跑诊断看到**惊人数字**：

| store | 条数 | 大小 |
|---|---|---|
| `memory_vectors` | 1918 | 77 MB |
| **`memory_links`** | **295555** | **43 MB** ← 异常暴增 |
| `assets` | 27 | 12.7 MB |
| `characters` | 3 | 10.4 MB |
| `gallery` | 504 | 8.3 MB |
| `user_profile` | 1 | 2.7 MB |
| `memory_nodes` | 2045 | 1.4 MB |
| `messages` | 3541 | 0.95 MB（实际不大，不用动） |

**总磁盘 ≈ 156 MB**。`memory_links` 295555 条 / 43 MB 是**绝对异常**——正常 1 年用 5-10 条 / 节点，**144 条/节点**说明跑了几百次 pipeline 累积。

### 根因（真 bug）

`utils/memoryPalace/links.ts:buildLinks`（line 136-220）：

```ts
// batch 内用 linkSet 去重（基于 makeKey）
const linkSet = new Set<string>();
// ... 构造 links[]
// 跨 batch 没去重！
await MemoryLinkDB.saveMany(links);
```

`utils/memoryPalace/db.ts:MemoryLinkDB.saveMany`（line 476）：

```ts
saveMany: async (links: MemoryLink[]): Promise<void> => {
    // ... 只 put，不查重
    for (const link of links) {
        store.put(link);  // ← link.id 永远不同（ml_${Date.now()}_${random}），全都 put 成功
    }
};
```

**Bug 链路**：
- pipeline 每次跑都建 link
- `link.id = generateId()` = `ml_${Date.now()}_${Math.random()...}` → **每次 id 不同**
- batch 内有去重（`linkSet` 用 `makeKey(sourceId, targetId, type)`）
- 但**跨 batch**没去重
- 同一条 link 多次 put 都成功（因为 keyPath 是 id，新 id 不冲突）
- 295555 条 = 跨几百次 pipeline 累积

### 修法

**1. `MemoryLinkDB.saveMany` 加去重**（避免再增）：

```ts
// 暮色 2026-07-21：去重（按 sourceId + targetId + type）
// - A-B 和 B-A 视为同一对（跟 makeKey 一致）
// - batch 内去重
// - 跟历史 link 去重（先 getAll() 查 key set）
const [a, b] = link.sourceId < link.targetId
    ? [link.sourceId, link.targetId]
    : [link.targetId, link.sourceId];
const key = `${a}__${b}__${link.type}`;
```

**2. `MemoryLinkDB.deduplicateAll()` 一次性清理**（清理历史暴增）：

```ts
deduplicateAll: async (): Promise<{ before: number; after: number }> => {
    // 按 (sourceId + targetId + type) 分组
    // strength 取所有重复里的最大值（保留最强关联）
    // 清空 + 重新 put
};
```

**3. 暴露 API**（console 一键调用）：

- `utils/db.ts`: `DB.memoryLinkDB = MemoryLinkDB`
- `index.tsx`: `window.__SULLYOS_DB__ = DB`（dev 工具）

**用法**：
```js
// DevTools Console（F12）
await __SULLYOS_DB__.memoryLinkDB.deduplicateAll()
// 预期返回 { before: 295555, after: 2000-5000 }
```

## 动了哪些文件

- `utils/memoryPalace/db.ts` —— MemoryLinkDB.saveMany 去重 + 新增 deduplicateAll 方法
- `utils/db.ts` —— 顶部 import MemoryLinkDB + DB 对象加 `memoryLinkDB: MemoryLinkDB`
- `index.tsx` —— `window.__SULLYOS_DB__ = DB` 挂载

## 踩坑 / 需要知道的（重要）

### 1. 这是个 **真 bug**，不是"数据自然增长"

memoryLinks 295555 / 2045 = 144 条/节点 是**异常**——正常预期 5-10 条/节点。pipeline 跑了 N 次累积是 bug，**不是** 设计如此。

### 2. saveMany 首次 dedup 会慢

`saveMany` 现在用 `getAll()` 查历史 key set，**首次**调用（在 295555 条基础上）会很慢（getAll 全表 + filter）。后续调用 fast（数据少了）。

**优化路径**（暂未做）：
- 加 `getAllKeysByCharId`（按 charId 索引查）→ 不用 getAll 全表
- 但需要新加索引 + schema 变更 → **留 V2**

### 3. deduplicateAll 是 fire-and-forget 工具

`deduplicateAll()` 是给暮色**一次性清理**用的。运行后：
- 295555 → 几千条
- 磁盘 43 MB → 几百 KB
- 总磁盘 156 MB → 110 MB 左右

之后代码层（`saveMany` 去重）保证**不再增**。

### 4. 删旧 link 不会影响召回质量

`MemoryLink` 召回时只关心 `strength`（共同激活时 +0.05）—— strength 取所有重复里的最大值（保留最强关联），所以**不影响**。

### 5. 其他 store 的"自然增长"评估

| store | 评估 | 是否需要压缩 |
|---|---|---|
| `memory_vectors` 77 MB | 1918 条 / 41 KB/条（base64 5.4KB + 元数据）—— 正常 | 否（已有 A2 导出优化，磁盘本身不动） |
| `assets` 12.7 MB | 27 条 / 470 KB/条（用户资源，难压缩） | 否 |
| `characters` 10.4 MB | 3 条 / 3.5 MB/条（sprite + 头像 + roomConfig） | 否（用户美化） |
| `gallery` 8.3 MB | 504 条 / 16 KB/条（用户相册） | 否 |
| `user_profile` 2.7 MB | 1 条（头像 base64 大） | 否 |
| `messages` 0.95 MB | 3541 条 / 270 B/条（纯文字）—— **实际不大** | **否**（我之前误判了） |

**结论**：除了 `memory_links` 暴增需要修，其他 store 增长都是合理的（用户数据自然积累）。

## 备注

- **未做**：memoryVectors 磁盘 77 MB 优化（已有 A2 导出优化，磁盘本身 77 MB 是设计如此）
- **未做**：V2 优化（按 charId 索引查 link，避免 getAll 全表）
- **未做**：定期清理任务（OSContext 加个定时任务，每天跑一次 dedup）—— 暮色没要，留 V2
- 之前 7-21 changelog `2026-07-21-backup-skip-archived-vectors.md` 是 A2 导出优化（减小**备份**文件），跟这次**磁盘**优化不冲突
- 这次是**磁盘**优化（减小 IndexedDB 数据量本身），跟 A2 互补——A1+A2+B 减小**备份**文件大小，这次减小**本地存储**大小
