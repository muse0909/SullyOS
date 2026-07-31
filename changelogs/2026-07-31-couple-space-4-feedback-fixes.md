# 情侣空间 4 个反馈修复

**日期**：2026-07-31  
**涉及 commit**：（待提交）

## 暮色反馈（20:56）

> 1. 选角色没问题，只有一个卡片，看不到是谁发的
> 2. 没点接受/拒绝直接就开通了
> 3. 邀请卡没有粉色渐变，只有一个纯色
> 4. 验证 resetToPending（已开通过也能重新发邀请）/不要这个，已经开通了就不能重新发了

## 改了什么

### 1. 邀请卡加发送者（角色头像 + 名字）

之前卡片只显示"💕 情侣空间邀请" + 邀请文案，暮色看不到是谁发的。

修法：卡片顶部加圆形头像 + 角色名字 + "邀请你" 文字。`MessageItem` 用 `useOS().characters.find(c => c.id === m.charId)` 找角色信息。

```tsx
<div className="flex items-center gap-2 mb-3">
    <div className="w-8 h-8 rounded-full bg-white/80 ...">
        {sender?.avatar ? <img ... /> : <HeartIcon ... />}
    </div>
    <div className="text-[11px] font-bold text-rose-700">
        {sender?.name || 'TA'} 邀请你
    </div>
</div>
```

### 2. 邀请卡渐变加强（暮色看到的是纯色）

之前 `bg-gradient-to-br from-rose-100 to-pink-100` 两个相近浅粉色在小尺寸卡片上**看不出渐变**，暮色看到的是"纯色"。

修法：改三色渐变 + 深色边框 + 阴影让卡片更有立体感：

```diff
- bg-gradient-to-br from-rose-100 to-pink-100
- border border-rose-200/60
- shadow-sm
+ bg-gradient-to-br from-rose-200 via-rose-50 to-pink-200
+ border-2 border-rose-300/70
+ shadow-md
```

效果：从左上深粉 → 中间浅粉 → 右下粉，明显的颜色过渡。

### 3. 不再自动 AI 决策（暮色说"没点就开通"）

之前暮色主动邀请流程 (`handleConfirmInvite`) 调 `requestCoupleSpaceDecision(char.id)` — 60s 后 AI 默认 accept → 自动开通。暮色说"没点就开通"。

**两个邀请流程现在都不触发 AI 决策**：

- `apps/CoupleSpaceApp.tsx` `handleConfirmInvite`：删 `requestCoupleSpaceDecision(char.id).catch(...)` 调用
- `context/OSContext.tsx` `requestCoupleSpaceInviteFromChar`：本来就**没**调 AI 决策（之前我误判）

**`requestCoupleSpaceDecision` 函数保留**（OSContext 还在暴露），但没在邀请流程里调。后续如果暮色要"让 ta 决定"功能可以单独触发。

**暮色要的逻辑**：用户必须**手动点**接受/拒绝。点接受才开通，点拒绝才拒绝。不点就保持 pending 状态。

### 4. 删 `resetToPending`（暮色说"已开通不能重新发"）

暮色原话"已经开通的不能重新发了" —— 不需要 resetToPending。

修法：
- `utils/coupleSpaceStorage.ts` 删 `resetToPending` 函数
- `markPending` 原生行为：open 状态直接 return existing（保留）
- `requestCoupleSpaceInviteFromChar` 不用 resetToPending，加 `if (space.status === 'open') return;` 早退出
- `CharSelectForInviteModal` 加 `existingCharIds` props，弹窗里**只显示未开通**的角色

**完整流程**：
```
"让 ta 邀请我"按钮 → 弹窗只列未开通角色 → 选角色
  → markPending (open 直接 return) → 推邀请卡 → jumpToChat
"邀请 ta 开通情侣空间"按钮 → 弹窗只列未开通角色 + 填日期 → 开通
  → markPending → 推邀请卡 → jumpToChat
两者都：等用户手动点接受/拒绝
```

## 动了哪些文件

- `apps/CoupleSpaceApp.tsx` — `handleConfirmInvite` 删 AI 决策 + `CharSelectForInviteModal` 加 existingCharIds props
- `components/chat/MessageItem.tsx` — 邀请卡加发送者头像 + 渐变加强 + 阴影
- `context/OSContext.tsx` — `requestCoupleSpaceInviteFromChar` 不用 resetToPending
- `utils/coupleSpaceStorage.ts` — 删 `resetToPending` 函数

## 踩坑 / 需要知道的

### `useOS().characters` 在 MessageItem 里之前没解构

之前 `MessageItem` 只解构 `coupleSpaceAccept, coupleSpaceDecline`，没拿 `characters`。要加角色头像必须加。

修法：`const { coupleSpaceAccept, coupleSpaceDecline, characters } = useOS();`

### "渐变不明显" 是因为颜色对比度太小

`from-rose-100 to-pink-100` 两个 HSL 相近的浅粉色，浏览器渲染出来视觉上几乎一样。

**经验**：写渐变要让颜色对比度够（HSL 差 20-30 度以上），或者用 `via-` 中间色让渐变路径明显。**或者**用 `bg-color + border-2 + shadow-md` 让卡片有"立体感"代替渐变。

### `requestCoupleSpaceDecision` 现在是孤儿函数

OSContext 还暴露 `requestCoupleSpaceDecision` 但没在流程里调。

**下一步选择**（待暮色定）：
- A. 删了（避免死代码）
- B. 留着，以后做"让 ta 决定"按钮时用（卡片上加第三个按钮："让 ta 决定" / "我决定"）
- C. 留作 proactive 通道的扩展（AI 角色主动决定接受/拒绝）
