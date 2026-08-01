# 音乐第 7 轮：musicApi import 漏修 + 歌单播放全部 + 播放队列 UI

**日期**：2026-08-01
**涉及 commit**：`634e309`
**依赖**：`2026-08-01-chat-crash-and-miniplayer-short-tap.md`

## 改了什么

### 1. Bug 修：AI 主动放歌时 `musicApi is not defined` ReferenceError
- 暮色 22:07 反馈：江澈尝试主动放歌，控制台报 `ReferenceError: musicApi is not defined`
- 根因：上一轮 commit `ad5d7fe` 加的 playSongFromChar 调 `musicApi.search(...)`，但 useChatAI.ts 顶部 import 漏了 `musicApi`（只 import 了 `useMusic, toHttps`）
- 修：`hooks/useChatAI.ts:14` import 加 `musicApi` —— `import { useMusic, toHttps, musicApi } from '../context/MusicContext';`
- **为什么 build 没报**：TypeScript 报 "Cannot find name 'musicApi'"，但这是 free identifier，TS 在某些配置下不严格检查。runtime 直接抛 ReferenceError
- 教训：destructure 漏字段会 ReferenceError（chat 崩那次），自由 identifier 漏 import 也会 ReferenceError——TS 不严格查

### 2. 歌单 / 榜单详情页加"播放全部"按钮
- `apps/MusicApp.tsx:451-475` discoverDetail header 右侧加按钮
- 点了 `playSong(first, { alsoSetQueue: true, replaceQueue: discoverDetailSongs, startIdx: 0 })` 替换当前队列从头播
- 样式：暮色要求"和主题一样的暗紫色，不另起绿色"——用 `linear-gradient(135deg, ${C.primary}, ${C.accent})` 主题紫调（`#807c9d → #b3a8ce`）
- 按钮：胶囊（`rounded-full`）+ 居中文字 + Play icon + "播放全部"
- 空歌单时按钮变 40% 透明 + disabled

### 3. 播放队列 UI 浮层（暮色 21:36 提的"播放列表功能"）
- `context/MusicContext.tsx:385-415` MusicContext 加 `removeFromQueue` 和 `jumpToQueueIndex` 方法
  - `removeFromQueue(songId)`：删 queue 中指定 id 的歌，自动调整 idx（删的 idx < 当前 idx → idx-1；删当前 idx → 不变指向下一首）
  - `jumpToQueueIndex(targetIdx)`：跳到 queue[targetIdx] 播放
- `context/MusicContext.tsx:283-290` MusicContextType interface 加这两个字段
- `context/MusicContext.tsx:786` value 暴露
- `components/os/GlobalMiniPlayer.tsx` 展开态加"≡ 队列"按钮（List icon，title 显示 `播放队列（N 首）`）
- `components/os/GlobalMiniPlayer.tsx:325-429` 队列浮层（半屏底部弹层）：
  - 暗紫主题（`rgba(20, 24, 35, 0.92)` 背景 + backdrop-blur）
  - 列表显示所有 queue 里的歌（封面 + 歌名 + 艺人）
  - 当前播放的歌用 `♪` 标志 + 高亮（`#b3a8ce` 主题紫）
  - 点歌名 → jumpToQueueIndex + 关闭浮层
  - 每行右边 `×` 删除按钮 → removeFromQueue
  - header 显示总数量，关闭 × 按钮
  - 点遮罩关闭 + 卡片内 stopPropagation

## 踩坑 / 关键认知

### ReferenceError: X is not defined 的两个常见家族
1. **destructure 漏字段**（chat 崩那次的 updateUserProfile）—— TS 不报，runtime 崩
2. **free identifier 漏 import**（这次的 musicApi）—— TS 在某些配置（`noImplicitAny: false` 或 `strict: false`）下也不报

两种都是"TS 编译过 + runtime ReferenceError"。**防御**：
- 加任何新引用前先 `grep -n "import.*X" 文件路径` 看是否已 import
- **build 阶段不可信**——只有 runtime 跑过才知道
- 上线前至少手动跑一下受影响的流程（比如触发一次 LLM 放歌）

### "和主题一样的暗紫色"具体是什么
暮色这次明确"不要绿色要和主题一样的暗紫色"。项目主题色是淡紫调灰 `#807c9d` (primary) + 淡紫 `#b3a8ce` (accent)，不是鲜艳的"紫罗兰/电紫"。我用了 `linear-gradient(135deg, ${C.primary}, ${C.accent})` —— 就是暮色要的"主题紫"。
- 之前 miniPlayerHidden / AI 主动放歌 toggle 也是用这个 gradient，暮色已接受
- 这次播放全部按钮沿用同一色系 → "色调统一"达成

### removeFromQueue 的 idx 调整逻辑
删 queue 中某首时 idx 要跟着调整，否则 current 指向错位：
- 删的 idx < 当前 idx → idx - 1（之前的所有歌删一首后整体前移）
- 删的 idx == 当前 idx（当前播放的歌被删）→ 不动 idx（指向新的下一首，除非是最后一首）
- 删的 idx > 当前 idx → 不动（后面的删不影响当前位置）
- 删除触发 setQueueState 之后 current 重新计算（`queue[idx]`），audio 会因为 current 变化自然停掉

## 备注
- 暮色确认测试通过的内容（这次对话里）：
  - mini player 所有功能：折叠态拖动 / 短按展开 / 展开态拖动 / 展开态点封面进音乐 app / 展开态点空白折叠 / 展开态播放暂停上下首
  - e54fefb 一起听通知 3 bug 修
  - ad5d7fe AI 主动放歌开关 toggle
  - 一起听邀请消息在聊天流只显示一行事实
- 暮色没测过的内容（这次修复后等再测）：
  - AI 主动放歌时聊天流多 system 消息（现在 musicApi 修了，江澈应该能主动放歌了）
  - 每日每 char 3 次上限
  - 歌单播放全部按钮（新加的）
  - 播放队列浮层（新加的）
- AI 主动放歌现在能成功调用 → 暮色 22:07 的 bug 修了之后，江澈应该能主动放歌（之前一直"没成功"是 musicApi 没 import 抛 ReferenceError）
