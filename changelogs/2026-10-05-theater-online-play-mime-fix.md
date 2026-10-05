# 剧场：在线剧放不出来 —— 编码标记缺失 + 转发没暴露 X-Playback-MIME

**日期**：2026-10-05 23:5x
**涉及 commit**：`da32ff56`（App 侧）｜转发服务 `relay.py` 另改（已重启生效）
**状态**：真机实测通过（画面在动，`currentTime` 走到 1.97 秒）

## 改了什么

1. **转发服务** — `Access-Control-Expose-Headers` 补全 `X-Playback-*` 全家。
2. **App 侧** — `streamOnlineEpisode` 不再兜底成裸 `video/mp4`，
   改成挑一个设备真能播的编码；全都不支持时给出人话报错。

## 动了哪些文件

- `短剧库/剧场转发/relay.py` — `cors_headers()` 的 expose 名单
- `utils/dramaTheater/relayClient.ts` — `streamOnlineEpisode()` 的 MIME 选择

## 踩坑 / 需要知道的（重要）

### 1. 现象与真因

暮色 23:43 反馈「下载和显示没问题了，但是首页还是不能播放」。

**这不能推给 429 残留。** 连进手机 WebView 用 CDP 直接跑，拿到的原始报错：

```
可以播MIME: false
NotSupportedError: Failed to execute 'addSourceBuffer' on 'MediaSource':
  The type provided ('video/mp4') is unsupported.
```

这机器（vivo V2520A）的实际支持情况：

```
video/mp4                                 → false  ← 不支持
video/mp4; codecs="avc1.42C01F, mp4a.40.2" → true
video/mp4; codecs="avc1.64001F, mp4a.40.2" → true
```

**为什么「下载好的能播、在线的不能」**：这俩是**完全不同的技术路径**——
下载到手机的剧是整集文件，直接给 `<video src=blob:...>`，内核自己解；
在线剧是边下边播，走 `MediaSource` + `appendSourceBuffer`，
**必须先告诉内核用哪种编码**，而我们给的是没有编码标记的裸 `video/mp4`。

### 2. 为什么读不到编码标记 —— 转发服务没暴露那个头

App 侧本来就有 `resp.headers.get('X-Playback-Mime')`，但在手机上读出来是 `null`。

原因不在 App：**跨站的 JS 只能读到 `Access-Control-Expose-Headers` 里列过的头。**
转发服务（`relay.py:123`）原来的名单只有：

```
Content-Range, Content-Length, X-Playback-Duration,
X-Playback-Index, X-Playback-State, Accept-Ranges, Content-Type
```

**没有 `X-Playback-MIME`**。转发本身是原样透传的（`DROP_FROM_RESPONSE` 里也没有它），
纯粹是「没告诉浏览器这个头可以给你看」。

⚠️ **跨站调本机服务时，响应头不是「传过去了」就等于「读得到」** ——
这是很容易漏的一环。症状和有那个头一模一样（都是 null），
但根因完全在服务端。

已一次性补全：`X-Playback-MIME` / `Source` / `Mode` / `Quality` /
`Qualities` / `Run` / `Prefetched`。

### 3. 兜底候选不是瞎填的，但也**不是**当前能用的

补全之后读到的是：

```
X-Playback-MIME: video/mp4; codecs="avc1.42C028, mp4a.40.2"
```

**注意 `avc1.42C028`（Baseline level 4.0）不在我写的两个候选里。**
所以真正让这件事成立的是转发那句修复，候选只是「头读不到时的保险」。
如果只加候选不改转发，就会拿 `42C01F` 去声明一条实际是 `42C028` 的流 ——
能不能播全看内核宽容度，属于赌。

候选的来源是短剧库自己的口径（`ui_playback.go:18` 的
`playbackMIME = video/mp4; codecs="avc1.42C01F, mp4a.40.2"`），
不是编的。

### 4. 真机实测（改完之后跑完整条路径）

```
取流状态：     200
读到 MIME 头： video/mp4; codecs="avc1.42C028, mp4a.40.2"
加缓冲成功：   true
已塞入：       2100048 字节
缓冲范围：     [0, 2.005333] 秒
播放调用：     ok
当前播放到：   1.96783
真的在走：     true
错误：         []
```

**画面在动。** 这是 CDP 连进手机实测的，不是推断。

### 5. 429 残留这次是真的有，但**不是**这次的病根

排查过程中确实又撞到过 429（我自己几次 CDP 探测开了会话没关干净）。
所以两条线索要分清：

- **429** = 名额被占满（残留），已有 1 分钟自动回收 + 一键清空兜着
- **这次播不了** = 编码标记缺失，**跟名额毫无关系**

清空残留后连开 4 个仍然正常，说明名额机制是好的。

## 备注

- SullyOS `origin/master` 全程没动，仍是 `ef17e1aa`。
- 转发服务已重启（`Access-Control-Expose-Headers` 新名单已验证生效）。
- 测试包不用重打。
- **已知没解决**：在线 `playback/stream` 忽略 HTTP `Range`（回 200 不是 206），
  拖进度条不准。第 3 步取帧不受影响。
- `video.duration` 在边下边播时是 `null`（要等流播完才知道总长），
  所以播放页进度条上的总时长在在线剧上可能显示 0:00 —— 第 4 步之前可以先不管。
