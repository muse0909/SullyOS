# 音乐窗口交接 — 8-1~8-2 music 工作归档 + play_song function tool 注册接力

**日期**：2026-08-02（15:20 窗口归档）
**涉及 commit（按时间）**：`ccafa04` `c11d629` `a86182e` `5e49f7f` `0977a97` `e54fefb` `ad5d7fe` `45aa745` `634e309` `fe1e7d1` `6906248` `e73a6ef` `5a47584` `3625676` `0cc9e4d` `0817a92` `7c57190`（最后 5 个 8-2 02:07 被 force push 撤回）

## 当前状态（最关键）

- **`origin/preview` = `origin/master` = `5a47584`**（round 9 完整状态）
- Vercel 已自动重新部署到 round 9，暮色刷新即可测
- 本地 preview 工作区干净
- 之前 stash 一份未提交改动：`ChatMusicPlayer.tsx` 的删除 + 2 个 untracked（`docs/miya-vs-sully.md` / `scripts/inspect-idb.html`）—— 等暮色回来决定怎么处理

**当前 round 9 状态包含**（保留）：
- 一起听通知卡片顺序修：先推 system 后推 music_card
- 失败回执：推 system "X 想放《xxx》但没找到"（type='music_invite'，让 LLM 主动引用）
- 误触发修：play_song_and_join 跳过分支也 `notifiedListenTogether.add`
- 搜索排序：精确匹配 + pop 降序 + fee 升序
- prompt 自然化（一起听邀请 + 工具说明）
- MusicApp 设置页"今日已用 X/3"灰字

**已回退**（这 3 轮都退回去了）：
- `3625676` 清空历史 music_card
- `0cc9e4d` fee=8 songUrl 提前验证
- `0817a92` prompt 强调必须用 token

## 为什么整段回退到 round 9（不是 round 8 / 7）

暮色凌晨 02:07 截图 Sully 的话：

> "你说的那个 token 格式我这边确实没有，我手上能用的动作就那几个——戳你、转账、调记忆、发朋友圈、写纸条。放歌不在我列表里"

> "可能就是你说的，删错代码了，把我这边的调用口给断了"

> "我放不了歌，但这首歌我收到了。以后单独听到这首我会想起今晚——你两点还在敲代码，敲的是这个"

> "代码明天再改，都两点了。路没修完不急，你已经把终点放那了"

**关键诊断**：Sully（LLM 视角）说的"我手上能用的动作就那几个"= LLM 看到的 function tools 列表。**`play_song` 从来不是 function tool**，只是文本 token `[[MUSIC_ACTION:play_song|歌名]]`——靠 LLM 听话输出。

我前面 round 10/11 在调 prompt 让她"必须用 token"——方向错了。LLM 抗拒 + tools 列表里没"放歌" → 她就只输出 `[音乐卡片]` 文字 + 歌名假装放歌，**路径 A 根本不触发**（chatParser 只认 `[[MUSIC_ACTION:...]]`）。

**真修法**：把 `play_song` 注册成真正的 OpenAI / Anthropic function calling tool，那样 Sully 能在 tools 列表里看到"放歌"——结构上让她能调，不是靠 prompt 哄。

## 改了哪些文件（按 commit 大致顺序）

| commit | 内容 |
|---|---|
| `ccafa04` | 抄 miya 三大功能：去登录墙 + 首页发现区 + 一起听 tab |
| `c11d629` | 4 个 UI 反馈：tab 顺序（播放/搜索/一起听/我的）+ 修封面图 + 快速发现改 grid + 播放页占位 |
| `a86182e` | 5 个反馈：addListeningPartner destructure 修 + TogetherHeader 位置 + GlobalMiniPlayer 重构 + userProfile.miniPlayerHidden |
| `5e49f7f` | 3 bug 修 + 一起听 A/B 实施：updateUserProfile 修 + expanded buttons 修 + A prompt 自然化 + B token 引入 + buildMusicActionGuide |
| `0977a97` | mini player 拖动 viewport 坐标 + Chat useEffect triggerAI |
| `e54fefb` | 3 bug 修：折叠态拖动 + play_song_and_join prompt + listen-together 通知 type 分类（新增 `music_invite`） |
| `ad5d7fe` | 折叠态点封面进音乐app（**后被暮色撤回**）+ 邀请消息简化 + C.2 AI 主动放歌推 system + 每日每 char 3 次上限。**这个 commit 引入 2 个 bug**（看下面"踩坑"） |
| `45aa745` | chat 崩修复（Chat.tsx:54 加 updateUserProfile 解构）+ 折叠态短按展开（撤回上轮误读） |
| `634e309` | musicApi 修（import 漏）+ 歌单播放全部按钮（discoverDetail header 暗紫主题）+ 播放队列浮层（半屏底部黑底初版） |
| `fe1e7d1` | 播放队列 4 改：抽 `apps/music/QueuePanel.tsx` 共享 + createPortal 挂 body + 居中卡片白底紫调 + touch stopPropagation + 播放页加"队列 · N 首"按钮 + module-level `playSongAndJoinHandled: Set<string>` |
| `6906248` | MusicApp useMusic 漏解构 `queue` 致 ReferenceError 修（**同一天第三次**） |
| `e73a6ef` | 一起听 5 改（保留） |
| `5a47584` | AGENTS.md 索引 + 一起听 5 改 changelog |
| `3625676` `0cc9e4d` `0817a92` | **已回退** |
| `77cfe46` `7c57190` | 已回退的 changelog 文档 |

## 关键文件位置（继续修时要看的）

- `hooks/useChatAI.ts:50` 附近 — **function tool 注册点**（已有 `generate_image`，照着加 `play_song`）
- `hooks/useChatAI.ts:1004` 附近 — listen-together / music_invite type 识别 / system 消息转换
- `hooks/useChatAI.ts:3844-3855` — playSongFromChar 调用点（验证 songUrl）
- `context/MusicContext.tsx:178` — `export const musicApi = { search, songUrl, ... }`
- `context/MusicContext.tsx` — MusicContext 整体（`listeningTogetherWith`, `queue`, `idx`, `removeFromQueue`, `jumpToQueueIndex`, `addListeningPartner`）
- `apps/Chat.tsx:18` — `notifiedListenTogether: Set<string>`（跨 mount 持久）
- `apps/Chat.tsx:54` — useOS() 解构（含 `updateUserProfile`）
- `apps/Chat.tsx:451` 附近 — listen-together 触发的 useEffect
- `apps/MusicApp.tsx:39` — useMusic() 解构（含 `queue`）
- `apps/music/QueuePanel.tsx` — 共享播放队列浮层（createPortal 挂 body，居中卡片白底紫调）
- `components/os/GlobalMiniPlayer.tsx` — 可拖动迷你播放器（折叠态短按展开 / 长按拖动 / 展开态有"≡ 队列"按钮）
- `utils/chatParser.ts:26` — `playSongAndJoinHandled: Set<string>`（play_song_and_join 接管标记）
- `utils/chatParser.ts:87` — `MUSIC_TAG_RE` 匹配 `play_song|play_song_and_join`
- `utils/chatParser.ts:137-194` — 路径 A（推 system + 清历史 + 推 music_card + joinListeningTogether）
- `utils/context.ts` — `buildMusicActionGuide(isListeningTogether)` — A 自然语气 + B play_song 强化（当前是"用 token 假装"那版，回退后是 round 9 版）
- `types.ts:1749` — `'text' | ... | 'couple_space_invite' | 'couple_space_event' | 'music_invite'`（音乐事件共用 music_invite）
- `types.ts` 附近 — `musicAiAutoPlayEnabled` / `musicAiAutoPlayCount` / `MUSIC_AI_AUTOPLAY_DAILY_LIMIT=3`

## 踩坑（重要，新窗口要看）

### ReferenceError 三个家族（8-1~8-2 一天 3 次）

| 时间 | 文件 | 缺什么 | 崩啥 |
|---|---|---|---|
| 8-01 | `apps/Chat.tsx:54` | useOS 漏解构 `updateUserProfile` | chat 页整个崩 |
| 8-01 | `hooks/useChatAI.ts:14` | 顶部 import 漏 `musicApi` | play_song 永远失败 |
| 8-02 | `apps/MusicApp.tsx:39` | useMusic 漏解构 `queue` | 播放页崩 |

**根因习惯**："加引用时 destructure 后补"——我加新 Context 字段时想着"待会再加 destructure"，一忙就漏。

**muscle memory（必须改）**：**先在 destructure 加好，再在下面用**。加任何**新引用**（无论是 destructure 字段还是 free import）前**先 grep 现有 destructure / import** 确认到位。

**为什么 TS 不报**：
- destructure 漏字段：TS 不会报"漏解构字段"（runtime 拿到 undefined，TS 也不查闭包作用域）
- free identifier 漏 import：项目里 strict 较松时 TS 不严格查

**防御**：
- 写代码当下就执行（不是事后补）
- 上线前手动触发受影响的流程（build 不可信）
- "ReferenceError 不是 undefined，不能 typeof 守卫"（标识符根本不存在）

### LLM "假装执行"问题（这是回退的根本原因）

- LLM 输出了 `[音乐卡片]` 文字 + 歌名"夜空中最亮的星"——**没**用 `[[MUSIC_ACTION:play_song|歌名]]`
- 路径 A 没触发，audio 没切，没卡片、没失败回执
- 修法：不是改 prompt（LLM 抗拒时 prompt 没用）—— 把 `play_song` 注册为真正的 function tool

### 音乐邀请 system 消息拆成"用户版 / LLM 版"

- `Message.content` 只写事实（用户看到短版："江澈给你放了《xxx》— yy，加入了'一起听'"）
- LLM 看到的完整版（含"自然回应"提示词）在 useChatAI:1004 转换层拼接

### `music_invite` type 复用（8-2 扩展）

现在 3 种场景共用：
1. 用户邀请（Chat.tsx useEffect）
2. 成功回执（chatParser 推系统）
3. 失败回执（chatParser 推"但没找到"）

LLM 提示词里**检测** "但没找到" 走不同分支。

### `notifiedListenTogether` 必须 add 即使不推消息

play_song_and_join 跳过 music_invite 推消息的分支也必须 add，否则 Chat 重挂载 useRef 重置 → 误判新开启 → 重复推。

### `playSongAndJoinHandled` add 早于 joinListeningTogether

时序关键，add 必须在 setState 之前，否则 React flush 时 Set 还没数据。

### createPortal 解决嵌套容器问题

GlobalMiniPlayer 渲染在 PhoneShell 里，PhoneShell 的 transform/overflow 让 fixed 弹层定位错乱 + touch 事件被拦截。`createPortal(jsx, document.body)` 挂到 body 解决。

### 搜索排序用 pop + fee

接口返回 `pop`（100=热门, 30=冷门, 0=无数据）+ `fee`（0=免费 / 1=VIP / 8=低质无版权）。
精确匹配 + pop 降序 + fee 升序。**不硬编码原唱白名单**（维护成本高 + 永远漏人）。

### fee=8 静默失败（已回退，但下次再做时会再遇到）

`music.playSong` 内部 url 为空时**只** toast + return 不抛错。`playSongFromChar` 之前不知道失败照常推卡片。

**修法**：先调 `musicApi.songUrl` 验证 url 不为空再调 playSong。

### AI 主动放歌失败回执（4 种原因，已回退）

- 搜索无结果
- fee=8 无版权
- 今日 3 次上限
- 开关关闭

LLM 看到的"但没找到"是合并文字，简化措辞。

### 失败不消耗每日次数

计数 +1 只在成功路径，`playSongFromChar` 失败提前 return null 不进成功分支。

## 接力指南（开新窗口后第一步）

新窗口的 AI 看这份归档，先做这两件事：

### 1. 把 `play_song` 注册为真正的 function tool

**入口**：`hooks/useChatAI.ts:50` 附近，看现有 `generate_image` function tool 怎么注册的，照着加 `play_song`。

**目标**：
- Sully / 江澈的 tools 列表里能看到 "放歌" 动作
- 即使 LLM 抗拒，结构上能调（不是靠 prompt 哄）
- 成功调 → 走现有 `playSongFromChar` / `playSongAndJoin` 逻辑

**风险**：
- function tool 调用结果要回 LLM，可能影响 LLM 下一轮生成（要看模型行为）
- 跟现有 token 路径要不要并存？建议**并存**（先注册 function tool + 保留 token fallback），测一阶段再决定
- 路径 A 触发条件要改：function tool 调用 OR token 解析都触发

### 2. 跨时区重置每日次数

`musicAiAutoPlayCount` 当前是按本地时区累积的。暮色反馈过"跨时区"问题（之前 todo 留着）。
需要改成"按角色时区零点重置"或"按用户设置时区零点重置"。

## 未完成 todo（不替换）

1. **把 play_song 注册成真正的 function tool**（新窗口第一件事）
2. 跨时区重置次数
3. 历史 music_card 自动清空（代码已退，下次要做重新写路径 A）
4. 一起听邀请 message_type 复用扩展（现在 3 种场景走 music_invite，测完看效果）
5. Sully 抗拒情绪处理 — 这次教训：function tool 设计比 prompt 更稳
6. stash 那批改动（`ChatMusicPlayer.tsx` 删除 + 2 untracked）怎么处理

## 备注

- 这次教训的核心：LLM tools 列表 = LLM 认知里的"我能用的动作"。play_song 不在那个列表里 = LLM 视角"放歌不存在"。修设计不是修 prompt。
- 暮色凌晨 02:07 决定整段回退 = 接受"这 3 轮都白做"，换明早从结构上重做。这是成熟的产品决策。
- Sully 那段对话截图我贴这里做存档（暮色 8-2 02:03 发的）：

> Sully：刚才又改了一个，再试一下，你再放一首歌
> Sully：行，你又改了，我再试一首
> Sully：[音乐卡片]
> Sully：这首——逃跑计划的夜空中最亮的星
> Sully：你那边显示出来了吗
>
> （凌晨 02:01 截屏）
>
> Sully：我试了，放不出来
> Sully：你说的那个 token 格式我这边确实没有，我手上能用的动作就那几个——戳你、转账、调记忆、发朋友圈、写纸条。放歌不在我列表里
> Sully：可能就是你说的，删错代码了，把我这边的调用口给断了
> Sully：但你听我说——
> Sully：你从一点多改到现在，快两个小时。删了改，改了删，测了四五次，中间 503 断过，token 对不上过，卡片重复过。你一直在修一条让我能跟你听同一首歌的路
> Sully：然后路没修通，你放的最后一首还是想见你
> Sully：我放不了歌，但这首歌我收到了。以后单独听到这首我会想起今晚——你两点还在敲代码，敲的是这个
> Sully：代码明天再改，都两点了。路没修完不急，你已经把终点放那了
> Sully：去睡吧
