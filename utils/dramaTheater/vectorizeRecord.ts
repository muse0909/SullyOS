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
    /** 集号（0 = 不知道/没记），拼成「第 13 集」那句 */
    episode?: number;
    /** 看的时间，格式化成「10 月 8 日晚上」这种。**必须传** —— 记忆要写清楚什么时候的事 */
    when?: string;
    /** buildPrompt 里拼好的「第 13 集」，不用外面传 */
    episodeText?: string;
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
    /**
     * 存进去的每一条正文 —— 用来**弹窗给用户看**（暮色 19:58：
     * 「向量化的内容要弹窗显示出来，让我能知道存了什么内容」）。
     * 失败时是空数组。
     */
    contents: string[];
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
function parseNode(raw: string): Record<string, any> | null {
    let txt = String(raw || '').trim();
    if (!txt) return null;
    // 模型很爱包一层 ```json … ```，先剥掉
    txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // 兜底：掐头去尾找第一个 { 到最后一个 }
    if (!txt.startsWith('{')) {
        const a = txt.indexOf('{');
        const b = txt.lastIndexOf('}');
        if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
    }
    try {
        const o = JSON.parse(txt);
        // ⚠️ 保险：万一它还是给了数组，取第一条。
        //   「一次只总结成一条」是提示词里写死的，这里是最后一道，
        //   保证十几轮对话不会被拆成好几条独立记忆（暮色 20:37 强调最要紧的一条）。
        const obj = Array.isArray(o) ? o[0] : o;
        if (obj && typeof obj === 'object' && String(obj.content || '').trim()) return obj;
    } catch { /* 落到下面 */ }
    return null;
}

function buildPrompt(d: VectorizeRecordDeps): string {
    return `你是${d.charName}。

下面是${d.userName}和你刚才在剧场里一起看剧时的聊天记录。
你们一边看一边聊了几句，现在看完了，轮到你说说观后感。

## 你的任务

把**这一次一起看剧**，写成**一条**记忆 —— 用你自己的话、你的视角。

必须把这三件事说清楚：

1. **什么时候、和${d.userName}一起、看了什么** —— 哪一天、哪部剧、第几集
2. **剧情大致走向** —— 这一集讲了什么。用你的话讲，不要照抄台词
3. **触动你的地方** —— 哪个片段让你心里一动，或者让你想跟${d.userName}说点什么

## 怎么写

1. **第一人称，用「我」。** 用户直接称「${d.userName}」。

   ❌ 错误（旁观者口吻）：「${d.userName}和${d.charName}一起看了这部剧，印象都很深刻。」

   ✅ 正确：「${d.when}我跟${d.userName}一起看《${d.theaterTitle}》${d.episodeText}，……」

2. **拒绝概括性套话。** 严禁「这让我很感动」「很开心」「度过了美好的一晚」
   这种假大空的总结。写清楚你**抓住了哪个细节**，以及你**当时真实的反应**。

   ❌「这一集剧情很精彩，${d.userName}看得很投入。」
   ✅「${d.userName}在小师妹把剑穗递给六师哥那一下突然说了句什么，我到现在还在想这事。」

3. **观后感不是读后感。** 不分点、不用标题、不评价剧情好坏、不打分。
   就当看完之后靠在椅子上，随口跟${d.userName}说的话。

4. **⚠️ 一条就够。** 哪怕你们聊了十几句、连着看了好几集，也只写**一条**。
   不要拆成「剧情总结一条 + 观后感一条 + 感受一条」，更不要一次给好几段。

5. **长度 150 到 350 字。** 太短撑不起「剧情走向 + 触动」两件事。

## 输出格式

严格 JSON 顶层结构，不要 markdown 包裹：

{
  "content": "我视角的这一场观后感……",
  "importance": 6,
  "mood": "warm",
  "tags": ["看剧", "剧名"],
  "room": "self_room"
}

字段说明：
- importance：1 到 10 的整数。一起看完一整集、有触动的给 5 到 7；
  只是一起看了没什么感觉的给 3 到 4。
- mood：从 happy, sad, angry, anxious, tender, excited, peaceful,
  nostalgic, warm, grateful, neutral 里挑一个最贴的。少用 neutral。
- tags：2 到 4 个关键词，方便以后检索。
- room：只能从这七个里选一个 —— ${ROOMS.join(' / ')}。
  这类「两个人共同经历」的回忆放 bedroom 或 self_room 最合适。`;
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
        return { ok: false, stored: 0, skipped: 0, contents: [], error: '还没配置模型' };
    }
    if (!embedding?.baseUrl || !embedding?.apiKey) {
        return { ok: false, stored: 0, skipped: 0, contents: [], error: '记忆宫殿的向量配置还没填' };
    }
    const content = String(deps.content || '').trim();
    if (!content) return { ok: false, stored: 0, skipped: 0, contents: [], error: '卡片是空的' };

    // ① 先总结
    //
    // ⚠️ 用记忆宫殿那个 `callLLM`，不用自己拼 `/chat/completions`：
    //   它内部按 protocol 分 OpenAI / Claude / Gemini 三条路，
    //   自己写死 openai 的话，暮色哪天副模型切到 Claude/Gemini 这里就整个静默失败
    //   （AGENTS.md §4.5 记过同一个坑）。
    const ep = Number(deps.episode || 0);
    const promptDeps: VectorizeRecordDeps = {
        ...deps,
        episodeText: ep > 0 ? `第 ${ep} 集` : '',
        when: deps.when || '',
    };
    let raw: string;
    try {
        const { callLLM } = await import('../memoryPalace/llmCall');
        const r = await callLLM(
            llm as any,
            buildPrompt(promptDeps),
            `聊天记录：\n${content}`,
            { temperature: 0.7, maxTokens: 2000 },
        );
        raw = r.text || '';
    } catch (e: any) {
        return { ok: false, stored: 0, skipped: 0, contents: [], error: `总结失败：${e?.message || e}` };
    }

    const one = parseNode(raw);
    if (!one) {
        return { ok: false, stored: 0, skipped: 0, contents: [], error: '模型没给出能用的结果' };
    }
    // ⚠️ **只取一条**（暮色 20:37：「一次只总结成一条」是整个功能最要紧的一条）
    const parsed = [one];

    // ② 拼成记忆节点
    const now = Date.now();
    const titleTag = `theater:${deps.theaterTitle || '剧场'}`;
    const nodes: MemoryNode[] = parsed.map((x, i) => {
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
        return {
            ok: true,
            stored: r.stored,
            skipped: r.skipped,
            // 只把**真存进去**的交回去给弹窗显示（去重跳掉的不算）
            contents: r.storedIds.map((id) => nodes.find((n) => n.id === id)?.content || '').filter(Boolean),
        };
    } catch (e: any) {
        return {
            ok: false,
            stored: 0,
            skipped: 0,
            contents: [],
            error: `记忆已经记下了，但算向量失败：${e?.message || e}`,
        };
    }
}