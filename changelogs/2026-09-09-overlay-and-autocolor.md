# 2026-09-09 第三轮修：Android 状态栏消失 + 状态栏跟头像栏联动 + 字色自动

暮色 9-9 20:42 反馈：
1. 状态栏和头像栏的联动没了（之前都是 gradient 粉紫渐变同步风格）—— 我上一轮把 SullyOS StatusBar 'gradient' 模式改成白底，破坏了联动
2. 状态栏不要白色——上一轮我 setBackgroundColor('#FFFFFF') + StatusBarStyle.Dark，但 Android 11- Dark = 白字，跟白色背景撞色看不清时间
3. 字色自动变：浅色背景应该用深色字，深色背景用浅色字（之前 StatusBar 文字固定白）
4. 图二"边"是 PhoneShell 背景（粉紫渐变）从 0-Xpx 透出来，不是 Android 系统状态栏

## 我之前又误改了
- PhoneShell.tsx: setOverlaysWebView({ overlay: false }) + setBackgroundColor('#FFFFFF') —— 试图用 Android 系统状态栏遮 PhoneShell 粉紫，但 Android 11- StatusBarStyle.Dark = 白字，撞色看不清
- StatusBar.tsx 'gradient' 模式：改成 bg-white/95 backdrop-blur-md —— 破坏跟 chat header 的联动
- StatusBar textColor: 固定 '#ffffff' —— 浅底白字看不清

## 真正修法
- 跟之前 9-7 那次 commit (8c35c0a0) 一样：setOverlaysWebView({ overlay: true }) + hide() —— Android 状态栏整个消失，WebView 顶到屏幕最顶 0
- SullyOS StatusBar 'gradient' 模式恢复成原版 bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl（跟 chat header 同步）
- SullyOS StatusBar textColor 按 headerStyle 手动映射：
  - 'gradient' / 'minimal' / 'wechat' / 'telegram' / 'floating' / 'flat' / default → #1f2937（深字，浅底）
  - 'discord' → #ffffff（白字，深底）
  - 'pixel' → #fff7ed（米色字，棕底）
- chat header sticky top-0 + paddingTop: env(safe-area-inset-top) 让背景延伸覆盖到 0（包括 Android 状态栏区域），内容从安全区下开始

## 改动

### 1. components/PhoneShell.tsx:262-269
- 恢复 setOverlaysWebView({ overlay: true }) + hide()
- 去掉 setBackgroundColor('#FFFFFF') 和 StatusBarStyle.Dark
- Android 状态栏整个消失，WebView 顶到屏幕最顶 0

### 2. components/os/StatusBar.tsx
- 'gradient' 模式背景恢复成 bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl（跟 chat header 同步）
- textColor 加自动映射（按 headerStyle）：gradient 浅底 → #1f2937 深字；discord 深底 → #ffffff 白字；pixel 棕底 → #fff7ed 米色字

### 3. components/chat/ChatHeaderShell.tsx:350
- 加 style={{ paddingTop: 'env(safe-area-inset-top)' }}
- sticky top-0 让背景延伸覆盖到 0（包括之前 0-Xpx Android 状态栏区域 + 之前 PhoneShell 粉紫透出区）
- 内容（头像/麦麦/星/设置）从 safe-area-top 开始不被状态栏区域遮挡

## 验收
- 桌面（hideStatusBar=true）全屏，跟之前一样（0-30px 是 PhoneShell 背景或壁纸，不再有"边"）
- 聊天页（hideStatusBar=true，但 chat header sticky top-0 顶到 0）：0-30px 是 chat header 渐变背景（覆盖 PhoneShell 粉紫透出区），内容从 safe-area-top 开始
- SullyOS 状态栏（hideStatusBar=false 时）：跟 chat header 同步 gradient 粉紫渐变 + 深色字（看得清）
- 暮色需要重新打包 APK
