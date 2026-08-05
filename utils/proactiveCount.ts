/**
 * Proactive Count — 暮色 2026-08-05 Phase 3
 *
 * 给 OSContext.runProactive 加一道"每天主动消息条数上限"防刷闸。
 * 原 v1.0 主动消息只有"节流"（ProactiveChat.markUserContact 每 N 分钟才触发），
 * 但没有"每天 N 条"硬上限——理论上角色可以无限触发。
 *
 * 接 2.0 工具 MAX_ACTIVE_TASKS_PER_CHAR（接力任务数上限）思路：
 *   - MAX_PROACTIVE_PER_DAY：每角色每天主动消息条数上限（默认 10）
 *   - countProactiveToday：统计今天这个角色已发了几条主动消息
 *   - hasReachedDailyLimit：便捷判断（>= 上限返回 true）
 *
 * 主动消息特征：m.metadata?.isProactive === true（OSContext 写入时打的标记）
 * 不算"主动消息"：couple_space_event 情侣空间打卡 / system 连接中断 等
 *
 * 性能：只查最近 100 条（不是全表扫描），一天内不会超 100 条主动消息
 */

import { DB } from './db';

/** 暮色 2026-08-05：每角色每天主动消息条数硬上限。默认 10，可调。 */
export const MAX_PROACTIVE_PER_DAY = 10;

/** 主动消息识别：m.metadata?.isProactive === true（OSContext.runProactive 写入） */
const isProactiveMessage = (m: { metadata?: any }): boolean =>
    m.metadata?.isProactive === true;

/**
 * 统计今天这个角色已经发了几条主动消息。
 * - 只查最近 100 条（一天内不会超）
 * - 跨午夜按"今天 0 点"分界（不按 24h 滑动窗口）
 */
export async function countProactiveToday(charId: string): Promise<number> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const recent = await DB.getRecentMessagesByCharId(charId, 100);
    return recent.filter(m =>
        isProactiveMessage(m) && m.timestamp >= todayStartMs
    ).length;
}

/**
 * 便捷判断：这个角色今天是否已经触及每天主动消息上限。
 * true = 已达上限（runProactive 应该跳过）
 */
export async function hasReachedDailyLimit(charId: string): Promise<boolean> {
    const count = await countProactiveToday(charId);
    return count >= MAX_PROACTIVE_PER_DAY;
}
