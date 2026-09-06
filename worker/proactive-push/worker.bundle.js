// worker/proactive-push/src/webpush.ts
var B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
    out += B64_CHARS[n >> 18 & 63] + B64_CHARS[n >> 12 & 63] + B64_CHARS[n >> 6 & 63] + B64_CHARS[n & 63];
  }
  if (i < bytes.length) {
    const n = bytes[i] << 16 | (bytes[i + 1] || 0) << 8;
    out += B64_CHARS[n >> 18 & 63] + B64_CHARS[n >> 12 & 63];
    if (i + 1 < bytes.length) out += B64_CHARS[n >> 6 & 63];
  }
  return out;
}
function b64uDecode(s) {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - clean.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function prepareVapid(publicKeyB64u, privateKeyB64u, subject) {
  const pub = b64uDecode(publicKeyB64u);
  const priv = b64uDecode(privateKeyB64u);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be 65-byte uncompressed P-256 point");
  if (priv.length !== 32) throw new Error("VAPID private key must be 32 bytes");
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: b64uEncode(pub.slice(1, 33)),
      y: b64uEncode(pub.slice(33, 65)),
      d: b64uEncode(priv),
      ext: false
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  return { publicKeyB64u, signingKey, subject };
}

// worker/proactive-push/src/wsHub.ts
import { DurableObject } from "cloudflare:workers";
var WsHub = class _WsHub extends DurableObject {
  connections = /* @__PURE__ */ new Map();
  // 麦麦 2026-09-05：每 userId 最近一次 ping 的 epoch ms
  //   用来给 cron 提供"真实在线"判断（30s 内有 ping 才算真活）—
  //   Doze 期间 client socket 还在但 OkHttp 线程冻住，delivered>0 不可靠
  lastPingAt = /* @__PURE__ */ new Map();
  // 麦麦 2026-09-05：30 秒内有 ping 算真活。30s 是 PING_INTERVAL_MS 30_000 + 抖动 buffer
  //   跟 commit 1 客户端心跳一致（30s + 8s wakelock = 38s 上限）
  static ONLINE_THRESHOLD_MS = 3e4;
  // 麦麦 2026-09-03：CF 静态分析只认 extends DurableObject，不认 implements DurableObject
  // 加显式 constructor 把 ctx/env 传给 super — DurableObject 父类要求
  constructor(state, env) {
    super(state, env);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/connect") {
      return this.handleConnect(request);
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }
    if (url.pathname.startsWith("/online/") && request.method === "GET") {
      const userId = decodeURIComponent(url.pathname.slice("/online/".length));
      const last = this.lastPingAt.get(userId);
      const reallyOnline = last !== void 0 && Date.now() - last < _WsHub.ONLINE_THRESHOLD_MS;
      return new Response(JSON.stringify({
        ok: true,
        userId,
        reallyOnline,
        lastPingAt: last ?? null,
        socketCount: this.connections.get(userId)?.size ?? 0
      }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/stats" && request.method === "GET") {
      let total = 0;
      const perUser = {};
      const now = Date.now();
      for (const [userId, sockets] of this.connections) {
        perUser[userId] = sockets.size;
        total += sockets.size;
      }
      return new Response(JSON.stringify({
        ok: true,
        total,
        perUser,
        // 麦麦 2026-09-05：补真实在线统计
        onlineUserIds: Array.from(this.lastPingAt.entries()).filter(([_, t]) => now - t < _WsHub.ONLINE_THRESHOLD_MS).map(([uid]) => uid)
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  // 麦麦 2026-09-05：外部查询 userId 是否真实在线（30s 内有 ping）
  isReallyOnline(userId) {
    const t = this.lastPingAt.get(userId);
    return t !== void 0 && Date.now() - t < _WsHub.ONLINE_THRESHOLD_MS;
  }
  /**
   * 处理 WebSocket upgrade。
   * userId 从 query 拿（index.ts 已校验过 token）。
   */
  handleConnect(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    let set = this.connections.get(userId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.connections.set(userId, set);
    }
    set.add(server);
    server.addEventListener("message", (event) => {
      let type = "";
      try {
        const data = JSON.parse(event.data);
        type = data?.type ?? "";
      } catch {
        return;
      }
      if (type === "ping") {
        this.lastPingAt.set(userId, Date.now());
        try {
          server.send(JSON.stringify({ type: "pong", t: Date.now() }));
        } catch {
        }
      }
    });
    server.addEventListener("close", () => {
      this.removeSocket(userId, server);
      this.cleanupPingAt(userId, server);
    });
    server.addEventListener("error", () => {
      this.removeSocket(userId, server);
      this.cleanupPingAt(userId, socket);
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  /**
   * 广播 proactive_message 给所有在线用户。
   * Worker 侧在 cron 里调用（POST body: { characterId, content, timestamp }）。
   *
   * 返回 { delivered: N }，Worker 用它判断"是否有在线用户收到"决定是否跳过 Web Push。
   */
  async handleBroadcast(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    if (!body.characterId || !body.content) {
      return new Response(JSON.stringify({ error: "characterId and content required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const { characterId, content, timestamp, ...extras } = body;
    const payload = JSON.stringify({
      type: "proactive_message",
      characterId,
      content,
      timestamp: timestamp ?? Date.now(),
      ...extras
    });
    let delivered = 0;
    for (const [userId, sockets] of this.connections) {
      for (const socket2 of sockets) {
        try {
          socket2.send(payload);
          delivered++;
        } catch {
          this.removeSocket(userId, socket2);
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  /** 从连接池移除（close / error / send 失败时调用） */
  removeSocket(userId, socket2) {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(socket2);
    if (set.size === 0) this.connections.delete(userId);
  }
  /**
   * 麦麦 2026-09-05：socket 关闭时清 lastPingAt。
   *   只有当 userId 下所有 socket 都关掉时才删 entry —— 单个 socket 关闭但
   *   同一 userId 还有别的 socket（多端连接）时仍记最新 ping。
   */
  cleanupPingAt(userId, _closedSocket) {
    const set = this.connections.get(userId);
    if (!set || set.size === 0) {
      this.lastPingAt.delete(userId);
    }
  }
};

// worker/proactive-push/src/index.ts
var schemaMigrated = false;
async function ensureScheduleSchema(env) {
  if (schemaMigrated) return;
  try {
    await env.DB.prepare(`
      ALTER TABLE schedules ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'fixed'
    `).run();
  } catch (e) {
  }
  schemaMigrated = true;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Client-Token",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
    }
  });
}
function checkToken(req, env) {
  if (!env.CLIENT_TOKEN) return null;
  const got = req.headers.get("X-Client-Token");
  if (got !== env.CLIENT_TOKEN) return json({ error: "unauthorized" }, 401);
  return null;
}
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
var cachedVapid = null;
async function getVapid(env) {
  if (cachedVapid) return cachedVapid;
  cachedVapid = await prepareVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
  return cachedVapid;
}
async function handleSubscribe(req, env) {
  const body = await readJson(req);
  if (!body) return json({ error: "invalid json" }, 400);
  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const charId = body.charId;
  const intervalMs = body.intervalMs;
  const userId = body.userId;
  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 6e4) {
    return json({ error: "missing or invalid fields" }, 400);
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
async function handleUnsubscribe(req, env) {
  const body = await readJson(req);
  if (!body?.endpoint) return json({ error: "endpoint required" }, 400);
  if (body.charId) {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2`).bind(body.endpoint, body.charId).run();
  } else {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(body.endpoint).run();
  }
  return json({ ok: true });
}
async function handleHeartbeat(req, env) {
  const body = await readJson(req);
  if (!body?.endpoint) return json({ error: "endpoint required" }, 400);
  const now = Date.now();
  await env.DB.prepare(`UPDATE schedules SET last_heartbeat = ?1 WHERE endpoint = ?2`).bind(now, body.endpoint).run();
  return json({ ok: true, now });
}
async function handleStatus(req, env) {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return json({ error: "endpoint required" }, 400);
  const res = await env.DB.prepare(
    `SELECT char_id, interval_ms, next_fire_at, last_heartbeat FROM schedules WHERE endpoint = ?1`
  ).bind(endpoint).all();
  return json({ ok: true, schedules: res.results });
}
async function handleTest(req, env) {
  const body = await readJson(req);
  const characterId = body?.characterId || "\u9EA6\u9EA6";
  const content = body?.content || "\u9EA6\u9EA6\u6D4B\u8BD5\u6D88\u606F \u2014 " + (/* @__PURE__ */ new Date()).toISOString();
  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName("proactive-push-hub"));
    const res = await stub.fetch("https://ws-hub/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId,
        content,
        timestamp: Date.now()
      })
    });
    const data = await res.json();
    return json({
      ok: res.ok,
      status: res.status,
      delivered: data?.delivered ?? 0,
      characterId,
      content
    });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
async function handleDynamicSchedule(req, env) {
  await ensureScheduleSchema(env);
  const body = await readJson(req);
  if (!body) return json({ error: "invalid json" }, 400);
  const endpoint = body.endpoint;
  const charId = body.charId;
  const userId = body.userId;
  const fireAt = body.fireAt;
  const reason = body.reason || "";
  if (!endpoint || !charId || !userId || !fireAt || fireAt <= Date.now() - 5 * 60 * 1e3) {
    return json({ error: "missing fields or fireAt in past" }, 400);
  }
  const now = Date.now();
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
    body.p256dh || "",
    body.auth || "",
    0,
    // dynamic 单次性
    fireAt,
    now,
    now,
    userId
  ).run();
  console.log(`[dynamic] registered: char=${charId} userId=${userId} fireAt=${new Date(fireAt).toISOString()} reason=${reason}`);
  return json({ ok: true, nextFireAt: fireAt, reason });
}
async function handleCancelDynamicSchedule(req, env) {
  await ensureScheduleSchema(env);
  const body = await readJson(req);
  if (!body) return json({ error: "invalid json" }, 400);
  if (!body.charId) return json({ error: "charId required" }, 400);
  let result;
  if (body.endpoint) {
    result = await env.DB.prepare(`
      DELETE FROM schedules
      WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'
    `).bind(body.endpoint, body.charId).run();
  } else if (body.userId) {
    result = await env.DB.prepare(`
      DELETE FROM schedules
      WHERE user_id = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'
    `).bind(body.userId, body.charId).run();
  } else {
    result = await env.DB.prepare(`
      DELETE FROM schedules
      WHERE char_id = ?1 AND schedule_type = 'dynamic'
    `).bind(body.charId).run();
  }
  const deleted = result?.meta?.changes ?? result?.changes ?? 0;
  console.log(`[dynamic] cancelled: char=${body.charId} deleted=${deleted}`);
  return json({ ok: true, deleted });
}
async function broadcastProactive(env, row, messageId, scheduleType) {
  const now = Date.now();
  let wsDeliveredCount = 0;
  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName("proactive-push-hub"));
    const broadcastRes = await stub.fetch("https://ws-hub/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: row.char_id,
        content: row.char_id,
        // 占位 — 真实内容由 Android Service 调 WebView JS 生成
        timestamp: now,
        messageId,
        // 麦麦 2026-09-05 commit 3：去重键
        // 麦麦 2026-09-06：告诉客户端这条是 dynamic 还是 fixed 触发
        //   Android 端 Service 据此在 PROACTIVE log + notification 标 triggerSource
        scheduleType
      })
    });
    if (broadcastRes.ok) {
      const broadcastData = await broadcastRes.json();
      wsDeliveredCount = broadcastData?.delivered ?? 0;
    }
  } catch (e) {
    console.warn(`[cron] ws broadcast failed (${scheduleType})`, e);
    return false;
  }
  if (wsDeliveredCount === 0) return false;
  try {
    const stub = env.WS_HUB.get(env.WS_HUB.idFromName("proactive-push-hub"));
    const statsRes = await stub.fetch("https://ws-hub/stats", { method: "GET" });
    if (statsRes.ok) {
      const stats = await statsRes.json();
      if ((stats?.onlineUserIds?.length ?? 0) > 0) {
        return true;
      }
    }
  } catch (_) {
    return true;
  }
  return false;
}
async function writeOfflineMessage(env, row, messageId) {
  const now = Date.now();
  const offlineExpiresAt = now + 72 * 3600 * 1e3;
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
      offlineExpiresAt
    ).run();
  } catch (e) {
    console.error("[cron] failed to write offline msg", e, row.char_id);
  }
}
async function runScheduledSweep(env) {
  await ensureScheduleSchema(env);
  const now = Date.now();
  const hbWindow = parseInt(env.HEARTBEAT_WINDOW_MS || "300000", 10) || 3e5;
  const cutoff = now - hbWindow;
  const dynamicDue = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id, schedule_type
    FROM schedules
    WHERE schedule_type = 'dynamic' AND next_fire_at <= ?1
    ORDER BY next_fire_at ASC
    LIMIT 1
  `).bind(now).all();
  let dynamicFired = 0;
  if (dynamicDue.results && dynamicDue.results.length > 0) {
    const row = dynamicDue.results[0];
    const messageId = crypto.randomUUID();
    const ok = await broadcastProactive(env, row, messageId, "dynamic");
    if (ok) {
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'`).bind(row.endpoint, row.char_id).run();
      console.log(`[cron] dynamic fired + deleted: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);
      dynamicFired++;
    } else {
      await writeOfflineMessage(env, row, messageId);
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2 AND schedule_type = 'dynamic'`).bind(row.endpoint, row.char_id).run();
      console.log(`[cron] dynamic offline: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);
    }
    return { fired: dynamicFired, dropped: 0, wsDelivered: 0, dynamicFired };
  }
  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at, user_id, schedule_type
    FROM schedules
    WHERE schedule_type = 'fixed' AND next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now, cutoff).all();
  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0, wsDelivered: 0, dynamicFired };
  }
  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;
  let wsDelivered = 0;
  for (const row of due.results) {
    const messageId = crypto.randomUUID();
    const ok = await broadcastProactive(env, row, messageId, "fixed");
    if (ok) {
      let nextWs = row.next_fire_at + row.interval_ms;
      if (nextWs <= now) nextWs = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`).bind(nextWs, row.endpoint, row.char_id).run();
      wsDelivered++;
      fired++;
      continue;
    }
    await writeOfflineMessage(env, row, messageId);
    console.log(`[cron] fixed offline: char=${row.char_id} userId=${row.user_id} msgId=${messageId}`);
    let next = row.next_fire_at + row.interval_ms;
    if (next <= now) next = now + row.interval_ms;
    await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`).bind(next, row.endpoint, row.char_id).run();
    fired++;
  }
  return { fired, dropped, wsDelivered, dynamicFired };
}
var src_default = {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, X-Client-Token",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    const url = new URL(req.url);
    if (url.pathname === "/vapid-public-key" && req.method === "GET") {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || "" });
    }
    if (url.pathname === "/health" && req.method === "GET") {
      return json({ ok: true });
    }
    if (url.pathname === "/ws/push") {
      const got = url.searchParams.get("token");
      const envTok = env.CLIENT_TOKEN;
      if (envTok) {
        if (got !== envTok) {
          return json({
            error: "unauthorized",
            reason: "query token mismatch",
            query_token_len: got?.length ?? 0,
            env_token_len: envTok?.length ?? 0,
            env_token_present: envTok != null && envTok !== "",
            match: got === envTok,
            userId: url.searchParams.get("userId")
          }, 401);
        }
      }
      const userId = url.searchParams.get("userId");
      if (!userId) return json({ error: "userId required" }, 400);
      if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const stub = env.WS_HUB.get(env.WS_HUB.idFromName("proactive-push-hub"));
        const hubUrl = new URL(req.url);
        hubUrl.pathname = "/connect";
        const upgradeReq = new Request(hubUrl.toString(), req);
        return stub.fetch(upgradeReq);
      }
      return json({ ok: true, hint: "token valid, no WS Upgrade header (curl via HTTP/2 proxy). Real clients use HTTP/1.1 + Upgrade." });
    }
    const tokenErr = checkToken(req, env);
    if (tokenErr) return tokenErr;
    if (url.pathname === "/subscribe" && req.method === "POST") return handleSubscribe(req, env);
    if (url.pathname === "/unsubscribe" && req.method === "POST") return handleUnsubscribe(req, env);
    if (url.pathname === "/heartbeat" && req.method === "POST") return handleHeartbeat(req, env);
    if (url.pathname === "/status" && req.method === "GET") return handleStatus(req, env);
    if (url.pathname === "/dynamic-schedule" && req.method === "POST") return handleDynamicSchedule(req, env);
    if (url.pathname === "/cancel-dynamic-schedule" && req.method === "POST") return handleCancelDynamicSchedule(req, env);
    if (url.pathname === "/test" && req.method === "POST") return handleTest(req, env);
    if (url.pathname === "/api/offline-messages" && req.method === "GET") {
      const userId = url.searchParams.get("userId");
      if (!userId) return json({ error: "userId required" }, 400);
      const since = parseInt(url.searchParams.get("since") || "0", 10);
      const now = Date.now();
      try {
        const res = await env.DB.prepare(`
          SELECT message_id, char_id, character_name, content, created_at
          FROM proactive_offline_messages
          WHERE user_id = ?1 AND created_at > ?2 AND expires_at > ?3
          ORDER BY created_at ASC
          LIMIT 100
        `).bind(userId, since, now).all();
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
            createdAt: r.created_at
          }))
        });
      } catch (e) {
        return json({ error: "query failed", detail: String(e?.message || e) }, 500);
      }
    }
    return json({ error: "not found" }, 404);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runScheduledSweep(env);
      if (result.fired || result.dropped || result.wsDelivered) {
        console.log(`[cron] fired=${result.fired} dropped=${result.dropped} ws=${result.wsDelivered}`);
      }
    })());
  }
};
export {
  WsHub,
  src_default as default
};
