# 云端备份快捷入口放到悬浮窗（第 5 个 section）

**日期**：2026-07-21  
**涉及 commit**：`6ea22e8`

## 改了什么
- 暮色要"在悬浮球里加一个云端备份的快捷方式"——直接在 `ApiQuickFloat.tsx` 现有 4 个 section 后面追加第 5 个 section
- 折叠状态 subtitle 显示**最近备份时间** / `未配置` / `从未备份`——一眼看到上次备份到什么时候
- 展开后：状态条（已连接 WebDAV / GitHub / 未配置提示）+ 一键备份按钮
- 默认走 `text_only` mode（纯文字，几秒搞定），不搞 mode 选择——想备份图片去 Settings 选完整模式
- 进度反馈走 `OSContext.cloudBackupToWebDAV` 内部的 `setSysOperation`（项目级进度条），不在悬浮窗里重复显示
- 成功/失败 toast 也在 context 内部 `addToast` 处理，悬浮窗里只管触发

## 动了哪些文件
- `components/os/ApiQuickFloat.tsx` —— +79 / -2
  - line 2: import 加 `CloudArrowUp` 图标
  - line 12: `QuickPresetKind` type 加 `'cloudBackup'`
  - line 134-147: `useOS()` 解构加 `cloudBackupConfig, cloudBackupToWebDAV`
  - line 211: 加 `cloudBackingUp` state（防重复点击）
  - line 421-446: 加 `isCloudBackupConfigured` 判断 + `formatCloudBackupSubtitle` 时间格式化 + `handleCloudBackup` 一键触发
  - line ~1060: 在识图 QuickSection 后面加新的云端备份 QuickSection，配色 `bg-teal-50`

## 踩坑 / 需要知道的
- **配色策略**：现有 4 个 section 已经用 emerald（API / 副 API）、violet（生图）、sky（识图），新增用 **teal** 区分——teal 在 emerald 和 sky 之间，独特不撞色
- **配置判断**：webdav 走 `webdavUrl + username + password` 三件套，github 走 `githubToken + githubOwner` 两件套——任一满足就算已配置
- **没配置时按钮 disabled**——避免用户点了失败也摸不着头脑（错误 toast 虽然会出，但用户不知道为啥失败）
- **恢复操作不放进悬浮窗**——恢复是危险操作（覆盖本地数据），让用户走 Settings 更稳妥，符合"危险操作走 Settings"的常规设计
- **不在悬浮窗里搞 mode 选择**——`text_only` 覆盖 90% 场景，加 toggle 反而让"快捷"变"复杂"

## 备注
- 这次改动**纯加法**，没动现有 4 个 section 的任何代码，影响面只在 `ApiQuickFloat.tsx` 自己
- 跟之前两个未完成话题无关：
  - Opus 4.6 报错（已确认是上游 model 行为变化，Sonnet 4.6 正常）—— 待暮色测完再聊
  - ccmax 分组切换 model 后的实际使用体感
- 下次加 section 时可以参考本文件配色：teal-50/100/200/500 — 还剩 rose/fuchsia/amber 没占（其实 amber 已经被"未配置"提示条占了）
