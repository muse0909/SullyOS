# 一起听 / mini player 3 个 bug 修

**日期**：2026-08-01
**涉及 commit**：`e54fefb`

## 改了什么

### 1. 折叠态 mini player 卡死中间不能拖 / 点不开
- `components/os/GlobalMiniPlayer.tsx:72-118` 改 `onPointerDown`
- 根因：onPointerDown 绑在折叠态的 `<button>` 上，`target.closest('button')` 永远命中 button 自己 → 永远 early return → dragState 永远不初始化 → 短按展开、拖动、长按全失效
- 修：折叠态（`!expanded`）下整个 button 就是要拖动/点击的目标，无嵌套 button，跳过 closest 检查；展开态保留原行为（button 走 onClick 不被 dragState 吞）

### 2. 非 together 状态下 prompt 漏了 `play_song_and_join`
- `utils/context.ts:608-610` 补 `play_song_and_join|歌名` 说明
- 根因：江澈在聊天上下文（非一起听状态）下看不到 play_song_and_join 指令说明，所以他说"做不到主动选歌并加入一起听"
- 一起听状态（`isListeningTogether=true`）的 prompt 之前已经包含，新加的只是普通状态下的版本

### 3. 一起听开启后 LLM 不主动回应
- `types.ts:1749` 加 `music_invite` 到 MessageType 联合类型
- `hooks/useChatAI.ts:1000-1014` 识别 `music_invite` → 用 `[一起听邀请]` 前缀（跟 `couple_space_event` 同等对待）
- `apps/Chat.tsx` 改 useEffect：
  - 改 type 从 `'text'` → `'music_invite'`
  - 改 content 不带 `[系统: ...]` 前缀（让 useChatAI 加 `[一起听邀请]`）
  - 加 module-level `notifiedListenTogether` Set，避免 Chat mount 时 prev=空 Set 误判为"新开启" → 重复推
  - 加 `isTyping` 检查：LLM 正在打字时跳过 triggerAI（避免冲突），但消息进流后 LLM 下次会看到
  - 检测"被移除"时清掉 notifiedSet，下次再开能重新触发

## 踩坑 / 关键认知

### LLM 看到 `[系统状态] xxx` 会主动忽略（暮色 7-31 偏好）
按 user memory 2026-07-31 规则：
- ✅ AI 主动引用：用户行为触发的（情侣空间事件、一起听邀请）
- ❌ AI 不要主动引用：技术状态（连接中断、call 摘要）

之前一起听邀请的 system msg 用的 `type='text'`，被 useChatAI 归到 `[系统状态]`，**LLM 看到这种前缀会主动忽略**（不是"不要做动作"，是"不要在回复里体现"）。所以江澈 2 轮都不提一起听 —— 不是没看到 system msg，是看到了 + 看到了"系统状态"前缀 + 选择不引用。

修法是新增 `music_invite` 类型，跟 couple_space_event 走同一条"用户行为触发"分支。

### useEffect deps 里的 component-scoped ref 不能跨 mount
- Chat 组件 unmount → 再 mount（用户从音乐 App 切回 Chat）→ useRef 重置成空 Set
- 原 useEffect 拿"空 prev" vs "包含 charId 的 cur" → 误判"新开启" → 重复推 system 消息 + 触发 triggerAI
- 修：module-level Set（`notifiedListenTogether`），跨 mount 持久
- 切歌/暂停/错误/移除时 MusicContext 会清空 listeningTogetherWith；这里跟着清 notifiedSet，下次再开同一首能重新触发

### target.closest('button') 在 button 自己的 onPointerDown 里永远 early return
- 折叠态 onPointerDown 绑在 `<button>` 上 → target 是 button 或 button 内 img/div
- `target.closest('button')` 永远命中 button 自己（不是"嵌套 button"概念）
- 这种"防止 button 被 drag 吞"的检查**只在 onPointerDown 绑在外层 div、div 收 pointer 事件时才有意义**
- 绑在 button 上时**永远不工作**（这是我上轮 0977a97 没发现的）
- 修：onPointerDown 内按 expanded 分流，折叠态跳过检查、展开态保留

## 备注
- 之前我看到 TogetherHeader 渲染"LISTEN TOGETHER 暮色·江澈♪" 浮窗就以为 C 完事了（"已经做了"），但 C.2（LLM 主动放歌推 system 消息）其实没做。这个 commit 把 listen-together 通知的 type 分类做对了，但 C.2 的"AI 主动放歌时给用户推一条 system 消息"还没做（play_song_and_join 是 token，触发时只走 music_card 路径，没额外 system 通知）。下次再做。
- isListeningTogether 状态下的 prompt 行为没改（之前已经够明确，让 LLM "自然地回应"）。这次主要是"系统状态"前缀导致 LLM 主动忽略，不是 prompt 本身问题。
- 暮色 8-1 提的"AI 主动放歌的每日每 char 次数上限 + user setting 开关"还是没做，等他下次提。
