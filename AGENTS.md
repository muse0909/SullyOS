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
- 所有数据 localStorage 持久化（个别 app 走 Cloudflare R2 / Neon DB）
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
| 后端 | Vercel Functions（`api/`）+ Neon Postgres + Cloudflare R2 |
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
├── api/                       # Vercel Functions（云端 API）
├── server/                    # 本地开发用 Node 服务
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

### 5.5 弹窗 / Modal 标准（暮色 2026-07-02 拍板，2026-07-03 修正高度策略）

**所有新弹窗默认按 `components/os/Modal.tsx` 的视觉规格统一**，不要再各弹各的。这条是为了避免"心声弹窗一种圆角、API 浮窗又一种圆角 / 这个大那个小"的混乱——**暮色 2026-07-02 反馈 API 弹窗、心声卡片改过很多次，明确要求一刀切**。

**修正历史**：
- 2026-07-02 初版：宽度 + 圆角 + **高度 `h-[80vh]` 一刀切**
- 2026-07-03 暮色反馈"同步完看到好多弹窗都是底下很大的空白，不好看"——改为**宽度 + 圆角统一，高度自适应**（最高 80vh）

```
容器（最外层）
  fixed inset-0
  z-[100]                           ← 或按需调高（ApiQuickFloat 用 z-[110] 因为是 floating 工具）
  flex items-center justify-center
  p-6                               ← 给卡片留左右上下呼吸
  animate-fade-in

背景遮罩
  absolute inset-0 bg-black/40      ← 不加 backdrop-blur，与项目级 Modal 一致

卡片（统一规格）
  relative
  w-full max-w-sm                   ← max-width 24rem (384px) — 宽度统一
  bg-white
  rounded-[2.5rem]                  ← 40px 大圆角，项目标配
  shadow-2xl
  border border-white/20            ← 浅白描边
  overflow-hidden
  animate-slide-up
  max-h-[80vh]                      ← ⚠️ 最高 80vh（不是 h，是 max-h）；高度根据内容自适应
  flex flex-col                     ← 内部 flex 布局，让 body 撑开
  mx-auto                           ← 水平居中兜底（避免 max-w 失算）
```

title：`shrink-0` + `px-6 pt-6 pb-2` + `text-center text-lg font-bold text-slate-800`
body：`flex-1 min-h-0 overflow-y-auto no-scrollbar`（**没有 max-h**；flex 自然撑开；超过卡片 max-h 时内部滚动）
footer：`shrink-0` + `px-6 pb-6 flex gap-3`（无 footer 时显示默认"关闭"按钮）

**核心原则（2026-07-03 修正版）**：
- **统一**：所有弹窗卡片 **`max-w-sm` (384px) + `rounded-[2.5rem]` (40px) + `max-h-[80vh]`** + `flex flex-col` + `overflow-hidden`
- **自适应**：卡片**高度根据内容撑开**，内容少的弹窗自动变矮（不再"4 个尺寸"）
- **不超 80vh**：内容超出 80vh 时 body 内部滚动，footer 始终在底部
- **所有内部结构**：title `shrink-0` + body `flex-1 min-h-0 overflow-y-auto` + footer `shrink-0`
- **折叠/展开一律在卡片内部完成**——不创建新弹窗、不撑大整个面板
- `openSection` 状态保留用户上次选择，**关掉再开还是同一个 section 展开**
- API 弹窗等"内容多"的弹窗，**默认打开第一个 section**（避免初始全折叠→点开→撑大的视觉跳变）

**例外**：微信式心声弹窗 / 圆角较小的轻量确认弹窗可以用 `rounded-3xl + w-[min(88vw,360px)]`，那是另一种风格，但需要暮色明确认可才用。

**为什么是 `max-h-[80vh]` 不是 `h-[80vh]`**：
- `max-h` 让卡片高度 = 内容高度（**自适应**）
- 内容超过 80vh 时 body 内部滚动，**不撑爆屏幕**
- `min-h-0` 在 body 上是 flex item 的常见 fix，避免内容超过容器时无法缩小

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
- **`backdrop-filter` 会吃 `position: fixed`**（Chromium 完整实现 spec，Safari 实现行为不一致）—— 任何 fixed 弹窗的祖先链有 `backdrop-filter` / `transform` / `filter` / `perspective` 等任一属性时，弹窗应用 `createPortal` 挂到 `document.body`，否则 Android Chrome 上定位会乱，Safari 可能看着"正常"误导判断。详见 `changelogs/2026-06-28-buff-popup-portal-fix.md`

### 6.3 调试
- 暮色**不**本地跑 dev——所有调试都靠 Vercel 部署链接
- 真要本地复现：`npm run dev`，但暮色不这么干
- 云函数日志看 Vercel dashboard（`api/` 下的 functions）

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
| 2026-07-22 | 收藏页清理：关掉「语音数据已丢失」toast 堆叠 + 取消语音自动加入收藏 | [`changelogs/2026-07-22-favorites-voice-cleanup.md`](./changelogs/2026-07-22-favorites-voice-cleanup.md) |
| 2026-07-22 | 私密记事 — 第五轮：改名"小纸条" + 自定义样式方案 B + 文字居中避盖图 | [`changelogs/2026-07-22-privatenotes-round5.md`](./changelogs/2026-07-22-privatenotes-round5.md) |
| 2026-07-22 | 私密记事 — 第四轮：时间戳+回复贴右下角 + prompt 加 emoji/颜文字 | [`changelogs/2026-07-22-privatenotes-round4.md`](./changelogs/2026-07-22-privatenotes-round4.md) |
| 2026-07-22 | 私密记事 — 第三轮：修 userProfile 报错 + 输入框交互改造 | [`changelogs/2026-07-22-privatenotes-round3.md`](./changelogs/2026-07-22-privatenotes-round3.md) |
| 2026-07-22 | 私密记事 — 第二轮（位置 + prompt 通用化 + 输入框间距）| [`changelogs/2026-07-22-privatenotes-prompt-round2.md`](./changelogs/2026-07-22-privatenotes-prompt-round2.md) |
| 2026-07-22 | 私密记事 — UI 4 bug 修复 + prompt 改造 + 自定义入口 | [`changelogs/2026-07-22-privatenotes-ui-and-prompt.md`](./changelogs/2026-07-22-privatenotes-ui-and-prompt.md) |
| 2026-07-22 | 在线状态样式新增「不显示」选项 | [`changelogs/2026-07-22-status-style-none.md`](./changelogs/2026-07-22-status-style-none.md) |
| 2026-07-22 | memoryLinks 每月自动修剪（30 天间隔）+ topN 50 → 70 | [`changelogs/2026-07-22-auto-prune-monthly.md`](./changelogs/2026-07-22-auto-prune-monthly.md) |
| 2026-07-22 | 生图工具 description 收紧（默认不调，仅三种情感场景放行） | [`changelogs/2026-07-22-imagegen-tool-description-tighten.md`](./changelogs/2026-07-22-imagegen-tool-description-tighten.md) |
| 2026-07-22 | 多选复制退出 / 调试终端复制 JSON 反馈 / 清空日志关弹窗 | [`changelogs/2026-07-22-multiselect-and-debug-terminal-ux.md`](./changelogs/2026-07-22-multiselect-and-debug-terminal-ux.md) |
| 2026-07-20 | 云端同步（多端互通）—— 电脑手机共享聊天记录 + 记忆宫殿 | [`changelogs/2026-07-20-cloud-sync-multi-device.md`](./changelogs/2026-07-20-cloud-sync-multi-device.md) |
| 2026-07-22 | 主动消息 Claude 协议 400 修复 + 诊断 log（仿 useChatAI 7/17 协议兼容）| [`changelogs/2026-07-22-proactive-claude-protocol-400.md`](./changelogs/2026-07-22-proactive-claude-protocol-400.md) |
| 2026-07-21 | memoryLinks 支持按节点 topN 修剪 — 清理历史累积的稠密关联图 | [`changelogs/2026-07-21-memory-links-topn-prune.md`](./changelogs/2026-07-21-memory-links-topn-prune.md) |
| 2026-07-21 | 主动消息 runProactive 改用 safeFetchJson — 修中转站 502 假象 CORS bug | [`changelogs/2026-07-21-proactive-uses-safefetch.md`](./changelogs/2026-07-21-proactive-uses-safefetch.md) |
| 2026-07-21 | 主动消息加 1 分钟测试档（之前最小 30 分钟） | [`changelogs/2026-07-21-proactive-1min-test-option.md`](./changelogs/2026-07-21-proactive-1min-test-option.md) |
| 2026-07-21 | 云端同步默认不启动 — 停止自动打 ping（手动模式） | [`changelogs/2026-07-21-cloud-sync-stop-autoping.md`](./changelogs/2026-07-21-cloud-sync-stop-autoping.md) |
| 2026-07-21 | 轻量同步 2 个覆盖 bug 修复（text_only 模式跳过 user profile / emoji） | [`changelogs/2026-07-21-text-only-skip-user-emoji.md`](./changelogs/2026-07-21-text-only-skip-user-emoji.md) |
| 2026-07-21 | 记忆宫殿 memoryLinks 暴增 bug 修复（295555 → 几千，省 40 MB）+ dedup API | [`changelogs/2026-07-21-memory-links-dedup-bug.md`](./changelogs/2026-07-21-memory-links-dedup-bug.md) |
| 2026-07-21 | 轻量备份 A2 优化：archived memoryNode 不导 vector（省 50-60% vectors） | [`changelogs/2026-07-21-backup-skip-archived-vectors.md`](./changelogs/2026-07-21-backup-skip-archived-vectors.md) |
| 2026-07-21 | 轻量备份：memoryVectors base64 压缩（16M→8M）+ text_only 模式增量恢复 | [`changelogs/2026-07-21-backup-base64-and-incremental.md`](./changelogs/2026-07-21-backup-base64-and-incremental.md) |
| 2026-07-21 | 悬浮窗云端备份 3 个 UI 反馈修复（加载弹窗 / 按钮变暗 / 恢复重影） | [`changelogs/2026-07-21-cloud-backup-ui-fixes.md`](./changelogs/2026-07-21-cloud-backup-ui-fixes.md) |
| 2026-07-21 | 云端备份快捷入口放到悬浮窗（仿 Settings 精简版：3 按钮 + 状态 + 恢复弹窗） | [`changelogs/2026-07-21-cloud-backup-shortcut-in-float.md`](./changelogs/2026-07-21-cloud-backup-shortcut-in-float.md) |
| 2026-07-19 | Kimi 识图外链失败改 base64 兜底 | [`changelogs/2026-07-19-kimi-vision-base64-fallback.md`](./changelogs/2026-07-19-kimi-vision-base64-fallback.md) |
| 2026-07-19 | Kimi 识图文字块兼容 + 聊天截图顺序提取 | [`changelogs/2026-07-19-kimi-vision-text-block-and-chat-screenshot-order.md`](./changelogs/2026-07-19-kimi-vision-text-block-and-chat-screenshot-order.md) |
| 2026-07-19 | 记忆宫殿重复提取保护 | [`changelogs/2026-07-19-memory-palace-duplicate-extract-guard.md`](./changelogs/2026-07-19-memory-palace-duplicate-extract-guard.md) |
| 2026-07-18 | 纯聊天模式漏口修正 + cache 日志校准 | [`changelogs/2026-07-18-pure-mode-cache-log-fix.md`](./changelogs/2026-07-18-pure-mode-cache-log-fix.md) |
| 2026-07-18 | 纯聊天模式补齐到真省 token | [`changelogs/2026-07-18-pure-chat-mode-token-cut.md`](./changelogs/2026-07-18-pure-chat-mode-token-cut.md) |
| 2026-07-18 | Sully 专属分类长按支持删除（去 isSystem 限制） | [`changelogs/2026-07-18-sully-exclusive-category-deletable.md`](./changelogs/2026-07-18-sully-exclusive-category-deletable.md) |
| 2026-07-15 | 输入框 padding 真凶修正 + API 浮窗默认折叠 + 副 API 接入浮窗 | [`changelogs/2026-07-15-input-padding-fix-and-float-default-collapsed-and-memory-light-api.md`](./changelogs/2026-07-15-input-padding-fix-and-float-default-collapsed-and-memory-light-api.md) |
| 2026-07-17 | API 协议分支 + OpenAI 协议去掉 cache_control 字段（即享站长诊断："走 openai 接口不能加 claude 字段"）| [`changelogs/2026-07-17-api-protocol-branching-and-openai-cache-control-strip.md`](./changelogs/2026-07-17-api-protocol-branching-and-openai-cache-control-strip.md) |
| 2026-07-17 | 私密记事独立成发现页子页（阶段 1：UI 完整 + 阶段 2 待开）| [`changelogs/2026-07-17-private-notes-stage1-ui.md`](./changelogs/2026-07-17-private-notes-stage1-ui.md) |
| 2026-07-17 | 私密记事阶段 2：AI 主动写 + 定时提醒（`[[PRIVATE_NOTE:...\|type]]` token + 21:00 默认提醒）| [`changelogs/2026-07-17-private-notes-stage2-ai-writes.md`](./changelogs/2026-07-17-private-notes-stage2-ai-writes.md) |
| 2026-07-16 | innerState + realtime 挪到 messages 末尾，提升 prompt cache 命中率 | [`changelogs/2026-07-16-prompt-cache-dynamic-tail-moved.md`](./changelogs/2026-07-16-prompt-cache-dynamic-tail-moved.md) |
| 2026-07-17 | 显式 cache_control 标记，拿 1h TTL | [`changelogs/2026-07-17-explicit-cache-control-1h-ttl.md`](./changelogs/2026-07-17-explicit-cache-control-1h-ttl.md) |
| 2026-07-17 | 4 断点 prompt cache 方案（bp1 工具 / bp2 行为 / bp3 上下文 / bp4 历史） | [`changelogs/2026-07-17-prompt-cache-4-breakpoints.md`](./changelogs/2026-07-17-prompt-cache-4-breakpoints.md) |
| 2026-07-17 | Claude 协议 400 修复 — history 里 system 转 user + 末尾 6 条 system 合并到顶层 system 字段 | [`changelogs/2026-07-17-claude-protocol-system-message-400.md`](./changelogs/2026-07-17-claude-protocol-system-message-400.md) |
| 2026-07-15 | Bell toast 撑大变方形 + 输入框撑大降圆角 + 输入区 padding 缩小 | [`changelogs/2026-07-15-bell-toast-and-input-area-shape.md`](./changelogs/2026-07-15-bell-toast-and-input-area-shape.md) |
| 2026-07-15 | 聊天图片预览支持单击/双击图片退出 | [`changelogs/2026-07-15-image-preview-click-to-exit.md`](./changelogs/2026-07-15-image-preview-click-to-exit.md) |
| 2026-07-15 | 朋友圈配图简化为单 toggle + 生图 API 两处都删 ComfyUI/NAI | [`changelogs/2026-07-15-moments-image-toggle-and-provider-simplify.md`](./changelogs/2026-07-15-moments-image-toggle-and-provider-simplify.md) |
| 2026-07-15 | 聊天记录搜索 → 跳转定位（点结果滚到那条消息 + 高亮 2 秒） | [`changelogs/2026-07-15-chat-search-jump-to-message.md`](./changelogs/2026-07-15-chat-search-jump-to-message.md) |
| 2026-07-15 | 备份模式重构 — 轻量同步 + 聊天记录 .txt 导出 | [`changelogs/2026-07-15-backup-lite-and-txt-export.md`](./changelogs/2026-07-15-backup-lite-and-txt-export.md) |
| 2026-07-15 | 备份回归 bug 修复 — theme 丢失 + 头像被覆盖 | [`changelogs/2026-07-15-backup-theme-and-merge-fixes.md`](./changelogs/2026-07-15-backup-theme-and-merge-fixes.md) |
| 2026-07-15 | 删除预设 Modal 按钮加 w-full — 真正铺开（前面 4 次改 footer 容器漏了按钮） | [`changelogs/2026-07-15-delete-preset-w-full.md`](./changelogs/2026-07-15-delete-preset-w-full.md) |
| 2026-07-15 | 图床警告文案改版 + 加关闭按钮 + 去掉 truncate | [`changelogs/2026-07-15-image-bed-warning-text-revamp.md`](./changelogs/2026-07-15-image-bed-warning-text-revamp.md) |
| 2026-07-15 | 图床警告改成推系统消息进聊天流（不是固定 div）+ 顺序：图→警告 | [`changelogs/2026-07-15-image-bed-warning-as-system-message.md`](./changelogs/2026-07-15-image-bed-warning-as-system-message.md) |
| 2026-07-15 | 删未使用的 Netlify fork 残留（13 文件 + 3 文档 + 2 依赖） | [`changelogs/2026-07-15-netlify-cleanup.md`](./changelogs/2026-07-15-netlify-cleanup.md) |
| 2026-07-15 | 图床顺序调整 — 弃用 R2，imgbb 作主图床 + 'bell' 提示样式 | [`changelogs/2026-07-15-imagebed-imgbb-default.md`](./changelogs/2026-07-15-imagebed-imgbb-default.md) |
| 2026-07-13 | 保存图片走 Vercel 代理绕开跨域图床 CORS | [`changelogs/2026-07-13-image-save-proxy.md`](./changelogs/2026-07-13-image-save-proxy.md) |
| 2026-07-14 | 生图 b64 → Netlify Blobs 自动转永久 URL（解决中转站只返 b64 时的展示问题） | [`changelogs/2026-07-14-image-b64-blob-upload.md`](./changelogs/2026-07-14-image-b64-blob-upload.md) |
| 2026-07-14 | 图床升级 imgbb → Cloudflare R2（不压缩，截图字清楚）| [`changelogs/2026-07-14-image-b64-blob-upload.md`](./changelogs/2026-07-14-image-b64-blob-upload.md) |
| 2026-07-14 | R2 上传改两阶段 presign+直传（绕开 Vercel 10 秒超时） | [`changelogs/2026-07-14-r2-presign-two-stage.md`](./changelogs/2026-07-14-r2-presign-two-stage.md) |
| 2026-07-14 | r2-presign 改自写 SigV4（去掉 AWS SDK，冷启动 3-5s → <100ms） | 同上 + 后续 commit `b476c0c` |
| 2026-07-14 | 保存图片到相册 data URL 触发 proxy-image 超长 URL 失败（🟡 已登记，未修） | [`changelogs/2026-07-14-save-image-data-url-bug.md`](./changelogs/2026-07-14-save-image-data-url-bug.md) |
| 2026-07-13 | 语音收藏批量删除 + 上 Netlify Blobs 云端持久化 | [`changelogs/2026-07-13-voice-favorites-cloud.md`](./changelogs/2026-07-13-voice-favorites-cloud.md) |
| 2026-07-13 | 消息操作弹窗两列布局 + 去关闭按钮 | [`changelogs/2026-07-13-message-options-two-col.md`](./changelogs/2026-07-13-message-options-two-col.md) |
| 2026-07-12 | 主页评论项可点击 → 弹输入框（嵌套回复 replyTo） | [`changelogs/2026-07-12-moments-comment-item-clickable.md`](./changelogs/2026-07-12-moments-comment-item-clickable.md) |
| 2026-07-13 | 表情包管理页改造（删长按弹窗 + 全屏 manager + 批量移动） | [`changelogs/2026-07-13-emoji-manager-fullscreen.md`](./changelogs/2026-07-13-emoji-manager-fullscreen.md) |
| 2026-07-13 | 危险区域补回「清空保留条数」输入框（10f8c9a 拆设置时漏的） | [`changelogs/2026-07-13-restore-preserve-count-input.md`](./changelogs/2026-07-13-restore-preserve-count-input.md) |
| 2026-07-13 | 表情包管理页迭代 2（全屏化 + 5 列 + PC 鼠标拖动 + 取消按钮） | [`changelogs/2026-07-13-emoji-manager-fullscreen-and-pc-drag.md`](./changelogs/2026-07-13-emoji-manager-fullscreen-and-pc-drag.md) |
| 2026-07-12 | 列表卡片 in-page 评论输入框 + 长按进详情（仿微信） | [`changelogs/2026-07-12-moments-inline-comment-long-press.md`](./changelogs/2026-07-12-moments-inline-comment-long-press.md) |
| 2026-07-12 | 朋友圈用户评论/点赞/嵌套回复 + AI 自动回复 | [`changelogs/2026-07-12-moments-user-comments-likes-replies.md`](./changelogs/2026-07-12-moments-user-comments-likes-replies.md) |
| 2026-07-12 | 聊天页头部加发现页入口（星星按钮） | [`changelogs/2026-07-12-chat-header-discover-button.md`](./changelogs/2026-07-12-chat-header-discover-button.md) |
| 2026-07-12 | 朋友圈 autoPostByChar 语义重定义 + 删旧 useEffect 钩子 + 频率 0-100 | [`changelogs/2026-07-12-moments-autopostbychar-rewrite.md`](./changelogs/2026-07-12-moments-autopostbychar-rewrite.md) |
| 2026-07-12 | ComfyUI 选 model 同步 bug + 多胳膊防御 + checkpoint 短标签 + bridge prompt 注入 | [`changelogs/2026-07-12-comfyui-model-sync-and-multi-arms-fix.md`](./changelogs/2026-07-12-comfyui-model-sync-and-multi-arms-fix.md) |
| 2026-07-12 | 朋友圈 AI 主动发工具（仿 330 qzone.js JSON action 模式） | [`changelogs/2026-07-12-ai-moments-tool.md`](./changelogs/2026-07-12-ai-moments-tool.md) |
| 2026-07-12 | 朋友圈设置页 z-30 修复主页头像/签名/工具栏穿透 | [`changelogs/2026-07-12-moments-settings-z-index.md`](./changelogs/2026-07-12-moments-settings-z-index.md) |
| 2026-07-04 | 朋友圈 ↔ Chat Awareness 互通（Layer 1）+ 设置入口迁移到 MomentsPage 工具栏相机左边 | [`changelogs/2026-07-04-moments-chat-awareness.md`](./changelogs/2026-07-04-moments-chat-awareness.md) |
| 2026-07-04 | ChatInputArea 重复 import 修复（build 过但 dev 报错的隐藏 bug） | [`changelogs/2026-07-04-chatinputarea-dedupe-import.md`](./changelogs/2026-07-04-chatinputarea-dedupe-import.md) |
| 2026-07-04 | ComfyUI 卡片加 checkpoint 选择（RV/Pony 可手动切换） | [`changelogs/2026-07-03-comfyui-checkpoint-picker.md`](./changelogs/2026-07-03-comfyui-checkpoint-picker.md) |
| 2026-07-03 | 生图 section 重构 — 删 MCD / 3 独立卡片 / 保存即用 / 测试连接 | [`changelogs/2026-07-03-imagegen-redesign-and-test-connection.md`](./changelogs/2026-07-03-imagegen-redesign-and-test-connection.md) |
| 2026-07-03 | 生图服务加 provider 切换（OpenAI 兼容 / ComfyUI 本地 / NAI / MCD） | [`changelogs/2026-07-03-imagegen-provider-switch.md`](./changelogs/2026-07-03-imagegen-provider-switch.md) |
| 2026-07-03 | ComfyUI fp16 默认化 + Pony SDXL fp16 验证（无 NaN） | [`changelogs/2026-07-03-fp16-default-pony-validation.md`](./changelogs/2026-07-03-fp16-default-pony-validation.md) |
| 2026-07-02 | SullyOS vs orangechat 工具调用对比报告（调研） | [`changelogs/2026-07-02-orangechat-tool-calling-comparison.md`](./changelogs/2026-07-02-orangechat-tool-calling-comparison.md) |
| 2026-07-02 | ComfyUI 本地部署 + OpenAI 桥接到小手机 | [`changelogs/2026-07-02-comfyui-local-deploy-and-openai-bridge.md`](./changelogs/2026-07-02-comfyui-local-deploy-and-openai-bridge.md) |
| 2026-07-02 | Pony V6 XL 模型部署 + Apple Silicon 16GB SDXL NaN 坑 | [`changelogs/2026-07-02-pony-v6xl-deploy-and-mps-nan.md`](./changelogs/2026-07-02-pony-v6xl-deploy-and-mps-nan.md) |
| 2026-07-02 | WeChat 两个 bug 修复：联系人页 + chars 面板切换 | [`changelogs/2026-07-02-wechat-bug-fixes.md`](./changelogs/2026-07-02-wechat-bug-fixes.md) |
| 2026-07-02 | 聊天框 + / 表情包面板支持点空白处收起 | [`changelogs/2026-07-02-chat-input-panel-tap-outside.md`](./changelogs/2026-07-02-chat-input-panel-tap-outside.md) |
| 2026-07-02 | 弹窗卡片 h-[80vh] 写死一刀切 — 暮色吐槽"4 个尺寸" | [`changelogs/2026-07-02-modal-h80vh-one-size.md`](./changelogs/2026-07-02-modal-h80vh-one-size.md) |
| 2026-07-02 | API 弹窗统一到日程弹窗尺寸 (60vh) + 聊天页返回路径修复 | [`changelogs/2026-07-02-api-modal-size-and-back-path.md`](./changelogs/2026-07-02-api-modal-size-and-back-path.md) |
| 2026-07-02 | 收藏页 Header h1 `-ml-9` 覆盖 button 导致返回按钮"点着没反应" | [`changelogs/2026-07-02-favorites-header-ml9-cover-button.md`](./changelogs/2026-07-02-favorites-header-ml9-cover-button.md) |
| 2026-07-01 | 仿微信联系人页 — Step 1 框架壳 | [`changelogs/2026-07-01-wechat-step1.md`](./changelogs/2026-07-01-wechat-step1.md) |
| 2026-07-02 | WeChat Step 1 调整 — Tab 移底 / 留白 / 去白圈 / 我接档案 / 撕档案桌入 / API 换 WiFi | [`changelogs/2026-07-02-wechat-step1-tweaks.md`](./changelogs/2026-07-02-wechat-step1-tweaks.md) |
| 2026-07-02 | WeChat 嵌套 Chat 单返回修复 + API 浮窗居中 | [`changelogs/2026-07-02-wechat-once-back-and-api-centered.md`](./changelogs/2026-07-02-wechat-once-back-and-api-centered.md) |
| 2026-07-02 | 收藏页 v4 改造 + 2 个新 bug 交接（联系人页 / 切换会话） | [`changelogs/2026-07-02-favorites-v4-and-2-new-bugs.md`](./changelogs/2026-07-02-favorites-v4-and-2-new-bugs.md) |
| 2026-07-02 | Launcher widget 直跳 Chat + 项目级 Modal 标准落实 | [`changelogs/2026-07-02-widget-jump-and-modal-standard.md`](./changelogs/2026-07-02-widget-jump-and-modal-standard.md) |
| 2026-07-01 | 心声防重复 — 提示词注入最近 5 条 innerState | [`changelogs/2026-07-01-inner-state-dedup-prompt.md`](./changelogs/2026-07-01-inner-state-dedup-prompt.md) |
| 2026-07-01 | emoji-reorder modal 3 个 bug（删除 / 拖动落点 / 列表滚动） | [`changelogs/2026-07-01-emoji-reorder-3-bugs.md`](./changelogs/2026-07-01-emoji-reorder-3-bugs.md) |
| 2026-06-29 | 设置入口搬到头像右上角 + 心声 / 日程解耦 | [`changelogs/2026-06-29-chat-settings-drawer-and-emotion-decouple.md`](./changelogs/2026-06-29-chat-settings-drawer-and-emotion-decouple.md) |
| 2026-06-29 | 心声弹窗照扒日程三档配色 + 心电图 footer | [`changelogs/2026-06-29-buff-popup-macaron-and-ecg-footer.md`](./changelogs/2026-06-29-buff-popup-macaron-and-ecg-footer.md) |
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
