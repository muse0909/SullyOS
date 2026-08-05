/**
 * chatPresenceStorage 单元测试
 * 暮色 2026-08-05 Phase 3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    markUserChatPresence,
    getUserChatPresence,
    isUserCurrentlyChatting,
    clearUserChatPresence,
} from './chatPresenceStorage';
import { CHAT_PRESENCE_TTL_MS } from './amsgChatPresence';

// 暮色 2026-08-05：vitest 默认环境是 node，没有 localStorage
//   stub 一个内存版 Map 模拟 localStorage 行为
const store = new Map<string, string>();
const localStorageMock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
};
vi.stubGlobal('localStorage', localStorageMock);

const CHAR_ID = 'test-char-presence-001';

describe('chatPresenceStorage', () => {
    beforeEach(() => {
        store.clear();
    });

    it('markUserChatPresence + getUserChatPresence：写入读出', () => {
        const now = Date.now();
        markUserChatPresence(CHAR_ID, now);
        const got = getUserChatPresence(CHAR_ID);
        expect(got).not.toBeNull();
        expect(got?.v).toBe(1);
        expect(got?.charId).toBe(CHAR_ID);
        expect(got?.activeAt).toBe(now);
        expect(got?.lastUserMessageAt).toBe(now);
    });

    it('没存过：getUserChatPresence = null', () => {
        expect(getUserChatPresence(CHAR_ID)).toBeNull();
    });

    it('isUserCurrentlyChatting：刚 mark = true', () => {
        markUserChatPresence(CHAR_ID);
        expect(isUserCurrentlyChatting(CHAR_ID)).toBe(true);
    });

    it('isUserCurrentlyChatting：45 秒前 = false（已过期）', () => {
        const tooOld = Date.now() - CHAT_PRESENCE_TTL_MS - 1000;
        markUserChatPresence(CHAR_ID, tooOld);
        expect(isUserCurrentlyChatting(CHAR_ID, Date.now())).toBe(false);
    });

    it('isUserCurrentlyChatting：20 秒前 = true（还在窗口内）', () => {
        const withinWindow = Date.now() - 20_000;
        markUserChatPresence(CHAR_ID, withinWindow);
        expect(isUserCurrentlyChatting(CHAR_ID, Date.now())).toBe(true);
    });

    it('clearUserChatPresence：清掉后 isUser = false', () => {
        markUserChatPresence(CHAR_ID);
        expect(isUserCurrentlyChatting(CHAR_ID)).toBe(true);
        clearUserChatPresence(CHAR_ID);
        expect(isUserCurrentlyChatting(CHAR_ID)).toBe(false);
        expect(getUserChatPresence(CHAR_ID)).toBeNull();
    });

    it('不同 charId 互不干扰', () => {
        const charA = 'char-A';
        const charB = 'char-B';
        markUserChatPresence(charA);
        expect(isUserCurrentlyChatting(charA)).toBe(true);
        expect(isUserCurrentlyChatting(charB)).toBe(false);
    });

    it('charId 不匹配：isUser = false（即使 activeAt 在窗口内）', () => {
        const otherChar = 'other-char';
        markUserChatPresence(otherChar);
        expect(isUserCurrentlyChatting(CHAR_ID)).toBe(false);
    });
});
