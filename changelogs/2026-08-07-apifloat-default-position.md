# API 浮窗默认归位到右上角（不持久化拖动位置）

**日期**：2026-08-07
**涉及 commit**：（当前）

## 改了什么
- API 浮窗（`components/os/ApiQuickFloat.tsx`）每次 cold start 默认归位到屏幕右上角
- 拖动位置不再写 localStorage

## 根因
- 暮色之前在电脑（宽屏）上拖动浮窗到屏幕边缘，位置被存进 `localStorage.sullyos_api_quickfloat_pos_v1`
- 之后手机（窄屏）导入备份后渲染，组件初始化时从 localStorage 读到这个宽屏存的 `{x, y}` 值
- 浮窗渲染在屏外 / 被状态栏盖住，"看不见了"
- 暮色 8-7 反馈："悬浮窗在电脑上被放在比较靠边的位置，手机上导入备份后屏幕比较窄就挡住了"

## 修法
- `useState` lazy init 不再读 localStorage，每次 cold start 都用 `window.innerWidth - BALL_SIZE - 28, 76`
- `window.innerWidth - BALL_SIZE - 28` = 屏幕右边往左 28px，**窄屏自动靠左、宽屏自动靠右**（"不是固定死"）
- `y: 76` = 状态栏 44px + 空隙 32px，正好在 chat header 上沿（跟星星按钮并排）
- `onPointerUp` 不再写 localStorage
- 拖动期间保留 setPos + clamp 到 viewport（防止拖出视口）

## 副作用
- 浮窗位置不再跨 session 保留 —— 每次刷新都回右上角
- 这正是暮色要求的"每次刷新归位 + 当前 session 内自由拖动"

## 动了哪些文件
- `components/os/ApiQuickFloat.tsx` — 2 处：useState lazy init（删 localStorage 读）+ onPointerUp（删 localStorage 写）

## 备注
- `POS_KEY` 常量保留（`sullyos_api_quickfloat_pos_v1`），现在没人读写，但留作 future debug / 回滚
- 暮色图里浮窗在 chat header 上沿（星星按钮左边），默认位置 `y: 76` 是这个高度
