# 情侣空间 — 邀请机制（暮色 2026-07-31 反馈"测不了"）

**日期**：2026-07-31
**涉及 commit**：`feat: 情侣空间邀请机制 — 暮色反馈"测不了"优先做`

## 改了什么

暮色测完反馈："邀请你没做，我没办法开情侣空间就没办法测你说的那些呀"——**没空间就测不了任何模块**。我之前优先级排错了，应该先做邀请再做 3 模块。这次补上。

### 1. 邀请弹窗（InviteModal）

- 用项目级 Modal 组件（`components/os/Modal.tsx`）
  - max-w-sm + rounded-[2.5rem] + max-h-[80vh]（暮色审美标准）
  - 标题居中、底部按钮居中胶囊
- **选择 ta**（必填）：
  - 从 `characters` 列表过滤出未开通的
  - 单选卡片（点选 + rose 边框高亮 + 勾选图标）
  - 头像 + 名字
  - 没有可邀请的角色时显示提示
- **关系开始日**（必填，暮色要求可改）：
  - `<input type="date">` 默认今天
  - `max={今天}` 不让选未来
  - 提示文字："可以填历史日期，比如你和 ta 第一次说话那天"
- **底部按钮**（居中胶囊）：
  - 取消（slate 灰） / 开通（rose 主色）
  - 开通按钮 disabled 当没选角色

### 2. 提交逻辑（handleConfirmInvite）

暮色场景简化：
- 暮色只一个人用，profileId 写死 `'default'`
- 不发邀请消息到聊天（简化版）
- 不等 AI 决策（暮色自己决定开通）
- 直接调 `initSpace({...})` → 状态 `open` → 跳到 space 视图

```ts
initSpace({
  profileId: 'default',
  charId: char.id,
  charName: char.name,
  profileName: '我',
  annivDate: inviteAnnivDate,
});
setShowInviteModal(false);
setActiveCharId(char.id);
setView('space');
reload();
addToast({ type: 'success', message: `和 ${char.name} 的情侣空间已开通` });
```

## 跟 miya 的差异

暮色说"照抄 miya"——但 miya 的完整机制是"发邀请消息 + AI 决策"。**暮色场景里 AI 角色是被通知的，不是决策者**——暮色自己决定开通。

这次做的是**简化版**（暮色能直接开），完整 miya 机制（发消息到聊天 + AI 决策）放在下个 todo 做。

## 动了哪些文件

- `apps/CoupleSpaceApp.tsx`：
  - 加 `InviteModal` 组件（120 行）
  - 加 5 个状态：showInviteModal / inviteSelectedCharId / inviteAnnivDate
  - 加 2 个 handler：openInviteModal / handleConfirmInvite
  - 邀请按钮 onClick 从"开发中 toast"改成开弹窗
  - 文件 19.9KB → 24.6KB（+24%）

## 踩坑 / 需要知道的

1. **优先级错误**——我之前规划是"基础 3 模块 → 邀请机制"，但暮色场景下**没有空间就测不了任何模块**。下次写新功能，先想"用户能进到 app 吗"再想"app 内能做什么"。
2. **暮色审美对齐**——Modal 用项目级组件，胶囊按钮、居中卡片、rose 主色，跟发现页"小纸条"区分（rose-50/rose-500 vs rose-100/rose-400）。
3. **relationship_start_date 验证**——`<input type="date" max={today}>` 浏览器原生限制，暮色填了未来日期会自动报错。
4. **暮色场景**——profileId 写死 'default'。**未来如果加多用户**，要改 `initSpace` 调用，把 profileId 改成实际选中的。
5. **下阶段待办**：
   - 发邀请消息到聊天（type: 'couple_space_invite'）— 完整 miya 机制
   - 关系开始日可在空间内修改（现在只能在邀请时设）
   - 解除情侣空间（删除空间数据）
   - 时间线模块、悄悄话模块、AI 主动打卡
6. **去掉简化版的东西**：
   - CheckinTaskCard 里的"长按撤销"按钮文案（之前留了但没真实现）
   - 我把那段去掉了，避免误导暮色以为能撤销

## 备注

- 暮色测这个版本能看到：
  - 邀请弹窗能开
  - 选角色 + 填日期能提交
  - 空间直接开通，跳到打卡 Tab
  - 12 个任务能打卡
  - 连续天数 + 7 天小日历能显示
  - 不能测：发邀请消息、AI 主动打卡、时间线、悄悄话（这些下阶段做）
