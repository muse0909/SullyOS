# 主动消息推送全链路失败 — 安卓 auth 密钥末尾多一个换行

**日期**：2026-09-29  
**涉及 commit**：见下方「涉及 commit」

## 一句话

从 9-25 引入自定义 `AmsgKeyManager` 起，主动消息**一次都没推成功过**。AI 每次都正常跑完，纯粹是最后一步「把消息塞进推送信封」时炸的——`auth` 密钥编码时末尾多了一个换行符，worker 解不开。

## 改了什么

`android/app/src/main/java/com/aetheros/simulator/AmsgKeyManager.kt` 的 `b64Encode()` 补 `NO_WRAP` 标志（一个词的改动）：

```diff
 private fun b64Encode(bytes: ByteArray): String =
-    Base64.encodeToString(bytes, Base64.NO_PADDING)
+    Base64.encodeToString(bytes, Base64.NO_PADDING or Base64.NO_WRAP)
```

## 踩坑 / 需要知道的（重要）

### ① 安卓 `Base64.encodeToString` 不加 `NO_WRAP` 会自动追加 `\n`

同一文件里 `base64UrlEncode()` 写了 `NO_WRAP` 所以 `p256dh` 干净，只有 `b64Encode()` 没写，`auth` 就中招。
**这是安卓 API 的行为，不是 bug**——但两个函数长得像、只差一个标志，极易漏掉。

### ② 一个换行为什么必死

worker 的 `base64UrlToBytes`：

```js
const s = String(input).replace(/-/g, "+").replace(/_/g, "/");
const pad = (4 - s.length % 4) % 4;   // ← 按 23 个字符算，补 1 个等号，凑成 24
const padded = s + "=".repeat(pad);
const bin = atob(padded);             // ← atob 规范会先剥掉所有空白
```

16 字节 auth → 正确长度 22 字符；带换行是 23 字符。

- 补位按 **23** 算 → 补 1 个 `=` → 24 字符
- `atob` **先把 `\n` 剥掉** → 剩 22 + 1 `=` = 23 字符
- 23 ÷ 4 除不尽 → 抛 `InvalidCharacterError`

报错原文里那句 "when the input data length is divisible by 4" 就是这么来的。

### ③ 定位绕了远路：三个错误方向都被排除了

**分片拼接**——不是。写入侧按 204,800 字符切、读取侧 `join("")` 拼回，是无损双射。D1 里三个分片的字节数（409,666 / 409,666 / 354,626）反推出明文 204,800 / 204,800 / 177,280 字符，正好对得上设计值；拼回来 586,876 个 base64 字符，除以 4 整除，合法。

**`tool_pack` 1.12MB**——不是。跟这次失败无关（另开问题查）。

**`memories` 带向量**——也不是。`MemoryFragment`（`types.ts:528`）只有 `id` / `date` / `summary` / `mood` 四个字段，向量存在 `embeddingConfig` 里，是两套东西。

### ④ 决定性的一步是读 `last_error` 的 `reason` 字段

D1 里 `scheduled_messages.last_error` 的结构是：

```json
{"at":"...","occurrence":"...","reason":"..."}
```

- `fire_pack` / `tool_pack` / `tool_config` 解包失败时，`reason` 会是 `"xxx 解压失败（数据损坏）"`（带包名标签）
- 库里那条是**光秃秃一个 atob 报错**，没有标签、没有 `charId`、没有 `error` 字段

→ 说明它根本不是从解包那步抛的，而是 `processSingleMessage` 里未捕获的异常，被通用 catch（bundle 第 4573 行）把原始 `error.message` 直接写进了 `reason`。

再顺着 bundle 里仅有的三处 `atob` 排查：任务正文和 AI 凭据存的都是十六进制（不走 base64），FCM 没配——**只剩推送订阅密钥那一处，且它没有错误包装**。

最后把订阅原文用 `/get-user-key` 拿到的密钥在本地解开，一眼看见：

```
keys.p256dh  长度 87   干净
keys.auth    长度 23   "+kSv0soMhn6gW2KEtUXFTw\n"   ← 尾部字符码 10
```

### ⑤ 脏数据不用手动清

`getPublicKeySet()` 每次都是**从字节重新编码**再返回，不是直接读存下来的字符串。所以装上新包、重注册一次，云端自动干净。`SharedPreferences` 里那个旧的 23 字符值不用管（`loadKeys` 用 `Base64.decode` 读它，解出来仍是 16 字节）。

验证方式：重注册后 `GET /push-subscription` 的 `updatedAt` 会刷新。本次实测 2026-09-29 00:17:35 → 12:00:59。

### ⑥ APK 里的代码跟提不提交无关

有人怀疑「没提交 = 装的是旧包」——**不成立**。打包直接读硬盘上的文件，提交只是给改动拍张照存档。

**而且这次修复本身就是证据**：`atob` 报错消失、推送成功加密并投递到 ntfy（手机收到 766 字节密文），说明新代码确实在跑。旧代码会继续在 D1 里写 atob 报错。

## 修了之后剩下的问题（另开）

日志显示推送已经能加密投递了，但手机侧解密仍失败：

```
wakeup-push-not-decrypted
PushMessage.decrypted=false，content 是 RFC 8291 ciphertext（bytes=766）
```

这是**下一个问题**，跟本次改动无关：worker 用 `subscription.keys.p256dh` + `.auth` 加密，手机用 `AmsgKeyManager.loadKeys()` 读 `VAPID_PREFS` 的密钥对 + `AUTH_PREFS` 的 16 字节 secret 来解。两边密钥对是否真的一致，还没验证。

## 备注

- `tool_pack` 1.12MB 是独立问题，没动。等确认 `activeMemoryMonths` 的增删机制后再出优化方案。
- 安卓另外 3 处 `Base64.encodeToString` 已全部确认带 `NO_WRAP`，无同类问题。
- 点通知上屏那一步（`PendingIntent` 携带 payload + `handleOnNewIntent`）还没做，等解密通了再验。
