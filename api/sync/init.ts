/**
 * Cloud Sync — 初始化 / 重置配对码
 *
 * POST /api/sync/init
 *   body: { deviceName?: string, userAgent?: string }
 *   → 总是生成新的 6 位配对码 + 注册新设备
 *   → 返 { pairCode, deviceId, createdAt }
 *
 * 注意：这个端点**不**查 headers，每次调用都生成新配对码（"重置配对"语义）。
 * 想在已有配对码下加入新设备，用 /api/sync/pair。
 *
 * 唯一性：
 *   - 配对码可能撞码（概率 ~1/7 亿），生成后用 UNIQUE 约束兜底，撞了就重试（最多 5 次）
 *   - deviceId 由客户端生成（UUID v4）保证全局唯一
 */

import {
    getSql, jsonOk, jsonError, optionsResponse, readJsonBody,
    generatePairCode, nowMs, handleDbError, isDbConfigured,
} from './_lib';

export default async (req: any) => {
    if (req.method === 'OPTIONS') return optionsResponse();
    if (req.method !== 'POST') {
        return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
    }

    if (!isDbConfigured()) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置：请在 Vercel dashboard 装 Neon 集成');
    }

    let body: { deviceName?: string; userAgent?: string } = {};
    try {
        body = await readJsonBody(req);
    } catch (e: any) {
        return jsonError(400, 'INVALID_BODY', e.message);
    }

    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.slice(0, 64) : null;
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 256) : null;
    // 注意：deviceId 来自 X-Device-Id 请求头，由客户端生成 + 本地持久化
    const deviceId = typeof req.headers?.['x-device-id'] === 'string'
        ? req.headers['x-device-id'].trim()
        : '';

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
        return jsonError(400, 'INVALID_DEVICE_ID', '设备 ID 格式错误（必须是 UUID v4）');
    }

    try {
        const sql = getSql();
        const now = nowMs();

        // 生成不撞码的配对码（最多 5 次重试）
        let pairCode = '';
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generatePairCode();
            // 先检查是否已存在
            const existing = await sql`SELECT 1 FROM devices WHERE pair_code = ${candidate} LIMIT 1`;
            if (existing.length === 0) {
                pairCode = candidate;
                break;
            }
        }
        if (!pairCode) {
            return jsonError(500, 'CODE_GENERATION_FAILED', '配对码生成失败（连续撞码），请重试');
        }

        // 注册设备（用 ON CONFLICT 更新 last_seen_at + device_name）
        await sql`
            INSERT INTO devices (device_id, pair_code, device_name, last_seen_at, created_at, user_agent)
            VALUES (${deviceId}, ${pairCode}, ${deviceName}, ${now}, ${now}, ${userAgent})
            ON CONFLICT (device_id) DO UPDATE SET
                pair_code = EXCLUDED.pair_code,
                device_name = EXCLUDED.device_name,
                last_seen_at = EXCLUDED.last_seen_at,
                user_agent = EXCLUDED.user_agent
        `;

        return jsonOk({
            pairCode,
            deviceId,
            createdAt: now,
        });
    } catch (e: any) {
        return handleDbError(e);
    }
};
