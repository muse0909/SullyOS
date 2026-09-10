# 2026-09-10 splash 白底 + tb2-1.png 居中 icon + loading 不动

## 暮色 9-10 22:17 反馈

1. **背景要白色**——`windowSplashScreenBackground` / `android:windowBackground` / `index.html` body 背景全部白色，**不要浅蓝**
2. **开屏图标换成 tb2-1.png**（暮色 9-9 21:43 给的 1254×1254 方形圆角深蓝月夜风图），Android 12+ SplashScreen API 居中显示
3. **加载页完全不动**——`public/loading-default.png` 保持 1233455.jpg（1080×2376 长方形浅蓝拱窗）
4. **不要原作者的粉色水母图**——用暮色自己的 tb2-1.png

## 修改

### 资源
- `android/app/src/main/res/drawable/splash.png` → tb2-1.png（1254×1254 PNG，2.7MB，**原 1233455.jpg 长方形 1.4MB**）
- `android/app/src/main/res/drawable-nodpi/splash.png` → tb2-1.png（同上）

### `android/app/src/main/res/values/styles.xml`
- `windowSplashScreenBackground`: `#b8d4ec` → `#ffffff`（暮色明确要白色）
- **新增** `android:windowBackground`: `#ffffff`（splash 关掉那帧 WebView 默认底也是白色，无白闪）

```xml
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <item name="android:background">@drawable/splash</item>
    <item name="android:windowBackground">#ffffff</item>
    <item name="windowSplashScreenBackground">#ffffff</item>
    <item name="windowSplashScreenAnimatedIcon">@drawable/splash</item>
    <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
</style>
```

### `index.html`
- `body { background-color: #0f1115 }` → `#ffffff`（跟 splash 背景色统一）

## 视觉效果

```
0-1s    Android 系统 splash
        白色背景 + 居中方形圆角 tb2-1.png（~108dp）
        Android 12+ SplashScreen API 强制居中 icon 模式

1s      splash 关掉那帧
        WebView 默认底 = #ffffff 白色（splash 关掉到 React 接管前的兜底色）
        → 立即显示 #sullyos-loading 整屏 1233455.jpg
        中间无白屏（暮色要的"连贯"）

1-3s    React 接管
        整屏 1233455.jpg（长方形浅蓝拱窗）
        body #ffffff 兜底防透白

3s+     PhoneShell 主界面
```

**用户视觉上看到两段切换**：
- 居中方形圆角小图（开屏 1s，白底）
- 整屏长方形大图（加载 2s，浅蓝拱窗）

中间无白屏无闪烁。

## 没动

- `public/loading-default.png` 保持 1233455.jpg（暮色明确说不动）
- `#sullyos-loading` 元素、`LOADING_MIN_MS=2000` 强制延迟、`App.tsx` 的 `sullyos:app-ready` 事件淡出逻辑
- `capacitor.config.json` `SplashScreen.launchShowDuration: 1000` 保持
- `Appearance.tsx` LoadingImagePanel（用户可上传启动图）保持
- `utils/loadingImage.ts` 保持
- 所有 App 顶部 padding 修复（之前那批 commit）不动

## git 流程

按 9-8 流程 + 暮色 9-10 22:17 明确授权"提交合并做好"：
1. commit 到 master
2. push origin master + master:preview（同步 preview）
3. build + cap sync + gradle assembleDebug
4. 重新打 APK，APK 文件名按 `build.gradle` 自动是 `拾光机-{versionName}.apk`
