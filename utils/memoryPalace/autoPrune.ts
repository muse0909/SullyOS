/**
 * Memory Palace — 记忆关系网（memory_links）自动修剪
 *
 * 暮色 2026-07-22 拍板：每月自动跑一次 topN 修剪，避免节点关联数缓慢增长
 *   - 30 天间隔检查（用 localStorage 记上次时间戳）
 *   - 距上次 < 30 天 → 跳过
 *   - 触发时机：App 启动时（OSContext 初始化阶段）— 用户每次开 App 检查一次
 *   - 失败静默（不抛）
 *
 * 不动 memory_nodes / memory_vectors / messages / assets。
 */

import { MemoryLinkDB } from './db';

const LAST_PRUNE_KEY = 'mp_lastLinkPruneAt';

/** 30 天 = 30 × 24 × 60 × 60 × 1000 ms */
export const AUTO_PRUNE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AutoPruneRan {
    ran: true;
    reason: 'ok';
    result: { before: number; after: number; removed: number; topN: number };
    lastPruneAt: number;
}

export interface AutoPruneSkipped {
    ran: false;
    reason: 'too-soon' | 'no-links' | 'error';
    lastPruneAt?: number;
    /** 下次允许修剪的时间戳（毫秒）— reason='too-soon' 时有 */
    nextEligibleAt?: number;
    error?: string;
}

export type AutoPruneResult = AutoPruneRan | AutoPruneSkipped;

/**
 * 检查并执行自动修剪（如果距上次修剪 ≥ 30 天）
 *
 * @param topN 每个节点最多保留的关系数，默认 70
 * @param minIntervalMs 最小间隔（毫秒），默认 30 天
 * @returns AutoPruneResult
 */
export async function maybeAutoPruneMemoryLinks(
    topN: number = 70,
    minIntervalMs: number = AUTO_PRUNE_INTERVAL_MS,
): Promise<AutoPruneResult> {
    const now = Date.now();

    // 读上次修剪时间
    let lastPruneAt: number | undefined;
    try {
        const raw = localStorage.getItem(LAST_PRUNE_KEY);
        if (raw) {
            const parsed = parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                lastPruneAt = parsed;
            }
        }
    } catch {
        // localStorage 不可用时当作从未修剪过
    }

    // 核实程序：低于 30 天就放弃
    if (typeof lastPruneAt === 'number') {
        const elapsed = now - lastPruneAt;
        if (elapsed < minIntervalMs) {
            return {
                ran: false,
                reason: 'too-soon',
                lastPruneAt,
                nextEligibleAt: lastPruneAt + minIntervalMs,
            };
        }
    }

    // 执行修剪
    try {
        const result = await MemoryLinkDB.pruneAllByTopN(topN);

        // 写回时间戳（即使没删东西也更新 — 用户跑了 0 删，下次 30 天后再跑）
        try {
            localStorage.setItem(LAST_PRUNE_KEY, String(now));
        } catch {
            // 写不进去不影响主流程
        }

        return {
            ran: true,
            reason: 'ok',
            result,
            lastPruneAt: now,
        };
    } catch (err: any) {
        // 修剪失败：写时间戳避免每次启动都重试（错误状态下 30 天后重试）
        try {
            localStorage.setItem(LAST_PRUNE_KEY, String(now));
        } catch {
            // ignore
        }
        return {
            ran: false,
            reason: 'error',
            lastPruneAt: now,
            error: err?.message || String(err),
        };
    }
}

/** 测试 / 调试用：清除上次修剪时间戳（下次启动会立即跑一次） */
export function resetAutoPruneTimestamp(): void {
    try {
        localStorage.removeItem(LAST_PRUNE_KEY);
    } catch {
        // ignore
    }
}

/** 测试 / 调试用：读上次修剪时间戳 */
export function getLastPruneTimestamp(): number | null {
    try {
        const raw = localStorage.getItem(LAST_PRUNE_KEY);
        if (!raw) return null;
        const parsed = parseInt(raw, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
        return null;
    }
}
