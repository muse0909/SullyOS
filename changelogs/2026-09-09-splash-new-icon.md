# 2026-09-09 splash 换暮色给的新图（方形 1254x1254）

暮色 21:43 给新 splash 图 https://i.ibb.co/PGc3K1YG/tb2-1.png（深蓝月夜风 + 月亮 + 牵牛星 + 小女孩 + 猫，1254×1254 方形 2.7MB）。

## 之前 splash 实际行为澄清
暮色之前反馈"之前一直是粉色水母图标" —— 那就是 Android 12+ SplashScreen API 默认用 app icon 居中显示。之前 splash.png（之前暮色给的 768x768 女孩+星星+黄昏）**根本没生效**（Android 12+ 不认 `android:background`），Android 用默认 app icon（mipmap/ic_launcher_foreground.png 粉色水母）替代。

暮色给的方形新图 1254x1254 适合做 SplashScreen API 居中 icon（Android 12+ 居中 icon 强制 ~108dp）。

## 改动
- 11 个 dpi 的 splash.png 全部换成暮色给的新图（tb2-1.png）
- `public/splash-new.png` 备份（不在 build 范围）
- styles.xml 不变（之前已经配 windowSplashScreenBackground + windowSplashScreenAnimatedIcon）

## 之前暮色以为 splash 全屏显示
暮色说"之前一直是点开链接先看到那个粉色水母图标，然后加载跳桌面"——Android 12+ SplashScreen API 默认行为就是居中 app icon + 浅蓝/白底 + 应用名。暮色以为的"全屏 splash"实际是 Android 12+ 默认居中 icon。

## 全屏 splash 图的限制
Android 12+ SplashScreen API **强制**居中 icon（~108dp）+ 背景色，**不**支持全屏大图。
要全屏显示 splash 图，必须改 Java 代码写自定义 SplashActivity：
- 新建 SplashActivity.java（用 ImageView 显示 splash.png 全屏）
- AndroidManifest.xml 把 SplashActivity 设为 LAUNCHER，MainActivity 设为 default
- SplashActivity 2 秒后跳 MainActivity
- 不再用 Theme.SplashScreen（改回 Theme.AppCompat）

暮色如果接受"居中 icon"现状就不写 Java。如果坚持要全屏再写 SplashActivity。

## 验收
- splash 显示暮色给的深蓝月夜图（居中，约 108dp）+ 浅蓝背景
- 装 APK 后看效果
- 暮色需要重新打包 APK

## 不动
- TDZ 修、PhoneShell 容器 top:0 修都在上一轮 preview commit 5a5803ab 里
- chat header 背景透明：暮色说等下再说