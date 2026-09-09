# 2026-09-09 StatusBar 居中 + chat header 高度覆盖 StatusBar + 中间条修

暮色 23:00 反馈：
1. 状态栏字没居中（贴底部）
2. 头像栏头像名字按钮整体靠下没修复（实际是被 StatusBar 完全盖住）
3. 顶部中间多出一条空白条（StatusBar 渐变跟 chat header 渐变颜色不一致）

## 改动

### 1. StatusBar 居中（修问题 1）
- `components/os/StatusBar.tsx:110-117`:
  - 之前：box-sizing: border-box + paddingTop: env + height: 2.5rem → 内容区 = 2.5rem - env，剩 0-几 px，flex items-center 居中贴底
  - 现在：去 paddingTop，height = `calc(env(safe-area-inset-top, 0px) + 2.5rem)`，flex items-center 让内容在总高度内居中
  - Android 系统状态栏已经 hide()，safe-area-top 区域没东西，StatusBar 内容填进去

### 2. ChatHeaderShell 高度覆盖 StatusBar（修问题 2 + 3）
- `components/chat/ChatHeaderShell.tsx:349-360`:
  - 之前：h-[72px]（72px fixed height）+ sticky top-0 + paddingTop: env
  - 现象：StatusBar 高度 env+2.5rem ≈ 90px > 72px，chat header 被 StatusBar 完全盖住（z-50 > 30）
  - 现在：去掉 headerDensityClass（h-[72px]），改 inline height = `calc(env(safe-area-inset-top, 0px) + 4.5rem)`，覆盖 StatusBar 高度 + 72px 内容区
  - paddingTop = env（让内容从安全区下开始，避开 StatusBar 高度内的内容）
  - flex items-start 让内容贴顶（不是居中）
  - 两段渐变（StatusBar 0-env+2.5rem + chat header env+2.5rem-env+4.5rem）颜色一致（都是 'gradient' 模式粉紫）→ 视觉上连续，没中间条

## 验收
- 状态栏字（22:55 等）垂直居中
- chat header 头像/麦麦/星/设置显示在 StatusBar 下面（不被盖住）
- 顶部渐变连续，没中间空白条
- 暮色需要重新打包 APK

## 不动
- splash + loading 配置
- 其他 chatHeaderStyle（minimal/wechat/telegram/discord/pixel）模式：用户配置不动