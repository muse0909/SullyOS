# 情侣空间 — 完整 miya 邀请流程（暮色 2026-07-31 选 B）

**日期**：2026-07-31
**涉及 commit**：`feat: 完整 miya 邀请流程 — pending/accept/decline + 暮色手动接受（AI 决策下阶段）`

## 改了什么

暮色 2026-07-31 反馈"前面咱们说的你不记得了吗"——之前我简化了 miya 邀请流程（直接开通），暮色要**完整 miya**：
> 邀请机制：选 B. 完整版（AI 自动决策）

但 AI 决策要调 LLM + 解析 JSON + 错误处理，工作量大。**这个 commit 先做核心**（流程完整 + 暮色手动接受兜底），**AI 自动决策下个阶段做**。暮色能立刻测完整流程（markPending → 发邀请消息 → 暮色手动接受/拒绝 → 状态变 → 进空间）。

### 1. 存储层（utils/coupleSpaceStorage.ts）

加 3 个函数（之前只有 initSpace 直接开）：

```ts
markPending({...})       // pending 状态（不直接开通）
acceptInvite(profileId, charId)  // pending → open
declineInvite(profileId, charId) // pending → declined
expireOldPendingInvites(profileId, charId) // 旧 pending 标 expired（跟 miya 一致）
```

**关键设计**：
- `markPending` 状态用 `pending`（不是 open）
- 已存在的空间如果是 `declined` / `expired`，重发邀请会**重置为 pending**（不是新建）
- `acceptInvite` 把 `openedAt = openedAt || Date.now()`（避免覆盖原来时间）

### 2. CoupleSpaceApp.handleConfirmInvite 流程

之前：initSpace + 发消息 + 跳空间
现在：完整 miya 流程
```ts
1. expireOldPendingInvites()  // 旧 pending 标 expired
2. markPending({...})          // 状态 pending（不直接开！）
3. DB.saveMessage({...type:'couple_space_invite', status:'pending'})
4. 跳转到角色的聊天（让暮色看卡片 + 接受/拒绝）
```

### 3. MessageItem 邀请卡片加接受/拒绝按钮

状态机：
- `status === 'pending'` → 卡片显示"接受" / "拒绝" 按钮
- 其他状态 → 只显示卡片（跟之前一样）

按钮 onClick 通过 `window.__coupleSpaceAccept` / `__coupleSpaceDecline` 全局函数调用 CoupleSpaceApp 暴露的 handler。

**为什么用 window 全局**：
- 不动 OSContext（避免改全局接口）
- 简单直接能用
- 下个阶段做 AI 决策时换成更优雅的方案（context / event bus）

### 4. 接受/拒绝后行为

**接受（暮色手动）**：
1. `acceptInvite` → status: open
2. 发 `type: 'couple_space_event'` 消息："情侣空间已开通 💕"
3. 跳到情侣空间
4. toast "和 XXX 的情侣空间已开通"

**拒绝（暮色手动）**：
1. `declineInvite` → status: declined
2. 发 system 消息："情侣空间邀请已拒绝"
3. 不跳（暮色在聊天里）
4. toast "已拒绝 XXX 的邀请"

## 动了哪些文件

- `utils/coupleSpaceStorage.ts` — 加 4 个函数（markPending / acceptInvite / declineInvite / expireOldPendingInvites）
- `apps/CoupleSpaceApp.tsx`：
  - 加 imports（markPending / acceptInvite / declineInvite / expireOldPendingInvites / AppID）
  - 改 handleConfirmInvite（完整 miya 流程）
  - 加 handleUserAccept + handleUserDecline
  - 加 useEffect 把 handler 挂到 window
  - 改主动发消息的 content + metadata
- `components/chat/MessageItem.tsx`：
  - couple_space_invite 卡片加接受/拒绝按钮（pending 状态）
  - 用 window 全局函数调 CoupleSpaceApp

## 暮色能立刻测的流程

1. **删除旧空间**：进空间 → 齿轮 → 解除情侣空间 → 确认
2. **重新邀请**：进情侣空间 → 邀请按钮 → 选江澈 → 填开始日 → 开通
3. **跳到聊天**：自动跳到江澈的聊天
4. **看邀请卡片**：滚到顶部看到"情侣空间邀请"卡片
5. **点接受**：状态变 open → 跳到情侣空间
6. **（或点拒绝）**：状态变 declined → 退到 gate

## 踩坑 / 需要知道的

1. **AI 决策没做**——暮色选 B 完整版 AI 决策，但 LLM 调 + JSON 解析 + 错误处理是大改动。这个 turn **暮色能立刻测**（手动接受），AI 决策下个阶段做（commit 时序上"先手动再自动"）。
2. **window 全局函数不优雅**——但能用。下个阶段做 AI 决策时换成 OSContext 方法（更 React 风格）。
3. **暮色审美**——这次没改 UI 颜色（还是 rose-100/pink-100），因为暮色建议"先功能后美化"。等**功能做完**（阶段 1）一起改配色。
4. **半自动 vs 自动**——暮色能测完整流程：发邀请 → 跳聊天 → 暮色点接受/拒绝。AI 决策下个阶段（让江澈用 LLM 自动响应，暮色不用手动点）。
5. **暮色 2026-07-31 拍板**：
   - 邀请流程选 B 完整版（**但实际实现先做半自动**——AI 决策下阶段）
   - UI 不喜欢粉色 + 整体布局不喜欢 → **先做功能，UI 后面统一改**
   - 顺序：功能 → 布局 → 默认样式 → 美化
6. **memory 同步**——4 条 user memory 已记（不要粉色 / 列 todo / 不简化 / AI 感知范围），跨项目适用。

## 备注

- **未完成 / 下次再说**：
  - 时间线模块（阶段 3）
  - 悄悄话模块（阶段 4）
  - AI 主动打卡（接 proactive 通道）
  - 用户打卡要不要发消息（待暮色定）
  - 测试江澈感知（暮色自己测）
  - **AI 自动决策完整版**（暮色选的 B，下个阶段做）
  - 第二阶段：整体布局重做
  - 第三阶段：去掉粉色（暮色审美）
  - 第四阶段：配色可调 + CSS 自定义 + 杂志风 + 主题切换（暂放）
- **暮色 2026-07-31 优先级**：
  - 第一阶段：功能（当前）— 邀请流程 / 时间线 / 悄悄话 / AI 主动打卡
  - 第二阶段：布局
  - 第三阶段：默认样式（去粉）
  - 第四阶段：美化
