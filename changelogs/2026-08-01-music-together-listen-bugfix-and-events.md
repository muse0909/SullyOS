# 音乐 + 一起听 第 5 轮：mini player 拖动边界 bug + 开一起听主动发请求

**日期**：2026-08-01
**涉及 commit**：（待 commit）
**依赖**：`2026-08-01-music-together-listen-and-bugs.md`

## 改了什么

暮色测完反馈 2 个事：

### Bug 1：mini player 卡死中间位置不能拖动
- **根因**：拖动边界用 `el.parentElement.getBoundingClientRect()` 计算（按下时存的 `ds.parentW/parentH`），但在某些嵌套 absolute 容器里 `parentRect` 可能拿到非 viewport 尺寸（比如 0 或被 transform 偏移过的值），导致 x/y 被 clamp 到无效范围 + dragState 残留
- **修**：把拖动边界用 `window.innerWidth/Height`（viewport 实时尺寸），不再依赖父容器

### Bug 2：开一起听后 char 不会主动提
- **根因**：暮色反馈"开一起听后和江澈聊了两轮，没有提及一起听这个事，他也没提，直到我问他他才看到一起听的提示"——上一轮改的 prompt（A 部分）只是告诉 LLM "你们在一起听，可以自然地聊"，但 LLM 不知道怎么触发自己提
- **修**：在 `apps/Chat.tsx` 加 useEffect 监听 `listeningTogetherWith` 数组变化，对**新增的 charId**（之前不在，现在在）：
  1. 推一条 system 消息到 messages + DB：`[系统: 暮色 刚刚邀请你一起听《XX》— YY...]`
  2. 调 `triggerAI(messages)` 触发 LLM 主动回应（不依赖用户发消息）
  3. LLM 看到 system 通知 + 当前歌曲上下文 → 自然生成一条回应
- **注意**：只对"新开启"触发一次（用 prevTogetherRef 记上一次状态）。关闭、切歌、再次开都会重置触发条件

### 江澈的反馈（截图 3）
- 江澈回复说"play_song_and_join 未注入，当前不可用"——**这是过期的反馈**。我在上一轮 commit `5e49f7f` 已经注入了 play_song_and_join prompt（`utils/context.ts:595`）。江澈应该是测了更早的版本
- 江澈确认了"play_song 已成功注入 prompt，模型能选歌并输出"——play_song 可用
- 暮色下一步：再测一次 play_song_and_join + parser 收到 token 后是否调搜索和播放

### 误判
- 暮色一开始以为我做了 C（"我看到的是不是你已经把C做完了呀"）——其实 C.1（"一起听中"持续显示）**已经存在**，藏在 `MusicUI.tsx:232 TogetherHeader` 组件里，MiniPlayer 内部渲染。暮色看到的"粉红横条 LISTENING TOGETHER"就是这个

## 动了哪些文件

- `components/os/GlobalMiniPlayer.tsx` —— 拖动边界用 window.innerWidth/Height，不用 parent
- `apps/Chat.tsx` —— useEffect 监听 listeningTogetherWith 变化触发 triggerAI

## 踩坑 / 需要知道的

- **误判了"C 已经做了"** —— 暮色看到的"一起听"横条是 `TogetherHeader`（MusicUI.tsx 一直有），不是我做的。**C.1 + C.3 已经存在**，C 只剩 C.2（LLM 主动放歌推 system 消息到 chat 流）
- **triggerAI 签名需要 messages 列表** —— 我第一次写时误传了 `prevTogetherRef`，应该是 `messages` state（用 setMessages 的 updater 形式拿最新值）
- **`el.parentElement` 在嵌套 absolute 容器里不可靠** —— 改用 viewport 坐标更稳

## 待办

- 暮色测 Vercel 预览：mini player 拖动应该正常了
- 暮色测一起听：开 → 江澈 chat 应该有 system 消息 + 江澈主动回应一条
- 暮色再测一次 play_song_and_join + parser（确认上一轮的 token 链路工作）
- C.2（LLM 主动放歌推 system 消息）—— 后续做
