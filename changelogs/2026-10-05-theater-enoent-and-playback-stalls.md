# 剧场：下载 ENOENT 全挂 + 短剧库残留治理（1 分钟回收 + 一键清空）

**日期**：2026-10-05 23:3x
**涉及 commit**：`ad8676e8` `3c400953`（App 侧）｜短剧库源码另编 `juku_darwin_arm64`
**短剧库源码改动**：`/Users/caijia/Desktop/短剧库/src/internal/app/ui_playback.go`

## 改了什么

### App 侧

1. **修下载全挂（ENOENT）** — 下载前先用 `writeFile` 写一个 0 字节占位文件把目录顶出来。
2. **去掉「点一下出控制条」提示**（用户不要）。
3. **429 时给「清空播放位」按钮** — 点一下清空电脑上所有播放位并自动重试。

### 短剧库侧（重新编译装上了）

4. **残留超时 10 分钟 → 1 分钟**（`playbackIdleTimeout`）。
5. **新增 `{"action":"closeAll"}`** — 一键关掉所有播放会话。

## 动了哪些文件

- `utils/dramaTheater/localVideos.ts` —— 占位文件顶目录
- `utils/dramaTheater/relayClient.ts` —— `clearAllOnlinePlayback()` + 429 文案
- `apps/TheaterApp.tsx` —— `busyStall` 状态 + `clearStallsAndRetry`
- `components/dramaTheater/PlayerStage.tsx` —— 「清空播放位」按钮、去掉提示
- `短剧库/src/internal/app/ui_playback.go` —— `playbackIdleTimeout` + `closeAllPlaybacks()`
  + `handlePlaybackControl` 里加 closeAll 分支

## 踩坑 / 需要知道的（重要）

### 1. 我上一轮的判断错了：`downloadFile` 不建目录

上一轮写「`recursive: true` 顺带把父目录建好（`FilesystemPlugin.java:104-114`）」
——**那是 `writeFile` 的代码，不是 `downloadFile` 的**。真机 23:23 全军覆没：

```
第 N 集没存成: Error downloading file:
  /data/user/0/.../files/theater/<剧名>/001.mp4: open ENOENT
```

真实情况：
- `Filesystem.java:349`（downloadFile）：`getFileObject` 之后**直接开写**，不管目录
- `FilesystemPlugin.java:111`（writeFile）：
  `fileObject.getParentFile().exists() || (recursive && ...mkdirs())`
- `Filesystem.java:135-137`（rename/copy）：目标父目录不存在直接抛
  `"The parent object of the destination does not exist"`

**整个插件里只有 `writeFile` 会建目录。**

### 2. 也不能用 `mkdir` 预建

`Filesystem.java:80-85`：目录已存在照样抛 `DirectoryExistsException`。
而任何原生 reject 都会被 Capacitor 打上 `console.error`
（`@capacitor/core/dist/index.js:137`）→ 状态栏红条。
所以「先判断再 mkdir」在 Capacitor 这套 API 上是**做不到**的 ——
判断本身（`stat`/`readdir`）找不到文件时也会 reject。

**用的办法：先用 `writeFile` 写一个 0 字节占位文件把目录顶出来。**
`data: ''` 走 `Base64.decode("")` → 0 字节文件，但 `recursive: true` 把
`theater/phone/<剧名>/` 一路建好了 —— 那才是我们要的。下载完删掉占位文件。
全程零报错、零内存占用。

### 3. 闪退这件事，我上轮说得太绝对了

暮色问「之前一起下载整部也没闪退啊，现在怎么一集就爆了？」——**问得对，我上轮的说法过头了**。

日志原文：

```
Failed to allocate a 74064696 byte allocation
  with 25165824 free bytes and 41MB until OOM,
  target footprint 250356472, growth limit 268435456
```

注意 `25165824 free bytes`（只剩 24 MB）和 `target footprint 250356472`（已占 250 MB）。
**所以不是「单集太大」，是内存里本来就快满了。**整部能下完，是因为当时还扛得住；
攒到哪一集炸是随机的。上轮写的「一集就炸，跟大小基本无关」应该是
「这条路迟早炸，攒到就炸」。

结论不变（base64 大文件这条路不能走），但**「之前能下完」和「早晚会炸」不矛盾**，
上轮把它们说成对立的是我不对。

### 4. 「首页又不能播放」不是版本问题

查下来是名额被占满。占用的是**我自己测试脚本**留下的残留 ——
后台任务被 runtime 中途杀掉，`close` 那一步没发出去，攒了 3 个。

实测（重启清空后）：

```
连开 4 个：200 200 200 200          ← 干净
全部归还后再连开 4 个：200 200 200 200  ← 归还是有效的
```

App 侧归还是好的。但这也说明**残留能堵死所有人，而用户没有任何手段清理**。

### 5. 为什么之前 4 个名额也会 429

**429 跟名额够不够无关，跟「有没有还回去」有关。**

`7af5c2c2` 之前，App 切集时只断了自己的网络流，**没告诉短剧库「这条不要了」**。
短剧库那边会话还挂着（`ui_playback.go:273` 建会话时起 10 分钟的定时器）。
切 4 集就攒满 4 个 → 第 5 次直接 429。**等于自己占满了自己。**

现在每集切走/退页都立刻发 `{"action":"close"}`，实测归还即时生效。

### 6. 短剧库这次的两处改动和实测

**残留超时 1 分钟**（原来 10 分钟）：

```
开了个会话什么都不做：
  第 10 秒  HTTP 200  还在
  第 30 秒  HTTP 200  还在
  第 55 秒  HTTP 200  还在
  第 80 秒  HTTP 410  已被自动回收   ← 生效
```

1 分钟安全：正在播的会话持续拉流会 `touchPlaybackLocked()` 续期，不会被踢。

**一键清空**（`{"action":"closeAll"}`）：

```
先塞满 4 个：200 200 200 200
一键清空：  {"closed":4,"ok":true}
清空后再开：200 200 200 200      ← 生效
```

实现细节：`closeAll` 分支放在 `requirePlaybackOwner` **之前** ——
它清的就是「忘了关的」那些，那些不属于任何具体请求的 viewer，按 session 查会直接 410。
安全性靠 `readPlaybackRequest` 里的 `playbackRequestAllowed`（同源检查）兜住。

### 7. App 侧的「清空播放位」只在用户点了才执行

**会连带把电脑网页版正在看的也断掉**（共用这 4 个名额）。
所以不能自动清 —— 自动清等于擅自替用户关别人的播放。

### 8. 短剧库旧二进制已备份

`dist/juku_darwin_arm64.bak-20261005`。要回退就把备份改回原名再重启。

## 备注

- SullyOS `origin/master` 全程没动，仍是 `ef17e1aa`。
- 短剧库重启过多次，实测**下载记录 1126 条零丢失**（落盘在
  `src/data/ui-state.json` 的 `tasks`/`taskOrder`，只有播放会话是内存的）。
- 装新版前确认过 0 个任务在忙（482 success + 644 paused）。
- 名额 4 个本身没动 —— 按「电脑看一部 + 手机看一部」够用。
  真正卡人的是默认 `MaxVideoTranscodes: 1`（转码并发只有 1）。
  要调的话改 `src/data/playback-settings.json` 重启即生效，不用编译。
- **已知没解决**：在线 `playback/stream` 忽略 HTTP `Range`（回 200 不是 206），
  拖进度条不准。第 3 步取帧不受影响。
