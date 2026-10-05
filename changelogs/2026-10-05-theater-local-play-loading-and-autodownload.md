# 剧场：本地视频播不了 / 加载图难看 / 区域塌陷 / 播在线剧让电脑自动下载

**日期**：2026-10-05
**涉及 commit**：`84e90d8f`（上一轮 `7af5c2c2` 修 429 归还会话 + 红条）

## 改了什么

1. **手机里的视频能播了** — `phoneEpisodeUri()` 改走 `Capacitor.convertFileSrc()`，
   同时删掉「整集读成 base64 → atob → Blob」那条兜底。
2. **加载界面换掉** — 黑底白字 + 4px 细进度条 → 浅色圆角卡片 + 描边转圈 + 加粗百分比。
3. **视频区域不再塌陷** — `max-h-[42vh]` → `h-[42vh]` + `object-contain`，
   加载中和播放完高度完全一样。
4. **429 换成说人话** — 不再只丢一个 HTTP 码，而是告诉用户「等 10 分钟 /
   重启短剧库 / 先关网页版那个剧」。
5. **进出剧场归还旧会话** — `theater_open_sessions` 记账，
   `reclaimStaleSessions()` 在 `pingRelay` 通过后调一次。
6. **播在线剧时电脑顺手下载** — 流起来之后调 `POST /api/ui/download`，
   播放页顶部一条 6 秒自动消失的提示说清楚进度在电脑上。

## 动了哪些文件

- `utils/dramaTheater/localVideos.ts` —— `phoneEpisodeUri()` 改用 `convertFileSrc`
- `utils/dramaTheater/relayClient.ts` —— 会话账本 + `requestComputerDownload()`
  + 429 文案
- `apps/TheaterApp.tsx` —— 接线 reclaim / 自动下载 / 提示条；
  `onMediaError` 不再做 base64 兜底
- `components/dramaTheater/PlayerStage.tsx` —— 固定高度 + 新加载层 + 新错误层

## 踩坑 / 需要知道的（重要）

### 1. `file://` 在这个项目里一定被拒，别再绕

`capacitor.config.json` 的 `androidScheme` 是 `https`，WebView 的 origin 被设成
`https://localhost`。页面里直接塞 `Filesystem.getUri()` 给的 `file://` 属于跨源，
内核不放行 —— 这就是「这个本地地址播不了」的真身。

正解是 `Capacitor.convertFileSrc(uri)`，官方给这个场景的转换，同步、不碰磁盘。

**原来那套 base64 兜底为什么也失败**：一集 11.9 MB，base64 之后是 ~16 MB 字符串，
`atob` 要一个字符一个字符解，安卓 WebView 上不是卡死就是直接失败。
所以现在**不要**再把大视频转 base64 塞进 JS 内存。

### 2. `max-h` 不是高度，未加载时容器就是 0

`max-h-[42vh]` 只给了上限。`<video>` 在 `loadedmetadata` 之前没有固有高度，
容器塌成 0，所以「正在加载」时看到一条细线，加载完又猛地撑开，中间还跳一下。

视频区域要**固定高度 + `object-contain`**，这样两种状态一样高。

### 3. `playback/prepare` 对在线剧是死路（白查了一轮）

网页版的「边播边下」不是 `playback/prepare` 能解决的：

- `handlePlaybackPrepare`（`ui_playback_collection.go:180`）会校验
  `input.Episode > len(session.downloadIDs)` 就回 400
- 而按 `dramaId` 开的会话，`downloadIDs` 是 **nil**
  （`ui_playback.go:273`，只有走 `taskId` 的合集分支才会填）

所以对在线剧**必然 400**。短剧库根本没有单集下载接口，
唯一能用的是 `POST /api/ui/download`，粒度是**整部**
（handler `ui_server.go:1111` → `enqueueDramasAsync`）。

⚠️ `readDownloadRequest` 用了 `DisallowUnknownFields`，
body 只能有 `ids` 和 `quality` 两个字段，多传一个就 400。

### 4. 429 的名额只有 4 个，close 真能还回来（实测）

`MaxSessions: 4`（`playback_resources.go:39`），闲置 10 分钟才回收
（`ui_playback.go:17`）。电脑网页版在播也占名额。

实测（短剧库 8998 → 转发 8999）：

```
连开 4 个：200 / 200 / 200 / 429     ← 当时有 1 个残留
关掉 3 个后再开 1 个：200            ← close 确实还名额了
再关干净后连开 3 个：200 / 200 / 200  ← 没有残留了
```

**所以现在电脑上是干净的，4 个名额全空。**

想立刻清残留有两条路：

- **等 10 分钟** —— 什么都不用做，闲置超时会自己收
- **重启短剧库** —— 会话表 `app.playbacks` 是纯内存的，重启即清零；
  **但下载任务表也是纯内存的**（全项目没找到落盘），重启会让
  「在电脑里」的那些标记消失、正在下的任务中断。
  刚下完一批、准备重测的时候再重启最划算。

### 5. 手机这条路能通，靠的是转发服务剥头

短剧库自己的来源检查很严（`ui_playback.go:107-121`）：
`Sec-Fetch-Site` 必须是 `same-origin`/`none`/空，`Origin` 必须和 `Host` 同源，
否则 403。

手机页面在 Vercel 上、请求发往 `http://192.168.0.102:8999`，本来是铁定的跨站。
能通是因为转发服务 `STRIP_FROM_REQUEST`（`relay.py:48`）把
`origin` / `sec-fetch-site` / `referer` / `host` 全剥了，再换成自己领的
viewer cookie。

⚠️ **转发服务不能改这个白名单行为**，一改整个剧场就连不上了。

## 备注

- `origin/master` 全程没动，仍是 `ef17e1aa`。
- 测试包不用重打：测试 App 的 WebView 加载远程部署，Web 端改动直接推分支就生效。
- **已知没解决**：在线 `playback/stream` 实测忽略 HTTP `Range`（回 200 不是 206），
  所以拖进度条目前不准，要改用接口的 `start` 参数。第 3 步取帧不受影响。
- 本轮实测在电脑上触发了《180万之征地风云》的整部下载任务
  （`9e1e50f473df649e`），手机上的自动下载会走同一条路。
- 第 2 步 Live 仍暂停，未获允许不开始。
