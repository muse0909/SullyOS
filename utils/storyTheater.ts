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
        writingStyle: entry.writingStyle,    // 暮色 8-25 第五步:中间页可改
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
    generation?: { temperature: number; maxTokens: number };  // 暮色 8-25:中间页预设
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
        generation: args.generation,   // 暮色 8-25:中间页可调 temperature/maxTokens
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
