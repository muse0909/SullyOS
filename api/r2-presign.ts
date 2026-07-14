/**
 * Cloudflare R2 Presigned URL — 自写 SigV4 签名版（去掉 AWS SDK，冷启动 < 100ms）
 *
 * 历史背景：
 *   - 2026-07-14 v1: 用 @aws-sdk/s3-request-presigner 签 URL → Vercel function 冷启动 3-5 秒（SDK 包 1MB+）
 *     经常 504 Gateway Timeout（Vercel Hobby 10 秒硬限制），后端接 ~100ms 承诺实际 8-10 秒
 *   - 2026-07-14 v2 (当前): 自己写 SigV4 签名，Node.js 内置 crypto 模块，冷启动 < 100ms
 *
 * AWS S3 SigV4 签名规范：https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 * R2 是 S3 兼容，所以签名逻辑跟 S3 一样；region 固定 'auto'
 *
 * 路由：/api/r2-presign
 *   POST body: { mime?, prefix?, accountId, accessKeyId, secretAccessKey, bucket, publicUrl, expiresIn? }
 *   返回: { success, presignedUrl, key, publicUrl, expiresIn }
 *
 * 设计：
 *   - Vercel function 收到请求后只签 URL（< 50ms），不传文件——大文件走浏览器直传
 *   - presigned URL 默认 600 秒（10 分钟）有效（X-Amz-Expires=600）——足够慢速上传
 *   - presigned URL 包含临时签名（HMAC-SHA256），Secret 不会出现在 URL 里
 *   - 客户端拿到 URL 后用 fetch(presignedUrl, { method: 'PUT', body: file }) 直接传
 *   - 失败降级：R2 不可用 → 浏览器降级到 imgbb → 降级到 data URL（上层逻辑）
 */

import { createHmac, createHash } from 'crypto';

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

// ---------- AWS SigV4 helpers ----------

// SHA256 字符串 → hex
const sha256Hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

// HMAC-SHA256 → Buffer
const hmacBuf = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

// RFC 3986 编码（比 encodeURIComponent 更严格，处理 ~ * ' 等）
// AWS SigV4 规范要求 URI 编码使用 RFC 3986
const rfc3986Encode = (s: string): string =>
    encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// amz-date: YYYYMMDDTHHMMSSZ
const amzDate = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        d.getUTCFullYear() +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate()) +
        'T' +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes()) +
        pad(d.getUTCSeconds()) +
        'Z'
    );
};

// date-stamp: YYYYMMDD
const dateStamp = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
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

        // ---- SigV4 签名 ----
        const now = new Date();
        const amzDateStr = amzDate(now);
        const dateStampStr = dateStamp(now);
        const region = 'auto'; // R2 固定
        const service = 's3';
        const host = `${accountId}.r2.cloudflarestorage.com`;
        const credentialScope = `${dateStampStr}/${region}/${service}/aws4_request`;

        // 1. Canonical Query String（按字典序排序 + RFC 3986 编码）
        const queryParams: Record<string, string> = {
            'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
            'X-Amz-Date': amzDateStr,
            'X-Amz-Expires': String(safeExpiresIn),
            'X-Amz-SignedHeaders': 'host',
        };
        const canonicalQueryString = Object.keys(queryParams)
            .sort()
            .map(k => `${rfc3986Encode(k)}=${rfc3986Encode(queryParams[k])}`)
            .join('&');

        // 2. Canonical URI（每个 path 段分别编码，再拼回 /）
        // 我们生成的 key 只含 [A-Za-z0-9_-]，实际不会触发编码，但保持严谨
        const canonicalUri = '/' + [bucket, key].map(rfc3986Encode).join('/');

        // 3. Canonical Headers（host 头 + 末尾 \n）
        const canonicalHeaders = `host:${host}\n`;

        // 4. Signed Headers
        const signedHeaders = 'host';

        // 5. Canonical Request
        //    注：presigned URL 模式下 payload hash 用 UNSIGNED-PAYLOAD（不签 body）
        const canonicalRequest = [
            'PUT',
            canonicalUri,
            canonicalQueryString,
            canonicalHeaders,
            signedHeaders,
            'UNSIGNED-PAYLOAD',
        ].join('\n');

        // 6. String to Sign
        const stringToSign = [
            'AWS4-HMAC-SHA256',
            amzDateStr,
            credentialScope,
            sha256Hex(canonicalRequest),
        ].join('\n');

        // 7. 计算签名密钥链
        const kDate = hmacBuf('AWS4' + secretAccessKey, dateStampStr);
        const kRegion = hmacBuf(kDate, region);
        const kService = hmacBuf(kRegion, service);
        const kSigning = hmacBuf(kService, 'aws4_request');

        // 8. 签名
        const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

        // 9. 构造 presigned URL
        const presignedUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

        // 10. 拼公网 URL（给客户端用来存消息/显示）
        const cleanPublicUrl = publicUrl.replace(/\/+$/, '');

        return jsonOk({
            presignedUrl,
            key,
            publicUrl: `${cleanPublicUrl}/${key}`,
            expiresIn: safeExpiresIn,
        });
    } catch (e: any) {
        const message = e instanceof Error ? e.message : '未知错误';
        console.error('[r2-presign] error', message);
        return jsonError(500, 'INTERNAL_ERROR', message);
    }
};
