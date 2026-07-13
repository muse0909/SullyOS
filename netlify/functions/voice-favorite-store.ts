/**
 * Voice Favorite Cloud Store
 *
 * 把语音收藏的音频文件存到 Netlify Blobs，跨设备/换浏览器/清缓存都不丢。
 * 路由：/api/v1/voice-favorite-store
 *
 *   GET    ?key=voice_fav_xxx  → 返回音频 blob（直接给 <audio src> 用）
 *   PUT    ?key=voice_fav_xxx  → body 是音频二进制，存到 Netlify Blobs
 *   DELETE ?key=voice_fav_xxx  → 删除云端 blob（用户删除收藏时调用）
 *
 * 设计：
 *   - key 加 `voice_fav_` 前缀，避免和 Netlify Blobs 里其他 store 冲突
 *   - 不鉴权（项目其他 function 也不鉴权；SullyOS 是单机本地+自部署）
 *   - Content-Type 透传客户端 header
 *   - 失败统一返回 {success:false, error:...}，前端 catch 走 IndexedDB 兜底
 *
 * 历史：2026-07-13 上线，替代 IndexedDB-only 方案（IndexedDB 跟着浏览器走，会丢）
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'sullyos-voice-favorites';
const KEY_PREFIX = 'voice_fav_';
const MAX_BYTES = 5 * 1024 * 1024; // 5MB 限制（暮色日常语音条 1-3MB，留余量）

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
};

const jsonError = (status: number, code: string, message: string): Response => {
    return new Response(JSON.stringify({ success: false, error: { code, message } }), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
};

const jsonOk = (body: Record<string, any> = {}): Response => {
    return new Response(JSON.stringify({ success: true, ...body }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
};

// 规范化 key：加 prefix + 简单校验
const normalizeKey = (raw: string | null): string | null => {
    if (!raw) return null;
    // 不允许 .. / 斜杠等，防止跨 namespace 读
    if (raw.length > 200 || !/^[A-Za-z0-9_\-]+$/.test(raw)) return null;
    return `${KEY_PREFIX}${raw}`;
};

export default async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const rawKey = url.searchParams.get('key');
    const key = normalizeKey(rawKey);
    if (!key) {
        return jsonError(400, 'INVALID_KEY', 'key 必须是非空字母数字串');
    }

    let store: ReturnType<typeof getStore>;
    try {
        store = getStore(STORE_NAME);
    } catch (e) {
        console.error('[voice-favorite-store] getStore failed', e);
        return jsonError(500, 'STORE_INIT_FAILED', '云端存储初始化失败');
    }

    try {
        if (req.method === 'GET') {
            const blob = await store.get(key, { type: 'blob' });
            if (!blob) {
                return jsonError(404, 'NOT_FOUND', '音频不存在');
            }
            // 透传 Content-Type；浏览器拿到 blob 直接当 audio 播
            return new Response(blob, {
                status: 200,
                headers: {
                    ...CORS_HEADERS,
                    'Content-Type': blob.type || 'audio/mpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            });
        }

        if (req.method === 'PUT') {
            const contentType = req.headers.get('content-type') || 'audio/mpeg';
            const buf = await req.arrayBuffer();
            if (buf.byteLength === 0) {
                return jsonError(400, 'EMPTY_BODY', '请求体为空');
            }
            if (buf.byteLength > MAX_BYTES) {
                return jsonError(413, 'TOO_LARGE', `文件超过 ${MAX_BYTES / 1024 / 1024}MB 限制`);
            }
            // 把二进制包成 Blob，set 接受 BlobInput
            const blob = new Blob([buf], { type: contentType });
            await store.set(key, blob, {
                metadata: { contentType, uploadedAt: Date.now() },
            });
            return jsonOk({ key, bytes: buf.byteLength });
        }

        if (req.method === 'DELETE') {
            await store.delete(key);
            return jsonOk({ key, deleted: true });
        }

        return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
    } catch (e) {
        const message = e instanceof Error ? e.message : '未知错误';
        console.error('[voice-favorite-store] error', message, { method: req.method, key });
        return jsonError(500, 'INTERNAL_ERROR', message);
    }
};
