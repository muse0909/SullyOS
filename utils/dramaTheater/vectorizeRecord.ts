/**
 * 把剧场那张「一起看完了」卡片变成**向量化记忆**（10-08 19:17 暮色要的）。
 *
 * ## 暮色原话
 *
 * 「卡片我想在最底下增加一个向量化的按钮。把卡片里的内容发给模型总结成向量化记忆。」
 *
 * 也就是说这一步是**手动**的：看完一场，那张卡先落在主聊天里，
 * 他觉得该记才点一下。**不是**每次退出剧场自动跑。
 *
 * ## 为什么要「先总结再向量化」，不能把原文直接丢进去
 *
 * 卡片里装的是**两个人的对话原文**（谁说了什么），一两千字。
 * 直接拿它去算向量会有两个问题：
 *
 *   1. **召不回来** —— 向量是拿整段文字算的，一段对白算出来的是
 *      「这段话的整体语气」，不是「他们一起看剧时提到了小师妹」这种具体的事。
 *      以后聊天问起相关的事，相似度上不来。
 *   2. **不干净** —— 对白里有一堆「嗯」「对」「哈哈」，是噪音。
 *
 * 所以流程是**先让模型把它压成几条「发生了什么」的事，再去算向量**。
 * 这跟记忆宫殿平时从聊天里提取记忆是同一件事，只是这里的原料是剧场记录。
 *
 * ## 为什么抄见面的剧情剧院（`utils/storyTheater.ts` 的 syncStoryToMainMemory）
 *
 * 那边已经在干一模一样的事（「剧情总结 → 写一条记忆节点」）：
 * `MemoryNodeDB.save` + `vectorizeAndStore`。
 * 这里只多做了一步 —— **当场就把向量算出来**，不用等记忆宫殿的
 * 「一键向量化」补跑。因为暮色要的是点一下就完成，不是排进后台慢慢等。
 */

import { MemoryNodeDB } from '../memoryPalace/db';
import { vectorizeAndStore } from '../memoryPalace/vectorStore';
import type { EmbeddingConfig, MemoryNode, MemoryRoom, RemoteVectorConfig } from '../memoryPalace/types';
import { safeFetchJson } from '../safeApi';
import { normalizeChatBaseUrl } from '../chatApiCompat';

/** 七间房 + 白名单外的兜底。模型偶尔会编出 'attic2' 这种，我们只认这七个。 */
const ROOMS: MemoryRoom[] = [
    'living_room', 'bedroom', 'study', 'user_room', 'self_room', 'attic', 'windowsill',
];

export interface VectorizeRecordDeps {
    charId: string;
    charName: string;
    userName: string;
    /** 剧名，进提示词让它知道这是什么内容 */
    theaterTitle: string;
    /** 卡片正文（两个人的对话原文） */
    content: string;
    /** 总结用的模型。优先传记忆宫殿的副模型，没配就传主聊天那套 */
    llm: { baseUrl: string; apiKey: string; model: string };
    /** 算向量的那套 */
    embedding: EmbeddingConfig;
}

export interface VectorizeRecordResult {
    ok: boolean;
    /** 真正存进去几条（去重会被跳掉，所以可能比总结出来的少） */
    stored: number;
    /** 跟已有记忆太像被跳掉的 */
    skipped: number;
    /** 总结出来的原文，失败时给个说法 */
    error?: string;
}

/** 读取远程向量库配置（跟 pipeline.ts 一样的口径）。没开就返回 undefined。 */
function readRemoteVectorConfig(): RemoteVectorConfig | undefined {
    try {
        const raw = localStorage.getItem('os_remote_vector_config');
        if (!raw) return undefined;
        const cfg = JSON.parse(raw) as RemoteVectorConfig;
        return (cfg?.enabled && cfg?.initialized) ? cfg : undefined;
    } catch { return undefined; }
}

/**
 * 让模型把这一场压成 1~4 条「发生了什么」。
 *
 * 返回**已经解析好的数组**，不做兜底 —— 解析失败就让上层报错，
 * 因为「静默存一条空的」比报错更糟：暮色会看到「向量化成功」，
 * 但记忆宫殿里什么都没有。
 */
function parseNodes(raw: string): Array<Record<string, any>> {
    let txt = String(raw || '').trim();
    if (!txt) return [];
    // 模型很爱包一层 ```json … ```，先剥掉
    txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // 兜底：前后有多余的话，就掐头去尾找第一个 [ 到最后一个 ]
    if (!txt.startsWith('[')) {
        const a = txt.indexOf('[');
        const b = txt.lastIndexOf(']');
        if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
    }
    let arr: any;
    try {
        arr = JSON.parse(txt);
    } catch {
        return [];
    }
    if (!Array.isArray(arr)) return [];
    return arr.filter((x: any) => x && typeof x === 'object' && String(x.content || '').trim());
}

function buildPrompt(d: VectorizeRecordDeps): string {
    return [
        `你是${d.charName}的记忆整理助手。下面是${d.userName}和${d.charName}一起看电视剧《${d.theaterTitle}》时，剧场里发生的对话。`,
        '',
        '## 对话原文',
        d.content,
        '',
        '## 你的任务',
        '把这一场「一起看剧」里**真正发生了什么**整理成 1 到 4 条记忆。',
        '',
        '判断标准：',
        '- 只记**具体的、以后可能会被提起来的事**：看了什么剧、哪一集里发生了什么、',
        '  角色当时说了什么让你有反应的话、你们之间产生了什么感受或约定。',
        '- **不要记**：嗯、啊、对、哈哈这类应答；不要复述整段剧情梗概；',
        '  不要写「他们一起看了电视剧」这种废话。',
        '- 站在**${d.charName}本人的视角**写，这是「我记得的事」，不是第三方记录。',
        '- 每条 30 到 120 字。宁可少写几条，也别凑数。',
        '',
        '## 输出格式',
        '只输出一个 JSON 数组，不要任何别的字。数组里每一项：',
        '```json',
        '[{"content":"记忆正文","importance":5,"mood":"happy","tags":["关键词"],"room":"self_room"}]',
        '```',
        '',
        '字段说明：',
        '- importance：1 到 10 的整数，这件事对你们有多重要',
        '- mood：一个情绪词，中文或英文都行（比如 warm / happy / touched）',
        '- tags：2 到 4 个关键词，方便以后检索',
        `- room：只能从这七个里选一个 —— ${ROOMS.join(' / ')}`,
        '  （关于这场共同经历的感受类记忆，选 bedroom 或 self_room 最合适）',
    ].join('\n');
}

/**
 * 主入口。点一下「向量化」就跑这个。
 *
 * ⚠️ 调用方**必须**自己处理 loading / 成功提示 —— 这里只管干活和报错。
 */
export async function vectorizeTheaterRecord(
    deps: VectorizeRecordDeps,
): Promise<VectorizeRecordResult> {
    const { charId, llm, embedding } = deps;

    if (!llm?.baseUrl || !llm?.apiKey || !llm?.model) {
        return { ok: false, stored: 0, skipped: 0, error: '还没配置模型' };
    }
    if (!embedding?.baseUrl || !embedding?.apiKey) {
        return { ok: false, stored: 0, skipped: 0, error: '记忆宫殿的向量配置还没填' };
    }
    const content = String(deps.content || '').trim();
    if (!content) return { ok: false, stored: 0, skipped: 0, error: '卡片是空的' };

    // ① 先总结
    let raw: string;
    try {
        const url = `${normalizeChatBaseUrl(llm.baseUrl)}/chat/completions`;
        const res = await safeFetchJson(
            url,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${llm.apiKey}`,
                },
                body: JSON.stringify({
                    model: llm.model,
                    messages: [{ role: 'user', content: buildPrompt(deps) }],
                    temperature: 0.5,
                    stream: false,
                }),
            },
            1,
            0,
            { appName: '剧场', purpose: '剧场记录 → 向量化记忆' },
        );
        raw = res?.choices?.[0]?.message?.content || '';
    } catch (e: any) {
        return { ok: false, stored: 0, skipped: 0, error: `总结失败：${e?.message || e}` };
    }

    const parsed = parseNodes(raw);
    if (!parsed.length) {
        return { ok: false, stored: 0, skipped: 0, error: '模型没给出能用的结果' };
    }

    // ② 拼成记忆节点
    const now = Date.now();
    const titleTag = `theater:${deps.theaterTitle || '剧场'}`;
    const nodes: MemoryNode[] = parsed.slice(0, 4).map((x, i) => {
        const room = ROOMS.includes(x.room) ? (x.room as MemoryRoom) : 'living_room';
        const imp = Number(x.importance);
        return {
            id: `rthv_${now.toString(36)}_${i}_${Math.random().toString(36).slice(2, 7)}`,
            charId,
            content: String(x.content).trim(),
            room,
            tags: [
                'theater',
                'theater-watch-together',
                titleTag,
                ...(Array.isArray(x.tags) ? x.tags.slice(0, 4).map((t: any) => String(t)) : []),
            ],
            importance: Number.isFinite(imp) ? Math.max(1, Math.min(10, Math.round(imp))) : 5,
            mood: String(x.mood || 'warm').slice(0, 24),
            // ⚠️ 下面这行是**兜底**：vectorizeAndStore 里会把它改成 true 再存一次。
            //   这里先 false，是万一向量接口挂了也还能在记忆宫殿里看见这条「待向量化」的记忆。
            embedded: false,
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            sourceId: null,
            origin: 'system',
        } as MemoryNode;
    });

    // ③ 先把节点写进去（embedded=false）
    //    万一第 ④ 步失败，这些记忆还在记忆宫殿里，只是不带向量，
    //    用户之后跑「一键向量化」能补上 —— 比整条丢掉强。
    for (const n of nodes) {
        try {
            await MemoryNodeDB.save(n);
        } catch (e: any) {
            console.warn('[剧场] 记忆节点写入失败：', e?.message || e);
        }
    }

    // ④ 算向量并标记 embedded=true（内部会再 save 一次）
    try {
        const r = await vectorizeAndStore(nodes, embedding, readRemoteVectorConfig());
        return { ok: true, stored: r.stored, skipped: r.skipped };
    } catch (e: any) {
        return {
            ok: false,
            stored: 0,
            skipped: 0,
            error: `记忆已经记下了，但算向量失败：${e?.message || e}`,
        };
    }
}