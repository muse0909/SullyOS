# 朋友圈 autoPostByChar 语义重定义 + 删旧 useEffect 钩子 + 频率 0-100

**日期**：2026-07-12
**涉及 commit**：`9adfb98`

## 改了什么
暮色 2026-07-12 反馈："要 A. 把 autoPostByChar 默认关掉，让新加的 action 工具成为主路径。开关只管角色能不能调用 [[MOMENT_POST: ...]]，关了就是角色不会发朋友圈，开了就是角色可以自己决定发不发。频率控制改成 0-100。"

## 4 处改动

### 1. `utils/momentsStorage.ts` — 默认值
- `autoPostByChar: true → false`（新用户默认关，老用户保持原值）
- `maxPerDay: 2 → 100`（放开上限，0=关闭，100=基本不限制）

### 2. `apps/Chat.tsx` — 删旧 useEffect 钩子（**关键**）
- 删 `// 朋友圈：AI 回复完一轮后自动发朋友圈` 段（line 439-469，约 30 行）
- 删 5 个相关 import：`getMomentsSettings` / `getAllMoments` / `aiGeneratePost` / `publishPostAsChar` / `countTodayPostsByChar`
- **新加的 action 工具成为唯一路径**

### 3. `apps/MomentsSettingsPage.tsx` — UI
- 频率 slider `max={5}` → `max={100}`
- autoPostByChar 描述："你们聊完一轮后，AI 按上限自动发" → "开了：AI 在聊天中觉得合适时会自己发。关了：AI 完全不发朋友圈"
- 频率底部文案："设为 0 关闭自动发朋友圈" → "设为 0 完全不发；100 基本不限制"

### 4. `hooks/useChatAI.ts` — action 解析加开关检查
- MOMENT_POST 解析加 `autoPostByChar` 检查
  - `autoPostByChar=false` → 跳过所有 POST + toast 提示
  - `autoPostByChar=true` → 走原 maxPerDay 上限逻辑
- COMMENT / LIKE **不受** autoPostByChar 控制（暮色原话："只管 [[MOMENT_POST:...]]"）

## 踩坑 / 需要知道的（重要）

### 老用户 localStorage 里的 setting 不会被重置
- `getSettings()` 用 `{ ...DEFAULT_SETTINGS, ...parsed }` 合并——`parsed` 里的旧 `autoPostByChar: true` 优先级更高
- 暮色自己（已经用了一段时间）localStorage 里是 `true`，**新默认值对他无效**——需要他手动去设置页关一下
- **要不要在 SettingsPage mount 时检查并重置？**——可能过度（影响老用户体验），我倾向不重置。如果发现有问题再加

### useChatAI.ts edit 重复段
第一次 edit 时 oldString 没选对，留了 30+ 行重复的 if 块。第二次 edit 把重复段删了。**教训**：edit 复杂块时先 Read 一遍确认 oldString 唯一。

### Chat.tsx 5 个 import 全部清掉
确认过 import 只在那一个 useEffect 里用——删 useEffect 后这些 import 全部不需要了。**没有遗漏引用**（build 通过 + asset hash 变了）。

### 跟 trigger 流程（autoCommentMine）的关系
- `autoCommentMine` setting 不变——控制"用户发完朋友圈后 AI 自动点赞 + 评论 + 决定主动发消息"（trigger 流程）
- `autoPostByChar` 现在只控制"AI 主动发朋友圈 action"——**两个 setting 独立**
- 触发场景不同：trigger 是"用户发朋友圈后自动反应"；POST action 是"AI 聊天中自己想发"

## 跟 330 的对应关系
- 330 的 `enableQzoneActions` setting 跟新的 `autoPostByChar` 语义一致——"AI 能不能用 qzone action"
- 330 没有"每轮对话结束自动 trigger"这种自动行为——AI 想发就发
- 这次调整后 SullyOS 跟 330 行为对齐：完全交给 AI 决定触发时机

## 备注
- 待办未变
- 部署后暮色需要去设置页把 `autoPostByChar` 开一下（如果他之前是开的）—— **新用户自动关，老用户保持**
- 测试方式：跟江澈说"你可以发朋友圈"——他应该输出 `[[MOMENT_POST: 内容]]` 单行标记，UI 看到 "📱 江澈 发了一条新朋友圈" toast
