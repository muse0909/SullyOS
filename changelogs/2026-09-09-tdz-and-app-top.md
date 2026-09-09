# 2026-09-09 第四轮修：TDZ bug + PhoneShell App 容器 top: 0

暮色 9-9 21:04 反馈：
1. **打开状态栏（hideStatusBar=false）整个 App 卡死** — DevTools console 显示 `ReferenceError: Cannot access 'g' before initialization at rA`
2. **聊天页上面透底的边还在**（chat header 没顶到屏幕顶 0）
3. splash 暮色问是不是只能是图标大小方形（先不动手）
4. chat header + 输入框背景去掉/透明（先查不写）

## 改动

### 1. TDZ bug 修（导致打开状态栏卡死）
- `components/os/StatusBar.tsx`：
  - 之前 line 30-44 的 `autoTextColor` 引用了 `headerStyle`，但 `headerStyle` 是 line 83 才声明的 `const`
  - 同一个组件作用域内 const 提前用触发 TDZ error（"Cannot access 'g' before initialization"）
  - 表现：hideStatusBar=false 时 SullyOS StatusBar 渲染 → 试图算 textColor → 触发 TDZ → 整个 App 卡死
  - 修法：把 `headerStyle` 和 `chromeStyle` 的声明从 line 83 提到 line 30-34（在 autoTextColor 之前）
  - 重复声明删掉（line 82-84 改成注释）

### 2. PhoneShell App 容器 top: 0
- `components/PhoneShell.tsx:477-488`：
  - 之前：`top: theme.hideStatusBar ? 'env(safe-area-inset-top, 0px)' : 'calc(env(safe-area-inset-top, 0px) + 2.5rem)'`
  - 现在：hideStatusBar=true 时 `top: 0`（之前是 env(safe-area-inset-top)）
  - 原因：
    - 0-30px（Android 系统状态栏区域）在 PhoneShell App 容器**外**，显示 PhoneShell line 440 粉紫渐变背景
    - chat header `sticky top-0` 顶到的是 App 容器顶（= safe-area-top），不是屏幕顶 0
    - → 0-30px 还是透 PhoneShell 粉紫渐变（暮色看到的"边"）
  - 改成 0 后：App 容器顶到屏幕顶 0，chat header sticky top-0 = 屏幕顶 0
  - → 0-30px 是 chat header 粉紫渐变背景（覆盖 PhoneShell 透出处）
  - hideStatusBar=false 时仍是 `calc(env + 2.5rem)`（让 App 内容避开 SullyOS StatusBar）

## 不动（等暮色决定）
- splash 全屏 vs 居中 icon：Android 12+ SplashScreen API 强制 icon 居中显示（~108dp），不能全屏
  - 选项 A：接受 SplashScreen API + 居中 icon（小图）+ 浅蓝背景
  - 选项 B：写自定义 SplashScreenView.java（要改 Java/Kotlin 代码）
  - 选项 C：放弃 SplashScreen API，Android 12+ 显示默认白底（之前暮色看到的"白屏"）
- chat header + 输入框背景去掉/透明（暮色说"不动手先查就行"）

## 验收
- hideStatusBar=false 时 StatusBar 渲染不再卡死（TDZ 修了）
- chat header 顶到屏幕顶 0（PhoneShell 容器 top: 0）
- 暮色需要重新打包 APK