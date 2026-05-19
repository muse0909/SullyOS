import {
  ActiveMsg2GlobalConfig,
  ActiveMsg2InboxMessage,
  InstantPushOutboundSession,
  InstantPushPendingToolCall,
  InstantPushReasoningBufferEntry,
} from '../types';

const DB_NAME = 'ActiveMsg';
// v2 (Phase 2 Round 1): added outbound_sessions / pending_tool_calls / reasoning_buffer
// for agentic-loop /continue resume + reasoning correlation.
// IMPORTANT: once a client opens v2, downgrade to a v1 codebase will fail to open this DB.
const DB_VERSION = 2;
const STORE_KV = 'kv';
const STORE_INBOX = 'inbox';
const STORE_OUTBOUND_SESSIONS = 'outbound_sessions';
const STORE_PENDING_TOOL_CALLS = 'pending_tool_calls';
const STORE_REASONING_BUFFER = 'reasoning_buffer';
const GLOBAL_CONFIG_KEY = 'global-config';

type KvRecord<T = unknown> = {
  id: string;
  value: T;
};

const defaultGlobalConfig: ActiveMsg2GlobalConfig = {
  userId: '',
  driver: 'pg',
  databaseUrl: '',
};

const openDB = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);

  request.onerror = () => reject(request.error);
  request.onblocked = () => {
    // SW or another tab holds an older version; can't upgrade. Reject so callers don't hang.
    reject(new Error('IndexedDB open blocked — close other tabs / unregister SW and retry'));
  };
  request.onsuccess = () => resolve(request.result);
  request.onupgradeneeded = () => {
    const db = request.result;

    if (!db.objectStoreNames.contains(STORE_KV)) {
      db.createObjectStore(STORE_KV, { keyPath: 'id' });
    }

    if (!db.objectStoreNames.contains(STORE_INBOX)) {
      db.createObjectStore(STORE_INBOX, { keyPath: 'messageId' });
    }

    // Phase 2 Round 1 stores (v1 → v2 migration is additive — no data touch on existing stores)
    if (!db.objectStoreNames.contains(STORE_OUTBOUND_SESSIONS)) {
      db.createObjectStore(STORE_OUTBOUND_SESSIONS, { keyPath: 'sessionId' });
    }

    if (!db.objectStoreNames.contains(STORE_PENDING_TOOL_CALLS)) {
      db.createObjectStore(STORE_PENDING_TOOL_CALLS, { keyPath: 'sessionId' });
    }

    if (!db.objectStoreNames.contains(STORE_REASONING_BUFFER)) {
      db.createObjectStore(STORE_REASONING_BUFFER, { keyPath: 'sessionId' });
    }
  };
});

const getKv = async <T>(id: string): Promise<T | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readonly');
    const request = tx.objectStore(STORE_KV).get(id);
    request.onsuccess = () => resolve((request.result as KvRecord<T> | undefined)?.value ?? null);
    request.onerror = () => reject(request.error);
  });
};

const setKv = async <T>(id: string, value: T): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_KV, 'readwrite');
    tx.objectStore(STORE_KV).put({ id, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const generateUuidV4 = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

export const ActiveMsgStore = {
  async getGlobalConfig(): Promise<ActiveMsg2GlobalConfig> {
    const stored = await getKv<ActiveMsg2GlobalConfig>(GLOBAL_CONFIG_KEY);
    return { ...defaultGlobalConfig, ...(stored || {}) };
  },

  async saveGlobalConfig(updates: Partial<ActiveMsg2GlobalConfig>): Promise<ActiveMsg2GlobalConfig> {
    const current = await this.getGlobalConfig();
    const next: ActiveMsg2GlobalConfig = {
      ...current,
      ...updates,
      updatedAt: Date.now(),
    };
    await setKv(GLOBAL_CONFIG_KEY, next);
    return next;
  },

  async ensureUserId(): Promise<string> {
    const current = await this.getGlobalConfig();
    if (current.userId) return current.userId;

    const userId = generateUuidV4();
    await this.saveGlobalConfig({ userId });
    return userId;
  },

  async saveInboxMessage(message: ActiveMsg2InboxMessage): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      tx.objectStore(STORE_INBOX).put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async listInboxMessages(): Promise<ActiveMsg2InboxMessage[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readonly');
      const request = tx.objectStore(STORE_INBOX).getAll();
      request.onsuccess = () => {
        const messages = (request.result || []) as ActiveMsg2InboxMessage[];
        messages.sort((a, b) => (a.sentAt || a.receivedAt) - (b.sentAt || b.receivedAt));
        resolve(messages);
      };
      request.onerror = () => reject(request.error);
    });
  },

  // 单事务原子 claim: getAll + delete 同一个 readwrite tx。IndexedDB 跨连接
  // (跨 tab / 跨 SW / 同 tab 多 caller) 对同一 object store 的 readwrite 事务
  // 是 serializable 的, 第二个 caller 会等第一个 commit 后才进入, 所以同一条
  // inbox 消息绝不可能被两个 caller 同时 claim。这是把 race 关在 IDB 层。
  //
  // 已知取舍 (TODO): 这是"先 ack 后处理"语义 —— 调用方拿到 messages 后若
  // saveMessage 抛错, 消息已经从 inbox 删了, 会丢。当前没修是因为:
  //   1. DB.saveMessage 用 IDB add(), 失败极罕见 (quota / corruption)
  //   2. 改成"先 save 后 ack" 会需要把 list 和 delete 拆开, 反而把这里的
  //      原子性优势让出去, 重新打开并发读到同一项的窗口
  // 真要补防丢, 加一层 dead-letter / try-catch 后 put 回 inbox, 而不是
  // 拆开这个事务。
  async consumeInboxMessages(): Promise<ActiveMsg2InboxMessage[]> {
    const db = await openDB();
    return new Promise<ActiveMsg2InboxMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_INBOX, 'readwrite');
      const store = tx.objectStore(STORE_INBOX);
      const request = store.getAll();
      let messages: ActiveMsg2InboxMessage[] = [];
      request.onsuccess = () => {
        messages = (request.result || []) as ActiveMsg2InboxMessage[];
        messages.sort((a, b) => (a.sentAt || a.receivedAt) - (b.sentAt || b.receivedAt));
        messages.forEach((m) => store.delete(m.messageId));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(messages);
      tx.onabort = () => reject(tx.error || new Error('inbox consume aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── Phase 2 Round 1: outbound_sessions ──────────────────────────────────
  // sendInstantPush 写, /continue 续跑读, /continue 完成后 delete.

  async saveOutboundSession(record: InstantPushOutboundSession): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readwrite');
      tx.objectStore(STORE_OUTBOUND_SESSIONS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async getOutboundSession(sessionId: string): Promise<InstantPushOutboundSession | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readonly');
      const request = tx.objectStore(STORE_OUTBOUND_SESSIONS).get(sessionId);
      request.onsuccess = () => resolve((request.result as InstantPushOutboundSession | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  },

  async deleteOutboundSession(sessionId: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOUND_SESSIONS, 'readwrite');
      tx.objectStore(STORE_OUTBOUND_SESSIONS).delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── Phase 2 Round 2 wire: pending_tool_calls ─────────────────────────────
  // SW writes when worker emits messageKind='tool_request'; main thread consumes
  // on startup (or via postMessage). Atomic claim mirrors consumeInboxMessages.
  // Round 1: empty by design (worker still 0.6 one-shot, won't emit tool_request).

  async savePendingToolCall(record: InstantPushPendingToolCall): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_TOOL_CALLS, 'readwrite');
      tx.objectStore(STORE_PENDING_TOOL_CALLS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async consumePendingToolCalls(): Promise<InstantPushPendingToolCall[]> {
    const db = await openDB();
    return new Promise<InstantPushPendingToolCall[]>((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING_TOOL_CALLS, 'readwrite');
      const store = tx.objectStore(STORE_PENDING_TOOL_CALLS);
      const request = store.getAll();
      let calls: InstantPushPendingToolCall[] = [];
      request.onsuccess = () => {
        calls = (request.result || []) as InstantPushPendingToolCall[];
        calls.sort((a, b) => a.createdAt - b.createdAt);
        calls.forEach((c) => store.delete(c.sessionId));
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(calls);
      tx.onabort = () => reject(tx.error || new Error('pending tool calls consume aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },

  // ─── Phase 2 Round 2 wire: reasoning_buffer ───────────────────────────────
  // SW writes when worker emits messageKind='reasoning'; flushInboxToChat
  // claims by sessionId for the first content message of that session, feeds
  // it into ctx.reasoningContent (mounts as Message.metadata.thinkingChain).
  // Round 1: empty by design.

  async saveReasoning(record: InstantPushReasoningBufferEntry): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_REASONING_BUFFER, 'readwrite');
      tx.objectStore(STORE_REASONING_BUFFER).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  async claimReasoning(sessionId: string): Promise<InstantPushReasoningBufferEntry | null> {
    const db = await openDB();
    return new Promise<InstantPushReasoningBufferEntry | null>((resolve, reject) => {
      const tx = db.transaction(STORE_REASONING_BUFFER, 'readwrite');
      const store = tx.objectStore(STORE_REASONING_BUFFER);
      const request = store.get(sessionId);
      let entry: InstantPushReasoningBufferEntry | null = null;
      request.onsuccess = () => {
        const r = request.result as InstantPushReasoningBufferEntry | undefined;
        if (r) {
          entry = r;
          store.delete(sessionId);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(entry);
      tx.onabort = () => reject(tx.error || new Error('reasoning claim aborted'));
      tx.onerror = () => reject(tx.error);
    });
  },
};

export const maskActiveMsgUserId = (userId: string) => {
  if (!userId) return '未生成';
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 8)}••••${userId.slice(-8)}`;
};
