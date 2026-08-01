# 音乐第 8 轮：播放队列弹窗 bug 修 + 播放页同步 + play_song_and_join 通知去重

**日期**：2026-08-01
**涉及 commit**：`fe1e7d1`
**依赖**：`2026-08-01-music-round6-bugfix-queue-playall.md`

## 改了什么

暮色 22:40 反馈 4 个问题 + 1 个新需求：

### 1. 播放队列弹窗"什么都点不动"+ 不能往上滑
- 根因：半屏底部弹层用 `fixed inset-0 z-[60]` 挂在 GlobalMiniPlayer 组件树内
  - **没用 createPortal**：浮层被 PhoneShell 等父容器的 transform/overflow 影响，
    touchmove 事件没被浮层捕获，冒泡到下层聊天流
  - **z-[60] 不够穿透**：父容器可能有更高 z-index 的层挡了
  - **onTouchMove 没 stopPropagation**：滚动事件穿透到下层
- 修：
  - 抽独立组件 `apps/music/QueuePanel.tsx`
  - `createPortal(jsx, document.body)` 挂到 body
  - `onTouchMove={e => e.stopPropagation()}` 兜底
  - `z-[100]`（跟项目级 Modal 一样高）

### 2. 弹窗样式要跟图2日程弹窗统一（不要黑底）
- 旧：黑底 + backdrop-blur 玻璃质感
- 新：白底 + 紫调文字 + 居中卡片（max-w-sm + rounded-[2.5rem]）+ 紫雾分隔线
  - 跟项目级 `components/os/Modal.tsx` 完全一致
  - 跟图2日程弹窗视觉一致（暮色要的）
  - 紫调色用 `#807c9d` (primary) + `#b3a8ce` (accent) + `#ebe9f5` (soft)
- 当前播放的歌用 `linear-gradient(135deg, #807c9d, #b3a8ce)` 序号徽章（白字）

### 3. 播放页也加播放列表功能
- `apps/MusicApp.tsx` 播放控制按钮下方加"队列 · N 首"按钮
- 弹 `QueuePanel` 浮层（title="当前播放 · 队列" 区分场景）
- GlobalMiniPlayer 和 MusicApp 播放页**共用**同一个 `QueuePanel` 组件

### 4. play_song_and_join 触发时不要 music_invite 重复推消息
- 根因：用户手动开一起听 → Chat.tsx useEffect 推 music_invite system 消息；
  之后 LLM 主动 play_song_and_join → chatParser 推 system "江澈给你放了《xxx》加入了"一起听"" + 调 joinListeningTogether
  → 触发 Chat.tsx useEffect 又推一条 music_invite
  → **两条冗余**提示
- 修：module-level `playSongAndJoinHandled: Set<string>`（在 chatParser.ts 模块级 export）
  - chatParser 路径 A 在 `joinListeningTogether` **之前** add charId 到 Set（关键：早于 setState 触发 React flush）
  - Chat.tsx useEffect isNewlyAdded 分支：先检查 `playSongAndJoinHandled.has(char.id)` → 跳过推 music_invite，但仍 triggerAI（让 LLM 看到状态变化自然回应）
  - 跳过时**清掉** Set（让下次 user 自己开一起听能正常推）
- **时序关键**：add Set 必须在 joinListeningTogether 之前，否则 React flush 时 Set 还没数据，Chat.tsx useEffect 推消息

## 踩坑 / 关键认知

### createPortal 解决嵌套容器问题
- GlobalMiniPlayer 渲染在 PhoneShell 里，PhoneShell 可能用 transform / overflow: hidden
- 这会让 fixed 定位的浮层**定位错乱**（不是 viewport 坐标）+ touch 事件被父容器拦截
- 修法：用 `createPortal(jsx, document.body)` 挂到 body 顶层
- **判断标准**：任何 fixed 弹窗在 mobile 端"位置不对/点不动" → 加 createPortal

### module-level state 在 SPA 单用户场景下 OK
- `playSongAndJoinHandled: Set<string>` 是 module-level（不是 Context / Redux）
- SullyOS 是 SPA 单用户，module-level state 跨组件共享足够
- **好处**：不依赖 React Context 传递 + 跨组件树共享（Chat.tsx 和 chatParser.ts 都能用）
- **风险**：SSR / 多用户场景不能用；SullyOS 不存在这两个问题

### 时序：add 到 Set 必须在 setState 之前
- React 18 的 setState 是**异步 flush**的（在同步代码块结束时统一 flush）
- 流程：
  1. `playSongAndJoinHandled.add(charId)`  // 同步立即执行
  2. `musicHooks.joinListeningTogether(charId)`  // 调 setListeningTogetherWith，setState 排队但**不立即** flush
  3. (同步代码块结束，React flush setState)
  4. Chat.tsx useEffect 跑（看到 Set 有 charId → 跳过推消息）
- 如果顺序反了（先 joinListeningTogether 再 add Set）：
  1. joinListeningTogether 排队 setState
  2. add Set 立即执行
  3. (flush) useEffect 跑——**这时** Set 已有 charId → 跳过推消息
- **但**实际 React 18 batching 可能让 useEffect 跑得**更早**（在微任务结束前），add Set 还没执行
- 所以**最稳**是 add Set 在 joinListeningTogether 之前

## 备注
- 暮色 22:40 提的"播放列表功能"完整链路：
  1. GlobalMiniPlayer 展开态右上"≡ 队列"按钮 → 弹 QueuePanel
  2. MusicApp 播放页控制按钮下方"队列 · N 首"按钮 → 弹 QueuePanel（title 不同）
- QueuePanel 用了 `useMusic()` 全局共享 MusicContext — 任何组件都能用
- 暮色之前提的"现在做了但是我没有测试的"：
  - 一起听开启后 LLM 真的主动回应（e54fefb）— 通过
  - 一起听邀请消息只显示一行事实（ad5d7fe）— 通过
  - C.2 AI 主动放歌时聊天流多 system 消息（ad5d7fe）— 江澈成功放过歌了
  - AI 主动放歌开关 toggle（ad5d7fe）— 通过
  - 每日每 char 3 次上限（ad5d7fe）— 没测试（没成功放过）
  - 歌单播放全部按钮（634e309）— 通过
  - 播放队列浮层（634e309）— 这次修了（暮色 22:40 反馈）
- 暮色 22:40 截图显示 play_song_and_join 成功放歌（音乐 api 修好后），
  但同时出现两条 system 提示（"暮色 邀请一起听" + "江澈给你放了..."）—— 这次修去重
