// api/proxy-image.ts
// 用途：跨域下载图床图片时绕过浏览器 CORS
// 暮色 Vercel 域名（sully-os-git-preview-*.vercel.app）跟图床（img.ai198.top / imgbb 等）不同源，
// 浏览器强制 CORS，直接 fetch 会被拦。这个代理是后端中转，绕开 CORS 把图片流回前端。
// 部署：Vercel Serverless Function（vercel.json 已配 api/ 目录，文件即 endpoint /api/proxy-image）
// 调用：GET /api/proxy-image?url=<encoded-image-url>

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB — 图床图一般几 MB，超过这个几乎都是错的
const FETCH_TIMEOUT_MS = 10_000; // Vercel hobby 计划函数本身 10s 超时

// 防 SSRF：拒绝内网 / loopback 地址，避免被滥用当内网跳板扫 127.x / 10.x / 192.168.x
function isPrivateHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (ipv4) {
        const a = parseInt(ipv4[1], 10);
        const b = parseInt(ipv4[2], 10);
        if (a === 10) return true;                         // 10.0.0.0/8
        if (a === 127) return true;                        // 127.0.0.0/8 loopback
        if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
        if (a === 192 && b === 168) return true;           // 192.168.0.0/16
        if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local
    }

    if (h === '::1' || h === '[::1]') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 ULA
    if (h.startsWith('fe80:')) return true;                   // fe80::/10 link-local

    return false;
}

export default async function handler(req: any, res: any) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const targetUrl = typeof req.query?.url === 'string' ? req.query.url : '';
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing url param' });
    }
    if (targetUrl.length > 2048) {
        return res.status(400).json({ error: 'URL too long' });
    }

    let parsed: URL;
    try {
        parsed = new URL(targetUrl);
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ error: 'Only http(s) allowed' });
    }

    if (isPrivateHost(parsed.hostname)) {
        return res.status(400).json({ error: 'Private host not allowed' });
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    try {
        const upstream = await fetch(parsed.toString(), {
            signal: ac.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (SullyOS Image Proxy)',
                'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
            },
        });
        clearTimeout(timer);

        if (!upstream.ok) {
            return res.status(502).json({ error: `Upstream ${upstream.status}` });
        }

        const contentLength = upstream.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
            return res.status(413).json({ error: 'Image too large' });
        }

        const arrayBuffer = await upstream.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
            return res.status(413).json({ error: 'Image too large' });
        }

        const upstreamType = upstream.headers.get('content-type') || '';
        // 只透传 image/* content-type；上游返回 HTML 错误页伪装成 image/png 容易被误判下载坏图
        const finalType = upstreamType.toLowerCase().startsWith('image/')
            ? upstreamType
            : 'application/octet-stream';

        res.setHeader('Content-Type', finalType);
        res.setHeader('Content-Length', String(arrayBuffer.byteLength));
        res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');

        return res.status(200).send(Buffer.from(arrayBuffer));
    } catch (e: any) {
        clearTimeout(timer);
        if (e?.name === 'AbortError') {
            return res.status(504).json({ error: 'Upstream timeout' });
        }
        return res.status(502).json({ error: e?.message || 'Proxy failed' });
    }
}
