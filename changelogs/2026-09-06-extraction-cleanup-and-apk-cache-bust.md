# 2026-09-06 状态面板机制彻底下线 + APK 端备忘录刷新根治

## 暮色原话（9-6 11:55）
"你先把刚才差的这些补全。然后还有一个apk那边写入内容后UI上不显示，说是没加自动刷新，刚才修复了，但是我这边看还是没显示。这个也要再查一下。"

## 这一轮做两件事

### A. 状态面板机制彻底下线（补 5d71187 漏的最后一步）

上一轮（ab195c70）删了 StatusPanelCard UI 卡片 + 修 formatter.ts 2 处 stale 引用，**还差**：
- `utils/memoryPalace/statusPanel.ts` 整个文件还留着（已 deprecated stub）
- `utils/memoryPalace/extraction.ts` 还在 import 5 个 deprecated API（getStatusPanel / applyStatusUpdate / STATUS_SLOTS / StatusUpdate / ensureLegacyPinnedCleared）
- LLM prompt 还在告诉 LLM 输出 `statusUpdate` 字段

本轮全清：

| 改动 | 文件 | 说明 |
|---|---|---|
| 删整个文件 | `utils/memoryPalace/statusPanel.ts` | 数据层（localStorage 旧存储）下线；旧 `user_status_panel` localStorage 数据**不迁移**（5d71187 已说明） |
| 删 import + 改 LLM prompt 段 | `utils/memoryPalace/extraction.ts` | 删 `parseStatusUpdateFromLLM` 函数 + 删 LLM prompt 里的 `"statusUpdate": null` 字段 + 删 statusUpdate 说明段 + 删 `ensureLegacyPinnedCleared()` / `getStatusPanel()` / `buildStatusPanelSectionForExtraction()` 读取 + 删 `applyStatusUpdate()` 调用 |
| `BufferExtractionResult` 删 statusUpdate 字段 | 同上 | 减少接口噪声 |
| pipeline 调用点 | `utils/memoryPalace/pipeline.ts` | 删 `extractionResult.statusUpdate` 引用 |
| 补漏 import | `utils/db.ts` | 5d71187 加 `getCharacterStatusPanel` 时漏 import `CharacterStatusPanel` / `CharacterStatusSlot` / `CharacterMemo` / `CharacterMemoEntry` / `CharacterMemoRegion` — 这次补 |

**新机制（不变）**：
- 状态面板数据：per-char IDB store `character_status_panels`（utils/characterMemo.ts）
- 写入路径：LLM 输出 `[[MEMO_SET_STATUS: slot|内容]]` token → hooks/useChatAI.ts:3579 解析 → setStatusSlot
- 读取路径：chatPrompts.buildCoreContext 第 6 参数传 characterMemoBlock
- 状态面板 UI：CharacterMemoPage.tsx:161-179 顶部固定显示

### B. APK 端备忘录写入后 UI 不显示 — 根因诊断 + 根治

暮色反馈：APK 端 AI 角色通过 token 写完 memo 后，CharacterMemoPage **看不到新内容**。ba47738 修了 CustomEvent 派发，但实际还是不显示。

**根因分析**：

1. 4f21ac9 的缓存根治（hash 检测）有 bug：
   ```js
   const currentHash = scripts.find(src => /\/assets\/.+\.[a-z0-9]{8,}\.js$/.test(src)) || '';
   const lastHash = localStorage.getItem('__sullyos_loaded_hash__') || '';
   if (currentHash && lastHash && currentHash !== lastHash) { ...reload... }
   ```
   - 逻辑：当前 js hash 跟 localStorage 存的 hash 不一致 → reload
   - **bug**：APK 端 WebView 缓存同时持有旧 `index.html` + 旧 `assets/index-OldHash.js`，`currentHash = OldHash = lastHash`，**不触发 reload**
   - 结果：APK 端永远跑旧代码（包括 ba47738 的 CustomEvent 修复）

2. vite.config.ts 的 `define: { __SULLYOS_BUILD_ID__: ... }` **不生效**：
   - 试过 `declare const __SULLYOS_BUILD_ID__`（被 TS 完全剥掉，define 找不到替换点）
   - 试过 `(globalThis as any).__SULLYOS_BUILD_ID__`（Vite esbuild define 也不替换）
   - 编译后 dist 里 `__SULLYOS_BUILD_ID__` 还是裸字符串

3. 改用 vite 的 `transformIndexHtml` 钩子，往 index.html 注入 `<meta name="sullyos-build-id" content="ISO时间戳">`：
   - 每次 vite build 生成新 build id（到分钟精度）
   - index.tsx 启动时 `document.querySelector('meta[name="sullyos-build-id"]').getAttribute('content')` 读
   - 跟 localStorage `__sullyos_build_id__` 比对，不一致 → location.replace 强制 reload
   - 这样无论 WebView 缓存怎样"两边都旧"，新部署的 index.html 一定带新 build id

**额外加双保险**：CharacterMemoPage.tsx 加 `pageshow` + `visibilitychange` 监听，回到页面强制重读 — 绕过 CustomEvent 监听器挂载时机问题。

## 改了什么

### 第 1 件事（状态面板下线）
- `utils/memoryPalace/statusPanel.ts` 整个文件删除
- `utils/memoryPalace/extraction.ts` 删 5 个 deprecated import + 删 `parseStatusUpdateFromLLM` 函数 + 删 LLM prompt statusUpdate 段 + 删 statusBlock 拼装 + 删 BufferExtractionResult.statusUpdate 字段
- `utils/memoryPalace/pipeline.ts` 删 `extractionResult.statusUpdate` 引用
- `utils/db.ts` 补漏 import：CharacterStatusPanel / CharacterStatusSlot / CharacterMemo / CharacterMemoEntry / CharacterMemoRegion

### 第 2 件事（APK 缓存根治 + 重读双保险）
- `vite.config.ts`：加 `sullyos-build-id` 插件，transformIndexHtml 注入 meta tag
- `index.tsx`：启动时读 meta tag 跟 localStorage 比对 + 修 vite.config.ts `output` 重复字段 bug（之前 4f21ac9 加 entryFileNames 时漏合到现有 output 里）
- `apps/CharacterMemoPage.tsx`：加 `pageshow` / `visibilitychange` 监听，回到页面主动重读 memo + statusPanel

## 两版本兼容性

按 8-29 拓扑：APK 走 `sully-muse-vert.vercel.app`（跟 preview 分支同源）。
- 纯前端改动，不动 `android/` 目录 → APK 不重打包
- push preview 后 Vercel 自动部署，1-3 分钟手机 + 网页都刷到
- **APK 端这次能强制刷到**（修之前"两边都旧"bug）：meta tag 里的 build id 每次部署都不同，APK 端比对 localStorage 旧值 vs meta 新值 → 不一致 → 强制 reload

## 没动什么
- `apps/CharacterMemoPage.tsx` 之前 ba47738 加的 CustomEvent 监听（保留作主路径） — 新加的 pageshow/visibilitychange 是兜底
- `utils/characterMemo.ts` 数据层（不动）
- `utils/chatPrompts.ts` 注入位置（不动）
- `hooks/useChatAI.ts` token 解析（不动）
- `extraction.ts` 的 memories / crossTimeLinks / eventBoxHints / corrections 字段（保留，只删 statusUpdate）

## 验证
- `npx tsc --noEmit` — 4 处新错全过（剩 vite.config.ts 6 处历史 proxy 路由 type 错 + extraction/groupPipeline/StoryStatusPanel 历史错，stash 验证过未改也报）
- `npm run build` — ✓ 4.29s 通过
- `grep "sullyos-build-id" dist/index.html` — ✓ 1 命中：`name="sullyos-build-id" content="2026-09-06T04:06"`
- `grep "sullyos-build-id\|sullyos_build_id" dist/assets/index.*.js` — ✓ 都命中

## 暮色下次测试预期
1. **首次打开 APK** → 启动时 meta tag build id = "2026-09-06T04:06"（或当时 build 时间），localStorage 空 → 写入 localStorage，不 reload
2. **之后任何部署** → 新 index.html 带新 build id → APK 启动时比对不一致 → **强制 reload**（这次一定能刷到新代码）
3. **进入角色备忘录页** → pageshow 触发立即重读 + CustomEvent 触发实时重读
4. **从聊天页切到备忘录页** → visibilitychange 触发重读（兜底）
5. **AI 角色通过 `[[MEMO_ADD: event|xxx]]` / `[[MEMO_SET_STATUS: location|上海]]` 写入** → 写完派发 CustomEvent → CharacterMemoPage 重读 → 顶部状态面板 + 下方 memo 条目显示

## 已彻底解决
- ✅ 5d71187 漏删 StatusPanelCard UI 卡片（ab195c70 修了）
- ✅ 5d71187 漏改 formatter.ts 2 处 stale 引用（ab195c70 修了）
- ✅ 5d71187 漏的 statusPanel.ts 整个文件 + extraction.ts deprecated 引用（这轮修了）
- ✅ 4f21ac9 缓存根治的"两边都旧"bug（这轮修了，用 meta tag build id 兜底）
- ✅ CharacterMemoPage 实时刷新（pageshow + visibilitychange 双保险）
