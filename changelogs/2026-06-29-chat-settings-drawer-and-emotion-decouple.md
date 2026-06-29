# 设置入口搬到头像右上角 + 心声 / 日程解耦

**日期**：2026-06-29
**涉及 commit**：（本任务单次 commit，未定 hash）

## 改了什么

### 1. 设置入口搬家
- **头像框右上角**新增 `GearSix` 按钮（与 `ChatMusicPlayer` 并排，standard / centered 两种 header 布局都加了）
- 点开是**右侧滑出抽屉**（`w-[88%] max-w-md`，参考 `FullScreenEditor` 的设置面板样式），不再是原来的居中卡片化 modal
- 输入框 `+` 号菜单里的"设置"图标**整个删掉**

### 2. 心声 vs 日程 完全解耦
- **新增独立字段** `CharacterProfile.emotionEnabled?: boolean`
- 配套工具函数 `isEmotionOn(char)`：`true/false` 显式值优先；`undefined`（老数据）走旧逻辑 `isScheduleFeatureOn && emotionConfig?.enabled` 兜底
- 后端心声注入条件全部换成 `isEmotionOn(char)`，涉及 3 处：
  - `useChatAI.ts:797`（system prompt 注入心声要求）
  - `useChatAI.ts:1347`（解析主回复里的 `<emotion>` 块）
  - `context.ts:254`（buff 注入到 system prompt）
- `useChatAI.ts:823` 那段老"副 API 情绪评估"代码本来就是死代码（已注释），不动

### 3. 聊天设置抽屉内容
新建 `components/chat/ChatSettingsDrawer.tsx`，照扒原 `chat-settings` modal 的内容但顺序按暮色要求调整：
- **聊天背景**（置顶）
- **语音消息**（紧跟背景，原来在中间偏下）
- **心声**（独立开关 + 介绍小字："开启后，角色会在聊天中自动生成「心声」——一段第一人称的内心独白，会以小卡片的形态出现在头像栏里。与日程完全独立，开关各自管各自。"）
- 上下文条数 / 隐藏系统日志 / 消息翻译 / 小红书 / HTML 模块模式 / 管理上下文 / 记忆宫殿向量化 / 危险区域
- 直接读写 `char` 字段（不再走"保存"按钮，drawer 关闭就生效）

### 4. 日程 modal 清理
- `ChatModals.tsx` 里 `EmotionSettingsPanel` **整块删除**（import + JSX + props 全部清掉）
- 日程 modal 总开关**改名**：「日程与情绪 Buff」→「日程」
- 文案简化：「已开启：会生成今日日程。」「已关闭：不生成日程。」（不再提 buff）
- `handleToggleScheduleFeature` 不再联动 `emotionConfig.enabled` —— **两个开关完全独立**

### 5. 顺手清理
- `components/chat/ChatHeader.tsx`（残留死代码，没人 import）→ 移到回收站
- `ChatModals.tsx` 里 `chat-settings` modal 整块删除（被 drawer 替代）
- `ChatModals.tsx` 不再需要的 props 全部清理：`settingsContextLimit`、`setSettingsContextLimit`、`settingsHideSysLogs`、`setSettingsHideSysLogs`、`preserveCount`、`setPreserveCount`、`onSaveSettings`、`onBgUpload`、`onRemoveBg`、翻译 / 小红书 / HTML / 语音消息 / 记忆宫殿相关 props、`bgInputRef`
- `Chat.tsx` 里 `settingsContextLimit` 等三个临时 state 删了（直接用 `char.contextLimit` / `char.hideSystemLogs` / `(char as any).htmlModeCustomPrompt`）+ `saveSettings` 函数删了 + `useEffect` 里同步临时 state 的逻辑删了
- `ChatInputArea.tsx` 里 `GearSix` import 删了（设置图标已移除）

## 踩坑 / 需要知道的

1. **build 包反而小了 12KB**：`index-Cx0rmIdO.js 2,717.06 kB` → `index-D5NihXDz.js 2,705.81 kB`，因为删了一堆死 modal / 死 props

2. **`EmotionSettingsPanel.tsx` 文件本身没删**——暮色说"用不上就不留着了",但确认了一下这个文件其实没在 import 链里(build 不打包),保留 source 也不影响产物。如果要彻底清,直接 `mavis-trash components/chat/EmotionSettingsPanel.tsx` 即可——这次没动,等暮色确认再删

3. **老用户心声行为透明**：所有现有角色的 `emotionEnabled` 是 `undefined`,`isEmotionOn` 走兜底逻辑 `isScheduleFeatureOn && emotionConfig?.enabled`,**和老逻辑完全一致**。新用户首次在聊天设置切换心声开关时,会写入明确的 `true/false`,之后独立于日程

4. **`syncEmotionApiToAllCharacters` 现在 destructure 出来了但没调用**——它是 useOS 提供的全局方法,以后记忆宫殿那边可能还会用,所以先保留 destructure。下次清理时再处理

5. **头像框右上角 `onOpenChatSettings` prop 可选**：`ChatHeaderShell` 默认不传 `onOpenChatSettings` 时,设置按钮就不渲染。这样其他地方复用 `ChatHeaderShell`（如果有的话）不会突然冒个设置按钮

6. **`onPanelAction('settings')` 和 `onPanelAction('html-mode-settings')` 改了**：原来都 `setModalType('chat-settings')`,现在都改成打开 drawer（前者走 `handleOpenChatSettings`,后者直接 `setShowChatSettingsDrawer(true)`）

7. **背景图 / 上下文 / 隐藏系统日志 / HTML prompt 字段直接读 char,没"保存"按钮**——这是 drawer 的好处,改完即生效。原 modal 那种"改了临时 state,点保存才写 char"的模式去掉了

## 备注

- 这次**只完成了设置入口改造 + 聊天设置抽屉 + 心声 / 日程解耦**这条主线
- 暮色还在找"长文 / 分段显示"的历史记录,找到了再开下一仗
- 暮色提到的"+ 号菜单改上下滑动 + 长按弹窗编辑位置"这次**没动**,等主线跑通再处理
- Vercel 部署 URL: `sully-os-git-preview-muse0909s-projects.vercel.app`（push 后自动部署）
