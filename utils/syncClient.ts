/**
 * Cloud Sync Client — 跟 Vercel + Neon 后端通信的客户端
 *
 * 调用方：
 *   - hooks/useCloudSync.ts — 轮询 / 触发同步
 *   - components/settings/SyncSettings.tsx — 配对码 UI
 *
 * 设计要点：
 *   - 配对码 + 设备 ID 存 localStorage（持久化，跨刷新保留）
 *   - 所有请求带 X-Pair-Code + X-Device-Id 头（由 fetchSync 统一加）
 *   - 失败静默（不抛），调用方按返回值判断
 *   - 单次请求 15s 超时（Vercel Hobby 10s 函数超时 + 余量）
 *   - 环境变量缺失（Neon 没装）时返 ok:false 配 'NOT_CONFIGURED'，调用方据此
 *     走"未配置"分支（不开轮询、不报错）
 */

/** 内联 UUID v4 生成（避免 import db.ts 形成循环：db.ts → useCloudSync → syncClient → db.ts） */
function generateClientId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

const SYNC_CONFIG_KEY = 'os_cloud_sync_config';

const SYNC_API_BASE = '/api/sync';

const REQUEST_TIMEOUT_MS = 15_000;

// ─── 配置（持久化） ──────────────────────────────────

export interface SyncConfig {
    /** 6 位配对码；空 = 未配对 */
    pairCode: string;
    /** 设备 UUID v4 */
    deviceId: string;
    /** 是否启用云端同步（用户手动开关） */
    enabled: boolean;
    /** 设备名（用户在 UI 里起的） */
    deviceName: string;
    /** 设备注册时间 */
    pairedAt: number;
    /** 聊天消息本地水位（已拉到的最大 message_timestamp），增量同步用 */
    lastMessageSyncAt: number;
    /** 记忆本地水位（已拉到的最大 cloud_updated_at） */
    lastMemorySyncAt: number;
    /** 上次成功同步的时间（UI 显示用） */
    lastSyncSuccessAt: number | null;
    /** 上次同步失败原因（UI 显示用） */
    lastSyncError: string | null;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
    pairCode: '',
    deviceId: '',
    enabled: false,
    deviceName: '',
    pairedAt: 0,
    lastMessageSyncAt: 0,
    lastMemorySyncAt: 0,
    lastSyncSuccessAt: null,
    lastSyncError: null,
};

export function loadSyncConfig(): SyncConfig {
    try {
        const s = localStorage.getItem(SYNC_CONFIG_KEY);
        if (!s) return { ...DEFAULT_SYNC_CONFIG, deviceId: ensureDeviceId() };
        const parsed = JSON.parse(s) as Partial<SyncConfig>;
        return {
            ...DEFAULT_SYNC_CONFIG,
            ...parsed,
            // 永远确保 deviceId 存在
            deviceId: parsed.deviceId || ensureDeviceId(),
        };
    } catch {
        return { ...DEFAULT_SYNC_CONFIG, deviceId: ensureDeviceId() };
    }
}

export function saveSyncConfig(c: SyncConfig): void {
    try {
        localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(c));
    } catch (e) {
        console.warn('[syncClient] saveSyncConfig failed:', e);
    }
}

/** 首次启动时确保 deviceId 存在（UUID v4） */
function ensureDeviceId(): string {
    try {
        const existing = localStorage.getItem('os_sync_device_id');
        if (existing) return existing;
        const id = generateClientId();
        localStorage.setItem('os_sync_device_id', id);
        return id;
    } catch {
        // localStorage 不可用（隐私模式等）时还是返一个 ID，至少能跑
        return generateClientId();
    }
}

// ─── HTTP helper ─────────────────────────────────────

export interface SyncError {
    code: string;  // 'NOT_CONFIGURED' | 'AUTH_FAILED' | 'NETWORK' | 'TIMEOUT' | 'SERVER' | 'BATCH_TOO_LARGE' | 'QUOTA' | 'INVALID_RESPONSE' | code from server
    message: string;
}

export type SyncResult<T> = { ok: true; data: T } | { ok: false; error: SyncError };

async function fetchSync<T = any>(
    path: string,
    options: {
        method?: 'GET' | 'POST';
        body?: any;
        auth: { pairCode: string; deviceId: string } | null;  // null = 公开端点（init / pair）
    }
): Promise<SyncResult<T>> {
    const { method = 'GET', body, auth } = options;
    const url = `${SYNC_API_BASE}${path}`;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (auth) {
        headers['X-Pair-Code'] = auth.pairCode;
        headers['X-Device-Id'] = auth.deviceId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        clearTimeout(timer);

        let json: any = null;
        try {
            json = await res.json();
        } catch {
            return {
                ok: false,
                error: { code: 'INVALID_RESPONSE', message: `服务器返回非 JSON（HTTP ${res.status}）` },
            };
        }

        if (res.ok && json?.success) {
            return { ok: true, data: json as T };
        }

        // 错误响应
        const errCode = json?.error?.code || 'SERVER';
        const errMsg = json?.error?.message || `HTTP ${res.status}`;
        return { ok: false, error: { code: errCode, message: errMsg } };
    } catch (e: any) {
        clearTimeout(timer);
        if (e?.name === 'AbortError') {
            return { ok: false, error: { code: 'TIMEOUT', message: '请求超时（15s）' } };
        }
        return { ok: false, error: { code: 'NETWORK', message: e?.message || '网络错误' } };
    }
}

// ─── API 调用 ───────────────────────────────────────

/** 探测后端是否配置好（DATABASE_URL 存在）。前端用这个判断要不要走"未配置"分支 */
export async function checkBackendAvailable(): Promise<boolean> {
    // init 端点在没配 DB 时会返 503；这是最便宜的探测方式
    const result = await fetchSync<any>('?_action=init', { method: 'POST', body: {}, auth: null });
    if (result.ok) return true;
    if (result.error.code === 'DB_NOT_CONFIGURED') return false;
    // 其他错误（网络/超时）也按"不可用"处理
    return false;
}

/** 初始化新配对：生成新配对码 + 注册当前设备（每次都生成新码 = "重置配对"） */
export async function initPair(deviceName: string, userAgent: string): Promise<SyncResult<{
    pairCode: string;
    deviceId: string;
    createdAt: number;
}>> {
    const deviceId = ensureDeviceId();
    return fetchSync<any>('?_action=init', {
        method: 'POST',
        body: { deviceName, userAgent },
        auth: { pairCode: '', deviceId },  // init 不需要带 pair-code，但需要带 device-id
    }).then(r => {
        if (r.ok) {
            return { ok: true, data: { pairCode: r.data.pairCode, deviceId: r.data.deviceId, createdAt: r.data.createdAt } };
        }
        return r;
    });
}

/** 加入已有配对码 */
export async function joinPair(pairCode: string, deviceName: string, userAgent: string): Promise<SyncResult<{
    pairCode: string;
    deviceId: string;
    pairedAt: number;
    deviceCount: number;
    isNewPair: boolean;
}>> {
    const deviceId = ensureDeviceId();
    return fetchSync<any>('?_action=pair', {
        method: 'POST',
        body: { deviceName, userAgent },
        auth: { pairCode: pairCode.toLowerCase().trim(), deviceId },
    });
}

/** 查询配对码下的设备列表 + 同步统计 */
export async function getSyncStatus(pairCode: string, deviceId: string): Promise<SyncResult<{
    pairCode: string;
    devices: Array<{
        deviceId: string;
        deviceName: string;
        lastSeenAt: number;
        createdAt: number;
        userAgent: string;
        isCurrent: boolean;
    }>;
    stats: { deviceCount: number; messageCount: number; memoryCount: number };
}>> {
    return fetchSync<any>('?_action=status', { method: 'GET', auth: { pairCode, deviceId } });
}

// ─── 消息 ────────────────────────────────────────────

export interface CloudMessage {
    cloudId: number;
    clientId: string;
    charId: string;
    role: 'user' | 'assistant' | 'system';
    type: string;
    content: string;
    timestamp: number;
    metadata?: any;
    replyTo?: any;
    uploadedAt: number;
    uploadedBy: string;
}

export async function uploadMessages(
    pairCode: string,
    deviceId: string,
    messages: Array<{
        clientId: string;
        charId: string;
        role: string;
        type: string;
        content: string;
        timestamp: number;
        metadata?: any;
        replyTo?: any;
    }>
): Promise<SyncResult<{ uploaded: number; deduped: number; totalRequested: number }>> {
    return fetchSync<any>('?_action=upload_messages', {
        method: 'POST',
        body: { messages },
        auth: { pairCode, deviceId },
    });
}

export async function pullMessages(
    pairCode: string,
    deviceId: string,
    since: number,
    charId?: string,
    limit: number = 200
): Promise<SyncResult<{ messages: CloudMessage[]; hasMore: boolean; serverTime: number }>> {
    const params = new URLSearchParams({
        since: String(since),
        limit: String(limit),
    });
    if (charId) params.set('charId', charId);
    return fetchSync<any>(`?_action=pull_messages&${params.toString()}`, {
        method: 'GET',
        auth: { pairCode, deviceId },
    });
}

// ─── 记忆 ────────────────────────────────────────────

export interface CloudMemory {
    id: string;
    charId: string;
    content: string;
    room: string;
    tags: string[];
    importance: number;
    mood: string;
    valence: number | null;
    arousal: number | null;
    sourceId: string | null;
    origin: string | null;
    archived: boolean;
    isBoxSummary: boolean;
    eventBoxId: string | null;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
    pinnedUntil: number | null;
    groupId: string | null;
    groupName: string | null;
    deleted: boolean;
    cloudUpdatedAt: number;
    uploadedBy: string;
}

export async function uploadMemories(
    pairCode: string,
    deviceId: string,
    memories: any[]
): Promise<SyncResult<{ uploaded: number; deduped: number; deleted: number; totalRequested: number }>> {
    return fetchSync<any>('?_action=upload_memories', {
        method: 'POST',
        body: { memories },
        auth: { pairCode, deviceId },
    });
}

export async function pullMemories(
    pairCode: string,
    deviceId: string,
    since: number,
    charId?: string,
    includeDeleted: boolean = false,
    limit: number = 300
): Promise<SyncResult<{ memories: CloudMemory[]; hasMore: boolean; serverTime: number }>> {
    const params = new URLSearchParams({
        since: String(since),
        limit: String(limit),
    });
    if (charId) params.set('charId', charId);
    if (includeDeleted) params.set('includeDeleted', 'true');
    return fetchSync<any>(`?_action=pull_memories&${params.toString()}`, {
        method: 'GET',
        auth: { pairCode, deviceId },
    });
}

// ─── 工具：错误信息转中文 ──────────────────────────

export function humanReadableError(err: SyncError): string {
    switch (err.code) {
        case 'NOT_CONFIGURED':
        case 'DB_NOT_CONFIGURED':
            return '云端同步未配置（请在 Vercel dashboard 装 Neon 集成）';
        case 'AUTH_FAILED':
        case 'MISSING_PAIR_CODE':
        case 'INVALID_PAIR_CODE':
        case 'MISSING_DEVICE_ID':
        case 'INVALID_DEVICE_ID':
            return '配对码或设备 ID 错误，请重试';
        case 'NETWORK':
            return '网络错误，检查网络后重试';
        case 'TIMEOUT':
            return '请求超时（Vercel 10 秒限制），稍后重试';
        case 'BATCH_TOO_LARGE':
            return '批量太大，请分批上传';
        case 'PAIR_QUOTA_EXCEEDED':
            return '配对码下数据量超限';
        case 'INVALID_RESPONSE':
            return '服务器返回异常';
        default:
            return err.message || '未知错误';
    }
}
