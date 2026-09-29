# 打电话功能第一阶段：语音输入底座（录音 + 音量条）

**日期**：2026-09-29
**分支**：`fix/call-voice`（暮色指定；但 `fix` 这个名字被已有的 `fix/amsg2-realign` 占着，git 不让建同名分支）
**方案**：[`notes/2026-09-29-电话语音识别与流式方案.md`](../notes/2026-09-29-电话语音识别与流式方案.md)

## 改了什么

打电话从"只能打字"变成"能说话"——这一阶段只做**采集**，不接语音识别。

- 麦克风按钮从底部挪到输入框旁边，改成**按住说话**（松手结束）
- 录音时输入框下方显示实时音量条 + "松开发送"
- 录完显示"录到 X.X 秒" + **"听听看"** 按钮，点一下能回放自己刚才说的话
- 麦克风不可用时按钮置灰 + 中文原因（权限被拒 / 没找到麦克风 / 被别的程序占用）
- 打字能力完全保留，跟语音并存

## 动了哪些文件

- `android/app/src/main/AndroidManifest.xml` —— **加了录音权限声明**（关键，见下）
- `utils/callVoice.ts` —— 新增。录音采集器：实时音量、静音判定、WAV 编码
- `apps/CallApp.tsx` —— 接入录音 UI、改麦克风按钮为按住说话

## 踩坑 / 需要知道的（重要）

### 1. 安卓清单文件里原来没有录音权限

`android/app/src/main/AndroidManifest.xml` 之前只有网络、通知、存储这些，**`RECORD_AUDIO` 一条都没有**。

不声明的话：`ActivityCompat.requestPermissions` 直接无效，系统设置里也看不到拾光机在麦克风权限列表，录音必然失败。

**这是这次唯一的原生改动，也是为什么必须重新打包 APK**——光推代码不生效。

### 2. ⚠️ 我一开始判断错了：不需要自己写 WebChromeClient

方案里我写了"Android WebView 默认拒绝网页要麦克风，必须覆写 `onPermissionRequest`"，**这是错的**。

实际去翻 Capacitor 源码（`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java`）才发现：

```java
public void onPermissionRequest(final PermissionRequest request) {
    ...
    if (Arrays.asList(request.getResources()).contains("android.webkit.resource.AUDIO_CAPTURE")) {
        permissionList.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        permissionList.add(Manifest.permission.RECORD_AUDIO);
    }
    ...
    permissionLauncher.launch(permissions);   // 自动弹系统授权，批了就 grant
}
```

Capacitor **已经完整处理了**，而且 `Bridge.java:275` 就把它的 WebChromeClient 装到 WebView 上了。

我照着错误判断写了 `CallAudioWebChromeClient`，还打算 `setWebChromeClient` 换掉——**这会连带弄坏 Capacitor 的文件选择、地理位置、权限代理**。编译直接报错（构造签名是 `BridgeWebChromeClient(Bridge)` 不是 `(BridgeActivity, Bridge)`），才发现，已删除还原。

**教训**：改涉及原生权限/插件行为的东西之前，先翻 `node_modules/@capacitor/*/src/main/java/` 源码确认框架已经做了什么，别凭印象写。

### 3. 为什么不复用项目里的 `@capacitor-community/media`

那个插件能录完整文件，但**拿不到实时音量**——它只在录完之后给你文件。而打电话必须有实时音量（判断你什么时候说完 + 界面上让你看到自己在说话）。

所以用浏览器标准的录音接口，自己控制每一块采样。

代价：用 `ScriptProcessorNode`（官方已标废弃）。选它是因为不用加载额外的 worklet 文件、兼容性最好。通话场景够用。以后要更省电再换 `AudioWorklet`。

### 4. 采集规格是照着识别接口的要求定的

单声道 / 16000 Hz / 16-bit / WAV。浏览器给的原始采样率通常是 44100 或 48000，代码里做了线性插值重采样。

官方说明识别不依赖高采样率，转 16k 单声道识别率不受影响，但**上传体积小一半**（50MB 上限更不容易碰）。

### 5. 安卓上 AudioContext 经常是暂停状态

不 `resume()` 的话 `onaudioprocess` 根本不触发（表现为"按了没反应"）。代码里加了 resume + 状态兜底。

另外 `ScriptProcessorNode` 必须连到 destination 才会触发回调——连了个**增益为 0 的节点**，避免把自己的声音外放出去。

## 这一阶段没做的（留给下一阶段）

- **语音识别**（把录音变成文字）——下一步
- 自动发送：现在松手只显示"录到 X 秒"，不会自动发出去
- 静音自动结束：代码里已有静音检测回调，但没接自动发送
- 打断、回声消除——方案里说的大工程，不在这一阶段

## 备注

- **必须重新打包 APK 才能测**，纯推代码不生效（改的是原生清单文件）
- 网页端（Vercel）也能测，但没有原生权限拦截，体验顺一点，**真实验证还是得用打包的 app**
- 顺带记一个跟本任务无关的老 bug，**这次没修**：通话记录详情页的"重播语音"按钮从来没出现过，因为 `CallApp.tsx:598` 读历史音频地址，但保存时压根没写过这个字段。留在语音识别那阶段一起修
