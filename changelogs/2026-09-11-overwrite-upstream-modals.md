# 2026-09-11 归档：覆盖 upstream 两个 modal + 修报错（暮色 21:59 指令）

## 改了什么

按暮色 21:59 指令"重新覆盖upstream/master的这两个文件，然后逐条修复新增的TS报错"：

### 1. `components/chat/ActiveMsg2SettingsModal.tsx`（762 行 → 当前行数）
- **覆盖**：从 upstream/master 拉 762 行覆盖 SullyOS 原 367 行
- **修报错**：
  - 删 import：`isInstantChatReady`（amsgInstantChat 缺）/ `syncAmsgLlmCredentials`（amsgStateSync 缺）/ `buildUserCancelledNotices`（amsg2TaskContext 缺）/ `trackEvent`（analytics 缺）
  - 改 onSave 签名：updater 形态 → **plain object 形态**（暮色 21:59 拍板）
  - 删 state：`tasks` / `instantChatOn` / `globalInstantChatOn` / `editingTaskUuid` / `knownRemoteUuids` / `remoteTaskInfo` / `lastSkip` / `now`
  - 删 useEffect：防穿帮闸 / 远端对账 / 即时对话开关检测
  - 删函数：`buildConfig`（updater 形态）→ 重写为 `buildNextConfig`（plain object）/ `handleToggleInstantChat` / `writeCancelledNotices` / `handleCancelTask`
  - 删 `handleSubmit` 里的：tasks.map / editingTaskUuid / clientTaskId / firstSendAt / replacedCancelFailed / refreshCharPendingAiTaskCredentials / applyRemoteTaskDelta
  - 删 JSX 块：即时对话开关 / 防穿帮闸说明 / 任务列表 / 任务编辑
  - 加桩函数：`trackEvent` / `syncAmsgLlmCredentials` / `buildUserCancelledNotices` / `isInstantChatReady`（空函数，给 SullyOS 缺模块的 import 用）

### 2. `components/settings/ActiveMsgGlobalSettingsModal.tsx`（285 行 → 重写后 ~300 行）
- **覆盖**：从 upstream/master 拉 1741 行覆盖 SullyOS 原 285 行
- **修报错**（**大段删功能块**）：
  - 删 import：`fetchWorkerDiagnostics` / `readAmsgFailKind` / `AmsgCronTriggerState`（ActiveMsgClient 缺）/ `AmsgDiagnosticLevel` / `AmsgDiagnosticsProbe` / `buildAmsgDiagnosticRows` / `summarizeAmsgDiagnostics` / `INSTANT_CHAT_BLOCKER_HINTS` / `resolveInstantChatBlocker` / `InstantChatGateInput`（amsgDiagnostics 缺）/ `cancelAllRemoteAmsgTasks` / `isWorkerUrlCleared` / `wipeAmsgCloudData`（amsgStateSync 缺）/ `buildCloudflareDashboardUrl` / `isInstantConfigReady` / `loadInstantConfig` / `saveInstantConfig`（instantPushClient 缺）/ `generateClientToken`（vapidGen 缺）/ `loadPushVapid` / `savePushVapid`（pushVapid 缺）/ `attachUpdateCapability` / `provisionAmsgBackend` / `waitForWorkerReady` / `CfAccount` / `ProvisionProgress`（cfProvision 缺）/ `isAmsgServerVersionAtLeast`（amsgWorkerVersion 缺 / 缺 SDK 升级）/ `ConfirmDialog`（不用）
  - 删功能块（upstream 1700 行的 ~1500 行）：
    - Cloudflare 账户部署助手
    - VAPID 生成（生成 Master Key / 生成 Server Token）
    - 推送深度重置
    - Worker 自更新
    - 诊断面板（体检 / 红绿灯 / 缺哪个变量）
    - Worker 版本探测
    - 即时对话配置
    - Cron 暂停 / 恢复（`cronState` / `pauseConfirmOpen`）
    - Attach 部署（`attachOpen` / `attachToken` / `attachScriptName`）
    - Deno Proxy（`denoProxyOpen`）
    - 手动粘贴部署（`pasteFallbackOpen`）
    - 补装更新能力（workerOutdated）
    - `handleToggleInstantChat` / `handleGenerateServerToken` / `handleSelfUpdate` / `handlePauseCron` / `handleResumeCron` / `handleWipeCloudData` 等
  - 改 props：加 `realtimeConfig: RealtimeConfig`（upstream 的 props 习惯，apps/Settings.tsx 调用处需要）
  - 删 state：`deployOpen` / `pasteFallbackOpen` / `denoProxyOpen` / `generatedMasterKey` / `generatedServerToken` / `cfToken` / `provisioning` / `provisionStep` / `provisionAccounts` / `needsSubdomain` / `desiredSubdomain` / `provisionError` / `attachOpen` / `attachToken` / `attachScriptName` / `attachNeedsScriptName` / `attachAccounts` / `attaching` / `attachError` / `diagnosticsProbe` / `diagnosing` / `diagnosticsOpen` / `workerOutdated` / `workerVersion` / `selfUpdateHash` / `cronState` / `pauseConfirmOpen` / `instantOn` / `instantChatSupported`
  - 加桩函数：`trackEvent`（SullyOS 缺 analytics 模块）

### 3. `apps/Settings.tsx`（1 行）
- 加 `realtimeConfig={realtimeConfig}` 到 `<ActiveMsgGlobalSettingsModal />` 调用处

## 删除的"不兼容功能块"明细

| 功能块 | upstream 引用 | SullyOS 现状 | 决策 |
|---|---|---|---|
| 任务列表 UI | `tasks` state + 任务卡片 JSX | SullyOS 当前 modal 没任务列表（最小闭环版）| 删 |
| 任务编辑 | `editingTaskUuid` state + 编辑/取消按钮 | 同上 | 删 |
| 即时对话开关 | `instantChatOn` / `globalInstantChatOn` state + JSX + `isInstantChatReady` / `amsgInstantChat` | SullyOS 无 | 删 + 桩 |
| 防穿帮闸说明 | `lastSkip` state + JSX + `ActiveMsgClient.readLastSkip` / `amsgFirePack.AmsgLastSkip` | SullyOS modal 不用 | 删 |
| 远端对账 | `knownRemoteUuids` / `remoteTaskInfo` / `reconcileTasksWithRemote` / `ActiveMsgClient.listRemoteTasksForChar` / `RemoteTaskProjection` | SullyOS modal 不用 | 删 |
| 任务收件箱 | `buildUserCancelledNotices` / `ActiveMsgStore.upsertExpiredNotices` / `amsg2TaskContext` | SullyOS 无 | 删 + 桩 |
| 任务重排（编辑替换）| `clientTaskId` / `firstSendAt` / `replacedCancelFailed` / `replaceTaskUuid` | SullyOS modal 不用 | 删 |
| 多任务 API 凭据刷新 | `refreshCharPendingAiTaskCredentials` | SullyOS 无 | 删 |
| 凭证同步 | `syncAmsgLlmCredentials` / `amsgStateSync` | SullyOS 无 | 删 + 桩 |
| Cloudflare 部署助手 | `cfProvision` / `CfAccount` / `ProvisionProgress` | SullyOS 无 | 删 |
| VAPID 生成 | `vapidGen.generateClientToken` / `pushVapid` | SullyOS 用 BUILT_IN VAPID | 删 |
| 推送深度重置 | `reconcilePushSubscription` / `cancelAllRemoteAmsgTasks` | SullyOS 极简 | 删 |
| Worker 自更新 | `selfUpdateWorker` / `attachUpdateCapability` | SullyOS 手动部署 | 删 |
| 诊断面板 | `amsgDiagnostics` / `AmsgDiagnosticLevel` / `AmsgDiagnosticsProbe` | SullyOS 无 | 删 |
| Worker 版本探测 | `isAmsgServerVersionAtLeast` / `getCapabilities` / `probeWorkerVersion` | SullyOS SDK 锁 2.6.0-next.12 | 删 |
| 即时对话配置 | `instantPushClient` / `isInstantConfigReady` | SullyOS 5 大需求不涉及 | 删 |
| Cron 暂停 / 恢复 | `getCronTriggerState` / `setCronTriggerEnabled` | SullyOS 5 大需求不涉及 | 删 |
| 体检 / 缺变量检查 | `fetchWorkerDiagnostics` / `REQUIRED_WORKER_FEATURES` | SullyOS 无 | 删 |
| 任务进度描述 | `describeTaskProgress` / `describeTaskMode` / `describeExpirePolicy` | SullyOS 不用 | 删 |
| 收件箱 / 收件窗口 | `consumeInboxMessages` / `describeRemoteLastError` | SullyOS modal 不用 | 删 |
| `trackEvent` 调用 | upstream 12 处 | SullyOS 缺 analytics 模块 | 全删 + 桩 |

## 保留的功能（5 大需求）

| 需求 | 状态 |
|---|---|
| 三个模式（固定/自动/提示词）| ✅ `MODE_OPTIONS` + JSX |
| 首次发送时间 | ✅ `firstSendTime` state + datetime-local input |
| 一次/每天/每周 | ✅ `RECURRENCE_OPTIONS` + JSX |
| 到点时处理（自动作废/强制发送）| ✅ `EXPIRE_OPTIONS` + JSX（之前 commit 加的）|
| 连发上限 | ✅ `maxUnanswered` state + select |
| API/Worker 配置 | ✅ `useSecondaryApi` + `secUrl/secKey/secModel` |
| 全局配置 | ✅ Neon URL / 通知权限 / 高级信息折叠 / 测试推送 / 重置订阅 |

## 桩函数（占位用，不影响功能）

```typescript
const trackEvent = (_event: string, _props?: any) => { /* SullyOS 缺 analytics */ };
const syncAmsgLlmCredentials = (_apiConfig: any) => { /* SullyOS 缺 amsgStateSync */ };
const buildUserCancelledNotices = (..._args: any[]): any[] => [];
const isInstantChatReady = async (): Promise<boolean> => false;
```

## 验证

- **Vite build** ✅ 4.27s 通过
- **TypeScript** 错误数 421（跟 baseline `4573c82f` 一致，**0 新增**）

## 没动什么

按暮色明确要求：
- 1.x 主动消息（`ProactiveSettingsModal` / `proactiveChat.ts` 1.x 路径）—— **完全没动**
- 9-6 前端 WebView 调用模型方案（`KeepAliveService` 调 WebView JS）—— **完全没动**
- Android 保活推送链路 —— **完全没动**
- 测试文件 —— **不搬**
- 60+ 无关 utils（`amsg2CharCleanup` / `amsg2DebugView` / `amsg2TaskContext` / `amsgDiagnostics` / `amsgInstantChat` / `amsgLlmCredentials` / `amsgPlateJob` / `amsgResults` / `amsgScheduleResult` / `amsgScheduleResultApply` / `amsgStateClock` / `amsgStateSync` / `amsgTaskKinds` / `amsgToolTrace` / `amsgToolBridge` / `vapidGen` / `pushVapid` / `cfProvision` / `instantPushClient`）—— **不搬**
- upstream 8 个 activeMsg* 测试文件 —— **不搬**
- 16 个 upstream 独立演进的 utils —— **不搬**

## 关联 commit 链

- `3c873a83` feat: wire active message 2 settings entry（聊天页 2.0 入口）
- `847d7548` feat(settings): 接上主动消息 2.0 全局入口（Settings 页 2.0 入口）
- `1d48d55a` feat: sync latest active message 2（expirePolicy 字段）
- `ea8daf75` merge: feat/sync-amsg2-minimal → preview
- `4573c82f` feat: sync active message 2 settings ui（maxUnansweredSends 字段）
- 本轮 `feat: cover upstream 2.0 modals + drop incompatible blocks`
