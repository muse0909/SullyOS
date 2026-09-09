# 2026-09-09 加载图也换成 tb2-1.png

暮色 21:49 说"把加载页图换成这个"（tb2-1.png 深蓝月夜风那张）—— 之前的浅蓝拱窗白天不用了。

## 改动
- `public/loading-default.png` 换成 tb2-1.png（1254x1254 方形，跟 splash 图一样）
- `index.html` 改 `#sullyos-loading` 背景色从 `#b8d4ec`（浅蓝）改成 `#0a1628`（深蓝夜空，跟新图底色匹配防闪）
- `utils/loadingImage.ts` 不动（路径不变 `./loading-default.png`）

## 用户上传图覆盖
- 默认图换了，但用户上传图（localStorage `custom_loading_image`）不变
- 用户之前上传的图会继续显示（如果有）
- 设置面板"恢复默认加载图"现在恢复的是新 tb2-1.png

## 验收
- 装新 APK 后 splash 显示 tb2-1.png（Android 居中 icon）+ 浅蓝背景
- WebView loading 阶段显示 tb2-1.png 全屏 + 深蓝背景（防闪）
- 之前"splash 和 loading 用同一张图" → 现在都是 tb2-1.png
- 暮色需要重新打包 APK