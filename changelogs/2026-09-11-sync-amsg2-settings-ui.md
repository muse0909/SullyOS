# 2026-09-11 归档：同步主动消息 2.0 配置 UI（连发上限 + 标注待后端适配）

## 范围
- **preview HEAD**：`ea8daf75`
- **只动 4 个文件**：`types.ts` / `utils/amsgFirePack.ts` / `utils/activeMsgClient.ts` / `components/chat/ActiveMsg2SettingsModal.tsx`
- **不动**：`ActiveMsgGlobalSettingsModal.tsx`（基础配置已齐）/ 1.x 主动消息 / 9-6 WebView / Android / Worker / 调试面板 / 任务收件箱 / 完整 runtime / 60+ amsg* utils / 测试文件

## 上游 vs SullyOS 两个 modal diff 范围

### ActiveMsg2SettingsModal.tsx
SullyOS 314 行 vs upstream 614 行，差 300 行。**逐字段分析**：

| upstream 多出的字段 | 类型 | SullyOS 缺？ | 决策 |
|---|---|---|---|
| `instantChatOn` / `globalInstantChatOn` | 即时对话开关 | 缺 | **跳过**（依赖 `amsgInstantChat` + `ActiveMsgClient.readLastSkip`，SullyOS 缺，属调试面板/runtime） |
| `maxUnansweredSends` | 连发上限（角色级） | 缺 | **本轮加**（纯 UI 字段，不依赖收件箱/runtime）|
| `editingTaskUuid` + 任务编辑 | 任务列表编辑 | 缺 | **跳过**（属任务收件箱） |
| `knownRemoteUuids` / `remoteTaskInfo` | 远端对账 | 缺 | **跳过**（属任务收件箱/runtime） |
| `lastSkip` | 防穿帮闸说明 | 缺 | **跳过**（依赖 `ActiveMsgClient.readLastSkip`，属 runtime） |

### ActiveMsgGlobalSettingsModal.tsx
SullyOS 285 行 vs upstream 1686 行，差 1401 行。**SullyOS 基础配置已齐**（Neon Database URL / 通知权限 / 高级信息折叠 / initSecret / tenantToken 只读 / cronToken 只读 / cronWebhookUrl 只读）。upstream 多出来的全是**高级 / 调试**功能：
- Cloudflare 账户 ID 部署助手（`cfProvision`）—— **跳过**（高级 / SullyOS 无需求）
- VAPID 生成按钮（`vapidGen`）—— **跳过**（高级 / SullyOS 已有内置 VAPID）
- 推送深度重置（`reconcilePushSubscription`）—— **跳过**（属 runtime / 调试）
- Worker 自更新（`selfUpdateWorker`）—— **跳过**（属 runtime / 调试）
- 诊断面板（`amsgDiagnostics`）—— **跳过**（属调试面板）
- Worker 版本探测（`isAmsgServerVersionAtLeast`）—— **跳过**（属调试）
- 即时对话配置（`instantPushClient`）—— **跳过**（属独立功能，SullyOS 5 大需求不涉及）

**本轮对 `ActiveMsgGlobalSettingsModal` 完全不动**（基础已齐 / 高级全跳过）。

## 5 大需求逐项核对

| 需求 | SullyOS 状态 |
|---|---|
| 三个模式（固定/自动/提示词）| ✅ modal UI 已有 |
| 首次发送时间 | ✅ modal UI 已有 |
| 一次/每天/每周 | ✅ modal UI 已有 |
| 用户聊天时三种处理方式（自动作废/对话自然带出/强制发送）| ✅ 本轮 `1d48d55a` 加了 expirePolicy（2 个 UI 选项 expire/force + 副标题"转为对话里自然带出"）|
| API/Worker 配置 | ✅ `ActiveMsgGlobalSettingsModal` 已有（databaseUrl / tenantToken / initSecret / 通知权限 / 测试推送 / 重置订阅）|
| **额外：连发上限**（upstream 有，SullyOS 缺）| ✅ **本轮加**（maxUnanswered 字段 + UI + 默认值 3）|

## 本轮改动清单（4 个文件 +46 行）

### 1. `types.ts` +6 行
`ActiveMsg2CharacterConfig` 加 `maxUnansweredSends?: number` 字段（带注释说明 UI 保留 + Worker 待端到端验证）

### 2. `utils/amsgFirePack.ts` +9 行
加 `DEFAULT_MAX_UNANSWERED_SENDS = 3` 常量（upstream 默认值）

### 3. `utils/activeMsgClient.ts` +2 行
`scheduleCharacterTask` payload 加 `maxUnansweredSends: config.maxUnansweredSends` 字段（标注"Worker SDK 2.6.0-next.12 是否认未知"）

### 4. `components/chat/ActiveMsg2SettingsModal.tsx` +29 行
- import `DEFAULT_MAX_UNANSWERED_SENDS`
- 加 `maxUnanswered` state（`'' | string` 形态，空 = 默认）
- useEffect 同步 saved 值
- `buildNextConfig` 加 `maxUnansweredSends: maxUnanswered === '' ? undefined : Number(maxUnanswered)`
- UI：maxTokens 之后、"使用单独 API" 之前，加"连发上限"section
  - select：默认（3 条）/ 1-10 条 / 不限
  - 提示文案：解释"TA 最多连续主动发几条"+ "字段是 9-11 同步上游加的，Worker 端 SDK 2.6.0-next.12 是否认未知，**需端到端验证**"

## 配置保存路径静态检查

| 步骤 | 链路 | 状态 |
|---|---|---|
| 1. 聊天页入口 | `ChatInputArea.tsx:514` 按钮 onClick → `onPanelAction('active-msg-2')` → `apps/Chat.tsx:1519` case → `setShowActiveMsg2Modal(true)` | ✅ commit `3c873a83` |
| 2. 系统设置入口 | `apps/Settings.tsx:2521` 按钮 onClick → `setShowAmsg2Config(true)` | ✅ commit `847d7548` |
| 3. 弹窗打开 | `apps/Chat.tsx:3470` `<ActiveMsg2SettingsModal isOpen={showActiveMsg2Modal} ... />` / `apps/Settings.tsx:2593` `<ActiveMsgGlobalSettingsModal isOpen={showAmsg2Config} ... />` | ✅ |
| 4. 保存回调 | `apps/Chat.tsx:3480` `onSave={(config) => updateCharacter(char.id, { activeMsg2Config: config })}` | ✅ |
| 5. modal 内部 state → config | `buildNextConfig` 输出 14 个字段（含本轮 `expirePolicy` + `maxUnansweredSends`）→ `onSave({...nextConfig, ...})` | ✅ 本轮已加 maxUnansweredSends |
| 6. config → API | `ActiveMsgClient.scheduleCharacterTask` 接收 config → 13 个字段进 payload（含本轮 `maxUnansweredSends`） | ✅ 本轮已加 maxUnansweredSends |

## 标注"待后端适配"的字段

| 字段 | 标注位置 | 适配需求 |
|---|---|---|
| `expirePolicy` | types 注释 + activeMsgClient 注释 + modal 提示 | Worker SDK 2.6.0-next.12 是否认 `expirePolicy` 字段未知；本轮加进去时**保留**语义 |
| `maxUnansweredSends` | types 注释 + activeMsgClient 注释 + modal 提示 | Worker SDK 2.6.0-next.12 是否认 `maxUnansweredSends` 字段未知 |

**端到端验证路径**（**本轮不做**，等下次）：
1. 部署到 dev worker（带 SDK 2.6.0-next.27 升级）
2. 打开角色主动消息 2.0 弹窗
3. 选 expirePolicy / maxUnansweredSends → 保存
4. 重新打开弹窗看值保留
5. 等到点看 Worker 行为（自动作废 / 连发上限是否生效）

## 验证

- **Vite build** ✅ 4.21s 通过
- **TypeScript** 错误数 421（**0 新增**，stash 对比确认）
- **配置保存路径** 6 步全通

## 没动什么

按暮色明确要求：
- 1.x 主动消息（`ProactiveSettingsModal` / `proactiveChat.ts` 1.x 路径 / `activeMsgPushConfig`）—— **完全没动**
- 9-6 前端 WebView 调用模型方案 —— **完全没动**
- Android 保活推送链路 —— **完全没动**
- 现有 Worker 代码（`worker/amsg/src/index.ts`）—— **完全没动**
- 调试面板（upstream `Amsg2DebugPanel` / `Amsg2DebugView` 等）—— **不搬**
- 任务收件箱（upstream `AmsgInbox` / `RemoteTask` 列表）—— **不搬**
- 完整 runtime（`activeMsgRuntime.ts` 2900 行扩展）—— **不搬**
- 60+ amsg* utils（amsg2CharCleanup / amsg2DebugView / amsg2TaskContext / amsg2ToolBridge / amsgDiagnostics / amsgInstantChat / amsgLlmCredentials / amsgStateClock / amsgStateSync 等）—— **不搬**
- 8 个测试文件（`activeMsgClient.*.test.ts` / `activeMsgRuntime.test.ts`）—— **不搬**
- 16 个 upstream 独立演进的 utils —— **不搬**
- `apps/Chat.tsx` 2.0 集成扩展（防穿帮闸 / 收件箱 / 任务列表）—— **不搬**
- `apps/Settings.tsx` 2.0 高级配置 UI（深度重置 / Worker 自更新 / 诊断）—— **不搬**

## 文件数 / 行数核对

- **修改文件数**：4（**未超过 10**）
- **新增行数**：+46 / -0（**未超过 5000**）
- **搬运的 UI**：连发上限 select（1 个新 UI 控件）
- **未搬运的 upstream UI**：即时间对话开关 / 任务列表 / 任务编辑 / 远端对账徽标 / 防穿帮闸说明 / lastSkip 显示 / Cloudflare 部署助手 / VAPID 生成 / 推送深度重置 / Worker 自更新 / 诊断面板 / Worker 版本探测 / 即时对话配置（**13 个不搬的 UI 控件，理由全列在"5 大需求逐项核对"表**）

## 关联 commit 链

- `3c873a83` feat: wire active message 2 settings entry（聊天页 2.0 入口）
- `847d7548` feat(settings): 接上主动消息 2.0 全局入口（Settings 页 2.0 入口）
- `1d48d55a` feat: sync latest active message 2（expirePolicy 字段）
- `ea8daf75` merge: feat/sync-amsg2-minimal → preview
- 本轮 `feat: sync active message 2 settings ui`（maxUnansweredSends 字段 + UI）
