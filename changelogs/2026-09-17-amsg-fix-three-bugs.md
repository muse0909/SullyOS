# 主动消息 2.0 修复 schedule_next_wakeup 三个根因

## 根因

暮色 9-17 反馈 schedule_next_wakeup 排的任务到点收到的是 1.0 老提示词（【标记C-FRONTEND】），不是 2.0 的「主动视角」。

排查发现三个独立 bug 共同导致：

1. **`utils/activeMsgFeatureFlag.ts:11` `AMSG2_ENABLED = false`** —— 硬编码常量一直是 false。registerDynamicScheduleOnActiveMsg2 376-377 行一进来就 return false，**scheduleCharacterTask 根本没跑，2.0 通道完全短路**。手动建任务能成功是因为它走 ActiveMsg2SettingsModal 直接调 scheduleCharacterTask，不查 AMSG2_ENABLED。

2. **`utils/proactivePushConfig.ts:317` 1.x fallback 不检查 `cfg.enabled`** —— 1.0 总开关关了，但 fallback 入口只查 workerUrl 不查 enabled，所以仍然 fetch `/dynamic-schedule` → 1.x 老 Worker D1 写入成功 → cron 触发 → WS broadcast → Android KeepAliveService → WebView JS → runProactive 写 1.0 老提示词。

3. **`utils/proactivePushConfig.ts:404` scheduleCharacterTask 传空 apiConfig** —— `{ baseUrl: '', apiKey: '', model: '' }`。即使修 1 后走通，scheduleCharacterTask 早期 resolveApiConfig 也会抛"缺少 API URL/Key/Model"。

## 修复

### 修复1 — 打开 2.0 通道

`utils/activeMsgFeatureFlag.ts:11` `AMSG2_ENABLED = false` → `true`

### 修复2 — fallback 检查 cfg.enabled

`utils/proactivePushConfig.ts` 在 `const cfg = loadPushConfig()` 之后、workerUrl 检查之前加：

```typescript
if (!cfg.enabled) {
  console.warn(`[ProactivePush] 1.0 已关闭，跳过 fallback（char=${charId}）`);
  return false;
}
```

### 修复3 — apiConfig 透传

- `registerDynamicScheduleOnWorker` 加可选参数 `apiConfig?: { baseUrl: string; apiKey: string; model: string }`
- `registerDynamicScheduleOnActiveMsg2` 同样加可选参数
- `registerDynamicScheduleOnActiveMsg2` 调 scheduleCharacterTask 时用传入的 apiConfig，没传时兜底读全局 chat 配置
- `hooks/useChatAI.ts:3721` 调 registerDynamicScheduleOnWorker 时透传 effectiveApi（角色级 API 优先解析后）

## 修后预期行为

- schedule_next_wakeup → AMSG2_ENABLED=true → registerDynamicScheduleOnActiveMsg2 走通 → scheduleCharacterTask 带正确 API 配置 → 2.0 Worker 端 fire 拼「主动视角」system hint（带【标记A-CHARACTER】）
- 2.0 失败 + 1.0 总开关关着 → console.warn + return false + 不发 1.x fallback
- 2.0 失败 + 1.0 总开关开着 → 1.x fallback 走老路径（罕见兜底）

## 文件

- `utils/activeMsgFeatureFlag.ts` — AMSG2_ENABLED = true
- `utils/proactivePushConfig.ts` — fallback 检查 cfg.enabled + apiConfig 透传
- `hooks/useChatAI.ts` — registerDynamicScheduleOnWorker 调用透传 effectiveApi