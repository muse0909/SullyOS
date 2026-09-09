# 2026-09-09 splash 白屏 + Android 状态栏漏粉紫渐变 修

暮色 9-9 20:10 反馈：之前的改动有两个问题：
1. splash 显示成白屏（之前是"图标→加载页→桌面"，现在"白屏→蓝闪→桌面"）
2. 聊天页顶部还是粉紫渐变条（暮色猜"头像栏没顶到顶露出底下图"——猜对了）+ chat header 自己变成"白色色块"

## 我之前误改了哪里
- `components/chat/ChatHeaderShell.tsx` line 171-172：我把 'gradient' 模式整个 bg-white/85 替换了粉紫渐变 — **误改**
- 暮色设 'gradient' 就是为了头像栏显示粉紫渐变，不该去掉
- 真正该改的是 **PhoneShell 背景从 Android 系统状态栏透出来**（不是 chat header 自己的渐变）

## 真正原因
- `components/PhoneShell.tsx:267` 之前是 `setOverlaysWebView({ overlay: true }) + hide()`
- overlay:true 让 WebView 顶到屏幕最顶 0
- hide() 只隐藏状态栏文字/图标，但 0-Xpx 还是 WebView 区域
- PhoneShell line 440 背景 `bg-gradient-to-br from-pink-200 via-purple-200 to-indigo-200`（粉紫渐变）从这漏出来
- 看起来像"粉紫渐变条"

## 改动

### 1. PhoneShell 改成 overlay:false + 白色背景
- `components/PhoneShell.tsx:262-269`:
  - 之前：`setOverlaysWebView({ overlay: true }) + hide()` —— WebView 顶到 0，粉紫透出
  - 现在：`setOverlaysWebView({ overlay: false }) + setBackgroundColor({ color: '#FFFFFF' })` —— WebView 不延伸到状态栏，0-Xpx 是白色状态栏
- 这样 PhoneShell 粉紫渐变不再透过状态栏漏出

### 2. ChatHeaderShell 'gradient' 模式改回
- `components/chat/ChatHeaderShell.tsx:170-172`: 恢复 `bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm`
- 之前误改成 `bg-white/85` 导致"色块"，已改回

### 3. splash 修：Android 12+ SplashScreen API
- 之前 `styles.xml` 只配 `android:background="@drawable/splash"` —— 在 Android 5-11 生效，但 12+ 用了新 SplashScreen API（`windowSplashScreenBackground` / `windowSplashScreenAnimatedIcon`）不认 android:background → 显示默认白底
- 暮色看到"白屏→蓝闪→桌面" —— "白屏"就是 12+ 默认 splash 背景（白）
- `android/app/src/main/res/values/styles.xml`:
  - 加 `windowSplashScreenBackground = #b8d4ec`（跟 loading 图底色一致防闪黑）
  - 加 `windowSplashScreenAnimatedIcon = @drawable/splash`（icon 居中显示 splash 图）
  - 加 `postSplashScreenTheme = @style/AppTheme.NoActionBar`（splash 后切回主主题）
  - 保留 `android:background="@drawable/splash"` 给 Android 5-11 兜底

## 验收
- splash 在 Android 12+ 显示浅蓝拱窗图（之前是白屏）
- 聊天页顶部 Android 状态栏是白色（之前是 PhoneShell 粉紫透出）
- chat header 'gradient' 模式保持粉紫渐变（暮色自己设的）
- 暮色需要重新打包 APK

## 不动
- StatusBar.tsx 'gradient' 模式（之前改成 `bg-white/95`，保持 —— StatusBar 在屏幕顶 0-2.5rem，跟 Android 状态栏重叠，去掉渐变防止视觉混乱）
- `components/appearance/ChatAppearanceEditor.tsx:478` 外观 App 预览窗口的粉紫渐变（是预览假 header，暮色不会误认）
- `apps/Appearance.tsx:107` 外观 App 预览（同上）
- 其他 chatHeaderStyle 模式（minimal/wechat/telegram/discord/pixel）不动
- theme.hideStatusBar 暮色当前 = true（StatusBar 不渲染）
