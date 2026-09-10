# 2026-09-10 状态栏 + 头像栏贴一起 + 接缝颜色平滑

暮色 17:45 反馈："apk 打开状态栏时聊天页顶部 3 个条。头像框和状态栏没挨一起，中间有空。要把头像栏和状态栏贴在一起。"

## 根因
- PhoneShell App 容器 `top: calc(env + 2.5rem)`（hideStatusBar=false 时）—— 给 StatusBar 留了 env+2.5rem 高度的顶部空间
- StatusBar 在 0-2.5rem (40px)，env=50px → 0-40px 是 StatusBar，**40-90px 是空白**（中间条），90px 起是 chat header
- 暮色手机挖孔大，env=50px → 中间空 50px 高

## 改动

### 1. PhoneShell App 容器 top 永远 0（不管 hideStatusBar）
- `components/PhoneShell.tsx:478-490`:
  - 之前：hideStatusBar=true 时 top: 0，false 时 calc(env + 2.5rem)
  - 现在：永远 top: 0
  - App 从屏幕顶 0 开始，sticky chat header 自己 top: 2.5rem 紧接 StatusBar 下方

### 2. ChatHeaderShell 紧接 StatusBar 下方
- `components/chat/ChatHeaderShell.tsx:349-358`:
  - sticky relative + top: 2.5rem + paddingTop: env(safe-area-inset-top)
  - 0-2.5rem: StatusBar (z-50)
  - 2.5rem-env: chat header 顶部空白（StatusBar 已经结束，下面是 chat header 渐变空白区）
  - env-env+72px: chat header 内容（头像/麦麦/星/设置）从安全区下开始
  - 中间无空白，状态栏和头像栏贴一起

### 3. 渐变接缝处颜色平滑
- `components/os/StatusBar.tsx:88-89`:
  - StatusBar 'gradient' 渐变: `from-primary/30 via-primary/15 to-primary/5`（深→浅，左深右浅）
  - 之前是 to-white/80（端点白），导致 StatusBar 整体看起来白，跟 chat header 紫渐变接缝明显
  - 现在端点 to-primary/5（淡紫），保持紫色调
- `components/chat/ChatHeaderShell.tsx:170-172`:
  - Chat header 'gradient' 渐变: `from-primary/5 via-primary/15 to-primary/30`（**反向渐变**，左浅右深）
  - 顶部 from-primary/5 = 淡紫，跟 StatusBar 底部 to-primary/5 = 淡紫 颜色一致
  - 接缝处（2.5rem 边界）颜色平滑过渡，无明显"中间条"

## 验收
- 状态栏在 0-40px
- 头像栏在 40px 起（紧接状态栏下方）
- 中间无空白条
- 状态栏渐变跟头像栏渐变在接缝处颜色一致（淡紫→深紫渐变，方向相反但端点颜色匹配）
- 暮色需要重新打包 APK