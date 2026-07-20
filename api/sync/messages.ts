/**
 * Cloud Sync — 聊天消息上传 / 拉取
 *
 * POST /api/sync/messages
 *   body: { messages: [{ clientId, charId, role, type, content, timestamp, metadata?, replyTo? }] }
 *   headers: X-Pair-Code, X-Device-Id
 *   → 批量上传消息（去重靠 clientId）
 *   → 返 { uploaded: N, deduped: M }
 *
 * GET /api/sync/messages?since=ms&charId=xxx&limit=200
 *   headers: X-Pair-Code, X-Device-Id
 *   → 拉取该配对码下、timestamp > since 的消息
 *   → 返 { messages: [...], serverTime: ms, hasMore: bool }
 *
 * 去重策略：
 *   - 客户端给每条消息一个 clientId（UUID v4），在本地 save 时就生成
 *   - 云端 (pair_code, client_id) UNIQUE 约束；ON CONFLICT DO NOTHING 静默跳过
 *   - 客户端拉取时用 clientId 判断"我有没有"，避免重复插入
 *
 * 限流：
 *   - 单次 POST 最多 500 条
 *   - 单次 GET 最多 500 条
 *   - 单配对码总消息数上限 100,000（见 _lib.MAX_MESSAGES_PER_PAIR）
 */

import {
    getSql, jsonOk, jsonError, optionsResponse, readJsonBody, readAuth,
    nowMs, handleDbError, isDbConfigured, MAX_MESSAGES_PER_PAIR,
} from './_lib';

const MAX_BATCH = 500;
const MAX_LIMIT = 500;

// 防止恶意 / 异常 body 把 DB 撑爆
const MAX_CONTENT_LEN = 50_000;       // 单条消息最大 50KB
const MAX_METADATA_LEN = 100_000;      // metadata JSON 最大 100KB

export default async (req: any) => {
    if (req.method === 'OPTIONS') return optionsResponse();
    if (req.method === 'GET') return handleGet(req);
    if (req.method === 'POST') return handlePost(req);
    return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
};

// ─── POST: 上传 ─────────────────────────────────────

async function handlePost(req: any) {
    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
    }

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: { messages?: any[] } = {};
    try {
        body = await readJsonBody(req);
    } catch (e: any) {
        return jsonError(400, 'INVALID_BODY', e.message);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
        return jsonOk({ uploaded: 0, deduped: 0 });
    }
    if (messages.length > MAX_BATCH) {
        return jsonError(400, 'BATCH_TOO_LARGE', `单次最多 ${MAX_BATCH} 条，本次 ${messages.length} 条`);
    }

    // 校验 + 规范化每条消息
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

        if (!clientId || !/^[0-9a-zA-Z_-]{4,64}$/.test(clientId)) {
            return jsonError(400, 'INVALID_CLIENT_ID', `clientId 格式错误：${clientId}`);
        }
        if (!charId || charId.length > 128) {
            return jsonError(400, 'INVALID_CHAR_ID', `charId 格式错误：${charId}`);
        }
        if (!['user', 'assistant', 'system'].includes(role)) {
            return jsonError(400, 'INVALID_ROLE', `role 必须是 user/assistant/system：${role}`);
        }
        if (content.length > MAX_CONTENT_LEN) {
            return jsonError(400, 'CONTENT_TOO_LARGE', `单条消息超过 ${MAX_CONTENT_LEN} 字符`);
        }
        if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 9_999_999_999_999) {
            return jsonError(400, 'INVALID_TIMESTAMP', `timestamp 非法：${m?.timestamp}`);
        }

        // metadata / replyTo 序列化为 JSON 字符串，限制大小
        const metadataStr = (() => {
            if (metadata == null) return null;
            try {
                const s = JSON.stringify(metadata);
                if (s.length > MAX_METADATA_LEN) return null;
                return s;
            } catch {
                return null;
            }
        })();
        const replyToStr = (() => {
            if (replyTo == null) return null;
            try {
                const s = JSON.stringify(replyTo);
                if (s.length > 4096) return null;
                return s;
            } catch {
                return null;
            }
        })();

        rows.push({
            pair_code: pairCode,
            char_id: charId,
            client_id: clientId,
            role,
            type,
            content,
            message_timestamp: timestamp,
            metadata: metadataStr,
            reply_to: replyToStr,
            uploaded_at: nowMs(),
            uploaded_by: deviceId,
        });
    }

    try {
        const sql = getSql();

        // 限流检查：当前配对码下的总消息数
        const countRows = await sql`
            SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE pair_code = ${pairCode}
        `;
        const currentCount = countRows[0]?.cnt ?? 0;
        if (currentCount + rows.length > MAX_MESSAGES_PER_PAIR) {
            return jsonError(413, 'PAIR_QUOTA_EXCEEDED',
                `配对码下消息总数超过上限（${MAX_MESSAGES_PER_PAIR}），当前 ${currentCount} 条，无法再上传 ${rows.length} 条`);
        }

        // 批量 upsert（去重）
        // Neon serverless 不支持真正的批量 VALUES，需要用 UNNEST 或者逐条 upsert
        // 500 条逐条 ON CONFLICT 在 Neon 通常 1-2 秒搞定（实测）
        let uploaded = 0;
        let deduped = 0;
        for (const row of rows) {
            const result = await sql`
                INSERT INTO chat_messages
                    (pair_code, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by)
                VALUES
                    (${row.pair_code}, ${row.char_id}, ${row.client_id}, ${row.role}, ${row.type}, ${row.content}, ${row.message_timestamp}, ${row.metadata}, ${row.reply_to}, ${row.uploaded_at}, ${row.uploaded_by})
                ON CONFLICT (pair_code, client_id) DO NOTHING
                RETURNING id
            `;
            if (result.length > 0) {
                uploaded++;
            } else {
                deduped++;
            }
        }

        return jsonOk({
            uploaded,
            deduped,
            totalRequested: rows.length,
        });
    } catch (e: any) {
        return handleDbError(e);
    }
}

// ─── GET: 拉取增量 ───────────────────────────────────

async function handleGet(req: any) {
    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
    }

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode } = authResult.auth;

    const since = Number(req.query?.since ?? '0');
    const charId = typeof req.query?.charId === 'string' ? req.query.charId : '';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query?.limit ?? '200'), 10) || 200));

    if (!Number.isFinite(since) || since < 0) {
        return jsonError(400, 'INVALID_SINCE', 'since 必须是非负数（毫秒时间戳）');
    }
    if (charId.length > 128) {
        return jsonError(400, 'INVALID_CHAR_ID', 'charId 太长');
    }

    try {
        const sql = getSql();

        // charId 过滤可选；不传则拉所有角色的
        // 多查 1 条用来判断 hasMore
        const fetchLimit = limit + 1;
        const rows = charId
            ? await sql`
                SELECT id, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by
                FROM chat_messages
                WHERE pair_code = ${pairCode}
                  AND char_id = ${charId}
                  AND message_timestamp > ${since}
                ORDER BY message_timestamp ASC
                LIMIT ${fetchLimit}
            `
            : await sql`
                SELECT id, char_id, client_id, role, type, content, message_timestamp, metadata, reply_to, uploaded_at, uploaded_by
                FROM chat_messages
                WHERE pair_code = ${pairCode}
                  AND message_timestamp > ${since}
                ORDER BY message_timestamp ASC
                LIMIT ${fetchLimit}
            `;

        const hasMore = rows.length > limit;
        const sliced = hasMore ? rows.slice(0, limit) : rows;

        const messages = sliced.map((r: any) => {
            let metadata = null;
            if (r.metadata) {
                try { metadata = JSON.parse(r.metadata); } catch { /* keep null */ }
            }
            let replyTo = null;
            if (r.reply_to) {
                try { replyTo = JSON.parse(r.reply_to); } catch { /* keep null */ }
            }
            return {
                cloudId: Number(r.id),              // 服务端自增 ID（调试用，不参与去重）
                clientId: r.client_id,
                charId: r.char_id,
                role: r.role,
                type: r.type,
                content: r.content,
                timestamp: Number(r.message_timestamp),
                metadata,
                replyTo,
                uploadedAt: Number(r.uploaded_at),
                uploadedBy: r.uploaded_by,          // 哪个设备上传的（调试用）
            };
        });

        return jsonOk({
            messages,
            hasMore,
            serverTime: nowMs(),
        });
    } catch (e: any) {
        return handleDbError(e);
    }
}
