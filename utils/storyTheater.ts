/**
 * 剧情模式 Story Theater — 工具函数
 *
 * 暮色 8-25 第二步:StoryTheater 主入口 + 列表页基础结构。
 *   只搬 3 个最基础的 helper,后面做 session / preset 时再补其他工具。
 *
 * 设计:
 *   - 单人 RP:暮色 = 暮色,Entry 没有 mask 字段
 *   - Entry 只有一个 characterId(当前对话角色),不是 characterIds
 *   - 消息存主 messages 表(用独立 charId 线程 = storyTheaterThreadId(entryId))
 *     → 跟暮色原版"复用 messages 表"约定一致,无需新开 store
 */

import type { StoryTheaterEntry } from '../types';
import { generateClientId } from './db';

/**
 * 线程 ID:每条剧情用独立 charId 线程存消息
 *  格式: `story-theater:${entryId}` — 跟主聊天消息复用 messages 表
 *  跟【陪伴】会话不冲突,因为陪伴的 charId 是真实角色 ID
 */
export const storyTheaterThreadId = (entryId: string): string => `story-theater:${entryId}`;

/**
 * 新建 Entry 默认值
 *   - id 用 generateClientId() 生成
 *   - characterId 由调用方传入(从 useOS().activeCharacterId 拿)
 *   - writesToCharacterMemory 默认 false(第三步做 session 时再加开关 UI)
 */
export const createStoryTheaterDraft = (
    characterId: string,
    title: string = '新剧场',
    premise: string = '',
    now: number = Date.now(),
): StoryTheaterEntry => ({
    id: generateClientId(),
    title,
    premise,
    characterId,
    writesToCharacterMemory: false,
    createdAt: now,
    updatedAt: now,
});

/**
 * 规整 Entry — 读 DB 老数据时容错:
 *   - id 缺 → 重新生成(几乎不会发生,DB 写入时已经塞了)
 *   - 时间戳缺 → 用 now
 *   - characterId 缺 → 抛错(必填)
 *   - writesToCharacterMemory 缺 → 默认 false
 */
export const normalizeStoryTheater = (
    entry: Partial<StoryTheaterEntry> | null | undefined,
    now: number = Date.now(),
): StoryTheaterEntry => {
    if (!entry) {
        throw new Error('[storyTheater] normalizeStoryTheater: entry is empty');
    }
    if (!entry.characterId) {
        throw new Error('[storyTheater] normalizeStoryTheater: characterId is required (single-character RP)');
    }
    return {
        id: entry.id || generateClientId(),
        title: entry.title || '未命名剧场',
        premise: entry.premise || '',
        characterId: entry.characterId,
        writesToCharacterMemory: entry.writesToCharacterMemory ?? false,
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
    };
};
