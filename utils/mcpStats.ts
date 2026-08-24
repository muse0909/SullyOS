// mcpStats — MCP 工具调用统计（2026-08-24）
// 暮色 8-24 E 计划：记录每次工具调用的基本信息和耗时，存 IndexedDB
//   - 表名 mcp_call_logs，30 天保留（懒清理：打开统计面板时清）
//   - 导出 JSON 按钮给 debug 用
//   - 失败也记录（包括 INIT_FAILED / TIMEOUT / 协议错误）
//
// 注意：log 写入失败**不**阻塞 callMcpTool 返回（用 .catch(() => {})）

const DB_NAME = 'AetherOS_Data';
const DB_VERSION = 64;  // Bumped: v64 add mcp_call_logs store
const STORE_MCP_LOGS = 'mcp_call_logs';

export interface McpCallLog {
    id?: number;
    serverId: string;
    toolName: string;
    /** args 摘要前 100 字符（避免日志太大） */
    argsPreview: string;
    success: boolean;
    errorMsg?: string;
    /** 耗时（ms） */
    duration: number;
    /** 写入时间戳（ms） */
    timestamp: number;
    /** 是否命中缓存（true = 没真跑） */
    cached: boolean;
}

/** 把 args 对象转成简短字符串摘要（用于日志） */
export function summarizeArgsForLog(args: Record<string, any>, maxLen: number = 100): string {
    try {
        const json = JSON.stringify(args ?? {});
        return json.length > maxLen ? json.slice(0, maxLen) + '…' : json;
    } catch {
        return '[unserializable]';
    }
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * 写一条日志。**不**抛异常，调用方可以放心 .catch(() => {}) 包住
 */
export async function logMcpCall(entry: Omit<McpCallLog, 'id'>): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_MCP_LOGS, 'readwrite');
            const store = tx.objectStore(STORE_MCP_LOGS);
            store.add(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
    } catch (e) {
        // log 写入失败不抛 — console 提示一下
        console.warn('[mcpStats] logMcpCall failed:', e);
    }
}

/** 读最近 N 条日志，按 timestamp 倒序 */
export async function getRecentMcpLogs(limit: number = 20, serverId?: string): Promise<McpCallLog[]> {
    try {
        const db = await openDb();
        const logs = await new Promise<McpCallLog[]>((resolve, reject) => {
            const tx = db.transaction(STORE_MCP_LOGS, 'readonly');
            const store = tx.objectStore(STORE_MCP_LOGS);
            const req = serverId
                ? store.index('serverId').getAll(serverId)
                : store.getAll();
            req.onsuccess = () => {
                const all = (req.result as McpCallLog[]) || [];
                // 倒序 + 截 limit
                all.sort((a, b) => b.timestamp - a.timestamp);
                resolve(all.slice(0, limit));
            };
            req.onerror = () => reject(req.error);
        });
        db.close();
        return logs;
    } catch (e) {
        console.warn('[mcpStats] getRecentMcpLogs failed:', e);
        return [];
    }
}

/** 按 serverId 分组统计：调用总数 + 成功数 */
export interface McpServerStats {
    serverId: string;
    total: number;
    success: number;
    fail: number;
    cached: number;
    avgDuration: number;   // ms
}

export async function getMcpServerStats(): Promise<McpServerStats[]> {
    const all = await getRecentMcpLogs(10000);   // 全量（只取 30 天内，下方清旧）
    const map = new Map<string, { total: number; success: number; fail: number; cached: number; durationSum: number; durationCount: number }>();
    for (const log of all) {
        const cur = map.get(log.serverId) || { total: 0, success: 0, fail: 0, cached: 0, durationSum: 0, durationCount: 0 };
        cur.total++;
        if (log.success) cur.success++;
        else cur.fail++;
        if (log.cached) cur.cached++;
        if (!log.cached) {
            cur.durationSum += log.duration;
            cur.durationCount++;
        }
        map.set(log.serverId, cur);
    }
    return Array.from(map.entries()).map(([serverId, s]) => ({
        serverId,
        total: s.total,
        success: s.success,
        fail: s.fail,
        cached: s.cached,
        avgDuration: s.durationCount > 0 ? Math.round(s.durationSum / s.durationCount) : 0,
    })).sort((a, b) => b.total - a.total);
}

/**
 * 清理 30 天前的旧日志
 * 暮色 8-24 E 计划：懒清理（打开统计面板时清）
 */
export async function clearOldMcpLogs(daysToKeep: number = 30): Promise<number> {
    try {
        const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
        const db = await openDb();
        let deleted = 0;
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_MCP_LOGS, 'readwrite');
            const store = tx.objectStore(STORE_MCP_LOGS);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    const log = cursor.value as McpCallLog;
                    if (log.timestamp < cutoff) {
                        cursor.delete();
                        deleted++;
                    }
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
        return deleted;
    } catch (e) {
        console.warn('[mcpStats] clearOldMcpLogs failed:', e);
        return 0;
    }
}

/** 导出全量 logs 为 JSON 字符串（debug 用） */
export async function exportMcpLogsAsJson(): Promise<string> {
    const all = await getRecentMcpLogs(100000);
    return JSON.stringify({
        exportedAt: new Date().toISOString(),
        count: all.length,
        logs: all,
    }, null, 2);
}

/** 清空全部 logs（debug 用） */
export async function clearAllMcpLogs(): Promise<number> {
    try {
        const db = await openDb();
        let deleted = 0;
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_MCP_LOGS, 'readwrite');
            const store = tx.objectStore(STORE_MCP_LOGS);
            const req = store.clear();
            req.onsuccess = () => { deleted = (req as any).result || 0; resolve(); };
            req.onerror = () => reject(req.error);
        });
        db.close();
        return deleted;
    } catch (e) {
        console.warn('[mcpStats] clearAllMcpLogs failed:', e);
        return 0;
    }
}
