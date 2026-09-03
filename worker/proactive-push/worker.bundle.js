// ../../../../Desktop/SullyOS-master/worker/proactive-push/src/webpush.ts
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
function concatBytes(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
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
async function buildVapidJwt(audience, vapid) {
  const header = { typ: "JWT", alg: "ES256" };
  const claim = {
    aud: audience,
    exp: Math.floor(Date.now() / 1e3) + 12 * 3600,
    // max 24h per spec; 12h is safe
    sub: vapid.subject
  };
  const unsigned = b64uEncode(new TextEncoder().encode(JSON.stringify(header))) + "." + b64uEncode(new TextEncoder().encode(JSON.stringify(claim)));
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapid.signingKey,
    new TextEncoder().encode(unsigned)
  );
  return unsigned + "." + b64uEncode(new Uint8Array(sig));
}
async function hkdf(ikm, salt, info, lengthBytes) {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HKDF" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}
async function encryptAes128Gcm(payload, clientP256dh, clientAuth) {
  const ephemeral = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const clientPubKey = await crypto.subtle.importKey(
    "raw",
    clientP256dh,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPubKey },
    ephemeral.privateKey,
    256
  ));
  const prk = await hkdf(
    ikm,
    clientAuth,
    concatBytes(new TextEncoder().encode("WebPush: info\0"), clientP256dh, ephemeralPubRaw),
    32
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(prk, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(prk, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload, 0);
  padded[payload.length] = 2;
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded));
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false);
  header[20] = 65;
  header.set(ephemeralPubRaw, 21);
  return concatBytes(header, ciphertext);
}
async function sendPush(vapid, sub, payload) {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const url = new URL(sub.endpoint);
  const audience = url.origin;
  const jwt = await buildVapidJwt(audience, vapid);
  const encrypted = await encryptAes128Gcm(
    bytes,
    b64uDecode(sub.p256dh),
    b64uDecode(sub.auth)
  );
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "60",
      // 60s — these are "wake up" pings, stale ones are useless
      "Urgency": "high",
      "Authorization": `vapid t=${jwt}, k=${vapid.publicKeyB64u}`
    },
    body: encrypted
  });
  const gone = res.status === 404 || res.status === 410;
  let responseText;
  if (!res.ok && !gone) {
    try {
      responseText = await res.text();
    } catch {
    }
  }
  return { status: res.status, ok: res.ok, gone, responseText };
}

// ../../../../Desktop/SullyOS-master/worker/proactive-push/src/wsHub.ts
import { DurableObject } from "cloudflare:workers";
var WsHub = class extends DurableObject {
  connections = /* @__PURE__ */ new Map();
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
    if (url.pathname === "/stats" && request.method === "GET") {
      let total = 0;
      const perUser = {};
      for (const [userId, sockets] of this.connections) {
        perUser[userId] = sockets.size;
        total += sockets.size;
      }
      return new Response(JSON.stringify({ ok: true, total, perUser }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
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
        try {
          server.send(JSON.stringify({ type: "pong", t: Date.now() }));
        } catch {
        }
      }
    });
    server.addEventListener("close", () => {
      this.removeSocket(userId, server);
    });
    server.addEventListener("error", () => {
      this.removeSocket(userId, server);
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
    const payload = JSON.stringify({
      type: "proactive_message",
      characterId: body.characterId,
      content: body.content,
      timestamp: body.timestamp ?? Date.now()
    });
    let delivered = 0;
    for (const [userId, sockets] of this.connections) {
      for (const socket of sockets) {
        try {
          socket.send(payload);
          delivered++;
        } catch {
          this.removeSocket(userId, socket);
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  /** 从连接池移除（close / error / send 失败时调用） */
  removeSocket(userId, socket) {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.connections.delete(userId);
  }
};

// ../../../../Desktop/SullyOS-master/worker/proactive-push/src/index.ts
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
  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 6e4) {
    return json({ error: "missing or invalid fields" }, 400);
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
async function runScheduledSweep(env) {
  const now = Date.now();
  const hbWindow = parseInt(env.HEARTBEAT_WINDOW_MS || "300000", 10) || 3e5;
  const cutoff = now - hbWindow;
  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at
    FROM schedules
    WHERE next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now, cutoff).all();
  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0, wsDelivered: 0 };
  }
  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;
  let wsDelivered = 0;
  for (const row of due.results) {
    let wsOk = false;
    try {
      const stub = env.WS_HUB.get(env.WS_HUB.idFromName("proactive-push-hub"));
      const broadcastRes = await stub.fetch("https://ws-hub/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: row.char_id,
          content: row.char_id,
          // 占位 — 后续接角色名/消息文本
          timestamp: now
        })
      });
      if (broadcastRes.ok) {
        const broadcastData = await broadcastRes.json();
        if ((broadcastData?.delivered ?? 0) > 0) {
          wsOk = true;
          wsDelivered += broadcastData.delivered ?? 0;
        }
      }
    } catch (e) {
      console.warn("[cron] ws broadcast failed, falling back to web push", e);
    }
    if (wsOk) {
      let nextWs = row.next_fire_at + row.interval_ms;
      if (nextWs <= now) nextWs = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`).bind(nextWs, row.endpoint, row.char_id).run();
      fired++;
      continue;
    }
    const payload = JSON.stringify({ type: "proactive-wake", charId: row.char_id, t: now });
    try {
      const result = await sendPush(
        vapid,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload
      );
      if (result.gone) {
        await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
        dropped++;
        continue;
      }
      if (!result.ok) {
        console.warn(`[cron] push failed status=${result.status} char=${row.char_id} body=${result.responseText || ""}`);
      }
      let next = row.next_fire_at + row.interval_ms;
      if (next <= now) next = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`).bind(next, row.endpoint, row.char_id).run();
      fired++;
    } catch (e) {
      console.error("[cron] push error", e, row.char_id);
    }
  }
  return { fired, dropped, wsDelivered };
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
    if (url.pathname === "/test" && req.method === "POST") return handleTest(req, env);
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
