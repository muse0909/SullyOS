# 悬浮窗云端备份 3 个 UI 反馈修复

**日期**：2026-07-21（凌晨追加）  
**涉及 commit**：`fdac8bf`

## 改了什么

暮色 01:45 反馈 3 个问题，逐个修：

### 1. 加载弹窗没出来

**根因**：`cloudBackupToWebDAV` / `cloudRestoreFromWebDAV` 内部 `setSysOperation({ status: 'processing', ... })` 触发项目级状态，但**这个 UI 只在 Settings 页面渲染**（`apps/Settings.tsx:1314`）—— 悬浮窗 / PhoneShell 都没监听。

**修法**：`useOS()` 解构加 `sysOperation, setSysOperation`；在 ApiQuickFloat 里加 z-[130] 全屏进度弹窗（仿 Settings 那个 — spinner + 进度条 + message）。

**已知副作用**：现在 Settings 触发的备份会让两份弹窗同时显示（Settings 自己的 + 悬浮窗的）。短期可接受，下次重构可以挪到 PhoneShell 根级渲染一份，把 Settings 那份删掉统一。

### 2. 点完整备份时轻量同步按钮跟着变暗

**根因**：2 个按钮都用 `disabled:opacity-50 disabled:cursor-not-allowed` —— 任意 mode 备份中**两个按钮都强制 50% 透明**。但只有当前 backup 的按钮显示"备份中..."文字，所以另一个按钮看起来"光暗不显示文字"——暮色感觉"过几秒也跟着暗下去"。

**修法**：2 个按钮改成 map 渲染，三态：
- **自己 backup 中**：`bg-highlight` + `cursor-wait` + 显示"备份中..."
- **别人 backup 中**：`bg-white` + `text-slate-300` + `cursor-not-allowed`（**不强制 opacity-50**，白底但浅灰文字 + cursor 提示不可点）
- **正常**：`bg-white` + `text-slate-600` + `active:scale-95`

这样视觉上"自己高亮、别人白底浅灰文字"，符合暮色审美（不强制半透明）。

### 3. 恢复按钮重影

**根因**：modal 遮罩 `bg-black/40` 透明度太浅，**底层 section 透过来**，看起来"恢复按钮叠在另一个恢复按钮上"。

**修法**：
- 遮罩 `bg-black/40 backdrop-blur-sm` → `bg-black/60`（跟 Settings 全局进度弹窗一致，不透明）
- 加载状态加 `border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin` spinner —— 暮色原话"我以为没管用呢"，所以加载状态视觉要明显

## 动了哪些文件

- `components/os/ApiQuickFloat.tsx` —— +58 / -26
  - `useOS()` 解构加 `sysOperation, setSysOperation`
  - 2 个备份按钮改成 map 渲染（修变暗问题）
  - 恢复 modal 遮罩 40→60 + 加 spinner（修重影）
  - 新增 z-[130] 全屏进度弹窗（修加载弹窗没出来）

## 踩坑 / 需要知道的

### 1. sysOperation 弹窗是项目级状态，但只有部分页面监听

`sysOperation` 是 OSContext 里的全局状态，**任何** cloudBackup 操作都会改它。但**渲染**这个弹窗的代码散落在不同页面（Settings 渲染了，其他页面没渲染）。

**修法选项**：
- A. 当前方案：每个用云端备份的页面自己监听渲染（重复代码）
- B. **更好**：在 PhoneShell 根级加一份，删掉 Settings 自己的 — 单一来源，所有页面都能看到
- C. 独立组件 `<GlobalProgressOverlay />` 挂到 PhoneShell 根

下次有空可以重构。短期 A 方案能用，但 Settings + 悬浮窗会同时弹两份。

### 2. 2 个备份按钮改成 map 的好处

之前 2 个按钮几乎一样代码（只是 mode + label + iconColor 不同），复制粘贴两份。改成 map 渲染：
- 代码 -50%
- 三态逻辑（自己/别人/正常）只写一遍
- 以后再加第 3 个备份 mode 不用复制代码

### 3. 遮罩透明度"跨场景统一"很重要

| 场景 | 透明度 | 用途 |
|---|---|---|
| 60% | 遮罩 | 进度弹窗、恢复 modal、删除确认 modal — **不可让底层透过来** |
| 40% | 轻遮罩 | 轻量提示（toast 风格的轻提示） |
| 20% | 极轻 | hover / 状态切换 |

暮色审美"对齐强迫症"——同一类遮罩应该统一透明度，不要有的 40% 有的 60% 混用。

## 备注
- 之前 commit `ffc222c` 是初版"完整云端备份页"（仿 Settings 精简版）
- 这次 commit `fdac8bf` 是 UI 反馈修复（3 个问题）
- emoji bug 还在等暮色选 A/B/C 修法
