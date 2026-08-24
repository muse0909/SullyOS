// mcpCache — MCP 工具调用结果内存缓存（2026-08-24）
// 暮色 8-24 规格（D 计划）：
//   - 同一个工具 + 同样的参数,5 分钟内重复调用直接返回缓存结果
//   - 内存 Map（不用 IndexedDB,重启清空符合预期）
//   - args key 排序后 stringify,保证顺序不同但内容相同的调用命中同一条
//   - 失败的调用不缓存
//   - clearMcpCache(serverId?) 可选按 server 清理
//
// 缓存 key: `${serverId}:${toolName}:${sortedJsonArgs}`
// 缓存 value: { result: McpCallResult, timestamp: number, ttl: 300000 }

import type { McpCallResult } from '../types';

const DEFAULT_TTL_MS = 5 * 60 * 1000;   // 5 分钟

interface CacheEntry {
    result: McpCallResult;
    timestamp: number;
    ttl: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * 生成稳定缓存 key
 *   - args 对象的 key 按字母序排序后 JSON.stringify
 *   - 顺序不同但内容相同的调用会命中同一条
 */
export function makeCacheKey(serverId: string, toolName: string, args: Record<string, any>): string {
    const sortedArgs = sortArgsDeep(args);
    return `${serverId}:${toolName}:${JSON.stringify(sortedArgs)}`;
}

function sortArgsDeep(value: any): any {
    if (Array.isArray(value)) {
        return value.map(sortArgsDeep);
    }
    if (value && typeof value === 'object' && value.constructor === Object) {
        const sorted: Record<string, any> = {};
        for (const k of Object.keys(value).sort()) {
            sorted[k] = sortArgsDeep(value[k]);
        }
        return sorted;
    }
    return value;
}

/**
 * 查缓存。命中且未过期返回 result（带 cached:true），未命中或已过期返回 null
 */
export function getCachedMcpResult(
    serverId: string,
    toolName: string,
    args: Record<string, any>
): (McpCallResult & { cached: true }) | null {
    const key = makeCacheKey(serverId, toolName, args);
    const entry = cache.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
        cache.delete(key);
        return null;
    }
    return { ...entry.result, cached: true };
}

/**
 * 写缓存。只缓存成功结果（success:true）
 */
export function setCachedMcpResult(
    serverId: string,
    toolName: string,
    args: Record<string, any>,
    result: McpCallResult,
    ttlMs: number = DEFAULT_TTL_MS
): void {
    if (!result.success) return;     // 失败不缓存
    const key = makeCacheKey(serverId, toolName, args);
    cache.set(key, { result, timestamp: Date.now(), ttl: ttlMs });
}

/**
 * 清缓存。不传 serverId = 全清，传了 = 只清该 server 的条目
 */
export function clearMcpCache(serverId?: string): number {
    if (!serverId) {
        const n = cache.size;
        cache.clear();
        return n;
    }
    const prefix = `${serverId}:`;
    let n = 0;
    for (const key of Array.from(cache.keys())) {
        if (key.startsWith(prefix)) {
            cache.delete(key);
            n++;
        }
    }
    return n;
}

/**
 * 调试用：当前缓存条目数
 */
export function getMcpCacheSize(): number {
    return cache.size;
}
