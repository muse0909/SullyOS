## wrangler.toml 把 SERVER_TOKEN 改名为 AMSG_SERVER_TOKEN（2026-09-15）

暮色 16:25 反馈 + curl 测 `/vapid-public-key` 和 `/capabilities` 都返回 `INVALID_CLIENT_TOKEN "共享密钥无效或缺失"`。

### 根因

SullyOS wrangler.toml 里写的是：

```toml
[vars]
SERVER_TOKEN = ""
```

但 worker/amsg/src/index.ts:2478 读的是：

```ts
serverToken: env.AMSG_SERVER_TOKEN,  // ← 变量名是 AMSG_SERVER_TOKEN
```

wrangler [vars] 块注入 env 变量时**保持变量名不变**——所以 `env.SERVER_TOKEN = ""` 但 `env.AMSG_SERVER_TOKEN` 实际是 undefined。

但服务端 amsg-server 的 `createSingleUserContextManager` 又对 serverToken 做了非空检查：

```js
const token = String(serverToken || "").trim();
if (!token) return true;  // 放行
// 非空走严格匹配
```

理论上 token undefined → "" → 放行 → 200。但**实际**服务端返回 401 INVALID_CLIENT_TOKEN——说明服务端 env.AMSG_SERVER_TOKEN 实际**非空**（很可能是上次部署时残留的 secret，或 Cloudflare Workers 默认从账号级 env 拉值）。

**为什么 8-6 那次暮色手装时能跑通**？8-6 那次 wrangler.toml 没改过——所以**也是同样的 401**——但当时拾光机可能还没主动消息 2.0 这套逻辑，只用了 web push，不调 /get-user-key 端点，所以一直没暴露这个错。

### 修法

把 `SERVER_TOKEN = ""` 改成 `AMSG_SERVER_TOKEN = ""`——wrangler 注入到 `env.AMSG_SERVER_TOKEN`（Worker 代码读的就是这个名字）。如果 CF 仪表盘 / 之前残留的 serverToken 值还在，它**会覆盖**这个空值，所以**暮色还要去 CF 仪表盘 worker sullyos → Variables and Secrets → 检查有没有 AMSG_SERVER_TOKEN，有就删掉**。

### 摸底

- `npx vite build` ✓ 4.83s
- wrangler.toml 已改

### 暮色下一步

1. 终端跑 `npm run deploy:worker:amsg` 重部署（让 wrangler 把 `env.AMSG_SERVER_TOKEN = ""` 覆盖现有非空值）
2. CF 仪表盘 worker sullyos → Variables and Secrets → 检查 AMSG_SERVER_TOKEN 是否还在 → 如果在删掉3. curl `https://sullyos.1812038909.workers.dev/capabilities` 验证返回 200
4. 拾光机点"重新连接并验证"

### 未触动

- Worker bundle / VAPID 三件套没动
- 拾光机前端 modal "已连接"已 OK（master_KEY 配了就行）
- 真正的 401 INVALID_CLIENT_TOKEN 修完推送链路才完整

### 顺手观察

curl /vapid-public-key 直接返回 401 INVALID_CLIENT_TOKEN 而**不是** VAPID_NOT_CONFIGURED——说明服务端鉴权在任何端点都先跑过了。所以修完这个，/vapid-public-key 应该会跳到 503 VAPID_NOT_CONFIGURED（说明 VAPID 三件套还没配）。**那就要再加 VAPID 三件套**才能完全跑通推送链路。

如果暮色想直接跑通推送链路（不光是 modal"已连接"），需要再去 CF 仪表盘加 3 个 VAPID Secret（VAPID_EMAIL / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）+ 让 wrangler.toml 覆盖 AMSG_SERVER_TOKEN（如果仪表盘残留）。