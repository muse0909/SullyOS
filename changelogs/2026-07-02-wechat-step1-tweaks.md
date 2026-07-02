# WeChat Step 1 调整 — 仿微信壳对齐

**日期**：2026-07-02  
**涉及 commit**：`0b157ff`

## 改了什么

暮色对 Step 1 的反馈 6 项 + 1 项额外，逐条落地：

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 三 Tab（消息 / 发现 / 我）放在最底下 | WeChat Tab bar 从顶部移到 `absolute` 固定底部 + safe-area-inset-bottom 适配 iOS |
| 2 | 联系人卡片左右留白大一点 | `px-3` → `px-5`，卡片之间 `space-y-2` → `space-y-3` |
| 3 | 聊天页返回按钮去掉白圈，只留小箭头 | 嵌套 Chat 的左上角返回按钮：`w-9 h-9 rounded-full bg-white/85 backdrop-blur-sm shadow-md` → `p-2 透明 + 5x5 箭头`，z-index 30 保证叠在 Chat onClose 之上 |
| 4 | 联系人页面顶部"消息" → "联系人"，左上角加返回 launcher | header 中央标题改为"联系人" + 左上角按钮 closeApp 回桌面 |
| 5 | "我" tab 直接接 UserApp 内容 | `tab === 'me'` 时渲染 `<UserApp />`，全局 import UserApp |
| 6 | API 切换悬浮窗图标改成 Wi-Fi 信号 | `ApiQuickFloat` 浮球图标 Gear → WifiHigh（Phosphor 的 Wifi 满信号） |
| 7 | 黄箭头指的咖啡色图标 | 那是 ChatHeaderShell 顶栏的 ChatMusicPlayer，跟 WeChat 无关 — 见踩坑 |

## 动了哪些文件

- `apps/WeChat.tsx` —— 重构
  - 删除顶部 Tab，移到 `absolute bottom-0` 固定
  - header 改造：左返回 + 中"联系人" + 右齿轮
  - `MessagesTab` 留白 `px-5 py-3 space-y-3`
  - 嵌套 Chat 时的左上角返回按钮改为透明 + 5x5 箭头
  - "me" tab 直接 `<UserApp />` 嵌入

- `constants.tsx` —— 撕掉桌面"档案"入口
  - 删除 `{ id: AppID.User, name: '档案', icon: 'User', color: 'blue' }` 一行

- `components/os/ApiQuickFloat.tsx` —— 浮球图标
  - import：`Gear` 保留 + 加 `WifiHigh`
  - 浮球 SVG：`<Gear size={20} weight="bold" />` → `<WifiHigh size={20} weight="bold" />`

**PhoneShell.tsx 未动**（见下方踩坑第 3 条）

## 踩坑 / 需要知道的（重要）

1. **保留 ChatHeaderShell 顶栏 `<ChatMusicPlayer />` 没动** — 它是音乐播放控件（独立功能），跟通讯录页回归的视觉克制感没关系。暮色若要也去掉，那是另一个工作量（涉及 Chat Music Player 全局功能决策）。先观望暮色反应。

2. **左上角"两套返回"目前共存的视觉补丁**：WeChat 的返回按钮 `absolute left-2 top-2` 跟 ChatHeaderShell 自己的 `absolute left-3 top-1/2` 在左上同一区域 — WeChat 的 z-index 30 高，Chat 自己 onClose 不可点。视觉上"只有一个"返回箭头，点了回联系人列表。如果未来想"返回"图标绝对唯一，需要改 ChatHeaderShell（违反 Chat.tsx 不动约定），暂不处理。

3. **黄箭头指的图标不是 GlobalMiniPlayer**：之前我误读 PhoneShell 的渲染条件。其实 line 483 已经 `activeApp !== AppID.Chat`，所以 GlobalMiniPlayer 在 Chat app（现在走 WeChat）里**已经不渲染**。截图里那个咖啡色图标是 `<ChatMusicPlayer />` —— Chat 顶栏右侧的音乐播放小图标，是 Chat.tsx 内部组件，跟 WeChat 没关系。**PhoneShell.tsx 没有改动需求**。

4. **UserApp 在 "我" tab 的二级导航**：UserApp 自带 header（h-20 + 标题"个人档案" + 左上 closeApp）。它在 WeChat 内容区里嵌套，header 跟 WeChat 顶部 header 形成"两层"。视觉上是 WeChat 顶部"联系人" → 内容区"个人档案" → 底部 Tab。UserApp 的 closeApp 按钮直接回桌面（即退出整个 WeChat）。暮色若觉得两层 header 累赘，下一轮可以把 UserApp 自带 header 去掉，只保留表单内容。

5. **档案桌入撕了要保留的可逆性**：仅从 `INSTALLED_APPS` 数组删除 `AppID.User` 一行 → Launcher 不再渲染该 icon。`AppID.User` 枚举 + `UserApp.tsx` 都还在，未来要恢复桌面入口只需加回那行。这是 soft delete，无副作用。

## 接下来 — 等暮色确认

- 视觉布局：Tab 在底 / "联系人"标题 / 留白加大 / 返回按钮干净 — 对得上预期？
- "我" tab 看到 UserApp 档案页面，跟之前桌面打开时的体验一致？
- API 悬浮浮球图标换成 WiFi 满信号 — 跟聊天设置齿轮明显区分开？
- 黄箭头（咖啡色 ChatMusicPlayer）要不要也去掉？

如果都 OK，下一轮开始搞"发现"页（朋友圈 + 收藏 + 日记）。

## 备注

- 这次没改 Chat.tsx / PhoneShell.tsx，资产 hash 仍变了（`index-yMz-p-oc.js` → `index-CjdAICz5.js`），runtime 包含改动。
- WeChat.tsx 引入了 UserApp → UserApp.tsx 进 bundle。下一步上"发现"页时如有重叠组件可以再优化。
