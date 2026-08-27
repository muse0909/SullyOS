# 2026-08-27 桌面图标渲染异常修复 + 缩放方案回退

## 一、桌面 6 个图标显示异常（见面/彼方/外观/都市人生/特别时光/你画我猜）

### 排查过程
1. **组件层**：AppIcon 是全站唯一图标磁贴组件，磨砂容器 + 单个 Phosphor 图标 + 文字标签。
   全项目只有 Launcher 三处使用（网格 / 四宫格 / 底栏），六个异常应用没有任何独立渲染路径，
   `Icons` 映射表键值齐全、导入完整 —— 代码逻辑上找不到 per-app 差异分支。
2. **发现页排除**：DiscoverPage 是白底列表样式（朋友圈/收藏/小纸条等），不含这批应用。
3. **数据层排除**：解包暮色 8-17 全量备份 `Sully_Backup_full_2026-08-17.zip`：
   - `customIcons = {}` 空 —— 无自定义图标覆盖；
   - `theme.desktopDecorations = null`、launcherWidgets 四项全空、4 个外观预设均不带 customIcons。
   排除数据类成因（死链图片/贴纸叠压）。

### 结论：安卓 WebView 合成层渲染 bug，非代码逻辑错误

故障分布规律性极强但无代码解释：第 1 页第二行后 3 个 + 第 3 页第二行后 3 个，中间那页完好。
该模式与 8-24 已记录的「Chrome backdrop-filter 常驻层渲染错乱」同类 —— Chromium 内核对
合成层裁剪属性的栅格化错误。风险点是 Launcher 页面容器上的两个激进样式：

```js
style={{ contentVisibility: 'auto', contain: 'layout paint', transform: 'translateZ(0)' }}
```

`content-visibility: auto` 让屏外内容跳过渲染、`contain: paint` 强制裁剪独立合成，
两者与横向 snap 滚动组合在安卓 WebView 上是显示残缺/图形叠影的高发组合。

### 修复（防御性）
`apps/Launcher.tsx`：
- 页面容器去掉 `contentVisibility: 'auto'` 和 `contain: 'layout paint'`，只留 `translateZ(0)`
- 滚动外层容器的 `contain: 'layout paint'` 一并移除
- 代价：一点点渲染开销；收益：不再触发这类内核渲染错乱

纯前端改动 → push master 后 Vercel 部署即生效，无需重打包。

## 二、缩放适配回退

- `index.html` viewport 改回禁缩放：`user-scalable=no, maximum-scale=1.0`（viewport-fit=cover 保留）
- `MainActivity.java`（**留在工作区未提交**，随⑤⑦批次等真机测试）：
  - `setSupportZoom(false)` 关闭捏合缩放，删掉 BuiltInZoomControls 两行
  - `setInitialScale(90)` 初始 90% 缩放（临时值，等反馈调整）
  - `setUseWideViewPort(true)` + `setLoadWithOverviewMode(true)` 宽视口自适应

## 三、APK 图标替换（**留在工作区未提交**，下次打包生效）

源图 `https://i.ibb.co/YJ9B9FH/vvtaxtq9rgccek6fl8oz.png`（1024×1024 RGBA）：

- 自动检测非透明包围盒裁剪（源图内容区 (22,25)-(1001,995)），主体撑满画布再缩放
- `ic_launcher.png` / `ic_launcher_round.png` 五密度整图：
  mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192
- `ic_launcher_foreground.png` 自适应前景五密度（108dp 基准：108/162/216/324/432px），
  内容居中占 64% 画布防圆角蒙版裁切，四周透明
- `mipmap-anydpi-v26/ic_launcher.xml` 引用关系不变（@mipmap/ic_launcher_foreground +
  @color/ic_launcher_background=#FFFFFF），无需改 xml
