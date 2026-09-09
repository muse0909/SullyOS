# 2026-09-09 splash 换浅蓝拱窗 + chat header 'gradient' 模式去粉紫渐变

暮色 9-9 19:02 反馈两件事：
1. 看到加载图了，但点进去有白屏（其实是 splash，那张图暮色不喜欢）—— 要把 splash 也换成浅蓝拱窗白天那张
2. 聊天页顶部有条粉紫渐变条（"类似于状态栏的感觉"），要全屏

## 改动

### 1. splash.png 全 11 个 dpi 换成浅蓝拱窗白天
- 资源：public/loading-default.png（暮色给的 https://i.ibb.co/TDDJ23Wv/1468.png，926×1613 PNG 1.7MB）
- 替换：
  - android/app/src/main/res/drawable/splash.png
  - android/app/src/main/res/drawable-{port,land}-{h,m,xh,xxh,xxxh}dpi/splash.png (10 个)
- 之前是 768×768 PNG 0.8MB 的另一张图（女孩+星星+黄昏，是暮色之前给的，跟 9-9 选定的浅蓝拱窗不同）
- 现在 splash 和 loading（WebView 加载阶段）都用同一张浅蓝拱窗
- 9:16 比例接近原图 9:15.7，Android 12+ Theme.SplashScreen 9:16 渲染不会拉变形

### 2. 去掉 chat header 'gradient' 模式的粉紫渐变条
- `components/chat/ChatHeaderShell.tsx:170-172`:
  - 之前：`'bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm'`
  - 现在：`'bg-white/85 backdrop-blur-md border-b border-slate-200/50 shadow-sm'`（跟 'minimal' 模式几乎一致）
  - 保留 'gradient' 标签本身的语义，其他 header style（minimal/wechat/telegram/discord/pixel）不动
- `components/os/StatusBar.tsx:65-67`:
  - 跟 chat header 同步改：SullyOS in-app StatusBar 在 'gradient' 模式也不再有粉紫渐变
  - 之前：`'bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl'`
  - 现在：`'bg-white/95 backdrop-blur-md'`（跟 'minimal' 一致）

### 3. 原因
- 暮色说"边是聊天页，桌面是正常的全屏状态了"—— 桌面（Launcher）内部 padding-top 96px，粉紫渐变条被推到内容下面看不到；其他 App 内部 padding-top 较小，粉紫渐变条紧贴内容看起来像"边"
- 暮色说"类似于状态栏的感觉"—— 描述视觉形态（半透明模糊贴着顶部），不是真的 status bar
- 改完后 chat header 顶到屏幕顶，没那条粉紫渐变条

## 不动
- theme.hideStatusBar：in-app StatusBar 还在，暮色想关自己去外观 App 打开"隐藏顶部时间栏"开关
- 其他 chatHeaderStyle（minimal/wechat/telegram/discord/pixel）：用户配置不动
- 其他 App 的顶部样式：不动（他们本来就没这个粉紫渐变条）

## 验收
- splash 显示浅蓝拱窗（点开 App → splash 2s → 加载图 → React 渲染，三段都是浅蓝拱窗）
- chat header 'gradient' 模式没粉紫渐变条（视觉上跟 minimal 模式一样）
- 暮色需要重新打包 APK
