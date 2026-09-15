## 拾光机 Android UnifiedPush Service 加 PUSH_EVENT intent-filter（2026-09-15）

暮色 9-15 15:18 测试反馈：卸载重装新版 APK 后，开启通知还是没弹窗 + 连接超时。

### 仔细看图 1 日志

图 1 有一条：

> [ActiveMsg] 补收失败（等下一次时机再试）
> {error: Error: **主动消息 2.0 的获取用户密钥请求失败: 共享密钥无效或缺失**}

这条说明 ActiveMsgClient 走通了——**跟 UnifiedPush 注册超时不是同一件事**，是 Worker 端 SERVER_TOKEN 没配（等 Worker 部署到 Cloudflare 后一起修）。

### 没弹窗 + 注册超时的根因

SDK `InternalPushServiceConnection.bind()` 反编译看到：

```kotlin
private fun bind(context: Context) {
  val ctx = context.applicationContext
  val intent = Intent("org.unifiedpush.android.connector.PUSH_EVENT")
      .setPackage(ctx.packageName)
  ctx.bindService(intent, connection, BIND_AUTO_CREATE)
}
```

SDK 用 **implicit intent**（action=PUSH_EVENT + package=com.aetheros.simulator）来 bind 我们的 PushService。
**Android 必须靠 intent-filter 匹配才能找到 service**（不是按 component name）。

我上一版的 UnifiedPushService 在 manifest 里**没声明 intent-filter**——所以 Android 找不到——SDK bindService 返回 false——SDK 的 connection 永远不连接——`connected=false`——`sendEvent` 把所有事件加到 eventsQueue 里——**永远不触发**——我们的 PushService.onNewEndpoint 永远不调。

所以 ntfy 那边建订阅主题 OK（UnifiedPush.register 内部走的是 broadcaster 路径，跟 Service bind 无关），但 NEW_ENDPOINT 永远到不了。

### 修法

`AndroidManifest.xml` 给 UnifiedPushService 加 `<intent-filter>` 处理 `PUSH_EVENT`：

```xml
<service android:name=".UnifiedPushService" android:exported="true">
    <intent-filter>
        <action android:name="org.unifiedpush.android.connector.PUSH_EVENT" />
    </intent-filter>
</service>
```

### 摸底

- `./gradlew :app:assembleDebug` ✓
- APK 已更新（21MB）

### 暮色重新装 APK 后预期

1. 卸载旧版，装新版
2. 打开 ntfy（保持后台运行）
3. 拾光机 → 设置 → 主动消息 2.0 → 点"开启通知和推送"
4. **这次 UnifiedPush 应该立刻回调 true**（不需要弹 ntfy 选择 dialog——之前选择过 SharedPreferences 还在）
5. 5-10 秒后状态显示"已连接"——因为 UnifiedPushService.onNewEndpoint 把 endpoint 写 SharedPreferences，AmsgUnifiedPushPlugin.getStatus 读出来

### 还没做的

- Worker 端 bundle 部署到 Cloudflare（修"获取用户密钥请求失败"那个错）
- Android 端 FCM 集成（暂放）

### 给暮色的 wrangler deploy 步骤（macOS）

```bash
# 1. 确认已经 login wrangler
cd /Users/caijia/Desktop/SullyOS-master/android
npx wrangler whoami

# 2. 第一次部署（手装时 CF 仪表盘里 worker name 是 sullyos，D1 name 是 sully-amsg2）
#    如果 wrangler.toml 里已有同字段则跳过，直接 deploy
cd /Users/caijia/Desktop/SullyOS-master
npm run deploy:worker:amsg

# 3. 部署完后看输出，会得到 worker URL，类似：
#    https://sullyos.<你的 account_id>.workers.dev

# 4. 把 URL 填回拾光机设置页（系统设置 → 主动消息 2.0 → Worker 地址）
#    保存后拾光机会自动拿用户密钥等初始化
```

如果 wrangler.toml 里的 name = "sullyos" 跟你原来 CF 仪表盘手动建的 worker 对得上，就能直接 deploy；如果想用一键部署（CF 一键部署那条路径），在拾光机设置页填 CF Token 点"开始部署"按钮会自动建一个叫 "sullyos-amsg" 的 worker（但那就要先改 AMSG_SCRIPT_NAME = "sullyos" 的适配）。

### 日志里另一条线索（另一个独立问题）

> [ActiveMsg] 补收失败（等下一次时机再试）
> {error: Error: 主动消息 2.0 的获取用户密钥请求失败: 共享密钥无效或缺失}

这说明 ActiveMsgClient 已经在跟 Worker 通信（说明 Worker URL 配置是对的），但**服务端拒绝**——大概率是因为 Worker 端的 `SERVER_TOKEN` 还没设（wrangler.toml 里有 `SERVER_TOKEN = ""` 占位）。你用 wrangler deploy 部署前需要先在 CF 仪表盘 Worker → Settings → Variables and Secrets 设 `SERVER_TOKEN` 强随机串（比如 `openssl rand -hex 32` 生成一个）。