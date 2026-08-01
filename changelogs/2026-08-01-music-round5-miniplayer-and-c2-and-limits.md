# 音乐 + 一起听 第 6 轮：mini player 短按进音乐app + 邀请消息简化 + C.2 + 次数上限

**日期**：2026-08-01
**涉及 commit**：`ad5d7fe`
**依赖**：`2026-08-01-music-3-bugs-round4.md`

## 改了什么

暮色反馈 4 件事 + 继续做 3 个未完成 todo：

### 1. 折叠态 mini player 长按跳音乐 app 不行 → 改成点封面进音乐 app 播放页
- `components/os/GlobalMiniPlayer.tsx:139-159` endDrag 改：折叠态 moved=false 时调 `openApp(AppID.Music)`（替换之前 `setExpanded(true)` 展开）
- `components/os/GlobalMiniPlayer.tsx:107-118` longPressTimer 改：折叠态长按 = `setExpanded(true)` 展开（替换之前 `window.location.hash = '#music'` 野路子跳转）
- `components/os/GlobalMiniPlayer.tsx:41` 加 `openApp` 解构（OSContext 提供）
- **新折叠态交互**：短按封面 = 进音乐 app 播放页；长按 = 展开浮窗；拖动 = 移位

### 2. 一起听邀请消息简化（用户看到的短版 vs LLM 看到的完整版）
- `apps/Chat.tsx:472-476` system msg content 改成只写事实：`暮色 刚刚邀请你一起听《XX》— YY`
- `hooks/useChatAI.ts:1000-1020` music_invite 分支：拼 LLM 看到的完整版（事实 + 提示词）：
  ```
  [一起听邀请] 暮色 刚刚邀请你一起听《XX》— YY
  （提示：可以自然地回应一下，聊聊你听到这首歌的感触、或者当下对 ta 的感觉；不一定要长篇大论，一两句也行，但别忽略这条邀请。）
  ```
- **设计原则**：Message.content = 用户在聊天流看到的事实；LLM 看到的提示词在 useChatAI 拼接，不进 DB，不显示给用户

### 3. C.2 — AI 主动放歌推 system 消息到聊天流
- `utils/chatParser.ts:131-140` 路径 A 完成后加一条 `DB.saveMessage({ role: 'system', type: 'text', content: '江澈给你放了《xxx》— yy，加入了"一起听"' })`
- type='text' → useChatAI 默认走 `[系统状态]` 前缀，LLM 不要主动引用（按 7-31 偏好，"AI 行为通知" = 系统状态类），但消息留在聊天流供用户看
- 主流程 `setMessages(await DB.getRecentMessagesByCharId)` 会把这条 system 消息一并 load 出来，UI 看到 `[系统: 江澈给你放了《xxx》]` 铃铛胶囊

### 4. AI 主动放歌的开关 + 每日每 char 次数上限
- `types.ts:1287-1301` UserProfile 加：
  - `musicAiAutoPlayEnabled?: boolean`（默认 true）— 总开关
  - `musicAiAutoPlayCount?: Record<date, Record<charId, number>>` — 每日每 char 次数计数
- `types.ts:1303` 加常量 `MUSIC_AI_AUTOPLAY_DAILY_LIMIT = 3`
- `hooks/useChatAI.ts:3811-3853` playSongFromChar 加两道闸：
  1. `userProfile.musicAiAutoPlayEnabled === false` → 静默拒绝
  2. 当天该 char 已用满 3 次 → 静默拒绝
  3. 成功放歌后 +1 计数（通过 `updateUserProfile` 持久化）
- `hooks/useChatAI.ts:525-526` UseChatAIProps 加 `updateUserProfile?: (updates: Partial<UserProfile>) => void`
- `apps/Chat.tsx:462` 把 `updateUserProfile` 传进 useChatAI
- `apps/MusicApp.tsx:813-841` 加"允许 AI 主动放歌"toggle UI（仿 miniPlayerHidden 那条，浅色马卡龙开关）

## 踩坑 / 关键认知

### 折叠态 mini player 短按的"两种期望"要分清
之前 0977a97 / 5e49f7f 我都把"短按 = 展开"当作默认行为，暮色 8-1 反馈其实**短按的真正用途是进音乐 app**（封面本身就是 mini player 的"快捷入口"）。展开是次要需求（现在长按承担）。
- 教训：**浮窗类组件，短按 = 跳到完整页面 / 上下文，长按 = 展开** — 这才符合 mobile UX 习惯
- 之前 `window.location.hash = '#music'` 这种野路子在 React Router 下不稳，**应该走 `openApp(AppID.X)`**（OSContext 提供的正经跳转）

### 一起听消息拆成"用户版 / LLM 版"是关键设计选择
暮色 7-31 提的偏好是"AI 不要主动引用技术状态"——但一起听邀请是用户行为触发，应该让 LLM 主动引用。
我之前的实现犯了一个错：把 LLM 提示词（"可以自然地回应一下..."）也写进 Message.content，结果用户看到的是冗长的提示词，LLM 看到的也是完整版。
**正例**：Message.content 是给用户看的（事实），LLM 看到的额外提示词在 useChatAI 转换层拼。
这种"分层"在 system 消息处理里很常见——把"事实"和"提示"分开，UI 端干净，prompt 端有信息。

### C.2 的 system 消息要用 'text' type 而不是 'music_invite'
- `music_invite` 是"用户行为触发"（暮色开一起听）→ `[一起听邀请]` 前缀，LLM 主动引用
- AI 主动放歌是 **char 行为**（不是用户行为）→ 应该归到 `[系统状态]` 类，LLM 不要主动引用
- 用 `type: 'text'` 让 useChatAI 默认走 `[系统状态]` 分支，符合 7-31 偏好
- 消息本身仍然在聊天流（DB + setMessages refresh 加载出来），用户能看到

## 备注
- "允许 AI 主动放歌" toggle 默认 ON（跟 userProfile.musicAiAutoPlayEnabled === true 行为一致）
- "今日每 char 已用 3/3"这种提示**没做**（暮色没要求），超限后 LLM 看到的就是"歌搜不到"的 fallback（静默拒绝）
- 次数计数按本地日期（`new Date().toISOString().slice(0, 10)`）重置，跨时区不会自动重置（可能边界 case，先不管）
- char 切换不会清零计数（每天 3 次是按 char 算的，不按 chat session 算）
- UI 上没显示"今日已用 X/3"——暮色没要；要做就再加一条 toggle 下方的灰字说明
