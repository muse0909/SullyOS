/**
 * Memory Palace — 关联网络 (Memory Links)
 *
 * 记忆之间的五种连接：temporal, emotional, causal, person, metaphor。
 * - temporal / emotional: 自动规则建立
 * - causal / person / metaphor: LLM 判断（每次封盒时对新记忆 vs Top-5 相似旧记忆做一次批量判断）
 */

import type { MemoryNode, MemoryLink, LinkType } from './types';
import type { LightLLMConfig } from './pipeline';
import { MemoryLinkDB } from './db';
import { safeFetchJson } from '../safeApi';
import { safeParseJsonArray } from './jsonUtils';
import { getEmotionVA, emotionDistance } from './emotionSpace';

const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 小时
const CO_ACTIVATION_INCREMENT = 0.05;
const MAX_STRENGTH = 1.0;

// ─── Emotional link 阈值（Russell 情感空间） ─────────
/** 情感距离 < 此值才建 emotional 边 */
const EMOTIONAL_LINK_DIST = 0.35;
/** 双方 (v,a) 模长都 < 此值 视为"情绪太弱"，不建边（避免一堆 neutral 节点互链） */
const EMOTIONAL_MIN_MAGNITUDE = 0.2;

/** 判断一条新-旧节点对是否应建 emotional 边，以及该给多大 strength */
function emotionalLinkStrength(a: MemoryNode, b: MemoryNode): number {
    const va = getEmotionVA(a);
    const vb = getEmotionVA(b);
    const magA = Math.hypot(va.v, va.a);
    const magB = Math.hypot(vb.v, vb.a);
    if (magA < EMOTIONAL_MIN_MAGNITUDE || magB < EMOTIONAL_MIN_MAGNITUDE) return 0;
    const dist = emotionDistance(va, vb);
    if (dist >= EMOTIONAL_LINK_DIST) return 0;
    // 距离 0 → 0.55；距离 = 阈值 → 0.25。线性。
    return 0.25 + (0.55 - 0.25) * (1 - dist / EMOTIONAL_LINK_DIST);
}

function generateId(): string {
    return `ml_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── LLM 关联判断 ────────────────────────────────────

/**
 * 一次 LLM 调用，批量判断所有新记忆和候选旧记忆之间的深层关联
 */
async function batchClassifyDeepLinks(
    newNodes: MemoryNode[],
    candidates: MemoryNode[],
    llmConfig: LightLLMConfig,
): Promise<{ sourceId: string; targetId: string; type: LinkType; strength: number }[]> {
    if (newNodes.length === 0 || candidates.length === 0) return [];

    const newList = newNodes
        .map((n, i) => `[N${i}] (${n.room}, ${n.mood}): ${n.content.slice(0, 80)}`)
        .join('\n');

    const oldList = candidates
        .map((c, i) => `[O${i}] (${c.room}, ${c.mood}): ${c.content.slice(0, 80)}`)
        .join('\n');

    const prompt = `你是一个记忆关联分析器。给你一组新记忆 [N*] 和一组旧记忆 [O*]，找出它们之间的深层关联。

三种关联类型：
- causal: 因果关系（一件事导致了另一件事）
- person: 提到了同一个人
- metaphor: 隐喻/类比（不同事件但有相似的情感模式）

只输出存在关联的配对。严格 JSON 数组格式：
[{"from": "N0", "to": "O2", "type": "person", "strength": 0.6}]

strength 范围 0.3-0.8。没有关联返回 []。只输出 JSON。`;

    const userMsg = `新记忆：\n${newList}\n\n旧记忆：\n${oldList}`;

    try {
        const data = await safeFetchJson(
            `${llmConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${llmConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: llmConfig.model,
                    messages: [
                        { role: 'system', content: prompt },
                        { role: 'user', content: userMsg },
                    ],
                    temperature: 0.2,
                    max_tokens: 800,
                    stream: false,
                }),
            }
        );

        const reply = data.choices?.[0]?.message?.content || '';
        const parsed = safeParseJsonArray(reply);
        const validTypes: LinkType[] = ['causal', 'person', 'metaphor'];

        return parsed
            .filter(item => {
                const fromIdx = parseInt(item.from?.replace('N', '') || '-1', 10);
                const toIdx = parseInt(item.to?.replace('O', '') || '-1', 10);
                return fromIdx >= 0 && fromIdx < newNodes.length &&
                       toIdx >= 0 && toIdx < candidates.length &&
                       validTypes.includes(item.type as LinkType);
            })
            .map(item => ({
                sourceId: newNodes[parseInt(item.from.replace('N', ''), 10)].id,
                targetId: candidates[parseInt(item.to.replace('O', ''), 10)].id,
                type: item.type as LinkType,
                strength: Math.max(0.3, Math.min(0.8, item.strength || 0.5)),
            }));

    } catch (err: any) {
        console.warn('⚡ [Links] Batch deep link classification failed:', err.message);
        return [];
    }
}

// ─── 主函数 ──────────────────────────────────────────

/**
 * 为新记忆节点建立关联
 *
 * 三层：
 * 1. temporal — 24h 内 / 同 box 自动建链
 * 2. emotional — 相同 mood 自动建链
 * 3. causal / person / metaphor — LLM 判断（如果提供了 llmConfig）
 *
 * @param llmConfig 可选。传入则启用 LLM 深层关联判断。
 */
export async function buildLinks(
    newNodes: MemoryNode[],
    existingNodes: MemoryNode[],
    llmConfig?: LightLLMConfig | null,
    // 暮色 2026-07-21：跨 batch 去重 — pipeline 多次跑累积
    //   之前 bug：每次 pipeline 跑全连接 N × M link，跨 batch 不去重
    //   285232 条 link 真实数据 O(N²) 累积（139 条/node）
    //   修法：传 skipKeys（existingNodes 涉及的现有 link）进来，初始化 linkSet
    skipKeys?: Set<string>,
): Promise<MemoryLink[]> {
    const links: MemoryLink[] = [];
    const linkSet = new Set<string>(skipKeys || []);

    for (const newNode of newNodes) {
        // ─── 自动规则关联 ─────────────────────────

        for (const existing of existingNodes) {
            if (newNode.id === existing.id) continue;

            // 1. Temporal: 24h 内创建
            if (Math.abs(newNode.createdAt - existing.createdAt) < TEMPORAL_WINDOW_MS) {
                const key = makeKey(newNode.id, existing.id, 'temporal');
                if (!linkSet.has(key)) {
                    links.push(createLink(newNode.id, existing.id, 'temporal', 0.3));
                    linkSet.add(key);
                }
            }

            // 2. Emotional: Russell 情感空间距离 < 0.35，strength 随距离线性缩放
            const emoStrength = emotionalLinkStrength(newNode, existing);
            if (emoStrength > 0) {
                const key = makeKey(newNode.id, existing.id, 'emotional');
                if (!linkSet.has(key)) {
                    links.push(createLink(newNode.id, existing.id, 'emotional', emoStrength));
                    linkSet.add(key);
                }
            }
        }

        // 同批次内的节点
        for (const other of newNodes) {
            if (newNode.id === other.id) continue;

            if (newNode.boxId === other.boxId) {
                const key = makeKey(newNode.id, other.id, 'temporal');
                if (!linkSet.has(key)) {
                    links.push(createLink(newNode.id, other.id, 'temporal', 0.5));
                    linkSet.add(key);
                }
            }

            const emoStrength = emotionalLinkStrength(newNode, other);
            if (emoStrength > 0) {
                const key = makeKey(newNode.id, other.id, 'emotional');
                if (!linkSet.has(key)) {
                    links.push(createLink(newNode.id, other.id, 'emotional', emoStrength));
                    linkSet.add(key);
                }
            }
        }

    }

    // ─── LLM 深层关联（causal / person / metaphor）── 一次调用处理所有新节点

    if (llmConfig && existingNodes.length > 0 && newNodes.length > 0) {
        const candidates = existingNodes
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 8); // 最近 8 条旧记忆作为候选

        if (candidates.length > 0) {
            const deepLinks = await batchClassifyDeepLinks(newNodes, candidates, llmConfig);

            for (const dl of deepLinks) {
                const key = makeKey(dl.sourceId, dl.targetId, dl.type);
                if (!linkSet.has(key)) {
                    links.push(createLink(dl.sourceId, dl.targetId, dl.type, dl.strength));
                    linkSet.add(key);
                }
            }
        }
    }

    // 批量保存
    if (links.length > 0) {
        await MemoryLinkDB.saveMany(links);
        console.log(`🔗 [Links] Created ${links.length} links (temporal/emotional: auto, causal/person/metaphor: ${llmConfig ? 'LLM' : 'skipped'})`);
    }

    return links;
}

/**
 * 共同激活：当多条记忆同时被检索命中时，加强它们之间的关联
 */
export async function strengthenCoActivated(nodeIds: string[]): Promise<void> {
    if (nodeIds.length < 2) return;

    for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
            const links = await MemoryLinkDB.getBySourceId(nodeIds[i]);
            const existingLink = links.find(l => l.targetId === nodeIds[j]);

            if (existingLink) {
                existingLink.strength = Math.min(
                    MAX_STRENGTH,
                    existingLink.strength + CO_ACTIVATION_INCREMENT
                );
                await MemoryLinkDB.save(existingLink);
            }
            else {
                const reverseLinks = await MemoryLinkDB.getBySourceId(nodeIds[j]);
                const reverseLink = reverseLinks.find(l => l.targetId === nodeIds[i]);
                if (reverseLink) {
                    reverseLink.strength = Math.min(
                        MAX_STRENGTH,
                        reverseLink.strength + CO_ACTIVATION_INCREMENT
                    );
                    await MemoryLinkDB.save(reverseLink);
                }
                else {
                    const link = createLink(nodeIds[i], nodeIds[j], 'temporal', CO_ACTIVATION_INCREMENT);
                    await MemoryLinkDB.save(link);
                }
            }
        }
    }
}

// ─── 工具函数 ──────────────────────────────────────────

function createLink(sourceId: string, targetId: string, type: LinkType, strength: number): MemoryLink {
    return {
        id: generateId(),
        sourceId,
        targetId,
        type,
        strength,
    };
}

/** 生成去重 key（确保 A-B 和 B-A 视为同一对） */
function makeKey(id1: string, id2: string, type: string): string {
    const [a, b] = id1 < id2 ? [id1, id2] : [id2, id1];
    return `${a}-${b}-${type}`;
}

/**
 * 备份导出 / 导入时的链接裁剪
 *
 * 目的：把 memoryLinks 从 ~19 万条压到 ~5 万条，省：
 *  - 备份文件体积 ~6 MB（zipped 后）
 *  - 导入时间 20-30 秒（IndexedDB 19 万次 put 是大头）
 *  - 导出 JSON.stringify 时间
 *
 * 砍的规则（保守，不影响图遍历扩散激活质量）：
 *  1. emotional 链接 strength < 0.3 → 砍（25% 条，强度都极弱）
 *  2. 重复对（同 source+target+type）→ 只保留 strength 最大的
 *
 * 砍的逻辑：图遍历时强联通性由强边维持，砍弱边对检索质量影响极小。
 * 这些弱边在系统使用过程中会按 buildLinks 规则自动重建。
 *
 * @param links 原始链接列表
 * @param minStrength 低于此值的 emotional 链接被砍，默认 0.3
 * @returns 裁剪后的链接列表
 */
export function pruneMemoryLinks(
    links: MemoryLink[],
    minStrength: number = 0.3,
): MemoryLink[] {
    // 第一步：按规则过滤 + 内部去重
    const bestByKey = new Map<string, MemoryLink>();
    for (const link of links) {
        // 弱 emotional 砍掉
        if (link.type === 'emotional' && link.strength < minStrength) continue;

        // 重复对去重（保留 strength 最大的）
        const key = makeKey(link.sourceId, link.targetId, link.type);
        const existing = bestByKey.get(key);
        if (!existing || link.strength > existing.strength) {
            bestByKey.set(key, link);
        }
    }
    return Array.from(bestByKey.values());
}

/**
 * 修剪历史 memoryLinks — 按"每个节点最多保留 topN 条关系"做二阶段压缩
 *
 * 背景：buildLinks 旧版 bug 累积了 27 万+ 条 link，平均每节点 ~140 条。
 *   - 索引体积：每条 link 包含 sourceId + targetId + type + strength ≈ 100 字节
 *     → 27 万条 ≈ 27 MB 纯 IDB 占用
 *   - 扩散激活：每次检索都遍历节点所有 link，140 条/node × N 节点 = 卡顿
 *   - 冗余高：每节点保留最强 50 条已足以维持图遍历质量
 *
 * 阶段 1：跟 pruneMemoryLinks 一样砍弱边 + 去重（同 source+target+type 留最强）
 * 阶段 2：每个节点挑 strength 最高的 topN 条 link
 *   - 一条 link 同时属于 sourceId 和 targetId 两个节点
 *   - 节点 A 挑中 link(L) ↔ 节点 B 也会"被动保留" link(L)
 *   - 所以最终每节点实际可能略高于 topN（其他节点挑中它时也算）
 *   - 这是可以接受的：实际平均 ~50-60 条/node，比当前 ~140 安全很多
 *
 * 算法 O(N)，无 O(N²)：
 *   - byNode Map<nodeId, link[]>：O(N)（每条 link 注册到 source 和 target 两个节点）
 *   - 每节点 sort + take topN：O(K log K)，K = 该节点关联 link 数
 *   - 总开销 ≈ O(N + Σ K_i log K_i)，27 万条几秒内跑完
 *
 * 不影响 memory_nodes / memory_vectors / messages / assets — 只裁 memory_links。
 * 弱关系被砍后，buildLinks 在后续 pipeline 跑时按规则自动重建。
 *
 * @param links 原始链接列表
 * @param topN 每个节点最多保留的关系数，默认 50
 * @param minStrength 阶段 1 弱 emotional 阈值，默认 0.3
 * @returns 裁剪后的链接列表
 */
export function pruneMemoryLinksByTopN(
    links: MemoryLink[],
    topN: number = 50,
    minStrength: number = 0.3,
): MemoryLink[] {
    // 阶段 1：先砍弱边 + 去重
    const base = pruneMemoryLinks(links, minStrength);

    // 阶段 2：按节点分组（一 link 属于 source 和 target 两个节点）
    const byNode = new Map<string, MemoryLink[]>();
    for (const link of base) {
        let listA = byNode.get(link.sourceId);
        if (!listA) {
            listA = [];
            byNode.set(link.sourceId, listA);
        }
        listA.push(link);
        let listB = byNode.get(link.targetId);
        if (!listB) {
            listB = [];
            byNode.set(link.targetId, listB);
        }
        listB.push(link);
    }

    // 每个节点挑 strength 最高的 topN
    const keepIds = new Set<string>();
    for (const nodeLinks of byNode.values()) {
        // sort by strength desc，topN 用 slice 拿
        // 节点关联数远小于总 link 数（平均 ~140），sort 开销可控
        nodeLinks.sort((a, b) => b.strength - a.strength);
        const take = Math.min(topN, nodeLinks.length);
        for (let i = 0; i < take; i++) {
            keepIds.add(nodeLinks[i].id);
        }
    }

    // 过滤输出
    return base.filter(l => keepIds.has(l.id));
}
