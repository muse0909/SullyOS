# 主动消息 2.0 schedule_next_wakeup 入口闸 — A 严格版

**日期**：2026-09-24
**涉及 commit**：（待 commit 后填）

## 改了什么

排查「20:14 创建 20:16 + 20:15 又创建 20:18」表面现象（fe13010 临时诊断日志已定位：3 次全是 inputBarFlashBtn,LLM 主响应 source='main',不是 followup / 缓存 / 后台）后，发现底层设计缺口：

- `chatPrompts.ts:308` 的 schedule_next_wakeup 说明承诺「新的回复会覆盖之前未触发的 dynamic（同一角色只有 1 条 dynamic 在册）」
- 代码层面**没有任何入口硬约束这一条** — 只查 workerUrl / charEnabled / 任务总数 ≤ 5 / fireAt ± 60s 去重 4 条
- schedule_next_wakeup token 路径**与** schedule_active_message 工具路径状态可见性不对称
- LLM 长对话注意力衰减 + 反复思考 — 上次日志已证：LLM 输出"测试麦麦诊断日志2分钟唤醒"和"诊断日志测试两分钟唤醒"两条 fireAt 都是 21:45,措辞略不同

按 9-24 23:09 暮色拍板**A 严格**：在 registerCharacterWakeup 入口加闸。

### 闸逻辑
```ts
const existingPendingCharacterWakeups = (storedChar?.activeMsg2Config?.tasks ?? []).filter(
  (t) => t.source === 'character' && t.status === 'scheduled' && isPendingTask(t, Date.now())
);
if (existingPendingCharacterWakeups.length > 0) {
  // 写一条 wakeup-dedup-skip-local 诊断 + 返回 false
  return false;
}
```

- **闸条件**:`source='character'` + `status='scheduled'` + 触发点未过（= 还能响的 character wakeup）— 这 3 个用 isPendingTask 同源判定，跟 getPendingTasks / cancelCharacterWakeups 用同一套工具函数
- **命中**:
  - 拒绝新建（return false）
  - 写一条 `wakeup-dedup-skip-local` 诊断（带现存任务数 + firstSendTime + 本次 fireAt + reason）
  - console.warn 留痕
  - **不调** scheduleCharacterTask
  - **不写** 本地账（既不创建新 task，也不增加 noise）
  - 静默 — useChatAI.ts:3700 那块 `if (ok)` 不成立，**不弹 toast**
- **放行（不命中）**：照原本路径走 scheduleCharacterTask

### 为什么放行条件是对的

`cancelCharacterWakeups` 跟 `registerCharacterWakeup` 用 `isPendingTask` 同源判定，所以：
- 用户主动发消息 → handleSendText → cancelCharacterWakeups → 删旧 wakeup → 下次 triggerAI 时 storedChar.activeMsg2Config.tasks 里没有 pending character → 闸空了 → 让建
- 用户刷新浏览器后立刻 triggerAI 时，本地账本可能落后远端但**至少本地记录存在则闸生效**；远端领先的不会触发这条路径（远端领先走 cancelCharacterWakeups 幂等路径处理）
- 同 (fireAt, reason) 60 秒内存 ring 仍是同次 triggerAI 内第一道防线；fireAt ± 60s 远端去重仍是第二道防线；现在这道闸是第三道防线（角色级 + 在册 character dynamic）

## 改了哪些文件
- `utils/amsgDiag.ts` — AmsgDiagStage 加 `wakeup-dedup-skip-local` 一个 stage 节点
- `utils/proactivePushConfig.ts` — 顶部 import 加 `isPendingTask`；`registerCharacterWakeup` 在 scheduleCharacterTask 调用之前加闸（line 555-580 区间）

## 为什么这样改不会影响正常聊天发送

### 不影响：LLM 不输出 schedule_next_wakeup token 的所有路径
- LLM 看到 system prompt 决定不输出 token → parser `if (aiContent.includes('[schedule_next_wakeup'))` 整块不进 → registerCharacterWakeup 不被调用 → 闸不触发
- chat 流 / history / 聊天气泡渲染全部不受影响

### 不影响：用户主动发消息触发 AI 重新排
```
用户发消息
  → handleSendText
    → ActiveMsgClient.cancelCharacterWakeups(char)  ← 删除已有 pending character wakeup
  → triggerAI
    → LLM 主响应输 schedule_next_wakeup token
    → parser 调 registerCharacterWakeup
    → 闸检查：storedChar.activeMsg2Config.tasks.filter(...).length === 0  ← 闸空了
    → 放行 → 建新任务
```
用户表达"让 AI 重新排"的标准交互 = 发消息 → AI 重新响应 → 顺带排新一条。这个流程不动。

### 不影响：schedule_active_message 工具调用路径
- 该路径走 `utils/amsg2ToolBridge.ts` 的 `handleSchedule`，跟 schedule_next_wakeup token 路径**完全独立**
- 工具路径有自己的闸（在 scheduleCharacterTask 内做任务级去重 + charEnabled 等）
- 本次改动只动 registerCharacterWakeup 一个接口，工具路径不受影响

### 不影响：主动消息 2.0 手动面板
- 用户手动建任务走 `ActiveMsg2SettingsModal.handleSubmit` 调 scheduleCharacterTask，没经过 registerCharacterWakeup
- 本次改动不动 scheduleCharacterTask 入口

### 影响范围（仅一条边界收紧）
- LLM 在已有未消费 character wakeup 时继续输出 schedule_next_wakeup → 静默拒绝
- 之前表现：再创建一条任务 + 弹 toast「TA 给你安排了一条 — ...」
- 现在表现：什么都不发生（toast 不弹、面板无新条目）
- LLM 看不到反馈 → 下轮可能继续输 token → 闸继续挡 → 用户一直收不到提醒
- 这正是想要的边界：AI 不要反复骚扰已经有一件事在排的暮色

## 跟上一轮（fe13010）临时诊断的关系

fe13010 加的：
- AmsgDiagEntry 加 `extra` 字段
- 3 个新 stage：wakeup-trigger-start / wakeup-aicontent-snapshot / wakeup-token-parse-skip
- triggerAI 第 3 参数 callSite
- 19 个 logAiSnapshot 调用
- Chat.tsx 7 个 triggerAI 调用点加 __site 参数

这些**保留**，等暮色把这次入口闸测一下：
- 如果 20:14/20:15 重复场景不再复现，入口闸生效，临时诊断可以一次性回滚
- 如果还有复现，临时诊断 + 这次新加的 wakeup-dedup-skip-local 一起定位下一步

回滚命令：`git revert fe13010` 或 `git reset --hard <上一个稳定的 master commit>`。

## 备注
- 没碰 `cancelCharacterWakeups`（暮色 9-24 明令禁止改取消逻辑）
- 没碰 `scheduleCharacterTask` 内部去重（已经在跑不动它）
- 没碰任何 prompt / system prompt 内容
- 没引入新依赖，复用现有 `isPendingTask`（amsg2Tasks.ts:158），跟 `cancelCharacterWakeups` 的判定同源
- 没碰主动消息 2.0 面板 UI、任务列表、调度器
- 没碰 schedule_active_message 工具桥
