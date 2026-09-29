# 主动消息 2.0 两处修复：解密统一用 SDK 默认钥匙 + Gemini 直连在 2.0 里读不到 API

**日期**：2026-09-29
**涉及 commit**：`（待填，见下方两条）`

## 改了什么

### 1. 解密统一用 SDK 默认 KeyManager（A 方案）

**根因**：9-25 注入的自定义 `AmsgKeyManager` 只在**注册**时被用来取公钥，**解密时 SDK 从不调用它**。
反编译 `android-connector-3.0.0` 证实：`MessagingReceiverImpl` 没有覆盖 `getKeyManager()`，
父类 `MessagingReceiver.getKeyManager()` 字节码写死 `new DefaultKeyManager(context)`。
`RegistrationSet` 也只有 `newOrUpdate(..., keyManager)` 和 `tryGetToken(instance)`，**没有任何取回 KeyManager 的方法**。
结果就是加密一套钥匙、解密另一套，必然失败。

**改法**：全部改用 SDK 默认 `DefaultKeyManager`，退役自定义类。

- `AmsgUnifiedPushPlugin.register()` 去掉第 5 个 `keyManager` 参数（改用 4-arg 重载）
- `getStatus()` 里 `AmsgKeyManager(context)` 改 `DefaultKeyManager(context)`，并加判空兜底
- **删除** `android/app/src/main/java/com/aetheros/simulator/AmsgKeyManager.kt`

**验证**（测试版 `com.aetheros.simulator.amsgtest`）：
- 13:56:20 第一条：解密成功，弹通知，686 字节明文
- 14:03:13 第二条：解密成功，弹通知（标题 Sully）
- 通知栏确认 `channel=amsg2_unifiedpush_v1`，`contentIntent` 指向 `startActivity`

### 2. Gemini 直连的角色在 2.0 里永远建不出任务

**根因**：`resolveApiConfig` 和 `buildCharChatCredRow` 只读 OpenAI 的 `baseUrl` / `apiKey` / `model`，
而 `protocol='gemini'` 时配置存在**另外三个字段**里（`geminiBaseUrl` / `geminiApiKey` / `geminiModel`，
见 `types.ts` 的 protocol 注释）。所以 Gemini 直连的角色点「新建任务」必报
「主动消息 2.0 缺少可用的 API URL / Key / Model」。**OpenAI 协议的老用户完全无感。**

**为什么不是简单放开检查**：worker 只会用 OpenAI 那种调法（`POST {model,messages}` + `Authorization: Bearer`），
直接拿 `geminiBaseUrl` 拼会得到 `.../v1beta/chat/completions`——Google 那边**没有这个路径**。
放开检查会把一个诚实的本地报错，换成一次注定失败的远端调用（远端 404）外加白烧一次模型额度。

**改法**：Google 官方有 OpenAI 兼容层 `.../v1beta/openai/chat/completions`，
**鉴权头和请求体跟 worker 发的一模一样**。所以只要在客户端把 Gemini 的 baseUrl 补上 `/openai`，
worker 一行都不用改。新增 `resolveAmsgApiTriplet()` 做归一化，已带 `/openai` 的不重复补，
密钥池按 `geminiApiKeys` 数组优先、`geminiApiKey` 兜底。

## 动了哪些文件

- `utils/amsgLlmCredentials.ts` —— 新增 `resolveAmsgApiTriplet()`；`buildCharChatCredRow` 改用它，签名从
  `Pick<APIConfig,'baseUrl'|'apiKey'|'model'>` 放宽到能接带协议的完整配置
- `utils/activeMsgClient.ts` —— `resolveApiConfig` 改用 `resolveAmsgApiTriplet`；加对应 import
- `android/app/src/main/java/com/aetheros/simulator/AmsgUnifiedPushPlugin.kt` —— 注册/查询改用 SDK 默认钥匙
- `android/app/src/main/java/com/aetheros/simulator/AmsgKeyManager.kt` —— **删除**
- `android/app/build.gradle` —— 加测试版条件后缀（见下）

## 踩坑 / 需要知道的（重要）

### 修 A 方案后**必须重新点一次「连接 ntfy」**
订阅是拿旧钥匙存的，不重连的话 worker 照旧用新钥匙加密 → 手机解不开。

### vivo 会把 app 冻住，冻结期间收到的推送直接丢
现象：ntfy 收到消息并打了「准备发送」，但 **Android 的广播投递历史里那条广播根本不存在**（前后同一分钟的别的广播都在）。
系统广播历史是这么查的：`adb shell dumpsys activity broadcasts`，翻 `enq=` 时间戳。
证据是 `vivo.intent.action.PACKAGE_FREEZE`（广播历史里能直接看到，冻结对象就是我们的包名）。
**暮色在手机设置里开了「后台高耗电 / 自启动 / 最近任务加锁」后消失。** 这是设备侧设置，代码改不了。
命令行临时兜底：`am set-inactive <pkg> false` + `am set-standby-bucket <pkg> active`（重启会掉）。

### SDK 里有两个**静默返回**分支，看不到任何日志
`MessagingReceiver.onReceive` 里：`getStringExtra("token")` 为空、或 `RegistrationSet.tryGetInstance(token)` 返回 null → 直接 `return`；
`getByteArrayExtra("bytesMessage")` 为空 → 也直接 `return`。**全都不打日志。**
排查「推送收到了但 app 没反应」时，先怀疑这两条，别去 logcat 里找不存在的报错。

### 角色自排的任务，如果排程时刻在「到点前 10 分钟内」，必被作废
worker 判定（线上 13:00 自更新后的版本）：

```js
last > occurrenceMs - 10min && last <= occurrenceMs + 10min && last <= nowMs
```

**比的不是「排完之后你有没有再说话」，是「到点时你是不是刚聊过天」。**
而角色自排必然发生在你刚说完话之后 10 分钟内 —— 所以**「2 分钟后叫我」这种短延时必被作废**，
排半小时后 / 明天早上的能正常发。实测：
- 14:07 那次（14:05:41 说话）→ 在窗口内 → 作废
- 14:20 那次（14:18:26 说话）→ 在窗口内 → 作废
- 15:55 那次（建任务时没说话）→ 不在窗口 → 放行，投递成功

**这条闸 worker 侧改不了**（每天 13:00 从 `Tosd0/sullyos-workers` 自动拉代码覆盖自己），
要真解决得让客户端写一个真正的锚点，或者给角色自排默认走「强制发送」。

### 角色自排还有个独立的死结：面板的「强制发送」对它是装饰品
worker 有一道降级闸：

```js
const policy = selfScheduled && taskPolicy === 'force' && !recordLimits.allowSelfForce ? 'expire' : taskPolicy;
```

`allowSelfForce` 从角色云端状态的一个记录里读，**我们客户端从来没写过那个字段**（全项目搜不到），
所以永远是关的 → 角色自排的任务不管面板怎么设都被降级成「遇忙作废」。
另外策略是**建任务那一刻写进任务 metadata 的**，面板改设置不会回头改旧任务。

### 一键部署重跑会换掉 Master Key，而 D1 库是复用的
`generateAmsgSecrets` 写着「已有的原样保留（重装时不换 Master Key）」，但 **Cloudflare 的接口读不到 secret 的值**
（只能读到名字），`existing` 只能来自用户手填或本地存储。所以删掉 2.0 配置再重新一键部署
→ 生成新钥匙 → **库里的旧密文全部解不开**（报 `Decryption failed ... AES-GCM`，
连模型凭据也读不出来，于是又报「缺少可用的 API URL」——**这两个报错是同一件事的两面**）。
**处置：清空 D1 数据行让客户端重新同步。** 数据都在本地，库里的东西（任务、投递记录、云端状态）不值钱。

### 查 D1 的路子（浏览器里的 Cloudflare 面板会白屏，用 API 更快）
```
POST https://api.cloudflare.com/client/v4/accounts/{acc}/d1/database/{db}/query
Authorization: Bearer <token>   Content-Type: application/json
{"sql":"SELECT ..."}
```
表：`scheduled_messages`（任务）、`message_outbox`（投递记录，**worker 每生成一条必写一条**，
判断「有没有真的走云端」就看它）、`client_state`（角色云端状态，含加密的 `last_skip` 作废回执）、
`llm_credentials`、`push_subscriptions`、`worker_diagnostics`。

## 备注

- 测试版包名后缀：`./gradlew assembleDebug -PtestBuild=true` 出 `com.aetheros.simulator.amsgtest`，
  与正式 app 并存、各自一份本地数据 → 各自 `userId` → 各自订阅与任务列表。默认打包行为不变。
- **仍未接**：`utils/amsg2ToolBridge.ts` 在本仓库是**死代码**（`AMSG2_TOOLS` / `createAmsg2ToolSession` /
  `executeAmsg2Tool` 全项目零引用）。上游有个 commit（作者 Tosd0，7-31）在 `useChatAI.ts` 里接了，
  但**只在原仓库的实验分支上，从没进过任何主线**（`git log master -S "AMSG2_TOOLS"` 一次都没命中）。
  所以前台聊天里角色拿不到 `schedule_active_message` 工具（实测 `Tools: 0`），只能靠正文里
  手写 `[schedule_next_wakeup | 时间 | reason]` 让前端正则解析退回老机制。
- 主 app 还没换装修复版，手机上的正式 app 解密仍然会失败。
- worker 的 bundle 每天 13:00 自动从 `https://raw.githubusercontent.com/Tosd0/sullyos-workers/main/amsg/worker.bundle.js`
  覆盖自己，**任何 worker 侧改动都留不住**。
