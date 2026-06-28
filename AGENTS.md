# AGENTS.md — SullyOS 项目协作指南

> 给 AI 助手（OpenCode / Cursor / Codex / Aider …）看的"项目说明书"。
> 任何新会话开工前先读这个，再去翻 `progress.md`（历史变更）和 `changelogs/`（每次任务的报告）。

---

## 0. TL;DR（30 秒读完）

- **项目**：SullyOS（fork 自 NMJ 的 SullyOS / 手抓糯米机），一个跑在小手机里的 AI 角色生活模拟器
- **目标用户**：暮色（Android，开发者 + 用户）和琪琪（iOS，用户）
- **测试方式**：不要 `npm run dev` 本地跑——暮色只看 Vercel 部署链接。改完 → `git push origin preview` → Vercel 自动部署
- **仓库**：`muse0909/SullyOS`（origin = 暮色 fork，upstream = 原作者 NMJ）
- **当前分支**：`preview`（开发都在这里；测完才合 `master`）
- **worktree 约定**：**根目录 `/Users/caijia/Desktop/SullyOS-master` 就是 preview 分支**，不要切分支、不要 worktree，直接在根目录改

---

## 1. 项目是啥

一个 **React + Capacitor 的 AI 小手机模拟器**，界面是拟物化的"手机"（PhoneShell），里面有 30+ 个 app（聊天、见面、世界书、朋友圈、写歌、日记、股票、小红书、画廊…），每个 app 是一个完整的功能模块，通过顶层 `App.tsx` + `Launcher.tsx` 路由。

**核心特性：**
- 角色卡系统（Character）+ 世界书（Worldbook）→ 拼成 LLM prompt
- 聊天/见面/群聊/电话 走同一个 worker API（云函数）
- 所有数据 localStorage 持久化（个别 app 走 Netlify Blobs / Neon DB）
- 节日活动系统（情人节、白色情人节、Like520…）
- 像素房间 / 像素人生 Sim 等小游戏

**硬编码服务（不要乱动）：**
- Worker URL：`sullymeow.ccwu.cc`（主）、`noir2.cc.cd`（备）—— 已迁到自定义域名，国内可直连

---

## 2. 技术栈

| 层 | 选型 |
|---|---|
| 框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| 移动壳 | Capacitor 6（**只 Android**）—— iOS 端走 PWA / Web 部署 |
| 路由 | 自研（无 react-router，状态机式切换） |
| 样式 | Tailwind-like 内联 className 为主（**不是**纯 Tailwind 配置文件） |
| 图标 | `@phosphor-icons/react` |
| 后端 | Netlify Functions（`api/`、`netlify/`）+ Neon Postgres + Netlify Blobs |
| 实时 | `@rei-standard/amsg-*`（WebSocket 推送） |
| 推送 | `web-push` |

**读 `package.json` 是 ground truth，不要靠记忆里的版本号。**

---

## 3. 目录速查

```
SullyOS-master/
├── App.tsx                    # 顶层壳：路由 + 全局 context
├── index.tsx                  # 入口
├── index.html                 # 入口 HTML（含 Tailwind CDN 引用）
├── capacitor.config.json      # Android 打包配置
├── apps/                      # ★ 所有功能 app（30+ 个 .tsx）
│   ├── Chat.tsx               # 线上聊天（最核心）
│   ├── DateApp.tsx            # 见面 app（暮色高频改动）
│   ├── JournalApp.tsx         # 日记
│   ├── SongwritingApp.tsx     # 写歌
│   ├── WorldbookApp.tsx       # 世界书
│   ├── MemoryPalaceApp.tsx    # 神经链接 / 记忆宫殿
│   ├── VoiceDesignerApp.tsx   # 声音设计
│   ├── XhsFreeRoamApp.tsx     # 小红书自由模式
│   ├── XhsStockApp.tsx        # 小红书股票
│   └── ... 其余
├── components/                # 共用 UI 组件
│   ├── chat/                  # 聊天相关（MessageItem、ChatInput…）
│   ├── common/                # 通用（按钮、模态、Tab…）
│   ├── os/                    # 系统级（PhoneShell、StatusBar…）
│   └── ... 按主题分
├── context/                   # React Context（全局状态）
├── hooks/                     # 自定义 hooks
├── api/                       # Netlify Functions（云端 API）
├── server/                    # 本地开发用 Node 服务
├── netlify/                   # Netlify 配置 + Functions
├── scripts/                   # 构建/数据脚本
├── notes/                     # 专题调研笔记（背景保活、Minimax T2A…）
├── progress.md                # ★ 历史变更日志（2026-03 之前都在这）
├── changelogs/                # ★ 每次任务的报告（从这里开始写新报告）
└── docs/                      # 其他文档
```

**找代码规则：**
- "全屏输入"组件 → `components/common/FullScreenEditor.tsx`（v2）或 `FullScreenInput.tsx`（v1，已废弃但保留接口兼容）
- 设置 UI → `components/settings/`
- 角色 / 世界书编辑器 → `components/character/`、`components/handbook/`
- 节日活动 → `components/*Event.tsx`

---

## 4. 开发约定

### 4.1 Git 工作流
1. 在 `preview` 分支改
2. 一次任务 = 一次或多次 `git commit`，commit message 用中文 feat / fix / refactor 前缀
3. 推到 `origin preview`，**不要**主动 push 到 `master`
4. Vercel 会自动部署 preview 分支到 `sully-os-git-preview-muse0909s-projects.vercel.app`
5. 暮色在 Vercel 链接上测，测好他手动合 master / 提 PR

### 4.2 Commit 归属 lesson（重要）
- 暮色不同 commit 用过不同 `user.name`（`muse0909` / `maimai`）
- **不要**根据 commit author 推断"是谁做的"
- 不确定归属 → **直接问暮色**

### 4.3 代码风格
- 函数组件 + Hooks，**不要 class**
- 命名：组件 PascalCase，函数/变量 camelCase，常量 UPPER_SNAKE
- 状态管理优先 `useState`/`useReducer`，跨组件才上 Context
- **不要**瞎引入新库——用 `package.json` 里已有的；缺什么先问暮色
- 改共享组件前先 `grep` 一下所有引用点
- 编辑后跑 `npm run build` 确认通过（**不**跑 dev）

### 4.4 全屏输入 / 编辑器
- 新代码一律用 `FullScreenEditor`（v2）
- `FullScreenInput`（v1）保留是因为旧代码还在引用，不要硬删，**只在新功能用 v2**
- 改 v2 的设置项（背景图、遮罩、字体大小、字体颜色）→ 这些已 localStorage 持久化，**保持键名稳定**
- 预览里**固定显示"输入消息···"**，不要 echo 输入框内容

---

## 5. 设计偏好（暮色审美）

> 这是暮色反复强调的，**有强迫症级别**的偏好。改动 UI 前先把这节过一遍。

### 5.1 总体调性
- **简洁、干净、清新**——不要花哨的阴影/渐变/动画
- **浅色马卡龙色系**为主（薄荷绿、淡粉、奶油黄、淡蓝、浅紫…）
- 圆角、**胶囊按钮**（不要方角、也不要纯文字按钮）
- 留白要够，元素别挤

### 5.2 对齐
- **大部分元素需要居中**——底部按钮、标题、卡片标题、图标 + 文字组合
- **左右对齐要严格**——文本基线、icon 中心、padding 一致
- 暮色会主动指出"丑" / "不整齐" / "歪了"——**主动自查对齐再交付**

### 5.3 按钮
- **统一胶囊样式**（`rounded-full` + 浅色背景 + 居中文字）
- 取消/关闭按钮也用胶囊，**不要**光秃秃的"×"
- 底部按钮**居中**，不要 right 对齐
- 主操作按钮颜色要突出（但仍保持马卡龙范围）

### 5.4 全屏类组件
- 全屏输入/编辑器：高度 85vh（暮色要求上下拉长）
- 顶部返回即保存（v2 删了底部按钮）
- 预览区只显示样式效果（背景图/遮罩/字号/颜色），文字固定占位

---

## 6. 部署 & 调试

### 6.1 部署
- **代码改动** → `git push origin preview` → Vercel 自动部署
- Vercel URL: `sully-os-git-preview-muse0909s-projects.vercel.app`（每次部署地址会带 hash）
- 暮色在 Android（Chrome）上直接打开链接测
- 琪琪在 iOS（Safari）上测——iOS Safari 兼容性要注意

### 6.2 已知问题
- **不开梯子时空回/慢**（关梯子几百秒或空回，正常 30 秒）—— 2026-06-27 暂放，临时方案是用中转站 API
- iOS 软键盘弹起时的 `100vh` 问题（Capacitor WebView 已知坑）—— 用 `Portal` + safe-area 适配

### 6.3 调试
- 暮色**不**本地跑 dev——所有调试都靠 Vercel 部署链接
- 真要本地复现：`npm run dev`，但暮色不这么干
- 云函数日志看 Netlify dashboard

---

## 7. 用户

| 角色 | 系统 | 用途 |
|---|---|---|
| 暮色（owner） | **Android** | 开发者 + 主要用户，自己测 |
| 琪琪 | **iOS** | 共同使用，主要在 iOS Safari 上体验 |

> 暮色用 Android 开发+测试，琪琪用 iOS Safari 用——两端都要考虑兼容性，但**主要回归在 Android 暮色自己手上**。

---

## 8. 报告机制（每次任务必做）

**每次完成一个功能/修复后，必须建一份报告：**

`changelogs/YYYY-MM-DD-<short-name>.md`

格式模板：

```markdown
# <一句话标题>

**日期**：YYYY-MM-DD  
**涉及 commit**：`hash1` `hash2` …

## 改了什么
- 功能/修复点 1
- 功能/修复点 2

## 动了哪些文件
- `path/to/file.tsx` —— 简述
- `path/to/another.tsx` —— 简述

## 踩坑 / 需要知道的（重要）
- 这里写"如果不写下来下次还会踩"的点
- 隐藏的依赖、未解决的副作用、临时的 workaround
- 暮色特意强调的"这个别忘了"

## 备注
- 未完成 / 下次再说的事
- 跟其他功能的耦合
```

**规则：**
- **不要写流水账**——只写"为什么"和"踩了什么坑"
- commit hash 必填，方便 `git show` 反查
- 一天多个任务 → 多个文件，按时间或主题命名
- **报告完成后在本文件"9. 最近报告"加一行索引**

---

## 9. 最近报告（索引）

| 日期 | 标题 | 报告文件 |
|---|---|---|
| 2026-06-28 | 心声弹窗贴顶修复（createPortal 绕开 ChatHeader backdrop-filter） | [`changelogs/2026-06-28-buff-popup-portal-fix.md`](./changelogs/2026-06-28-buff-popup-portal-fix.md) |
| 2026-06-28 | 表情包编辑名字+排序 / 聊天输入框自动撑高 1→5 行 | [`changelogs/2026-06-28-emoji-edit-reorder-chat-input-grow.md`](./changelogs/2026-06-28-emoji-edit-reorder-chat-input-grow.md) |
| 2026-06-28 | 全屏按钮入框 / 外观预览固定顶部 / 气泡工坊重排 | [`changelogs/2026-06-28-input-appearance-thememaker-tweaks.md`](./changelogs/2026-06-28-input-appearance-thememaker-tweaks.md) |
| 2026-06-28 | 气泡工坊 toggle 改版：白球不带字 + 字一直在底 + 不变颜色 + 整体缩短 | [`changelogs/2026-06-28-thememaker-toggle-redesign.md`](./changelogs/2026-06-28-thememaker-toggle-redesign.md) |
| 2026-06-28 | 心声配色：LLM 选色 → 马卡龙 djb2 哈希（已确认算法工作正常） | [`changelogs/2026-06-28-buff-color-macaron-llm-pick.md`](./changelogs/2026-06-28-buff-color-macaron-llm-pick.md) |
| 2026-06-28 | 心声卡片背景不透明 + 时间字加深 | [`changelogs/2026-06-28-buff-card-opacity-and-time-bold.md`](./changelogs/2026-06-28-buff-card-opacity-and-time-bold.md) |
| 2026-06-28 | 心声弹窗卡片化（贴顶列表 → 居中卡片） | [`changelogs/2026-06-28-buff-popup-card-redesign.md`](./changelogs/2026-06-28-buff-popup-card-redesign.md) |
| 2026-06-28 | preview → master 合并 16 commits（merge `f7eaa05`） | — |
| 2026-06-28 | 心声 buff 配色改回 LLM 选色 + 马卡龙色盘兜底 | [`changelogs/2026-06-28-buff-color-macaron-llm-pick.md`](./changelogs/2026-06-28-buff-color-macaron-llm-pick.md) |
| 2026-06-27 | FullScreenEditor v2 切换 + 见面 app 同步 | [`changelogs/2026-06-27-fullscreen-v2-rollout.md`](./changelogs/2026-06-27-fullscreen-v2-rollout.md) |
