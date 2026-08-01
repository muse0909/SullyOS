# 聊天页炸修复 + mini player 折叠态短按展开（撤回上次误读）

**日期**：2026-08-01
**涉及 commit**：`45aa745`

## 改了什么

### 1. 聊天页 ReferenceError: updateUserProfile is not defined
- `apps/Chat.tsx:54` useOS() 解构**漏了** `updateUserProfile` 字段，但 line 462 引用了
- 上次 commit `ad5d7fe` 加的"AI 主动放歌 toggle + 每日每 char 计数"在 useChatAI 里调 `updateUserProfile`，但 Chat.tsx 顶层 useOS() 没解构这个字段
- 修：line 54 useOS() 解构加 `updateUserProfile`（加在 `userProfile` 后面）

### 2. 折叠态 mini player 短按 = 展开（撤回上次误读）
- 暮色 21:36 反馈：上次"点封面进音乐 app"是误读
- 暮色原话：**"我要的是点一下小圆形迷你播放器后展开完整控制条，点一下完整控制条中的封面进入音乐app"**
- 修：
  - `components/os/GlobalMiniPlayer.tsx:99-101` endDrag 折叠态：moved=false 时 `setExpanded(true)` 展开（替换 `openApp(AppID.Music)`）
  - `components/os/GlobalMiniPlayer.tsx:262-277` 展开态封面：img 包成 button，`onClick={openApp(AppID.Music)}` + `onPointerDown stopPropagation`（不让 drag 吞掉）
  - 删除折叠态长按逻辑（之前 hash 跳转不稳，暮色也不需要）
  - 删 longPressTimer ref

## 踩坑 / 关键认知

### 上次误读"长按跳音乐 app 不行"
暮色 21:18 说"长按跳音乐 app 不行，改成点箭头指向的头像这进入音乐app播放页"——我误读成"短按封面 = 进音乐 app"，加的 short-tap 走 `openApp`，长按走 `setExpanded(true)` 展开。

暮色 21:36 明确纠正：**他要的链路是 短按小球 → 展开 → 点完整控制条里的封面 → 进音乐 app**。是**两步**而不是一步。

教训：
- "改成 X" 不代表"用 X 替换 Y 的同一行为"——可能是"插入到不同 step"
- 涉及 multi-step UX 流程时，先确认"step 1/2/3 各是什么"再动手
- 上次改了没测（暮色没回测）就直接交付了——这是个流程问题，**改 multi-step 交互前应该先把流程画出来给暮色确认**

### 漏解构导致 ReferenceError 的 3 道防线
1. **TypeScript 应该报** —— 但 `useOS()` 返回 `OSContextType`，里面有 `updateUserProfile`，**类型上是有的**。Chat.tsx 漏解构是**运行时**问题（变量 undefined → ReferenceError）。
2. **ESLint react-hooks/exhaustive-deps** 应该报 —— 但只对 useEffect/useCallback/useMemo 的 deps 检查，**对 destructure 漏写不检查**。
3. **runtime ReferenceError 兜底** —— 用 `if (typeof updateUserProfile === 'function')` 守卫，但 line 3846 我加的 if 守卫**也没用**，因为 `updateUserProfile` 标识符根本不存在（不是 `undefined`），访问就抛 ReferenceError。

教训：destructure 漏写一个字段**会**抛 ReferenceError（不是 undefined 值），跟普通 let 变量未声明一样。**TS 不会报，runtime 直接崩**。下次加新字段时一定要在 destructure 里加。

### `target.closest('button')` 检查在折叠态的正确形态
折叠态 onPointerDown 绑在外层 div（不是 button）时，target 可能是 div 或 div 内 button 子树。但**当前实现是折叠态 onPointerDown 绑在 button 上**（button 整个区域），所以 closest('button') 永远命中 button 自己 → 永远 early return。

这次保留**折叠态 onPointerDown 绑在 button 上**（因为整个折叠态就是 button 没别的），展开态绑在 div 上（div 内有 button 子树，closest('button') 检查有意义）。

## 备注
- 暮色 21:36 还提了两个"先不动"的问题：
  1. 播放器能不能增加播放列表功能
  2. 歌榜和快速发现歌单里能不能增加播放全部按钮
- 这两个明确是**提问不改动**（暮色原话），等暮色确认需求后再做
- 之前 commit `ad5d7fe` 加的 "AI 主动放歌 toggle + 每日 3 次计数" 这次连带修了 —— toggle UI 在 MusicApp.tsx 已经能调 updateUserProfile（MusicApp 早就解构了），现在 chat 页的 triggerAI 也能正常持久化计数
