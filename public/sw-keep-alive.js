// node_modules/@rei-standard/amsg-sw/dist/index.mjs
var REI_SW_DB_NAME = "rei-sw";
var REI_SW_DB_STORE = "request-outbox";
var REI_SW_DB_VERSION = 1;
var REI_SW_SYNC_TAG = "rei-sw-flush-request-outbox";
var REI_AMSG_POSTMESSAGE_TYPE = "REI_AMSG_PUSH";
var REI_SW_EVENT = Object.freeze({
  CONTENT_RECEIVED: "rei-amsg-content-received",
  REASONING_RECEIVED: "rei-amsg-reasoning-received",
  TOOL_REQUEST_RECEIVED: "rei-amsg-tool-request-received",
  ERROR_RECEIVED: "rei-amsg-error-received",
  UNKNOWN_RECEIVED: "rei-amsg-unknown-received"
});
var REI_SW_MESSAGE_TYPE = Object.freeze({
  ENQUEUE_REQUEST: "REI_ENQUEUE_REQUEST",
  FLUSH_QUEUE: "REI_FLUSH_QUEUE",
  QUEUE_RESULT: "REI_QUEUE_RESULT"
});
function installReiSW(sw2, opts = {}) {
  const defaultIcon = opts.defaultIcon || "/icon-192x192.png";
  const defaultBadge = opts.defaultBadge || "/badge-72x72.png";
  sw2.addEventListener("push", (event) => {
    const payload = readPushPayload(event);
    if (!payload) return;
    const eventName = resolveEventName(payload);
    const shouldRenderNotification = isNotificationKind(payload);
    const work = [dispatchPushToClients(sw2, eventName, payload)];
    if (shouldRenderNotification) {
      const notification = createNotificationFromPayload(payload, {
        defaultIcon,
        defaultBadge
      });
      if (notification) {
        work.push(
          sw2.registration.showNotification(notification.title, notification.options)
        );
      }
    }
    event.waitUntil(Promise.all(work));
  });
  sw2.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (message.type === REI_SW_MESSAGE_TYPE.ENQUEUE_REQUEST) {
      event.waitUntil(
        enqueueAndFlush(sw2, event, message.request)
      );
      return;
    }
    if (message.type === REI_SW_MESSAGE_TYPE.FLUSH_QUEUE) {
      event.waitUntil(flushQueuedRequests(sw2));
    }
  });
  sw2.addEventListener("sync", (event) => {
    if (event.tag !== REI_SW_SYNC_TAG) return;
    event.waitUntil(flushQueuedRequests(sw2));
  });
}
function resolveEventName(payload) {
  const kind = payload && typeof payload === "object" ? payload.messageKind : void 0;
  switch (kind) {
    case "content":
      return REI_SW_EVENT.CONTENT_RECEIVED;
    case "reasoning":
      return REI_SW_EVENT.REASONING_RECEIVED;
    case "tool_request":
      return REI_SW_EVENT.TOOL_REQUEST_RECEIVED;
    case "error":
      return REI_SW_EVENT.ERROR_RECEIVED;
    default:
      return REI_SW_EVENT.UNKNOWN_RECEIVED;
  }
}
function isNotificationKind(payload) {
  if (!payload || typeof payload !== "object") return false;
  const kind = payload.messageKind;
  if (kind === void 0 || kind === null) return true;
  return kind === "content";
}
async function dispatchPushToClients(sw2, eventName, payload) {
  try {
    const clientList = await sw2.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });
    const envelope = {
      type: REI_AMSG_POSTMESSAGE_TYPE,
      event: eventName,
      payload
    };
    for (const client of clientList) {
      try {
        client.postMessage(envelope);
      } catch (_postError) {
      }
    }
  } catch (_matchError) {
  }
}
function readPushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch (_jsonError) {
    try {
      return { message: event.data.text() };
    } catch (_textError) {
      return null;
    }
  }
}
function createNotificationFromPayload(payload, defaults) {
  if (!payload || typeof payload !== "object") {
    return {
      title: "New notification",
      options: {
        body: String(payload || ""),
        icon: defaults.defaultIcon,
        badge: defaults.defaultBadge
      }
    };
  }
  const pushNotification = payload.notification && typeof payload.notification === "object" ? payload.notification : {};
  const title = pushNotification.title || payload.title || "New notification";
  const body = pushNotification.body || payload.body || payload.message || "";
  const data = payload.data && typeof payload.data === "object" ? { ...payload.data } : {};
  if (data.payload == null) data.payload = payload;
  return {
    title,
    options: {
      body,
      icon: pushNotification.icon || payload.icon || payload.avatarUrl || defaults.defaultIcon,
      badge: pushNotification.badge || payload.badge || defaults.defaultBadge,
      tag: pushNotification.tag || payload.tag || payload.messageId || `rei-${Date.now()}`,
      data,
      renotify: Boolean(pushNotification.renotify ?? payload.renotify ?? false),
      requireInteraction: Boolean(
        pushNotification.requireInteraction ?? payload.requireInteraction ?? false
      )
    }
  };
}
async function enqueueAndFlush(sw2, event, requestPayload) {
  try {
    const request = normalizeQueuedRequest(requestPayload);
    const queueId = await addQueuedRequest(request);
    await registerFlushSync(sw2);
    await flushQueuedRequests(sw2);
    respondToSender(event, {
      type: REI_SW_MESSAGE_TYPE.QUEUE_RESULT,
      ok: true,
      queueId
    });
  } catch (error) {
    respondToSender(event, {
      type: REI_SW_MESSAGE_TYPE.QUEUE_RESULT,
      ok: false,
      error: error instanceof Error ? error.message : "Failed to queue request"
    });
  }
}
function normalizeQueuedRequest(requestPayload) {
  if (!requestPayload || typeof requestPayload !== "object") {
    throw new Error("[rei-standard-amsg-sw] `request` payload is required");
  }
  const url = typeof requestPayload.url === "string" ? requestPayload.url.trim() : "";
  if (!url) throw new Error("[rei-standard-amsg-sw] `request.url` is required");
  const method = typeof requestPayload.method === "string" ? requestPayload.method.toUpperCase() : "POST";
  const headers = normalizeHeaders(requestPayload.headers);
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? normalizeRequestBody(requestPayload.body) : void 0;
  if (hasBody && body && !hasHeader(headers, "content-type") && typeof requestPayload.body === "object") {
    headers["content-type"] = "application/json";
  }
  return {
    url,
    method,
    headers,
    body,
    createdAt: Date.now()
  };
}
function normalizeHeaders(headersInput) {
  const headers = {};
  if (!headersInput || typeof headersInput !== "object") return headers;
  for (const [key, value] of Object.entries(headersInput)) {
    if (value == null) continue;
    headers[String(key).toLowerCase()] = String(value);
  }
  return headers;
}
function hasHeader(headers, name) {
  const target = String(name || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(headers, target);
}
function normalizeRequestBody(bodyInput) {
  if (bodyInput == null) return "";
  if (typeof bodyInput === "string") return bodyInput;
  try {
    return JSON.stringify(bodyInput);
  } catch (_error) {
    throw new Error("[rei-standard-amsg-sw] request body is not serializable");
  }
}
async function flushQueuedRequests(sw2) {
  const queuedRequests = await listQueuedRequests();
  for (const queuedRequest of queuedRequests) {
    const canDelete = await trySendQueuedRequest(queuedRequest);
    if (!canDelete) {
      await registerFlushSync(sw2);
      return;
    }
    await removeQueuedRequest(queuedRequest.id);
  }
}
async function trySendQueuedRequest(queuedRequest) {
  try {
    const response = await fetch(queuedRequest.url, {
      method: queuedRequest.method,
      headers: queuedRequest.headers,
      body: queuedRequest.body
    });
    if (response.ok || response.status >= 400 && response.status < 500) {
      return true;
    }
    return false;
  } catch (_error) {
    return false;
  }
}
async function registerFlushSync(sw2) {
  const syncManager = sw2.registration && sw2.registration.sync;
  if (!syncManager || typeof syncManager.register !== "function") return;
  try {
    await syncManager.register(REI_SW_SYNC_TAG);
  } catch (_error) {
  }
}
function respondToSender(event, message) {
  const messagePort = event.ports && event.ports[0];
  if (messagePort && typeof messagePort.postMessage === "function") {
    messagePort.postMessage(message);
    return;
  }
  const source = event.source;
  if (source && typeof source.postMessage === "function") {
    source.postMessage(message);
  }
}
function openQueueDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REI_SW_DB_NAME, REI_SW_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(REI_SW_DB_STORE)) return;
      db.createObjectStore(REI_SW_DB_STORE, { keyPath: "id", autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open queue database"));
  });
}
async function withQueueStore(mode, handler) {
  const db = await openQueueDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(REI_SW_DB_STORE, mode);
      const store = transaction.objectStore(REI_SW_DB_STORE);
      transaction.oncomplete = () => resolve(void 0);
      transaction.onerror = () => reject(transaction.error || new Error("Queue transaction failed"));
      Promise.resolve(handler(store, resolve, reject)).catch(reject);
    });
  } finally {
    db.close();
  }
}
async function addQueuedRequest(request) {
  return withQueueStore("readwrite", (store, resolve, reject) => {
    const addRequest = store.add(request);
    addRequest.onsuccess = () => resolve(addRequest.result);
    addRequest.onerror = () => reject(addRequest.error || new Error("Failed to queue request"));
  });
}
async function listQueuedRequests() {
  return withQueueStore("readonly", (store, resolve, reject) => {
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      const list = Array.isArray(allRequest.result) ? allRequest.result : [];
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      resolve(list);
    };
    allRequest.onerror = () => reject(allRequest.error || new Error("Failed to read queue"));
  });
}
async function removeQueuedRequest(id) {
  return withQueueStore("readwrite", (store, resolve, reject) => {
    const deleteRequest = store.delete(id);
    deleteRequest.onsuccess = () => resolve(void 0);
    deleteRequest.onerror = () => reject(deleteRequest.error || new Error("Failed to remove queued request"));
  });
}

// worker/sw-keep-alive.ts
var SW_VERSION = "1.4.0";
var PING_INTERVAL = 15e3;
var MAX_MANUAL_ALIVE_MS = 5 * 6e4;
var ACTIVE_MSG_DB_NAME = "ActiveMsg";
var ACTIVE_MSG_DB_VERSION = 2;
var ACTIVE_MSG_INBOX_STORE = "inbox";
var ACTIVE_MSG_OUTBOUND_SESSIONS_STORE = "outbound_sessions";
var ACTIVE_MSG_PENDING_TOOL_CALLS_STORE = "pending_tool_calls";
var ACTIVE_MSG_REASONING_BUFFER_STORE = "reasoning_buffer";
var pingTimer = null;
var manualKeepAliveCount = 0;
var manualKeepAliveStartedAt = 0;
var proactiveSchedules = /* @__PURE__ */ new Map();
var proactiveTimers = /* @__PURE__ */ new Map();
var sw = self;
installReiSW(sw, {
  defaultIcon: "./icons/icon-192.png",
  defaultBadge: "./icons/icon-192.png"
});
function hasActiveProactiveSchedules() {
  return proactiveTimers.size > 0;
}
function shouldKeepAlive() {
  return manualKeepAliveCount > 0 || hasActiveProactiveSchedules();
}
function stopPingLoop() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}
function ensurePingLoop() {
  if (pingTimer) return;
  pingTimer = setInterval(() => {
    if (manualKeepAliveCount > 0 && Date.now() - manualKeepAliveStartedAt > MAX_MANUAL_ALIVE_MS) {
      manualKeepAliveCount = 0;
      manualKeepAliveStartedAt = 0;
    }
    if (!shouldKeepAlive()) {
      stopPingLoop();
      return;
    }
    sw.registration.active?.postMessage({ type: "ping" });
  }, PING_INTERVAL);
}
function refreshKeepAlive() {
  if (shouldKeepAlive()) ensurePingLoop();
  else stopPingLoop();
}
function startKeepAlive() {
  manualKeepAliveCount += 1;
  if (!manualKeepAliveStartedAt) manualKeepAliveStartedAt = Date.now();
  refreshKeepAlive();
}
function stopKeepAlive() {
  if (manualKeepAliveCount > 0) manualKeepAliveCount -= 1;
  if (manualKeepAliveCount === 0) manualKeepAliveStartedAt = 0;
  refreshKeepAlive();
}
async function notifyClients(data) {
  const clients = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(data);
  }
}
function fireProactiveTrigger(charId) {
  void notifyClients({ type: "proactive-trigger", charId });
}
function stopProactive(charId) {
  const timer = proactiveTimers.get(charId);
  if (timer) {
    clearInterval(timer);
    proactiveTimers.delete(charId);
  }
  proactiveSchedules.delete(charId);
}
function upsertProactive(config) {
  const prev = proactiveSchedules.get(config.charId);
  const unchanged = prev && prev.intervalMs === config.intervalMs;
  if (unchanged && proactiveTimers.has(config.charId)) return;
  stopProactive(config.charId);
  proactiveSchedules.set(config.charId, config);
  const timer = setInterval(() => fireProactiveTrigger(config.charId), config.intervalMs);
  proactiveTimers.set(config.charId, timer);
}
function syncProactive(configs) {
  const nextIds = new Set((configs || []).map((config) => config.charId));
  for (const charId of Array.from(proactiveSchedules.keys())) {
    if (!nextIds.has(charId)) stopProactive(charId);
  }
  for (const config of configs || []) {
    if (config && config.charId && config.intervalMs > 0) {
      upsertProactive(config);
    }
  }
  refreshKeepAlive();
}
function readPushPayload2(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    try {
      return { message: event.data?.text() };
    } catch {
      return null;
    }
  }
}
function openInboxDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACTIVE_MSG_DB_NAME, ACTIVE_MSG_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      reject(new Error("IndexedDB open blocked (older version still open elsewhere)"));
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACTIVE_MSG_INBOX_STORE)) {
        db.createObjectStore(ACTIVE_MSG_INBOX_STORE, { keyPath: "messageId" });
      }
      if (!db.objectStoreNames.contains(ACTIVE_MSG_OUTBOUND_SESSIONS_STORE)) {
        db.createObjectStore(ACTIVE_MSG_OUTBOUND_SESSIONS_STORE, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE)) {
        db.createObjectStore(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(ACTIVE_MSG_REASONING_BUFFER_STORE)) {
        db.createObjectStore(ACTIVE_MSG_REASONING_BUFFER_STORE, { keyPath: "sessionId" });
      }
    };
  });
}
async function saveIncomingActiveMessage(payload) {
  const charId = payload?.metadata?.charId;
  const charName = payload?.contactName || payload?.metadata?.charName || "\u4E3B\u52A8\u6D88\u606F";
  const body = String(payload?.message || payload?.body || "").trim();
  const messageId = String(payload?.messageId || `${charId || "unknown"}-${Date.now()}`);
  const payloadTimestamp = payload?.timestamp;
  const parsedSentAt = payloadTimestamp ? new Date(payloadTimestamp).getTime() : NaN;
  const sentAt = Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now();
  if (!charId || !body) return;
  const db = await openInboxDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_INBOX_STORE, "readwrite");
    tx.objectStore(ACTIVE_MSG_INBOX_STORE).put({
      messageId,
      charId,
      charName,
      body,
      avatarUrl: payload?.avatarUrl,
      source: payload?.source,
      messageType: payload?.messageType,
      messageSubtype: payload?.messageSubtype,
      taskId: payload?.taskId ?? null,
      metadata: payload?.metadata || {},
      sentAt,
      receivedAt: Date.now()
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await notifyClients({
    type: "active-msg-received",
    charId,
    charName,
    body,
    avatarUrl: payload?.avatarUrl,
    sentAt
  });
}
sw.addEventListener("push", (event) => {
  const payload = readPushPayload2(event);
  if (!payload) return;
  event.waitUntil(saveIncomingActiveMessage(payload));
});
sw.addEventListener("notificationclick", (event) => {
  const payload = event.notification.data?.payload || event.notification.data || {};
  const charId = payload?.metadata?.charId || payload?.charId || "";
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (clients.length > 0) {
      const client = clients[0];
      await client.focus();
      client.postMessage({ type: "active-msg-open", charId });
      return;
    }
    const openUrl = new URL(sw.registration.scope || sw.location.origin);
    openUrl.searchParams.set("openApp", "chat");
    if (charId) openUrl.searchParams.set("activeMsgCharId", charId);
    await sw.clients.openWindow(openUrl.toString());
  })());
});
sw.addEventListener("message", (event) => {
  const { type } = event.data || {};
  switch (type) {
    case "GET_SW_VERSION":
      event.ports[0]?.postMessage({ version: SW_VERSION });
      break;
    case "keepalive-start":
      startKeepAlive();
      break;
    case "keepalive-stop":
      stopKeepAlive();
      break;
    case "proactive-start":
      if (event.data.config) {
        syncProactive([...proactiveSchedules.values(), event.data.config]);
      }
      break;
    case "proactive-stop":
      if (event.data.charId) {
        stopProactive(event.data.charId);
        refreshKeepAlive();
      } else {
        syncProactive([]);
      }
      break;
    case "proactive-sync":
      syncProactive(event.data.configs || []);
      break;
  }
});
sw.addEventListener("install", () => {
  void sw.skipWaiting();
});
sw.addEventListener("activate", (event) => {
  event.waitUntil(sw.clients.claim());
});
