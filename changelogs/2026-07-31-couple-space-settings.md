# 情侣空间 — 设置弹窗（暮色 2026-07-31 反馈"没有关掉情侣空间的设置"）

**日期**：2026-07-31
**涉及 commit**：`feat: 情侣空间设置弹窗 — 改开始日 + 解除`

## 改了什么

暮色测完第三轮反馈 3 个问题：
1. **没办法测江澈能不能感知**——LLM 行为问题，不是 dev 任务
2. **UI 不喜欢**——具体哪里不喜欢要问暮色（这个 commit 没改 UI，等暮色反馈）
3. **没有关掉情侣空间的设置** ✅ 这次修了

### 1. 空间 Header 右上角加齿轮入口

```diff
- <div className="w-9 h-9" />  ← 空白
+ <button onClick={openSettingsModal}>
+   <GearIcon size={20} weight="bold" />
+ </button>
```

### 2. SettingsModal 弹窗（暮色审美对齐）

- 项目级 Modal（max-w-sm + rounded-[2.5rem] + max-h-[80vh]）
- **关系开始日** input（date 类型，可改历史日期）
  - "保存"按钮（rose 主色胶囊）
- 分隔线（h-px bg-slate-200）
- **解除情侣空间** 危险区
  - 红色 ⚠️ 图标 + "解除情侣空间"标题
  - 提示文字："解除后会删除所有打卡 / 时间线 / 悄悄话数据，**不可恢复**"
  - 红色边框按钮"解除..."（不是直接解除，跳二次确认）

### 3. UnbindConfirmModal 二次确认

- 居中卡片 + 💔 emoji
- "和 **江澈** 的情侣空间会被删除"
- "所有打卡 / 时间线 / 悄悄话都会消失"
- "还会告诉江澈这个决定"
- 底部两按钮："再想想"（slate 灰）/ "确认解除"（red-500 红色）

### 4. handleUnbindSpace 解除逻辑

```ts
const handleUnbindSpace = async () => {
  // 1. 删空间数据
  deleteSpace('default', activeSpace.charId);
  // 2. 推 system 消息告诉角色（跟开通时对称）
  await DB.saveMessage({
    charId: activeSpace.charId,
    role: 'system',
    type: 'couple_space_event',
    content: '暮色关掉了和你的情侣空间。',
    metadata: { source: 'couple_space_unbind', pairId: ... },
  });
  // 3. 跳回 gate
  setView('gate');
  setActiveCharId('');
  reload();
};
```

**注意**：解除时也发消息告诉角色（跟开通时对称）。暮色场景下"开通/解除"是一对操作，都得让角色知道。

## 动了哪些文件

- `apps/CoupleSpaceApp.tsx`：
  - 加 imports: `Gear`, `Warning`, `deleteSpace`, `setAnnivDate`
  - 加 3 个 state: `showSettingsModal` / `editableAnnivDate` / `showUnbindConfirm`
  - 加 3 个 handler: `openSettingsModal` / `handleSaveAnnivDate` / `handleUnbindSpace`
  - Space 视图 Header 右上角加齿轮
  - Space 视图末尾加 2 个 Modal
  - 加 2 个新组件: `SettingsModal` + `UnbindConfirmModal`
  - 文件 24.6KB → 30.2KB（+23%）

## 踩坑 / 需要知道的

1. **暮色场景不需要"解除确认弹窗的输入"**——一般产品会让你输名字确认（"输入江澈确认"），但暮色审美+他一个人用，简化成"💔 二次确认"弹窗就够了。**经验**：暮色一个人的产品，能简化的就简化（不照搬多用户产品设计）。
2. **解除也发消息给角色**——这是 miya 没做的（miya 多角色场景下，解除不需要通知）。**SullyOS 暮色场景**下，AI 角色得知道"用户关掉了空间"——否则下次 AI 还会提"我们去空间打卡吧"就尴尬了。
3. **`couple_space_event` type 这次用上了**——之前 type 加了但没用到。这次发"解除"消息用了 `type: 'couple_space_event'`。**用户打卡/悄悄话事件**以后也用这个 type。
4. **没改 MessageItem 渲染 couple_space_event**——因为现在只有"解除"事件，渲染成普通 system 消息就够（跟"连接中断"一样的样式）。以后打卡/悄悄话事件多了，再加专门的卡片。
5. **暮色说的"UI 不喜欢"没改**——这次 commit 故意没改 UI，等暮色具体说哪里不喜欢再改。**可能他不喜欢**：卡片（开通时那张）样式、关系天数显示、任务清单、7 天小日历。**等他反馈再优化**。
6. **暮色 2026-07-31 反馈 3 个问题**：
   - ❌ 测不了江澈感知 → 等他自己测 / 改 LLM prompt 才能测
   - ⏳ UI 不喜欢 → **等他说具体哪里**
   - ✅ 没有关掉设置 → 已修
7. **二次确认按钮配色**——"确认解除"用 red-500，"再想想"用 slate-100。**暮色审美**：删除类操作按钮要醒目（红色），但不能刺眼（用 soft red 不用 hard red）。
8. **解除消息发到 chat**——AI 角色能感知"暮色关掉了空间"（system 消息进 LLM context）。

## 备注

- **未完成 / 下次再说**：
  - 暮色说"UI 不喜欢" → 等反馈
  - 用户打卡事件是否推消息（待暮色定）
  - AI 主动读空间数据（proactive 通道扩展）
  - 悄悄话模块
  - 时间线模块
  - AI 主动打卡
  - 视觉打磨 + 测试
- **暮色 2026-07-31 反馈**：
  - "没办法测江澈能不能感知" → 等他聊了反馈
  - "UI 不喜欢" → **这次故意没改 UI，等他说具体哪里**
  - "没有关掉情侣空间的设置" → 已修
