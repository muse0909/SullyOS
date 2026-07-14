/**
 * Cloudflare R2 Image Upload
 *
 * 接收浏览器发来的 b64 图片，上传到 Cloudflare R2 对象存储，返回永久公网 url。
 * 替代之前的 imgbb 方案（imgbb 免费版会压缩图片，截图字小看不清）。
 * 路由：/api/r2-upload
 *
 *   POST  body: { b64: string, mime?: string, accountId, accessKeyId, secretAccessKey, bucket, publicUrl }
 *         返回: { success: true, key, url, bytes }
 *
 * 设计：
 *   - 用 @aws-sdk/client-s3 调 R2（R2 兼容 S3 API）
 *   - 凭证从前端传过来（暮色在 Settings 卡片里填）+ 服务端转发，不在浏览器暴露给 S3
 *   - key 加 `image_` 前缀（生图）/ `user_` 前缀（用户发图），避免和以后其他类型冲突
 *   - mime 默认 image/png，jpeg 时客户端传 'image/jpeg'
 *   - 限制：base64 字符串 ≤ 4MB（decode 后约 3MB）
 *   - 失败统一返回 {success:false, error:...}，前端 catch 走 imgbb 兜底
 *
 * 历史：2026-07-14 上线，替代 imgbb（压缩问题）
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const MAX_B64_LEN = 4 * 1024 * 1024; // 4MB base64 字符串

const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
};

const jsonError = (status: number, code: string, message: string) => ({
    statusCode: status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ success: false, error: { code, message } }),
});

const jsonOk = (body: Record<string, any>) => ({
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ success: true, ...body }),
});

const extFromMime = (mime: string): string => {
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    return 'png';
};

export default async (req: any) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }

    if (req.method !== 'POST') {
        return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const {
            b64,
            mime = 'image/png',
            prefix = 'image',
            accountId,
            accessKeyId,
            secretAccessKey,
            bucket,
            publicUrl,
        } = body;

        // 校验 b64
        if (!b64 || typeof b64 !== 'string') {
            return jsonError(400, 'MISSING_B64', 'b64 字段必填且为字符串');
        }
        if (b64.length > MAX_B64_LEN) {
            return jsonError(413, 'TOO_LARGE', `图片超过 ${MAX_B64_LEN / 1024 / 1024}MB base64 限制`);
        }

        // 校验 R2 凭证
        if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
            return jsonError(400, 'MISSING_R2_CONFIG', 'R2 凭证不完整（accountId/accessKeyId/secretAccessKey/bucket/publicUrl 都必填）');
        }

        const buffer = Buffer.from(b64, 'base64');
        if (buffer.byteLength === 0) {
            return jsonError(400, 'EMPTY_IMAGE', 'b64 解码后为空');
        }

        const ext = extFromMime(mime);
        const random = Math.random().toString(36).slice(2, 8);
        const key = `${prefix}_${Date.now()}_${random}.${ext}`;

        // 构造 S3 客户端（指向 R2 endpoint）
        const client = new S3Client({
            region: 'auto',
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });

        await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: mime,
        }));

        // 拼公网 url（去掉尾部斜杠 + 拼 key）
        const cleanPublicUrl = publicUrl.replace(/\/+$/, '');
        const finalUrl = `${cleanPublicUrl}/${key}`;

        return jsonOk({ key, url: finalUrl, bytes: buffer.byteLength });
    } catch (e: any) {
        const message = e instanceof Error ? e.message : '未知错误';
        console.error('[r2-upload] error', message);
        return jsonError(500, 'INTERNAL_ERROR', message);
    }
};
