# 记忆宫殿：编辑自动重跑向量 + 6 项改进

**日期**：2026-08-07
**涉及 commit**：`ab4d969` `8f31061`

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

### 4. F. 查重功能加一键真合并两条
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
- `apps/Chat.tsx` —— 加 `vectorizeProgress` state + 进度条胶囊渲染 + handleForceVectorize 加 onProgress setState
- `components/chat/ChatSettingsDrawer.tsx` —— 加 `showVectorizeConfirm` state + Modal 渲染 + 改 return 结构

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

## 备注

### 待办（暮色继续讨论中）
- **4. D+E 提取后待确认弹窗**（编辑/删除）：等暮色拍板 D7 vs D4
  - 现状：`memoryPalaceResult` 弹窗（Chat.tsx:2662）已有"只读"形态
  - 暮色要：加编辑/删除按钮
  - **结论核对**：D7 不会增加 LLM 调用，只增加 embedding（编辑数）—— 走 D7 合理

### 其他改进空间（暮色没要，备忘）
- handleSaveEdit 的 toast 提示可以更详细（哪个步骤成功/失败）
- 真合并 modal 可以预览拼接结果（A+B 实际拼出来长啥样）
- 进度胶囊可以加"X%"百分比显示
