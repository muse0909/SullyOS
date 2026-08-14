/**
 * Memory Palace — 只读 Trace 工具
 *
 * 暮色 2026-08-13 加：
 *   给记忆宫殿加一次"快照 + 详尽 trace"能力，可疑召回 / 可疑 box 排查用。
 *   严格只读：禁止写 IndexedDB（accessCount / lastAccessedAt / link strength / box 状态 / summary 节点
 *   / live 节点 / 任何 consolidation / 任何 proactive 写入），禁止改 scoring 参数。
 *   写路径走的是"在只读快照上跑 pipeline 但跳过 touchAccess + strengthenCoActivated"——
 *   spreadActivation / applyPriming / checkRumination 本身就是纯读，不影响。
 *
 * 用法（F12 控制台）：
 *   __mpTrace.listBoxes(charId)                                // 列所有 box + 自动筛可疑 Top 5
 *   __mpTrace.traceRetrieve({ charId, messages, ... })         // 目标一：跑一次只读召回
 *   __mpTrace.traceBox(charId, boxId)                          // 目标二：从指定 box 追溯
 *   __mpTrace.traceSuspiciousBoxes(charId)                     // list + 自动筛 + 批量 trace
 *   __mpTrace.downloadTrace(trace, filename?)                  // 触发浏览器下载 .json
 *
 * 数据通过 downloadTrace 触发 .json 文件下载，命名约定：
 *   mp-trace-{traceId}-{kind}.json
 */

import type { Message } from '../../types';
import type {
    EmbeddingConfig, MemoryNode, MemoryRoom, ScoredMemory, EventBox,
    PersonalityStyle, RemoteVectorConfig,
} from './types';
import type { EventBoxHint } from './extraction';
import type { LightLLMConfig } from './pipeline';

import { hybridSearch } from './hybridSearch';
import { spreadActivation } from './activation';
import { applyPriming, checkRumination } from './priming';
import { expandAndFormat } from './formatter';
import { MemoryNodeDB, MemoryLinkDB, EventBoxDB, MemoryVectorDB, AnticipationDB } from './db';
import { DB } from '../db';
import { getEmbeddings } from './embedding';
import { isMessageSemanticallyRelevant, formatMessageForPrompt } from '../messageFormat';
import { calculateEffectiveImportance } from './consolidation';
import { isRemoteSearchBroken } from './vectorSearch';
import { resolveDateReferences } from './dateResolver';
import { fetchRelatedMemoriesForExtraction, splitMessagesToSpikes, sampleSnippetsFromMessages } from './relatedMemories';

// ─── 公共类型 ──────────────────────────────────────────

export interface RetrieveTraceOptions {
    charId: string;
    /** 固定快照 messages —— 不要从 DB 读，要 caller 准备好 */
    messages: Message[];
    embeddingConfig: EmbeddingConfig;
    llmConfig?: LightLLMConfig;
    personalityStyle?: PersonalityStyle;
    ruminationTendency?: number;
    currentMood?: string;
    remoteVectorConfig?: RemoteVectorConfig;
    traceId?: string;
    /** 强制指定 userName（影响 formatter 渲染） */
    userName?: string;
}

export interface PerCandidateTrace {
    traceId: string;
    messageId?: number;
    rawMessage?: string;
    normalizedSpike?: string;
    queryType: 'spike' | 'context' | 'fallback' | 'date' | 'spread' | 'priming' | 'rumination' | 'rerank';
    queryIndex?: number;       // spike 序号（u1/u2/...）或 context
    candidateMemoryId: string;
    candidateContentPreview: string;
    candidateRoom: MemoryRoom;
    candidateImportance: number;
    vectorSim: number;
    bm25Raw: number;
    bm25Norm: number;
    hybridSim: number;
    recency: number;
    effectiveImportance: number;
    familiarity: number;
    simWeight: number;
    recencyWeight: number;
    importanceWeight: number;
    baseScore: number;
    finalScore: number;
    source: 'main_search' | 'date_boost' | 'spread_activation' | 'priming' | 'rumination' | 'rerank';
    selectedInTop15: boolean;
    excludedReason?: string;
}

export interface SpikeCandidateBundle {
    spikeLabel: string;
    spikeText: string;
    queryType: 'spike' | 'context' | 'fallback';
    candidates: PerCandidateTrace[];
}

export interface RetrieveTraceResult {
    traceId: string;
    charId: string;
    ranAt: number;
    duration: { total: number; buildQueries: number; search: number; merge: number; date: number; spread: number; priming: number; rumination: number; format: number };
    messageSnapshotSize: number;
    spikes: SpikeCandidateBundle[];
    contextCandidates: SpikeCandidateBundle;
    fallbackCandidates?: SpikeCandidateBundle;
    mergedTop15: PerCandidateTrace[];
    /** 每条最终记忆进入结果时的最高分来源 */
    bestSourcePerFinal: Record<string, { source: PerCandidateTrace['source']; score: number; label: string }>;
    /** 路径插入前后分数（key=memoryId） */
    datePathInsertions: Array<{ memoryId: string; before?: number; after: number; }>;
    spreadInsertions: Array<{ memoryId: string; seedId: string; seedScore: number; activatedScore: number; }>;
    primingAdjustments: Array<{ memoryId: string; beforeScore: number; afterScore: number; multiplier: number; }>;
    ruminationInsertion?: { memoryId: string; insertedAt: number; score: number; };
    rerankPicks: Array<{ memoryId: string; rerankScore: number; hybridScore: number; }>;
    /** formatter 渲染前的候选节点 + content.length */
    preFormatterNodes: Array<{ id: string; room: MemoryRoom; contentLength: number; finalScore: number; }>;
    formatterOutput: string;
    formatterOutputLength: number;
    /** 假设的 system prompt 注入块（仅长 + 摘要，不传完整 prompt） */
    injectionBlockLength: number;
    injectionBlockPreview: string;
    /** 写路径跳过的清单（trace 模式下没跑这些） */
    skippedWrites: string[];
}

// ─── 工具函数 ──────────────────────────────────────────

const SUMM_HARD_MAX = 800;

function generateTraceId(): string {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function safeRoom(r: string | undefined): MemoryRoom {
    const valid: MemoryRoom[] = ['living_room', 'bedroom', 'study', 'user_room', 'self_room', 'attic', 'windowsill'];
    return (valid as string[]).includes(r || '') ? (r as MemoryRoom) : 'living_room';
}

function getRemoteVectorConfig(): RemoteVectorConfig | undefined {
    try {
        const raw = localStorage.getItem('os_remote_vector_config');
        if (!raw) return undefined;
        const config = JSON.parse(raw) as RemoteVectorConfig;
        return (config.enabled && config.initialized) ? config : undefined;
    } catch { return undefined; }
}

// splitLastTurnQueries（pipeline.ts 里没 export，复制一份）
function splitLastTurnQueries(messages: Message[]): { userIntent: Message[]; contextTurns: Message[]; fallbackAll: Message[]; } {
    if (messages.length === 0) return { userIntent: [], contextTurns: [], fallbackAll: [] };
    const MAX = 15;
    const USER_CAP = 10;
    const userIntent: Message[] = [];
    const contextTurns: Message[] = [];
    let i = messages.length - 1;
    while (i >= 0 && messages[i].role === 'user' && userIntent.length < USER_CAP) {
        userIntent.unshift(messages[i]); i--;
    }
    const contextBudget = MAX - userIntent.length;
    while (i >= 0 && messages[i].role === 'assistant' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]); i--;
    }
    while (i >= 0 && messages[i].role === 'user' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]); i--;
    }
    const fallbackAll = [...contextTurns, ...userIntent];
    return {
        userIntent,
        contextTurns,
        fallbackAll: fallbackAll.length > 0 ? fallbackAll : messages.slice(-3),
    };
}

// loadMemoriesByDateRanges（pipeline.ts 里没 export，复制一份）
async function loadMemoriesByDateRanges(
    charId: string,
    ranges: Array<{ start: number; end: number }>,
): Promise<MemoryNode[]> {
    if (ranges.length === 0) return [];
    const all = await MemoryNodeDB.getByCharId(charId);
    const out: MemoryNode[] = [];
    const seen = new Set<string>();
    for (const range of ranges) {
        const inRange = all.filter(n => n.createdAt >= range.start && n.createdAt < range.end && n.embedded !== false);
        const sorted = inRange.sort((a, b) => b.importance - a.importance).slice(0, 5);
        for (const n of sorted) {
            if (n.archived && n.eventBoxId) {
                const box = await EventBoxDB.getById(n.eventBoxId);
                if (box?.summaryNodeId) {
                    if (seen.has(box.summaryNodeId)) continue;
                    const sum = await MemoryNodeDB.getById(box.summaryNodeId);
                    if (sum && !sum.archived) { seen.add(sum.id); out.push(sum); continue; }
                }
                continue;
            }
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            out.push(n);
        }
    }
    return out;
}

// ─── 目标一：traceRetrieve ─────────────────────────────

/**
 * 跑一次只读 retrieveMemories。
 *
 * 流程与 pipeline.retrieveMemories 严格对齐，但不调：
 *   - MemoryNodeDB.touchAccess（不写 accessCount / lastAccessedAt）
 *   - strengthenCoActivated（不写 link.strength）
 *   - rerank 通道的 touchAccess（同样跳过）
 *
 * 其余流程（embedding、vector search、BM25、spreadActivation、priming、checkRumination、
 * expandAndFormat）都是只读计算或远端无副作用。
 */
export async function traceRetrieve(opts: RetrieveTraceOptions): Promise<RetrieveTraceResult> {
    const traceId = opts.traceId || generateTraceId();
    const t0 = performance.now();
    const timings = { total: 0, buildQueries: 0, search: 0, merge: 0, date: 0, spread: 0, priming: 0, rumination: 0, format: 0 };
    const skippedWrites: string[] = [
        'MemoryNodeDB.touchAccess（不改 accessCount / lastAccessedAt）',
        'strengthenCoActivated（不改 link.strength）',
        'rerank 通道的 touchAccess',
    ];

    const remoteCfg = opts.remoteVectorConfig || getRemoteVectorConfig();

    // 1. 构建查询（与 pipeline.retrieveMemories 对齐）
    const tBuildQ = performance.now();
    const { userIntent, contextTurns, fallbackAll } = splitLastTurnQueries(opts.messages);
    const MIN_SPIKE_LEN = 2;
    const MAX_SPIKES = 10;
    const MAX_SUB_SPIKES_PER_MSG = 5;
    const URL_RE = /https?:\/\/\S+/gi;
    const PUNCT_WS_RE = /[\s\p{P}]/gu;
    const SPLIT_RE = /[\s\p{P}]+/gu;
    const seenSpike = new Set<string>();
    const userSpikes: { label: string; text: string; originalIdx: number; messageId?: number }[] = [];
    userIntent.forEach((m, idx) => {
        const stripped = m.content.replace(URL_RE, ' ').trim();
        const text = stripped.slice(0, 2000);
        const meaningfulChars = text.replace(PUNCT_WS_RE, '');
        if (meaningfulChars.length < MIN_SPIKE_LEN) return;
        if (seenSpike.has(text)) return;
        seenSpike.add(text);
        const baseLabel = `u${idx + 1}`;
        userSpikes.push({ label: baseLabel, text, originalIdx: idx, messageId: m.id });
        const segments = text.split(SPLIT_RE)
            .map(s => s.trim())
            .filter(s => s.length > 0 && s !== text && s.replace(PUNCT_WS_RE, '').length >= MIN_SPIKE_LEN);
        let subIdx = 0;
        for (const seg of segments) {
            if (subIdx >= MAX_SUB_SPIKES_PER_MSG) break;
            if (seenSpike.has(seg)) continue;
            seenSpike.add(seg);
            subIdx++;
            const subLabel = `${baseLabel}${String.fromCharCode(96 + subIdx)}`;
            userSpikes.push({ label: subLabel, text: seg, originalIdx: idx, messageId: m.id });
        }
    });
    const effectiveSpikes = userSpikes.slice(-MAX_SPIKES);

    const contextQuery = [opts.messages.slice(-1)[0]?.content].filter(Boolean).join('\n') || '';
    const contextJoined = contextTurns.map(m => m.content).join('\n');
    const fullContextQuery = [opts.llmConfig ? '' : '', contextJoined].filter(Boolean).join('\n').slice(0, 2000);

    const fallbackQuery = effectiveSpikes.length > 0
        ? ''
        : [fallbackAll.map(m => m.content).join('\n')].filter(Boolean).join('\n').slice(0, 2000);

    timings.buildQueries = Math.round(performance.now() - tBuildQ);

    // 2. 预取 + 多路 hybridSearch
    const tSearch = performance.now();
    const allNodes = await MemoryNodeDB.getByCharId(opts.charId);
    const useRemoteVector = !!(remoteCfg?.enabled && remoteCfg.initialized && !isRemoteSearchBroken());
    const allVectors = useRemoteVector ? undefined : await MemoryVectorDB.getAllByCharId(opts.charId);

    const spikeCandidates: SpikeCandidateBundle[] = [];
    const spikeResultsArr: ScoredMemory[][] = [];
    let queryVectors: Float32Array[] = [];

    if (effectiveSpikes.length > 0) {
        const queriesToEmbed = [...effectiveSpikes.map(s => s.text), fullContextQuery].filter(Boolean);
        if (queriesToEmbed.length > 0) {
            queryVectors = await getEmbeddings(queriesToEmbed, opts.embeddingConfig);
        }

        for (let i = 0; i < effectiveSpikes.length; i++) {
            const s = effectiveSpikes[i];
            const qv = queryVectors[i];
            const results = await hybridSearch(s.text, opts.charId, opts.embeddingConfig, 30, remoteCfg, {
                queryVector: qv, allNodes, allVectors,
            });
            spikeResultsArr.push(results);
            spikeCandidates.push({
                spikeLabel: s.label,
                spikeText: s.text,
                queryType: 'spike',
                candidates: results.map(r => buildCandidateTrace(r, traceId, s, 'spike', 'main_search', true)),
            });
        }
    }

    let contextResults: ScoredMemory[] = [];
    let contextBundle: SpikeCandidateBundle | undefined;
    if (fullContextQuery.trim()) {
        const qv = queryVectors[effectiveSpikes.length];
        contextResults = await hybridSearch(fullContextQuery, opts.charId, opts.embeddingConfig, 30, remoteCfg, {
            queryVector: qv, allNodes, allVectors,
        });
        contextBundle = {
            spikeLabel: 'context',
            spikeText: fullContextQuery.slice(0, 200),
            queryType: 'context',
            candidates: contextResults.map(r => buildCandidateTrace(r, traceId, { label: 'context', text: fullContextQuery }, 'context', 'main_search', true)),
        };
    }

    let fallbackResults: ScoredMemory[] = [];
    let fallbackBundle: SpikeCandidateBundle | undefined;
    if (effectiveSpikes.length === 0 && fallbackQuery.trim()) {
        fallbackResults = await hybridSearch(fallbackQuery, opts.charId, opts.embeddingConfig, 30, remoteCfg);
        fallbackBundle = {
            spikeLabel: 'fallback',
            spikeText: fallbackQuery.slice(0, 200),
            queryType: 'fallback',
            candidates: fallbackResults.map(r => buildCandidateTrace(r, traceId, { label: 'fallback', text: fallbackQuery }, 'fallback', 'main_search', true)),
        };
    }

    timings.search = Math.round(performance.now() - tSearch);

    // 3. 合并
    const tMerge = performance.now();
    const CONTEXT_DISCOUNT = 0.5;
    const merged = new Map<string, ScoredMemory>();
    const sourceTrace = new Map<string, { spikeLabels: string[]; contextScore?: number; }>();
    for (let i = 0; i < spikeResultsArr.length; i++) {
        for (const r of spikeResultsArr[i]) {
            const label = effectiveSpikes[i].label;
            const trace = sourceTrace.get(r.node.id) ?? { spikeLabels: [] };
            trace.spikeLabels.push(label);
            sourceTrace.set(r.node.id, trace);
            const existing = merged.get(r.node.id);
            if (!existing || r.finalScore > existing.finalScore) merged.set(r.node.id, r);
        }
    }
    for (const r of contextResults) {
        const trace = sourceTrace.get(r.node.id) ?? { spikeLabels: [] };
        trace.contextScore = r.finalScore;
        sourceTrace.set(r.node.id, trace);
        const discounted: ScoredMemory = { ...r, finalScore: r.finalScore * CONTEXT_DISCOUNT, roomScore: r.roomScore * CONTEXT_DISCOUNT };
        const existing = merged.get(r.node.id);
        if (!existing || discounted.finalScore > existing.finalScore) merged.set(r.node.id, discounted);
    }
    for (const r of fallbackResults) {
        const existing = merged.get(r.node.id);
        if (!existing || r.finalScore > existing.finalScore) merged.set(r.node.id, r);
    }
    let results: ScoredMemory[] = [...merged.values()].sort((a, b) => b.finalScore - a.finalScore).slice(0, 15);
    const top15Ids = new Set(results.map(r => r.node.id));
    timings.merge = Math.round(performance.now() - tMerge);

    // 标 selectedInTop15 + excludedReason
    for (const bundle of [...spikeCandidates, contextBundle, fallbackBundle].filter(Boolean) as SpikeCandidateBundle[]) {
        for (const c of bundle.candidates) {
            c.selectedInTop15 = top15Ids.has(c.candidateMemoryId);
            if (!c.selectedInTop15) {
                c.excludedReason = '未进合并后 top 15';
            }
        }
    }

    // 4. 日期路径
    const tDate = performance.now();
    const datePathInsertions: RetrieveTraceResult['datePathInsertions'] = [];
    try {
        const queryForDates = [opts.messages.map(m => m.content).join('\n')].filter(Boolean).join('\n');
        const ranges = resolveDateReferences(queryForDates);
        if (ranges.length > 0) {
            const dateHits = await loadMemoriesByDateRanges(opts.charId, ranges);
            const DATE_BOOST = 0.3;
            const DATE_BASE = 0.5;
            for (const node of dateHits) {
                const idx = results.findIndex(r => r.node.id === node.id);
                if (idx !== -1) {
                    const before = results[idx].finalScore;
                    results[idx].finalScore += DATE_BOOST;
                    results[idx].roomScore += DATE_BOOST;
                    datePathInsertions.push({ memoryId: node.id, before, after: results[idx].finalScore });
                } else {
                    results.push({
                        node, finalScore: DATE_BASE + DATE_BOOST, similarity: 0, bm25Score: 0, roomScore: DATE_BASE + DATE_BOOST,
                    });
                    datePathInsertions.push({ memoryId: node.id, after: DATE_BASE + DATE_BOOST });
                }
            }
        }
    } catch { /* 只读 */ }
    timings.date = Math.round(performance.now() - tDate);

    // 5. 扩散激活
    const tSpread = performance.now();
    const spreadInsertions: RetrieveTraceResult['spreadInsertions'] = [];
    if (results.length > 0) {
        const beforeIds = new Set(results.map(r => r.node.id));
        const activated = await spreadActivation(results, opts.charId, opts.personalityStyle || 'emotional', 3);
        const newOnes = activated.filter(r => !beforeIds.has(r.node.id));
        for (const n of newOnes) {
            spreadInsertions.push({ memoryId: n.node.id, seedId: '', seedScore: 0, activatedScore: n.finalScore });
        }
        results = activated;
    }
    timings.spread = Math.round(performance.now() - tSpread);

    // 6. 启动效应
    const tPriming = performance.now();
    const primingAdjustments: RetrieveTraceResult['primingAdjustments'] = [];
    if (opts.currentMood) {
        const before = new Map(results.map(r => [r.node.id, r.finalScore]));
        results = applyPriming(results, opts.currentMood);
        for (const r of results) {
            const b = before.get(r.node.id);
            if (b !== undefined && b !== r.finalScore) {
                primingAdjustments.push({ memoryId: r.node.id, beforeScore: b, afterScore: r.finalScore, multiplier: r.finalScore / b });
            }
        }
    }
    timings.priming = Math.round(performance.now() - tPriming);

    results.sort((a, b) => b.finalScore - a.finalScore);

    // 7. 反刍
    const tRumination = performance.now();
    let ruminationInsertion: RetrieveTraceResult['ruminationInsertion'];
    if (opts.ruminationTendency && opts.ruminationTendency > 0) {
        const rNode = await checkRumination(opts.charId, opts.ruminationTendency);
        if (rNode) {
            const avg = results.length > 0 ? results.reduce((s, r) => s + r.finalScore, 0) / results.length : 0.5;
            const score = avg * 0.8;
            results.push({ node: rNode, finalScore: score, similarity: 0, bm25Score: 0, roomScore: score });
            ruminationInsertion = { memoryId: rNode.id, insertedAt: Date.now(), score };
        }
    }
    timings.rumination = Math.round(performance.now() - tRumination);

    // 8. rerank（不调 touchAccess，**整个 rerank 段不写 IDB**）
    const rerankPicks: RetrieveTraceResult['rerankPicks'] = [];
    // trace 模式下跳过 rerank 以保证零 LLM RTT（如果 caller 想跑可以自己加）
    if (false && opts.llmConfig) { /* 占位：trace 默认不跑 rerank */ }

    // 9. formatter
    const tFormat = performance.now();
    const preFormatterNodes = results.map(r => ({
        id: r.node.id, room: r.node.room, contentLength: r.node.content.length, finalScore: r.finalScore,
    }));
    const anticipations = await AnticipationDB.getByCharId(opts.charId);
    const formatted = await expandAndFormat(results, opts.charId, anticipations, opts.userName, undefined);
    timings.format = Math.round(performance.now() - tFormat);

    // 10. 收集 merged top 15 的 final trace
    const mergedTop15: PerCandidateTrace[] = results.slice(0, 15).map(r => {
        const st = sourceTrace.get(r.node.id);
        return {
            traceId,
            queryType: 'spike' as const,
            queryIndex: st ? parseInt(st.spikeLabels[0]?.slice(1) || '0', 10) || undefined : undefined,
            candidateMemoryId: r.node.id,
            candidateContentPreview: r.node.content.slice(0, 80).replace(/\n/g, ' '),
            candidateRoom: r.node.room,
            candidateImportance: r.node.importance,
            vectorSim: r.similarity,
            bm25Raw: 0,
            bm25Norm: r.bm25Score,
            hybridSim: 0.85 * r.similarity + 0.15 * r.bm25Score,
            recency: 0,
            effectiveImportance: calculateEffectiveImportance(r.node, Date.now()) / 10,
            familiarity: 0,
            simWeight: 0,
            recencyWeight: 0,
            importanceWeight: 0,
            baseScore: 0,
            finalScore: r.finalScore,
            source: 'main_search',
            selectedInTop15: true,
        };
    });

    // 最佳来源
    const bestSourcePerFinal: RetrieveTraceResult['bestSourcePerFinal'] = {};
    for (const r of results.slice(0, 15)) {
        const st = sourceTrace.get(r.node.id);
        const labels = st?.spikeLabels || [];
        const ctxLabel = st?.contextScore !== undefined ? `ctx×0.5` : '';
        bestSourcePerFinal[r.node.id] = {
            source: 'main_search',
            score: r.finalScore,
            label: [...labels.map(l => `🎯${l}`), ctxLabel].filter(Boolean).join('+') || 'main',
        };
    }
    if (datePathInsertions.length > 0) for (const d of datePathInsertions) {
        if (bestSourcePerFinal[d.memoryId] && d.before !== undefined) {
            bestSourcePerFinal[d.memoryId].source = 'date_boost';
        }
    }
    if (spreadInsertions.length > 0) for (const s of spreadInsertions) {
        if (bestSourcePerFinal[s.memoryId]) bestSourcePerFinal[s.memoryId].source = 'spread_activation';
    }
    for (const p of primingAdjustments) {
        if (bestSourcePerFinal[p.memoryId]) bestSourcePerFinal[p.memoryId].source = 'priming';
    }
    if (ruminationInsertion && bestSourcePerFinal[ruminationInsertion.memoryId]) {
        bestSourcePerFinal[ruminationInsertion.memoryId].source = 'rumination';
    }

    timings.total = Math.round(performance.now() - t0);

    return {
        traceId,
        charId: opts.charId,
        ranAt: Date.now(),
        duration: timings,
        messageSnapshotSize: opts.messages.length,
        spikes: spikeCandidates,
        contextCandidates: contextBundle || { spikeLabel: 'context', spikeText: '', queryType: 'context', candidates: [] },
        fallbackCandidates: fallbackBundle,
        mergedTop15,
        bestSourcePerFinal,
        datePathInsertions,
        spreadInsertions,
        primingAdjustments,
        ruminationInsertion,
        rerankPicks,
        preFormatterNodes,
        formatterOutput: formatted,
        formatterOutputLength: formatted.length,
        injectionBlockLength: formatted.length,
        injectionBlockPreview: formatted.slice(0, 200),
        skippedWrites,
    };
}

// 构造一条 PerCandidateTrace（需要单独从 hybridSearch 结果拆出每条分数的明细）
function buildCandidateTrace(
    r: ScoredMemory,
    traceId: string,
    spike: { label: string; text: string; messageId?: number },
    queryType: 'spike' | 'context' | 'fallback',
    source: PerCandidateTrace['source'],
    selectedInTop15: boolean,
): PerCandidateTrace {
    const now = Date.now();
    const recency = Math.pow(0.999, (now - r.node.lastAccessedAt) / (1000 * 60 * 60));
    const effectiveImp = calculateEffectiveImportance(r.node, now) / 10;
    const n = Math.max(0, (r.node.accessCount || 0) - 1);
    const familiarity = n === 0 ? 0 : Math.min(1, Math.pow(n, 0.3) / 4);
    return {
        traceId,
        messageId: spike.messageId,
        rawMessage: spike.text,
        normalizedSpike: spike.text,
        queryType,
        queryIndex: queryType === 'spike' ? parseInt(spike.label.replace(/[^0-9]/g, '') || '0', 10) || undefined : undefined,
        candidateMemoryId: r.node.id,
        candidateContentPreview: r.node.content.slice(0, 80).replace(/\n/g, ' '),
        candidateRoom: r.node.room,
        candidateImportance: r.node.importance,
        vectorSim: r.similarity,
        bm25Raw: 0,         // hybridSearch 没返回原始 BM25，归一化用 r.bm25Score（这里是归一化后的）
        bm25Norm: r.bm25Score,
        hybridSim: 0.85 * r.similarity + 0.15 * r.bm25Score,
        recency,
        effectiveImportance: effectiveImp,
        familiarity,
        simWeight: 0,       // 房间权重被 absorb 到 finalScore，重算需要 hybridSearch 内部
        recencyWeight: 0,
        importanceWeight: 0,
        baseScore: r.roomScore - 0.05 * familiarity,
        finalScore: r.finalScore,
        source,
        selectedInTop15,
    };
}

// ─── 目标二：traceBox ──────────────────────────────────

export interface BoxTraceResult {
    traceId: string;
    charId: string;
    ranAt: number;
    box: {
        boxId: string;
        name: string;
        room: MemoryRoom;
        createdAt: number;
        predecessorBoxId: string | null;
        compressionCount: number;
        sealed: boolean;
        liveMemoryIds: string[];
        archivedMemoryIds: string[];
        summaryId: string | null;
    };
    allNodes: Array<{
        memoryId: string;
        date: string;
        content: string;
        room: MemoryRoom;
        tags: string[];
        importance: number;
        createdAt: number;
        eventBoxId: string | null;
        isBoxSummary: boolean;
        archived: boolean;
    }>;
    /** 重建的 bindMemoriesIntoEventBox 历史（基于 archived 节点的"同伴"反推） */
    bindTrace: Array<{
        timestamp: number;
        newMemoryId: string;
        relatedToRaw: string;            // 真实 ID（不是 O 编号）
        relatedMemoryIds: string[];
        relatedBoxIds: string[];
        operation: 'created' | 'joined' | 'merged' | 'predecessor';
        targetBoxId: string;
        mergedBoxIds: string[];
        predecessorBoxId: string | null;
    }>;
    /** 重建的 compressEventBox 历史（基于 compressionCount + lastCompressedAt 反推） */
    compressTrace: Array<{
        boxId: string;
        liveNodeCountBefore: number;
        inputMemoryIds: string[];
        inputContentLengths: number[];
        oldSummaryId: string | null;
        oldSummaryLength: number;
        /** 注：当前 summary.content 长度；LLM 真实返回的"重写前"长度 IDB 没存，标 N/A */
        returnedSummaryLength: number | 'N/A (未持久化)';
        storedSummaryId: string;
        storedSummaryLength: number;
        archivedMemoryIds: string[];
    }>;
    /** formatter 输出（如果 box summary 进了召回） */
    formatterOutput: string;
    formatterOutputLength: number;
    formatterExpandedMemoryIds: string[];
    injectionBlockLength: number;
    /** 三个关键长度的对比 */
    lengthReport: {
        summaryContentLength: number;
        summaryHardMax: number;
        summaryOverrun: boolean;
        formatterOutputLength: number;
        injectionBlockLength: number;
        formatterExpandedMoreThanBoxNodes: string[];  // formatter 多展开的节点 ID
    };
    suspiciousFlags: string[];   // 自动识别出的可疑信号
    /** 因果链（从 archived 节点反推"它当时跟谁一起进 box"） */
    causalChain: Array<{ step: number; actor: string; action: string; involvedMemoryIds: string[]; boxId: string; }>;
}

export async function traceBox(charId: string, boxId: string): Promise<BoxTraceResult> {
    const traceId = generateTraceId();
    const box = await EventBoxDB.getById(boxId);
    if (!box) throw new Error(`Box ${boxId} not found`);

    // 1. 收集全部相关节点
    const allIds = [
        ...box.liveMemoryIds,
        ...box.archivedMemoryIds,
        ...(box.summaryNodeId ? [box.summaryNodeId] : []),
    ];
    const nodes: MemoryNode[] = [];
    for (const id of allIds) {
        const n = await MemoryNodeDB.getById(id);
        if (n) nodes.push(n);
    }
    nodes.sort((a, b) => a.createdAt - b.createdAt);

    const allNodes = nodes.map(n => ({
        memoryId: n.id,
        date: new Date(n.createdAt).toISOString().slice(0, 10),
        content: n.content,
        room: safeRoom(n.room),
        tags: n.tags || [],
        importance: n.importance,
        createdAt: n.createdAt,
        eventBoxId: n.eventBoxId,
        isBoxSummary: !!n.isBoxSummary,
        archived: !!n.archived,
    }));

    // 2. 自动可疑信号
    const suspiciousFlags: string[] = [];
    const summaryNode = box.summaryNodeId ? await MemoryNodeDB.getById(box.summaryNodeId) : null;
    if (summaryNode && summaryNode.content.length > SUMM_HARD_MAX) {
        suspiciousFlags.push(`summary.content.length = ${summaryNode.content.length} > ${SUMM_HARD_MAX} 硬上限`);
    }
    if (box.compressionCount >= 2) {
        suspiciousFlags.push(`compressionCount = ${box.compressionCount}（多次压缩可能合并语义漂移）`);
    }
    if (box.sealed) suspiciousFlags.push(`已封盒 sealed=true`);
    if (box.liveMemoryIds.length >= 10) {
        suspiciousFlags.push(`live 节点 ${box.liveMemoryIds.length} 条偏多（阈值 4 触发压缩，可能压缩失败堆积）`);
    }
    if (box.predecessorBoxId) {
        suspiciousFlags.push(`predecessorBoxId = ${box.predecessorBoxId}（前任已封盒/满员）`);
    }

    // 3. 反推 bindTrace
    //
    // 信息缺口：crossTimeLinks / eventBoxHints 在 pipeline 里瞬时消费，没存 IDB。
    // 只能从 archived 节点**的"同伴"**反推"它当时跟谁一起进 box"——
    // 即：每个 archived 节点 N，找在它前后 7 天内**同一 eventBoxId** 的其它节点，
    // 这些节点极可能就是当时一起进 box 的"newMemory + existingMemory"组。
    const bindTrace: BoxTraceResult['bindTrace'] = [];
    const seenNewIds = new Set<string>();
    for (const archivedNode of nodes.filter(n => n.archived)) {
        if (seenNewIds.has(archivedNode.id)) continue;
        // 找同伴
        const peers = nodes.filter(n =>
            n.id !== archivedNode.id &&
            n.eventBoxId === boxId &&
            Math.abs(n.createdAt - archivedNodeTs(archivedNode)) <= 7 * 24 * 60 * 60 * 1000
        );
        // 把 archivedNode 当作 "newMemory"，peers 当作 "related"
        bindTrace.push({
            timestamp: archivedNode.createdAt,
            newMemoryId: archivedNode.id,
            relatedToRaw: archivedNode.id,   // 真实 ID
            relatedMemoryIds: peers.map(p => p.id),
            relatedBoxIds: [...new Set(peers.map(p => p.eventBoxId).filter(Boolean))],
            operation: peers.length === 0 ? 'created' : 'joined',
            targetBoxId: boxId,
            mergedBoxIds: [],
            predecessorBoxId: box.predecessorBoxId || null,
        });
        seenNewIds.add(archivedNode.id);
        for (const p of peers) seenNewIds.add(p.id);
    }
    // 处理 live 节点
    for (const liveNode of nodes.filter(n => !n.archived && !n.isBoxSummary)) {
        if (seenNewIds.has(liveNode.id)) continue;
        const peers = nodes.filter(n =>
            n.id !== liveNode.id &&
            n.eventBoxId === boxId &&
            Math.abs(n.createdAt - liveNode.createdAt) <= 7 * 24 * 60 * 60 * 1000
        );
        bindTrace.push({
            timestamp: liveNode.createdAt,
            newMemoryId: liveNode.id,
            relatedToRaw: liveNode.id,
            relatedMemoryIds: peers.map(p => p.id),
            relatedBoxIds: [...new Set(peers.map(p => p.eventBoxId).filter(Boolean))],
            operation: peers.length === 0 ? 'created' : 'joined',
            targetBoxId: boxId,
            mergedBoxIds: [],
            predecessorBoxId: box.predecessorBoxId || null,
        });
        seenNewIds.add(liveNode.id);
    }
    bindTrace.sort((a, b) => a.timestamp - b.timestamp);

    // 4. 反推 compressTrace
    //
    // 信息缺口：每次压缩的"旧 summary + 活节点"输入没存，"LLM 返回 summary"也没存原版（直接被覆写）。
    // 只能从 compressionCount + lastCompressedAt 推断"至少发生过 N 次"，并 dump 现状 summary。
    const compressTrace: BoxTraceResult['compressTrace'] = [];
    if (box.compressionCount > 0 && summaryNode) {
        // 推算：archivedMemoryIds 数量 == 历次压缩累积的活节点数
        // 但分不清"哪次压缩归档了哪些"——只列现状
        compressTrace.push({
            boxId,
            liveNodeCountBefore: box.archivedMemoryIds.length,   // 累积的活节点被归档总数
            inputMemoryIds: box.archivedMemoryIds,               // 现状的 archived 节点 = 历次被压入 summary 的全部
            inputContentLengths: [],  // 现拿现算
            oldSummaryId: null,        // IDB 没存中间 summary
            oldSummaryLength: 'N/A (未持久化)' as any,
            returnedSummaryLength: 'N/A (未持久化)' as any,   // LLM 实际返回的中间长度没存
            storedSummaryId: summaryNode.id,
            storedSummaryLength: summaryNode.content.length,
            archivedMemoryIds: box.archivedMemoryIds,
        });
        // 补 content lengths
        for (const aid of compressTrace[0].inputMemoryIds) {
            const n = await MemoryNodeDB.getById(aid);
            if (n) compressTrace[0].inputContentLengths.push(n.content.length);
        }
    }

    // 5. formatter 模拟（让 box 内容走一遍 formatter，看实际占多少 token / 展开多少节点）
    const formatterExpandedMemoryIds: string[] = [];
    let formatterOutput = '';
    if (summaryNode) {
        // 模拟召回：让 summary 节点作为唯一候选走 formatter
        const mockResults: ScoredMemory[] = [{
            node: summaryNode,
            finalScore: 0.5,
            similarity: 0.5,
            bm25Score: 0,
            roomScore: 0.5,
        }];
        formatterExpandedMemoryIds.push(summaryNode.id);
        try {
            formatterOutput = await expandAndFormat(mockResults, charId, [], undefined, undefined);
        } catch (e: any) {
            formatterOutput = `[formatter 失败: ${e?.message || e}]`;
        }
    } else {
        formatterOutput = '(无 summary，跳过 formatter 模拟)';
    }
    const formatterOutputLength = formatterOutput.length;

    // 6. 三个长度对比
    const summaryContentLength = summaryNode ? summaryNode.content.length : 0;
    const lengthReport: BoxTraceResult['lengthReport'] = {
        summaryContentLength,
        summaryHardMax: SUMM_HARD_MAX,
        summaryOverrun: summaryContentLength > SUMM_HARD_MAX,
        formatterOutputLength,
        injectionBlockLength: formatterOutputLength,
        formatterExpandedMoreThanBoxNodes: [],
    };

    // 7. 因果链
    const causalChain: BoxTraceResult['causalChain'] = [];
    let step = 1;
    for (const n of nodes.filter(n => !n.isBoxSummary).sort((a, b) => a.createdAt - b.createdAt)) {
        causalChain.push({
            step: step++,
            actor: n.origin || 'extraction',
            action: n.archived ? '进入 box → 被压缩归档' : '进入 box（live）',
            involvedMemoryIds: [n.id],
            boxId,
        });
    }
    if (box.compressionCount > 0) {
        causalChain.push({
            step: step++,
            actor: 'system',
            action: `第 ${box.compressionCount} 次压缩 → 生成/覆写 summary ${summaryNode?.id}（${summaryNode?.content.length || 0} 字）`,
            involvedMemoryIds: box.archivedMemoryIds,
            boxId,
        });
    }
    if (box.sealed) {
        causalChain.push({
            step: step++,
            actor: 'system',
            action: `封盒 sealed=true（事件总数 ≥ ${SUMM_HARD_MAX / 50}）`,
            involvedMemoryIds: [],
            boxId,
        });
    }

    return {
        traceId,
        charId,
        ranAt: Date.now(),
        box: {
            boxId: box.id,
            name: box.name,
            room: safeRoom(nodes.find(n => n.isBoxSummary)?.room || nodes[0]?.room),
            createdAt: box.createdAt,
            predecessorBoxId: box.predecessorBoxId || null,
            compressionCount: box.compressionCount,
            sealed: !!box.sealed,
            liveMemoryIds: box.liveMemoryIds,
            archivedMemoryIds: box.archivedMemoryIds,
            summaryId: box.summaryNodeId,
        },
        allNodes,
        bindTrace,
        compressTrace,
        formatterOutput,
        formatterOutputLength,
        formatterExpandedMemoryIds,
        injectionBlockLength: formatterOutputLength,
        lengthReport,
        suspiciousFlags,
        causalChain,
    };
}

function archivedNodeTs(n: MemoryNode): number { return n.createdAt; }

// ─── 列出全部 box + 自动筛可疑 ────────────────────────

export interface BoxSummary {
    boxId: string;
    name: string;
    room: MemoryRoom;
    createdAt: number;
    compressionCount: number;
    sealed: boolean;
    liveCount: number;
    archivedCount: number;
    summaryId: string | null;
    summaryLength: number;
    suspicious: string[];   // 这 box 触发的可疑信号
    score: number;          // 可疑分数（越高越可疑）
}

export async function listBoxes(charId: string): Promise<{ all: BoxSummary[]; suspicious: BoxSummary[] }> {
    const boxes = await EventBoxDB.getByCharId(charId);
    const summaries: BoxSummary[] = [];
    for (const b of boxes) {
        let summaryLen = 0;
        if (b.summaryNodeId) {
            const sn = await MemoryNodeDB.getById(b.summaryNodeId);
            if (sn) summaryLen = sn.content.length;
        }
        const sus: string[] = [];
        let score = 0;
        if (summaryLen > SUMM_HARD_MAX) { sus.push(`summary ${summaryLen} > 800`); score += 5; }
        if (b.compressionCount >= 2) { sus.push(`compressionCount=${b.compressionCount}`); score += 3; }
        if (b.sealed) { sus.push('sealed=true'); score += 1; }
        if (b.liveMemoryIds.length >= 10) { sus.push(`live ${b.liveMemoryIds.length} 条偏多`); score += 4; }
        if (b.predecessorBoxId) { sus.push(`有 predecessor ${b.predecessorBoxId}`); score += 2; }
        // 取第一个节点的 room（live 节点没有就 archived，再没有就 'living_room'）
        let room: MemoryRoom = 'living_room';
        if (b.liveMemoryIds.length > 0) {
            const n0 = await MemoryNodeDB.getById(b.liveMemoryIds[0]);
            if (n0) room = safeRoom(n0.room);
        } else if (b.archivedMemoryIds.length > 0) {
            const n0 = await MemoryNodeDB.getById(b.archivedMemoryIds[0]);
            if (n0) room = safeRoom(n0.room);
        } else if (b.summaryNodeId) {
            const n0 = await MemoryNodeDB.getById(b.summaryNodeId);
            if (n0) room = safeRoom(n0.room);
        }
        summaries.push({
            boxId: b.id,
            name: b.name,
            room,
            createdAt: b.createdAt,
            compressionCount: b.compressionCount,
            sealed: !!b.sealed,
            liveCount: b.liveMemoryIds.length,
            archivedCount: b.archivedMemoryIds.length,
            summaryId: b.summaryNodeId,
            summaryLength: summaryLen,
            suspicious: sus,
            score,
        });
    }
    summaries.sort((a, b) => b.score - a.score || b.compressionCount - a.compressionCount);
    return { all: summaries, suspicious: summaries.filter(s => s.suspicious.length > 0) };
}

export async function traceSuspiciousBoxes(charId: string, topN: number = 5): Promise<BoxTraceResult[]> {
    const { suspicious } = await listBoxes(charId);
    const targets = suspicious.slice(0, topN);
    console.log(`[Trace] 自动筛出 ${suspicious.length} 个可疑 box，trace Top ${Math.min(topN, targets.length)}`);
    const results: BoxTraceResult[] = [];
    for (const t of targets) {
        console.log(`[Trace]  → ${t.boxId} "${t.name}" score=${t.score}  flags=${t.suspicious.join(' / ')}`);
        results.push(await traceBox(charId, t.boxId));
    }
    return results;
}

// ─── 下载 .json ────────────────────────────────────────

export function downloadTrace(data: any, filename?: string): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `mp-trace-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

// ─── 挂到 window.__mpTrace ─────────────────────────────

declare global {
    interface Window {
        __mpTrace?: {
            listBoxes: (charId: string) => Promise<{ all: BoxSummary[]; suspicious: BoxSummary[] }>;
            traceRetrieve: (opts: RetrieveTraceOptions) => Promise<RetrieveTraceResult>;
            traceBox: (charId: string, boxId: string) => Promise<BoxTraceResult>;
            traceSuspiciousBoxes: (charId: string, topN?: number) => Promise<BoxTraceResult[]>;
            downloadTrace: (data: any, filename?: string) => void;
        };
    }
}

if (typeof window !== 'undefined') {
    window.__mpTrace = {
        listBoxes,
        traceRetrieve,
        traceBox,
        traceSuspiciousBoxes,
        downloadTrace,
    };
    console.log('[MemoryPalace Trace] __mpTrace 已挂载。可用命令: listBoxes / traceRetrieve / traceBox / traceSuspiciousBoxes / downloadTrace');
}
