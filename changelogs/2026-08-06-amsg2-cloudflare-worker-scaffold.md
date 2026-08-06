# 主动消息 2.0 · Cloudflare Worker 部署 + 端到端联调

**日期**：2026-08-06
**涉及 commit**：`d52f7c3` `e0fed1e` `8f8b42a` `54f745f` (本任务) + 后续 Vercel env var + Redeploy 等新窗口

## 改了什么

主动消息 2.0（amsg2）前端 `components/settings/ActiveMsgGlobalSettingsModal.tsx` + `utils/activeMsgClient.ts` 暮色 8-5 已经接好，**部署端的 Cloudflare Worker 还是空白**——暮色 8-6 下午在 Cloudflare Workers 上把这个跑起来。**今晚完成服务端部署 + 端到端鉴权配置**，浏览器访问 `/capabilities` 端点返回 200 + 完整 27 features 列表，**服务端就绪**。剩下端到端 push 验证（前端 Vercel env + 跑 init-tenant + 手机开 Web Push 权限）等新窗口。

调研后决定**不 fork 原作者 worker 源码**：原作者 `@rei-standard/amsg-server`（v2.6.0-next.12）已经把 Cloudflare Worker 入口做成了 SDK 导出 `./cloudflare` 子路径，提供 `createSingleUserCloudflareWorker(buildConfig)` 工厂 + `createWebCryptoWebPush(vapid)` 推发器。worker 入口只是 ~80 行的 env 注入胶水代码。

## 动了哪些文件

| 文件 | 作用 |
|---|---|
| `worker/amsg/src/index.ts` | Cloudflare Worker 入口（~80 行），env 注入 → SDK 工厂；**`export { fetch, scheduled }` + `export default { fetch, scheduled }`**（module worker 格式） |
| `worker/amsg/worker.bundle.js` | esbuild 打包输出（gitignored），约 95KB |
| `scripts/build-workers.mjs` | 统一打 amsg + proactive-push 两个 worker |
| `wrangler.toml` | Cloudflare 部署配置（name=`sullyos` + D1 binding 由仪表盘管 + 每分钟 cron + 非敏感 vars） |
| `.dev.vars.example` | 本地 wrangler dev 密钥类环境变量模板 |
| `package.json` | 加 4 个 scripts：`build:workers` / `build:worker:amsg` / `build:worker:proactive-push` / `deploy:worker:amsg` |
| `.gitignore` | 加 4 条：`worker/amsg/worker.bundle.js` / `worker/proactive-push/worker.bundle.js` / `.dev.vars` / `.wrangler/` |

## 暮色今天真实走过的部署流程（含 4 个大坑）

### 0. Cloudflare 仪表盘 → Workers & Pages → Create application
- Select a method: **Import from Git**
- Repository: `muse0909/SullyOS`（**没有"选分支"步骤**——Cloudflare 自动监控所有分支）
- Project name: `sullyos`（这个**覆盖** wrangler.toml 里的 `name`，最终 URL = `sullyos.<account>.workers.dev`）
- Build command: `npm run build:worker:amsg`（**不能留空**也不能用默认 `npm run build`，那打的是 vite 前端）
- Deploy command: `npx wrangler deploy`（默认）
- ✅ 勾 "Builds for non-production branches"（让 preview 分支 push 自动部署）

### 1. ⚠️ Root directory 必填 `/`（不是 `/amsg`）
Cloudflare 仪表盘自动填了 `/amsg`（探测到 `amsg` 相关代码）—— **错的**。`wrangler.toml` 在仓库根，`npm install` 也要在仓库根。
- 修法：Settings → Build → Build configuration 旁边 **✏️ 铅笔图标** → Root directory 改 `/`

### 2. ⚠️ Production branch 必填 `preview`（不是 master）
暮色 8-5/06 写的 4 个新 commit 都在 `preview` 分支，但 Cloudflare 默认 production branch 是 `master`——push preview **不会触发 deploy**。Build log 显示 "Manually deployed" + "preview" 标签，但实际只走 `master` 分支。
- 修法：Settings → Build → Branch control 旁边 **✏️ 铅笔图标** → Production branch 改 `preview`

### 3. ⚠️ D1 binding 必须在仪表盘 Bindings 加
不能手填 `wrangler.toml` 的 `[[d1_databases]] database_id = "..."`（手填 ID 容易拼错 / 被 transfer），**最稳是让仪表盘管**：
- Bindings → Add binding → D1 database binding
- Variable name: `DB`（**必须**跟 worker 入口代码里 `env.DB` 一致）
- D1 database: 选已经建好的 `sully-amsg2` 库
- Cloudflare 仪表盘自动把 database_id 同步进 wrangler.toml
- **所以 `wrangler.toml` 里不写 `database_id` 字段**（避免 drift warning）

### 4. ⚠️ wrangler 4.x module worker 必须有 `export default`
只写 `export { fetch, scheduled }`（named export）—— wrangler 4.x 默认按 module worker 格式处理，缺 default export 就 fallback 到 service-worker 格式，触发 Cloudflare API **10021 错误 "No event handlers were registered"**。
- 修法：worker 入口**同时**加 `export default { fetch, scheduled }`（保持 named export 也行）

### 5. ⚠️ wrangler.toml 的 `name` 必须跟仪表盘 Project name 一致
暮色仪表盘填了 `sullyos`，wrangler.toml 写 `sully-amsg2-worker` —— Cloudflare 弹黄色警告要求统一。改 wrangler.toml `name = "sullyos"` 后 warning 消失。

### 6. Settings → Variables and secrets 加 4 个 Secret
**注意区分**：
- **Build → Variables and secrets**（页面）= build 时变量（给 `npm run build` 用），wrangler deploy **不读**——这个位置加 D1_DATABASE_ID 没用
- **Settings → Variables and secrets**（右侧菜单独立 tab）= **worker runtime** 变量——这个位置加 MASTER_KEY / VAPID_* 才对

4 个 secret 加完**自动触发 deploy**（不用手动点 Retry）：

| Type | Variable name | Value |
|---|---|---|
| Secret | `MASTER_KEY` | `openssl rand -base64 32` 生成（32 字节 base64） |
| Secret | `VAPID_EMAIL` | `mailto:你的邮箱` |
| Secret | `VAPID_PUBLIC_KEY` | vapidkeys.com 公钥（87 字符左右 base64url） |
| Secret | `VAPID_PRIVATE_KEY` | vapidkeys.com 私钥（43 字符 base64url） |

### 7. 浏览器验 worker 启动
打开 `https://sullyos.<account>.workers.dev/capabilities`：
- 期望 JSON `{"success":true,"serverVersion":"2.6.0-next.12","features":[27个]}` → 启动成功 ✓
- 30 invocations / 30 errors 之前是因为没设 secret，buildConfig 抛 `[amsg2-worker] MASTER_KEY is required` → catch → 500

## 路由设计

SDK fetch handler 用 `pathname.endsWith()` 匹配，所以 baseUrl 带不带 `/api/v1` 前缀都行：
- `https://sullyos.<account>.workers.dev/capabilities` → 200
- `https://sullyos.<account>.workers.dev/api/v1/capabilities` → 也 200

`utils/activeMsgClient.ts` 默认 `baseUrl = window.location.origin + '/api/v1/'`，Cloudflare worker 域名下天然兼容。

## worker 入口必填 4 个值

- `MASTER_KEY`：32 字节 base64（`openssl rand -base64 32`）
- `VAPID_EMAIL`：`mailto:你的邮箱` 格式
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`：vapidkeys.com 一次生成

**全部走 Secret**（加密存），wrangler.toml 不存任何密钥。

## D1 schema 自动化

worker 第一次调 `init-tenant` 端点时 SDK 会自动 `CREATE TABLE IF NOT EXISTS`（scheduled_messages / push_subscriptions / client_state 等），**不需要手动跑 migration**。

## Cron 触发器

```toml
[triggers]
crons = ["* * * * *"]
```

主动消息 2.0 支持 minute 级精度（比 1.0 的 30 分钟细一截）。Workers Free 每天 10 万次请求，足够个人用。

## 踩坑（按出现顺序）

### 坑 1：原作者把 Worker 入口做成了 SDK 导出
**不要 fork `worker/amsg/src/*.ts`**！原 `@rei-standard/amsg-server/cloudflare` 子路径已经打包好 Worker 适配（dist/cloudflare.mjs + D1 adapter + Web Crypto Web Push 实现 + cron tick）。只写 env 注入 + 调工厂函数。

### 坑 2：仪表盘 Build settings 4 个字段
Root directory `/` / Production branch `preview` / Build command `npm run build:worker:amsg` / Deploy command `npx wrangler deploy` —— 缺一个都跑不通。

### 坑 3：drift warning 是 wrangler 4.x 的常态
`compatibility_date` / `workers_dev` / `preview_urls` 在仪表盘和 wrangler.toml 都有，drift warning 不影响 deploy（只是警告）。`database_id` 这个字段如果手填跟仪表盘不一致，**deploy 会被 remote binding 覆盖**——所以留空让仪表盘管最稳。

### 坑 4：module worker 必须 `export default`
wrangler 4.x 默认按 module worker 格式，缺 default export 触发 10021 错误。

### 坑 5：Build 时变量 vs Runtime 变量
`Build → Variables and secrets` ≠ `Settings → Variables and secrets` —— 前者是 build 时（wrangler deploy 不读），后者是 worker runtime（启动时读）。暮色中间一度把 D1_DATABASE_ID 加到了 Build 那个位置，**根本没用**。

### 坑 6：Vite env 嵌入 vs Worker secret
前端 `VITE_AMSG_API_BASE_URL` 和 `VITE_AMSG_VAPID_PUBLIC_KEY` 是 **Vite build 时**通过 `import.meta.env` 嵌入 bundle 的（**不是** Vercel runtime env）。要改前端连的 worker URL，必须在 Vercel 仪表盘加 env var + Redeploy 重新 build。

## 备注

### 暮色今天 8-5/06 留的活（不属于本 commit）
- `apps/DateApp.tsx` + `components/date/DateSession.tsx` 改动 + `changelogs/2026-08-04-dateapp-3mode-prompt-split.md` + `thought-display-options.html` + `timestamp-position-options.html` 是暮色 8-4 自己的 3 模式 prompt 拆分工作，**等他 commit**。
- 3 个未推 master 的 commit（`8ede348` 时区 UI / `4f38e7c` 删重复声明 / `82a4a74` 全局配置入口）等 worker 部署验证后一起推。

### 端到端 push 验证（新窗口继续）
1. **Vercel dashboard** → Settings → Environment Variables → Add 2 个 var：
   - `VITE_AMSG_API_BASE_URL` = `https://sullyos.<account>.workers.dev`
   - `VITE_AMSG_VAPID_PUBLIC_KEY` = vapidkeys 公钥
   - 三个环境（Production / Preview / Development）都勾上
2. **Redeploy** Vercel（让新 env 嵌入 bundle）
3. **手机**给网站开 Web Push 通知权限
4. **前端 Settings → 主动消息 2.0 全局配置**：
   - 点 "检查用户密钥" → 验证 base URL 通
   - 点 "连接并启用" → 跑 init-tenant（SDK 自动在 D1 建表）
   - 点 "开启通知与推送" → 申请浏览器 push 订阅
5. **角色页**：给麦麦 / 江澈 **启用用主动消息 2.0** + 设 firstSendTime = 当前时间 + 1 分钟
6. **等 1-2 分钟** → 手机应该收到 Web Push 通知
7. **没收到**：Cloudflare 仪表盘 Settings → Observability → Logs = Enable，看 worker 日志排查

### 给未来 330 / miya 复用的部署 checklist
1. **不 fork** 原作者 worker 源码——直接用 SDK 导出
2. 仓库根加 `wrangler.toml` + `worker/<name>/src/index.ts`（80 行 env 注入）+ `scripts/build-workers.mjs`
3. Cloudflare 仪表盘：Create Worker → Build settings 4 字段全对（Root `/` / Branch `preview` / Build `npm run build:worker:<name>` / Deploy `npx wrangler deploy`）
4. Bindings → Add D1 database binding（**Variable name 必须跟 env.DB / env.<name> 一致**）
5. Settings → Variables and secrets → Add 4 个 Secret（MASTER_KEY / VAPID_*）
6. 浏览器 `/capabilities` 验启动
7. Vercel env var（VITE_AMSG_API_BASE_URL / VITE_AMSG_VAPID_PUBLIC_KEY）+ Redeploy
8. 前端 Settings → 主动消息 2.0 → 跑 init-tenant + 启 Web Push 权限

### Worker 调试命令
- `wrangler dev` 跑本地 D1 模拟器
- `wrangler tail` 实时看 worker 日志
- `wrangler d1 execute sully-amsg2 --command "SELECT * FROM scheduled_messages LIMIT 10"` 直接查 D1
