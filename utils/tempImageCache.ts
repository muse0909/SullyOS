// 麦麦 2026-09-27：图片 base64 临时缓存
//   - 用户发图后 base64 暂存内存，用于多模态主模型直传（构造 image_url / inline_data）
//   - key 用图床 URL（双图床兜底 imgbb → Cloudinary，正常情况下一定有 URL）
//   - TTL 兜底 5 分钟，防止异常路径下缓存泄漏
//   - 不入数据库，只在内存；进程结束 / 刷新页面会丢
//   - 主请求完成后必须主动 clearTempImage(url) 释放

interface TempImageEntry {
    base64: string;
    expiresAt: number;
}

const _cache = new Map<string, TempImageEntry>();

const DEFAULT_TTL_MS = 5 * 60_000; // 5 分钟

/**
 * 把图片 base64 暂存到内存缓存
 * @param key 图床 URL（双图床兜底保证一定有）
 * @param base64 data:image/jpeg;base64,... 字符串
 * @param ttlMs 过期时间（毫秒），默认 5 分钟兜底
 */
export function setTempImageBase64(key: string, base64: string, ttlMs: number = DEFAULT_TTL_MS): void {
    if (!key || !base64) return;
    _cache.set(key, {
        base64,
        expiresAt: Date.now() + ttlMs,
    });
}

/**
 * 取出缓存的 base64（已过期返回 undefined 并顺手清理）
 */
export function getTempImageBase64(key: string): string | undefined {
    const entry = _cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        _cache.delete(key);
        return undefined;
    }
    return entry.base64;
}

/**
 * 主动清理某条缓存（主请求完成后调用释放）
 */
export function clearTempImage(key: string): void {
    _cache.delete(key);
}

/**
 * 调试用：返回当前缓存大小
 */
export function getTempImageCacheSize(): number {
    return _cache.size;
}