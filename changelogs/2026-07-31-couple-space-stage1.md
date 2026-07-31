# 情侣空间（CoupleSpace）— 阶段 1：基础设施 + 最小骨架

**日期**：2026-07-31
**涉及 commit**：见 `git log`（本次任务单一 commit）
**状态**：阶段 1（基础设施 + 入口 + 最小骨架），核心 3 模块（打卡/时间线/悄悄话）开发中

## 改了什么

情侣空间基础版启动。**只服务暮色一个人**（暮色 2026-07-31 明确"琪琪不用了，不分享"），用户-角色一对一，每对独立数据。

### 阶段 1 已完成（本次 commit）

- **数据结构**（`types.ts`）：
  - `AppID.CoupleSpace` 新增
  - `CoupleSpace` 接口（pairId, profileId, charId, status, annivDate, 3 模块数据）
  - `CoupleCheckin` / `CoupleTimelineItem` / `CoupleWhisper` / `CoupleInviteMessage` 接口
  - `DEFAULT_COUPLE_TASKS` 默认任务清单（12 个）
- **存储**（`utils/coupleSpaceStorage.ts`，新文件，11.9KB）：
  - CRUD 封装（`getSpace` / `upsertSpace` / `initSpace` / `deleteSpace` / `getAllSpaces`）
  - 关系开始日 `setAnnivDate` + `daysTogether` 自动算天数
  - 打卡模块：`addCheckin` + 连续天数自动算 + `shouldTriggerAiCheckin`（30% 概率 / 一天 3 条 / 6 小时间隔）
  - 时间线模块：`addTimelineItem` / `updateTimelineItem` / `deleteTimelineItem` + `timelineHasContent` 去重检测
  - 悄悄话模块：`addWhisper` / `markWhispersRead` / `deleteWhisper` + 未读数自动维护
  - 软上限：checkins 365 / timeline 200 / whispers 200
- **入口**：
  - `constants.tsx` INSTALLED_APPS 加 `AppID.CoupleSpace`（name: '情侣空间', icon: 'CoupleSpace', color: 'rose'）
  - `components/PhoneShell.tsx` 加 import + 路由
  - `apps/DiscoverPage.tsx` 加"情侣空间"入口（在日记下面），点关掉发现页 + 打开独立 app
- **最小骨架**（`apps/CoupleSpaceApp.tsx`，新文件，12KB）：
  - 2 视图：`gate`（空间列表 + 邀请入口） / `space`（3 Tab）
  - 3 Tab 占位：打卡 / 时间线 / 悄悄话（每个 Tab 显示"开发中，下一轮做"）
  - 关系天数显示（daysTogether）
  - 已开通空间列表卡片（显示对方头像、在一起天数、打卡次数）
  - 邀请按钮（占位："开发中"）
  - 任务清单预览（显示 6 个 + 6 折叠）

### 任务清单细节（暮色 2026-07-31 确认版）

暮色原始 15 个 → 改 13 个：
- **去掉**"和 ta 说早安"（主动消息每天在做）
- **改**"看 ta 的朋友圈" → "写悄悄话"
- **合并**"听 ta 推荐的歌" + "一起听一首歌" → "邀请一起听"
- 保留 12 个：夸 ta / 写悄悄话 / 问心情 / 贴贴 / 写信 / 晚安吻 / 提醒喝水 / 邀请一起听 / 写日记 / 约会建议 / 道歉 / 庆祝纪念日

### 关键设计决策（暮色 2026-07-31 拍板）

1. **只服务暮色一个人**——profileId 写死 'default'，代码留扩展但不主动用
2. **数据隔离**——按 `${profileId}__${charId}` 配对存，暮色和琪琪各看各的
3. **关系开始日可设置**——`annivDate` 字段，暮色和江澈已经认识大半年了可以填历史日期
4. **邀请机制照抄 miya**——下一阶段实现：发 type: 'couple_space_invite' 消息到聊天，触发 AI 决策
5. **AI 主动打卡**：`shouldTriggerAiCheckin` 已实现（30% 概率 / 一天 3 条 / 距离上次主动 > 6 小时）
6. **时间线来源**：AI 自动从记忆宫殿抽取 + 用户/角色手动添加（下一阶段实现）
7. **入口**：Launcher 主页（替换"交换日记"位置）+ 发现页（在日记下面）

## 动了哪些文件

- `types.ts` —— 加 5 个 interface + 1 个 const（任务清单）+ AppID.CoupleSpace
- `utils/coupleSpaceStorage.ts` —— 新文件，存储 CRUD（11.9KB）
- `constants.tsx` —— INSTALLED_APPS 加 AppID.CoupleSpace 项
- `components/PhoneShell.tsx` —— import + 路由
- `apps/CoupleSpaceApp.tsx` —— 新文件，最小骨架（12KB）
- `apps/DiscoverPage.tsx` —— 加 CoupleSpaceEntry 组件 + 入口按钮

## 踩坑 / 需要知道的

1. **"交换日记" app 还没动**——暮色 2026-07-31 说"先隐藏，把情侣空间入口放在这里"。但这次 commit 还没改 INSTALLED_APPS 里的 Journal 项（`apps/Launcher.tsx` 用的就是 INSTALLED_APPS）。**下一阶段需要隐藏 Journal 项**——具体方案：把 Journal 项从 INSTALLED_APPS 删掉，或加 `enabled: false` 字段。
2. **AppIcon 组件期望 'CoupleSpace' icon 名**——`components/os/AppIcon.tsx` 应该有 icon 映射（表情/SVG）。如果没注册，新 app 图标会显示成默认占位。**下一阶段要确认 AppIcon 注册了 CoupleSpace icon**。
3. **`openApp` 是同步的**——`DiscoverPage` 里我用 `setTimeout(() => openApp(...), 50)` 是因为 onClose 后立即 openApp 会有路由冲突，延一帧稳。
4. **任务清单 emoji 是中文混排**——`DEFAULT_COUPLE_TASKS` 里 emoji 直接写在 name 旁边，UI 也直接显示，不需要额外处理。
5. **暮色审美：马卡龙色系**——骨架用了 rose 渐变（淡粉/淡玫红），暮色审美"简洁干净清新"对齐。下一阶段视觉打磨保持这个调性。
6. **没动 Chat 的消息结构**——邀请机制是 type: 'couple_space_invite' 消息，**下一阶段要在 Chat 加消息渲染支持**。

## 备注

- **未完成 / 下次再说**：
  - 阶段 2：打卡模块完整实现（任务清单 UI + 标记完成 + AI 主动触发集成）
  - 阶段 3：时间线模块（UI + AI 从记忆宫殿抽取 + 用户/角色手动添加）
  - 阶段 4：悄悄话模块（列表 + 输入 + 已读/未读 + 角色主动留）
  - 阶段 5：邀请机制（发邀请消息 + AI 决策 + 跳转聊天）
  - 阶段 6：关系开始日设置弹窗
  - 阶段 7：隐藏 JournalApp + 确认 AppIcon 注册
  - 阶段 8：视觉打磨（暮色审美 + 弹窗规范）
  - 阶段 9：测试 + bug 修复
- **依赖项**：
  - 用现有 localStorage 模式（参考 `utils/favoritesStorage.ts`）
  - 不引入新库
- **跟其他功能耦合**：
  - 跟 MemoryPalaceApp 耦合（时间线 AI 抽取要用记忆宫殿数据）
  - 跟 Chat 耦合（邀请消息要进聊天流）
  - 跟主动消息系统耦合（AI 主动打卡要走现有 proactive 通道）
- **暮色** 2026-07-31 确认状态：
  - 只想"只服务自己"——代码留扩展但不主动用多用户
  - 任务清单去掉"说早安"和"看朋友圈"，合并"听歌"+"一起听"为"邀请一起听"
  - 关系开始日可设置历史日期
  - 邀请机制照抄 miya
  - AI 主动打卡：30% 概率 / 一天 3 条 / 6 小时间隔
  - 入口：Launcher 主页（替换"交换日记"位置）+ 发现页（在日记下面）
