# 页面缩放滑条 — 纯前端 CSS zoom 替代原生 WebView 缩放

**日期**：2026-08-27
**涉及 commit**：`35e7358d`

## 改了什么

- 新增 `utils/pageZoom.ts`：页面缩放的读写与应用。缩放值存 localStorage（键 `sullyos_page_zoom`），应用方式是给 `document.documentElement.style.zoom` 赋值（如 `0.9` / `1.05`）。
- 设置页新增「页面缩放」板块：滑动条 70%-130%，步进 5%，默认 100%。拖动即生效即记忆，另给了一个"恢复默认 100%"胶囊按钮。
- `index.tsx` 启动时在 React 首次渲染前调 `applyPageZoom()`，从 localStorage 恢复上次的缩放值——挂载前 root 是空的，不会闪帧。
- MainActivity.java 还原了 8-27 加的原生 WebView 缩放配置（`setInitialScale(90)`、`setSupportZoom(false)`、`setUseWideViewPort`、`setLoadWithOverviewMode`），恢复 Capacitor 默认行为。改动只影响下次打包。

## 为什么是 zoom 不是 transform: scale()

- **zoom 自 2024-05 起是 CSS 标准属性**（Baseline 2024）：Chrome 全系、Android WebView（Chromium）、iOS Safari 原生支持，Firefox 126+ 也支持——琪琪的 iOS 端同样可用。
- `transform: scale()` 挂根元素会把整页缩小留白边（caniuse 明确记录的差异），fixed 定位弹窗定位也会乱；zoom 没有这些问题，布局、fixed 弹窗、滚动全部跟手。
- 项目风险面核查过：全项目 `100vh/h-screen` 只有 2 处（MusicUI 掉落动画 keyframes、MemoryPalaceApp 一个带 overflow 兜底的 maxHeight），root zoom 下都不会出裁切问题；`fixed inset-0` 的 87 处弹窗在 root zoom 下跟随缩放正常铺满。

## 动了哪些文件

- `utils/pageZoom.ts` —— 新建：clamp / 读存 / 应用三个函数 + 常量导出
- `apps/Settings.tsx` —— import + state + handler + 「页面缩放」SettingsSection（放在 API 请求账本之后）
- `index.tsx` —— import + 启动时 applyPageZoom()
- `android/.../MainActivity.java` —— 删原生缩放块 + 删 WebSettings import，留注释说明去向

## 踩坑 / 需要知道的

- **远程加载模式下不用重新打包**：前端 zoom 跟着部署走，push master 部署后手机刷新即生效。MainActivity 的还原只影响未来某次重新打包。
- `document.documentElement.style.zoom` 若内核不支持会静默无效（不会崩），不写 try-catch 兜底逻辑是故意的——目标平台全支持，代码越少越干净。
- Safari 的 `getBoundingClientRect()` 历史上返回未缩放尺寸（OpenReplay 提到的怪癖），如果以后有依赖精确测量坐标的功能在 iOS 上表现奇怪，先查这里。
- AGENTS.md 写的是"不主动 push master"，本次是暮色明确指示"纯前端改动 push master 就行不用重新打包"，特例照办。

## 备注

- 缩放只影响视觉大小，不改布局断点、不影响 window.innerWidth 返回值。
- 滑条挂在设置页最底部（API 请求账本之后）。想挪到侧边栏或别处，移动那个 SettingsSection 即可。
