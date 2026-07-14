/**
 * Image Upload Cloud Store
 *
 * 把生图接口返回的 b64_json 上传到 Netlify Blobs，返回公网 url。
 * 解决中转站只返 b64 时没法直接展示 + 不想把 2MB base64 塞进 localStorage 的问题。
 * 路由：/api/v1/image-upload-store
 *
 *   POST  body: { b64: string, mime?: string }
 *         返回: { success: true, key, url, bytes }
 *   GET   ?key=image_xxx.png  → 返回图片 blob（直接给 <img src> 用）
 *   DELETE ?key=image_xxx.png → 删除云端 blob（用户删消息时调用）
 *
 * 设计：
 *   - key 加 `image_` 前缀，避免和 Netlify Blobs 里其他 store 冲突
 *   - 不鉴权（项目其他 function 也不鉴权；SullyOS 是单机本地+自部署）
 *   - mime 默认 image/png（gpt-image-1 默认输出），jpeg 时客户端传 'image/jpeg'
 *   - 失败统一返回 {success:false, error:...}，前端 catch 走 data URL 兜底
 *   - 公网 url 用 redirect 后的路径 /api/v1/... 走 Netlify 域名（同源）
 *
 * 历史：2026-07-14 上线。起因：中转站 jixiangai.xyz 实际转发 gpt-image-1（只 b64），
 *       而 gemai.cc 转发 DALL-E 3（支持 url）。本 function 让 url 模式成为常态，
 *       b64 模式作为兜底上传后转 url。
 */

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'sullyos-images';
const KEY_PREFIX = 'image_';
const MAX_B64_LEN = 4 * 1024 * 1024; // 4MB base64 字符串（decode 后 ~3MB 像素）

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

// 规范化 key：加 prefix + 简单校验（防 path traversal）
const normalizeKey = (raw: string | null): string | null => {
    if (!raw) return null;
    if (raw.length > 200 || !/^[A-Za-z0-9_\-.]+$/.test(raw)) return null;
    return `${KEY_PREFIX}${raw}`;
};

const extFromMime = (mime: string): string => {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    return 'png';
};

export default async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    // GET / DELETE：用 query string 取 key
    if (req.method === 'GET' || req.method === 'DELETE') {
        const rawKey = url.searchParams.get('key');
        const key = normalizeKey(rawKey);
        if (!key) {
            return jsonError(400, 'INVALID_KEY', 'key 必须是非空字母数字串');
        }

        let store: ReturnType<typeof getStore>;
        try {
            store = getStore(STORE_NAME);
        } catch (e) {
            console.error('[image-upload-store] getStore failed', e);
            return jsonError(500, 'STORE_INIT_FAILED', '云端存储初始化失败');
        }

        try {
            if (req.method === 'GET') {
                const blob = await store.get(key, { type: 'blob' });
                if (!blob) {
                    return jsonError(404, 'NOT_FOUND', '图片不存在');
                }
                return new Response(blob, {
                    status: 200,
                    headers: {
                        ...CORS_HEADERS,
                        'Content-Type': blob.type || 'image/png',
                        'Cache-Control': 'public, max-age=31536000, immutable',
                    },
                });
            }

            if (req.method === 'DELETE') {
                await store.delete(key);
                return jsonOk({ key, deleted: true });
            }
        } catch (e) {
            const message = e instanceof Error ? e.message : '未知错误';
            console.error('[image-upload-store] error', message, { method: req.method, key });
            return jsonError(500, 'INTERNAL_ERROR', message);
        }
    }

    // POST：上传 b64
    if (req.method === 'POST') {
        try {
            const body = await req.json().catch(() => ({} as any));
            const b64: string | undefined = body?.b64;
            const mime: string = body?.mime || 'image/png';

            if (!b64 || typeof b64 !== 'string') {
                return jsonError(400, 'MISSING_B64', 'b64 字段必填且为字符串');
            }

            if (b64.length > MAX_B64_LEN) {
                return jsonError(413, 'TOO_LARGE', `图片超过 ${MAX_B64_LEN / 1024 / 1024}MB base64 限制`);
            }

            const buffer = Buffer.from(b64, 'base64');
            if (buffer.byteLength === 0) {
                return jsonError(400, 'EMPTY_IMAGE', 'b64 解码后为空');
            }

            const ext = extFromMime(mime);
            const random = Math.random().toString(36).slice(2, 8);
            const key = `${KEY_PREFIX}${Date.now()}_${random}.${ext}`;

            const store = getStore(STORE_NAME);
            await store.set(key, buffer, {
                metadata: { mime, uploadedAt: new Date().toISOString() },
            });

            // 返回公网 url（相对路径，客户端同源调用自动走当前域名）
            // 暮色 2026-07-14：把 image_ 前缀剥掉，因为 normalizeKey 会再加回来
            const userKey = key.replace(KEY_PREFIX, '');
            const publicUrl = `/api/v1/image-upload-store?key=${encodeURIComponent(userKey)}`;
            return jsonOk({ key, url: publicUrl, bytes: buffer.byteLength });
        } catch (e) {
            const message = e instanceof Error ? e.message : '未知错误';
            console.error('[image-upload-store] upload error', message);
            return jsonError(500, 'INTERNAL_ERROR', message);
        }
    }

    return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
};
