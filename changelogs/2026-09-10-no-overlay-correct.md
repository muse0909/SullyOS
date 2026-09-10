# 2026-09-10 修：所有 App 不被 StatusBar 覆盖 + chat header 回归居中

暮色 18:16 反馈：
1. 刚才这一版头像栏里的头像和按键又偏下了（昨天修对了今天破了）
2. 增加状态栏后其他页面顶部被盖住了一半（不是紧贴）
3. 正常应该：增加状态栏后所有页面在状态栏下紧贴着

## 根因
之前我把 PhoneShell App 容器 `top` 改成永远 0（让 chat header sticky top: 2.5rem 紧接 StatusBar）—— 但这导致**所有 App 内容从屏顶 0 开始**，被 StatusBar (0-40px) 覆盖。

加上 chat header 加了 paddingTop: env（之前为了覆盖 0-env 加的），flex items-center 居中导致头像偏下。

## 改动

### 1. PhoneShell App 容器 top 恢复 hideStatusBar 联动
- `components/PhoneShell.tsx:478-490`:
  - 之前（4dfaf415）：永远 top: 0
  - 现在：top: `theme.hideStatusBar ? 0 : '2.5rem'`（**不含 env**）
  - hideStatusBar=true：App 从 0 开始（之前逻辑）
  - hideStatusBar=false：App 从 40px 开始（紧接 StatusBar 下方）—— 所有 App 内容不被覆盖

### 2. ChatHeaderShell 回归昨天居中版本
- `components/chat/ChatHeaderShell.tsx:349-358`:
  - 之前（4dfaf415）：`sticky relative` + `top: 2.5rem` + `paddingTop: env(safe-area-inset-top)` + `flex items-center`
  - 现在：`sticky top-0`（昨天 93c3e8fb 版本）+ 默认 `headerDensityClass`（h-[72px]）+ `flex items-center`
  - 头像在 76px 屏顶（40px StatusBar + 36px 居中）
  - 去掉 paddingTop（Android 系统状态栏已 hide()，env 区域没东西，不需要 paddingTop 避安全区）

### 3. 渐变保持反向（接缝平滑）
- StatusBar: `from-primary/30 via-primary/15 to-primary/5`（深→浅）
- chat header: `from-primary/5 via-primary/15 to-primary/30`（浅→深）
- 接缝处（40px 边界）颜色一致（淡紫）

## 整体结构（hideStatusBar=false 状态）
- 0-40px：StatusBar (z-50)
- 40-112px：chat header（sticky top-0，h-72px，头像居中）
- 112px 起：聊天内容
- 其他 App：40px 起，紧接 StatusBar 下方

## 验收
- 头像栏头像/麦麦/星/设置在 76px 屏顶居中（不再偏下）
- 所有 App 内容从 40px 开始（紧接 StatusBar 下方，不被覆盖）
- 状态栏跟头像栏贴一起无空白条
- 暮色需要重新打包 APK