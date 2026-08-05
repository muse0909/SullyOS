# 主动消息 2.0 · Cloudflare Worker 部署脚手架

**日期**：2026-08-06
**涉及 commit**：(本任务)

## 改了什么

主动消息 2.0（amsg2）前端 `components/settings/ActiveMsgGlobalSettingsModal.tsx` + `utils/activeMsgClient.ts` 暮色 8-5 已经接好，但**部署端的 Cloudflare Worker 还是空白**——暮色今晚准备在 Cloudflare Workers 上把这个跑起来。

调研后决定**不 fork 原作者 worker 源码**：原作者 `@rei-standard/amsg-server`（v2.6.0-next.12）已经把 Cloudflare Worker 入口做成了 SDK 导出 `./cloudflare` 子路径，提供 `createSingleUserCloudflareWorker(buildConfig)` 工厂 + `createWebCryptoWebPush(vapid)` 推发器。worker 入口只是 5 行的 env 注入胶水代码。

**新加的部署脚手架**：

| 文件 | 作用 |
|---|---|
| `worker/amsg/src/index.ts` | Cloudflare Worker 入口（~80 行），把 `env.MASTER_KEY / VAPID_* / DB` 注入 SDK 工厂 |
| `worker/amsg/worker.bundle.js` | esbuild 打包输出（gitignore，每次 build 重新出），约 95KB |
| `scripts/build-workers.mjs` | 统一打 amsg + proactive-push 两个 worker（esbuild ESM / minify / target es2022） |
| `wrangler.toml` | Cloudflare 部署配置（D1 binding + 每分钟 cron + 非敏感 vars） |
| `.dev.vars.example` | 本地 wrangler dev 环境变量模板（密钥类走 wrangler secret put） |
| `package.json` scripts | `build:workers` / `build:worker:amsg` / `deploy:worker:amsg` |

## 动了哪些文件

- `worker/amsg/src/index.ts` —— 新建。worker 入口，export `{ fetch, scheduled }`
- `worker/amsg/worker.bundle.js` —— 新建（gitignored）。esbuild 打包产物
- `scripts/build-workers.mjs` —— 新建。统一构建脚本
- `wrangler.toml` —— 新建（仓库根）。D1 binding + cron triggers + vars
- `.dev.vars.example` —— 新建。密钥类环境变量模板
- `package.json` —— 加 4 个 scripts：`build:workers` / `build:worker:amsg` / `build:worker:proactive-push` / `deploy:worker:amsg`
- `.gitignore` —— 加 4 条：`worker/amsg/worker.bundle.js` / `worker/proactive-push/worker.bundle.js` / `.dev.vars` / `.wrangler/`

## 踩坑 / 需要知道的（重要）

### 1. 原作者把 Worker 入口做成了 SDK 导出
**不要 fork `worker/amsg/src/*.ts`**！原 `@rei-standard/amsg-server/cloudflare` 子路径已经打包好 Cloudflare Worker 适配（dist/cloudflare.mjs + D1 adapter + Web Crypto Web Push 实现 + cron tick）。我们要做的只是写 5 行 env 注入 + 调用工厂函数。

子路径的核心导出：
- `createSingleUserCloudflareWorker(buildConfig)` — 返回 `{ fetch, scheduled }`，buildConfig 接受 env，返回 `{ masterKey, vapid, serverToken, webpush, cors }`
- `createWebCryptoWebPush(vapid)` — 纯 Web Crypto 实现的 Web Push 发送器（不需要 `web-push` npm 包，不需要 `nodejs_compat` flag）
- `createD1Adapter(env.DB)` — D1 适配器（worker 工厂内部自动调用）

### 2. 路由用 endsWith 匹配，所以 baseUrl 带不带 `/api/v1` 前缀都行
SDK 的 fetch handler 是 `pathname.endsWith('/capabilities')` 这种匹配，意味着：
- 调 `https://sully-amsg2-worker.workers.dev/capabilities` → 200
- 调 `https://sully-amsg2-worker.workers.dev/api/v1/capabilities` → 也 200

暮色旧部署的 client 代码 `normalizeActiveMsgApiBase` 强制把 baseUrl 后面补 `/api/v1`——这在 worker 域名下**也能跑**，不用改前端代码。worker 路由天然兼容。

### 3. 不需要 `nodejs_compat` flag
- `web-push` npm 包（依赖 `crypto.createHmac`）只在多租户 server 里用，单用户 cloudflare 子路径不引
- VAPID JWT 签名用 `crypto.subtle`（Web Crypto API），Workers 原生支持
- SQL 走 D1 binding（不是 node-postgres）

所以 `compatibility_flags = []` 就够了，加了 `nodejs_compat` 反而会拖慢冷启动。

### 4. 密钥分层
| 变量 | 放在哪 | 备注 |
|---|---|---|
| `MASTER_KEY` | `wrangler secret put` | 32 字节 base64，openssl rand 生成；用于加密用户消息 |
| `VAPID_PRIVATE_KEY` | `wrangler secret put` | vapidkeys.com 生成；推发签名 |
| `VAPID_PUBLIC_KEY` | `wrangler secret put`（或 vars） | 公钥前端用，但其实**前端 ReiClient 调 `/vapid-public-key` 端点拉**，所以也走 secret 即可 |
| `VAPID_EMAIL` | `wrangler secret put` | `mailto:xxx@example.com` 格式 |
| `SERVER_TOKEN` | `[vars]` | 客户端 X-Client-Token 鉴权。生产环境设强随机 |
| `CORS_ALLOWED_ORIGIN` | `[vars]` | 跨域白名单。默认填了 Vercel 预览域名 |
| D1 `database_id` | `[[d1_databases]]` | `wrangler d1 create sully-amsg2` 后填 |

### 5. D1 schema 自动化
worker 第一次调 `init-tenant` 端点时 SDK 会自动 `CREATE TABLE IF NOT EXISTS`（scheduled_messages / push_subscriptions / client_state 等），**不需要手动跑 migration**。如果手动维护，看 `node_modules/@rei-standard/amsg-server/examples/cloudflare-single-user/schema.sql`（暮色要查直接看 node_modules，不用重装）。

### 6. cron 触发器
```toml
[triggers]
crons = ["* * * * *"]
```
主动消息 2.0 支持 minute 级精度（比 1.0 的 30 分钟细一截）。D1 binding + cron 触发器都是 Cloudflare 免费层支持的——`Workers Free` 每天 10 万次请求，足够个人用。

### 7. build script 同时打两个 worker
`scripts/build-workers.mjs` 里 `WORKERS` 数组写了 amsg + proactive-push 两条：
- amsg：暮色 8-5/06 主动消息 2.0
- proactive-push：暮色 6-6 主动消息 1.0 push 加速器（之前是手写 paste 进 Cloudflare 面板的，现在纳入构建）

**好处**：以后改 proactive-push 也走 `npm run build:worker:proactive-push` 出新 bundle，不用手动维护。**proactive-push 这次没改源码**，只是让构建脚本支持它。

## 部署步骤（暮色在 Cloudflare 仪表盘走一遍）

1. **Cloudflare 控制台** → Workers & Pages → Create application → 选 "Create Worker"（不是 Pages）
   - Project name: `sully-amsg2-worker`
   - Connect to Git：选 `muse0909/SullyOS` 仓库 + `preview` 分支
   - Build command: **留空**（本地已 build 好，dashboard 自动 build 会跟我的本地 build 冲突）
   - Deploy command: `npx wrangler deploy`（仪表盘默认会先 `npm install`）
   - Path: **留空**（默认 `/`，连到仓库根的 `wrangler.toml`）

2. **D1 数据库**：本地跑 `wrangler d1 create sully-amsg2`，把输出的 `database_id` 填进 `wrangler.toml` 的 `[[d1_databases]]` 块。**或者** Cloudflare 控制台 D1 → Create database → 拿 id。

3. **设密钥**（每个都跑一次）：
   ```bash
   wrangler secret put MASTER_KEY
   wrangler secret put VAPID_EMAIL
   wrangler secret put VAPID_PUBLIC_KEY
   wrangler secret put VAPID_PRIVATE_KEY
   ```
   VAPID 密钥对去 vapidkeys.com 生成（公私钥都返回）。

4. **部署**：`npm run deploy:worker:amsg` 或 Cloudflare 仪表盘 push trigger。

5. **拿到 worker URL**（如 `https://sully-amsg2-worker.<account>.workers.dev`），前端 Settings → 主动消息 2.0 → API base URL 填这个。

## 备注

### bundle 大小
- amsg: 95.3KB（minify + tree-shake + Web Crypto 内联）
- 对比 amsg-server node_modules dist 体积（~210KB），bundle 砍了一半

### 路由不需要改前端
`utils/activeMsgClient.ts` 默认 `baseUrl = window.location.origin + '/api/v1/'`，但 worker 路由 endsWith 匹配 + `VITE_AMSG_API_BASE_URL` env 覆盖机制都兼容 Cloudflare worker 域名。**Settings 弹窗只让用户填 base URL，不强制带 `/api/v1`**。

### 为什么没装 wrangler npm 包
暮色在 Cloudflare 仪表盘走的是 `npx wrangler deploy`（自动拉最新 wrangler 3.x），本地手动部署也是 npx 拉。**不**写到 devDependencies 里避免每次 `npm install` 拉一次 wrangler 3.70+（冷启动 3-5s）。生产 CI 环境 Cloudflare 仪表盘会自动跑 `npm install` + `npx wrangler deploy`。

### Worker 调试
- `wrangler dev` 跑本地 D1 模拟器（要 miniflare，老 wrangler 自带，新 wrangler 拆出去了）
- `wrangler tail` 实时看 worker 日志（生产环境问题排查用）
- `wrangler d1 execute sully-amsg2 --command "SELECT * FROM scheduled_messages LIMIT 10"` 直接查 D1 数据

### 下一步（暮色 8-06 之后可能要做）
- 拿到 worker URL 后跑一次 `init-tenant`（前端 ActiveMsgGlobalSettingsModal 已经有"初始化租户"按钮）
- 测 schedule-message → 几分钟内能不能收到 push（手机上要给网站通知权限）
- 测 cron scheduled：暮色设一个 1 分钟后的 firstSendTime，看 `* * * * *` 触发后 push 能不能到

### 暮色之前留下的活（**不**属于本 commit）
- `apps/DateApp.tsx` + `components/date/DateSession.tsx` 改动 + `changelogs/2026-08-04-dateapp-3mode-prompt-split.md` + `thought-display-options.html` + `timestamp-position-options.html` 是暮色 8-4 自己的 3 模式 prompt 拆分工作，**等他 commit**。
- 3 个未推 master 的 commit（`8ede348` 时区 UI / `4f38e7c` 删重复声明 / `82a4a74` 全局配置入口）等 worker 部署验证后一起推。
