/**
 * Cloud Sync — 公共 helper
 *
 * 暮色的多端互通（电脑 ↔ 手机）通过这个模块走。
 * 配对码 = 云端身份标识；同一配对码下的所有设备共享数据。
 *
 * 设计：
 *   - 走 Vercel + Neon Postgres（Vercel Marketplace 集成自动注入 DATABASE_URL）
 *   - @neondatabase/serverless 走 HTTP 协议（Neon serverless driver），无 TCP 连接
 *   - 端到端 10 秒超时预算（Vercel Hobby 限制），单次批量控制在 ~50 条
 *   - 没配 DATABASE_URL 时返 503，**不报错**（用户可能没装 Neon 集成）
 *
 * 配对码机制：
 *   - 6 位数字（剔除易混淆的 0/1/O/I/L），约 30^6 ≈ 7.3 亿组合
 *   - 设备 ID = UUID v4（每台设备一个，永不重复）
 *   - 配对码 + 设备 ID 一起存在请求头里：X-Pair-Code / X-Device-Id
 *
 * ⚠️ 鉴权强度：仅靠"配对码"做隔离，不抗暴力。
 *    适用范围：个人多端互通（暮色 + 自己的电脑手机），不抗主动攻击。
 *    不适合公开部署或多人共用同一份数据。
 */

import { neon, neonConfig, type NeonQueryFunction } from '@neondatabase/serverless';
import { randomUUID } from 'crypto';

// ─── 环境变量检查 ─────────────────────────────────────

export function getDatabaseUrl(): string | null {
    const url = typeof process.env.DATABASE_URL === 'string' ? process.env.DATABASE_URL.trim() : '';
    return url || null;
}

/** 是否已配置数据库。同步 API 入口处先 check，未配置时返 503 而不是 500 */
export function isDbConfigured(): boolean {
    return !!getDatabaseUrl();
}

// ─── Neon client ──────────────────────────────────────
// Neon serverless driver 每次调用都创建新连接，**不要**模块级缓存 client，
// 但 fetchConnectionCache 可以全局缓存（HTTP keep-alive），用 neonConfig。
neonConfig.fetchConnectionCache = true;

let cachedSql: NeonQueryFunction<false, false> | null = null;
let cachedUrl: string | null = null;

export function getSql(): NeonQueryFunction<false, false> {
    const url = getDatabaseUrl();
    if (!url) {
        throw new DbNotConfiguredError();
    }
    // URL 变更时（比如 dev 切换环境）重建 client
    if (!cachedSql || cachedUrl !== url) {
        cachedSql = neon(url);
        cachedUrl = url;
    }
    return cachedSql;
}

export class DbNotConfiguredError extends Error {
    constructor() {
        super('DATABASE_URL 未配置（请在 Vercel dashboard 装 Neon 集成）');
        this.name = 'DbNotConfiguredError';
    }
}

// ─── 错误 / 响应 helper ──────────────────────────────

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Code, X-Device-Id',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
};

export function jsonError(status: number, code: string, message: string): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
} {
    return {
        statusCode: status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: false, error: { code, message } }),
    };
}

export function jsonOk(body: Record<string, any> = {}): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
} {
    return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ success: true, ...body }),
    };
}

export function optionsResponse(): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
} {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

// ─── 鉴权 ────────────────────────────────────────────

/** 6 位配对码字符表（剔除 0/1/O/I/L，易混淆） */
const PAIR_CODE_CHARS = '23456789abcdefghjkmnpqrstuvwxyz'; // 32 字符
const PAIR_CODE_LEN = 6;

export function generatePairCode(): string {
    let code = '';
    const bytes = new Uint8Array(PAIR_CODE_LEN);
    // Node 18+ 全局 crypto
    (globalThis as any).crypto.getRandomValues(bytes);
    for (let i = 0; i < PAIR_CODE_LEN; i++) {
        code += PAIR_CODE_CHARS[bytes[i] % PAIR_CODE_CHARS.length];
    }
    return code;
}

export function isValidPairCode(code: string): boolean {
    if (!code || code.length !== PAIR_CODE_LEN) return false;
    for (const ch of code) {
        if (!PAIR_CODE_CHARS.includes(ch)) return false;
    }
    return true;
}

export function isValidDeviceId(id: string): boolean {
    // UUID v4 格式：8-4-4-4-12 hex，含连字符
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export interface AuthInfo {
    pairCode: string;
    deviceId: string;
}

/** 从请求头提取并校验 pair_code / device_id。失败返 null + error。 */
export function readAuth(req: any): { auth: AuthInfo; error: null } | { auth: null; error: ReturnType<typeof jsonError> } {
    const pairCode = typeof req.headers?.['x-pair-code'] === 'string'
        ? req.headers['x-pair-code'].toLowerCase().trim()
        : '';
    const deviceId = typeof req.headers?.['x-device-id'] === 'string'
        ? req.headers['x-device-id'].trim()
        : '';

    if (!pairCode) {
        return { auth: null, error: jsonError(401, 'MISSING_PAIR_CODE', '缺少配对码（X-Pair-Code 请求头）') };
    }
    if (!isValidPairCode(pairCode)) {
        return { auth: null, error: jsonError(401, 'INVALID_PAIR_CODE', '配对码格式错误（必须 6 位，剔除 0/1/o/i/l）') };
    }
    if (!deviceId) {
        return { auth: null, error: jsonError(401, 'MISSING_DEVICE_ID', '缺少设备 ID（X-Device-Id 请求头）') };
    }
    if (!isValidDeviceId(deviceId)) {
        return { auth: null, error: jsonError(401, 'INVALID_DEVICE_ID', '设备 ID 格式错误（必须是 UUID）') };
    }
    return { auth: { pairCode, deviceId }, error: null };
}

// ─── JSON body 解析（Vercel 自动解析过 body，但保险起见） ─────

export async function readJsonBody<T = any>(req: any): Promise<T> {
    if (req.body == null) return {} as T;
    if (typeof req.body === 'string') {
        try {
            return JSON.parse(req.body) as T;
        } catch {
            throw new Error('Invalid JSON body');
        }
    }
    return req.body as T;
}

// ─── 限流保护（防止恶意脚本把某个配对码的存储写满） ─────

/** 单个配对码允许的聊天消息总数上限（防御性，避免单配对码占用整个 DB） */
export const MAX_MESSAGES_PER_PAIR = 100_000;
/** 单个配对码允许的记忆节点总数上限 */
export const MAX_MEMORIES_PER_PAIR = 50_000;

// ─── 通用 DB 错误处理 ─────────────────────────────────

export function handleDbError(e: any): ReturnType<typeof jsonError> {
    if (e instanceof DbNotConfiguredError) {
        return jsonError(503, 'DB_NOT_CONFIGURED', '云端同步未配置：请在 Vercel dashboard 装 Neon 集成并设置 DATABASE_URL');
    }
    console.error('[sync] DB error:', e?.message || e);
    return jsonError(500, 'DB_ERROR', e?.message || '数据库错误');
}

// ─── 客户端时间戳生成（兜底用，**不**建议客户端传） ─────

export function nowMs(): number {
    return Date.now();
}

// ─── Vercel Edge 兼容：把 randomUUID 暴露出来供客户端等价使用 ─────

export { randomUUID as generateDeviceId };
