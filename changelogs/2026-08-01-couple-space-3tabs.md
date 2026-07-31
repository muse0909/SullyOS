# 情侣空间第一阶段 3 模块补完：时间线 + 悄悄话 + AI 主动打卡

**日期**：2026-08-01
**涉及 commit**：`3de5bc0` `405faa7`

承接 handoff 文档（`changelogs/2026-08-01-couple-space-handoff.md`）的"第一阶段还差 3 个功能模块"，本窗口全部补完。

---

## 改了什么

### 1. 时间线 Tab（commit `3de5bc0` 包含）

手动添加 + 列表展示 + 编辑 + 删除 + 心情（6 选 1）+ source 区分。

- 标题（必填）+ 详情（可选）+ 日期（默认今天，可填历史）+ 心情（开心/甜蜜/想念/难过/生气/一般，可不选）+ 谁加的（我 / 模拟 ta）
- 列表：mood emoji 圆形头 + 标题（粗体）+ 详情（line-clamp-3）+ 来源徽章
- 编辑：右上角铅笔按钮，复用 AddTimelineItemModal
- 删除：右上角垃圾桶 + 通用 ConfirmModal（primary / danger 两色）
- 编辑时 source 不可改成 ai-extract（防误改）；编辑其他 AI 抽取的条目时强制改回 user-manual / char-manual

storage API：`addTimelineItem` / `updateTimelineItem` / `deleteTimelineItem`（storage:318-359）已写好，本窗口直接用。

### 2. 悄悄话 Tab（同 commit）

列表 + 输入 + 已读/未读 + 删除 + 自动 mark read。

- 倒序展示（最新在上，仿聊天流习惯）
- ta 未读用高亮：白底 + rose-200 边框 + 名字旁 1.5px 红点
- 底部固定输入：textarea（Enter 发 / Shift+Enter 换行）+ 发送按钮
- 进入 tab 自动调 `markWhispersRead('default', charId)`（50ms 后 reload）
- 单条支持双击删除（也保留底部"删除"文字按钮，PC + 移动都顺）
- 时间显示：当天 `HH:MM` / 隔天 `MM/DD`
- 我/ta 头像：用户侧用文字"我"，ta 侧用 `char.avatar`（无则心形兜底）

storage API：`addWhisper` / `markWhispersRead` / `deleteWhisper`（storage:384-427）已写好，本窗口直接用。

### 3. AI 主动打卡接 runProactive（commit `405faa7`）

在 `OSContext.tsx:runProactive` 早检查 `shouldTriggerAiCheckin`，命中 → addCheckin + 推系统消息 + **不调 LLM**（一个 trigger 只产生一个事件）。

- 早退位置：`proactiveConfig.enabled` 检查之后（line 1371）、`决定 API` 之前（line 1375）
- 命中时：addCheckin（fromChar: true）+ 推系统消息 `type: 'couple_space_event'` + dispatchEvent 'proactive-message-sent'（让聊天页 bubble + 未读 badge 跟上）+ drainQueuedProactive + return
- 系统消息 content 用 `[情侣空间事件] X 完成了「Y」` 前缀（暮色 7/31 反馈：用户行为触发的 LLM 要主动引用，区别于技术状态）
- 任务从 `pickRandomTask()` 随机选（`DEFAULT_COUPLE_TASKS` 12 个任务）

storage API：`shouldTriggerAiCheckin`（storage:282）+ `pickRandomTask`（storage:304）+ `addCheckin` 早就写好，本窗口没人调 → 现在接上。

---

## 动了哪些文件

- `apps/CoupleSpaceApp.tsx`（657 行新增 / 21 行删除）
  - line 16-28：扩 import（addTimelineItem/updateTimelineItem/deleteTimelineItem/addWhisper/markWhispersRead/deleteWhisper + PencilSimple/Trash/PaperPlaneTilt/ArrowUUpLeft/X + useRef）
  - line 503-525：占位符 → `<TimelineTab/>` `<WhisperTab/>`
  - line 940 之后加：ConfirmModal + MOOD 常量 + TimelineTab + TimelineItemCard + AddTimelineItemModal + WhisperTab + WhisperItem
- `context/OSContext.tsx`（34 行新增）
  - line 12：加 `shouldTriggerAiCheckin / pickRandomTask / addCheckin` import
  - line 1374-1407：runProactive 早退逻辑（AI 主动打卡）

---

## 踩坑 / 需要知道的（重要）

### 1. AI 主动打卡不调 LLM 的设计依据

- 一个 `runProactive` 触发只产生一个事件：要么主动消息，要么主动打卡
- 如果两者都做：一天会双倍消息（暮色之前明确反对"频繁打扰"）
- 走的是 proactive schedule 触发频率 + `shouldTriggerAiCheckin` 30% 概率 → 一天平均 0-3 条，符合暮色要求

### 2. 系统消息没单独定制样式

暮色测的时候关注：聊天流里的 `[情侣空间事件] X 完成了「Y」` 走默认 `role: 'system'` 渲染（铃铛胶囊 + 黄/绿渐变），跟 `[连接中断: ...]` 同款。如果觉得太像技术消息，告诉我，加独立样式。

### 3. 情侣空间 CheckinTaskCard 不会自动刷新

AI 主动打卡后，`addCheckin` 只更新了 localStorage，没通知 CoupleSpaceApp 的 `reload()`。暮色要切到 CheckinTab 才会看到 `fromChar: true` 标记。

**两种修法**（**没动**）：
- (A) 加一个 storage 事件 / 自定义事件，CoupleSpaceApp 订阅后 reload
- (B) 监听 `window.addEventListener('focus', reload)`（不准确，会被误触发）

**不修的原因**：暮色测试节奏是"切到 tab 才看"，不强求实时同步。等暮色说"我刚切到 CheckinTab 没看到 ta 的打卡"再修。

### 4. 暂时没做"AI 抽取时间线"

handoff 里时间线第三项是"从记忆宫殿抽（AI 抽取，自动去重用 timelineHasContent）"。**这波没做**：
- 需要 LLM 抽取 pipeline（类似记忆宫殿的提取）
- 需要扫描聊天记录找"重要时刻"
- 暮色没催，**先放着**

### 5. 暂时没做"悄悄话 AI 主动留"

handoff 里说"角色主动留（proactive 通道）"。**这波没做**：
- 跟 AI 主动打卡一个 trigger 时间槽会冲突（一个 trigger 一事件）
- 应该走另一条通道（比如 `runProactive` 命中 AI 主动打卡之外的分支，或者新增一个 proactive 触发器）
- 暮色没催，**先放着**

### 6. 暮色不要粉色

当前情侣空间还是用 `rose-*` / `pink-*`（卡片、按钮、邀请卡渐变），**这波没改**——按 handoff 计划，第二阶段布局重做时一起改。

### 7. 整体没动布局

暮色说"功能 → 布局 → 默认样式 → 美化"优先级。**这波全是功能，布局是 CheckinTab 既有的 + 新 Tab 的基础布局**。第二阶段再说。

---

## 备注 / 下次再说

- [ ] 时间线 AI 抽取（记忆宫殿 → 时间线）
- [ ] 悄悄话角色主动留（proactive 通道新分支）
- [ ] CheckinTaskCard 自动 reload（AI 主动打卡后）
- [ ] 第二阶段：整体布局重做（去粉色、卡片化、磁贴化）
- [ ] 未确认 bug：暮色测"让 ta 邀请我 10 几秒就开通" — `b168584` fallback null 应该修好，没确认

---

## 验证步骤（暮色测的时候）

```
1. 强刷浏览器（Android Chrome → chrome://serviceworker-internals/ → Unregister SullyOS SW）
2. 关掉所有 SullyOS 标签页重开
3. 进情侣空间 → 点江澈
4. 测时间线：点"添加" → 填标题/详情/日期/心情/谁加的 → 保存 → 看列表
5. 测时间线编辑：点列表卡的铅笔 → 改 → 保存
6. 测时间线删除：点列表卡的垃圾桶 → 确认
7. 测悄悄话：切到悄悄话 tab → 写一句 → Enter 发送 → 看到气泡
8. 测悄悄话已读：另一设备 / 隐身发一条 → 进悄悄话 tab → 未读变 0
9. 测 AI 主动打卡：proactive schedule 设 1 分钟档（暮色 7/21 加过这个档）→ 等 5-10 分钟 → 看到 [情侣空间事件] 系统消息 + 切到 CheckinTab 看到 ta 的打卡
10. 如果第 9 步没触发：检查 shouldTriggerAiCheckin 的 30% 概率（10 次期望 3 次） + 6 小时间隔（同一天内不会重复）+ 一天最多 3 条
```
