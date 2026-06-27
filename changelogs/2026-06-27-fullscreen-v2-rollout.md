# FullScreenEditor v2 切换 + 见面 app 同步

**日期**：2026-06-27  
**涉及 commit**：
- `200c7bf` feat(fullscreen): v2 编辑器设置持久化 + 删底部按钮
- `3a37a77` feat(fullscreen): FullScreenInput 删底部三个按钮
- `7d793e3` feat: 5 个 app 全屏输入切到 v2 + JournalApp 移除触发按钮
- `d210a06` fix(fullscreen): 设置预览固定显示"输入消息···"，不再显示输入框内容
- `36dfa0f` feat(date): 见面 app 全屏输入同步 v2（FullScreenInput → FullScreenEditor）

## 改了什么
- **FullScreenEditor v2** 完成：删底部三个按钮（取消/发送/完成），改回顶部返回即保存
- **设置自动持久化**：背景图 / 遮罩 / 字体大小 / 字体颜色 → localStorage，下次打开自动恢复
- **FullScreenInput 也对齐**：删底部三个按钮（保留 `onClose` / `onSend` 接口兼容旧调用方）
- **JournalApp**：去掉 FullScreenInput 触发按钮（日记不需要）
- **5 个 app 切到 v2**：角色编辑（Character）、神经链接（MemoryPalace）、世界书（Worldbook）、写歌（Songwriting）、日志（MemoryArchivist）
- **见面 app（DateSession）同步 v2**：`FullScreenInput` → `FullScreenEditor`
- **预览区域修正**：设置预览里**固定显示"输入消息···"**，之前会 echo 输入框全部内容（这个之前漏改过——暮色提出后修复）

## 动了哪些文件

### 组件
- `components/common/FullScreenEditor.tsx` —— v2 主实现；预览区显示"输入消息···"占位
- `components/common/FullScreenInput.tsx` —— v1 适配：删底部按钮，保留接口（兼容旧引用）
- `components/common/`（如有新增 FullScreenEditor v2 配套）—— 顶部返回即保存

### App 接入
- `apps/Character.tsx` —— 切到 v2
- `apps/MemoryPalaceApp.tsx` —— 切到 v2
- `apps/WorldbookApp.tsx` —— 切到 v2
- `apps/SongwritingApp.tsx` —— 切到 v2
- `apps/JournalApp.tsx` —— 移除 FullScreenInput 触发按钮
- `apps/DateApp.tsx`（或 DateSession 子模块）—— 切到 v2
- `components/character/`、`components/handbook/`、`components/chat/` 中涉及 MemoryArchivist / 神经链接 / 写歌 编辑器入口的—— 切到 v2

### 误改已恢复
- `apps/VoiceDesignerApp.tsx` —— 之前被误改了 `rows={2}` → `rows={4}`，**已 `git restore` 回 HEAD**

## 踩坑 / 需要知道的（重要）

### 1. 之前窗口"已读乱回"导致误改
- 暮色原本只想说"全屏输入设置里的预览改大一点"
- 之前的窗口误把 `apps/VoiceDesignerApp.tsx` 里的"试听预览 textarea" 从 2 行改成 4 行
- **lesson**：听暮色描述时，涉及**多个相似 UI 区域**时，要主动确认"你说的是 A 区域还是 B 区域"——不要默认猜
- 这个误改已通过 `git restore` 解决，但说明全屏输入的"设置预览"和"VoiceDesigner 的试听预览"在视觉上容易混淆

### 2. 预览区会 echo 输入框内容（已修）
- v2 的设置预览原本**会显示当前输入框里的全部文字**——这是设计缺陷，不是暮色要的
- 暮色要的是：**预览只展示样式效果**（背景图 / 遮罩 / 字号 / 颜色），文字固定占位
- **修复方案**：预览里固定显示 `输入消息···`
- **新约定**：以后改 FullScreenEditor 预览区时，**永远不要 echo 用户输入**

### 3. FullScreenInput vs FullScreenEditor（v1 vs v2）
- **v1（FullScreenInput）**：有底部"取消/发送/完成"三个按钮
- **v2（FullScreenEditor）**：顶部返回即保存，无底部按钮
- v1 **不删**（接口兼容），但新功能统一用 v2
- 见面 app（DateSession）**之前漏切 v2**——暮色提出后已补（commit `36dfa0f`）
- **下次改全屏相关代码前先 `grep` 一下到底引用的是哪个**，避免漏

### 4. 公开组件改了 = 多个 app 同时改
- FullScreenEditor 是**共用组件**——预览区改一行，**5+ 个 app 同时生效**（聊天/见面/群聊/角色/世界书/写歌/神经链接/日志）
- 改完**不需要**逐个 app 改引用，但要明确告诉暮色"这会全局生效"

## 备注
- 之前的"v1 vs v2 切换"不完整问题已修复（见面 app 补上）
- 后续如果还有 app 引用 FullScreenInput，可一次性全切 v2；当前保留 v1 主要是怕漏改
- Vercel 自动部署地址：`sully-os-git-preview-muse0909s-projects.vercel.app`（每次部署带 hash）
- 暮色说"OK 了非常完美"——本次任务收尾，等下一波指令
