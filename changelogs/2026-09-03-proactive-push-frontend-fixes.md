# 2026-09-03 proactive-push 端到端 修复归档

暮色 9-3 晚 19:00-20:18 收工归档。**前台推送链路通**；**后台保活未修**，留到下次单独会话。

## 改过的（已完成）

### 服务端 `worker/proactive-push/`

| 文件 | 改动 | 暮色/麦麦 | 备注 |
|---|---|---|---|
| `src/index.ts` | `/ws/push` 路径检查提到 `checkToken` 之前 | 暮色 9-3 第一轮 | 原顺序拦掉了 WS 升级 |
| `src/index.ts` | `/ws/push` 鉴权**不依赖 Upgrade 头** | 暮色 9-3 第二轮 | HTTP/2 协议吞 Upgrade 头（RFC 7540 8.1），curl 经代理触发 |
| `src/index.ts` | 401 改成返回详细 JSON（query_token_len / env_token_len / match / reason） | 暮色 9-3 第二轮 | 不打印 secret 值，只打长度 |
| `src/index.ts` | `/test` 端点改走 WS broadcast 路径 | 麦麦 9-3 晚 | 不查 schedules 不发 VAPID，Android 端实测用 |
| `src/wsHub.ts` | `extends DurableObject` + `import { DurableObject } from "cloudflare:workers"` + 显式 `constructor(state, env) { super(state, env) }` | 麦麦 9-3 早 | module worker 模式下 DurableObject 不是 global |
| `src/wsHub.ts` | `handleBroadcast` 自动加 `type: "proactive_message"` 字段 | 麦麦 9-3 早 | 跟 Android 端 `handleMessage` 期望格式一致 |
| `wrangler.toml` | `new_sqlite_classes = ["WsHub"]` migration + cron `* * * * *` + VAPID_SUBJECT + HEARTBEAT_WINDOW_MS | 麦麦 9-3 早 | CF 2025 新政策 Durable Object 必须用 sqlite |
| `scripts/build-workers.mjs` | `minify: false` + `external: ['cloudflare:workers']` | 麦麦 9-3 早 | 保留 `WsHub` class 名 + 保留 CF 虚拟模块 import |
| `worker.bundle.js` | 非 minify bundle 19.1kb | 麦麦 9-3 晚 | deploy 用的产物 |

### Secret put 修复（58 vs 33 字符错位）

| 时间 | 事件 | 备注 |
|---|---|---|
| 17:42 | 暮色 secret put 报 Success，但实际存了 58 字符的字符串 | 比正确值多 25 字符 |
| 19:26 | 暮色重新 `pbcopy` 复制 + `wrangler secret put CLIENT_TOKEN` | 33 个 * = 33 字符 |
| 19:27 | `wrangler deploy` 让新 secret 生效 | Version ID: `c0a46924-...` |
| 19:28 | curl 验证返回 200 + `{"ok":true, "hint":"token valid..."}` | ✓ |

### 客户端 Android `app/src/main/`

| 文件 | 改动 | 备注 |
|---|---|---|
| `KeepAliveService.kt` | 8 项加固：BuildConfig 读真值 / 占位符检测 / onStartCommand restart / POST_NOTIFICATIONS 检测 / ForegroundServiceStartNotAllowedException 兜底 / lastSuccessfulPongTime 跟踪 / 诊断日志开关 / onTaskRemoved alarm 兜底 | 暮色 8-27 + 8-30 + 9-3 累积 |
| `AndroidManifest.xml` | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 权限 + `foregroundServiceType="specialUse"` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` | 暮色 8-27 后台保活加固 |
| `build.gradle` | 4 个 `buildConfigField`（WS_URL / WS_TOKEN / WS_VAPID_PUBLIC_KEY / KEEP_ALIVE_LOG） + inline `localProps.getProperty` 修复 | 不硬编码敏感值 |
| `gradle.properties` | 4 行占位符默认值（进 git） | 编译占位符 build 不崩 |
| `local.properties.example` | 模板 | gitignore 真值 |
| `MainActivity.java` | 占位符 warn log | 提醒用户配置 |
| `apps/Settings.tsx` | 未配置提示卡 + 通知权限状态 + 电池优化引导 + 诊断日志说明 | 用户引导 |
| `utils/proactivePushConfig.ts` | 读 `import.meta.env.VITE_PROACTIVE_*` | 删 hardcode |
| `vite-env.d.ts` | `ImportMetaEnv` 类型 | TS 类型 |
| `.env.example` | 模板 | gitignore 真值 |

## 没改的（待办）

### 后台保活（P0）

- [ ] `KeepAliveService` foregroundServiceType 改 `dataSync`（替代 `specialUse`，Android 14 严格 stop specialUse）
- [ ] `AndroidManifest` 加 `WAKE_LOCK` 权限
- [ ] `KeepAliveService` 在 WS connect 时 `acquire` partial wake lock，断开时 `release`
- [ ] `setForegroundAsync` + dataSync 类型适配（Android 14 要求每 6 小时重启 FGS）
- [ ] `Settings.tsx` 加厂商后台白名单引导：
  - MIUI（小米）
  - EMUI / HarmonyOS（华为）
  - OneUI（三星）
  - ColorOS（OPPO）
  - OriginOS（Funtouch）（vivo）
  - OxygenOS（一加）
- [ ] 4 场景完整验证：
  - [ ] 后台（SullyOS 退到桌面时 curl /test 看通知是否实时弹）
  - [ ] 锁屏+Doze（锁屏等 30 分钟）
  - [ ] 进程被回收（`adb shell am force-stop com.aetheros.simulator` 后 service 自动重启 + 重连）

### Git 流程

- [ ] merge preview → master（**等暮色说明天合**——按 8-25 修正流程，merge master 不默认）

## 4 场景验证状态

| 场景 | 状态 | 现象 |
|---|---|---|
| 前台（App 打开） | ✅ | curl /test → delivered:1 → logcat `recv proactive_message` → 通知立即弹 |
| 后台（按 Home 退到桌面） | ❌ | service 立即被 stop，3 分钟后 alarm 兜底重启，堆积消息延后弹 |
| 锁屏+Doze | ❌ | 未测（先要后台保活修好） |
| 进程被回收 | ❌ | 未测（先要后台保活修好） |

## 关键交付物

- **APK**：`/Users/caijia/Desktop/sullyos-debug.apk`（10.14MB，前台场景可用）
- **Worker** Version ID：`3b2d237a-9abf-4f2b-8e28-dd264353d98b`
- **Worker URL**：`https://proactive-push.1812038909.workers.dev`
- **Doze 白名单**：`com.aetheros.simulator`（adb 已加，`dumpsys deviceidle whitelist`）
- **Commit**：`1c05ad1a`（preview 分支，16 files changed）
- **Bundle**：`worker/proactive-push/worker.bundle.js` 19.1kb

## Secret / 配置值（不要进 git）

- `VAPID_PUBLIC_KEY`：`BL-WX2a-LcT41MIUFRgFQEEWHScRYuM--vGeFY4-lrukxYgtd72KBoT6Qla5cIAEWjBVvGi7XYJz5ia3QmqlfGA`
- `VAPID_PRIVATE_KEY`：CF secret 存（**旧值 MMZYMJ_6V8... 已重新生成作废**）
- `CLIENT_TOKEN`：`sully-1812038909-keepalive-secret`（33 字符）
- `VAPID_SUBJECT`：`mailto:1812038909@qq.com`
- `userId` 示例：`c0bd12ca-a2c4-42c9-8557-1b0287e9a842`（Android UUID）

## 下次继续从哪里

1. 读这个归档
2. 改 `KeepAliveService.kt` foregroundServiceType = `dataSync` + 加 WAKE_LOCK + partial wake lock
3. 改 `AndroidManifest.xml` 加 `WAKE_LOCK` 权限
4. `apps/Settings.tsx` 加厂商后台白名单引导
5. 重新 build APK + 装机
6. 4 场景全过
7. merge preview → master
