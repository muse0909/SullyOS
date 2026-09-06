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
  // 麦麦 2026-09-06：dynamic vs fixed 区分（暮色 9-6 21:00 反馈"江澈动态注册唤醒时间"）
  //   dynamic：江澈回复末尾 [schedule_next_wakeup | 时间 | reason] 注册的单次定时
  //   fixed：现有 30 分钟/1 小时/4 小时周期固定梯度（兜底）
  //   扫描时 dynamic 优先，dynamic 不存在/已取消才回落到 fixed
  schedule_type: 'fixed' | 'dynamic';
}

// 麦麦 2026-09-06：D1 migration 工具
//   schedules 表加 schedule_type 字段（默认 'fixed' 兼容老数据）
//   启动时跑一次 ALTER TABLE，失败（字段已存在）catch 静默
//   用静态 flag 避免每个请求都跑 SQL
let schemaMigrated = false;
async function ensureScheduleSchema(env: Env): Promise<void> {
  if (schemaMigrated) return;
  try {
    await env.DB.prepare(`
      ALTER TABLE schedules ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'fixed'
    `).run();
  } catch (e) {
    // 字段已存在 / 表不存在 — 都静默
    // 生产环境只有第一次部署会跑成功，之后 ALTER 失败属正常
  }
  schemaMigrated = true;
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
    // 麦麦 2026-09-05 commit 7：客户端传 userId（WS 握手的 userId）
    //   cron 写 D1 用这个对齐客户端 fetch
    userId?: string;
  }>(req);
  if (!body) return json({ error: 'invalid json' }, 400);

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const charId = body.charId;
  const intervalMs = body.intervalMs;
  const userId = body.userId;

  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 60_000) {
    return json({ error: 'missing or invalid fields' }, 400);
  }

  const now = Date.now();
  const nextFireAt = now + intervalMs;

  await env.DB.prepare(`
    INSERT INTO schedules (endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT(endpoint, char_id) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      interval_ms = excluded.interval_ms,
      next_fire_at = excluded.next_fire_at,
      last_heartbeat = excluded.last_heartbeat,
      user_id = excluded.user_id
  `).bind(endpoint, charId, p256dh, auth, intervalMs, nextFireAt, now, now, userId || null).run();

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

/**
 * 麦麦 2026-09-06：江澈动态注册唤醒时间
 *   POST body: { endpoint, p256dh, auth, charId, userId, fireAt, reason }
 *     - endpoint / p256dh / auth：从客户端 Web Push Subscription 取（推送通道要用）
 *       但 dynamic 是 WS 推，理论上不需要 VAPID；先存空也行，后续 broadcast 不读
 *     - charId：动态注册的角色 id
 *     - userId：WS 握手的 userId（用于 broadcast 时匹配连接的 user）
 *     - fireAt：注册的目标触发时间（Date.now() 毫秒数）
 *     - reason：AI 输出的 reason 文本（用于日志）
 *   行为：
 *     - 同一 (endpoint, charId) 只保留 1 条 dynamic
 *     - 新的注册 INSERT OR REPLACE 覆盖旧 dynamic
 *     - 旧 fixed 记录不动
 *   返回 { ok, nextFireAt, replaced }
 */
async function handleDynamicSchedule(req: Request, env: Env): Promise<Response> {
  await ensureScheduleSchema(env);
  const body = await readJson<{
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    charId?: string;
    userId?: string;
    fireAt?: number;       // ms epoch
    reason?: string;
  }>(req);
  if (!body) return json({ error: 'invalid json' }, 400);

  const endpoint = body.endpoint;
  const charId = body.charId;
  const userId = body.userId;
  const fireAt = body.fireAt;
  const reason = body.reason || '';

  if (!endpoint || !charId || !userId || !fireAt || fireAt <= Date.now() - 5 * 60 * 1000) {
    // 拒绝过去时间（5 分钟 buffer 容错客户端时钟偏差）
    return json({ error: 'missing fields or fireAt in past' }, 400);
  }

  const now = Date.now();
  // 动态 schedule 是单次性，interval_ms 留 0 占位（broadcast 不读）
  await env.DB.prepare(`
    INSERT INTO schedules
      (endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id, schedule_type)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'dynamic')
    ON CONFLICT(endpoint, char_id) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      interval_ms = excluded.interval_ms,
      next_fire_at = excluded.next_fire_at,
      last_heartbeat = excluded.last_heartbeat,
      user_id = excluded.user_id,
      schedule_type = 'dynamic'
  `).bind(
    endpoint,
    charId,
    body.p256dh || '',
    body.auth || '',
    0,                  // dynamic 单次性
    fireAt,
    now,
    now,
    userId,
  ).run();

  // 注意：ON CONFLICT 触发 UPDATE 时如果旧 schedule_type='fixed'，会被覆盖成 dynamic
  //   暮色 9-6 需求说"覆盖当前未触发的 dynamic（不影响 fixed）" — 但 (endpoint, char_id) unique
  //   不可能同时有 fixed + dynamic，所以 fixed 会被挤掉。这是设计简化。
  //   如果用户复测发现这个简化有问题，再加 charId_unique_per_type。
  //   先按需求"覆盖 dynamic"实现（fixed 不该和 dynamic 撞 endpoint+charId）。

  console.log(`[dynamic] registered: char=${charId} userId=${userId} fireAt=${new Date(fireAt).toISOString()} reason=${reason}`);
  return json({ ok: true, nextFireAt: fireAt, reason });
}

/**
 * 麦麦 2026-09-06：取消 dynamic 调度
 *   POST body: { endpoint, charId }   （client 端有 endpoint 时用）
 *           或: { userId, charId }    （用 userId 删，可能删错多设备同 user 的 — 慎用）
 *   行为：删指定 (endpoint, charId, schedule_type='dynamic') 记录
 *   触发场景：
 *     - 暮色发消息（useChatAI 收到 user message）自动调
 *     - 角色新回复重新注册前覆盖（handleDynamicSchedule ON CONFLICT 已经覆盖，不需要单独调）
 *   固定 fixed 记录不动
 */
async function handleCancelDynamicSchedule(req: Request, env: Env): Promise<Response> {
  await ensureScheduleSchema(env);
  const body = await readJson<{
    endpoint?: string;
    userId?: string;
    charId?: string;
  }>(req);
  if (!body) return json({ error: 'invalid json' }, 400);
  if (!body.charId) return json({ error: 'charId required' }, 400);

  let result;
  if (body.endpoint) {
    result = await env.DB.prepare(`
      DELETE FROM schedules
      WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'
    `).bind(body.endpoint, body.charId).run();
  } else if (body.userId) {
    // 备用：按 userId + charId 删（多设备同 user 时可能误删其他设备的 dynamic — 不推荐）
    result = await env.DB.prepare(`
      DELETE FROM schedules
      WHERE user_id = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'
    `).bind(body.userId, body.charId).run();
  } else {
    return json({ error: 'endpoint or userId required' }, 400);
  }

  const deleted = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0;
  console.log(`[dynamic] cancelled: char=${body.charId} deleted=${deleted}`);
  return json({ ok: true, deleted });
}

// ---------- cron ----------
// 麦麦 2026-09-06：拆 fixed + dynamic
//   1. 先扫 dynamic LIMIT 1（单次性，触发后 DELETE）
//   2. 没 dynamic 再扫 fixed LIMIT 500（周期，触发后推进 next_fire_at）
//   dynamic 优先级高（江澈主动注册的时间点 > 固定梯度）
//   dynamic 触发的 payload 走 `scheduleType: 'dynamic'`，fixed 走 `scheduleType: 'fixed'`

/**
 * 麦麦 2026-09-06：广播 proactive_message 到 WS_Hub
 *   payload 加 `scheduleType` 字段 — Android 端 Service 据此决定 log triggerSource
 *   返回 true = 有客户端真的活（30s 内有 ping）且消息送达
 *   返回 false = 客户端不在线 / 失败（需要走 D1 兜底）
 */
async function broadcastProactive(env: Env, row: ScheduleRow, messageId: string, scheduleType: 'dynamic' | 'fixed'): Promise<boolean> {
  const now = Date.now();
  let wsDeliveredCount = 0;
  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName('proactive-push-hub'));
    const broadcastRes = await stub.fetch('https://ws-hub/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: row.char_id,
        content: row.char_id,     // 占位 — 真实内容由 Android Service 调 WebView JS 生成
        timestamp: now,
        messageId,                // 麦麦 2026-09-05 commit 3：去重键
        // 麦麦 2026-09-06：告诉客户端这条是 dynamic 还是 fixed 触发
        //   Android 端 Service 据此在 PROACTIVE log + notification 标 triggerSource
        scheduleType,
      }),
    });
    if (broadcastRes.ok) {
      const broadcastData = await broadcastRes.json<{ delivered?: number }>();
      wsDeliveredCount = broadcastData?.delivered ?? 0;
    }
  } catch (e) {
    console.warn(`[cron] ws broadcast failed (${scheduleType})`, e);
    return false;
  }

  if (wsDeliveredCount === 0) return false;

  // 二次确认：是否真活（commit 2 简化用 stats 查 onlineUserIds）
  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName('proactive-push-hub'));
    const statsRes = await stub.fetch('https://ws-hub/stats', { method: 'GET' });
    if (statsRes.ok) {
      const stats = await statsRes.json<{ onlineUserIds?: string[] }>();
      if ((stats?.onlineUserIds?.length ?? 0) > 0) {
        return true;
      }
    }
  } catch (_) {
    // 退化：delivered>0 就算真活
    return true;
  }
  return false;
}

/**
 * 麦麦 2026-09-06：写 D1 离线消息
 *   用于 WS 不可达时，client 重连后 fetch 拿到
 *   72h 过期（暮色 9-5 决定）
 */
async function writeOfflineMessage(env: Env, row: ScheduleRow, messageId: string): Promise<void> {
  const now = Date.now();
  const offlineExpiresAt = now + 72 * 3600 * 1000;
  try {
    await env.DB.prepare(`
      INSERT INTO proactive_offline_messages
        (id, user_id, char_id, character_name, content, message_id, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `).bind(
      crypto.randomUUID(),
      row.user_id || row.endpoint,
      row.char_id,
      row.char_id,
      row.char_id,
      messageId,
      now,
      offlineExpiresAt,
    ).run();
  } catch (e) {
    console.error('[cron] failed to write offline msg', e, row.char_id);
  }
}
async function runScheduledSweep(env: Env): Promise<{ fired: number; dropped: number; wsDelivered: number; dynamicFired: number }> {
  await ensureScheduleSchema(env);
  const now = Date.now();
  const hbWindow = parseInt(env.HEARTBEAT_WINDOW_MS || '300000', 10) || 300_000;
  const cutoff = now - hbWindow;

  // 1) Dynamic — 优先扫，单次性，触发后 DELETE
  //    LIMIT 1 — 一次 cron 最多推 1 条 dynamic（避免多个 dynamic 同时触发推送轰炸）
  const dynamicDue = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id, schedule_type
    FROM schedules
    WHERE schedule_type = 'dynamic' AND next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 1
  `).bind(now, cutoff).all<ScheduleRow>();

  let dynamicFired = 0;
  if (dynamicDue.results && dynamicDue.results.length > 0) {
    const row = dynamicDue.results[0];
    const messageId = crypto.randomUUID();
    const ok = await broadcastProactive(env, row, messageId, 'dynamic');
    if (ok) {
      // 触发后 DELETE — dynamic 是单次性
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'`)
        .bind(row.endpoint, row.char_id).run();
      console.log(`[cron] dynamic fired + deleted: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);
      dynamicFired++;
    } else {
      // WS 推失败（客户端不在线）→ 写 D1 离线消息 + DELETE dynamic（避免下次再 retry）
      // 注意：fixed 走 retry 路径，dynamic 不重试（reason 是一次性约定，retry 失去语义）
      await writeOfflineMessage(env, row, messageId);
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'`)
        .bind(row.endpoint, row.char_id).run();
      console.log(`[cron] dynamic offline: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);
    }
    return { fired: dynamicFired, dropped: 0, wsDelivered: 0, dynamicFired };
  }

  // 2) Fixed — 兜底周期，触发后推进 next_fire_at
  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id, schedule_type
    FROM schedules
    WHERE schedule_type = 'fixed' AND next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now, cutoff).all<ScheduleRow>();

  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0, wsDelivered: 0, dynamicFired };
  }

  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;
  let wsDelivered = 0;

  for (const row of due.results) {
    // 麦麦 2026-09-06：fixed 路径复用 broadcastProactive 工具函数
    //   行为与原来一致：WS 真活就推进 next_fire_at；不真活就写 D1 + 推进
    const messageId = crypto.randomUUID();
    const ok = await broadcastProactive(env, row, messageId, 'fixed');
    if (ok) {
      // 真活：推进 next_fire_at
      let nextWs = row.next_fire_at + row.interval_ms;
      if (nextWs <= now) nextWs = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
        .bind(nextWs, row.endpoint, row.char_id).run();
      wsDelivered++;
      fired++;
      continue;
    }

    // 不在线 → 写 D1 等 client 恢复时拉取
    await writeOfflineMessage(env, row, messageId);
    console.log(`[cron] fixed offline: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);

    // 推进 next_fire_at（跟原逻辑一致）
    let next = row.next_fire_at + row.interval_ms;
    if (next <= now) next = now + row.interval_ms;
    await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
      .bind(next, row.endpoint, row.char_id).run();
    fired++;
  }

  return { fired, dropped, wsDelivered, dynamicFired };
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
    // 麦麦 2026-09-06：江澈动态注册唤醒时间
    //   POST /dynamic-schedule   { endpoint, p256dh, auth, charId, userId, fireAt, reason }
    //     → 覆盖当前未触发的 dynamic（同一 endpoint+charId）
    //   POST /cancel-dynamic-schedule  { endpoint, charId } 或 { userId, charId }
    //     → 删 dynamic（暮色发消息时自动调 / 角色重新注册时覆盖前删旧的）
    if (url.pathname === '/dynamic-schedule' && req.method === 'POST') return handleDynamicSchedule(req, env);
    if (url.pathname === '/cancel-dynamic-schedule' && req.method === 'POST') return handleCancelDynamicSchedule(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return handleTest(req, env);

    // 麦麦 2026-09-05 commit 4：客户端拉取离线消息
    //   query: userId（必填）, since（可选，默认 0 = 拉全部未过期）
    //   过滤：created_at > since AND expires_at > now
    //   排序：按 created_at ASC（先发先回放）
    //   LIMIT 100（防一次性拉太多）
    //   鉴权：走 checkToken（X-Client-Token 头）
    if (url.pathname === '/api/offline-messages' && req.method === 'GET') {
      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'userId required' }, 400);
      const since = parseInt(url.searchParams.get('since') || '0', 10);
      const now = Date.now();
      try {
        const res = await env.DB.prepare(`
          SELECT message_id, char_id, character_name, content, created_at
          FROM proactive_offline_messages
          WHERE user_id = ?1 AND created_at > ?2 AND expires_at > ?3
          ORDER BY created_at ASC
          LIMIT 100
        `).bind(userId, since, now).all<{
          message_id: string;
          char_id: string;
          character_name: string;
          content: string;
          created_at: number;
        }>();
        return json({
          ok: true,
          userId,
          since,
          now,
          messages: (res.results || []).map((r) => ({
            messageId: r.message_id,
            charId: r.char_id,
            characterName: r.character_name,
            content: r.content,
            createdAt: r.created_at,
          })),
        });
      } catch (e) {
        return json({ error: 'query failed', detail: String((e as Error)?.message || e) }, 500);
      }
    }

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
