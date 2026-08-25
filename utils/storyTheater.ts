/**
 * 剧情模式 Story Theater — 工具函数 + LightLLM 调用
 *
 * 暮色 8-25 第三步:
 *   - 消息存主 messages 表,charId = storyTheaterThreadId(entryId)(复用现有 store)
 *   - 摘要触发:满 10 条(5 轮)才调 lightLLM,不够不触发(避免无意义开销)
 *   - 退出同步:写 memory_node(累积叙事)+ 发 comment 到聊天框(DB.saveMessage + addToast)
 *
 * LightLLM 调用:优先 memoryPalaceConfig.lightLLM,fallback apiConfig。
 *   暮色 RP 模式暂只支持 openai 协议(跟彼方图书馆一致)—— 完整 3 协议后续再加。
 */

import type {
    APIConfig,
    CharacterProfile,
    Message,
    StorySessionSummary,
    StoryStatusSnapshot,
    StoryTheaterEntry,
    UserProfile,
} from '../types';
import type { MemoryPalaceGlobalConfig } from '../context/OSContext';
import { DB, generateClientId } from './db';
import { safeFetchJson } from './safeApi';
import { MemoryNodeDB } from './memoryPalace/db';
import {
    buildBatchSummaryPrompt,
    buildCommentPrompt,
    buildMergeSummaryPrompt,
} from './storyTheater/prompts';

export const BATCH_SIZE = 10;       // 每批摘要的消息数(5 轮 = 10 条)
export const KEEP_RECENT = 10;      // 保留最近 5 轮原文

/* ─── 线程 ID ──────────────────────────────────────── */

export const storyTheaterThreadId = (entryId: string): string => `story-theater:${entryId}`;

/* ─── Entry 草稿 + 规整(第二步已有) ─────────────────── */

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
    writesToCharacterMemory: true,   // 暮色 8-25 第三步:默认开启,退出时同步
    createdAt: now,
    updatedAt: now,
});

export const normalizeStoryTheater = (
    entry: Partial<StoryTheaterEntry> | null | undefined,
    now: number = Date.now(),
): StoryTheaterEntry => {
    if (!entry) throw new Error('[storyTheater] normalizeStoryTheater: entry is empty');
    if (!entry.characterId) throw new Error('[storyTheater] normalizeStoryTheater: characterId is required');
    return {
        id: entry.id || generateClientId(),
        title: entry.title || '未命名剧场',
        premise: entry.premise || '',
        characterId: entry.characterId,
        writesToCharacterMemory: entry.writesToCharacterMemory ?? true,
        summary: entry.summary,
        createdAt: entry.createdAt || now,
        updatedAt: entry.updatedAt || now,
    };
};

/* ─── session 消息读写(主 messages 表,按 charId 线程) ── */

export async function getSessionMessages(entryId: string): Promise<Message[]> {
    const charId = storyTheaterThreadId(entryId);
    return DB.getMessagesByCharId(charId, true);  // 包含已处理(剧情模式不走记忆宫殿 hwm)
}

export async function getSessionMessageCount(entryId: string): Promise<number> {
    const msgs = await getSessionMessages(entryId);
    return msgs.length;
}

export async function appendSessionMessage(
    entryId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, any>,
): Promise<number> {
    return DB.saveMessage({
        charId: storyTheaterThreadId(entryId),
        role,
        type: 'text',
        content,
        metadata: { ...metadata, source: 'story-theater', entryId },
    });
}

/* ─── LLM 回复解析:状态栏 + 正文(暮色 8-25 第四步) ── */

/**
 * 解析 LLM 回复,拆出 status(表层/底层)和 body(正文)
 * 暮色 8-25:fallback 要稳 — 格式不严格时整段当 body,不报错不吞消息
 *   - 完整 3 段 → 解析出 status + body
 *   - 部分 tag(只有 [表层] 或 [底层] 或 [正文]) → 能解析多少算多少,剩下当 body
 *   - 0 tag → 整段当 body,status = null
 */
export function parseStatusFromReply(rawContent: string): {
    status: StoryStatusSnapshot | null;
    body: string;
} {
    const lines = rawContent.split('\n');

    let surfaceEmotion: string | null = null;
    let surfaceAction: string | null = null;
    let deepEmotion: string | null = null;
    let deepThought: string | null = null;
    let bodyLines: string[] = [];
    let inBody = false;
    let foundAnyTag = false;

    for (const line of lines) {
        // [表层] emotion=xxx action=yyy — action 后面允许带空格+自由文字(action 也可以是"挤出一个笑"这种多字)
        const surfaceMatch = line.match(/^\[表层\]\s*emotion=(\S+)\s+action=(.+?)\s*$/);
        // [底层] realEmotion=xxx thought=xxx — thought 是中文,可能含空格
        const deepMatch = line.match(/^\[底层\]\s*realEmotion=(\S+)\s+thought=(.+?)\s*$/);
        // [正文] 后面跟正文(可能多行,直到下一个 tag 或末尾)
        const bodyMatch = line.match(/^\[正文\]\s*(.*)$/);

        if (surfaceMatch) {
            foundAnyTag = true;
            surfaceEmotion = surfaceMatch[1].trim();
            surfaceAction = surfaceMatch[2].trim();
            continue;
        }
        if (deepMatch) {
            foundAnyTag = true;
            deepEmotion = deepMatch[1].trim();
            deepThought = deepMatch[2].trim();
            continue;
        }
        if (bodyMatch) {
            foundAnyTag = true;
            inBody = true;
            const rest = bodyMatch[1];
            if (rest) bodyLines.push(rest);
            continue;
        }
        if (inBody) {
            // [正文] 之后的所有行(包括空行)都算正文
            bodyLines.push(line);
        }
    }

    // 0 tag → 整段 fallback
    if (!foundAnyTag) {
        return { status: null, body: rawContent };
    }

    // 部分 tag 但 [正文] 缺 → 把所有非 tag 行拼起来当 body
    if (bodyLines.length === 0) {
        const bodyFallback = lines
            .filter(l => !/^\[(表层|底层|正文)\]/.test(l))
            .join('\n')
            .trim();
        if (bodyFallback) bodyLines = [bodyFallback];
    }

    // 拼 status — 只有 surface 和 deep 都齐了才算完整 status,部分缺就 null(单边没意义)
    const status: StoryStatusSnapshot | null = (surfaceEmotion && surfaceAction && deepEmotion && deepThought)
        ? {
              surface: { emotion: surfaceEmotion, action: surfaceAction },
              deep: { realEmotion: deepEmotion, thought: deepThought },
          }
        : null;

    // body 兜底:解析出来空的话用原文(不可能发生,但安全)
    const body = bodyLines.join('\n').trim() || rawContent;

    return { status, body };
}

/* ─── lightLLM 调用(简易 openai 协议,后续再加 claude/gemini) ── */

export interface LLMCallDeps {
    memoryPalaceConfig?: MemoryPalaceGlobalConfig | null;
    apiConfig: APIConfig;
}

async function callLightLLM(prompt: string, deps: LLMCallDeps): Promise<string> {
    const lightCfg = deps.memoryPalaceConfig?.lightLLM;
    const useLight = !!(lightCfg?.baseUrl && lightCfg?.apiKey && lightCfg?.model);
    const cfg = useLight ? lightCfg! : deps.apiConfig;
    if (!cfg?.baseUrl || !cfg?.apiKey || !cfg?.model) {
        throw new Error('[storyTheater] no LLM config (lightLLM and apiConfig both empty)');
    }
    const res = await safeFetchJson(
        `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                stream: false,
            }),
        },
        1, 0,
        { appName: '剧情模式', purpose: 'RP 摘要/合并/观后感' },
    );
    return res?.choices?.[0]?.message?.content || '';
}

/* ─── 摘要触发(满 10 条才调,避免无意义检查开销) ─────── */

export interface SummarizeDeps extends LLMCallDeps {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    onProgress?: (msg: string) => void;  // 给 UI 显示"正在整理..."用
}

/**
 * 满 10 条(5 轮)才调 lightLLM 做摘要
 *   - 取最早 10 条打包成 batch
 *   - 调 lightLLM 生成 narrative(第一人称叙事)
 *   - 跟旧 narrative 用 lightLLM 合并(如果有)
 *   - 更新 entry.summary(累加 rawBatchCount)
 *   - 失败兜底:不动 entry,UI 提示
 *
 * 注意:已摘要的 10 条**不移出** messages 表(UI 只显示最近 5 轮,原文保留供退出同步用)
 */
export async function maybeSummarizeBatch(
    entry: StoryTheaterEntry,
    deps: SummarizeDeps,
): Promise<StoryTheaterEntry | null> {
    const total = await getSessionMessageCount(entry.id);
    if (total <= KEEP_RECENT) return null;   // 不到 10 条不触发

    const msgs = await getSessionMessages(entry.id);
    const batch = msgs.slice(0, BATCH_SIZE);
    if (batch.length < BATCH_SIZE) return null;  // 边界保护

    deps.onProgress?.('正在整理前 5 轮剧情...');

    const userName = deps.userProfile?.name || '暮色';
    const newNarrative = await callLightLLM(
        buildBatchSummaryPrompt({
            charName: deps.char.name,
            userName,
            premise: entry.premise,
            messages: batch.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        }),
        deps,
    );

    let mergedNarrative = newNarrative;
    if (entry.summary?.narrative) {
        deps.onProgress?.('正在合并旧摘要...');
        mergedNarrative = await callLightLLM(
            buildMergeSummaryPrompt({
                charName: deps.char.name,
                userName,
                oldNarrative: entry.summary.narrative,
                newBatch: batch.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            }),
            deps,
        );
    }

    const newSummary: StorySessionSummary = {
        narrative: mergedNarrative.trim(),
        rawBatchCount: (entry.summary?.rawBatchCount || 0) + 1,
        lastUpdatedAt: Date.now(),
    };

    const updated: StoryTheaterEntry = {
        ...entry,
        summary: newSummary,
        updatedAt: Date.now(),
    };
    await DB.saveStoryTheater(updated);
    return updated;
}

/* ─── 退出同步:写 memory_node + 发 comment 到聊天框 ── */

export interface SyncDeps extends LLMCallDeps {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    addToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * 退出 session 时的同步流程(方式 A:写进记忆宫殿,跟彼方图书馆一致)
 *   1. 调 lightLLM 生成 comment(一句观后感)
 *   2. 调 lightLLM 生成 narrative(累计叙事)—— 如果 entry.summary 已经存在就用旧的
 *   3. 写 memory_node(房间 = 'self_room',importance = 60,origin = 'system',mood = 'reflective')
 *   4. 发 comment 到聊天框(DB.saveMessage,charId = 角色真实 charId,role = 'assistant')
 *   5. addToast 提示
 *
 * 失败兜底:任何一步失败都不抛,只 addToast 提示
 */
export async function syncStoryToMainMemory(
    entry: StoryTheaterEntry,
    deps: SyncDeps,
): Promise<{ commentWritten: boolean; memoryNodeWritten: boolean }> {
    const result = { commentWritten: false, memoryNodeWritten: false };
    const charId = entry.characterId;
    const userName = deps.userProfile?.name || '暮色';

    // 1. 拿最近 5 轮原文(给 prompt 喂)
    const recent = (await getSessionMessages(entry.id)).slice(-KEEP_RECENT);
    if (recent.length === 0) {
        deps.addToast?.('没有对话内容,跳过同步', 'info');
        return result;
    }

    // 2. 用 entry.summary.narrative 或临时生成
    let narrativeForComment = entry.summary?.narrative || '';
    if (!narrativeForComment) {
        // 没有累积摘要时,临时调一次 lightLLM 整理全部最近
        try {
            deps.addToast?.('正在生成观后感...', 'info');
            narrativeForComment = await callLightLLM(
                buildBatchSummaryPrompt({
                    charName: deps.char.name,
                    userName,
                    premise: entry.premise,
                    messages: recent.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                }),
                deps,
            );
        } catch (e) {
            console.warn('[storyTheater] sync: batch summary failed:', e);
            narrativeForComment = `(剧情「${entry.title}」: ${recent.length} 条对话,摘要失败)`;
        }
    }

    // 3. 生成 comment
    let commentLine = '';
    try {
        commentLine = (await callLightLLM(
            buildCommentPrompt({
                charName: deps.char.name,
                premise: entry.premise,
                narrative: narrativeForComment,
                recentMessages: recent.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            }),
            deps,
        )).trim();
    } catch (e) {
        console.warn('[storyTheater] sync: comment generation failed:', e);
        commentLine = `刚和「${userName}」在「${entry.title}」里玩了一场,挺有意思的。`;
    }

    // 4. 写 memory_node
    if (narrativeForComment && entry.writesToCharacterMemory) {
        try {
            const memId = `rpth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
            await MemoryNodeDB.save({
                id: memId,
                charId,
                content: narrativeForComment,
                room: 'self_room',                // 暮色:RP 写进自我房间(自我反思类)
                tags: ['story-theater', `theater:${entry.id}`, `theaterTitle:${entry.title}`],
                importance: 60,
                mood: 'reflective',
                embedded: false,
                createdAt: Date.now(),
                lastAccessedAt: Date.now(),
                accessCount: 0,
                sourceId: null,
                origin: 'system',
            } as any);
            result.memoryNodeWritten = true;
        } catch (e) {
            console.warn('[storyTheater] sync: memory_node write failed:', e);
        }
    }

    // 5. 发 comment 到聊天框(用角色真实 charId,role = 'assistant')
    if (commentLine) {
        try {
            await DB.saveMessage({
                charId,                          // 角色真实 ID,不是 storyTheater 线程
                role: 'assistant',
                type: 'text',
                content: commentLine,
                metadata: { source: 'story-theater', entryId: entry.id, theaterTitle: entry.title },
            });
            result.commentWritten = true;
            deps.addToast?.(`已写进记忆宫殿 + 观后感发到聊天框`, 'success');
        } catch (e) {
            console.warn('[storyTheater] sync: chat message write failed:', e);
            deps.addToast?.('观后感发到聊天框失败', 'error');
        }
    }

    return result;
}
