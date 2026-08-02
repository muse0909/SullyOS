# 音乐第 10 轮：play_song 注册成真正的功能工具 + 修聊天挂载时一起听误推提醒

**日期**：2026-08-02 16:32
**涉及 commit**：`5874ced`

## 改了什么

### 1. 推进 handoff #1：play_song 注册成 OpenAI 协议功能工具

**之前**：play_song 只通过文本标记 `[[MUSIC_ACTION:play_song|歌名]]` 触发，大语言模型要听话输出标记才生效。8-2 凌晨 02:07 Sully 那段话"我手上能用的动作就那几个——戳你、转账、调记忆、发朋友圈、写纸条。放歌不在我列表里" = 大语言模型视角"我做不到"。

**现在**：照 `generate_image` 生图工具的注册模式，在 `hooks/useChatAI.ts:69` 附近加 `PLAY_SONG_TOOL` 定义，工具列表里能直接看到 `play_song` 动作。结构上让大语言模型能调，不靠提示词哄。

**两条路径并存**：
- 功能工具调用（OpenAI 协议下）：工具列表里能调，结果回传大语言模型下一轮
- 标记解析作 fallback（Claude 协议 / 功能工具不可用时）：文本标记 `[[MUSIC_ACTION:play_song|歌名]]` 仍生效

### 2. play_song 工具业务流程

调顶层 `playSongFromChar`（`hooks/useChatAI.ts:594` 附近，从 chatParser 调用处的对象字面量提到顶层），复用现有所有检查：
- 总开关 `userProfile.musicAiAutoPlayEnabled === false` → 静默拒绝
- 每日每 char 3 次上限 → 静默拒绝
- 搜歌（精确匹配 + pop 降序 + fee 升序）→ 选第一首
- 播放 + 替换队列为这 1 首 + +1 计数

成功路径：
1. `join=true` 时 `playSongAndJoinHandled.add(char.id)` + `music.addListeningPartner(char.id)`（早于 setState 触发 React flush）
2. 推系统消息 type='music_invite'（大语言模型走 [一起听邀请] 分支主动引用）
3. 推音乐卡片（intent: 'play_song' 或 'play_song_and_join'）
4. addToast 提示

失败路径：推系统消息"X 想放《歌名》但没找到合适的版本（搜不到 / 开关关 / 今日 3 次用完）"

跟生图工具一样再调一次大语言模型让大语言模型知道工具结果（用 `role: 'tool'` 回传 + `tool_call_id`）。

### 3. 修聊天页挂载时一起听误推提醒（暮色 16:32 反馈图 2）

**根因**：`apps/Chat.tsx:481` 的 `prevTogetherRef = useRef(new Set())` 每次组件挂载都重置成空集合。但 `listeningTogetherWith` 已经有角色 id。第一次跑副作用钩子时空 prev + 有 cur → 误判 `isNewlyAdded = true` → 推"暮色 刚刚邀请你一起听"提醒。

之前靠模块级 `notifiedListenTogether` 兜底，但浏览器刷新后模块级集合也丢了 → 还是会误推。

**修法**：把 `prevTogetherRef` 初始化成当前 `listeningTogetherWith` —— 挂载时 prev == cur，副作用钩子第一次跑不会误判"新加"。无论 `notifiedListenTogether` 状态如何都不会推。

### 4. 改 `buildMusicActionGuide` 提示词

弱化"必须用标记"的强求，加一段说明 play_song 是真正的功能工具，**优先用工具调用**。标记仅作 fallback。

## 动了哪些文件

- `hooks/useChatAI.ts` —— 加 `PLAY_SONG_TOOL` 定义 + 注册到 `toolsList` + 加 `play_song` 工具处理代码块（生图处理后）+ 把 `playSongFromChar` 从 chatParser 调用处提到 useChatAI 顶层（让功能工具代码也能调）+ chatParser 调用处改成引用顶层 const
- `utils/context.ts` —— `buildMusicActionGuide` 加功能工具说明，弱化标记强求
- `apps/Chat.tsx` —— `prevTogetherRef` 初始化改成 `new Set(listeningTogetherWith)`

## 踩坑 / 需要知道的

- **playSongFromChar 提到顶层改了引用**：之前在 chatParser 调用处的对象字面量里，现在提到 useChatAI 顶层作为独立 const。chatParser 调用处从 `playSongFromChar: async (cid, songName) => { ...70 行... }` 改成 `playSongFromChar`（ES6 简写）。业务逻辑 100% 一致，**只是位置变了**。
- **功能工具描述里强调"拿不准就不碰"**：跟生图工具 7-22 那次改的描述一样（默认不调，三种情感场景放行，日常闲聊不碰）。play_song 类似——日常闲聊不碰，对话里聊到歌 / 气氛适合 / 用户提到想听什么时再用。
- **功能工具调用结果回传**：跟生图工具一样用 `role: 'tool'` + `tool_call_id`，让大语言模型下一轮知道工具调用结果（成功 / 失败原因）。**注意**：删了 `followBody.tools` 和 `tool_choice` 避免无限循环（大语言模型下一轮不应该再调 play_song）。
- **play_song_and_join 时序关键**：`playSongAndJoinHandled.add` 早于 `addListeningPartner`（早于 setState 触发 React flush），跟 chatParser 路径 A 一致。
- **prevTogetherRef 初始化改动的影响面**：这个改动让挂载时**永远**不会推"暮色 刚刚邀请你一起听"提醒——只有 listeningTogetherWith **真的新增**了 charId 才会推。比模块级 notifiedListenTogether 更稳（不受浏览器刷新影响）。

## 备注

- **这次没做**：历史音乐卡片自动清空（handoff #3，暮色 16:32 反馈的图 1 两张音乐卡片问题）。可以另起一个 commit 改 chatParser 路径 A，在推新音乐卡片之前删历史。
- **测试建议**：
  1. 重置聊天（清掉之前 LLM"放不了歌"的剧情记忆）
  2. 用户直接说"放首歌" → 大语言模型应该调 play_song 工具 → 推音乐卡片
  3. 切换到 Claude 协议 → 大语言模型只能输出文本标记 → 走 fallback 路径
- **未完成 todo**（累计）：
  - 历史音乐卡片自动清空（handoff #3，聊天流只留最新一张）
  - 跨时区重置次数（handoff #2）
  - 一起听邀请 消息类型 复用扩展测（handoff #4）
  - 记忆宫殿 副 API 换基础地址（建议 Gemini 官方）
  - 记忆宫殿 提取失败界面提示
  - stash 那批改动怎么处理（handoff #6）
