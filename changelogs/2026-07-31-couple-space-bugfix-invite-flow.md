# 情侣空间邀请流程 3 bug 修复

**日期**：2026-07-31  
**涉及 commit**：（待提交）

## 暮色反馈（20:34）

> 1. 没有卡片，没有选择的直接就开通了。
> 2. [图二箭头指] 这弹出来的是 `[object Object]` —— 看起来 addToast 出了问题
> 3. 让他邀请我没有选择角色的功能

## 改了什么

### 1. 邀请卡片不渲染（暮色说"没看到卡片就开通了"）

**根因**：`requestCoupleSpaceInviteFromChar` 推的消息 `role: 'assistant'`（因为是 LLM 生成的邀请文案），但 `MessageItem.tsx` 的卡片渲染条件在 `if (isSystem) {` 块里，所以 assistant 角色的邀请消息**不会被识别为系统消息**——暮色只看到一条普通气泡"暮色向我走来的这一步..."，然后 60s 后 AI 默认 accept 跳过。

**修法**：把 `couple_space_invite` 卡片渲染从 `if (isSystem)` 块里**提取出来**，在 system 判断之前 early return。这样不管 `role` 是 `system`（暮色发起）还是 `assistant`（AI 发起），只要 `type === 'couple_space_invite'` 就走卡片渲染。

### 2. CharSelectForInviteModal 组件定义

之前在 `apps/CoupleSpaceApp.tsx` JSX 里**引用了** `CharSelectForInviteModal` 但**没写组件定义**——build 会报"Component not defined"或运行时 `Element type is invalid`。

**修法**：照抄 `InviteModal` 写一个只选角色、不要日期的简化版（因为"让 ta 邀请我"场景下，关系开始日用今天，日期由 `requestCoupleSpaceInviteFromChar` 自动填）。

```tsx
const CharSelectForInviteModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  characters: CharacterProfile[];
  onConfirm: (charId: string) => void;
}> = ({ isOpen, onClose, characters, onConfirm }) => { ... }
```

### 3. "让 ta 邀请我"按钮开弹窗

之前直接 `await requestCoupleSpaceInviteFromChar(activeCharacterId)`，**没有给用户选角色**——所以不管有几个角色都发邀请给当前 `activeCharacterId`。

**修法**：改成 `setShowCharSelectForInviteModal(true)`，弹窗让用户选。

```tsx
onClick={() => {
  if (characters.length === 0) {
    addToast('还没有角色，先去聊天里加一个', 'error');
    return;
  }
  setShowCharSelectForInviteModal(true);
}}
```

### 4. addToast 修复（顺带）

`addToast({ type, message })` 对象写法全部改成 `addToast(message, type)`（SullyOS 签名是 `(message: string, type?: Toast['type'])`）。涉及：

- `apps/CoupleSpaceApp.tsx` 7 处
- `context/OSContext.tsx` 已经用对的
- `addToast` 函数本身有 `String(message)` 防御，传对象会变成 `"[object Object]"` 字符串（暮色看到的 toast）

**为什么还有 `[object Object]` toast**：暮色看到的图二 toast 可能在旧版本部署（28b7bf8 之前），Vercel 部署未及时同步。**强刷浏览器**（Cmd+Shift+R / Ctrl+Shift+R）即可看到新版本。

### 5. resetToPending 强制重置（暮色反馈"已开通的没重置"）

`utils/coupleSpaceStorage.ts` 新加 `resetToPending(profileId, charId)` 函数：

```ts
export function resetToPending(profileId: string, charId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.status = 'pending';
  space.lastInviteAt = Date.now();
  upsertSpace(space);
  return space;
}
```

`requestCoupleSpaceInviteFromChar` 检测到 `markPending` 返回的 space 状态不是 pending（说明原来已开通过），就用 `resetToPending` 强制重置——保证邀请卡能正常显示"接受/拒绝"按钮。

## 动了哪些文件

- `apps/CoupleSpaceApp.tsx` — CharSelectForInviteModal 组件定义 + "让 ta 邀请我"按钮改开弹窗 + 7 处 addToast 修
- `components/chat/MessageItem.tsx` — couple_space_invite 卡片渲染提前（不依赖 isSystem）
- `context/OSContext.tsx` — `requestCoupleSpaceInviteFromChar` 加 `resetToPending` 兜底
- `utils/coupleSpaceStorage.ts` — 加 `resetToPending` 函数

## 踩坑 / 需要知道的

### `type` 比 `role` 优先 —— 渲染条件要按 type 走

之前卡片渲染双重条件：`(isSystem) && (m.type === 'couple_space_invite')`。这种写法把"卡片类型"绑死在"系统角色"上，导致 assistant 角色的邀请消息不渲染。

**正确写法**：`if (m.type === 'couple_space_invite')` 单独走 early return，不看 role。

**适用范围**：所有"特殊卡片"渲染应该只看 `type`，不要用 role 兜底（role 决定 LLM 上下文，type 决定 UI 渲染）。

### CharSelectForInviteModal 引用顺序

SullyOS 项目里，函数组件的**引用**可以出现在**定义**之前（JavaScript 函数提升 + const 实际上不提升但 V8 hoisting 处理）。但**调用**要等组件挂载，所以 render 里引用是 OK 的。

**写组件的顺序约定**：
- `CoupleSpaceApp` 主组件
- `InviteModal`、`CharSelectForInviteModal`（gate 视图用的）
- `CheckinTab`、`CheckinTaskCard`、`Last7DaysStrip`（space 视图用的）
- `SettingsModal`、`UnbindConfirmModal`（设置用的）

### 关于 `[object Object]` toast

暮色 20:34 截图里那个 `[object Object]` 弹在 gate 页顶部，**很可能不是 CoupleSpaceApp 触发的**——CoupleSpaceApp 里的 addToast 已经全是字符串了。

**最可能的原因**：Vercel 部署的不是最新代码（28b7bf8 之前）。暮色在手机上**没有强刷浏览器**（PWA / service worker 缓存了旧 bundle）。

**强刷方法**：
- Android Chrome：`Cmd+Shift+R` 不行（PC 快捷键）；要在 Chrome 里 `设置 → 隐私 → 清除浏览数据` 选"缓存的图片和文件"，或者 `chrome://serviceworker-internals/` 找到 SullyOS 那个 SW 点 Unregister
- iOS Safari：`设置 → Safari → 高级 → 网站数据 → 找到 sully-os-git-preview 域名 → 删除`

或者更简单：先在浏览器里**关掉所有 SullyOS 标签页**再打开，service worker 会失效。

## 备注

### 暮色验证流程

1. 强刷浏览器（按上面方法）
2. 情侣空间 → 设置（齿轮）→ 解除（先解掉旧空间，否则会跟新邀请冲突）
3. 重新走"让 ta 邀请我"流程
4. 应该看到：
   - 选角色弹窗（"让 ta 邀请"按钮）
   - 跳转江澈聊天页
   - 看到马卡龙粉渐变邀请卡（接受/拒绝按钮）
   - 接受/拒绝后正常开通/拒绝

### 下一阶段（暮色优先级）

- [ ] 时间线模块（AI 抽记忆宫殿 + 用户/角色手动添加）
- [ ] 悄悄话模块（列表 + 输入 + 已读/未读 + 角色主动留）
- [ ] AI 主动打卡（接 proactive 通道）
- [ ] 用户打卡要不要发消息（待暮色定）
- [ ] 第二阶段：整体布局重做（暮色不喜欢图三）
- [ ] 第三阶段：去掉粉色（暮色审美）
- [ ] 第四阶段（暂放）：配色借鉴系统主题可调 + CSS 自定义 + 杂志风 + 主题切换
- [ ] 音乐模块（独立任务）：接 `music.miruis.top` 第三方网易云 API + 备胎方案
