## 拾光机 Android 端补 UnifiedPush 桥接（2026-09-15）

按暮色 9-15 13:21 拍板做 B 路径：直接在拾光机（本地目录 SullyOS-master）
android/ 里加 UnifiedPush 原生桥接，让手机 APK 端能收到主动消息 2.0 推送。

### 为什么需要这个

拾光机要实现的推送链路：

```
云端 Worker（发了消息的人）
  ↓ 通过 ntfy 服务器（中转）
  ↓ 推到手机
  ↓ 手机里的"耳朵"接收后弹通知
```

之前的代码层面 1-3 都好了（前端 + Worker 端 + 云端 API），
**第 4 步手机里的"耳朵"没装**。这个耳朵叫 **UnifiedPush**——一个开源
Android 推送协议，原版拾光机 fork 的 APK 里装了，所以原版能弹通知。
拾光机 fork 的 APK 仓库里没装，按"开启通知和推送"按钮没反应。

### 改动

**2 个新 Kotlin 文件**（android/app/src/main/java/com/aetheros/simulator/）：

| 文件 | 干啥 |
|---|---|
| `AmsgUnifiedPushPlugin.kt` | Capacitor 插件，名字 `AmsgUnifiedPush`，对应前端 `utils/unifiedPushPlugin.ts` 的 `registerPlugin("AmsgUnifiedPush")`。实现 getStatus / register / unregister / drainPendingPushes / addListener / removeListener + VAPID 密钥生成（ECDSA P-256，持久化 SharedPreferences） |
| `UnifiedPushReceiver.kt` | 继承 `org.unifiedpush.android.connector.MessagingReceiver`（android-connector 3.0.0），实现 onMessage / onNewEndpoint / onRegistrationFailed / onUnregistered。收到推送存 SharedPreferences（key: `unifiedpush_pending_msgs_v1`），让 plugin `drainPendingPushes` 拉走 |

**build.gradle**：

- 根 `android/build.gradle` 加 JitPack 仓库（UnifiedPush android-connector 通过 JitPack 分发）
- `android/app/build.gradle` 加依赖 `com.github.UnifiedPush:android-connector:3.0.0`

**AndroidManifest.xml**：

- 加 `<receiver name=".UnifiedPushReceiver" exported="false">`，监听 5 个 UnifiedPush action（MESSAGE / NEW_ENDPOINT / UNREGISTERED / REGISTRATION_FAILED / REGISTRATION_REFUSED）

**MainActivity.java**：

- 加 `registerPlugin(AmsgUnifiedPushPlugin.class)` 让 Capacitor 找得到

### 摸底

- **编译验证**：✓ Kotlin 编译通过（`./gradlew :app:compileDebugKotlin`）
- **APK build**：✓ `拾光机-2026-09-15-14b21954-debug.apk` 21MB

### 未做（待跟进）

- **Worker 端没部署到 Cloudflare**——还需要 push preview → CF wrangler deploy，前端连接 worker URL 才能端到端打通
- **没在手机上跑过端到端测试**——代码层面编译过了，但真实推送需要 ntfy + Worker 部署都 OK 后才能验

### 手机测试前置

1. 手机装 `拾光机-2026-09-15-14b21954-debug.apk`
2. 装 ntfy（Google Play 下载的 ntfy 即可，拾光机之前下载的就是这个）
3. 打开 ntfy 让它后台运行
4. 打开拾光机 → 设置 → 主动消息 2.0 → 「开启通知和推送」按钮
   - 第一次会弹 distributor 选择弹窗（选 ntfy）
   - 选完后返回设置页，状态会显示已连接
5. 之后 Worker 端部署到 Cloudflare 后，主端到端打通

**注意**：上面的 APK 已经合并了 preview 所有 2.0 改动（commit `a16626dc`、`12ce6e58`、`14b21954`、本次），编译时 preview HEAD 是 `14b21954`。但 `server.url` 还指向 `sully-muse-vert.vercel.app`（master Vercel 部署）。要看新代码得把 preview 改动 merge 到 master。