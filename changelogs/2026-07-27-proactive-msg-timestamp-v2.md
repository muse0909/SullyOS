# 主动消息时间戳 v2：proactive 永远独立 group + 时间戳加视觉标记

**日期**：2026-07-27
**涉及 commit**：`9255e56`

## 改了什么

暮色反馈 7/23 + 7/27 上午两版都"还是会合并"——这次追到根因了。

### 根因分析

**1. calcBreaks v1 漏判**（`apps/Chat.tsx`）
- 暮色说"超过 1 分钟都打时间戳"我之前只把 **proactive↔proactive** 设成永远独立
- **assistant 正常回复跟 assistant proactive 仍按 1 分钟规则**——同分钟内（< 1 分钟）会被合并
- 这种 case：AI 22:00:00 正常回复 + proactive 22:00:30 触发，**role 相同 + gap < 1 分钟** → 同 group

**2. formatTime 只显示 HH:MM**（`MessageItem.tsx:26`）
- 22:00:00 跟 22:00:30 的 formatTime 都是 "22:00"——**秒级看不出来**
- 多条同分钟消息时间戳文本完全一样，视觉上"合并"是必然的

### 这次改的 2 件事

**A. proactive 永远独立 group**（`apps/Chat.tsx` calcBreaks 简化）

```ts
// 任何一边是主动消息：永远独立 group（哪怕 0 秒）
if (curProactive || neighborProactive) return true;
```

- 删了 PROACTIVE_GAP_MS（1 分钟）这个中间状态
- 不管 prev/next 是不是 proactive，proactive 一律独立
- normal user/AI 对话还是 30 分钟 group（不变）

**B. proactive 时间戳加视觉标记**（`MessageItem.tsx:559-572`）

```tsx
<div className={`text-[9px] px-1 mt-1 font-medium flex items-center gap-1 ${
    m.metadata?.isProactive
        ? 'text-violet-500/85 bg-violet-50/70 rounded-full px-2'
        : 'text-slate-400/80'
}`}>
    {m.metadata?.isProactive && (
        <span className="w-1 h-1 rounded-full bg-violet-400 shrink-0" />
    )}
    {formatTime(m.timestamp)}
</div>
```

- 主动消息时间戳：紫色小圆点 + 浅紫胶囊底（`bg-violet-50/70`）
- 普通时间戳：浅灰色文字（不变）
- **秒级看不出来也能认出"这是主动"**

## 动了哪些文件

- `apps/Chat.tsx` — calcBreaks 简化，删 PROACTIVE_GAP_MS
- `components/chat/MessageItem.tsx:559-572` — 时间戳渲染分支加 proactive 样式

## 踩坑 / 需要知道的（重要）

- **formatTime 不动**：暮色日常聊天节奏不变。**不**改成 HH:MM:SS 那种加秒——会打扰所有用户
- **v1 漏判的真正原因**：我当时只考虑了 "proactive 之间" 的 case，没考虑 "proactive 跟前面 AI 正常回复"——是边角 case
- **视觉标记用紫色 + 胶囊**：暮色偏好马卡龙色系，紫色也是 proactive 主题色（看 ChatInputArea.tsx:583 也是紫色），跟现有 UI 一致
- **小圆点 `w-1 h-1` 是 4px**：在 `text-[9px]` 时间戳里是合适比例，不会太抢眼
- **历史消息不会自动补救**：只对本次 push 后新触发的主动消息生效

## 备注

- 这次是 v2，覆盖 7/27 上午的 v1（`f0a80c0`）的 calcBreaks 实现
- 暮色累了一定要直接说，不要硬问——这次我看了 formatTime 才意识到是"看着像合并"而不是"真合并"
- 7/23 changelog 也提过"老消息不补救，要 migration 脚本"——这次也没动，要补救得跑脚本（暂不做）
