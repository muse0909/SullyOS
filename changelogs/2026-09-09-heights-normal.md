# 2026-09-09 状态栏 + chat header 高度恢复正常（之前撑太高了）

暮色 23:09 反馈："字是居中了。但是框怎么那么高了？都要占半个屏幕了"——chat header 框太高。
暮色 23:10 反馈："不止是头像框，状态栏也太高了"。

## 上一轮我误改的
- StatusBar: height = `calc(env + 2.5rem)` ≈ 90px（之前 2.5rem = 40px）→ 太高
- ChatHeaderShell: height = `calc(env + 4.5rem)` ≈ 122px（之前 h-[72px] = 72px）→ 太高
- PhoneShell App 容器: hideStatusBar=true 时 top: 0，hideStatusBar=false 时 top: calc(env + 2.5rem) — **保留**这个逻辑

## 根因
- Android 系统状态栏已经 `hide()` 隐藏（之前设的 overlay:true + hide()）
- safe-area-top 区域**没东西**（Android 系统状态栏隐藏 + WebView 顶到屏幕顶 0）
- 之前为了"覆盖屏幕顶 0"加了 env 到 StatusBar height —— **不需要**，因为 Android 状态栏隐藏了

## 改动（恢复正常尺寸）

### 1. StatusBar 高度 90px → 40px
- `components/os/StatusBar.tsx`:
  - 之前：height: `calc(env(safe-area-inset-top, 0px) + 2.5rem)` ≈ 90px
  - 现在：height: `2.5rem` (40px)，box-sizing: border-box
  - flex items-center 内容居中（在 40px 容器内）

### 2. ChatHeaderShell 高度 122px → 72px
- `components/chat/ChatHeaderShell.tsx`:
  - 之前：去 headerDensityClass + inline height: `calc(env + 4.5rem)` ≈ 122px + paddingTop + items-start
  - 现在：恢复 `${headerDensityClass}`（默认 h-[72px] = 72px）+ flex items-center
  - 不加 inline 高度，不加 paddingTop

### 3. PhoneShell App 容器（保留之前逻辑）
- `components/PhoneShell.tsx`:
  - hideStatusBar=true 时 top: 0（App 从屏幕顶 0 开始）
  - hideStatusBar=false 时 top: `calc(env + 2.5rem)`（App 从 StatusBar 下面开始，StatusBar 在 0-2.5rem 不重叠）

## 整体结构（暮色当前 hideStatusBar=true 状态）
- 0-env：PhoneShell line 440 粉紫渐变（之前看到的"边"，没修了——暮色接受了 Launcher / Chat 时背景透粉紫）
- env-env+2.5rem（如果 hideStatusBar=true，App 从 0 开始）— 之前我加了 0
- chat header 在 PhoneShell 容器内 sticky top-0，h-[72px] 高度，flex items-center 内容居中

## 验收
- StatusBar 高度 40px（之前 90px）→ 字垂直居中在 40px 容器
- chat header 高度 72px（之前 122px）→ 头像/麦麦/星/设置在 72px 容器居中
- 暮色需要重新打包 APK