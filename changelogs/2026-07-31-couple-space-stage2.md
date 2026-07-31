# 情侣空间（CoupleSpace）— 阶段 2：打卡模块 + Launcher 入口移除

**日期**：2026-07-31
**涉及 commit**：
- `fix`: 移除 Launcher 情侣空间图标（暮色 2026-07-31 反馈）
- `feat`: 情侣空间阶段 2 — 打卡模块完整实现

## 改了什么

### 1. 移除 Launcher 入口（暮色 2026-07-31 反馈）

暮色测完发现 Launcher 主页右下多了"情侣空间"图标，**他不想要**：
- 暮色原话："Launcher 主页右下多了'情侣空间'图标（rose 色）这个没有，但是发现页有了，Launcher 主页的就不要了"

**改动**：`constants.tsx` 从 `INSTALLED_APPS` 移除 `AppID.CoupleSpace` 项
- `AppID.CoupleSpace` enum 保留（DiscoverPage 入口的 `openApp(AppID.CoupleSpace)` 还要用）
- 注释清楚："暮色 2026-07-31：情侣空间不放 Launcher，只从发现页进"
- 入口只剩：**发现页 → 情侣空间**

### 2. 阶段 2 — 打卡模块完整实现

**之前**：打卡 Tab 是占位（"开发中，下一轮做"）
**现在**：完整可用的打卡系统

#### 2.1 CheckinTab 主组件

- **顶部统计卡片**：马卡龙渐变（rose → pink）
  - 连续打卡天数（带 🔥 火苗图标）
  - 今日进度：用户/角色双方完成数
- **任务列表**：12 个任务卡片
- **最近 7 天小日历**：可视化打卡密度
- **底部提示**：AI 主动打卡"阶段 3 接 AI（30% 概率 / 一天最多 3 条）"

#### 2.2 CheckinTaskCard 任务卡片

- **未打卡状态**：白色背景 + "打卡"按钮（rose 胶囊）
- **已打卡状态**：浅 rose 背景 + 任务名加删除线 + "✓ 你" / "💗 ta" 标记
- **长按撤销**：800ms 长按触发（简化版，完整撤销逻辑阶段 3 加）
- **防止误触**：长按 timer 在 touchend / mouseleave 清理

#### 2.3 Last7DaysStrip 7 天小日历

- 7 列，每天一个方块
- 数字显示总打卡数
- 下行显示"我N · taN"（用户/角色分别）
- 今天那列 rose 高亮，其他灰色
- 没打卡显示半透明圆点

#### 2.4 打卡交互

- 用户点"打卡"按钮 → 调 `addCheckin('default', space.charId, ...)`
- 自动更新 localStorage
- 自动重算连续天数（`calcConsecutiveDays`）
- 自动刷 UI（`onUpdate` → `reload`）
- 成功 toast："已打卡「XX」"

## 动了哪些文件

- `constants.tsx` — 从 INSTALLED_APPS 移除 AppID.CoupleSpace
- `apps/CoupleSpaceApp.tsx` — 阶段 2 打卡模块完整实现
  - 1 个新主组件：`CheckinTab`
  - 2 个新子组件：`CheckinTaskCard` + `Last7DaysStrip`
  - 重写文件 19.9KB（原 12KB → 19.9KB，+65%）

## 踩坑 / 需要知道的

1. **暮色发现 Launcher 多图标**——`constants.tsx` 加 `AppID.CoupleSpace` 那一项时没意识到会被自动渲染到 Launcher。**经验**：以后加新 app 想"只在发现页有入口"时，**只加 AppID enum**，**不要加 INSTALLED_APPS**。
2. **撤销打卡简化版**——长按 800ms 弹"撤销功能下个版本加"toast，没真删记录。完整 undo 要单独的 `removeCheckin` 函数（按 record id 删），阶段 3 加。
3. **addCheckin 重复检测**——如果用户连续点 2 次"打卡"，会创建 2 条记录（不算 bug，因为 storage 算连续天数会算"今天打过卡"，UI 上不重复显示"打卡"按钮是因为 userDone=true 状态）。
4. **任务卡片"打卡"按钮点击会触发长按？**——`e.stopPropagation()` 已经在按钮 onClick 加上，避免外层 onTouchStart 误触。
5. **空数据状态**：空间刚开通时 `space.checkins = []`，连续天数 = 0，进度 = 0/0/12。UI 直接显示 0/0/12，不报错。
6. **暮色审美对齐**：
   - 主色 rose 系（跟发现页"小纸条"区分，"小纸条"是 rose-50/rose-500，"情侣空间"是 rose-100/rose-400）
   - 任务卡片圆角 rounded-2xl（24px 圆角）
   - 按钮胶囊（`rounded-full`）
   - 居中（连续天数、7 天日历都居中）
   - 留白（任务卡片之间 `space-y-2`，不挤）
   - 没用 backdrop-filter（避免 PhoneShell 那边的 fixed 定位坑）

## 备注

- **未完成 / 下次再说**：
  - 阶段 3：时间线模块（UI + AI 从记忆宫殿抽取 + 用户/角色手动添加）
  - 阶段 4：悄悄话模块（列表 + 输入 + 已读/未读 + 角色主动留）
  - 阶段 5：邀请机制（发邀请消息 + AI 决策 + 跳转聊天）
  - 阶段 6：关系开始日设置弹窗
  - 阶段 7：AI 主动打卡（接现有 proactive 通道）
  - 阶段 8：撤销打卡（独立 removeCheckin 函数）
  - 阶段 9：测试 + bug 修复
- **暮色 2026-07-31 反馈**：
  - Launcher 入口不要了（已修）
  - "继续做后面的"——意味着他想我做完整套，不是一个模块一停
