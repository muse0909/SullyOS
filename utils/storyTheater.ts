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
    ApiPreset,
    CharacterProfile,
    Message,
    RPApiConfig,
    StorySceneTemplate,
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
    buildRPSystemPrompt,
    buildOpeningPrompt,    // 暮色 9-20:开场生成 prompt
} from './storyTheater/prompts';
import { ContextBuilder } from './context';

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
        writingStyle: entry.writingStyle,    // 暮色 8-25 第五步:中间页可改
        characterId: entry.characterId,
        writesToCharacterMemory: entry.writesToCharacterMemory ?? true,
        summary: entry.summary,
        // 暮色 9-20:开场开关 + 已处理标记 + 上次同步消息数 + 注入聊天记录开关
        openingEnabled: entry.openingEnabled,
        openingResolved: entry.openingResolved,
        lastSyncedMessageCount: entry.lastSyncedMessageCount,
        injectChatHistory: entry.injectChatHistory,
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

/* ─── LLM 回复解析:状态栏 + 皮下 + 正文(暮色 9-21 第三轮重做) ── */

/**
 * 暮色 9-21 第三轮:新输出格式
 *   [正文]  → 戏里角色在说话、做动作、心理
 *   [状态]  → 5 维度(时间 / 地点 / 衣着 / 关系 / 事件)
 *   [皮下]  → AI 演员自己的 os(每轮都要写)
 *
 * 老格式(暮色 8-25 第四步,保留兼容):
 *   [表层] emotion=xxx action=yyy
 *   [底层] realEmotion=xxx thought=xxx
 *   [正文]
 *
 * Fallback 要稳:格式不严格时整段当 body,不报错不吞消息
 *   - 完整 → 解析出 body + statusBar + subOs
 *   - 部分 → 能解析多少算多少
 *   - 0 tag → 整段当 body,其他都是 null
 */
export function parseStatusFromReply(rawContent: string): {
    status: StoryStatusSnapshot | null;
    body: string;
} {
    const lines = rawContent.split('\n');

    let bodyLines: string[] = [];
    let statusBarLines: string[] = [];
    let subOsLines: string[] = [];
    let variables: Record<string, string> = {};

    // 老格式兼容字段
    let surfaceEmotion: string | null = null;
    let surfaceAction: string | null = null;
    let deepEmotion: string | null = null;
    let deepThought: string | null = null;

    let section: 'none' | 'body' | 'statusBar' | 'subOs' | 'oldStatus' = 'none';
    let foundAnyTag = false;

    const flushBody = () => {
        // bodyLines.trim 之后保留换行结构
    };

    for (const line of lines) {
        // 暮色 9-21 第三轮:新格式标记
        if (/^\[正文\]\s*$/.test(line) || /^\[正文\]\s+\S/.test(line)) {
            foundAnyTag = true;
            section = 'body';
            // [正文] 后面的同行内容也算正文
            const inline = line.replace(/^\[正文\]\s*/, '').trim();
            if (inline) bodyLines.push(inline);
            continue;
        }
        if (/^\[状态\]\s*$/.test(line)) {
            foundAnyTag = true;
            section = 'statusBar';
            continue;
        }
        if (/^\[皮下\]\s*$/.test(line)) {
            foundAnyTag = true;
            section = 'subOs';
            continue;
        }

        // 暮色 8-25 老格式标记(保留兼容)
        const surfaceMatch = line.match(/^\[表层\]\s*emotion=(\S+)\s+action=(.+?)\s*$/);
        if (surfaceMatch) {
            foundAnyTag = true;
            surfaceEmotion = surfaceMatch[1].trim();
            surfaceAction = surfaceMatch[2].trim();
            continue;
        }
        const deepMatch = line.match(/^\[底层\]\s*realEmotion=(\S+)\s+thought=(.+?)\s*$/);
        if (deepMatch) {
            foundAnyTag = true;
            deepEmotion = deepMatch[1].trim();
            deepThought = deepMatch[2].trim();
            continue;
        }
        // 老格式 [状态] 变量名=值(暮色自定义变量追踪,只在新格式外作为 fallback)
        const oldStatusMatch = line.match(/^\[状态\]\s*(.+?)\s*$/);
        if (oldStatusMatch && section === 'body') {
            foundAnyTag = true;
            const pairs = oldStatusMatch[1].trim();
            pairs.split(/\s+/).forEach(p => {
                const idx = p.indexOf('=');
                if (idx > 0) variables[p.slice(0, idx)] = p.slice(idx + 1);
            });
            continue;
        }

        // 按当前段累积内容
        if (section === 'body') {
            bodyLines.push(line);
        } else if (section === 'statusBar') {
            statusBarLines.push(line);
        } else if (section === 'subOs') {
            subOsLines.push(line);
        }
    }

    // 0 tag → 整段 fallback
    if (!foundAnyTag) {
        return { status: null, body: rawContent };
    }

    // body 兜底:解析出来空的话用原文(不可能发生,但安全)
    let body = bodyLines.join('\n').trim();
    if (!body) {
        body = lines
            .filter(l => !/^\[(正文|状态|皮下|表层|底层)\]/.test(l.trim()))
            .join('\n')
            .trim() || rawContent;
    }

    // 解析状态栏 5 维度
    const statusBarRaw = statusBarLines.join('\n').trim();
    const statusBar = parseStatusBar(statusBarRaw);

    // 解析皮下层
    const subOs = subOsLines.join('\n').trim();

    // 拼 status(暮色 9-21 第三轮:优先新格式 statusBar + subOs;老格式 fallback 用 surface/deep)
    let status: StoryStatusSnapshot | null = null;

    if (statusBar || subOs) {
        status = {
            ...(statusBar ? { statusBar } : {}),
            ...(subOs ? { subOs } : {}),
            ...(Object.keys(variables).length > 0 ? { variables } : {}),
        };
    } else if (surfaceEmotion && surfaceAction && deepEmotion && deepThought) {
        // 老格式 fallback(保留兼容)
        const baseStatus = {
            surface: { emotion: surfaceEmotion, action: surfaceAction },
            deep: { realEmotion: deepEmotion, thought: deepThought },
        };
        status = Object.keys(variables).length > 0 ? { ...baseStatus, variables } : baseStatus;
    }

    return { status, body };
}

/**
 * 暮色 9-21 第三轮:解析状态栏 5 维度
 * 输入格式(每行一个):
 *   🏮时间：xxx
 *   ⛰️地点：xxx
 *   👔衣着：xxx
 *   💞关系：xxx
 * 📜事件：xxx
 * 支持 emoji 后空格 + 中文冒号":"或英文冒号":"
 * 解析不出来字段留空字符串(状态栏 UI 会显示空)
 */
function parseStatusBar(raw: string): StoryStatusSnapshot['statusBar'] | null {
    if (!raw.trim()) return null;
    const fields: Record<string, string> = {};
    const lines = raw.split('\n');
    for (const line of lines) {
        // 匹配 emoji + 字段名 + 冒号(中英文) + 值
        // 例:🏮时间：xxx / 🏮时间:xxx / 时间：xxx(兼容没 emoji)
        const m = line.match(/^[🏮⛰️👔💞📜]?\s*(时间|地点|衣着|关系|事件)\s*[:：]\s*(.+?)\s*$/);
        if (m) {
            fields[m[1]] = m[2].trim();
        }
    }
    const result = {
        time: fields['时间'] || '',
        location: fields['地点'] || '',
        clothing: fields['衣着'] || '',
        relation: fields['关系'] || '',
        event: fields['事件'] || '',
    };
    // 5 个维度全空 → 返回 null(避免空对象污染)
    if (!result.time && !result.location && !result.clothing && !result.relation && !result.event) {
        return null;
    }
    return result;
}

/* ─── lightLLM 调用(简易 openai 协议,后续再加 claude/gemini) ── */

export interface LLMCallDeps {
    memoryPalaceConfig?: MemoryPalaceGlobalConfig | null;
    apiConfig: APIConfig;
}

/** 失败重试 N 次(默认 2 次,间隔 1.5s) — 暮色 8-25 第六步第一批 */
export async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2, delayMs = 1500): Promise<T> {
    let lastError: any;
    for (let i = 0; i < maxAttempts; i++) {
        try { return await fn(); }
        catch (e) {
            lastError = e;
            if (i < maxAttempts - 1) {
                await new Promise<void>(r => setTimeout(r, delayMs));
            }
        }
    }
    throw lastError;
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

    // 暮色 9-20 第二轮 + 9-21 第三轮修正:两边都用 interactionCount(不含开场)做判断
    //   - 开场不算互动(暮色原话"开场不算互动")
    //   - 上次同步时 interactionCount 是过滤掉 opening 的数量
    //   - 这次再算 interactionCount,差值 ≤ 0 → 跳过
    //   - 修前 bug:currentTotal 含开场(1),lastSynced 不含开场(0),差值 = 1 > 0 → 重复触发
    const allMessages = await getSessionMessages(entry.id);
    const interactionCount = allMessages.filter(m => (m.metadata as any)?.role !== 'opening').length;
    const lastSynced = entry.lastSyncedMessageCount || 0;
    const newInteractionCount = interactionCount - lastSynced;
    if (newInteractionCount <= 0) {
        deps.addToast?.('没有新对话,跳过同步', 'info');
        return result;
    }

    // 1. 拿最近 5 轮原文(给 prompt 喂)— 含开场(开场也算"之前发生了什么"用于 prompt context)
    const recent = allMessages.slice(-KEEP_RECENT);
    if (recent.length === 0) {
        deps.addToast?.('没有对话内容,跳过同步', 'info');
        return result;
    }

    // 2. 用 entry.summary.narrative 或临时生成
    //   暮色 9-21 第四轮(方案 A):不再调 lightLLM 生成"观后感"commentLine — 那个会让角色"接着演"
    //   只生成剧情总结 narrativeForComment,写到剧情记忆卡片里
    let narrativeForComment = entry.summary?.narrative || '';
    if (!narrativeForComment) {
        // 没有累积摘要时,临时调一次 lightLLM 整理全部最近
        try {
            deps.addToast?.('正在整理剧情摘要...', 'info');
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

    // 5. 暮色 9-21 第四轮(方案 A):写剧情记忆卡片到主聊天
    //   - 不再发"接着演"的消息(去掉旧观后感)
    //   - 直接写剧情总结,charId = 角色真实 ID
    //   - type 保持 'text' 兼容现有渲染,metadata.isStoryTheaterMemory = true 让 ChatApp 识别折叠
    //   - ChatApp 渲染部分下轮再做(目前 ChatApp 不识别标记,会显示成普通文字)
    //   - 角色下次主聊天时,这段记忆会通过记忆宫殿 inject 到 prompt,自动"知道"剧场玩了什么
    if (narrativeForComment) {
        try {
            const memoryText = narrativeForComment;
            await DB.saveMessage({
                charId,
                role: 'assistant',
                type: 'text',  // 保持 text 兼容现有渲染,ChatApp 检查 isStoryTheaterMemory 标记折叠
                content: memoryText,
                metadata: {
                    isStoryTheaterMemory: true,  // 暮色 9-21 第四轮:剧情记忆卡片标记
                    entryId: entry.id,
                    theaterTitle: entry.title,
                    generatedAt: Date.now(),
                },
            });
            result.commentWritten = true;  // 兼容旧字段名(实际是写记忆卡片)
            deps.addToast?.(`已写进记忆宫殿 + 剧情记忆卡片发到聊天框`, 'success');
        } catch (e) {
            console.warn('[storyTheater] sync: memory card write failed:', e);
            deps.addToast?.('剧情记忆卡片写入失败', 'error');
        }
    }

    // 暮色 9-20 第二轮:同步成功后,写回 lastSyncedMessageCount,下次退出时算新消息数
    //   - 注意:只统计有"互动"的消息(不含开场)— 跟开场不算互动的拍板一致
    //   - 用 allMessages(已加载)过滤 metadata.role !== 'opening'
    try {
        const interactionCount = allMessages.filter(m => (m.metadata as any)?.role !== 'opening').length;
        if (interactionCount > (entry.lastSyncedMessageCount || 0)) {
            const updatedEntry: StoryTheaterEntry = {
                ...entry,
                lastSyncedMessageCount: interactionCount,
                updatedAt: Date.now(),
            };
            await DB.saveStoryTheater(updatedEntry);
        }
    } catch (e) {
        console.warn('[storyTheater] sync: lastSyncedMessageCount write failed:', e);
    }

    return result;
}

/* ─── 场景模板 (暮色 8-25 第五步) ────────────────────── */

// 内置 11 个场景 — 暮色 8-25 提供
//   - premiseOptions: 3-5 个备选前情提要,中间页单选
//   - writingStyle: 默认文风描述,buildRPSystemPrompt 注入
//   - allowCustomPremise: 永远 true(中间页有自定义输入框)
//   顺序:末世 / ABO / 年代 / 无限流 / R18 / 古风 / 都市 / 校园 / 咖啡馆 / 露营 / 剧团
export const BUILTIN_SCENE_TEMPLATES: StorySceneTemplate[] = [
    {
        id: 'builtin-apocalypse',
        name: '末世',
        emoji: '☢️',
        description: '末日降临,世界只剩废墟和你们。',
        tags: ['末世', '废土', '生存'],
        premiseOptions: [
            '病毒爆发后的第三年,你在废弃超市里搜物资,听见隔壁货架后有人咳嗽。',
            '你是基地派出的侦察兵,在废墟城市里发现一个独自生活的她,她已经一年没见到活人了。',
            '逃难途中你被同伴抛弃,躲进半塌的地铁站,她递过来半瓶水和一包压缩饼干。',
        ],
        writingStyle: '废土质感、生存紧张感、对话少且决绝、动作描写硬朗、情绪克制',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-abosetting',
        name: 'ABO',
        emoji: '🐺',
        description: '第二性别、信息素、易感期。',
        tags: ['ABO', '信息素', '第二性别'],
        premiseOptions: [
            '你是新入职的 Alpha 主管,她是部门唯一的 Omega 员工,易感期意外提前,你能闻到她的信息素。',
            '相亲对象是 Beta 的你没想到,她是一位 S 级 Alpha,见面的第一秒就锁定了你。',
            '你是她家族指定的 Omega 配偶,婚礼前夜你们第一次单独见面,空气里都是她克制的信息素。',
        ],
        writingStyle: '第二性别设定、信息素细节、感官描写、占有欲与克制并存、情感张力强',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-era',
        name: '年代',
        emoji: '📻',
        description: '穿越回去的那个夏天,风吹过白衬衫。',
        tags: ['年代', '怀旧', '复古'],
        premiseOptions: [
            '你穿越到 80 年代的工厂宿舍,她是你对门那个总爱借你洗衣粉的女工。',
            '民国初年,你是上海滩的报社记者,她在街角书报亭卖进步刊物,你第一次采访她。',
            '90 年代的小城,你们是高中同班,期末考试前夜她偷偷给你塞了一封手写的信。',
        ],
        writingStyle: '年代质感、生活细节饱满、情感含蓄、对话带时代气息、意象化描写',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-infinite',
        name: '无限流',
        emoji: '🎮',
        description: '闯关、副本、生死一线。',
        tags: ['无限流', '闯关', '副本'],
        premiseOptions: [
            '你们被拉进同一个恐怖副本,任务说活过 7 晚就能回去,但每晚都会少一个人。',
            '你是新人玩家,她是你这个副本里遇到的第一个老手,她说"跟紧我,别出声"。',
            '主神空间发布了组队任务,你被随机分配到她这一队,她已经经历过 12 个副本,你看她像看怪物。',
        ],
        writingStyle: '副本悬疑感、节奏紧凑、对话精炼、动作戏紧张、悬念与暗示并用',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-r18',
        name: 'R18',
        emoji: '🔥',
        description: '成年人之间的暧昧与亲密。',
        tags: ['成人向', '暧昧', '亲密'],
        premiseOptions: [
            '你们是住隔壁的邻居,某天深夜她敲你的门,说热水器坏了借浴室用一下。',
            '出差同住一间房,洗完澡出来发现她只裹了浴巾坐在你床边,手里还拿着一杯酒。',
            '分手两年后在朋友聚会重逢,你们都喝多了,在酒店走廊里她先吻了你。',
        ],
        writingStyle: '成人向、感官描写细腻、情绪暗流、氛围浓郁、克制与放纵并存',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-xianxia',
        name: '古风仙侠',
        emoji: '🏯',
        description: '山门初见,你是下山历练的剑客。',
        tags: ['古风', '仙侠', '意境'],
        premiseOptions: [
            '你是下山历练的剑客,在山洞里发现被困已久的她。',
            '你在悬崖边练剑,身后传来脚步声,回头看见一个浑身是伤的女子。',
            '师门宴席上你第一次见到新来的师妹,她看你的眼神很奇怪。',
        ],
        writingStyle: '古风半文言、意境优先、动作描写细腻',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-nightcity',
        name: '都市夜色',
        emoji: '🌃',
        description: '深夜的城市,只剩你们两个清醒的人。',
        tags: ['现代', '都市', '氛围'],
        premiseOptions: [
            '深夜便利店,只有你们两个顾客,外面下着大雨她没带伞。',
            '加班到凌晨两点,你在公司楼下碰见她也刚下班,你们住同一个方向。',
            '你在天台抽烟,她推门上来了,手里拿着一罐啤酒。',
        ],
        writingStyle: '现代文学感、短句节奏、氛围感强',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-campus',
        name: '校园青春',
        emoji: '📚',
        description: '高三分班前的最后一个夏天。',
        tags: ['现代', '校园', '青春'],
        premiseOptions: [
            '高三分班前最后一个夏天,你们坐在天台看夕阳,她突然问了你一个问题。',
            '图书馆关门前五分钟,她把一本书塞进你书包里就跑了。',
            '体育课自由活动,所有人都在打球,你发现她一个人坐在看台最高处。',
        ],
        writingStyle: '青春口语、明快节奏、情绪外露',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-coffee',
        name: '咖啡馆偶遇',
        emoji: '☕',
        description: '常去的咖啡馆,今天只剩一个座位。',
        tags: ['现代', '日常', '浪漫'],
        premiseOptions: [
            '你们在常去的咖啡馆碰面,她今天心情不太好,一个人坐在角落。',
            '你比约定时间早到了十分钟,正低头看手机,抬头发现她已经坐在对面看了你很久。',
            '下雨天,咖啡馆只剩最后一个座位,你们谁都没让。',
        ],
        writingStyle: '现代口语、轻松自然、对话为主',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-campfire',
        name: '露营篝火',
        emoji: '⛺',
        description: '围坐在火堆旁,有些话只适合这时候说。',
        tags: ['现代', '户外', '留白'],
        premiseOptions: [
            '周末露营,围坐在篝火旁,她往火里丢了一根树枝说"我想跟你说个事"。',
            '凌晨三点你醒了,发现她不在帐篷里,走出去看见她一个人坐在湖边。',
            '搭帐篷的时候你们吵了一架,现在谁都不说话,火快灭了。',
        ],
        writingStyle: '现代散文感、留白多、对话少但每句有分量',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
    {
        id: 'builtin-mystery',
        name: '神秘剧团',
        emoji: '🎭',
        description: '她是剧团的女主角,灯光只剩一盏。',
        tags: ['现代', '悬疑', '氛围'],
        premiseOptions: [
            '她是剧团女主角,今晚谢幕后你作为新来的舞台监督第一次跟她单独说话。',
            '排练结束后所有人都走了,她还站在舞台中央,灯光只剩一盏。',
            '你在后台发现她藏起来的那本笔记本掉在了地上,翻开第一页写着你的名字。',
        ],
        writingStyle: '悬疑氛围、视角受限、细节暗示多于直说',
        allowCustomPremise: true,
        builtIn: true,
        createdAt: 0,
        updatedAt: 0,
    },
];

/* ─── 场景模板 DB 操作 ─────────────────────────────── */

/** 读全部场景模板(内置 + 暮色自定义),内置排前面 */
export async function getAllSceneTemplates(): Promise<StorySceneTemplate[]> {
    const stored = await DB.getSceneTemplates();
    const builtinIds = new Set(BUILTIN_SCENE_TEMPLATES.map(t => t.id));
    const customs = stored.filter(t => !builtinIds.has(t.id));
    // 自定义按 updatedAt 倒序(最新在前)
    customs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return [...BUILTIN_SCENE_TEMPLATES, ...customs];
}

/** 同步检查 — 内置模板的 premiseOptions / writingStyle 是否有更新 */
export function getBuiltinSceneTemplateById(id: string): StorySceneTemplate | null {
    return BUILTIN_SCENE_TEMPLATES.find(t => t.id === id) || null;
}

/** 从场景模板建 Entry(中间页确认后调用) */
export function createEntryFromSceneTemplate(args: {
    template: StorySceneTemplate;
    characterId: string;
    premise: string;            // 用户在中间页选/写的前提
    writingStyle: string;       // 用户在中间页确认的文风(可改过)
    title?: string;             // 可选自定义标题
    generation?: { temperature: number; maxTokens: number };  // 暮色 8-25:中间页预设(老)
    apiConfigId?: string;       // 暮色 8-25 第六步第一批:用哪套 RP API(null = 主 apiConfig)
    // 暮色 8-25 第二批:4 个新字段
    authorNote?: string;
    statusBarDefinitions?: { name: string; initialValue: string }[];
    jailbreakPrompt?: string;
    generationParams?: { temperature: number; maxTokens: number; topP: number; frequencyPenalty: number; presencePenalty: number };
    // 暮色 8-25 第七批:4 个叙事参数选项
    narrativePerson?: 'second' | 'third';
    authorityLevel?: 'none' | 'limited' | 'full';
    lengthPreset?: 'short' | 'medium' | 'long';
    tensionLevel?: 'natural' | 'warm' | 'intense';
    // 暮色 8-26:角色指令 / RP System Prompt
    rpInstructions?: string;
    // 暮色 9-20:开剧场后是否自动生成开场(undefined = 走全局默认,true = 强制生成,false = 强制不生成)
    openingEnabled?: boolean;
    // 暮色 9-21 第三轮:建剧场时是否注入主聊天最近 50 条聊天记录
    injectChatHistory?: boolean;
    now?: number;
}): StoryTheaterEntry {
    const now = args.now ?? Date.now();
    return {
        id: generateClientId(),
        title: args.title || args.template.name,
        premise: args.premise,
        writingStyle: args.writingStyle,
        characterId: args.characterId,
        writesToCharacterMemory: true,
        // 暮色 9-20:开场开关(显式写进 entry,后续读 entry 知道是否生成)
        openingEnabled: args.openingEnabled,
        // 暮色 9-21 第三轮:注入聊天记录开关(显式写进 entry,开场时用)
        injectChatHistory: args.injectChatHistory,
        generation: args.generation,                                     // 暮色 8-25 老字段保留
        generationParams: args.generationParams,                          // 暮色 8-25 第二批 + 第七批加 presencePenalty
        apiConfigId: args.apiConfigId,                                    // 暮色 8-25 第六步第一批
        authorNote: args.authorNote,                                      // 暮色 8-25 第二批
        statusBarDefinitions: args.statusBarDefinitions,                  // 暮色 8-25 第二批
        jailbreakPrompt: args.jailbreakPrompt,                            // 暮色 8-25 第二批
        narrativePerson: args.narrativePerson,                            // 暮色 8-25 第七批
        authorityLevel: args.authorityLevel,                              // 暮色 8-25 第七批
        lengthPreset: args.lengthPreset,                                  // 暮色 8-25 第七批
        tensionLevel: args.tensionLevel,                                  // 暮色 8-25 第七批
        rpInstructions: args.rpInstructions,                              // 暮色 8-26
        messageCount: 0,                                                  // 新建默认 0 句
        createdAt: now,
        updatedAt: now,
    };
}

/** 暮色自定义模板(用 buildEntryFromTemplate 之后) */
export function createCustomSceneTemplate(args: {
    name: string;
    emoji: string;
    description: string;
    tags: string[];
    premiseOptions: string[];   // 至少 1 个
    writingStyle: string;
    now?: number;
}): StorySceneTemplate {
    const now = args.now ?? Date.now();
    return {
        id: generateClientId(),
        name: args.name.trim() || '我的场景',
        emoji: args.emoji.trim() || '🎬',
        description: args.description.trim(),
        tags: args.tags.filter(Boolean),
        premiseOptions: args.premiseOptions.filter(p => p.trim().length > 0),
        writingStyle: args.writingStyle.trim() || '现代口语、自然',
        allowCustomPremise: true,
        builtIn: false,
        createdAt: now,
        updatedAt: now,
    };
}

/* ─── 暮色 8-25 第六步第一批:流式输出 + 独立 API + 测通 ─────── */

/** 暮色 8-26:特殊 id 标识"主 API 预设"(运行时从 ApiPresets 读,不是 DB 里的 RP API)
 *   `__main__`            = 当前主 apiConfig(OSContext.apiConfig)
 *   `__main_preset_${id}` = 主 apiPresets(kind='main')里 id=... 的那条
 *  Entry.apiConfigId 用这些特殊值,不需要再同步到 RP API DB */
export const MAIN_API_PRESET_ID = '__main__';
export const MAIN_API_PRESET_PREFIX = '__main_preset_';

export function isMainApiPresetId(id?: string | null): boolean {
    return !!id && (id === MAIN_API_PRESET_ID || id.startsWith(MAIN_API_PRESET_PREFIX));
}

/** 解析 Entry.apiConfigId → 实际 RP API 配置,没指定或找不到 → 用主 apiConfig
 *  暮色 8-26 扩展:支持主 API 预设(ApiPresets kind='main')特殊 id */
export async function getResolvedRPApiConfig(args: {
    entry?: StoryTheaterEntry | null;
    apiConfig: APIConfig;
    apiPresets?: ApiPreset[];  // 可选:主 API 预设列表(从 OSContext 拿)
}): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    protocol: 'openai' | 'claude' | 'gemini';
    isFallback: boolean;
    protocolFallback: boolean;
}> {
    const id = args.entry?.apiConfigId;

    // 暮色 8-26:特殊 id — `__main_preset_${id}` 从 apiPresets 查
    if (id && id.startsWith(MAIN_API_PRESET_PREFIX)) {
        const presetId = id.slice(MAIN_API_PRESET_PREFIX.length);
        const preset = args.apiPresets?.find(p => p.id === presetId && (p.kind === 'main' || !p.kind));
        if (preset) {
            return {
                baseUrl: preset.config.baseUrl,
                apiKey: preset.config.apiKey,
                model: preset.config.model,
                protocol: 'openai',  // 暮色 8-26 简化:主 API 预设默认按 openai 协议
                isFallback: false,
                protocolFallback: false,
            };
        }
        // 找不到 → 回退到主
    }

    // 暮色 8-25:Entry.apiConfigId 为空 → 用主 apiConfig(套壳为 openai 协议)
    if (!id) {
        return {
            baseUrl: args.apiConfig.baseUrl,
            apiKey: args.apiConfig.apiKey,
            model: args.apiConfig.model,
            protocol: 'openai',
            isFallback: true,
            protocolFallback: false,
        };
    }
    const cfg = await DB.getRPApiConfig(id);
    if (!cfg) {
        // 指定的 config 找不到(可能删了),回退到主
        return {
            baseUrl: args.apiConfig.baseUrl,
            apiKey: args.apiConfig.apiKey,
            model: args.apiConfig.model,
            protocol: 'openai',
            isFallback: true,
            protocolFallback: false,
        };
    }
    return {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        protocol: cfg.protocol,
        isFallback: false,
        protocolFallback: cfg.protocol !== 'openai',
    };
}

/** 测通 API — 用普通 /chat/completions 发一条 "hi"(非流式,验证连通性+key) */
export async function testRPApiConfig(cfg: RPApiConfig): Promise<{ ok: boolean; msg: string; latencyMs?: number }> {
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        return { ok: false, msg: '配置不完整(baseUrl/apiKey/model 不能为空)' };
    }
    const start = Date.now();
    try {
        // 本步只测 openai 协议
        if (cfg.protocol !== 'openai') {
            return { ok: false, msg: `测通功能暂只支持 openai 协议(当前 ${cfg.protocol})` };
        }
        const res = await safeFetchJson(
            `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
                body: JSON.stringify({
                    model: cfg.model,
                    messages: [{ role: 'user', content: 'hi' }],
                    max_tokens: 5,
                    stream: false,
                }),
            },
            1, 0,
            { appName: '剧情模式测通', purpose: '验证 API 连通性' },
        );
        const latencyMs = Date.now() - start;
        const content = res?.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return { ok: true, msg: `测通成功(${latencyMs}ms)`, latencyMs };
        }
        return { ok: false, msg: `响应格式异常: ${JSON.stringify(res).slice(0, 200)}` };
    } catch (e: any) {
        return { ok: false, msg: `测通失败: ${e?.message || e}` };
    }
}

/** 暮色 8-26:从 RPGlobalDefaults 把缺失字段 merge 进 entry,保证 session 渲染时一定有值 */
export async function resolveRPEntryDefaults(entry: StoryTheaterEntry): Promise<StoryTheaterEntry> {
    const defaults = await DB.getRPGlobalDefaults();
    if (!defaults) return entry;
    return {
        ...entry,
        writingStyle: entry.writingStyle ?? defaults.writingStyle,
        rpInstructions: entry.rpInstructions ?? defaults.rpInstructions,
        jailbreakPrompt: entry.jailbreakPrompt ?? defaults.jailbreakPrompt,
        authorNote: entry.authorNote ?? defaults.authorNote,
        statusBarDefinitions: (entry.statusBarDefinitions && entry.statusBarDefinitions.length > 0)
            ? entry.statusBarDefinitions
            : defaults.statusBarDefinitions,
        narrativePerson: entry.narrativePerson ?? defaults.narrativePerson,
        authorityLevel: entry.authorityLevel ?? defaults.authorityLevel,
        lengthPreset: entry.lengthPreset ?? defaults.lengthPreset,
        tensionLevel: entry.tensionLevel ?? defaults.tensionLevel,
        generationParams: entry.generationParams ?? defaults.generationParams,
        generation: entry.generation
            ?? (defaults.generationParams
                ? { temperature: defaults.generationParams.temperature, maxTokens: defaults.generationParams.maxTokens }
                : undefined),
    };
}

/** 拼 system prompt(供流式/非流式共用) */
async function buildMainLLMSystemPrompt(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
}): Promise<string> {
    // 暮色 8-26:从全局默认 merge 缺失字段
    const entry = await resolveRPEntryDefaults(args.entry);
    let baseSystem = '';
    try {
        baseSystem = ContextBuilder.buildCoreContext(args.char, args.userProfile || undefined);
    } catch {
        baseSystem = `你是${args.char.name}。${args.char.description || ''}`;
    }
    return buildRPSystemPrompt({
        base: baseSystem,
        char: args.char,
        userProfile: args.userProfile,
        entry,
        summary: entry.summary,
    });
}

/** 非流式主 LLM(协议 fallback 用) */
export async function callMainLLMNonStream(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    history: { role: 'user' | 'assistant'; content: string }[];
    apiConfig: APIConfig;
}): Promise<string> {
    const cfg = await getResolvedRPApiConfig({ entry: args.entry, apiConfig: args.apiConfig });
    if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        throw new Error('主 LLM 未配置');
    }
    const messages = await buildRPMessageArray(args);
    const res = await safeFetchJson(
        `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
                model: cfg.model,
                messages,
                ...(await buildRPGenerationBody(args.entry)),
                stream: false,
            }),
        },
        1, 0,
        { appName: '剧情模式', purpose: 'RP 对话', charId: args.char.id, charName: args.char.name },
    );
    return res?.choices?.[0]?.message?.content || '';
}

/** 拼 RP 模式的消息数组(暮色 8-25 第二批 + 8-26 改 async 以便从全局默认 merge)
 *  顺序:
 *    1. system(角色人设 + RP 模式注入)
 *    2. authorNote(可选)— 暮色随时编辑的补充指令
 *    3. recent 5 轮原文
 *    4. jailbreakPrompt(可选)— 整段 prompt 最末尾 */
export async function buildRPMessageArray(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    history: { role: 'user' | 'assistant'; content: string }[];
}): Promise<Array<{ role: 'system' | 'user' | 'assistant'; content: string }>> {
    const entry = await resolveRPEntryDefaults(args.entry);
    const argsMerged = { ...args, entry };
    const arr: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: await buildMainLLMSystemPrompt(argsMerged) },
    ];
    if (entry.authorNote && entry.authorNote.trim()) {
        arr.push({ role: 'system', content: `【作者注释/Author's Note】\n${entry.authorNote.trim()}` });
    }
    arr.push(...args.history.map(m => ({ role: m.role, content: m.content })));
    if (entry.jailbreakPrompt && entry.jailbreakPrompt.trim()) {
        arr.push({ role: 'system', content: entry.jailbreakPrompt.trim() });
    }
    return arr;
}

/** 拼生成参数(暮色 8-25 第二批 4 字段,老 generation fallback + 8-26 从全局默认 merge) */
export async function buildRPGenerationBody(entry: StoryTheaterEntry): Promise<{
    temperature: number;
    max_tokens: number;
    top_p: number;
    frequency_penalty: number;
    presence_penalty: number;
}> {
    // 暮色 8-26:从全局默认 merge 缺失字段
    const merged = await resolveRPEntryDefaults(entry);
    const gp = merged.generationParams;
    const old = merged.generation;
    return {
        temperature: gp?.temperature ?? old?.temperature ?? 0.85,
        // 暮色 8-25 第七批:lengthPreset 优先(短/中/长 → 1024/4096/8192),fallback 老 maxTokens
        max_tokens: lengthPresetToMaxTokens(merged.lengthPreset) ?? gp?.maxTokens ?? old?.maxTokens ?? 4096,
        top_p: gp?.topP ?? 1.0,
        frequency_penalty: gp?.frequencyPenalty ?? 0,
        // 暮色 8-25 第七批:加 presencePenalty(原版 5 字段之一)
        presence_penalty: gp?.presencePenalty ?? 0,
    };
}

/** 暮色 8-25 第七批:篇幅预设 → maxTokens 映射
 *  short=1024, medium=4096, long=8192, undefined=fallback 到 entry.generationParams.maxTokens */
export function lengthPresetToMaxTokens(preset: 'short' | 'medium' | 'long' | undefined): number | undefined {
    if (preset === 'short') return 1024;
    if (preset === 'medium') return 4096;
    if (preset === 'long') return 8192;
    return undefined;   // 让 buildRPGenerationBody fallback
}

/* ─── 暮色 9-20:开剧场自动生成开场(流式) ──────────────── */

/**
 * 开场生成 — 暮色 9-20
 * 进 session 时如果 entry.openingEnabled != false,就调这个流式跑一次
 *   - 复用 callMainLLMStream(协议 fallback 在它内部处理)
 *   - user message 用 buildOpeningPrompt 的输出(system prompt 仍走 buildRPSystemPrompt)
 *   - 返回完整累积内容(包含 [正文] + 可选 [meta])— 让调用方解析 + 存 messages
 *
 * 调用方负责:
 *   - 流式 chunk 给 UI 打字机展示
 *   - 完整内容存 messages(role='assistant', metadata={role:'opening', storyStatus})
 */
export async function* generateOpening(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    sceneTags?: string[];
    apiConfig: APIConfig;
}): AsyncGenerator<string, void, void> {
    const { char, userProfile, entry, sceneTags, apiConfig } = args;

    // 暮色 9-21 第三轮:如果 entry.injectChatHistory 不为 false,从主聊天取最近 50 条
    // 拼到开场提示词里(类似陪伴模式 peek 的 [最近记录] context)
    let chatHistoryContext: string | undefined;
    if (entry.injectChatHistory !== false) {
        try {
            const recent = await DB.getMessagesByCharId(entry.characterId, false);
            const slice = recent.slice(-50);
            if (slice.length > 0) {
                const lines = slice.map(m => {
                    const who = m.role === 'user' ? (userProfile?.name || '暮色') : char.name;
                    return `${who}: ${m.content.replace(/\n+/g, ' ').slice(0, 200)}`;
                }).join('\n');
                chatHistoryContext = `【你们之前在主聊天中最后聊过的内容(供参考,不要直接复述)】\n${lines}`;
            }
        } catch (e) {
            console.warn('[storyTheater] injectChatHistory: fetch failed', e);
        }
    }

    // 拿场景标签(从模板里拿)— SceneConfigPage 没传 sceneTags 时为空,prompt 自己处理空场景
    const openingUserMsg = buildOpeningPrompt({
        charName: char.name,
        userName: userProfile?.name || '暮色',
        premise: entry.premise,
        writingStyle: entry.writingStyle,
        sceneTags,
        chatHistoryContext,
    });

    // 调用主 LLM 流式 — user message 就是 opening prompt 输出
    for await (const chunk of callMainLLMStream({
        char,
        userProfile,
        entry,
        history: [{ role: 'user', content: openingUserMsg }],
        apiConfig,
    })) {
        yield chunk;
    }
}

/** 流式主 LLM(openai 协议) — 暮色 8-25 第六步第一批
 *  返回 AsyncGenerator,逐 chunk yield 增量文本
 *  协议非 openai 时自动 fallback 非流式(整段 yield 一次) */
export async function* callMainLLMStream(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    history: { role: 'user' | 'assistant'; content: string }[];
    apiConfig: APIConfig;
}): AsyncGenerator<string, void, void> {
    const cfg = await getResolvedRPApiConfig({ entry: args.entry, apiConfig: args.apiConfig });

    if (cfg.protocol !== 'openai') {
        // fallback: 非流式,整段 yield
        const text = await callWithRetry(
            () => callMainLLMNonStream(args),
            2, 1500,
        );
        if (text) yield text;
        return;
    }

    const messages = await buildRPMessageArray(args);
    const genBody = await buildRPGenerationBody(args.entry);

    const fetchOnce = async (): Promise<Response> => {
        return fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.apiKey}`,
            },
            body: JSON.stringify({
                model: cfg.model,
                messages,
                ...genBody,
                stream: true,
            }),
        });
    };

    // 重试 1 次(包装整个流式调用)
    const res = await callWithRetry(fetchOnce, 2, 1500);
    if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta) yield delta;
            } catch {
                // 忽略解析失败的行(SSE 偶尔有注释行)
            }
        }
    }
}

/* ─── 暮色 8-25 第六步第一批:删除 Entry + 同步清 messages + 消息数 helper ── */

/** 删剧场 + 同步清 messages 表里对应 charId 的所有消息 */
export async function deleteStoryTheaterAndMessages(entryId: string): Promise<{ deletedMessages: number }> {
    const threadId = storyTheaterThreadId(entryId);
    const msgs = await DB.getMessagesByCharId(threadId, true);  // 包含已处理(剧情不走 hwm)
    let n = 0;
    for (const m of msgs) {
        try {
            await DB.deleteMessage(m.id);
            n++;
        } catch (e) {
            console.warn(`[storyTheater] delete message ${m.id} failed:`, e);
        }
    }
    await DB.deleteStoryTheater(entryId);
    return { deletedMessages: n };
}

/** 写消息后 +1 计数(自动持久化回 Entry) */
export async function bumpMessageCount(entryId: string, currentEntry: StoryTheaterEntry): Promise<StoryTheaterEntry> {
    const updated: StoryTheaterEntry = {
        ...currentEntry,
        messageCount: (currentEntry.messageCount || 0) + 1,
        updatedAt: Date.now(),
    };
    await DB.saveStoryTheater(updated);
    return updated;
}

/** 列表加载时:老数据回填(若 messageCount === 0 但 entry 已存在,数一次并回写) */
export async function backfillMessageCountIfNeeded(entry: StoryTheaterEntry): Promise<StoryTheaterEntry> {
    if (entry.messageCount && entry.messageCount > 0) return entry;
    if (!entry.createdAt || entry.createdAt < Date.now() - 5 * 60 * 1000) {
        // 老数据(创建超过 5 分钟)且 messageCount 缺失/为 0 → 数一次回填
        const threadId = storyTheaterThreadId(entry.id);
        const msgs = await DB.getMessagesByCharId(threadId, true);
        if (msgs.length === 0) return entry;  // 没消息,保持 0
        const updated: StoryTheaterEntry = { ...entry, messageCount: msgs.length };
        await DB.saveStoryTheater(updated);
        return updated;
    }
    return entry;
}

/* ─── 暮色 8-25 第六步第一批:相对时间格式化(剧场卡显示"X 天前") ── */

export function formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 0) return '刚刚';   // 系统时间漂移
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    if (diff < 30 * 86_400_000) return `${Math.floor(diff / (7 * 86_400_000))} 周前`;
    if (diff < 365 * 86_400_000) return `${Math.floor(diff / (30 * 86_400_000))} 个月前`;
    return `${Math.floor(diff / (365 * 86_400_000))} 年前`;
}
