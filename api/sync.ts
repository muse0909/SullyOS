/**
 * Cloud Sync — 单文件多 action endpoint
 *
 * 暮色多端互通（电脑 ↔ 手机）：配对码 + 聊天记录 + 记忆宫殿同步
 *
 * ⚠️ 为什么是单文件而不是 4 个 endpoint？
 *   Vercel Hobby 计划限制 12 个 Serverless Functions，本项目其他 endpoint 已经占 10 个。
 *   拆成 4 个（init/pair/messages/memories）会超限。合并成单 endpoint + _action 路由最稳。
 *
 * 调用方式：
 *   POST /api/sync?_action=init        body: { deviceName?, userAgent? }
 *   POST /api/sync?_action=pair        body: { deviceName?, userAgent? }    headers: X-Pair-Code + X-Device-Id
 *   GET  /api/sync?_action=status                                                  headers: X-Pair-Code + X-Device-Id
 *   POST /api/sync?_action=upload_messages  body: { messages: [...] }
 *   GET  /api/sync?_action=pull_messages&since=ms&charId=&limit=200
 *   POST /api/sync?_action=upload_memories  body: { memories: [...] }
 *   GET  /api/sync?_action=pull_memories&since=ms&charId=&includeDeleted=&limit=300
 *
 * Headers（除 init 外都需要）：
 *   X-Pair-Code: 6 位字符（剔除 0/1/o/i/l）
 *   X-Device-Id: UUID v4
 *
 * 设计原则：
 *   - 单 endpoint 10 秒内搞定（Vercel Hobby 限制）
 *   - 单次 POST 最多 500 条消息 / 300 条记忆
 *   - 单次 GET 最多 500 条
 *   - 没配 DATABASE_URL 时返 503，**不报错**（用户可能没装 Neon 集成）
 *   - 鉴权强度：仅靠配对码隔离，不抗暴力。适用于个人多端互通。
 */

import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

// ─── 环境变量 + Neon client ─────────────────────────

function getDatabaseUrl(): string | null {
    const url = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
    return url || null;
}

class DbNotConfiguredError extends Error {
    constructor() { super('DATABASE_URL 未配置'); this.name = 'DbNotConfiguredError'; }
}

neonConfig.fetchConnectionCache = true;
let cachedSql: NeonQueryFunction<false, false> | null = null;
let cachedUrl: string | null = null;

function getSql(): NeonQueryFunction<false, false> {
    const url = getDatabaseUrl();
    if (!url) throw new DbNotConfiguredError();
    if (!cachedSql || cachedUrl !== url) {
        cachedSql = neon(url);
        cachedUrl = url;
    }
    return cachedSql;
}

// ─── 响应 helper ───────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Code, X-Device-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
};

function jsonError(status: number, code: string, message: string) {
    return {
        statusCode: status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: false, error: { code, message } }),
    };
}

function jsonOk(body: Record<string, any> = {}) {
    return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: true, ...body }),
    };
}

function optionsResponse() {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

function handleDbError(e: any) {
    if (e instanceof DbNotConfiguredError) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置：请在 Vercel dashboard 装 Neon 集成并设置 DATABASE_URL');
    }
    console.error('[sync] DB error:', e?.message || e);
    return jsonError(500, 'DB_ERROR', e?.message || '数据库错误');
}

// ─── 鉴权 ─────────────────────────────────────────

const PAIR_CODE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 32 字符（剔除 0/1/o/i/l）
const PAIR_CODE_LEN = 6;

function generatePairCode(): string {
    let code = '';
    const bytes = new Uint8Array(PAIR_CODE_LEN);
    (globalThis as any).crypto.getRandomValues(bytes);
    for (let i = 0; i < PAIR_CODE_LEN; i++) {
        code += PAIR_CODE_CHARS[bytes[i] % PAIR_CODE_CHARS.length];
    }
    return code;
}

function isValidPairCode(code: string): boolean {
    if (!code || code.length !== PAIR_CODE_LEN) return false;
    for (const ch of code) {
        if (!PAIR_CODE_CHARS.includes(ch)) return false;
    }
    return true;
}

function isValidDeviceId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function readAuth(req: any): { auth: { pairCode: string; deviceId: string }; error: any } | { auth: null; error: any } {
    const pairCode = typeof req.headers?.['x-pair-code'] === 'string'
        ? req.headers['x-pair-code'].toLowerCase().trim() : '';
    const deviceId = typeof req.headers?.['x-device-id'] === 'string'
        ? req.headers['x-device-id'].trim() : '';

    if (!pairCode) return { auth: null, error: jsonError(401, 'MISSING_PAIR_CODE', '缺少配对码') };
    if (!isValidPairCode(pairCode)) return { auth: null, error: jsonError(401, 'INVALID_PAIR_CODE', '配对码格式错误（必须 6 位，剔除 0/1/o/i/l）') };
    if (!deviceId) return { auth: null, error: jsonError(401, 'MISSING_DEVICE_ID', '缺少设备 ID') };
    if (!isValidDeviceId(deviceId)) return { auth: null, error: jsonError(401, 'INVALID_DEVICE_ID', '设备 ID 格式错误（必须是 UUID）') };
    return { auth: { pairCode, deviceId }, error: null };
}

async function readJsonBody(req: any): Promise<any> {
    if (req.body == null) return {};
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { throw new Error('Invalid JSON body'); }
    }
    return req.body;
}

const nowMs = () => Date.now();

// ─── 限流常量 ─────────────────────────────────────

const MAX_MESSAGES_PER_PAIR = 100_000;
const MAX_MEMORIES_PER_PAIR = 50_000;
const MAX_MESSAGE_BATCH = 500;
const MAX_MEMORY_BATCH = 300;
const MAX_MESSAGE_LIMIT = 500;
const MAX_MEMORY_LIMIT = 500;
const MAX_CONTENT_LEN = 50_000;
const MAX_METADATA_LEN = 100_000;
const MAX_MEMORY_CONTENT_LEN = 20_000;

const VALID_ROOMS = new Set([
    'living_room', 'bedroom', 'study', 'user_room', 'self_room', 'attic', 'windowsill',
]);

// ─── 路由分发 ─────────────────────────────────────

export default async (req: any) => {
    if (req.method === 'OPTIONS') return optionsResponse();
    if (!getDatabaseUrl()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置：请在 Vercel dashboard 装 Neon 集成');
    }

    // action 既可从 query 拿（GET）也可从 body 拿（POST）
    const action = (typeof req.query?._action === 'string' ? req.query._action : '').toLowerCase();

    try {
        switch (action) {
            case 'ping':             return jsonOk({ pong: true, serverTime: nowMs() });
            case 'init':             return await handleInit(req);
            case 'pair':             return await handlePair(req);
            case 'status':           return await handleStatus(req);
            case 'upload_messages':  return await handleUploadMessages(req);
            case 'pull_messages':    return await handlePullMessages(req);
            case 'upload_memories':  return await handleUploadMemories(req);
            case 'pull_memories':    return await handlePullMemories(req);
            default:
                return jsonError(400, 'INVALID_ACTION', `未知 _action: ${action}。可选: ping | init | pair | status | upload_messages | pull_messages | upload_memories | pull_memories`);
        }
    } catch (e: any) {
        if (e instanceof DbNotConfiguredError) {
            return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
        }
        return handleDbError(e);
    }
};

// ─── Action: init ─────────────────────────────────

async function handleInit(req: any) {
    if (req.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED', 'init 只支持 POST');

    const deviceId = typeof req.headers?.['x-device-id'] === 'string' ? req.headers['x-device-id'].trim() : '';
    if (!isValidDeviceId(deviceId)) return jsonError(400, 'INVALID_DEVICE_ID', '设备 ID 格式错误');

    let body: any = {};
    try { body = await readJsonBody(req); } catch (e: any) { return jsonError(400, 'INVALID_BODY', e.message); }
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : null;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 256) : null;

    const sql = getSql();
    const now = nowMs();

    // 生成不撞码的配对码
    let pairCode = '';
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generatePairCode();
        const existing = await sql`SELECT 1 FROM devices WHERE pair_code = ${candidate} LIMIT 1`;
        if (existing.length === 0) { pairCode = candidate; break; }
    }
    if (!pairCode) return jsonError(500, 'CODE_GENERATION_FAILED', '配对码生成失败');

    await sql`
        INSERT INTO devices (device_id, pair_code, device_name, last_seen_at, created_at, user_agent)
        VALUES (${deviceId}, ${pairCode}, ${deviceName}, ${now}, ${now}, ${userAgent})
        ON CONFLICT (device_id) DO UPDATE SET
            pair_code = EXCLUDED.pair_code,
            device_name = EXCLUDED.device_name,
            last_seen_at = EXCLUDED.last_seen_at,
            user_agent = EXCLUDED.user_agent
    `;

    return jsonOk({ pairCode, deviceId, createdAt: now });
}

// ─── Action: pair（加入已有配对码）─────────────────

async function handlePair(req: any) {
    if (req.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED', 'pair 只支持 POST');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: any = {};
    try { body = await readJsonBody(req); } catch (e: any) { return jsonError(400, 'INVALID_BODY', e.message); }
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : null;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 256) : null;

    const sql = getSql();
    const now = nowMs();
    const existing = await sql`SELECT device_id FROM devices WHERE pair_code = ${pairCode} LIMIT 1`;

    await sql`
        INSERT INTO devices (device_id, pair_code, device_name, last_seen_at, created_at, user_agent)
        VALUES (${deviceId}, ${pairCode}, ${deviceName}, ${now}, ${now}, ${userAgent})
        ON CONFLICT (device_id) DO UPDATE SET
            pair_code = EXCLUDED.pair_code,
            device_name = EXCLUDED.device_name,
            last_seen_at = EXCLUDED.last_seen_at,
            user_agent = EXCLUDED.user_agent
    `;

    const countRows = await sql`SELECT COUNT(*)::int AS cnt FROM devices WHERE pair_code = ${pairCode}`;
    return jsonOk({
        pairCode,
        deviceId,
        pairedAt: now,
        deviceCount: countRows[0]?.cnt ?? 0,
        isNewPair: existing.length === 0,
    });
}

// ─── Action: status（查询设备列表 + 统计）──────────

async function handleStatus(req: any) {
    if (req.method !== 'GET') return jsonError(405, 'METHOD_NOT_ALLOWED', 'status 只支持 GET');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    const sql = getSql();
    const rows = await sql`
        SELECT device_id, device_name, last_seen_at, created_at, user_agent
        FROM devices WHERE pair_code = ${pairCode}
        ORDER BY last_seen_at DESC LIMIT 50
    `;
    await sql`UPDATE devices SET last_seen_at = ${nowMs()} WHERE device_id = ${deviceId}`;

    const msgCount = await sql`SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE pair_code = ${pairCode}`;
    const memCount = await sql`SELECT COUNT(*)::int AS cnt FROM memory_palace_items WHERE pair_code = ${pairCode}`;

    return jsonOk({
        pairCode,
        devices: rows.map((r: any) => ({
            deviceId: r.device_id,
            deviceName: r.device_name || '(未命名设备)',
            lastSeenAt: Number(r.last_seen_at),
            createdAt: Number(r.created_at),
            userAgent: r.user_agent || '',
            isCurrent: r.device_id === deviceId,
        })),
        stats: {
            deviceCount: rows.length,
            messageCount: msgCount[0]?.cnt ?? 0,
            memoryCount: memCount[0]?.cnt ?? 0,
        },
    });
}

// ─── Action: upload_messages ───────────────────────

async function handleUploadMessages(req: any) {
    if (req.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED', 'upload_messages 只支持 POST');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: any = {};
    try { body = await readJsonBody(req); } catch (e: any) { return jsonError(400, 'INVALID_BODY', e.message); }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return jsonOk({ uploaded: 0, deduped: 0 });
    if (messages.length > MAX_MESSAGE_BATCH) {
        return jsonError(400, 'BATCH_TOO_LARGE', `单次最多 ${MAX_MESSAGE_BATCH} 条`);
    }

    const rows: any[] = [];
    for (const m of messages) {
        const clientId = typeof m?.clientId === 'string' ? m.clientId.trim() : '';
        const charId = typeof m?.charId === 'string' ? m.charId.trim() : '';
        const role = typeof m?.role === 'string' ? m.role : '';
        const type = typeof m?.type === 'string' ? m.type : 'text';
        const content = typeof m?.content === 'string' ? m.content : '';
        const timestamp = Number(m?.timestamp);
        const metadata = m?.metadata;
        const replyTo = m?.replyTo;

        if (!clientId || !/^[0-9a-zA-Z_-]{4,64}$/.test(clientId))
            return jsonError(400, 'INVALID_CLIENT_ID', `clientId 格式错误：${clientId}`);
        if (!charId || charId.length > 128)
            return jsonError(400, 'INVALID_CHAR_ID', `charId 格式错误`);
        if (!['user', 'assistant', 'system'].includes(role))
            return jsonError(400, 'INVALID_ROLE', `role 必须是 user/assistant/system`);
        if (content.length > MAX_CONTENT_LEN)
            return jsonError(400, 'CONTENT_TOO_LARGE', `单条消息超过 ${MAX_CONTENT_LEN} 字符`);
        if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 9_999_999_999_999)
            return jsonError(400, 'INVALID_TIMESTAMP', `timestamp 非法`);

        const metadataStr = metadata == null ? null : (() => {
            try { const s = JSON.stringify(metadata); return s.length > MAX_METADATA_LEN ? null : s; } catch { return null; }
        })();
        const replyToStr = replyTo == null ? null : (() => {
            try { const s = JSON.stringify(replyTo); return s.length > 4096 ? null : s; } catch { return null; }
        })();

        rows.push({
            pair_code: pairCode,
            char_id: charId,
            client_id: clientId,
            role, type, content,
            message_timestamp: timestamp,
            metadata: metadataStr,
            reply_to: replyToStr,
            uploaded_at: nowMs(),
            uploaded_by: deviceId,
        });
    }

    const sql = getSql();
    const countRows = await sql`SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE pair_code = ${pairCode}`;
    const currentCount = countRows[0]?.cnt ?? 0;
    if (currentCount + rows.length > MAX_MESSAGES_PER_PAIR) {
        return jsonError(413, 'PAIR_QUOTA_EXCEEDED',
            `配对码下消息总数超过上限（${MAX_MESSAGES_PER_PAIR}）`);
    }

    let uploaded = 0, deduped = 0;
    for (const row of rows) {
        const result = await sql`
            INSERT INTO chat_messages (pair_code, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by)
            VALUES (${row.pair_code}, ${row.char_id}, ${row.client_id}, ${row.role}, ${row.type}, ${row.content}, ${row.message_timestamp}, ${row.metadata}, ${row.reply_to}, ${row.uploaded_at}, ${row.uploaded_by})
            ON CONFLICT (pair_code, client_id) DO NOTHING RETURNING id
        `;
        if (result.length > 0) uploaded++; else deduped++;
    }
    return jsonOk({ uploaded, deduped, totalRequested: rows.length });
}

// ─── Action: pull_messages ─────────────────────────

async function handlePullMessages(req: any) {
    if (req.method !== 'GET') return jsonError(405, 'METHOD_NOT_ALLOWED', 'pull_messages 只支持 GET');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode } = authResult.auth;

    const since = Number(req.query?.since ?? '0');
    const charId = typeof req.query?.charId === 'string' ? req.query.charId : '';
    const limit = Math.min(MAX_MESSAGE_LIMIT, Math.max(1, parseInt(String(req.query?.limit ?? '200'), 10) || 200));

    if (!Number.isFinite(since) || since < 0) return jsonError(400, 'INVALID_SINCE', 'since 必须是非负数');
    if (charId.length > 128) return jsonError(400, 'INVALID_CHAR_ID', 'charId 太长');

    const sql = getSql();
    const fetchLimit = limit + 1;
    const rows = charId
        ? await sql`
            SELECT id, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by
            FROM chat_messages
            WHERE pair_code = ${pairCode} AND char_id = ${charId} AND message_timestamp > ${since}
            ORDER BY message_timestamp ASC LIMIT ${fetchLimit}
        `
        : await sql`
            SELECT id, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by
            FROM chat_messages
            WHERE pair_code = ${pairCode} AND message_timestamp > ${since}
            ORDER BY message_timestamp ASC LIMIT ${fetchLimit}
        `;

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;

    const messages = sliced.map((r: any) => {
        let metadata = null;
        if (r.metadata) { try { metadata = JSON.parse(r.metadata); } catch { /* */ } }
        let replyTo = null;
        if (r.reply_to) { try { replyTo = JSON.parse(r.reply_to); } catch { /* */ } }
        return {
            cloudId: Number(r.id),
            clientId: r.client_id,
            charId: r.char_id,
            role: r.role,
            type: r.type,
            content: r.content,
            timestamp: Number(r.message_timestamp),
            metadata, replyTo,
            uploadedAt: Number(r.uploaded_at),
            uploadedBy: r.uploaded_by,
        };
    });
    return jsonOk({ messages, hasMore, serverTime: nowMs() });
}

// ─── Action: upload_memories ───────────────────────

async function handleUploadMemories(req: any) {
    if (req.method !== 'POST') return jsonError(405, 'METHOD_NOT_ALLOWED', 'upload_memories 只支持 POST');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: any = {};
    try { body = await readJsonBody(req); } catch (e: any) { return jsonError(400, 'INVALID_BODY', e.message); }

    const memories = Array.isArray(body.memories) ? body.memories : [];
    if (memories.length === 0) return jsonOk({ uploaded: 0, deduped: 0, deleted: 0 });
    if (memories.length > MAX_MEMORY_BATCH) {
        return jsonError(400, 'BATCH_TOO_LARGE', `单次最多 ${MAX_MEMORY_BATCH} 条`);
    }

    const rows: any[] = [];
    for (const m of memories) {
        const id = typeof m?.id === 'string' ? m.id.trim() : '';
        const charId = typeof m?.charId === 'string' ? m.charId.trim() : '';
        const content = typeof m?.content === 'string' ? m.content : '';
        const room = typeof m?.room === 'string' ? m.room : '';
        const tags = Array.isArray(m?.tags) ? m.tags : [];
        const importance = Number(m?.importance);
        const mood = typeof m?.mood === 'string' ? m.mood : '';
        const valence = typeof m?.valence === 'number' ? m.valence : null;
        const arousal = typeof m?.arousal === 'number' ? m.arousal : null;
        const sourceId = typeof m?.sourceId === 'string' ? m.sourceId : null;
        const origin = typeof m?.origin === 'string' ? m.origin : null;
        const archived = !!m?.archived;
        const isBoxSummary = !!m?.isBoxSummary;
        const eventBoxId = typeof m?.eventBoxId === 'string' ? m.eventBoxId : null;
        const createdAt = Number(m?.createdAt);
        const lastAccessedAt = Number(m?.lastAccessedAt) || Number(m?.createdAt) || 0;
        const accessCount = Number(m?.accessCount) || 0;
        const pinnedUntil = m?.pinnedUntil == null ? null : Number(m.pinnedUntil);
        const deleted = !!m?.deleted;
        const groupId = typeof m?.groupId === 'string' ? m.groupId : null;
        const groupName = typeof m?.groupName === 'string' ? m.groupName : null;

        if (!id || id.length > 128) return jsonError(400, 'INVALID_ID', `id 格式错误`);
        if (!charId || charId.length > 128) return jsonError(400, 'INVALID_CHAR_ID', `charId 格式错误`);
        if (content.length > MAX_MEMORY_CONTENT_LEN) return jsonError(400, 'CONTENT_TOO_LARGE', `记忆内容超过 ${MAX_MEMORY_CONTENT_LEN} 字符`);
        if (!VALID_ROOMS.has(room)) return jsonError(400, 'INVALID_ROOM', `room 非法：${room}`);
        if (tags.length > 32) return jsonError(400, 'TOO_MANY_TAGS', 'tag 数量超过 32');
        const cleanTags = tags.filter((t: any) => typeof t === 'string').map((t: string) => t.slice(0, 32)).filter((t: string) => t.length > 0);
        if (importance < 1 || importance > 10) return jsonError(400, 'INVALID_IMPORTANCE', `importance 必须在 1-10`);
        if (mood.length > 64) return jsonError(400, 'INVALID_MOOD', 'mood 太长');
        if (origin != null && origin.length > 32) return jsonError(400, 'INVALID_ORIGIN', 'origin 太长');
        if (room.length > 32) return jsonError(400, 'INVALID_ROOM', 'room 太长');
        if (!Number.isFinite(createdAt) || createdAt < 0) return jsonError(400, 'INVALID_CREATED_AT', 'createdAt 非法');
        if (valence != null && (valence < -1 || valence > 1)) return jsonError(400, 'INVALID_VALENCE', 'valence 必须在 -1 到 1');
        if (arousal != null && (arousal < -1 || arousal > 1)) return jsonError(400, 'INVALID_AROUSAL', 'arousal 必须在 -1 到 1');
        if (pinnedUntil != null && !Number.isFinite(pinnedUntil)) return jsonError(400, 'INVALID_PINNED_UNTIL', 'pinnedUntil 非法');

        const now = nowMs();
        rows.push({
            pair_code: pairCode,
            memory_id: id,
            char_id: charId,
            content, room,
            tags_array: cleanTags,
            importance, mood, valence, arousal,
            source_id: sourceId, origin,
            archived, is_box_summary: isBoxSummary,
            event_box_id: eventBoxId,
            created_at: createdAt,
            last_accessed_at: lastAccessedAt,
            access_count: accessCount,
            pinned_until: pinnedUntil,
            group_id: groupId,
            group_name: groupName && groupName.length <= 128 ? groupName : null,
            deleted,
            cloud_updated_at: now,
            uploaded_by: deviceId,
        });
    }

    const sql = getSql();
    if (!rows.some(r => r.deleted)) {
        const countRows = await sql`SELECT COUNT(*)::int AS cnt FROM memory_palace_items WHERE pair_code = ${pairCode} AND deleted = false`;
        const currentCount = countRows[0]?.cnt ?? 0;
        const newAdds = rows.filter(r => !r.deleted).length;
        if (currentCount + newAdds > MAX_MEMORIES_PER_PAIR) {
            return jsonError(413, 'PAIR_QUOTA_EXCEEDED', `配对码下记忆总数超过上限（${MAX_MEMORIES_PER_PAIR}）`);
        }
    }

    let uploaded = 0, deduped = 0, deletedCount = 0;
    for (const row of rows) {
        if (row.deleted) {
            const result = await sql`
                INSERT INTO memory_palace_items
                    (pair_code, memory_id, char_id, content, room, tags, importance, mood, valence, arousal,
                     source_id, origin, archived, is_box_summary, event_box_id, created_at, last_accessed_at,
                     access_count, pinned_until, group_id, group_name, deleted, cloud_updated_at, uploaded_by)
                VALUES
                    (${row.pair_code}, ${row.memory_id}, ${row.char_id}, ${row.content}, ${row.room},
                     ${row.tags_array}, ${row.importance}, ${row.mood}, ${row.valence}, ${row.arousal},
                     ${row.source_id}, ${row.origin}, ${row.archived}, ${row.is_box_summary},
                     ${row.event_box_id}, ${row.created_at}, ${row.last_accessed_at}, ${row.access_count},
                     ${row.pinned_until}, ${row.group_id}, ${row.group_name}, true, ${row.cloud_updated_at},
                     ${row.uploaded_by})
                ON CONFLICT (pair_code, memory_id) DO UPDATE SET
                    deleted = true, cloud_updated_at = EXCLUDED.cloud_updated_at, uploaded_by = EXCLUDED.uploaded_by
                RETURNING (xmax = 0) AS inserted
            `;
            if (result[0]?.inserted) deletedCount++; else deduped++;
        } else {
            const result = await sql`
                INSERT INTO memory_palace_items
                    (pair_code, memory_id, char_id, content, room, tags, importance, mood, valence, arousal,
                     source_id, origin, archived, is_box_summary, event_box_id, created_at, last_accessed_at,
                     access_count, pinned_until, group_id, group_name, deleted, cloud_updated_at, uploaded_by)
                VALUES
                    (${row.pair_code}, ${row.memory_id}, ${row.char_id}, ${row.content}, ${row.room},
                     ${row.tags_array}, ${row.importance}, ${row.mood}, ${row.valence}, ${row.arousal},
                     ${row.source_id}, ${row.origin}, ${row.archived}, ${row.is_box_summary},
                     ${row.event_box_id}, ${row.created_at}, ${row.last_accessed_at}, ${row.access_count},
                     ${row.pinned_until}, ${row.group_id}, ${row.group_name}, false, ${row.cloud_updated_at},
                     ${row.uploaded_by})
                ON CONFLICT (pair_code, memory_id) DO UPDATE SET
                    char_id = EXCLUDED.char_id, content = EXCLUDED.content, room = EXCLUDED.room,
                    tags = EXCLUDED.tags, importance = EXCLUDED.importance, mood = EXCLUDED.mood,
                    valence = EXCLUDED.valence, arousal = EXCLUDED.arousal,
                    source_id = EXCLUDED.source_id, origin = EXCLUDED.origin,
                    archived = EXCLUDED.archived, is_box_summary = EXCLUDED.is_box_summary,
                    event_box_id = EXCLUDED.event_box_id,
                    last_accessed_at = EXCLUDED.last_accessed_at, access_count = EXCLUDED.access_count,
                    pinned_until = EXCLUDED.pinned_until,
                    group_id = EXCLUDED.group_id, group_name = EXCLUDED.group_name,
                    deleted = false, cloud_updated_at = EXCLUDED.cloud_updated_at, uploaded_by = EXCLUDED.uploaded_by
                RETURNING (xmax = 0) AS inserted
            `;
            if (result[0]?.inserted) uploaded++; else deduped++;
        }
    }
    return jsonOk({ uploaded, deduped, deleted: deletedCount, totalRequested: rows.length });
}

// ─── Action: pull_memories ─────────────────────────

async function handlePullMemories(req: any) {
    if (req.method !== 'GET') return jsonError(405, 'METHOD_NOT_ALLOWED', 'pull_memories 只支持 GET');

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode } = authResult.auth;

    const since = Number(req.query?.since ?? '0');
    const charId = typeof req.query?.charId === 'string' ? req.query.charId : '';
    const includeDeleted = req.query?.includeDeleted === 'true' || req.query?.includeDeleted === '1';
    const limit = Math.min(MAX_MEMORY_LIMIT, Math.max(1, parseInt(String(req.query?.limit ?? '300'), 10) || 300));

    if (!Number.isFinite(since) || since < 0) return jsonError(400, 'INVALID_SINCE', 'since 必须是非负数');
    if (charId.length > 128) return jsonError(400, 'INVALID_CHAR_ID', 'charId 太长');

    const sql = getSql();
    const fetchLimit = limit + 1;
    const buildWhere = (withChar: boolean) => {
        const parts: any[] = [sql`pair_code = ${pairCode}`, sql`cloud_updated_at > ${since}`];
        if (withChar) parts.push(sql`char_id = ${charId}`);
        if (!includeDeleted) parts.push(sql`deleted = false`);
        return parts;
    };
    const where = charId
        ? sql`pair_code = ${pairCode} AND char_id = ${charId} AND cloud_updated_at > ${since}${includeDeleted ? sql`` : sql` AND deleted = false`}`
        : sql`pair_code = ${pairCode} AND cloud_updated_at > ${since}${includeDeleted ? sql`` : sql` AND deleted = false`}`;
    const rows = await sql`
        SELECT * FROM memory_palace_items
        WHERE ${where}
        ORDER BY cloud_updated_at ASC LIMIT ${fetchLimit}
    `;

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const memories = sliced.map((r: any) => ({
        id: r.memory_id,
        charId: r.char_id,
        content: r.content,
        room: r.room,
        tags: r.tags || [],
        importance: r.importance,
        mood: r.mood,
        valence: r.valence == null ? null : Number(r.valence),
        arousal: r.arousal == null ? null : Number(r.arousal),
        sourceId: r.source_id,
        origin: r.origin,
        archived: !!r.archived,
        isBoxSummary: !!r.is_box_summary,
        eventBoxId: r.event_box_id,
        createdAt: Number(r.created_at),
        lastAccessedAt: Number(r.last_accessed_at),
        accessCount: r.access_count,
        pinnedUntil: r.pinned_until == null ? null : Number(r.pinned_until),
        groupId: r.group_id,
        groupName: r.group_name,
        deleted: !!r.deleted,
        cloudUpdatedAt: Number(r.cloud_updated_at),
        uploadedBy: r.uploaded_by,
    }));
    return jsonOk({ memories, hasMore, serverTime: nowMs() });
}
