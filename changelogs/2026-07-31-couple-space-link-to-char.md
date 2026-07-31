# 情侣空间 — 关联到角色（暮色 2026-07-31 反馈"角色不知道空间存在"）

**日期**：2026-07-31
**涉及 commit**：`feat: 情侣空间关联到角色 — 开通时发邀请消息到聊天`

## 改了什么

暮色测完第二轮反馈："情侣空间和角色要关联上啊，角色要知道情侣空间里的变化"。

**问题**：之前简化版开通时**只 initSpace + 跳空间**，**没发消息到聊天**。结果：
- 暮色能看到空间开通
- **江澈（角色）完全不知道**情侣空间存在
- 后续空间里所有事件（打卡、悄悄话、时间线）都跟江澈**完全无关**
- 等于"暮色单方面玩"——不是 miya 那种"双人空间"

### 1. 开通时发 type='couple_space_invite' 系统消息

**关键设计**：
- `role: 'system'` + `type: 'couple_space_invite'`
- content 进 LLM context → AI 角色**真正感知到**（不只是 UI 显示）
- metadata.pairId 关联情侣空间数据
- metadata.annivDate 渲染成"在 XXXX · Day 1"
- 暮色也能在聊天里看到这张卡片

```ts
await DB.saveMessage({
  charId: char.id,
  role: 'system',
  type: 'couple_space_invite',
  content: `暮色为你开通了情侣空间。从 ${inviteAnnivDate} 开始你们要一起打卡、留悄悄话、记重要时刻。`,
  metadata: {
    source: 'couple_space_invite',
    pairId: space.pairId,
    annivDate: inviteAnnivDate,
  },
});
```

### 2. types.ts MessageType 加新值

```ts
export type MessageType = '...' | 'couple_space_invite' | 'couple_space_event';
```

- `couple_space_invite`：开通消息
- `couple_space_event`：通用事件（用户打卡、AI 主动打卡、用户悄悄话等，**下阶段用**）

### 3. MessageItem 加特殊卡片渲染

暮色审美对齐——马卡龙粉渐变 + 居中卡片 + 💕 emoji：
- 背景：`bg-gradient-to-br from-rose-100 to-pink-100`
- 圆角：`rounded-3xl` (24px)
- 边框：`border-rose-200/60`
- 阴影：`shadow-sm`
- 卡片宽度：`max-w-[300px]`
- 内边距：`p-5`

```tsx
<div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-3xl p-5 max-w-[300px] w-full border border-rose-200/60 shadow-sm">
  <div className="text-center">
    <div className="text-3xl mb-2">💕</div>
    <div className="text-sm font-bold text-rose-600 mb-1">情侣空间已开通</div>
    <div className="text-[10px] text-rose-400 mb-3 tracking-wide">
      在 {annivDate} · Day 1
    </div>
    <div className="text-[11px] text-slate-500 leading-relaxed">
      {content}
    </div>
  </div>
</div>
```

## 暮色审美一致性检查

| 元素 | 情侣空间主色 | 卡片主色 | 跟发现页"小纸条"区分 |
|---|---|---|---|
| 空间入口 | rose-100/rose-400 | rose-100/rose-400 | 跟小纸条（rose-50/rose-500）**不同深度** |
| 任务清单 | rose-400 按钮 | rose-400 | OK |
| 邀请消息卡 | rose-100/pink-100 渐变 | rose-100/rose-600 | 跟小纸条（rose-50/rose-500）**不撞色** |
| 7 天小日历 | rose-100/rose-500 | rose-100/rose-500 | 跟空间内一致 |

## 动了哪些文件

- `types.ts` — MessageType 加 2 个新值（`couple_space_invite` + `couple_space_event`）
- `components/chat/MessageItem.tsx` — system 块最前面加 couple_space_invite 渲染分支
- `apps/CoupleSpaceApp.tsx` —
  - 加 `import { DB } from '../utils/db'`
  - handleConfirmInvite 加 `await DB.saveMessage(...)` 发邀请消息
  - 错误处理：DB.saveMessage 失败时 toast 提示"邀请消息发送失败，但空间已开通"

## 踩坑 / 需要知道的

1. **miya 简化版的"自我纠正"**——上一版我把 miya 的"发邀请消息"简化为"直接 initSpace"，暮色测试后发现**角色完全没参与**。**经验**：SullyOS 跟 miya 不同的关键不是"少发消息"，而是"AI 决策逻辑不同"——miya 模拟 AI 决策，SullyOS 暮色场景下是"暮色自己决定 + 通知 AI"。
2. **AI 角色能感知**——因为 `role: 'system'`，useChatAI 会把这条消息转成 `user` 角色 + 加 `[系统消息]` 前缀发给 LLM。**江澈的 LLM 下次对话时能知道"暮色开了情侣空间"**。
3. **错误处理**——如果 DB.saveMessage 失败（比如 IndexedDB 没空间），不能影响开通流程。try/catch + 单独 toast。
4. **暮色场景不需要"AI 决策接受/拒绝"**——miya 的多角色场景下"AI 决定是否接受邀请"是因为角色是模拟的。SullyOS 暮色场景下暮色自己决定，AI 角色只是被通知。**AI 决策逻辑**（角色是否"同意"）放在下个阶段的 `requestInviteDecision` 风格扩展里做。
5. **角色 AI 知道后能做什么**——目前角色 AI 只能"知道"（被动），还不能"主动来空间"（主动）。让 AI 主动来空间需要：
   - 角色 AI 通过 tool calling 读空间数据（高级）
   - 或者角色在主动消息周期（proactive）里检查空间数据
   - 留到下个阶段做
6. **用户打卡要不要发消息**？**这次没做**。暮色说"角色要知道空间变化"——开通时发了。**用户打卡时**让 AI 角色感知需要 2 选 1：
   - A. 每次打卡都发 system 消息（会刷屏，否决）
   - B. 每天汇总一次（晚上发"今天你完成了 N 个打卡"摘要）
   - C. 不发消息，让 AI 通过 proactive 读空间数据
   - **等暮色测完这个版本后决定**

## 备注

- **未完成 / 下次再说**：
  - 用户打卡事件是否推消息（待暮色定）
  - AI 主动读空间数据（proactive 通道扩展）
  - 悄悄话发消息
  - 时间线 AI 抽记忆
  - 关系开始日可在空间内修改
  - 解除情侣空间
  - 视觉打磨 + 测试

- **暮色 2026-07-31 反馈**：
  - "能进了，但是邀请做成了直接开通，没有给角色发邀请" → 已修（开通时发 type='couple_space_invite' 消息）
  - "情侣空间和角色要关联上啊，角色要知道情侣空间里的变化" → 部分修（开通事件已修，后续事件待定）
