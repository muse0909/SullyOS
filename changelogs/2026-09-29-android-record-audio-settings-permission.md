# 修：安卓录音被系统挡住（缺一个权限声明）

**日期**：2026-09-29
**分支**：`fix/call-voice`
**相关**：[上一份（语音输入底座）](./2026-09-29-call-voice-input-step1.md)

## 症状

暮色装上语音测试 APK，**权限弹窗点了「允许」，系统设置里也显示已授权**，但打电话页面里麦克风拿不到，一直报「麦克风权限被拒」。

排查前先确认过不是环境问题：
- 网页版同一个功能完全正常
- `adb shell dumpsys package` 显示 `RECORD_AUDIO: granted=true`，还带 `USER_SET` 标志（确实是用户手动点的允许）
- app 进程在前台，`topResumedActivity` 就是它

**相机 / 相册是另一个老毛病**（照片权限压根没授权），跟这个不是一回事。

## 根因

`android/app/src/main/AndroidManifest.xml` 里**漏了 `MODIFY_AUDIO_SETTINGS` 这个权限声明**。

它是「修改音频设置」权限，属于**安装时自动授予**那一类（不需要用户点允许），
但**仍然必须在清单文件里声明**——不声明的话 `checkSelfPermission` 直接返回 DENIED。

Chromium 申请麦克风时会**同时检查两个权限**：
`MODIFY_AUDIO_SETTINGS` + `RECORD_AUDIO`。少一个，它就判定
「这设备没有可用麦克风」，于是干脆不提供任何音频输入设备，
`getUserMedia` 报 `NotAllowedError: Permission denied`。

**而且这种情况下 `WebChromeClient.onPermissionRequest` 根本不会被调用** ——
所以日志里一条权限记录都没有，Capacitor 那套自动申请逻辑压根没机会跑。
这就是为什么「用户明明点了允许」却拿不到。

修复就一行：
```xml
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

**正式版拾光机也有这个洞**（`dumpsys` 里同样搜不到这个权限），
只是以前没有功能用到麦克风，一直没暴露。

## 怎么定位到的（这套方法以后还能用）

权限明明已授权、代码也没错，这种问题肉眼看不出来。靠三步：

1. **用 adb 直接问系统要真实状态**，不靠猜
   ```bash
   adb shell dumpsys package <包名> | grep -A20 "runtime permissions"
   adb shell cmd appops get <包名>          # 第二层管控
   adb shell dumpsys activity activities | grep topResumedActivity
   ```
   这一步确认了「权限确实已授予」，把范围缩到「app 内部没拿到」。

2. **用 Chrome 调试协议直接进 app 内部跑代码**
   debug 包的 WebView 可远程调试，能在真机上直接调 `getUserMedia` 拿真实错误：
   ```bash
   adb shell cat /proc/net/unix | grep -o "webview_devtools_remote.*"
   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
   curl http://localhost:9222/json          # 拿 webSocketDebuggerUrl
   ```
   然后用 `ws` 发 `Runtime.evaluate`，`awaitPromise: true` + `userGesture: true`，
   就能在 app 里执行 `navigator.mediaDevices.getUserMedia({audio:true})`。
   **比让用户口述现象准确得多，也不用反复打包试。**

3. **过滤关键词要精准**。`logcat` 混着插件每秒一次的轮询噪音，
   过滤 `permission` 会把 `LocalNotifications.checkPermissions` 全捞出来刷屏。
   真凶是这一行：
   ```
   W/cr_media: Requires MODIFY_AUDIO_SETTINGS and RECORD_AUDIO.
                No audio device will be available for recording
   ```
   Chromium 内部日志只有 WebView 进程（不是 app 主进程）才打，**抓的时候要看 pid**。

## 顺手发现的两个问题（本次没修）

1. **`LocalNotifications.checkPermissions` 每秒调一次**（日志里 23:24→23:26 刷了上百条）。
   空跑，纯浪费电和 CPU。回头查是哪个组件在轮询。
2. **相册权限还是坏的**：`READ_MEDIA_IMAGES` 和 `READ_MEDIA_VISUAL_USER_SELECTED` 两个都是
   `granted=false`。安卓 14+ 换了照片授权机制（多了「仅部分照片」这个选项），
   需要单独适配。跟麦克风这个是独立问题。

## 影响范围

- **只影响网页里录音**（打电话语音输入）
- **不影响语音合成播放**：播放音频只要 `RECORD_AUDIO`，不需要 `MODIFY_AUDIO_SETTINGS`。
  所以这个洞一直没被发现——之前所有功能都只听不说。
