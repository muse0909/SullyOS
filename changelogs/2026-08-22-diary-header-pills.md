# 2026-08-22 日记顶栏胶囊 + 相册 chip 简化

## 改了什么

### JournalApp 日记列表顶栏
- 顶栏数字 "5" 改成两个胶囊：`[暮色：xx] [江澈：xx]`
  - 暮色胶囊 = 暮色自己写的 exchange 日记数（`d.source !== 'char-only'`）
  - 江澈胶囊 = 江澈自己写的 char-only 日记数（`d.source === 'char-only'`）
  - 暮色/江澈 都用 `userProfile.name` / `selectedChar.name` 动态取
- 字体 `text-[10px]` 偏小，胶囊样式 `px-2.5 py-0.5 rounded-full`
- 暮色胶囊底色 `bg-white/20`，江澈胶囊底色 `bg-indigo-500/40`（跟"让他写一篇"按钮的紫色呼应）

### JournalApp 顶栏空档
- 顶栏 `pt-12` (48px) 改 `pt-3` (12px)
- 状态栏由 PhoneShell 渲染（40px 高度），app 内部重复避让导致江澈名字行离状态栏 88px
- 改完后名字行贴近状态栏，保留 12px 呼吸感
- 第一行 `mb-4` 改 `mb-3`（按钮行跟着上移）

### Gallery 相册顶栏 chip
- 顶栏两个 chip 去掉"用户"和"AI"标签前缀
- 改前：`用户:暮色 536` / `AI:江澈 0`
- 改后：`暮色 536` / `江澈 0`
- 暮色名字用 `userProfile.name`，江澈名字用 `characters.find(c => c.id === activeCharId)?.name`

## 为什么

暮色 8-22 22:00 反馈图1日记顶栏右边那个数字"5"不知道是什么，看着突兀。改成双方各多少的形式，胶囊样式更直观。

暮色同时反馈"江澈名字上面还有个悬浮球那么大的空档"——`pt-12` 跟状态栏重复避让。改 `pt-3` 让名字贴近状态栏。

暮色 8-22 22:00 反馈图2相册 chip 上的"用户"和"AI"标签多余——chip 本身就是 tab，加标签反而冗余。

## 涉及文件

- `apps/JournalApp.tsx:707-737` 顶栏重写
- `apps/Gallery.tsx:611, 617` chip 文本

## 验证

- build 通过
- 图1 顶栏：返回 + 江澈（贴近状态栏） / 暮色:xx 江澈:xx（两个胶囊）/ [+写今天的日记] [+让他写一篇]
- 图2 chip：`暮色 536` / `江澈 0`（无前缀）
