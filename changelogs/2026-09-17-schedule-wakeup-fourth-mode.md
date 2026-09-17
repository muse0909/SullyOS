# schedule_next_wakeup 接入 2.0 第四模式 — 回退 675cfa83 + 走独立入口

**时间**：2026-09-17 21:54–22:08
**操作**：麦麦
**分支**：master（apk 跑 master）

## 背景

暮色 9-17 21:44 拍板：把 schedule_next_wakeup 从"1.0 老路径 fallback 的混合方案"抽出来，作为主动消息 2.0 的**第四个独立任务模式**。

具体改动 = 两件事：

1. **回退 675cfa83**（那一次是把 schedule_next_wakeup 接入 2.0 + 三处修 bug；9-17 晚上拍板这条路走歪了，要回到 2.0 接入前）
2. **在回退后的基础上写新接口 registerCharacterWakeup**，直走 2.0 amsg 通道，不经过 AMSG2_ENABLED 开关，不走 1.0 老 fallback

## 改动清单

### 1. `git revert 675cfa83`（commit `67669c92`）

只回退这一个 commit。回退后 `AMSG2_ENABLED` 从 `true` → `false`。其他 commit（2.0 Worker / 2.0 设置页卡片折叠）都不动。

回退掉的 4 个文件：
- `changelogs/2026-09-17-amsg-fix-three-bugs.md`（删除）
- `hooks/useChatAI.ts`（撤销 `effectiveApi` 透传）
- `utils/activeMsgFeatureFlag.ts`（`AMSG2_ENABLED = false`）
- `utils/proactivePushConfig.ts`（撤销 fallback 加 `cfg.enabled` 检查 + `apiConfig` 参数）

### 2. `utils/activeMsgFeatureFlag.ts` — JSDoc 加 schedule_next_wakeup 例外说明

```
AMSG2_ENABLED 只管 1.0/2.0 切换的主入口（自动模式 + 事件通道），
schedule_next_wakeup 是角色在聊天里排的"角色行为"，
由 utils/proactivePushConfig.registerCharacterWakeup 直接写 2.0，
那条链路不查 AMSG2_ENABLED。
```

### 3. `utils/proactivePushConfig.ts` — 新加 `registerCharacterWakeup`

```typescript
export async function registerCharacterWakeup(
  charId: string,
  fireAt: number,
  reason: string,
  apiConfig?: { baseUrl: string; apiKey: string; model: string },
): Promise<boolean>
```

核心约束：
- **不查 AMSG2_ENABLED** — 直接调 `ActiveMsgClient.scheduleCharacterTask`，绕过 flag 那道闸
- **不走 1.0 老 fallback** — `registerDynamicScheduleOnWorker` 那条混合 dispatcher 这边完全不用
- **复用现有 `task.source='character'`** + `task.reason` 字段（不用新加任务类型）
- **写失败 → 返回 false**，由 useChatAI 弹 toast 告诉用户（不静默回 1.x）

workerUrl 没配时直接 return false + console.warn —— 让调用方知道失败了。

### 4. `hooks/useChatAI.ts` — 解析段改调新函数 + 失败 toast

**之前**（回退后）：调 `registerDynamicScheduleOnWorker(charId, fireAt, reason, userId)`，失败静默（只 console.log）。

**现在**：
```typescript
const ok = await registerCharacterWakeup(
  char.id, fireAt, reason,
  {
    baseUrl: (effectiveApi as any).baseUrl || '',
    apiKey: (effectiveApi as any).apiKey || '',
    model: (effectiveApi as any).model || '',
  },
);
if (ok) {
  addToast(`TA 给你安排了一条 — ${reason || '提醒'} · ${timeText}`, 'info');
} else {
  addToast('唤醒设置失败', 'error');
}
```

apiConfig 透传保留（scheduleCharacterTask 内部 resolveApiConfig 要 baseUrl/apiKey/model，否则抛"缺少 API URL/Key/Model"）。

### 5. `worker/amsg/src/index.ts` — character 分支提示词换干净版本

**之前**（带【标记A-CHARACTER】前缀）：
```
【标记A-CHARACTER】
[主动消息触发 - 这是你之前在 ${fireAtHuman} 用 schedule_next_wakeup 排的时间。
 你当时设定的理由是："${taskReason}"。
 现在到点了，你记得想做什么吗？按你的角色设定和最近聊天决定行为。]
```

**现在**（暮色 21:50 拍板文案）：
```
这是你之前安排好的时间，你当时设定的原因是：${taskReason}。现在到点了，你想做什么？
```

判断分支 `if (taskSource === 'character' && taskReason)` 不动；manual 分支的【标记B-MANUAL】保留 —— 那一条还在排查中（暮色今天晚些要确认 frontend 1.0 fallback 是不是还在跑）。

### 6. `components/chat/ActiveMsg2SettingsModal.tsx` — UI 改"角色自设" + 显示 reason

`task.source === 'character'` 的任务列表项：
- 文案 "角色创建" → "角色自设"
- 新增一行 `原因：{t.promptHint}`（scheduleCharacterTask 的 `task.promptHint` 字段就是 reason 内容）
- 取消按钮保留（用户能取消）
- 编辑按钮不动（暮色只说"用户可以取消但不能手动创建"，没禁止编辑 —— modal 入口的 source 硬编码 'user'，天然无法手动创建 source='character' 任务）

## 不动的部分（暮色明确）

- 1.0 定时唤醒逻辑（worker/proactive-push/）— 不动
- `registerDynamicScheduleOnWorker` 老函数本体 — 保留不删（1.0 fallback 还有别处可能调）
- 2.0 现有 fixed / auto / prompt 三模式（worker amsg 分支 + 设置页 UI）— 不动
- AMSG2_ENABLED = false 这个开关本身 — 本次回退后值就是 false，不主动改它
- 触发后删除：暂时不动 —— 依赖现有一次性任务（`recurrenceType='none'`）到点 fire 完成后 amsg-server 库自动归档；出问题再加 client 端主动 DELETE 兜底

## 验证

- `npx tsc --noEmit` —— 我改的 5 个文件 0 新错（剩下的全是 master 之前就有的）
- `npx vite build` —— ✅ 4.31s
- `npm run build:worker:amsg` —— ✅ worker.bundle.js 626.4kb

## 风险点 / 暮色看完告诉我

1. **registerCharacterWakeup 还没真的触发过**——只是接口写好、调用点换了、没有定时器到点真跑过。下次江澈排一条 schedule_next_wakeup 时留意 console 是不是 `register=true`。
2. **触发后删除**——依赖 amsg-server 库的 once 任务自动归档。如果真发出去之后任务行没自动消，需要我加客户端 DELETE 兜底。
3. **manual 分支的【标记B-MANUAL】还在**——这条排查路径没走完（暮色要确认前端 1.0 fallback 是不是还在跑）。这次不动它，下一轮一起清。
4. **没动 source='character' 任务的编辑按钮**——暮色只说"不能手动创建"，没说不能编辑。要禁编辑的话告诉我。
