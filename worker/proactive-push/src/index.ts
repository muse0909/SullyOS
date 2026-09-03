/**
 * Proactive Push Accelerator — Cloudflare Worker entry point.
 *
 * Two responsibilities:
 *   1. HTTP API for clients (browser) to register/unregister/heartbeat.
 *   2. Scheduled (cron) handler that scans D1 for due schedules whose clients
 *      are still "alive" (recent heartbeat) and sends a minimal wake-up push
 *      (payload = {type:'proactive-wake', charId}).
 *
 * Worker never touches chat content. All AI generation happens on the browser
 * main thread after the SW receives the wake-up push.
 */

import { prepareVapid, sendPush, type VapidContext, type PushSubscription } from './webpush';

// 暮色 2026-08-29 P0 第三步：WebSocket 直推通道（服务端）
// WsHub 是 Durable Object，握住所有在线客户端的 WebSocket 连接
import { WsHub } from './wsHub';
export { WsHub };  // CF Workers 要求 DO class 必须从入口 export

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;     // set via `wrangler secret put`
  VAPID_PRIVATE_KEY: string;    // set via `wrangler secret put`
  VAPID_SUBJECT: string;
  CLIENT_TOKEN: string;         // shared secret (optional; empty = no check)
  HEARTBEAT_WINDOW_MS: string;
  WS_HUB: DurableObjectNamespace;   // 暮色 2026-08-29 P0 第三步：DO binding
}

interface ScheduleRow {
  endpoint: string;
  char_id: string;
  p256dh: string;
  auth: string;
  interval_ms: number;
  next_fire_at: number;
  last_heartbeat: number;
  created_at: number;
}

// ---------- helpers ----------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    },
  });
}

function checkToken(req: Request, env: Env): Response | null {
  if (!env.CLIENT_TOKEN) return null;
  const got = req.headers.get('X-Client-Token');
  if (got !== env.CLIENT_TOKEN) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try { return await req.json() as T; } catch { return null; }
}

let cachedVapid: VapidContext | null = null;
async function getVapid(env: Env): Promise<VapidContext> {
  if (cachedVapid) return cachedVapid;
  cachedVapid = await prepareVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
  return cachedVapid;
}

// ---------- HTTP ----------
async function handleSubscribe(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    charId?: string;
    intervalMs?: number;
  }>(req);
  if (!body) return json({ error: 'invalid json' }, 400);

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const charId = body.charId;
  const intervalMs = body.intervalMs;

  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 60_000) {
    return json({ error: 'missing or invalid fields' }, 400);
  }

  const now = Date.now();
  const nextFireAt = now + intervalMs;

  await env.DB.prepare(`
    INSERT INTO schedules (endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(endpoint, char_id) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      interval_ms = excluded.interval_ms,
      next_fire_at = excluded.next_fire_at,
      last_heartbeat = excluded.last_heartbeat
  `).bind(endpoint, charId, p256dh, auth, intervalMs, nextFireAt, now, now).run();

  return json({ ok: true, nextFireAt });
}

async function handleUnsubscribe(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ endpoint?: string; charId?: string }>(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);

  if (body.charId) {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2`)
      .bind(body.endpoint, body.charId).run();
  } else {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(body.endpoint).run();
  }
  return json({ ok: true });
}

async function handleHeartbeat(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ endpoint?: string }>(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);
  const now = Date.now();
  await env.DB.prepare(`UPDATE schedules SET last_heartbeat = ?1 WHERE endpoint = ?2`)
    .bind(now, body.endpoint).run();
  return json({ ok: true, now });
}

async function handleStatus(req: Request, env: Env): Promise<Response> {
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  const res = await env.DB.prepare(
    `SELECT char_id, interval_ms, next_fire_at, last_heartbeat FROM schedules WHERE endpoint = ?1`
  ).bind(endpoint).all<ScheduleRow>();
  return json({ ok: true, schedules: res.results });
}

/**
 * Manually fire a test push at one subscription.  Used by the in-app
 * diagnostic panel to verify the full delivery chain (Worker → Push Service
 * → SW) without waiting for the cron tick.  Pulls keys from D1 by endpoint
 * so the client only has to send the endpoint URL.
 */
async function handleTest(req: Request, env: Env): Promise<Response> {
  // 麦麦 2026-09-03：改成走 WS broadcast — 不查 schedules / 不发 VAPID
  // 目的：暮色手动 curl 触发，验证 Android KeepAliveService WS onMessage → 弹通知
  // 不需要前端先调 /subscribe 写 schedules（cron 路径才需要）
  const body = await readJson<{ characterId?: string; content?: string }>(req);
  const characterId = body?.characterId || '麦麦';
  const content = body?.content || '麦麦测试消息 — ' + new Date().toISOString();

  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName('proactive-push-hub'));
    const res = await stub.fetch('https://ws-hub/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId,
        content,
        timestamp: Date.now(),
      }),
    });
    const data = await res.json<{ delivered?: number }>();
    return json({
      ok: res.ok,
      status: res.status,
      delivered: data?.delivered ?? 0,
      characterId,
      content,
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
}

// ---------- cron ----------
async function runScheduledSweep(env: Env): Promise<{ fired: number; dropped: number; wsDelivered: number }> {
  const now = Date.now();
  const hbWindow = parseInt(env.HEARTBEAT_WINDOW_MS || '300000', 10) || 300_000;
  const cutoff = now - hbWindow;

  // Pull due + alive rows.  Cap at 500/run so the cron stays within CPU budget.
  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at
    FROM schedules
    WHERE next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now, cutoff).all<ScheduleRow>();

  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0, wsDelivered: 0 };
  }

  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;
  let wsDelivered = 0;

  for (const row of due.results) {
    // 暮色 2026-08-29 P0 第三步：WebSocket 优先 — 有在线客户端就直接推
    //   content 字段目前是 charId 占位（跟 wake push 同级），后续 Android 端
    //   决定怎么展示；广播已送达（delivered>0）就跳过 Web Push 不双发
    let wsOk = false;
    try {
      const stub = env.WS_HUB.get(env.WS_HUB.idFromName('proactive-push-hub'));
      const broadcastRes = await stub.fetch('https://ws-hub/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: row.char_id,
          content: row.char_id,     // 占位 — 后续接角色名/消息文本
          timestamp: now,
        }),
      });
      if (broadcastRes.ok) {
        const broadcastData = await broadcastRes.json<{ delivered?: number }>();
        if ((broadcastData?.delivered ?? 0) > 0) {
          wsOk = true;
          wsDelivered += broadcastData.delivered ?? 0;
        }
      }
    } catch (e) {
      console.warn('[cron] ws broadcast failed, falling back to web push', e);
    }

    // WS 送达 → 跳过 Web Push，但仍推进 next_fire_at（同一条路径维护调度）
    if (wsOk) {
      let nextWs = row.next_fire_at + row.interval_ms;
      if (nextWs <= now) nextWs = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
        .bind(nextWs, row.endpoint, row.char_id).run();
      fired++;
      continue;
    }

    const payload = JSON.stringify({ type: 'proactive-wake', charId: row.char_id, t: now });
    try {
      const result = await sendPush(
        vapid,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
      );
      if (result.gone) {
        // Dead subscription — delete all of this endpoint's rows.
        await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
        dropped++;
        continue;
      }
      if (!result.ok) {
        console.warn(`[cron] push failed status=${result.status} char=${row.char_id} body=${result.responseText || ''}`);
        // Non-permanent failure: still advance next_fire_at so we don't pile up.
      }
      // Advance next_fire_at — compute as "next slot after now" so long offline
      // gaps collapse to one catch-up fire, not dozens.
      let next = row.next_fire_at + row.interval_ms;
      if (next <= now) next = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
        .bind(next, row.endpoint, row.char_id).run();
      fired++;
    } catch (e) {
      console.error('[cron] push error', e, row.char_id);
    }
  }

  return { fired, dropped, wsDelivered };
}

// ---------- main ----------
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(req.url);

    // Public key endpoint — no auth required so clients can fetch it on first use.
    if (url.pathname === '/vapid-public-key' && req.method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
    }

    // Liveness check.
    if (url.pathname === '/health' && req.method === 'GET') {
      return json({ ok: true });
    }

    // 暮色 2026-08-29 P0 第三步：WebSocket upgrade
    //   路径 /ws/push，token 从 query 传（Android OkHttp 简单拼 URL）：
    //     wss://<worker-host>/ws/push?userId=xxx&token=xxx
    //   **必须提到 checkToken 之前** —— 暮色 2026-09-03 反馈握手 401 真因：
    //   checkToken 检查的是 X-Client-Token 头，但 WS 用 query 传，checkToken
    //   在没看到头的情况下直接 401 拦掉了，根本到不了这里。
    //   转发给 Durable Object — WS 连接握在 DO 手里跨 isolate 可见
    //
    // 暮色 2026-09-03 第二轮反馈：即使提到 checkToken 之前，curl 经 HTTP/2
    //   代理访问时 Upgrade 头被 CF 默默丢弃（HTTP/2 协议不支持 Upgrade，
    //   RFC 7540 8.1），导致 req.headers.get('Upgrade') === null，
    //   整个 WS 分支根本进不去。所以这里改成：**只靠 path + query token
    //   鉴权**，不依赖 Upgrade 头；只有真的转发给 DO 时才检查 Upgrade。
    if (url.pathname === '/ws/push') {
      // query token 鉴权 — 跟 HTTP 路由的 X-Client-Token 等价
      const got = url.searchParams.get('token');
      const envTok = env.CLIENT_TOKEN;
      if (envTok) {
        // 失败时返回详细诊断信息（只打长度不打印值，避免 secret 泄露）
        if (got !== envTok) {
          return json({
            error: 'unauthorized',
            reason: 'query token mismatch',
            query_token_len: got?.length ?? 0,
            env_token_len: envTok?.length ?? 0,
            env_token_present: envTok != null && envTok !== '',
            match: got === envTok,
            userId: url.searchParams.get('userId'),
          }, 401);
        }
      }
      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'userId required' }, 400);

      // 真正的 WS upgrade（Android OkHttp 直连会带 Upgrade 头）才转发给 DO
      // 经 HTTP/2 代理时 Upgrade 头被丢 → 走诊断分支（token 验证 + hint）
      if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const stub = env.WS_HUB.get(env.WS_HUB.idFromName('proactive-push-hub'));
        const hubUrl = new URL(req.url);
        hubUrl.pathname = '/connect';
        const upgradeReq = new Request(hubUrl.toString(), req);
        return stub.fetch(upgradeReq);
      }
      // token 通过了但没有 Upgrade 头 — 诊断场景（curl 经 HTTP/2 代理）
      return json({ ok: true, hint: 'token valid, no WS Upgrade header (curl via HTTP/2 proxy). Real clients use HTTP/1.1 + Upgrade.' });
    }

    // All other routes require the shared token if configured.
    const tokenErr = checkToken(req, env);
    if (tokenErr) return tokenErr;

    if (url.pathname === '/subscribe' && req.method === 'POST') return handleSubscribe(req, env);
    if (url.pathname === '/unsubscribe' && req.method === 'POST') return handleUnsubscribe(req, env);
    if (url.pathname === '/heartbeat' && req.method === 'POST') return handleHeartbeat(req, env);
    if (url.pathname === '/status' && req.method === 'GET') return handleStatus(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return handleTest(req, env);

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const result = await runScheduledSweep(env);
      if (result.fired || result.dropped || result.wsDelivered) {
        console.log(`[cron] fired=${result.fired} dropped=${result.dropped} ws=${result.wsDelivered}`);
      }
    })());
  },
};
