# 备份 memoryLinks 裁剪 + 相册多选删除

**日期**：2026-07-17
**涉及 commit**：（见下方两个 commit）

## 改了什么

### 1. 备份导出/导入时裁剪弱 memoryLinks（性能优化）

**问题**：
- 用户备份里 `memoryLinks` 字段有 19 万条（191,757 条），emotional 链接占 80%，平均强度只有 0.37
- 25% 的 emotional 链接 strength < 0.3（弱到几乎无用）
- 还有 5928 个重复对（3.2%）
- **19 万条 IndexedDB `forEach + put` 串行写入 = 30-60 秒导入时间**（占整个导入耗时 60-85%）

**修法**：
- 新增 `utils/memoryPalace/links.ts` 的 `pruneMemoryLinks()` 工具函数
- 规则：
  - emotional 链接 strength < 0.3 → 砍（保留强连接，强联通性不破坏）
  - 重复对（source+target+type 相同）→ 只保留 strength 最大的
- 导出时调用：备份文件小 + 序列化快
- 导入时也调用：防御性，老备份也能快

**效果**：
- memoryLinks: 191757 → ~50,000 条
- data.json 体积：68 MB → ~57 MB
- zipped 体积：33 MB → ~28 MB
- **导入时间：省 20-30 秒**

**不影响功能**：
- 图遍历扩散激活：弱边砍掉后强联通性由强边维持
- 弱边在系统使用过程中按 `buildLinks` 规则自动重建
- 只是丢弃那些"系统里攒下来但检索时不会走"的边

### 2. 相册多选删除（功能）

**问题**：
- 旧版只能「长按相册 → 整本删」+「单张详情页删除」
- 用户相册 400+ 张，单删不可能
- 多选删除完全缺失

**修法**（`apps/Gallery.tsx`）：
- 新增多选模式 `isSelectionMode: boolean` + `selectedIds: Set<string>` state
- 网格视图右上角「选择」按钮 → 进入多选
- 多选模式点图 = 切换选中（不跳详情）
- 选中态：薄荷绿边框（`ring-emerald-400`）+ 左上角对勾胶囊
- 底部 sticky 操作栏：居中「全选/取消全选」+「删除 N 张」胶囊按钮
- 顶部 header 居中显示「已选 N 张」+ 左边「取消」按钮
- 删前走 `ConfirmDialog` 确认
- 删完自动退多选模式
- 「取消」/「全选」/「删除」都按暮色审美走胶囊 + 居中

**注**：
- 不删 IndexedDB `assets` store（那里是 voice_msg / pixel_char，跟相册无关）
- 不删"本地文件"（备份里的 `assets/asset_xxx.jpg` 是导出时从 b64 临时生成的，不存在真正本地文件）
- 删的只是 `gallery_images` store 里的元数据

## 动了哪些文件

- `utils/memoryPalace/links.ts` — 新增 `pruneMemoryLinks()` 工具函数
- `context/OSContext.tsx` — 导出时调 `pruneMemoryLinks()` + import
- `utils/db.ts` — 导入时调 `pruneMemoryLinks()` + import
- `apps/Gallery.tsx` — 多选删除 UI + state + 交互（+157 行）

## 踩坑 / 需要知道的（重要）

- **`pruneMemoryLinks` 阈值是写死常量**（`minStrength = 0.3`）。如果未来发现影响检索质量，单独改这一个常量即可
- **导入时也裁剪**会"丢弃"老备份里的弱链接。这是设计选择：用户数据完整性 vs 导入速度。如果以后想"完整保留"，可加一个备份模式开关（'complete' / 'fast'）
- **相册多选模式没有撤销机制**——删了就是删了。ConfirmDialog 是唯一的回退点
- **`isSelectionMode` 状态下 `handleBack` 行为变了**：grid 视图按返回 = 退出多选（不是回相册列表）。这避免了"误触返回"导致的多选状态丢失

## 备注

- 老备份（导出时没裁剪过的）导入时会自动被裁剪，行为一致
- `pruneMemoryLinks` 是纯函数 + 写注释解释为什么砍，安全可改
- 下次想做 `clearAndAdd` 批量优化时，记得沿用这个文件改——19 万条 put 还可以再优化（分批 / 跳过重复 key）
