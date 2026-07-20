# 云端备份快捷入口放到悬浮窗（仿 Settings 精简版）

**日期**：2026-07-21  
**涉及 commit**：`6ea22e8`（初版 / 一键版，已被推翻）+ `ffc222c`（最终版 / 完整云端备份页）

## 改了什么

### 终版（`ffc222c`）：仿 Settings 云端备份页的精简版

暮色要"在悬浮球里加一个云端备份的快捷方式"——**第一版做错了**（理解成"一键纯文字备份"按钮）。暮色反馈后，**重做成跟 Settings 那个云端备份页 1:1 对齐的精简版**：

- 状态条：已连 GitHub/WebDAV（带 animate-pulse 绿点）+ 右上角「去设置」跳转入口
- 2 个并排按钮：轻量同步（sky 色，1-3MB） + 完整（violet 色，含图片/美化）
- 1 个大按钮：从云端恢复（emerald 色）
- 恢复弹窗：仿 Settings — 列文件 + 点选直接调 `cloudRestoreFromWebDAV`，**不二次确认**（跟 Settings 行为一致）
- 配置 modal 留 Settings 里改（悬浮窗「去设置」按钮跳过去）
- 折叠状态 subtitle 显示最近备份时间 / 未配置 / 从未备份

### 初版（`6ea22e8`，已弃）：一键纯文字备份按钮

- 折叠看状态，展开只有一个「立即备份（纯文字）」按钮
- 暮色反馈后被 `ffc222c` 覆盖

## 动了哪些文件

- `components/os/ApiQuickFloat.tsx` —— +194 / -31（净 +163 行）
  - imports：加 `CloudArrowDown` 图标 + `AppID` / `CloudBackupFile` 类型
  - `useOS()` 解构：加 `cloudRestoreFromWebDAV, listCloudBackups, openApp`
  - state：加 `cloudBackingMode`（替 boolean）/ `showCloudRestoreModal` / `cloudBackupFiles` / `cloudRestoring`
  - handlers：4 个（`handleCloudBackupWithMode` / `handleOpenCloudRestore` / `handleCloudRestoreFile` / `handleOpenCloudSettings`）
  - JSX：第 5 个 QuickSection（云端备份）+ 恢复 Modal
  - 配色 `bg-teal-50` 跟现有 4 个 section 区分
- `AGENTS.md` —— 索引行从"一键备份"改成"仿 Settings 精简版"

## 踩坑 / 需要知道的（重要）

### 1. 第一版做错是典型的"过度简化"

暮色说"快捷方式"我理解成"快速触发按钮"——但他实际要的是**完整 UI 页面**（仿 Settings 那个云端备份页）。

**教训**：暮色口中的"快捷方式/入口"常指**"完整 UI 副本"**，不是"简化版"——因为：
- 备份恢复是"用一次就完事"的功能，不需要简化
- 简化版反而让用户多走一步跳转
- 完整 UI 副本（即使占地方）更符合他的"开盖即用"工作流

下次听到"X 放到悬浮球里"先确认范围——是 **A. 一键触发** 还是 **B. 完整 UI 副本**？默认按 B 问一句"要不要仿 Settings"。

### 2. 跟 Settings 行为完全对齐是关键

- 恢复 modal：点文件**直接调** `cloudRestoreFromWebDAV`——Settings 那里没二次确认，我也不加
- 状态条用 emerald-50 / `animate-pulse` 绿点——跟 Settings 一致
- 配色 sky-500（轻量）+ violet-500（完整）+ emerald-500（恢复）——跟 Settings 那边 icon 颜色对应

暮色审美非常在乎"两个地方 UI 一样"——只要对齐，他就觉得舒服。

### 3. 恢复操作不在 Settings 里加二次确认 = 跨设备一致性

Settings 的「从云端恢复」modal **没二次确认**（line 2080 直接 `onClick={() => handleCloudRestore(file)}`）。我在悬浮窗里也照搬——保持一致。

如果以后想加二次确认，**两个地方一起加**（不要只在一处加），避免行为漂移。

### 4. 「去设置」跳转 = openApp(AppID.Settings) + setShowPanel(false)

悬浮窗里没有"关闭面板"按钮的标准 API，但 `setShowPanel(false)` 是 state setter 直接调。**一定要在跳走前关面板**——否则打开 Settings 之后悬浮窗还在悬浮着，遮 UI。

`openApp` 来自 `useOS()` 解构，AppID 从 types.ts enum 取（`AppID.Settings = 'settings'`）。

## 备注

- 这次改动**纯加法 + 替换**（撤销第一版 JSX、写新版 JSX），没动现有 4 个 section 的代码
- emoji bug 修复**未做**（暮色还在选 A/B/C 修法）：
  - A. 软删除（治本，但 schema 改动）
  - B. text_only 模式不导入 emoji（最暴力，一行代码）
  - C. 加 lastModified 字段（治标）
- 暮色倾向 B（治本 + 改一行），等确认后开第二个 commit
- 跟 Opus 4.6 报错的事已经闭环：上游 model 行为变化，Sonnet 4.6 正常出回复
- 跟 IndexedDB VersionError 闭环：DevTools 清 ActiveMsg DB 即可，聊天数据不丢
