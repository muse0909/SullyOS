# 剧场：下载闪退根因（原生 74MB 分配穿顶）+ 高度按比例 + 播时藏控制条

**日期**：2026-10-05 23:0x
**涉及 commit**：`69871625`（上一轮 `84e90d8f`）

## 改了什么

1. **修下载闪退** — 下载改走 `Filesystem.downloadFile`（原生自己下），不再「取回内存 →
   转 base64 → 写文件」。
2. **视频区域高度按比例** — 改回自适应，横屏剧不再上下出黑边；比例记本地，
   加载页和播放页高度一致。
3. **播起来 3 秒后控制条自动藏** — 点画面才出来，底下留提示。
4. **「这个本地地址播不了」改成延迟判定** — 误报时什么都不显示。
5. **删掉「点播放自动让电脑下载」** — 用户说边下边播够用，不加了。

## 动了哪些文件

- `utils/dramaTheater/localVideos.ts` —— 新增 `downloadEpisodeToPhone()`
- `utils/dramaTheater/relayClient.ts` —— 删 `requestComputerDownload()`，导出 `localVideoUrl`
- `apps/TheaterApp.tsx` —— 下载走新接口 + 集内字节进度、删自动下载、错误延迟判定
- `components/dramaTheater/PlayerStage.tsx` —— 比例高度、自动隐藏控制条、`onMediaReady`

## 踩坑 / 需要知道的（重要）

### 1. 闪退是 Java 侧内存爆，不是 JS 报错

`adb logcat -b crash` + `dumpsys dropbox data_app_crash` 拿到的原始栈：

```
Process: com.aetheros.simulator.amsgtest
Timestamp: 2026-10-05 22:30:12.994+0800
Crash-Handler: org.chromium.base.JavaExceptionReporter

java.lang.OutOfMemoryError: Failed to allocate a 74064696 byte allocation
  with 25165824 free bytes and 41MB until OOM,
  target footprint 250356472, growth limit 268435456
	at java.lang.StringUTF16.newBytesFor(StringUTF16.java:50)
	at java.lang.AbstractStringBuilder.append(...)
	at com.getcapacitor.Bridge.callPluginMethod(Bridge.java:815)
	at com.getcapacitor.MessageHandler.callPluginMethod(MessageHandler.java:149)
```

拆开就是：**一集 11.9 MB → base64 变 ~16 MB 字符串 → 交给原生写文件时 Java 侧
`StringBuilder` 再拼一遍（UTF-16 一次 74 MB 分配）→ WebView 256 MB 上限穿顶。**

- `growth limit 268435456` = 256 MB，是 WebView 的 JS heap 上限。
- 栈里出现 `Bridge.callPluginMethod` 是关键标志：**只要原生在往网页传大字符串，
  就一定会经过这里**，而这条路上不存在「大一点也能扛」。

⚠️ **所以「大视频先转 base64 再写文件」这条路要整个废掉，不是调参能救的。**
`saveEpisodeToPhone(blob)` 现在只留给「用户自己上传的视频」用
（那个视频本来就在手机上，内存占用是它自己的，不额外放大）。

### 2. 正解是 `Filesystem.downloadFile`

Capacitor 5.1+ 提供的原生下载：**原生自己发 HTTP 请求、自己写文件**，
JS 侧只递一个 URL 字符串过去，内存占用是常数级。

- `recursive: true` 顺带把父目录建好
  （`FilesystemPlugin.java:104-114` 内部 `getParentFile().mkdirs()`），
  所以也**不用先 mkdir** —— 那个会因目录已存在而 reject 出红条。
- 进度：调用前 `Filesystem.addListener('progress', cb)`，
  事件是 `{ url, bytes, contentLength }`。
  ⚠️ Android 实现里 emitter 是**无条件注册**的（不看 `progress` 参数），
  所以回调里要按 `url` 对一下，别把别的下载的进度算到这一集头上。
- 下完时 `contentLength` 就是文件真实大小 → 正好用来写索引里的 `size`。

### 3. 高度不是「固定 vs 自适应」，是「知不知道比例」

上一轮拍成固定 `h-[42vh]`，横屏剧（16:9）就上下出黑边了 ——
因为固定高度比自然高度高，多出来的部分只能是黑的。

真正的因果是：**`<video>` 在元数据读出来之前没有固有高度**，
不知道宽高比就没法把容器撑对。解决顺序是「先知道比例」：

- 比例存 `localStorage` 的 `theater_ratio`（按剧名，只留最近 30 部）
- 容器 `aspectRatio: 比例` + `maxHeight: 42vh/64vh`
  → 宽度撑满 ÷ 比例 = 自然高度，横屏自然就矮、竖屏顶到 42vh，不会有黑边
- `loadedmetadata` 拿到真实 `videoWidth/videoHeight` 就写进去
- **同一部剧所有集比例一样**，所以第一次播完记住之后，
  之后进播放页加载页和播放页高度完全一致、零跳变

### 4. 「这个本地地址播不了」是误报

真机 22:56 暮色的截图里，这句话明明白白写着，同一集**其实在正常播**
（另一张图 1:11/1:11 走着）。`error` 事件在安卓 WebView 上会误报 ——
换 src 时的中间态、或 `convertFileSrc` 那个地址被内核先拒一次再自己重试成功，
都会打 error。

所以改成**延迟判定**：报错先记下，3 秒内 `canplay`/`playing` 来了就当没发生
（什么都不显示）；3 秒过去还起不来才真的提示。
「用户看到『播不了』却发现它在播」比没提示更糟。

### 5. 纠正上一轮报告的一个错误结论

上一轮写「重启短剧库会让下载记录消失，代价很大」——**是错的**。
我当时没找到任务落盘的代码就下了结论。

实测（重启前后各拉一次 `/api/ui/tasks` 对比）：

```
重启前 1126 个任务 → 重启后 1126 个任务
丢了 0 个，多了 0 个
《180万之征地风云》重启后还在：45 集，状态 {'success'}
《仙君他断情绝爱》重启后还在：39 集，状态 {'success'}
```

落盘位置：`src/data/ui-state.json`（顶层就有 `tasks` 和 `taskOrder` 两个键）。

**结论：重启短剧库只清内存里的播放会话，下载记录一个都不丢。**
所以重启就是「立刻清干净」的最优解，没有代价。

### 6. 「关掉就断」本来就是这样，10 分钟只是兜底

`closePlayback(id)`（`ui_playback.go:385`）是立即删会话的，手机每次切集/切剧/退页
都会立刻发 `{action:'close'}`。实测也验证了：关掉 3 个之后立刻又能开。

`playbackIdleTimeout = 10 * time.Minute`（`ui_playback.go:17`）**只管「忘了关的」**那些：
app 被系统杀掉、来不及 close 的。没有它那些会永久占着。

至于名额 `MaxSessions: 4`：那是「同时能开几个流」，跟「关掉要不要等」是两码事。
它是**设置项**，范围 1-64，落盘在 `src/data/playback-settings.json`
（`playback_resources.go:44` 校验范围，`:70` 启动时读），
改这个文件重启即生效，不用改代码不用重编译。
默认配套里真正卡人的其实是 `MaxVideoTranscodes: 1`（转码并发只有 1）。

## 备注

- `origin/master` 全程没动，仍是 `ef17e1aa`。
- 测试包不用重打：测试 App 的 WebView 加载远程部署，Web 端改动推分支就生效。
- **已知没解决**：在线 `playback/stream` 忽略 HTTP `Range`（回 200 不是 206），
  拖进度条不准。第 3 步取帧不受影响。
- 本轮把上一轮那个会「点一下就整部下」的自动下载删掉了 —— 那条本来就要电脑开着、
  且粒度只有整部，收益不如代价。
