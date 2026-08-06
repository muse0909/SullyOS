# 记忆宫殿：编辑自动重跑向量 + 6 项改进

**日期**：2026-08-07
**涉及 commit**：`ab4d969` `8f31061` `0b50b4a`

## 改了什么

### 1. A. 编辑记忆节点后自动重跑 embedding
- `apps/MemoryPalaceApp.tsx:997` 的 `handleSaveEdit` 检测 content 变化
- 旧 `embedded` 且 content 变了 → 标 `embedded=false`，save 后异步 `vectorizeAndStore` 重跑
- 复用 pipeline.ts:1483 纠正路径的同款范本（`skipDedup: true`）
- 失败 toast，成功 setSelectedNode 同步 `embedded=true`
- 只针对 content（向量只跟 content 相关；room/importance/mood/tags 不影响）

### 2. B. 一键向量化进度条悬浮窗
- 顶部胶囊（z-150，absolute top-76px）显示：
  - 旋转 spinner + "一键向量化中"
  - "第 N/5 轮" + "已处理 X · 剩 Y"
  - 进度条（百分比 = processed / 总数）
- 启动时先算总未处理数（`getMemoryPalaceHWM` + `DB.getMessagesByCharId`）
- finally 清掉 state
- 与现有 `memoryPalaceStatus` 胶囊同位置（不同场景自动切换显示）

### 3. C. 一键向量化开始确认弹窗
- 抽屉内按钮 onClick 改 `setShowVectorizeConfirm(true)`
- 用项目级 `Modal` 组件（z-210 盖过抽屉 200）
- 复用现有 `unvectorizedCount`（ChatSettingsDrawer:167-186 已会算）
- 文案：当前有 N 条未向量化 + 170条/轮、5轮、1-2 分钟
- 0 条时显示"已全部处理完毕，无需操作 🎉"
- 未加载好（===null）显示"正在统计未处理消息..."
- 2 按钮：取消 / 开始向量化
- 改 return 结构：`return createPortal` → `const drawerNode + <>drawer + Modal</>`

### 4. D+E. 记忆整理结果弹窗加编辑/删除（D7 方案）
- 抽离 `MemoryReviewModal` 组件（新文件 `components/chat/MemoryReviewModal.tsx`）
- 两路复用：自动提取（useChatAI.ts:4401）+ 一键向量化完成（handleForceVectorize）
- 每条记忆右上角 ✏️ 编辑 / 🗑️ 删除 按钮
  - 编辑：行内 textarea → 保存草稿（Map 累积）
  - 删除：标记 pendingDeletes，UI 灰化
- 顶部 header 显示 pending 数（X 条待编辑 · Y 条待删除）
- 底部 2 按钮：取消（丢弃）/ 确认（提交所有 pending）
  - 确认时按钮变橙 + 显示"确认（N 项变更）"
- 提交顺序：先删除（避免 ghost id）→ 再编辑（跳过已删）
- 编辑重跑 embedding（照搬 A 范本）
- 删除清理 vec/links/node（照搬 DedupeView 范本）
- **PipelineResult.memories 加 id 字段**（之前 display-only 形态）
- **ForceVectorizeResult 加 allExtractedMemories**（5 轮累积）
- Chat.tsx handleForceVectorize 完成后构造 PipelineResult-like → setMemoryPalaceResult

### 5. F. 查重功能加一键真合并两条
- 新 `realMergeMemories(charId, keepId, dropId, mode)` 函数（`utils/memoryPalace/eventBox.ts`）
  - `keep_a` / `keep_b`：留一条，删另一条
  - `concat`：A+B 拼接 content + tags 去重并集 + importance 取 max + 触发重跑 embedding
- 删除走完整清理：解绑 EventBox → 清 vec → 清 links → 删 node
- DedupeView 加"真合并两条"按钮（红色，醒目）
- 旧"合并到同一事件盒"改名"绑到同一事件盒"（避免歧义）
- 真合并走弹窗：3 选项（保留 A / 保留 B / 拼接）+ 取消

## 动了哪些文件

- `apps/MemoryPalaceApp.tsx` —— handleSaveEdit 加重跑逻辑 + DedupeView 加真合并按钮 + 新增 RealMergeModal 内联组件
- `utils/memoryPalace/eventBox.ts` —— 加 `realMergeMemories` 函数 + 导入 vectorizeAndStore/MemoryLinkDB/MemoryVectorDB
- `utils/memoryPalace/index.ts` —— export `realMergeMemories` + type `RealMergeMode`
- `apps/Chat.tsx` —— 加 `vectorizeProgress` state + 进度条胶囊渲染 + handleForceVectorize 加 onProgress setState + 加 handleReviewEdit/Delete + useOS 拿 remoteVectorConfig + 替换原弹窗为 MemoryReviewModal
- `components/chat/ChatSettingsDrawer.tsx` —— 加 `showVectorizeConfirm` state + Modal 渲染 + 改 return 结构
- `components/chat/MemoryReviewModal.tsx` —— **新文件**，D7 弹窗组件
- `utils/memoryPalace/forceVectorize.ts` —— 加 `allExtractedMemories` 字段 + 累积逻辑
- `utils/memoryPalace/pipeline.ts` —— `PipelineResult.memories` 加 `id` 字段

## 踩坑 / 需要知道的（重要）

### 1. handleSaveEdit 重跑时机
- 保存时设 `embedded=false` → `MemoryNodeDB.save(updated)` 立即写 IndexedDB
- 然后异步 `vectorizeAndStore`（不 await）→ 内部会再 save 一次（embedded=true）
- 用户操作不阻塞，编辑面板立刻关闭，进度在 toast 里
- **失败时**：节点保持 `embedded=false`，下次 forceVectorize 会自动重试
- **取消**（如编辑完想撤销）：用户走"取消"按钮（不走 handleSaveEdit）→ 节点不变

### 2. vectorizeAndStore 内部会重复 save
- 入口：先 `MemoryNodeDB.save(updated, embedded=false)`
- vectorizeAndStore 内部：会再 `MemoryNodeDB.save(node, embedded=true)`（`vectorStore.ts:71`）
- 两次写入之间 bm25Index.onNodeSaved 会被调用两次，第二次 content 没变 contentSig 相同 → 跳过
- **副作用**：WRITE VERIFICATION 日志会出现两次（无害）

### 3. 一键向量化 Modal zIndex 210
- ChatSettingsDrawer 抽屉是 z-200，Modal 必须 ≥ 210 才能盖过
- 跟 Chat.tsx:2580 的清空确认弹窗同款（z-210）

### 4. 进度胶囊用 absolute 而非 createPortal
- 现有 memoryPalaceStatus 胶囊（Chat.tsx:2628）用 absolute + z-150
- 我的新胶囊用同款结构，**不**用 createPortal
- 原因：chatRootClass 没有 backdrop-filter/transform 祖先，fixed 失效的风险小
- 缺点：胶囊被 chatRootClass 容器裁切，**不会**溢出到手机壳外
- 实际看效果应该 OK，因为手机壳本来就铺满

### 5. realMergeMemories 的 'keep_b' 模式
- 实际是"保留 drop 的内容 + 改 id 为 keep 的 id"——把 drop 当成 keep 来用
- 比 'keep_a'（直接保留 keep 不动）多一步：把 drop 的 content/importance/tags 复制给 keep
- 触发重跑 embedding（因为内容变了）
- **取舍**：调用方传参时要注意 keepId/dropId 顺序——keep_b 模式下 keepId 是"要留的 ID"，但内容是 drop 的

### 6. DedupeView 改"绑到同一事件盒"按钮的颜色
- 之前是 `bg-#0ea5e9`（蓝色，醒目）—— 跟"真合并"按钮（红色，醒目）区分不开
- 改成 `bg-#e0f2fe + text-#0ea5e9`（浅蓝底蓝字）—— 弱化"绑盒"操作（更轻量），突出"真合并"按钮

### 7. MemoryReviewModal 是 post-save 复审模式
- 弹窗里点"确认"≠ "保存"——是"提交 pending 变更"
- 弹窗弹出时记忆已经落库（processNewMessages 内部已调 vectorizeAndStore）
- 暮色 2026-08-07 拍板走 D7：不像 D4 拦截 dry-run，5 轮跑完统一弹
- LLM 调用次数：**不增加**（已经跑过 5 轮 LLM 提取）
- Embedding 调用次数：编辑的条数才调

### 8. 提交顺序：先删后编
- 避免删过的 id 在编辑列表里 ghost（编辑函数找不到 id 会失败）
- 即便用户先编辑后删除，最终只删不编（编辑被 skip）
- 双重保险：handleConfirm 里 if (pendingDeletes.has(id)) continue

### 9. ForceVectorizeResult.allExtractedMemories 是冗余字段
- 理论上 PipelineResult.memories 已经有了，但 forceVectorize 内部循环 5 轮
- 上层 caller 拿不到"每轮 result"，只能在 result 里手动累积
- 跟 accumulatedFragments 同款 pattern

## 备注

### 已完成
- 全部 5 个 todo：A / B / C / D+E / F 都过 build + commit

### 其他改进空间（暮色没要，备忘）
- handleSaveEdit 的 toast 提示可以更详细（哪个步骤成功/失败）
- 真合并 modal 可以预览拼接结果（A+B 实际拼出来长啥样）
- 进度胶囊可以加"X%"百分比显示
- MemoryReviewModal 提交时可以走批量 save（一次事务），现在是循环 await（每个 await 触发云端同步队列）
