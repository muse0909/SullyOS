# 朋友圈底层 + AI 通知 + 设置页

**日期**：2026-07-03
**涉及 commit**：(本次)

## 改了什么

### 1. 弹窗 Modal 一刀切 → 高度自适应
暮色 2026-07-03 反馈"同步完看到好多弹窗底下都有很大的空白，不好看"。
- **之前**：`adaptiveHeight` 默认 false，固定 `h-[80vh]`（内容少时底部大量留白）
- **现在**：`adaptiveHeight` 默认 **true**，卡片 `max-h-[80vh]` 自适应
- **效果**：内容少的弹窗（如 API 弹窗）自动变矮；内容多的弹窗（如朋友圈设置）撑到接近 80vh
- **AGENTS.md 5.5 节同步修正**：明确"统一宽度/圆角 + 高度自适应 + 最高 80vh"

### 2. 朋友圈设置页（暮色要的功能，暮色 2026-07-03）
- 入口：DiscoverPage 齿轮 → 朋友圈设置页
- 4 大功能模块：
  - **自动化开关**（4 个）：
    - 自动评论我的动态（autoCommentMine）
    - 角色自动发朋友圈（autoPostByChar）
    - 角色间自动互动（autoCharInteraction，默认 off）
    - **发完通知 AI**（notifyAIOnUserPost，暮色 B 方案要的新开关）
  - **频率控制**：每角色每日上限滑块 0-5
  - **配图选择**（暮色 2026-07-03 要求的"生图选项"）：none / ComfyUI / NAI / MCD
  - **手动生成**（参考 330）：指定角色 + 篇数 + 一次性生成 N 条朋友圈
- 视觉：SullyOS 风格——马卡龙卡片 + iOS toggle + 居中胶囊按钮

### 3. AI 朋友圈底层（参考 330 couple-space.js）
新增 `utils/momentsAI.ts` 三个核心 API：
- **`generatePost`**：AI 发朋友圈 prompt（角色人设 + 用户人设 + 世界观 + 记忆 + 最近朋友圈避免重复 + 短期对话 + 纪念日）→ 输出 JSON `{content, imagePrompt, tags}`
- **`generateComment`**：AI 评论朋友圈 prompt → 输出纯文本（10-100 字）
- **`generateTriggerDecision`**：暮色要的"AI 决定是否主动发消息"——单次 LLM 调用，输出 `{shouldSend, message?}`，prompt 强制"只能发 0 或 1 条消息"
- **本地工具**：`likePostAsChar` / `commentPostAsChar` / `publishPostAsChar` / `countTodayPostsByChar`

### 4. Trigger 流程（暮色 B 方案）
- 用户发朋友圈 → `pushNotifyQueue` 写入队列
- AI 下一轮对话完（wasTyping → !isTyping 钩子）→ 消费队列
- **三步走**：
  1. AI 点赞（autoCommentMine 控制）
  2. AI 评论朋友圈
  3. AI 决定要不要主动发消息（暮色要求 prompt 提醒"是否要给用户主动发一条"）
- **"提醒一次"机制**：每条朋友圈 push 一次，pop 一次，**不会超**

### 5. AI 自动发朋友圈（autoPostByChar）
- 触发点：AI 回复完一轮（同一 `isTyping` 钩子，**1 轮 = 1 轮 user+AI**）
- 限制：autoPostByChar=true 且今天 char 未超 maxPerDay
- 流程：调 LLM 生成 content + imagePrompt → publishPostAsChar 写 localStorage → toast 通知

### 6. 跟定时主动消息（ProactiveChat）不冲突
- **两条独立轨道**：
  - 朋友圈 trigger 走"队列 + 单次提醒"——push 一次、pop 一次
  - 定时主动消息走 ProactiveChat 半小时/1 小时触发
- 朋友圈 trigger 不会刷屏（每条朋友圈只让 AI 决定一次）
- 定时主动消息频率完全不受朋友圈影响

## 动了哪些文件
- `components/os/Modal.tsx` —— `adaptiveHeight` 默认值 false → true（**所有弹窗自适应**）
- `AGENTS.md` —— 5.5 节弹窗规范修正（加 2026-07-03 修正版说明）
- `utils/momentsStorage.ts` —— MomentSettings 加 `notifyAIOnUserPost` / `imageGenProvider`；新增 notify queue（FIFO + 防重）
- `utils/momentsAI.ts`（**新文件**）—— AI 朋友圈工具（3 个 LLM API + 4 个本地工具）
- `apps/MomentsSettingsPage.tsx`（**新文件**）—— 朋友圈设置页 UI
- `apps/DiscoverPage.tsx` —— 齿轮入口接入 MomentsSettingsPage
- `apps/MomentsPage.tsx` —— `handlePublish` 末尾 push notify queue
- `apps/Chat.tsx` —— 加 2 个 useEffect（autoPostByChar + 消费 notify queue），import momentsAI

## 踩坑 / 需要知道的
- **build hash 变化**：`index-bwHW-Fga` → `index-ZQ3NOSi6`，新增 ~15KB（朋友圈设置页 + AI 工具）
- **`useEffect` 复用 `prevIsTypingRef`**：auto-TTS 已经更新过 ref，朋友圈两个 effect 都能正确判断"刚结束一轮"——不要单独建 ref，会 race
- **AI 主动发消息写 messages 数组**：暮色 2026-07-03 确认 OK；触发时弹 toast 通知
- **生图 provider 选择**暮色 2026-07-03 确认要，**但生图调用逻辑这次没做**（UI 选了但实际不调）——`imagePrompt` 字段存到 post 上了，后续要做时用即可
- **notify queue 是跨 char 共享的**：目前消费时取队首，没限定是哪个 char 的 post；理论上多 char 场景下可能串（一个 char 替另一个 char 评论/点赞）。下一轮可以加"按 charId 过滤"
- **auto-TTS 的 useEffect 仍然存在**（line 411-428），朋友圈的两个 useEffect 是独立的，**不会被 TTS 替换掉**——但都依赖 `prevIsTypingRef`，**只有第一个 effect 会更新 ref**，后面的只能读"上上一次的 typing 状态"。这不会出错（都是要 `wasTyping && !isTyping`），但要注意**今后如果加第三个 useEffect 用 ref，要确保它前面有 effect 更新 ref**
- **Dialog 弹窗（confirm）也走 Modal**——所以"同步完看到好多弹窗底下都有很大的空白"修好后，**所有确认弹窗**也自适应了

## 备注
- 测试流程（暮色要的话）：
  1. 朋友圈设置 → 开"发完通知 AI"
  2. 朋友圈发一条 → toast "已通知 AI"
  3. 跟 AI 聊一句（触发 AI 下一轮回复）
  4. 等 AI 回复完 → AI 自动点赞 + 评论 + 可能主动发消息
- **老用户**：MomentSettings 加了 2 个新字段（notifyAIOnUserPost=true, imageGenProvider='none'），`getSettings()` 用 `DEFAULT_SETTINGS` 兜底，**老用户升级后自动开启 notifyAIOnUserPost=true**（暮色 OK 的话）
- 朋友圈 AI 配图这次只存 imagePrompt，**不调生图**——留到下一轮
- autoCharInteraction（角色间自动互动）也只定义了字段，**没实现逻辑**——下一轮
