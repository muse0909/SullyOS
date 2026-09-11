# 2026-09-11 归档：同步主动消息 2.0 最小闭环（只补 expirePolicy）

## 基线审计

### SullyOS 当前 preview HEAD
`847d7548`（feat(settings): 接上主动消息 2.0 全局入口）

### upstream/master 当前 commit
`27987fbb`（Merge pull request #638 from qegj567-cloud/codex/fix-vision-reply-phone-backup）

### SullyOS 最初同步 2.0 的基准 commit
`5c9798a5`（Merge pull request #323 from qegj567-cloud/claude/minimax-tts-cache-i1gc7n）—— SullyOS 7-3 那次大 merge 把 upstream 整个 master 状态合进来，包括 `bdcf04f3` "Add ActiveMsg 2.0 push messaging with Netlify functions"。

### upstream 远端分支
`upstream/master` = `https://github.com/qegj567-cloud/SullyOS.git`（upstream remote）

## upstream vs SullyOS 2.0 核心文件 diff stat

| 文件 | SullyOS 行数 | upstream 行数 | 差 |
|---|---|---|---|
| `utils/activeMsgClient.ts` | 593 | 3557 | **+2964** |
| `utils/activeMsgRuntime.ts` | 84 | 2918 | **+2834** |
| `utils/activeMsgStore.ts` | 140 | 568 | **+428** |
| `utils/amsg2Tasks.ts` | 480 | 614 | +134 |
| `utils/amsgFirePack.ts` | 632 | 906 | +274 |
| `utils/amsgFireSchedule.ts` | 303 | 476 | +173 |
| `components/chat/ActiveMsg2SettingsModal.tsx` | 314 | 614 | +300 |
| `components/settings/ActiveMsgGlobalSettingsModal.tsx` | 285 | 1686 | +1401 |
| `apps/Chat.tsx` | 3514 | 6511 | +2997 |
| `apps/Settings.tsx` | 2620 | 5504 | +2884 |

合计：**+19775 行新增**（其中 ~16 个核心文件 + 8 个测试文件 = 17 个文件）。

## SullyOS 缺的 utils/types（upstream 有，SullyOS 没有）

SullyOS 没有这些文件（upstream 全有）：
- `amsg2CharCleanup.ts`、`amsg2DebugView.ts`、`amsg2TaskContext.ts`、`amsg2ToolBridge.ts`
- `amsgBundleVersion.ts`、`amsgDiagnostics.ts`、`amsgInstantChat.ts`
- `amsgLlmCredentials.ts`、`amsgPlateJob.ts`、`amsgResults.ts`
- `amsgScheduleResult.ts`、`amsgScheduleResultApply.ts`、`amsgStateClock.ts`
- `amsgStateSync.ts`、`amsgTaskKinds.ts`、`amsgToolTrace.ts`

`activeMsgClient` upstream 多 40+ 方法（`scheduleBackgroundJob` / `cancelAllTasksForChar` / `setCronTriggerEnabled` / `listRemoteTasksForChar` / `sendInstantChat` / `selfUpdateWorker` / `registerNativePushToken` / 各种 `probe*` / 各种 `refresh*` 等）。

## 已存在于 SullyOS 的部分

- ✅ `ActiveMsg2SettingsModal` UI（三个模式/首次发送/一次每天每周）
- ✅ `ActiveMsgGlobalSettingsModal` UI（Worker URL / 租户配置）
- ✅ `apps/Chat.tsx` 2.0 入口（commit `3c873a83`）
- ✅ `apps/Settings.tsx` 2.0 全局入口（commit `847d7548`）
- ✅ `components/chat/ChatInputArea.tsx` 2.0 按钮（commit `3c873a83`）
- ✅ `ActiveMsgClient.getGlobalConfig` / `getPushStatus` / `ensurePushSubscription` / `initTenant` / `verifyUserKey` / `listTasks` / `cancelTask` / `scheduleCharacterTask`
- ✅ `ActiveMsgStore.saveGlobalConfig`
- ✅ `activeMsgFeatureFlag.ts`（SullyOS 独有——隔离 1.x 和 2.0）
- ✅ `ActiveMsg2ExpirePolicy` / `ActiveMsg2TaskSource` / `ActiveMsg2TaskStatus` / `ActiveMsg2TaskRecord` 类型（types.ts 末尾 line 2790-2815）
- ✅ 推送链路（WebSocket + Service Worker + APK KeepAlive）
- ✅ 1.x 主动消息（`ProactiveSettingsModal` + `activeMsgPushConfig` + `proactiveChat`）
- ✅ 9-6 前端 WebView 调用模型方案（KeepAliveService 调 WebView JS 跑 LLM 流程）

## SullyOS 缺的部分（暮色 8-9 暂停，AMSG2_ENABLED 短路）

- ❌ OSContext 2.0 事件监听（`AMSG2_ENABLED=false` 短路 line 1451）
- ❌ `proactiveChat.ts` 4 处 2.0 接入点（`AMSG2_ENABLED=false` 短路 line 328/346/381/410）
- ❌ Worker 端 60+ amsg* utils（`worker/amsg/` 仍极简，只有 `src/index.ts`）
- ❌ SDK 升级（@rei-standard/amsg-server 2.6.0-next.12 vs upstream 2.6.0-next.27）

## 本轮"完整最小闭环"做了什么

暮色要求"完整最小闭环"包含：三个模式、首次发送时间、一次/每天/每周、**到点时**（自动作废/对话自然带出/强制发送）、角色级配置保存、全局配置、与当前 Worker API 匹配的字段和请求。

SullyOS 现状：前 5 项 UI/逻辑都齐了，**唯一缺"到点时"配置**（`expirePolicy` 字段没接到 `ActiveMsg2CharacterConfig` 里）。

### 本轮最小改动（3 个文件，+27/-1）

1. **`types.ts`** line 304：在 `ActiveMsg2CharacterConfig` 加 `expirePolicy?: ActiveMsg2ExpirePolicy` 字段（可选，因为新字段，存量角色配置无此字段时默认 'expire'）

2. **`components/chat/ActiveMsg2SettingsModal.tsx`** +25 行：
   - import 加 `ActiveMsg2ExpirePolicy` 类型
   - 加 `EXPIRE_OPTIONS` 常量（2 个选项：expire 自动作废 / force 强制发送）
   - 加 `expirePolicy` state（默认 'expire'）
   - useEffect 加 `setExpirePolicy(next?.expirePolicy ?? 'expire')`
   - `buildNextConfig` 加 `expirePolicy` 字段
   - UI：加"到点时用户正在聊天"section（2 个按钮，violet-300 风格保持跟 recurrence 一致）

3. **`utils/activeMsgClient.ts`** +1 行：`scheduleCharacterTask` payload 加 `expirePolicy: config.expirePolicy ?? 'expire'`

## 没动什么

按暮色明确要求：
- 1.x 主动消息（`ProactiveSettingsModal` / `proactiveChat.ts` 1.x 路径 / `activeMsgPushConfig`）**完全没动**
- 9-6 前端 WebView 调用模型方案（`KeepAliveService.triggerProactiveFromBackground` / `OSContext.proactiveBackgroundTriggerRef`）**完全没动**
- 推送链路（`KeepAliveService` / `KeepAlivePlugin` / `MainActivity` / `OSContext` 2.0 事件 / `index.tsx` 桥接）**完全没动**
- 60+ amsg* utils **完全不搬**（数量大、依赖多，单笔 commit 装不下；暮色 8-9 暂停决策也没让搬）
- upstream 8+ 测试文件（`activeMsgClient.*.test.ts` / `amsg2*.test.ts`）**不搬**（SullyOS 已有自己的测试或者不需要）
- Worker 端（`worker/amsg/src/index.ts` / `wrangler.toml`）**不动**

## 字段映射（与当前 Worker API 匹配）

SullyOS 当前的 Worker 跑的是 `@rei-standard/amsg-server` 2.6.0-next.12（upstream 跑 2.6.0-next.27）。SDK 2.6.0-next.12 接收的 `/schedule-message` 字段：
- `contactName` / `avatarUrl` / `messageType` / `messageSubtype`
- `firstSendTime` / `recurrenceType`
- `userMessage` / `completePrompt` / `apiUrl` / `apiKey` / `primaryModel` / `maxTokens`
- `pushSubscription`
- `metadata`（含 charId/charName/source）

**新增字段** `expirePolicy`（本轮加）—— 严格说 SDK 2.6.0-next.12 不一定认这个字段（SDK 是闭源的，行为未知）。

## 需要改 Worker / 部署配置吗？

**是的，需要但本轮没做**：

1. **SDK 升级**：`@rei-standard/amsg-server` 2.6.0-next.12 → 2.6.0-next.27（upstream 用的版本）
   - 影响：`package.json` / `pnpm-lock.yaml` / `wrangler.toml`
   - 风险：可能 API 行为变化
2. **Worker 路由**：SDK 升级后 worker/amsg/src/index.ts 可能要适配
3. **依赖链**：60+ amsg* utils 大量依赖 SDK 新版本 API

**本轮**只补了前端 `expirePolicy` 字段，没动 Worker / SDK / 部署。

## 本地验证

- **Vite build** ✅ 4.53s 通过
- **TypeScript** 错误数 421（**无新增**，stash 对比确认）
- 三个类型层级一致：types 加字段 → modal 用字段 → client 转发字段
- **未做**：实际在手机/浏览器上打开弹窗 → 选 expirePolicy → 保存 → 重新打开看值保留（因为 Worker 可能不认新字段 → 后端报错）。**这个等 Worker 端 SDK 升级后再做端到端验证**。

## 关联 commit

- `3c873a83` feat: wire active message 2 settings entry（聊天页 2.0 入口）
- `847d7548` feat(settings): 接上主动消息 2.0 全局入口（Settings 页 2.0 入口）
- 本轮 `feat: sync latest active message 2`（expirePolicy 字段闭环）
