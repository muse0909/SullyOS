/**
 * Chat Presence Storage — 暮色 2026-08-05 Phase 3
 *
 * 跟 amsgChatPresence.ts（叶子模块）配对的存储层。
 * amsgChatPresence 只定义数据格式 + 判定（无 IO），本文件做 localStorage 读写。
 *
 * 用途：主动消息触发时检查"用户是否正在跟这个角色聊天"——是的话跳过。
 * 配 amsgChatPresence 的 CHAT_PRESENCE_TTL_MS（45 秒）：用户发消息后 45 秒内
 * 主动消息不触发，避免撞车。
 *
 * 写入点：跟 ProactiveChat.markUserContact 一致——5 处 Chat.tsx 的 user 发消息 hook
 * 也走那条路，所以 hook 在 ProactiveChat.markUserContact 里就行。
 */

import { AmsgChatPresence, CHAT_PRESENCE_TTL_MS, isFreshChatPresence } from './amsgChatPresence';

const STORAGE_KEY = (charId: string) => `amsg:char:${charId}/chat_presence`;

/** 写"用户正在跟这个角色聊天"的快照。 */
export function markUserChatPresence(charId: string, now: number = Date.now()): void {
    try {
        const value: AmsgChatPresence = {
            v: 1,
            charId,
            activeAt: now,
            lastUserMessageAt: now,
        };
        localStorage.setItem(STORAGE_KEY(charId), JSON.stringify(value));
    } catch {
        // localStorage 满 / 不可用，静默
    }
}

/** 读"用户正在跟这个角色聊天"的快照。没存过返回 null。 */
export function getUserChatPresence(charId: string): AmsgChatPresence | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY(charId)) || undefined;
        return raw ? (JSON.parse(raw) as AmsgChatPresence) : null;
    } catch {
        return null;
    }
}

/** 便捷判断：用户现在（now 时点）是否还在跟这个角色聊。 */
export function isUserCurrentlyChatting(charId: string, now: number = Date.now()): boolean {
    return isFreshChatPresence(getUserChatPresence(charId), charId, now);
}

/** 主动消息触发后清除"用户在场"标记——主动消息已发，不需要再让路。 */
export function clearUserChatPresence(charId: string): void {
    try {
        localStorage.removeItem(STORAGE_KEY(charId));
    } catch {
        // 静默
    }
}

/** 导出 TTL 方便其他模块 import。 */
export { CHAT_PRESENCE_TTL_MS };
