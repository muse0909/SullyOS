/**
 * Cloud Sync — 加入已有配对码 / 状态查询
 *
 * POST /api/sync/pair
 *   body: { deviceName?: string, userAgent?: string }
 *   headers: X-Device-Id, X-Pair-Code（待加入的配对码）
 *   → 把当前设备绑定到指定配对码下
 *   → 返 { pairCode, deviceId, pairedAt, deviceCount }
 *
 * 行为：
 *   - 如果该设备已注册到另一个配对码，会**切换**到新配对码（旧配对码下的数据不影响）
 *   - 如果目标配对码下已有别的设备，新设备加入后会自动拉到历史数据
 *
 * 设备列表查询：
 *   GET /api/sync/pair
 *   headers: X-Pair-Code, X-Device-Id
 *   → 返 { pairCode, devices: [{ deviceId, deviceName, lastSeenAt, isCurrent }] }
 *
 * 注意：POST/GET 用同一 URL，靠 method 区分。Vercel serverless function 同一文件
 * 默认 export 单一 handler，按 method 分支即可。
 */

import {
    getSql, jsonOk, jsonError, optionsResponse, readJsonBody,
    readAuth, nowMs, handleDbError, isDbConfigured,
} from './_lib';

export default async (req: any) => {
    if (req.method === 'OPTIONS') return optionsResponse();

    if (req.method === 'GET') {
        return handleGet(req);
    }
    if (req.method === 'POST') {
        return handlePost(req);
    }
    return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
};

// ─── POST: 加入配对 ────────────────────────────────

async function handlePost(req: any) {
    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
    }

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    let body: { deviceName?: string; userAgent?: string } = {};
    try {
        body = await readJsonBody(req);
    } catch (e: any) {
        return jsonError(400, 'INVALID_BODY', e.message);
    }
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : null;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 256) : null;

    try {
        const sql = getSql();
        const now = nowMs();

        // 检查目标配对码是否已存在（不需要"注册"配对码本身，配对码是隐式的——只要有 device 用它就存在）
        const existing = await sql`
            SELECT device_id FROM devices WHERE pair_code = ${pairCode} LIMIT 1
        `;

        // 把当前设备加入（或切换到）目标配对码
        await sql`
            INSERT INTO devices (device_id, pair_code, device_name, last_seen_at, created_at, user_agent)
            VALUES (${deviceId}, ${pairCode}, ${deviceName}, ${now}, ${now}, ${userAgent})
            ON CONFLICT (device_id) DO UPDATE SET
                pair_code = EXCLUDED.pair_code,
                device_name = EXCLUDED.device_name,
                last_seen_at = EXCLUDED.last_seen_at,
                user_agent = EXCLUDED.user_agent
        `;

        // 统计该配对码下的设备数
        const countRows = await sql`
            SELECT COUNT(*)::int AS cnt FROM devices WHERE pair_code = ${pairCode}
        `;
        const deviceCount = countRows[0]?.cnt ?? 0;

        return jsonOk({
            pairCode,
            deviceId,
            pairedAt: now,
            deviceCount,
            isNewPair: existing.length === 0, // 配对码下之前没有任何设备 = 第一次有人用
        });
    } catch (e: any) {
        return handleDbError(e);
    }
}

// ─── GET: 查询配对码下的设备列表 ─────────────────────

async function handleGet(req: any) {
    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置');
    }

    const authResult = readAuth(req);
    if (authResult.error) return authResult.error;
    const { pairCode, deviceId } = authResult.auth;

    try {
        const sql = getSql();

        // 列出该配对码下所有设备（按 last_seen_at 倒序）
        const rows = await sql`
            SELECT device_id, device_name, last_seen_at, created_at, user_agent
            FROM devices
            WHERE pair_code = ${pairCode}
            ORDER BY last_seen_at DESC
            LIMIT 50
        `;

        const devices = rows.map((r: any) => ({
            deviceId: r.device_id,
            deviceName: r.device_name || '(未命名设备)',
            lastSeenAt: Number(r.last_seen_at),
            createdAt: Number(r.created_at),
            userAgent: r.user_agent || '',
            isCurrent: r.device_id === deviceId,
        }));

        // 顺便更新本设备的 last_seen_at（心跳）
        await sql`UPDATE devices SET last_seen_at = ${nowMs()} WHERE device_id = ${deviceId}`;

        // 统计该配对码下的数据量
        const msgCount = await sql`
            SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE pair_code = ${pairCode}
        `;
        const memCount = await sql`
            SELECT COUNT(*)::int AS cnt FROM memory_palace_items WHERE pair_code = ${pairCode}
        `;

        return jsonOk({
            pairCode,
            devices,
            stats: {
                deviceCount: devices.length,
                messageCount: msgCount[0]?.cnt ?? 0,
                memoryCount: memCount[0]?.cnt ?? 0,
            },
        });
    } catch (e: any) {
        return handleDbError(e);
    }
}
