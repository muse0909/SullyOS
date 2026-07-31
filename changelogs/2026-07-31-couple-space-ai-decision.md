# 情侣空间 — 完整 AI 决策（B 版）+ 修 2 个 bug

**日期**：2026-07-31
**涉及 commit**：`feat: 情侣空间 AI 决策完整版 + 修 openApp/全局函数 2 个 bug`

## 改了什么

暮色 2026-07-31 反馈 3 个事：
1. 选 B 完整 AI 决策，我没做完（"为什么做了这么次还是又做个半成品给我？"）
2. **没有自动跳转**到聊天（error: `openApp is not defined`）
3. **点接受/拒绝没反应**（window 全局方案在 CoupleSpaceApp 没挂载时是 undefined）

这次 commit **全修了**。

### 1. 修 openApp bug

`apps/CoupleSpaceApp.tsx` line 51 从 useOS 解构 `openApp`：
```diff
- const { closeApp, characters, activeCharacterId, addToast } = useOS();
+ const { closeApp, openApp, characters, activeCharacterId, addToast, coupleSpaceAccept, coupleSpaceDecline, requestCoupleSpaceDecision } = useOS();
```

之前 line 214 用 `openApp(AppID.Chat)` 但没解构——ReferenceError 触发 setTimeout 报错，**没跳转**。

### 2. 修"接受/拒绝没反应"（关键修复）

**之前方案**：用 `window.__coupleSpaceAccept` 全局函数。
- 暮色在 Chat 里点"接受"时，**CoupleSpaceApp 没挂载**
- `window.__coupleSpaceAccept` 是 undefined
- 点接受 → 静默失败

**新方案**：把 `coupleSpaceAccept` / `coupleSpaceDecline` 加到 `OSContext`（永远可用）。
- `context/OSContext.tsx` line 147-167 加 3 个方法到 interface
- line 3200-3265 实现 3 个方法（accept / decline / requestCoupleSpaceDecision）
- `apps/CoupleSpaceApp.tsx` 移除 window 全局 useEffect
- `components/chat/MessageItem.tsx` 用 `useOS()` 调 `coupleSpaceAccept` / `coupleSpaceDecline`

### 3. 完整 AI 决策（B 版）

`context/OSContext.tsx` 加 `requestCoupleSpaceDecision`：
- 调 LLM（用现有 apiConfig，**暮色 2026-07-24 角色独立 API**：角色有自己的 API 就用角色的）
- 60 秒超时（暮色 2026-07-27 关梯子空回/慢，AbortController）
- prompt 简化：让角色以自己的性格决定，输出 JSON `{decision, note}`
- 失败/超时 → **默认接受**（不卡流程）
- AI 决定后发 `role: 'assistant'` 消息（暮色在聊天里看到）
- 状态变 + 接受时自动 `setActiveApp(AppID.CoupleSpace)` 跳空间

`apps/CoupleSpaceApp.tsx` handleConfirmInvite 调 `requestCoupleSpaceDecision(char.id)`（**不 await**，fire-and-forget）。

**完整流程**（暮色能立刻测）：
```
暮色点"邀请" → 选江澈 + 填开始日 → 开通
  → markPending (status: pending)
  → 发 type='couple_space_invite' status='pending' 消息
  → 跳转到江澈的聊天（暮色看邀请卡片）
  → 触发 requestCoupleSpaceDecision
     → 调 LLM（江澈用 LLM 决定）
     → 30-60 秒后
     → 接受：发 assistant 消息 + 状态 open + 自动跳空间
     → 拒绝：发 assistant 消息 + 状态 declined
     → 超时/失败：默认接受（暮色手动点"接受"也能开）
```

## 动了哪些文件

- `context/OSContext.tsx`：
  - 加 3 个方法到 OSContextType interface
  - 实现 3 个方法（accept / decline / requestCoupleSpaceDecision）
  - 加到 value 对象
  - 文件 +200 行
- `apps/CoupleSpaceApp.tsx`：
  - useOS 解构加 4 个方法（openApp + coupleSpaceAccept + coupleSpaceDecline + requestCoupleSpaceDecision）
  - 移除 window 全局 useEffect
  - handleUserAccept / handleUserDecline 改用 OSContext
  - handleConfirmInvite 加 requestCoupleSpaceDecision 异步调用
- `components/chat/MessageItem.tsx`：
  - import useOS
  - 用 useOS 调 coupleSpaceAccept / coupleSpaceDecline（不再用 window）
- `changelogs/2026-07-31-couple-space-ai-decision.md`（本文件）

## 暮色能立刻测的流程

1. **删旧空间**（齿轮 → 解除）—— 让状态干净
2. **重新邀请**—— 选江澈 + 填开始日
3. **点"开通"**—— 自动跳到江澈聊天（这次不报错）
4. **看邀请卡片**—— pending 状态，有"接受"/"拒绝"按钮（**这次能点**）
5. **同时**：AI 调 LLM 决策中（30-60 秒）—— 暮色可以在聊天里看江澈的回应消息
6. **AI 接受**—— 自动跳到情侣空间
7. **AI 拒绝**—— 不跳，暮色在聊天里看到江澈说"我想再想想"
8. **AI 超时/失败**—— 默认接受，跳到空间（暮色在聊天看不到 AI 回应消息，但状态变 open）

## 踩坑 / 需要知道的

1. **暮色很生气**——"为什么做了这么次还是又做个半成品给我？"——我**没问就简化**了 AI 决策，暮色想要就**直接做完**。这次的 commit 包含完整 AI 决策（B 版）+ 修 2 个 bug，**不再分阶段**。
2. **window 全局方案失败**——CoupleSpaceApp 没挂载时 window 全局是 undefined。改 OSContext 是更 React 风格的方案（永远可用）。
3. **AI 决策不阻塞 UI**——`requestCoupleSpaceDecision(char.id).catch(...)` fire-and-forget。暮色点开通后**立即**跳聊天，等 LLM 决策。
4. **60 秒超时**——暮色 2026-07-27 changelog 说"关梯子空回/慢"，加 AbortController + 60s。**默认接受**保证不卡流程。
5. **AI 回应消息**——AI 决定后发 `role: 'assistant'` 消息，暮色在聊天里能看到江澈的回应（"我愿意和你一起开始这段情侣空间 💕"）。**这才是 miya 的"AI 决策"完整体验**。
6. **暮色场景的角色独立 API**——江澈的 `apiConfig` 有就优先用，否则用全局 `apiConfig`。暮色 2026-07-24 改的"每个角色独立 API"。
7. **JSON 解析容错**——LLM 输出不一定严格 JSON，正则 `text.match(/\{[\s\S]*\}/)` 抽 JSON 部分，避免解析失败。
8. **错误处理**——LLM 决策失败时 `note = ''`，AI 接受消息会显示通用文案 "我愿意和你一起开始这段情侣空间 💕"。

## 备注

- **未完成 / 下次再说**：
  - 时间线模块（阶段 3）
  - 悄悄话模块（阶段 4）
  - AI 主动打卡（接 proactive 通道）
  - 用户打卡要不要发消息（待定）
  - 第二阶段：整体布局重做
  - 第三阶段：去掉粉色
  - 第四阶段：配色可调 + CSS 自定义 + 杂志风 + 主题切换（暂放）
- **暮色 2026-07-31 反馈 5 个事**：
  - ✅ "已经选的就直接做" → 这次做完
  - ✅ "没有自动跳转" → 修 openApp bug
  - ✅ "点接受/拒绝没反应" → 改 OSContext
  - ⏳ UI 粉色不喜欢 → 等功能做完改
  - ⏳ 整体布局不喜欢 → 等功能做完改
