/**
 * proactiveCount 单元测试
 * 暮色 2026-08-05 Phase 3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { DB, openDB } from './db';
import { countProactiveToday, hasReachedDailyLimit, MAX_PROACTIVE_PER_DAY } from './proactiveCount';

const CHAR_ID = 'test-char-proactive-001';

describe('proactiveCount', () => {
    beforeEach(async () => {
        // 打开 DB 触发 schema 创建（messages store 等）
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('messages', 'readwrite');
            const store = tx.objectStore('messages');
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
        db.close();
        // 清空记忆宫殿水位线（避免 getRecentMessagesByCharId 过滤掉测试数据）
        try { localStorage.removeItem(`mp_lastMsgId_${CHAR_ID}`); } catch {}
    });

    it('空角色：count = 0', async () => {
        const count = await countProactiveToday(CHAR_ID);
        expect(count).toBe(0);
    });

    it('空角色：hasReachedDailyLimit = false', async () => {
        const reached = await hasReachedDailyLimit(CHAR_ID);
        expect(reached).toBe(false);
    });

    it('3 条主动消息 + 2 条普通消息：count = 3', async () => {
        const now = Date.now();
        // 3 条主动
        for (let i = 0; i < 3; i++) {
            await DB.saveMessage({
                charId: CHAR_ID,
                role: 'assistant',
                type: 'text',
                content: `proactive ${i}`,
                metadata: { isProactive: true },
                timestamp: now - i * 1000,
            } as any);
        }
        // 2 条普通
        for (let i = 0; i < 2; i++) {
            await DB.saveMessage({
                charId: CHAR_ID,
                role: 'user',
                type: 'text',
                content: `user ${i}`,
                metadata: {},
                timestamp: now - i * 1000,
            } as any);
        }

        const count = await countProactiveToday(CHAR_ID);
        expect(count).toBe(3);
    });

    it('9 条主动消息：hasReachedDailyLimit = false（< 10）', async () => {
        const now = Date.now();
        for (let i = 0; i < 9; i++) {
            await DB.saveMessage({
                charId: CHAR_ID,
                role: 'assistant',
                type: 'text',
                content: `p ${i}`,
                metadata: { isProactive: true },
                timestamp: now - i * 1000,
            } as any);
        }

        const reached = await hasReachedDailyLimit(CHAR_ID);
        expect(reached).toBe(false);
    });

    it(`10 条主动消息：hasReachedDailyLimit = true（= ${MAX_PROACTIVE_PER_DAY}）`, async () => {
        const now = Date.now();
        for (let i = 0; i < MAX_PROACTIVE_PER_DAY; i++) {
            await DB.saveMessage({
                charId: CHAR_ID,
                role: 'assistant',
                type: 'text',
                content: `p ${i}`,
                metadata: { isProactive: true },
                timestamp: now - i * 1000,
            } as any);
        }

        const reached = await hasReachedDailyLimit(CHAR_ID);
        expect(reached).toBe(true);
    });

    it('昨天的主动消息不算', async () => {
        const yesterday = Date.now() - 25 * 60 * 60 * 1000; // 25h ago
        await DB.saveMessage({
            charId: CHAR_ID,
            role: 'assistant',
            type: 'text',
            content: '昨天发的',
            metadata: { isProactive: true },
            timestamp: yesterday,
        } as any);

        const count = await countProactiveToday(CHAR_ID);
        expect(count).toBe(0);
    });
});
