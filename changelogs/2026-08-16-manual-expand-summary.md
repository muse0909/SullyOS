# 2026-08-16 手动拆分 summary 工具 + 扫描扩展 + 情绪中文化

暮色 8-16 反馈：
1. 1.8 万字超长 summary 节点被云端同步复活成 `isBoxSummary=false, eventBoxId=null, archived=false` 的独立记忆，`scanGhostSummaries` 扫不到
2. 想要"手动拆分"工具：自己从 summary 文本复制段落，填到独立片段里，提交后生成 15 条独立记忆。原 summary 节点不动，他手动删
3. 编辑记忆的"情绪"下拉显示英文（`anxious` 等），要改成中文

## 涉及改动

### 1. 扩展 `scanGhostSummaries` 扫描条件（`utils/memoryPalace/eventBox.ts`）

**原因**：老版本 `dissolveEventBox` 走"降级保存"路径，把 summary 节点的 `isBoxSummary` 改成了 `false` + `archived=false` + `eventBoxId=null` 并 save 触发云端上传。云端按时间序：先 false 复活 → 后 deleted=true 保守策略不删，结果 summary 节点被复活成普通独立记忆，`isBoxSummary=false`，原 `scanGhostSummaries`（只扫 `isBoxSummary=true`）扫不到。

**改后**：加第二个判断分支——`isBoxSummary=false` 但符合幽灵 summary-like 特征：
- `eventBoxId === null`
- `content.length >= 1000`（典型 summary 超长，独立小段记忆很少这么长）
- `importance >= 7`（summary 通常高重要度）

**误伤风险**：用户手动写的超长独立记忆（content >= 1000 字 + importance >= 7）会被误判。极少见，弹窗里每条显示完整内容，暮色自己判断要不要拆 / 删。

### 2. 手动拆分 summary UI（`apps/MemoryPalaceApp.tsx`）

**流程**：
1. 暮色点"扫描幽灵 summary"按钮（事件盒管理视图右上红框）
2. 弹窗显示扫到的幽灵 summary 列表
3. 每条右上有"🪓 拆"按钮（橙色）+ "删除"按钮（红色）
4. 暮色点"🪓 拆" → 打开手动拆分弹窗
5. 弹窗左边显示 summary 全文（只读，可复制），右边填入每条独立记忆
6. 暮色从 summary 复制段落 → 粘贴到片段输入框
7. 每条片段可改：内容 / 时间戳（默认现在）/ 重要度（默认 summary 原值）
8. 暮色可加 / 删片段
9. 暮色点"✓ 拆出 N 条独立记忆" → 循环 `MemoryNodeDB.save(node)` 创建 N 条新记忆
10. 原 summary 节点**不动**（暮色手动删）

**新节点状态**：
- `id`: `mem_${Date.now()}_${rand}`（跟其他新记忆一致）
- `charId`: 当前角色
- `content`: 片段内容
- `room`: `living_room`（默认，可改）
- `tags`: 空数组
- `importance`: 暮色填
- `mood`: `peaceful`（默认）
- `embedded`: false
- `createdAt`: 暮色填（默认现在）
- `lastAccessedAt`: 暮色填的时间
- `accessCount`: 0
- `sourceId`: null
- `origin`: `'system'`（手动生成）
- `eventBoxId`: null
- `archived`: false
- `isBoxSummary`: false

**时间戳方案 B+C**：默认 = 现在（暮色拆分时间）+ 暮色可改 + 从 summary 文本手动读时间线索。

### 3. 情绪中文化（`apps/MemoryPalaceApp.tsx`）

**位置**：
- `view === 'memory'` 块：加 `MOOD_LABELS` 映射 + 修 5197 行 `<option>` 显示 + 修 5267 行详情页显示

**映射**：
```ts
const MOOD_LABELS: Record<string, string> = {
    happy: '开心', sad: '伤心', angry: '生气', anxious: '焦虑',
    tender: '温柔', peaceful: '平静', excited: '兴奋', nostalgic: '怀念',
    frustrated: '沮丧', hopeful: '有希望', lonely: '孤独', grateful: '感激',
};
```

**value 保留英文**（IDB 里存的是英文 enum，不动），**只改显示文字**。

## 涉及文件

- `utils/memoryPalace/eventBox.ts` — 扩展 `scanGhostSummaries`
- `apps/MemoryPalaceApp.tsx` — 加 state / handlers / 🪓 拆按钮 / 拆分弹窗 / 情绪中文化
- `changelogs/2026-08-16-manual-expand-summary.md` — 本文件

## 风险 / 注意事项

1. **误伤**：扩展 `scanGhostSummaries` 扫描条件可能误伤用户手动写的超长独立记忆（content >= 1000 + importance >= 7）。弹窗显示完整内容由暮色判断
2. **原 summary 节点不删**：暮色明确要"手动删"，避免误删（他可能想先检查拆出来的对不对）
3. **新节点未向量化**：`embedded: false`，暮色可后续手动触发向量化
4. **时间戳格式**：UI 用 `datetime-local` 控件，默认 = 当前时间
5. **8-16 工作流纠正**：先 preview 测 → 暮色 OK → merge master，**不再直接推 master**
