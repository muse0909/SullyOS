/**
 * Cloudflare R2 Presigned URL
 *
 * 给浏览器签一个临时 URL，让浏览器**直接 PUT 到 R2**（绕开 Vercel function 10 秒限制）。
 * 解决之前 Vercel function 中转上传的 5 分钟延迟问题。
 * 路由：/api/r2-presign
 *
 *   POST body: { mime?, prefix?, accountId, accessKeyId, secretAccessKey, bucket, publicUrl }
 *   返回: { success, presignedUrl, key, publicUrl, expiresIn }
 *
 * 设计：
 *   - Vercel function 收到请求后**只签 URL**（< 200ms），**不传文件**——大文件走浏览器直传
 *   - presigned URL 默认 10 分钟有效（X-Amz-Expires=600）——足够慢速上传
 *   - presigned URL 包含**临时签名**（HMAC-SHA256），Secret 不会出现在 URL 里
 *   - 客户端拿到 URL 后用 fetch(presignedUrl, { method: 'PUT', body: file }) 直接传
 *   - 失败降级：R2 不可用 → 用 data URL 兜底（旧逻辑保留）
 *
 * 历史：
 *   - 2026-07-14：替换 r2-upload.ts（Vercel function 中转会被 10 秒限制切断）
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
    if (req.method === 'OPTIONS') {
        return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (req.method !== 'POST') {
        return jsonError(405, 'METHOD_NOT_ALLOWED', `method ${req.method} 不支持`);
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const {
            mime = 'image/png',
            prefix = 'image',
            accountId,
            accessKeyId,
            secretAccessKey,
            bucket,
            publicUrl,
            // 暮色 2026-07-14：客户端可指定 expiresIn（秒），默认 600（10 分钟）
            expiresIn = 600,
        } = body;

        // 校验 R2 凭证
        if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
            return jsonError(400, 'MISSING_R2_CONFIG', 'R2 凭证不完整（accountId/accessKeyId/secretAccessKey/bucket/publicUrl 都必填）');
        }

        // 限制 expiresIn 在合理范围（1 分钟 ~ 1 小时）
        const safeExpiresIn = Math.max(60, Math.min(3600, parseInt(expiresIn, 10) || 600));

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

        // 生成 presigned URL（PUT 方法，10 分钟有效）
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: mime,
        });
        const presignedUrl = await getSignedUrl(client, command, { expiresIn: safeExpiresIn });

        // 返回公网前缀（用 client 拼构造，调用方拼 key 即可）
        const cleanPublicUrl = publicUrl.replace(/\/+$/, '');

        return jsonOk({
            presignedUrl,
            key,
            publicUrl: `${cleanPublicUrl}/${key}`, // 浏览器上传成功后用这个公网 URL
            expiresIn: safeExpiresIn,
        });
    } catch (e: any) {
        const message = e instanceof Error ? e.message : '未知错误';
        console.error('[r2-presign] error', message);
        return jsonError(500, 'INTERNAL_ERROR', message);
    }
};
