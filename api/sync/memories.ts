/**
 * Cloud Sync — 记忆宫殿（内容）上传 / 拉取
 *
 * POST /api/sync/memories
 *   body: { memories: [{ id, charId, content, room, tags, importance, mood, ... }] }
 *   headers: X-Pair-Code, X-Device-Id
 *   → 批量 upsert（按 id 去重）
 *   → 返 { uploaded: N, deduped: M }
 *
 * GET /api/sync/memories?since=ms&charId=xxx&includeDeleted=true
 *   → 拉取该配对码下、cloud_updated_at > since 的记忆
 *   → 返 { memories: [...], serverTime, hasMore }
 *
 * ⚠️ 这个端点同步的是"记忆内容文本 + 元数据"，**不**包含向量。
 *    向量（pgvector）走的是 utils/memoryPalace/supabaseVector.ts（已有功能），
 *    本次云端同步不重新做一遍向量。
 *
 * 软删除：
 *   - 客户端删记忆时传 { id, deleted: true }
 *   - 云端标记 deleted=true，但保留行（避免另一端因为延迟拉取又"复活"）
 *   - 客户端拉取时可选择 includeDeleted=true 看到所有
 */

import {
    getSql, jsonOk, jsonError, optionsResponse, readJsonBody, readAuth,
    nowMs, handleDbError, isDbConfigured, MAX_MEMORIES_PER_PAIR,
} from './_lib';

const MAX_BATCH = 300;
const MAX_LIMIT = 500;

const MAX_CONTENT_LEN = 20_000;        // 记忆内容单条最大 20KB
const MAX_TAGS_COUNT = 32;             // 单条最多 32 个 tag
const MAX_TAG_LEN = 32;
const MAX_ROOM_LEN = 32;
const MAX_MOOD_LEN = 64;
const MAX_ORIGIN_LEN = 32;

const VALID_ROOMS = new Set([
    'living_room', 'bedroom', 'study', 'user_room', 'self_room', 'attic', 'windowsill',
]);

export default async (req: any) => {
    if (req.method === 'OPTIONS') return optionsResponse();
    if (req.method === 'GET') return handleGet(req);
    if (req.method === 'POST') return handlePost(req);
    return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
};

// ─── POST: 上传 / 软删除 ─────────────────────────────

async function handlePost(req: any) {
    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
    }

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: { memories?: any[] } = {};
    try {
        body = await readJsonBody(req);
    } catch (e: any) {
        return jsonError(400, 'INVALID_BODY', e.message);
    }

    const memories = Array.isArray(body.memories) ? body.memories : [];
    if (memories.length === 0) {
        return jsonOk({ uploaded: 0, deduped: 0, deleted: 0 });
    }
    if (memories.length > MAX_BATCH) {
        return jsonError(400, 'BATCH_TOO_LARGE', `单次最多 ${MAX_BATCH} 条，本次 ${memories.length} 条`);
    }

    // 校验 + 规范化
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

        // 校验
        if (!id || id.length > 128) {
            return jsonError(400, 'INVALID_ID', `id 格式错误：${id}`);
        }
        if (!charId || charId.length > 128) {
            return jsonError(400, 'INVALID_CHAR_ID', `charId 格式错误：${charId}`);
        }
        if (content.length > MAX_CONTENT_LEN) {
            return jsonError(400, 'CONTENT_TOO_LARGE', `记忆内容超过 ${MAX_CONTENT_LEN} 字符`);
        }
        if (!VALID_ROOMS.has(room)) {
            return jsonError(400, 'INVALID_ROOM', `room 非法：${room}`);
        }
        if (tags.length > MAX_TAGS_COUNT) {
            return jsonError(400, 'TOO_MANY_TAGS', `tag 数量超过 ${MAX_TAGS_COUNT}`);
        }
        const cleanTags = tags
            .filter((t: any) => typeof t === 'string')
            .map((t: string) => t.slice(0, MAX_TAG_LEN))
            .filter((t: string) => t.length > 0);
        if (importance < 1 || importance > 10) {
            return jsonError(400, 'INVALID_IMPORTANCE', `importance 必须在 1-10：${m?.importance}`);
        }
        if (mood.length > MAX_MOOD_LEN) {
            return jsonError(400, 'INVALID_MOOD', `mood 太长`);
        }
        if (origin != null && origin.length > MAX_ORIGIN_LEN) {
            return jsonError(400, 'INVALID_ORIGIN', `origin 太长`);
        }
        if (room.length > MAX_ROOM_LEN) {
            return jsonError(400, 'INVALID_ROOM', `room 太长`);
        }
        if (!Number.isFinite(createdAt) || createdAt < 0) {
            return jsonError(400, 'INVALID_CREATED_AT', `createdAt 非法`);
        }
        if (valence != null && (valence < -1 || valence > 1)) {
            return jsonError(400, 'INVALID_VALENCE', `valence 必须在 -1 到 1`);
        }
        if (arousal != null && (arousal < -1 || arousal > 1)) {
            return jsonError(400, 'INVALID_AROUSAL', `arousal 必须在 -1 到 1`);
        }
        if (pinnedUntil != null && !Number.isFinite(pinnedUntil)) {
            return jsonError(400, 'INVALID_PINNED_UNTIL', `pinnedUntil 非法`);
        }

        const now = nowMs();
        rows.push({
            pair_code: pairCode,
            memory_id: id,
            char_id: charId,
            content,
            room,
            tags_array: cleanTags,
            importance,
            mood,
            valence,
            arousal,
            source_id: sourceId,
            origin,
            archived,
            is_box_summary: isBoxSummary,
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

    try {
        const sql = getSql();

        // 限流
        if (!rows.some(r => r.deleted)) {
            // 只在非纯删除时检查总记忆数
            const countRows = await sql`
                SELECT COUNT(*)::int AS cnt FROM memory_palace_items WHERE pair_code = ${pairCode} AND deleted = false
            `;
            const currentCount = countRows[0]?.cnt ?? 0;
            const newAdds = rows.filter(r => !r.deleted).length;
            if (currentCount + newAdds > MAX_MEMORIES_PER_PAIR) {
                return jsonError(413, 'PAIR_QUOTA_EXCEEDED',
                    `配对码下记忆总数超过上限（${MAX_MEMORIES_PER_PAIR}），当前 ${currentCount} 条，无法再上传 ${newAdds} 条`);
            }
        }

        // 批量 upsert
        let uploaded = 0;
        let deduped = 0;
        let deletedCount = 0;
        for (const row of rows) {
            if (row.deleted) {
                // 软删除：只更新 deleted + cloud_updated_at，保留其他字段
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
                        deleted = true,
                        cloud_updated_at = EXCLUDED.cloud_updated_at,
                        uploaded_by = EXCLUDED.uploaded_by
                    RETURNING (xmax = 0) AS inserted
                `;
                if (result[0]?.inserted) deletedCount++;
                else deduped++;
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
                        char_id = EXCLUDED.char_id,
                        content = EXCLUDED.content,
                        room = EXCLUDED.room,
                        tags = EXCLUDED.tags,
                        importance = EXCLUDED.importance,
                        mood = EXCLUDED.mood,
                        valence = EXCLUDED.valence,
                        arousal = EXCLUDED.arousal,
                        source_id = EXCLUDED.source_id,
                        origin = EXCLUDED.origin,
                        archived = EXCLUDED.archived,
                        is_box_summary = EXCLUDED.is_box_summary,
                        event_box_id = EXCLUDED.event_box_id,
                        last_accessed_at = EXCLUDED.last_accessed_at,
                        access_count = EXCLUDED.access_count,
                        pinned_until = EXCLUDED.pinned_until,
                        group_id = EXCLUDED.group_id,
                        group_name = EXCLUDED.group_name,
                        deleted = false,
                        cloud_updated_at = EXCLUDED.cloud_updated_at,
                        uploaded_by = EXCLUDED.uploaded_by
                    RETURNING (xmax = 0) AS inserted
                `;
                if (result[0]?.inserted) uploaded++;
                else deduped++;
            }
        }

        return jsonOk({
            uploaded,
            deduped,
            deleted: deletedCount,
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
    const includeDeleted = req.query?.includeDeleted === 'true' || req.query?.includeDeleted === '1';
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query?.limit ?? '300'), 10) || 300));

    if (!Number.isFinite(since) || since < 0) {
        return jsonError(400, 'INVALID_SINCE', 'since 必须是非负数（毫秒时间戳）');
    }
    if (charId.length > 128) {
        return jsonError(400, 'INVALID_CHAR_ID', 'charId 太长');
    }

    try {
        const sql = getSql();
        const fetchLimit = limit + 1;

        // charId 过滤可选；includeDeleted 决定是否查 deleted=true 的（软删除同步用）
        const rows = charId
            ? (includeDeleted
                ? await sql`
                    SELECT * FROM memory_palace_items
                    WHERE pair_code = ${pairCode}
                      AND char_id = ${charId}
                      AND cloud_updated_at > ${since}
                    ORDER BY cloud_updated_at ASC
                    LIMIT ${fetchLimit}
                `
                : await sql`
                    SELECT * FROM memory_palace_items
                    WHERE pair_code = ${pairCode}
                      AND char_id = ${charId}
                      AND deleted = false
                      AND cloud_updated_at > ${since}
                    ORDER BY cloud_updated_at ASC
                    LIMIT ${fetchLimit}
                `)
            : (includeDeleted
                ? await sql`
                    SELECT * FROM memory_palace_items
                    WHERE pair_code = ${pairCode}
                      AND cloud_updated_at > ${since}
                    ORDER BY cloud_updated_at ASC
                    LIMIT ${fetchLimit}
                `
                : await sql`
                    SELECT * FROM memory_palace_items
                    WHERE pair_code = ${pairCode}
                      AND deleted = false
                      AND cloud_updated_at > ${since}
                    ORDER BY cloud_updated_at ASC
                    LIMIT ${fetchLimit}
                `);

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

        return jsonOk({
            memories,
            hasMore,
            serverTime: nowMs(),
        });
    } catch (e: any) {
        return handleDbError(e);
    }
}
