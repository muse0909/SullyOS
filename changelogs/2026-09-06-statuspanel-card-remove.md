# 2026-09-06 状态面板 UI 卡片彻底下线（修 5d71187 漏改的两处）

## 暮色原话（9-6 11:25）
"备忘录页面没显示固定的状态面板。记忆宫殿中的当前状态还存在。"
"需要注意现在是两个版本，网页版和apk版本，更改任何代码都要考虑到两个版本的兼容性。"

## 根因（5d71187 改了一半）
5d71187 「备忘录结构独立分离 + 注入位置调整 + 清理旧状态面板」改了三件事但**漏了关键两步**：

| 项 | 5d71187 状态 |
|---|---|
| 注入位置调整 | ✅ 做了（chatPrompts.ts:226 把 characterMemoBlock 传到 buildCoreContext 第 6 参数） |
| 状态面板拆独立模块 | ✅ 做了（characterMemo.ts 拆 panel + memo，character_status_panels IDB） |
| `utils/memoryPalace/statusPanel.ts` 改 stub | ✅ 做了（getStatusPanel 等全 no-op + warn） |
| `extraction.ts` 不再注入「📌 当前状态面板」 | ⚠️ 表面做了（statusBlock 拼出来是空串） |
| `formatter.ts` 移除 statusPanelSection 逻辑 | ❌ **漏改两处** — 行 113 / 239-240 还在引用未定义变量 `statusPanelSection`（**运行时 ReferenceError**） |
| `components/memoryPalace/StatusPanelCard.tsx` 下线 | ❌ **漏改** — 记忆宫殿顶部还在挂这个卡片！暮色 9-6 看到的就是它（用 stub API 永远显示"暂无状态记录"） |

第 6 项是暮色 9-5 20:32 真正"彻底清理"的最后一步，**没做**。

## 改了什么

### 1. `apps/MemoryPalaceApp.tsx` — 移除 StatusPanelCard
- 行 19：删 `import StatusPanelCard from '../components/memoryPalace/StatusPanelCard'`
- 行 4059-4060：删 `<StatusPanelCard />` 调用 + 替换成说明注释
- 顶部新加 4 行注释解释"5d71187 漏删 + 暮色 9-6 反馈"

### 2. `components/memoryPalace/StatusPanelCard.tsx` — 整个文件删除
- 旧 per-user 状态面板的 UI 卡片，用的是 deprecated `getStatusPanel()` / `setStatusPanel()` API
- 数据已迁到 character_status_panels IDB（per-char）
- 新位置在发现页 → 角色备忘录 → 顶部固定显示（CharacterMemoPage.tsx:161-179 已写好）

### 3. `utils/memoryPalace/formatter.ts` — 修 5d71187 漏改的 2 处 stale 引用
- 行 113：`if (results.length === 0 && anticipations.length === 0 && statusPanelSection === '')` 删 `statusPanelSection === ''` — 变量未定义
- 行 239-240：删 `if (statusPanelSection) { output += statusPanelSection; }` 整段 + 注释更新

修这两处至关重要：之前 expandAndFormat 在"results + anticipations 同时空"边界情况下会**抛 ReferenceError**。生产环境没崩可能是因为 call site (`pipeline.ts:1102`) 总有至少一条 results 兜住了。

## 没动什么
- `utils/memoryPalace/statusPanel.ts` **保留**（仍 deprecated stub）— extraction.ts:14-22 还在 import `STATUS_SLOTS` / `StatusUpdate` / `getStatusPanel` / `buildStatusPanelSectionForExtraction` / `applyStatusUpdate`，全 no-op 但 TS 仍引用。要彻底删需要一起改 extraction.ts，本轮范围外
- `utils/memoryPalace/extraction.ts` — 不动
- `apps/CharacterMemoPage.tsx` — 不动（状态面板 UI 已经在顶部固定显示，逻辑对的）
- `utils/characterMemo.ts` — 不动（数据层已对）
- `utils/chatPrompts.ts` — 不动（注入位置调整 5d71187 做了）

## 两个版本兼容性说明
暮色 9-6 强调"网页版和 apk 版本都要考虑"。

按 8-29 拓扑笔记：**手机 APK 走 `sully-muse-vert.vercel.app`（跟 preview 分支同源）**。所以：
- 本次 3 处改动都是纯前端 TSX/TS，不动 android/ 目录
- push preview 后 Vercel 自动部署，约 1-3 分钟手机刷到
- **APK 不需要重新打包**（Capacitor 远程加载模式，server.url 指向线上）
- 如果手机没刷到：APK 端 WebView 自带 HTTP 缓存可能持有旧版（service worker 不缓存，HTTP 缓存不能排除），按 4f21ac9 的"APK WebView 缓存根治（4 步）"清理

## 验证
- `npx tsc --noEmit` — 3 处改动相关 0 新错（剩 MemoryPalaceApp.tsx 13 处历史 "char possibly undefined" 错误，跟本轮无关，stash 验证过）
- `npm run build` — ✓ 4.43s 通过
- `grep -rn "StatusPanelCard" --include="*.ts" --include="*.tsx"` — 0 命中（除我自己注释里提到的）

## 暮色下次测试预期
- 打开记忆宫殿 → 顶部**不再有**"📌 当前状态面板"卡片（位置变成搜索框直接连七个房间）
- 打开发现页 → 角色备忘录 → 如果角色有通过 [[MEMO_SET_STATUS: ...]] token 写过 status，**顶部固定显示**5 槽位（所在地/身体/在忙/情绪/约定/待办）；没写过就显示 EmptyState
- 写新 status 后等 1-2 秒（IDB + memo-updated 事件触发 CharacterMemoPage 重读）
