# 情侣空间接受/拒绝 UI 反馈 + 邀请卡状态视觉区分

**日期**：2026-07-31  
**涉及 commit**：`ecd04e0`

## 改了什么

### 1. 接受/拒绝按钮给反馈（核心修复）

**根因（暮色 22:00 反馈）**：暮色说"点接受/拒绝按钮没反应 + 自动开通了"——其实是**同一个 bug 的两个症状**：

- `acceptInvite` / `declineInvite` 只改 `localStorage` 的 `space.status`
- **不**改 IndexedDB 里的邀请卡 `message.metadata.status`
- → space 真的开了（暮色看 gate 视图能找到）
- → message 还显示 `pending` → MessageItem 按钮还在 + 没 toast → 看着"没反应 + 自动开通"

**修法**：
- `coupleSpaceAccept` 调 `acceptInvite` 后，调 `DB.updateMessageMeta` 把邀请卡 `metadata.status` 改成 `'accepted'`，**外加** `resolvedAt: Date.now()`
- `coupleSpaceDecline` 同理改成 `'declined'`
- 接受/拒绝后给 `addToast` 反馈（"已开通 💕" / "已拒绝"）
- 接受失败（space 找不到）时**自动重建**：`markPending` + 再 `acceptInvite`，避免"幽灵邀请卡"
- `dispatchEvent('coupleSpaceInviteResolved', { detail: { charId, status } })` 通知 Chat
- `apps/Chat.tsx` 监听这个事件 → `reloadMessages(visibleCountRef.current)` → MessageItem 重新渲染 → 按钮自动消失 / 卡变"已接受"

### 2. 邀请卡视觉区分（已接受 / 已拒绝）

暮色反馈"接受/拒绝点完应该变成已拒绝或者已接受"。

**修法**：MessageItem 邀请卡根据 `m.metadata?.status` 给不同视觉：

| 状态 | emoji | 标题 | 背景 | 边框 |
|---|---|---|---|---|
| `accepted` | ✅ | 情侣空间已接受 💕 | 浅绿渐变 (emerald → white → teal) | emerald-200 |
| `declined` | 🚫 | 情侣空间邀请已拒绝 | 浅灰渐变 (slate → white) | slate-200 |
| `pending`（含老数据无 status 字段） | 💕 | 情侣空间邀请 | 三色粉渐变（原版） | rose-300 |

**兼容老数据**：`inviteStatus === 'pending' || !inviteStatus` 都按 pending 渲染按钮——之前没 status 字段的卡（隐身窗或迁移过来的）也能继续点。

## 动了哪些文件

- `context/OSContext.tsx`
  - `coupleSpaceAccept` / `coupleSpaceDecline`：加 `markInviteMessageResolved` + `dispatchEvent` + `addToast` + 失败时 `markPending` 重建
  - 新增私有函数 `markInviteMessageResolved(charId, newStatus)`：找最新 pending 邀请卡 → `DB.updateMessageMeta`
- `apps/Chat.tsx`
  - 新增 `useEffect` 监听 `coupleSpaceInviteResolved` 事件 → `reloadMessages(visibleCountRef.current)`
- `components/chat/MessageItem.tsx`
  - 邀请卡渲染块：根据 `inviteStatus` 切 `cardClass` / `titleText` / `titleClass` / emoji
  - 兼容老数据：`isPending = inviteStatus === 'pending' || !inviteStatus`

## 踩坑 / 需要知道的

### "自动开通" 真实根因

之前 commit (`51b1818` / `eb29d00`) 删了 `requestCoupleSpaceDecision` + `resetToPending`，**理论上**没有自动开通路径了。暮色**反复**遇到"自动开通"——实际是：

- 暮色点接受按钮 → `acceptInvite` 真执行 → space 真变 `open`（自动开通就是这个）
- 但 `message.metadata.status` 没更新 → MessageItem 按钮还在 → 暮色看像"没反应"
- 暮色回到 gate 视图发现空间真开了 → "我没点啊" = "自动开通"

**修了 UI 反馈**后，暮色点接受 → 立刻看到 toast"已开通" + 卡变"已接受" + 按钮消失 → 不会再有"自动开通"的错觉。

### `markInviteMessageResolved` 取"最新 pending"而不是"指定 pairId"

为什么：`requestCoupleSpaceInviteFromChar` 每次都生成一张新邀请卡（meta 里有 `pairId`），老卡可能在不同时间点。但**接受/拒绝操作**的语义是"对当前**最新**邀请做响应"——所以取 `id` 最大的 pending 卡。

**边界 case**：如果之前手动 `markPending` 了但没生成卡（理论上不会发生），点接受会找不到 target — `markInviteMessageResolved` 静默失败（不影响主流程，space 已经开了）。

### `dispatchEvent` 不用 React Context 传

为什么：OSContext 在最顶层，但 `MessageItem` 在 Chat 树深处。走 React context 传 callback 会改很多文件。`window.dispatchEvent` 跨组件通信成本最低，且 `Chat.tsx` 已经有 `sullyos:direct-ai-message` 监听模式可以照抄。

**注意**：事件 detail 里只传 `charId` + `status`，不传整个 message——避免内存泄漏。

### 接受失败时的"自动重建"

`acceptInvite` 早退条件：`getSpace` 返回 null。**可能原因**：
- localStorage 真没数据（隐身窗 + 之前没 markPending）— 不会到 accept 按钮，因为不会有卡
- 老版本 commit 残留数据（schema 变了）
- `deleteSpace` 解除后 user 重新点接受（**这就是暮色截图的状态**——中间那个"暮色关掉了" toast）

**重建策略**：
- `characters.find(c => c.id === charId)` 找角色（拿 charName）
- `new Date().toISOString().split('T')[0]` 拿今天当 annivDate
- `markPending({...})` 写 localStorage
- 再 `acceptInvite` —— 这次 space 找到了，能成功

**这样暮色解除后再点接受**也能开通，不会被"幽灵邀请卡"卡死。

## 备注

- "谁邀请都没有回复"（让 ta 邀请我 / 邀请 ta 开通）暮色描述的另外两个场景，**这次没修**。可能根因是 LLM 调失败（API quota / 网络），下次再排查。
- 修完后建议暮色测：隐身窗 1）点 Sully 接受 → toast + 卡变绿 + 按钮消失；2）点 User 拒绝 → toast + 卡变灰 + 按钮消失；3）解除后再点接受 → 也能开通（自动重建）。
