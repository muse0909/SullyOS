# 2026-09-09 启动加载图：默认那张 + 用户可上传

暮色 9-9 提的需求：点开 App → Capacitor splash → WebView 加载远程资源 → React 渲染 中间这段空白期
（之前是黑屏 + 系统自带的"正在加载"提示），现在改成显示一张图。
暮色给了两张水彩风的图当候选，最后选定浅蓝拱窗白天那张做默认（另一个深蓝月夜没采用——按暮色 9-9 18:14 "不做轮换，只做自己上传"）。

## 改动

### 1. 默认图资源
- 下载暮色给的 https://i.ibb.co/TDDJ23Wv/1468.png（926×1613 PNG 1.7MB）到 `public/loading-default.png`
- Vite build 自动从 public/ 复制到 dist/loading-default.png（已验证 1.7MB 过去）

### 2. `index.html` — 加 WebView loading 阶段的全屏图
- 在 #root 之前插 `<div id="sullyos-loading">` + `<img id="sullyos-loading-img" src="./loading-default.png" />`
- 默认 src 指向默认图；启动时由 index.tsx 读 localStorage 覆盖
- 加 sullyos:app-ready 事件监听：React 渲染完 App 派发这个事件，loading 淡出 0.5s 后从 DOM 移除
- 兜底：10s 后无论 React 启动没启动都强制淡出（防止卡死白屏）
- CSS：`#sullyos-loading` fixed inset:0 + z-index 99999 + object-fit cover，背景色 #b8d4ec 跟图底色一致防闪黑

### 3. `App.tsx` — 派发 app-ready 事件
- 第一次 commit 后 useEffect 派发 `window.dispatchEvent(new CustomEvent('sullyos:app-ready'))`
- 时机：React 树至少渲染一帧（不必等 OSContext isDataLoaded——PhoneShell 内子组件还有自己的 loading，那时显示加载图反而更好）
- StrictMode 双调用没关系，index.html 监听用了 `{ once: true }`

### 4. `index.tsx` — 启动时读 localStorage 覆盖 img.src
- 在 root.render 之前同步读 `localStorage.getItem('custom_loading_image')`
- 有就 `img.src = custom`（base64 dataURL）
- 必须在 React 挂载前跑（img 元素已存在，直接 setAttribute）

### 5. `utils/loadingImage.ts` — 新建工具
- `getActiveLoadingImageUrl()` — 启动时用，优先用户上传图，没有用默认
- `setCustomLoadingImage(file)` — File → base64 → localStorage，4MB 限制
- `clearCustomLoadingImage()` — 移除 localStorage
- `hasCustomLoadingImage()` — 给设置面板显示状态
- `getDefaultLoadingImageUrl()` — 给预览用
- 选 localStorage 而非 IDB 是因为 DB_VERSION 已经 72 了，加新 store 要走升级流程；5MB localStorage 够单张图

### 6. `apps/Appearance.tsx` — 加"启动加载图"设置面板
- 位置：activeTab === 'theme' 块里 Wallpaper section 后面
- 跟 Wallpaper 同语义层级：都是「App 启动/系统级」视觉。跟桌面装饰/聊天外观分开
- 新组件 `LoadingImagePanel`（同文件内）：
  - 预览当前激活的图（9:16 卡片）
  - 点上传按钮：选图 → base64 → localStorage → toast
  - 长按预览：清除用户图，回默认（跟 Wallpaper 块交互一致）
  - "恢复默认加载图" 按钮：只在 hasCustom 时显示
- 文件顶部 import loadingImage 工具

### 7. `capacitor.config.json` — 改 server.url 到 sully-muse-vert.vercel.app
- 暮色 9-9 反馈"之前的都打包错了。打包成测试分支了。要 sully-muse-vert.vercel.app 打包这个链接的"
- 之前 server.url 是 `https://sully-os-git-preview-muse0909s-projects.vercel.app`（Vercel 给 preview 分支起的预览域名）
- 改成 `https://sully-muse-vert.vercel.app`（项目主域名，暮色手机应该走这个）
- allowNavigation 保留两个（兼容）
- `android/app/src/main/assets/capacitor.config.json` 被 git ignore（gitignore:99），但 build APK 前 `npx cap sync` 会从根目录同步过去

## 验收
- TypeScript build 0 错误（vite build 4.17s 通过，dist/loading-default.png 1.7MB 过去）
- 默认行为：App 启动时看到浅蓝拱窗白天那张图，0.5s 淡出
- 上传：设置 → 外观 → 启动加载图 → 点上传 → 选图 → 提示"加载图已更新，下次启动生效"
- 长按预览：恢复默认
- 暮色需要重新打包 APK 拿到 sully-muse-vert.vercel.app 的新 server.url
