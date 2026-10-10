# 2026-09-05 归档：Push C 端到端 + 角色备忘录 + 状态面板重构

## 解决的核心问题

### 1. Android vivo 后台主动消息"吃了吗/喝了吗"通知不弹

根因链：
- Doze / vivo 智能省电冻结 OkHttp WebSocket 工作线程
- PARTIAL_WAKE_LOCK 短持 8s（com.mi 触发 → release → 8s 内没收到 pong → 重连）
- Worker cron delivered>0 不可靠（socket 在但 client 冻住）

修复路径（`commit 1-8` + 端到端验证）：

| Commit | 改动 |
|---|---|
| 1 | KeepAliveService 心跳前短持 Wakelock 8s + 周期 AlarmManager 30min 兜底 |
| 2 | Worker WsHub 加 `lastPingAt` + `isReallyOnline`（30s 阈值）+ `/online` 端点 |
| 3 | Worker runScheduledSweep：真活跳过 D1 / 不活写 D1（带 messageId 幂等键） |
| 4 | Worker schema: `proactive_offline_messages` 表（72h 过期）+ `user_id` 列 + `/api/offline-messages` GET 端点 |
| 5 | Android 端：WAKE_LOCK 权限 / 30s 周期 alarm / 启动 3s 后 fetch / messageId 去重 / notificationId 用 messageId 算 |
| 6-8 | userId 对齐（`handleSubscribe` 接 `userId` + `runScheduledSweep` 用 `row.user_id` 写 D1） |

暮色 9-5 端到端测试通过：注册 schedule → 杀 Sully → 写 D1 → 启动 → 拉 D1 → 弹通知 ✅

### 2. 角色备忘录 CharacterMemo（江澈 9-5 指令 → 暮色 9-5 重构）

- 三区域：状态（5 固定槽）/ 最近重点事件（≤5 滚动）/ 私人笔记
- 角色（AI）通过 `[[MEMO_ADD|EDIT|DEL|SET_STATUS|CLEAR_STATUS:...]]` token 维护
- 暮色只读（发现页"角色备忘录"入口）
- 30 条上限 = 三区域合计（状态拆出后是 memo 合计）
- DB version 70（`character_memos` store）+ 71（`character_status_panels` store）

### 3. 状态面板结构独立分离（暮色 9-5 20:32 要求）

- `CharacterStatusPanel` IDB store（per-char，5 固定槽 + 整体覆盖）
- 旧 `memoryPalace/statusPanel.ts`（per-user localStorage）改 deprecated stub
- 旧 `formatter.ts` 不再注入"📌 当前状态面板"
- `CharacterMemoEntry` region 移除 `status`（走 `[[MEMO_SET_STATUS: ...]]`）
- **结构 + 更新逻辑解耦**：状态面板 = 5 槽整体覆盖 / memo = 条目增删改

### 4. 注入位置调整（暮色 9-5 20:32 要求）

BP3 内部顺序：
1. 角色身份（name/description/systemPrompt）
2. 自我领悟
3. 世界观
4. 挂载世界书
5. 用户画像
6. 私密档案
7. **角色备忘录（状态面板 + 常规条目）** ← 位置
8. 记忆系统 / 记忆宫殿
9. 情绪底色

### 5. 其他 UI 修

- `PresetChip`：加右键删除 + 始终可见 X 按钮（双保险替代长按）
- `WorldbookApp`：加挂载角色按钮 + "已挂载：xxx"标签（与角色页双向联动）

## 已知洞（待修）

1. **`schedules.last_heartbeat` 过期导致 cron 过滤** — Sully 客户端要定期 POST `/heartbeat` 更新这个字段，否则 5 分钟后 cron 当"客户端死了"过滤掉。
2. **vivo 厂商 push 评估完成未实施** — 暮色 9-5 注册了 vivo 开放平台（凭据未拿到），commit 9-15 计划待做。
3. **`isApiLogEnabled` 临时默认 true**（commit d9e37410）— 暮色查 actual model 后**改回 false**，或 `localStorage.removeItem('sullyos:enableApiLog')`。
4. **StatusPanel 旧数据**躺在 localStorage `user_status_panel` key — 未迁移（暮色说清理 = 不再使用，不是迁移）。

## 部署步骤

1. preview 已合并到 master ✅
2. Vercel production (`sully-muse-vert.vercel.app`) 自动重部署
3. **手机 Sully app**：杀进程重开（不卸载）— 自动加载新代码 + 触发 IDB v70→v71 升级
4. **强制刷新浏览器**（Ctrl+Shift+R）— 触发 IDB v70→v71 升级 + Service Worker cache 清理

## 相关文档

- `notes/2026-09-04-sully-architecture-survey.md` — 现状盘点
- `notes/2026-09-04-sully-character-intent-design.md` — G 老师那段设计（70% 否了）
- `notes/2026-09-04-character-memo-design.md` — CharacterMemo 原始设计（已大幅重构）
- `notes/2026-09-05-push-c-plan.md` — Push C 端到端计划（commit 6-8 调整版）

## 接下来

暮色做：
- vivo 开放平台注册 + 凭据
- 客户端定期 heartbeat（生产前必做）
- actual model 查完改回 `isApiLogEnabled` 默认值

麦麦做：
- vivo push SDK 集成（拿到凭据后，commit 10-15）
- heartbeat 修复（commit 16-17）
