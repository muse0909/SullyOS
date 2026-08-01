# 音乐 app 反馈第 2 轮：4 个 UI 修复（tab 顺序 / 封面图 / 图标排列 / 播放页占位）

**日期**：2026-08-01
**涉及 commit**：（待 commit）
**依赖**：`2026-08-01-music-miya-features.md`（上一轮的基础结构）

## 改了什么

暮色在 Vercel 预览上测完上一轮反馈 4 个问题，逐个修：

1. **tab 顺序调整**：第 1 个 tab 从"首页"改成"播放"（进 player view 全屏播放页）
2. **播放页占位**：未在播时不再 `return null`（之前是空），现在给"未在播放 · 去找首歌"占位 + 跳搜索 tab 按钮
3. **官方歌单封面图修复**：`toplist` 接口真实字段是 `coverImgUrl` 不是 `cover`——之前用错字段导致空方块
4. **快速发现改图标排列**：横滑大卡（每张 128px）改成 3 列 grid（每张 aspect-square，80-100px 圆角矩形）

## 动了哪些文件

- `apps/MusicApp.tsx` —— tab 顺序 + 播放 tab 图标改 SVG + 播放页占位 + 快速发现 grid 化 + toplist 字段修正
- `context/MusicContext.tsx` —— 上一轮已加，本轮未动

## 踩坑 / 需要知道的

- **`/toplist` 接口字段名不是 `cover` 也不是 `picUrl`，是 `coverImgUrl`**。验证时一定要 curl 看真实返回，不能想当然。
- **player view 之前是 `if (!current) return null`**——这个写法在 player 只从 mini player 进入时是 OK 的（没在播不会进），但现在 player 变成 tab 1 必须能进入，所以加了占位 UI。
- **tab 1 是"播放"而不是"首页"**——暮色想 tab 顺序是 `播放 / 搜索 / 一起听 / 我的`，把发现区（推荐+榜单+热搜词）放"搜索" tab 顶部。**搜索 tab 兼具 miya 那个"首页"（发现+搜索合一）的功能**。

## 待办

- 一起听讲解（暮色说"没搞明白怎么用"——下一轮专门讲，不在这轮做）
- 一起听视觉对比 + 是否要改（暮色之前说"再继续讨论"）
