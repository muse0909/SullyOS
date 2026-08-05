/**
 * 主动消息 2.0 · Cloudflare Worker 入口
 *
 * 作用：
 *   1. HTTP API：给浏览器端 ReiClient 调（init-tenant / schedule-message /
 *      messages / update-message / cancel-message / push-subscription /
 *      client-state / get-user-key 等）。
 *   2. Scheduled (cron)：到点扫 D1，对活着的订阅发 web-push。
 *
 * 复杂度全部在 @rei-standard/amsg-server/cloudflare 子路径里——本文件
 * 只是把 env（VAPID / MASTER_KEY / SERVER_TOKEN / D1 binding）接进 SDK。
 *
 * 部署：
 *   - `npm run build:worker:amsg`  →  出 worker/amsg/worker.bundle.js
 *   - `npx wrangler deploy`        →  Cloudflare Workers 自动部署
 *
 * 绑定 / 变量：
 *   - [[d1_databases]] binding = "DB"            任务表 / 订阅表
 *   - Secret  MASTER_KEY                         32 字节 base64
 *   - Secret  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL
 *   - Var     SERVER_TOKEN（可选，留空放行）      X-Client-Token 鉴权
 *   - Var     CORS_ALLOWED_ORIGIN（可选）        跨域白名单
 *
 * 路由（endsWith 匹配，所以 baseUrl 带不带 /api/v1 前缀都能跑）：
 *   - POST   /init-tenant
 *   - GET    /get-user-key
 *   - POST   /schedule-message
 *   - GET    /messages
 *   - GET    /message?id=<uuid>
 *   - PUT    /update-message
 *   - DELETE /cancel-message
 *   - GET    /vapid-public-key
 *   - GET    /capabilities
 *   - GET/PUT/DELETE /client-state
 *   - GET/PUT/DELETE /push-subscription
 */

import {
  createSingleUserCloudflareWorker,
  createWebCryptoWebPush,
} from "@rei-standard/amsg-server/cloudflare";

export interface Env {
  /** Cloudflare D1 binding（wrangler.toml 里 [[d1_databases]] binding = "DB"） */
  DB: D1Database;

  /** 加密用户消息的 master key（base64 字符串，32 字节随机），用 wrangler secret put 设置 */
  MASTER_KEY: string;

  /** VAPID 密钥对（vapidkeys.com 生成） */
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  /** VAPID 联系邮箱，格式 mailto:xxx@example.com */
  VAPID_EMAIL: string;

  /**
   * 客户端鉴权 token。前端 ReiClient 调任何受保护端点时，
   * 通过 X-Client-Token header 传过来。留空则不校验（本地调试用）。
   * 生产环境必须设一个强随机串。
   */
  SERVER_TOKEN?: string;

  /**
   * init-tenant 端点鉴权（独立于 SERVER_TOKEN）。
   * 留空则 init-tenant 端点不校验（开发模式）。
   */
  INIT_SECRET?: string;

  /**
   * CORS 白名单。填 `*` 或具体 origin（如 https://sully-os-git-preview-muse0909s-projects.vercel.app）。
   * 留空则用 SDK 默认（按请求 origin 回显，浏览器侧记得带 Origin 头）。
   */
  CORS_ALLOWED_ORIGIN?: string;
}

const { fetch, scheduled } = createSingleUserCloudflareWorker(
  async (env: Env) => {
    if (!env.MASTER_KEY) {
      throw new Error("[amsg2-worker] MASTER_KEY is required (set via `wrangler secret put`)");
    }
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_EMAIL) {
      throw new Error(
        "[amsg2-worker] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_EMAIL are required (vapidkeys.com 生成 + wrangler secret put)",
      );
    }

    const vapid = {
      email: env.VAPID_EMAIL,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    };

    return {
      masterKey: env.MASTER_KEY,
      vapid,
      // X-Client-Token 鉴权（SDK 内部读 cfg.serverToken；空串则跳过校验）
      serverToken: (env.SERVER_TOKEN || "").trim() || undefined,
      // Web Push 发送器：纯 Web Crypto 实现，无需 nodejs_compat flag
      webpush: createWebCryptoWebPush(vapid),
      // CORS：填了 origin 就白名单，没填用 SDK 默认（按请求 Origin 回显）
      cors: env.CORS_ALLOWED_ORIGIN
        ? { allowOrigin: env.CORS_ALLOWED_ORIGIN }
        : undefined,
    };
  },
);

export { fetch, scheduled };
