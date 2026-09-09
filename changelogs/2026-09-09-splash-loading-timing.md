# 2026-09-09 splash 1s + loading 2s + StatusBar 双倍计算修 + 单图

暮色 22:42 反馈：
1. splash + loading 时间都很短，闪一下就没了
2. 不连贯：开屏→白屏→加载图→桌面
3. 加载图放大裁掉四周花边
4. 换成新图 https://i.ibb.co/7TxYfsf/1233455.jpg（NOCTURNE 浅蓝拱窗白天高分辨率版 1080×2376）
5. 只要一个尺寸（去掉 11 dpi 多份）
6. APK 内置状态栏特别宽，头像贴底边没有居中
7. 改完提交测试分支，合并主分支，重打 APK

## 改动

### 1. splash 时长 2s → 1s
- `capacitor.config.json`: `SplashScreen.launchShowDuration: 2000 → 1000`

### 2. loading 强制 2 秒（不依赖 React 渲染时机）
- `index.html`: 之前是 React 渲染完派发 `sullyos:app-ready` 事件就淡出（闪一下）
- 现在：记录 loadingStart 时间，React 渲染完后检查 elapsed 是否到 2 秒
  - 到了 → 淡出
  - 没到 → setTimeout 等到 2 秒再淡出
- 兜底：12s（之前 10s）防卡死白屏

### 3. loading 图完整显示（不裁剪）
- `index.html`: `#sullyos-loading img` `object-fit: cover → contain`
- `width: 100%; height: 100%` 改成 `max-width: 100%; max-height: 100%; width: auto; height: auto`
- 背景色 `#0a1628`（深蓝）→ `#b8d4ec`（淡蓝，跟新图底色一致）
- 图四周空余用背景填充（contain 模式：完整显示图 + 背景填空）

### 4. splash.png 单图（去掉 11 dpi 多份）
- 新图放 `drawable/splash.png`（默认）+ `drawable-nodpi/splash.png`（密度无关）
- 删掉 10 个 dpi 的 splash.png 文件（port/land 各 5 个密度）
- `public/loading-default.png` 也用同一张
- APK 大小：之前 46MB（11 张 2.7MB × 11 = 29.7MB splash），现在应该小约 25MB

### 5. StatusBar 双倍计算修
- `components/os/StatusBar.tsx:110-117`:
  - 之前同时设 `paddingTop: env(safe-area-inset-top)` + `height: calc(env + 2.5rem)`
  - content-box 默认 box-sizing 下 padding 加在外面 → 总高度 = 2*env + 2.5rem（暮色看到"特别宽"的原因）
  - 改 box-sizing: border-box + height: 2.5rem → 总高度 = env + 2.5rem（正确）
  - 头像贴底边原因：safe-area-top 大（挖孔/刘海）+ paddingTop 把内容从顶部推下去，但容器特别宽，内容被 flex items-center 拉到容器中间（远离顶部）

### 6. preview 域名缓存提示
- preview 域名 (sully-os-git-preview-muse0909s-projects.vercel.app) js hash = `index.CUi_Fdrt.js`
- chat header 'gradient' 渐变字符串匹配 2 处（已生效）
- 暮色说"preview 大白块"可能是浏览器缓存没刷新——试一下 Ctrl+Shift+R 强制刷新或无痕窗口

## 验收
- splash 显示 1 秒（暮色要）
- loading 强制 2 秒（暮色要）—— 总 splash + loading ≈ 3 秒
- loading 图完整显示不裁剪（暮色要）
- StatusBar 高度 = env(safe-area-top) + 2.5rem（之前是 2 倍）
- 头像居中（不被 paddingTop 推到顶）
- 暮色需要重新打包 APK

## 不动
- chat header 背景透明（暮色说等下）
- splash 全屏 Java 自定义（暮色接受了居中 icon）