# 音乐 app 抄 miya：去登录墙 + 首页发现区 + 一起听 tab

**日期**：2026-08-01
**涉及 commit**：（待 commit）

## 改了什么

暮色发现 miya 的音乐功能比 sully 好用，对比了 3 个差距：

1. **登录墙**：sully 一进音乐 app 就被扫码登录页挡住；miya 不登录就能搜歌/听免费歌/看推荐
2. **首页内容**：miya 进去就能看到「快速发现/飙升榜/新歌榜/热搜词」；sully 进去是空状态（"搜一首想听的歌吧"）
3. **一起听 tab**：miya 有专门的"一起听"tab + "去拜访音乐角落"；sully 没有

这一轮先做 1+2+3 的基础结构（"一起听"先做壳，视觉对比待下一轮讨论）。

## 动了哪些文件

- `apps/MusicApp.tsx` —— 默认 view 从 `profile` 改 `search`；`renderSearch` 加发现区（热搜词 pill / 官方榜单 2x2 / 推荐歌单横滑）；加 `renderListen` 一起听 view（2 步：选同伴 + 选歌 + 拜访入口）；加 4 tab 底部 bar（首页/搜索/一起听/我的）
- `apps/music/NeteaseProfilePage.tsx` —— 移除 `if (!cfg.cookie || !profile)` early-return 跳登录面板；改为内嵌"未登录"卡（点击才打开登录面板）；user 卡 / tabs / 歌单 / 最近 / 云盘 → 已登录才显示
- `context/MusicContext.tsx` —— `musicApi` 补 2 个方法：`personalized`（推荐歌单）和 `searchHot`（热搜词），不需登录；worker 白名单早已放行 `/personalized` 和 `/search/hot`

## 踩坑 / 需要知道的

- **TS 严格模式开启但 vite build 不做类型检查**——line 415-417 的 `profile.playlistCount` 等用法在 isLoggedIn=true 块内，TS 不知道已保护，build 不报错但类型不安全。下次手痒可以加 `!`。
- **登录入口放哪**——按暮色确认放在"我的"页顶部"未登录"卡（不是设置页）。设置页里原本就有 MUSIC_U 输入框，三种登录方式都保留。
- **一起听是简化版**——只做"选角色 + 选歌"两步，**没**做 miya 那种"AI 自动选歌"的仪式感。暮色说"对比一下区别再继续讨论"——这一轮的视觉跟 sully 现有 `listeningTogetherWith` 状态结合（在 mini player 显示小头像），不是全新设计。
- **tab 顺序**——暮色拍板：首页 / 搜索 / 一起听 / 我的。首页和搜索暂时共用 search view（一期简化），未来可拆。

## 待办（下一轮）

- 第 4 个点：一起听的视觉跟 miya 详细对比（暮色说要先看图对比再决定要不要改）
- 把首页和搜索拆成两个独立 view（一期简化共用，未来可分）
- 个人 API 备胎（miruis.top）— 这是上一轮讨论的，跟这一轮独立，未动
