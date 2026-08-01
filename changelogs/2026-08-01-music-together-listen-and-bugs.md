# 音乐 + 一起听 第 4 轮：3 bug 修 + 一起听 A/B 实施

**日期**：2026-08-01
**涉及 commit**：（待 commit）
**依赖**：`2026-08-01-music-and-mini-player-round3.md`

## 改了什么

暮色测完反馈 3 个 bug + 要做 A+B：

### Bug 1：设置页"隐藏迷你播放器"开关点了报错 `r is not a function`
- **根因**：我从 `useOS()` 解构了 `setUserProfile` —— 但 OSContext 暴露的是 `updateUserProfile`，`setUserProfile` 是 React useState 的 setter（在 Provider 内部）。`useOS()` 没有 `setUserProfile` 字段，所以拿到 `undefined` —— `undefined({...})` 报错。
- **修**：把 `setUserProfile` 改成 `updateUserProfile`（MusicApp.tsx + GlobalMiniPlayer.tsx 两处）。

### Bug 2：迷你播放器展开后所有按钮失效
- **根因**：展开态的 `onPointerDown` 绑在整个外层 div 上 → 按钮 onPointerDown 冒泡触发 → dragState 被设置 → 按钮 onClick stopPropagation 已经晚了 → 用户松手触发外层 div 的 onPointerUp `endDrag` → `ds.moved=false` 触发 `window.location.hash = '#music'` 跳走，**按钮 onClick 触发播放逻辑 + endDrag 跳走 = 用户感觉"按了没反应"**。
- **修**：
  1. `onPointerDown` 加 `if (target.closest('button')) return;` —— 按钮区域不初始化 dragState
  2. endDrag 展开态不再跳音乐 app，改成"折叠回小球"（用户点空白处 = 折叠，符合直觉）

### A：一起听 prompt 改造
- 旧版本（`isListeningTogether=true` 时）："你此刻已经在和对方一起听这首，不用再'加入'" —— 措辞很"任务化"，LLM 不知道该怎么自然地聊
- **新版本**：按暮色要求——
  - 去掉"我也在听这首"那种强制提法（已经一起听了不需要 char 再 join）
  - 改成"听到这个歌有什么感触，没有可以不提，没有那么多强制性。自然的提及"
  - 加一句"不要把'我们在听同一首歌'当成每轮必说的回礼"

### B：LLM 主动给用户放歌 + 播放
- 新增 2 个 `[[MUSIC_ACTION:]]` token：
  - `[[MUSIC_ACTION:play_song|歌名]]` — LLM 主动搜歌 + 播放
  - `[[MUSIC_ACTION:play_song_and_join|歌名]]` — 搜歌 + 播放 + 把 char 加进"一起听"名单
- 实现：
  - `utils/chatParser.ts` 加 2 个 token 解析（独立分支，不依赖 user 当前在听的歌）
  - `hooks/useChatAI.ts` 加 `playSongFromChar` hook（搜歌 → 切队列 → 播放）
  - `utils/context.ts` 在 `buildMusicActionGuide` 加新工具说明（**慎用**的语气）
- **没做的限制**（先不写）：
  - 每日每 char 次数上限（怕 LLM spam）
  - 用户设置里的"AI 主动放歌"开关
  - play_song_and_join 后用户没反馈（比如直接关掉播放器）怎么办
  - 这三个都等基本功能可用后再补

## 动了哪些文件

- `apps/MusicApp.tsx` —— setUserProfile → updateUserProfile
- `components/os/GlobalMiniPlayer.tsx` —— setUserProfile → updateUserProfile + onPointerDown 排除 button + endDrag 改折叠
- `utils/context.ts` —— buildMusicActionGuide isListeningTogether=true 改自然语气 + 加 play_song 工具说明
- `utils/chatParser.ts` —— 加 2 个 token regex + 独立分支 + MusicActionHooks.playSongFromChar
- `hooks/useChatAI.ts` —— import toHttps + playSongFromChar hook 实现

## 踩坑 / 需要知道的

- **`setUserProfile` vs `updateUserProfile`** —— SullyOS 混用了 React useState setter（私有）和 Context 方法（公开），名字相似容易踩。**记住：从 `useOS()` 拿的是 `updateUserProfile`，不是 `setUserProfile`**
- **展开态按钮失效的"stopPropagation 没用"是经典坑** —— stopPropagation 阻止冒泡，但 React 事件链是 onPointerDown → onPointerUp → onClick，**onPointerDown 已经触发过了**，stopPropagation 阻止不了过去
- **play_song 提前 return 的隐患** —— 第一次写我加了 `return content.replace(...)`，会**跳过**后续的 ADD_EVENT / SCHEDULE / RECALL 处理。修成不 return，让流程继续

## 用户/项目知识

- **miya / 330 / sullyOS** 是暮色**自己仓库里的另外独立项目**——存到 user memory，下次提及时知道是啥
  - miya = `miya-rho.vercel.app` 另一个 AI 角色产品
  - 330 = `muse-330-ui` 另一个 AI 角色产品
  - sullyOS = `SullyOS-master`（当前项目）

## 待办

- 暮色测 Vercel 预览的 bug 1+2 修复
- 暮色测一起听：跟 江澈 一起听，看江澈 chat 里会不会自然提感触
- 暮色测 LLM 主动放歌：跟 江澈 说"想听 XX"或聊到 XX 歌，看 LLM 会不会 `[[MUSIC_ACTION:play_song|XX]]`
- 限制和开关（每日次数 + 用户开关）—— 后续做
