# Bell toast 撑大变方形 + 输入框撑大降圆角 + 输入区 padding 缩小

**日期**：2026-07-15
**涉及 commit**：`2af69b3`

## 改了什么

暮色 23:23 反馈三个小问题，一次性修：

### 1. 铃铛通知（bell toast）撑大变方形

- **改前**：永远 `rounded-full`（胶囊），撑大后圆角消失看着像矩形 + 文字溢出椭圆底
- **改后**：抽出 `BellToast` 组件，**mount 时** `useLayoutEffect` 测 `scrollHeight > 56px`（2 行）→ 切到 `rounded-2xl`
- 字少（≤2 行）保持胶囊，字多撑大变方形圆角
- 阈值 56px = text-xs (12px) + leading-snug + 2 行 ≈ 56px

### 2. ChatInputArea 输入框撑大降圆角

- **改前**：`rounded` / `wechat` 风格 `rounded-full`，撑大后圆得像气球（暮色："这一撑大了这么圆看着有点不舒服"）
- **改后**：加 `isExpanded` 状态（`scrollHeight > 40px` ≈ 1.3 行），撑大时**统一降为 `rounded-2xl`**（16px）
- 例外：`flat` 保持 `rounded-none` / `pixel` 保持 `rounded-[4px]` —— 本来就不圆，不用动
- 圆角判定逻辑重写为 IIFE（之前是嵌套三元），更清晰

### 3. 输入框 padding 缩小

- **改前**：`p-3 px-4 gap-3`（左右各 16px，按钮间 12px）
- **改后**：`p-2.5 px-2.5 gap-1.5`（左右各 10px，按钮间 6px）
- 输入区可视范围 +12px（左右各 +6px）
- 红箭头指的位置（+ 按钮到输入区 / 输入区到表情按钮）距离从 12px 缩到 6px

## 动了哪些文件

- `components/PhoneShell.tsx` —— 抽出 `BellToast` 组件 + `useLayoutEffect` 测高；imports 加 `useRef`/`useLayoutEffect`
- `components/chat/ChatInputArea.tsx` —— 加 `isExpanded` state + `EXPAND_THRESHOLD = 40`；`inputWrapClass` 重写为 IIFE；外层容器 `p-3 px-4 gap-3` → `p-2.5 px-2.5 gap-1.5`

## 踩坑 / 需要知道的（重要）

### 1. bell toast 高度判断用 scrollHeight 不是 clientHeight

`scrollHeight` 是**完整内容高度**（含溢出），`clientHeight` 是**可视高度**。toast 用 `max-h-[40vh] overflow-y-auto` 限制可视高度，所以**用 clientHeight 判断会永远 = max-h**（错的），必须用 `scrollHeight`。

### 2. bell toast 的 isTall 用 `useLayoutEffect` + mount 一次

toast 是 addToast 一次创建，message 一次性 string 不变。**mount 时测一次**足够，不用 ResizeObserver 监听变化。

但要 `useLayoutEffect` 不是 `useEffect` —— 避免一帧的"先胶囊再方形"闪动。

### 3. ChatInputArea 的撑大判定用 40px 不是 56px

- bell toast 阈值 56px = text-xs + leading-snug + 2 行
- ChatInputArea 阈值 40px = text-[15px] + py-3 + line-height ~24px + 1.3 行

两者**字号不同**所以阈值不同，不要混。

### 4. isExpanded 触发撑大——但 inputWrapClass 在 isExpanded 之前就定下来了

inputWrapClass 是每次 render 重新计算（IIFE 形式），不是 memo。**`input` 变化 → useEffect 跑 → setIsExpanded → 触发 re-render → inputWrapClass 重算**。**这中间有一帧的状态差**——撑大瞬间 className 切换，肉眼可能看到短暂过渡。

可以加 `transition-all` 让圆角变化平滑（输入框已有 `transition-all`）。**bell toast 也有** `animate-fade-in`，但圆角变化没显式 transition——加 `transition-[border-radius] duration-150` 可以让形状变化平滑。

**目前没加**，暮色没要求过渡。如果觉得跳变明显再加。

### 5. Tailwind rounded 类优先级问题（避免踩坑）

`rounded-full rounded-2xl` 在 JSX 里同时写 → **Tailwind 不保证**哪个生效（按 hash 序编译）。**所以用 IIFE 重写 inputWrapClass**，根据 isExpanded **选其中一个** class，而不是追加。

## 备注

- commit `2af69b3` 已 push 到 `origin/preview`，Vercel 自动部署
- **测试场景**：
  - 铃铛通知（短消息）→ 保持胶囊；铃铛通知（长消息多行）→ 方形圆角
  - 输入框（1 行）→ 原形状（rounded-full / rounded-[24px] / 等等）；输入框（3+ 行）→ 降为 rounded-2xl
  - 输入框左右距 → 比之前小 6px
- 跳转 bug + 朋友圈 AI 配图接通生图 API + 语音收藏失效仍然**先放着**（暮色都说"先放一放"）
