/**
 * Memory Palace — EventBox 创建/合并/管理
 *
 * EventBox 把"同一件事"的多条记忆绑在一起。
 * 创建源：
 *  ① extraction LLM 输出 relatedTo + eventName/eventTags 时（自动）
 *  ② 用户在 UI 里"+ 添加关联"（手动）
 *
 * 召回时一旦命中盒内任一活节点，整盒（summary + 所有活节点）作为 1 个名额输出。
 * 见 ./formatter.ts 的 expandAndFormat。
 *
 * 压缩逻辑独立在 ./eventBoxCompression.ts。
 */

import type { EventBox, MemoryNode } from './types';
import { EVENT_BOX_LIVE_HARD_CAP } from './types';
import type { EventBoxHint } from './extraction';
import { EventBoxDB, MemoryNodeDB, MemoryLinkDB, MemoryVectorDB } from './db';
import { vectorizeAndStore } from './vectorStore';
import type { EmbeddingConfig } from './embedding';
import type { RemoteVectorConfig } from './supabaseVector';

// ─── ID 生成 ───────────────────────────────────────────

function generateBoxId(): string {
    return `eb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 内部 helpers ──────────────────────────────────────

function newEventBox(charId: string, name: string, tags: string[]): EventBox {
    const now = Date.now();
    return {
        id: generateBoxId(),
        charId,
        name: name || '未命名事件',
        tags: tags.slice(0, 20),
        summaryNodeId: null,
        liveMemoryIds: [],
        archivedMemoryIds: [],
        compressionCount: 0,
        createdAt: now,
        updatedAt: now,
        lastCompressedAt: null,
    };
}

/**
 * 把一组 memoryId 加入 box。会更新对应 MemoryNode.eventBoxId 并保存。
 * 已在 box 内（live 或 archived）的 ID 自动跳过。
 * 返回真实新增的 memoryId 列表。
 */
async function addMemoriesToBox(box: EventBox, memoryIds: string[]): Promise<string[]> {
    const inBox = new Set([...box.liveMemoryIds, ...box.archivedMemoryIds]);
    if (box.summaryNodeId) inBox.add(box.summaryNodeId);

    const newIds = memoryIds.filter(id => !inBox.has(id));
    if (newIds.length === 0) return [];

    for (const id of newIds) {
        const node = await MemoryNodeDB.getById(id);
        if (!node) continue;
        // 跳过已被其他 box 占用的（理论上调用方应已处理跨 box）
        if (node.eventBoxId && node.eventBoxId !== box.id) continue;
        node.eventBoxId = box.id;
        // 加入活池前确保不是 archived/summary 状态
        if (!node.isBoxSummary && !node.archived) {
            box.liveMemoryIds.push(id);
        } else if (node.archived) {
            box.archivedMemoryIds.push(id);
        }
        // summary 节点不加任何池（summaryNodeId 单独管理）
        await MemoryNodeDB.save(node);
    }

    box.updatedAt = Date.now();
    await EventBoxDB.save(box);
    return newIds;
}

/**
 * 合并多个 box → 一个主 box。
 * 主 box 选取：compressionCount 多者优先，同则 createdAt 早者。
 * 其他 box 的 summaryNode（如有）会被降级为主 box 的活节点（去掉 isBoxSummary 标记）。
 * 返回主 box。
 */
async function mergeBoxes(boxes: EventBox[]): Promise<EventBox> {
    if (boxes.length === 0) throw new Error('mergeBoxes: empty input');
    if (boxes.length === 1) return boxes[0];

    const sorted = [...boxes].sort((a, b) => {
        if (b.compressionCount !== a.compressionCount) return b.compressionCount - a.compressionCount;
        return a.createdAt - b.createdAt;
    });
    const primary = sorted[0];
    const others = sorted.slice(1);

    for (const other of others) {
        // 1. summary 节点：降级为主 box 的活节点
        if (other.summaryNodeId) {
            const sumNode = await MemoryNodeDB.getById(other.summaryNodeId);
            if (sumNode) {
                sumNode.isBoxSummary = false;
                sumNode.archived = false;
                sumNode.eventBoxId = primary.id;
                await MemoryNodeDB.save(sumNode);
                if (!primary.liveMemoryIds.includes(sumNode.id)) {
                    primary.liveMemoryIds.push(sumNode.id);
                }
            }
        }
        // 2. archived 节点
        for (const aId of other.archivedMemoryIds) {
            const n = await MemoryNodeDB.getById(aId);
            if (n) {
                n.eventBoxId = primary.id;
                await MemoryNodeDB.save(n);
            }
            if (!primary.archivedMemoryIds.includes(aId)) {
                primary.archivedMemoryIds.push(aId);
            }
        }
        // 3. live 节点
        for (const lId of other.liveMemoryIds) {
            const n = await MemoryNodeDB.getById(lId);
            if (n) {
                n.eventBoxId = primary.id;
                await MemoryNodeDB.save(n);
            }
            if (!primary.liveMemoryIds.includes(lId)) {
                primary.liveMemoryIds.push(lId);
            }
        }
        // 4. 删除 secondary
        await EventBoxDB.delete(other.id);
        console.log(`🔀 [EventBox] 合并 ${other.id} → ${primary.id}`);
    }

    // 主 box 保留原 name/tags（不被合并方覆盖；下次 compression 时 LLM 可重命名）
    primary.updatedAt = Date.now();
    await EventBoxDB.save(primary);
    return primary;
}

// ─── 公共 API ──────────────────────────────────────────

/**
 * 把一批 (newMemory, existingMemory) 关联整理成 EventBox。
 *
 * 处理规则（按 newMemoryId 分组逐个处理）：
 *  - 收集 newMemory 自身和所有 existingMemory 当前所属的 box（去重）
 *  - 0 个 box → 用 hint 创建新 box，把 newMemory + 所有 existing 都加进去
 *  - 1 个 box → 加入该 box（缺的成员补齐）
 *  - 2+ 个 box → 合并为 1 个，再加齐成员
 *
 * @returns 被触达（创建/加入/合并）的 box ID 集合（用于后续压缩判断）
 */
export async function bindMemoriesIntoEventBox(
    charId: string,
    links: { newMemoryId: string; existingMemoryId: string }[],
    hints: EventBoxHint[],
): Promise<Set<string>> {
    const touched = new Set<string>();
    if (links.length === 0) return touched;

    // 按 newMemoryId 分组
    const grouped = new Map<string, string[]>();
    for (const { newMemoryId, existingMemoryId } of links) {
        const arr = grouped.get(newMemoryId) || [];
        if (!arr.includes(existingMemoryId)) arr.push(existingMemoryId);
        grouped.set(newMemoryId, arr);
    }

    // 索引 hints
    const hintByNew = new Map<string, EventBoxHint>();
    for (const h of hints) hintByNew.set(h.newMemoryId, h);

    for (const [newId, existingIds] of grouped) {
        const newNode = await MemoryNodeDB.getById(newId);
        if (!newNode) continue;

        // 收集所有相关 box ID（含 newNode 自己的）
        const boxIds = new Set<string>();
        if (newNode.eventBoxId) boxIds.add(newNode.eventBoxId);
        const existingNodes: MemoryNode[] = [];
        for (const eId of existingIds) {
            const n = await MemoryNodeDB.getById(eId);
            if (n) {
                existingNodes.push(n);
                if (n.eventBoxId) boxIds.add(n.eventBoxId);
            }
        }

        // 加载候选 box，区分"可写（未封盒且未满活节点硬上限）"和"已封盒/满员"
        // 活节点硬上限：LLM 压缩连续失败会让盒子无限膨胀到 40+ 条，后果是再也压不动
        //（token 爆、LLM 卡、UI 冻）。到硬上限就当成封盒处理，后续记忆开新盒。
        const openBoxes: EventBox[] = [];
        const sealedBoxes: EventBox[] = [];
        const overflowBoxes: EventBox[] = [];
        for (const id of boxIds) {
            const b = await EventBoxDB.getById(id);
            if (!b) continue;
            if (b.sealed) sealedBoxes.push(b);
            else if (b.liveMemoryIds.length >= EVENT_BOX_LIVE_HARD_CAP) overflowBoxes.push(b);
            else openBoxes.push(b);
        }

        let target: EventBox;
        if (openBoxes.length === 0) {
            // 全部相关 box 都已封盒/满员（或本来就没盒）→ 新建一个盒
            // predecessorBoxId 优先取 sealed，其次 overflow（两者都算"前任"）
            const hint = hintByNew.get(newId);
            const prevPool = [...sealedBoxes, ...overflowBoxes];
            const predecessor = prevPool.length > 0
                ? prevPool.sort((a, b) => (b.lastCompressedAt || b.updatedAt) - (a.lastCompressedAt || a.updatedAt))[0]
                : null;
            target = newEventBox(
                charId,
                hint?.eventName || (predecessor?.name || ''),
                hint?.eventTags || (predecessor?.tags || []),
            );
            if (predecessor) {
                target.predecessorBoxId = predecessor.id;
                const reason = predecessor.sealed ? '已封盒' : `活节点达硬上限 ${EVENT_BOX_LIVE_HARD_CAP}`;
                console.log(`📦 [EventBox] 前任 ${predecessor.id} ${reason}，${target.id} 作为延续新建`);
            }
            await EventBoxDB.save(target);
            console.log(`📦 [EventBox] 新建 ${target.id} "${target.name}"（${existingNodes.length + 1} 条初始成员）`);
        } else if (openBoxes.length === 1) {
            target = openBoxes[0];
        } else {
            target = await mergeBoxes(openBoxes);
        }

        // 把 newNode + existing 全部加入（existing 里已在 sealed box 的那些跳过）
        const allIds = [newId, ...existingNodes
            .filter(n => !n.eventBoxId || !sealedBoxes.some(b => b.id === n.eventBoxId))
            .map(n => n.id)];
        await addMemoriesToBox(target, allIds);
        touched.add(target.id);
    }

    return touched;
}

/**
 * 用户手动把两条记忆绑成同一个 EventBox（替代旧的 causal MemoryLink 创建）。
 * 一条已在 box → 加入；两条都没 box → 建新盒；两条在不同 box → 合并。
 */
export async function manuallyBindMemories(
    charId: string,
    idA: string,
    idB: string,
    name?: string,
    tags?: string[],
): Promise<EventBox | null> {
    const touched = await bindMemoriesIntoEventBox(
        charId,
        [{ newMemoryId: idA, existingMemoryId: idB }],
        name ? [{ newMemoryId: idA, eventName: name, eventTags: tags || [] }] : [],
    );
    const [boxId] = touched;
    if (!boxId) return null;
    return (await EventBoxDB.getById(boxId)) || null;
}

/**
 * 把一条记忆从某 EventBox 中移出（恢复为独立记忆）。
 * 用于 UI 的"解除关联"或"复活归档项"场景。
 */
export async function removeMemoryFromBox(memoryId: string): Promise<void> {
    const node = await MemoryNodeDB.getById(memoryId);
    if (!node || !node.eventBoxId) return;
    const box = await EventBoxDB.getById(node.eventBoxId);
    if (!box) {
        node.eventBoxId = null;
        await MemoryNodeDB.save(node);
        return;
    }
    box.liveMemoryIds = box.liveMemoryIds.filter(id => id !== memoryId);
    box.archivedMemoryIds = box.archivedMemoryIds.filter(id => id !== memoryId);
    box.updatedAt = Date.now();
    if (box.summaryNodeId === memoryId) box.summaryNodeId = null;
    node.eventBoxId = null;
    node.archived = false;
    node.isBoxSummary = false;
    await MemoryNodeDB.save(node);

    // 空盒清理
    const empty = box.liveMemoryIds.length === 0
        && box.archivedMemoryIds.length === 0
        && !box.summaryNodeId;
    if (empty) {
        await EventBoxDB.delete(box.id);
    } else {
        await EventBoxDB.save(box);
    }
}

/**
 * 一键把某 box 的**所有活节点**移出，变成独立记忆（archived/summary 不动）。
 * 应急出口：LLM 压缩连续失败导致活节点堆到几十条时，用户可以一键清空活池，
 * 让那些记忆回到"地上"各自独立参与召回。
 *
 * 不删记忆本身。summary / archived 保持不动（它们已经是这段事件的历史印记）。
 * 如果清完后盒里啥也没剩（summary 也没有），会把空盒删掉。
 *
 * @returns 被移出的 memoryId 列表
 */
export async function unbindAllLiveMemories(boxId: string): Promise<string[]> {
    const box = await EventBoxDB.getById(boxId);
    if (!box) return [];
    const liveIds = box.liveMemoryIds.slice();
    if (liveIds.length === 0) return [];

    for (const id of liveIds) {
        const node = await MemoryNodeDB.getById(id);
        if (node) {
            node.eventBoxId = null;
            // archived 标记保持不动——活节点理应未归档，但保守处理
            await MemoryNodeDB.save(node);
        }
    }

    box.liveMemoryIds = [];
    box.updatedAt = Date.now();

    // 空盒清理：summary 也没有 && archived 为空 → 删除
    const empty = !box.summaryNodeId && box.archivedMemoryIds.length === 0;
    if (empty) {
        await EventBoxDB.delete(box.id);
        console.log(`🧹 [EventBox] ${box.id} 活池清空后整盒为空，已删除`);
    } else {
        await EventBoxDB.save(box);
        console.log(`🧹 [EventBox] ${box.id} 清空活池：移出 ${liveIds.length} 条活节点`);
    }

    return liveIds;
}

/**
 * 复活一条 archived 记忆（重新参与召回）。
 * 不会自动重压缩，下次 4 条阈值时会再次触发。
 */
export async function reviveArchivedMemory(memoryId: string): Promise<void> {
    const node = await MemoryNodeDB.getById(memoryId);
    if (!node || !node.archived) return;
    node.archived = false;
    await MemoryNodeDB.save(node);
    if (node.eventBoxId) {
        const box = await EventBoxDB.getById(node.eventBoxId);
        if (box) {
            box.archivedMemoryIds = box.archivedMemoryIds.filter(id => id !== memoryId);
            if (!box.liveMemoryIds.includes(memoryId)) {
                box.liveMemoryIds.push(memoryId);
            }
            box.updatedAt = Date.now();
            await EventBoxDB.save(box);
        }
    }
}

/**
 * 真合并模式：把两条重复记忆合并成一条，删另一条。
 * 区别于 `manuallyBindMemories`（仅绑到同一事件盒，两条都保留）。
 *
 * 三种 mode：
 *  - 'keep_a'：保留 keep，删 drop（keep 不变）
 *  - 'keep_b'：保留 drop，删 keep（drop 不变）—— 调用方应自己把 keepId / dropId 对调
 *  - 'concat'：保留 keep，删 drop，keep.content = keep.content + "\n" + drop.content
 *              tags 去重并集、importance 取 max、mood 保持 keep 的
 *              触发 keep.embedded=false，async 重跑 embedding
 *
 * 删除走完整清理：解绑 EventBox → 清 vec → 清 links → 删 node
 * （与 DedupeView 的 handleBatchCleanDelete 同款）
 */
export type RealMergeMode = 'keep_a' | 'keep_b' | 'concat';

export async function realMergeMemories(
    charId: string,
    keepId: string,
    dropId: string,
    mode: RealMergeMode,
    options?: {
        embeddingConfig?: EmbeddingConfig;
        remoteVectorConfig?: RemoteVectorConfig;
    },
): Promise<{ merged: boolean; reason?: string; keepNode?: MemoryNode }> {
    if (keepId === dropId) return { merged: false, reason: 'keep 和 drop 是同一条记忆' };
    const keep = await MemoryNodeDB.getById(keepId);
    const drop = await MemoryNodeDB.getById(dropId);
    if (!keep || !drop) return { merged: false, reason: '记忆不存在' };

    let mergedNode: MemoryNode = { ...keep };

    if (mode === 'concat') {
        const dropContent = drop.content.trim();
        const keepContent = keep.content.trim();
        if (dropContent && !keepContent.includes(dropContent)) {
            mergedNode.content = keepContent
                ? `${keepContent}\n${dropContent}`
                : dropContent;
        }
        // tags 去重并集
        const tagSet = new Set([...keep.tags, ...drop.tags]);
        mergedNode.tags = Array.from(tagSet);
        // importance 取 max
        mergedNode.importance = Math.max(keep.importance, drop.importance);
        // mood 保持 keep 的
        // room 保持 keep 的
        // content 变了 → 标记为待重跑
        mergedNode.embedded = false;
        mergedNode.lastAccessedAt = Date.now();
    } else if (mode === 'keep_b') {
        // 调用方传参错位：理论不该走到这，但容错
        mergedNode = { ...drop, id: keepId };
        mergedNode.embedded = false;
    }
    // 'keep_a' 模式：mergedNode 直接是 keep，无需改

    // 1. 保存 keep 节点的最终状态（concat 模式重设了 content/importance/tags）
    await MemoryNodeDB.save(mergedNode);

    // 2. 解绑 drop 的 EventBox
    try { await removeMemoryFromBox(dropId); } catch { /* 可能没绑 box */ }

    // 3. 清 drop 的向量
    try { await MemoryVectorDB.delete(dropId); } catch { /* 可能没向量 */ }

    // 4. 清 drop 的所有链接
    const dropLinks = await MemoryLinkDB.getByNodeId(dropId);
    for (const l of dropLinks) {
        try { await MemoryLinkDB.delete(l.id); } catch { /* ignore */ }
    }

    // 5. 删 drop 节点
    await MemoryNodeDB.delete(dropId);

    // 6. concat 模式触发重跑 embedding
    if (mode === 'concat' && options?.embeddingConfig?.baseUrl && options.embeddingConfig.apiKey) {
        try {
            const result = await vectorizeAndStore(
                [mergedNode],
                options.embeddingConfig,
                options.remoteVectorConfig,
                { skipDedup: true }
            );
            if (result.stored > 0) {
                mergedNode.embedded = true;
                await MemoryNodeDB.save(mergedNode);
            }
        } catch (e: any) {
            console.warn(`🔀 [RealMerge] 重跑 embedding 失败（节点已合并，embedded 保持 false）：${e?.message || e}`);
        }
    }

    console.log(`🔀 [RealMerge] ${keepId} + ${dropId} → 模式 ${mode}，已合并并清理 drop 的 vec/links/node`);
    return { merged: true, keepNode: mergedNode };
}

// ─── 公共 API：节点清理链 + 盒级批量操作 ───────────────────

/**
 * 完整清理一条记忆节点：解绑 box → 清关联 → 清本地 vec → 同步远程 vec → 删 node。
 * 任何一步失败都吞掉异常继续往下走，避免半清理状态。
 * 危险点：远程 vec 删除是 fire-and-forget，UI 不能阻塞等结果。
 */
export async function deleteMemoryNode(
    nodeId: string,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<void> {
    try { await removeMemoryFromBox(nodeId); } catch { /* 可能没绑 box */ }
    const links = await MemoryLinkDB.getByNodeId(nodeId);
    for (const l of links) {
        try { await MemoryLinkDB.delete(l.id); } catch { /* ignore */ }
    }
    try { await MemoryVectorDB.delete(nodeId); } catch { /* 可能没 vec */ }
    if (remoteVectorConfig?.enabled && remoteVectorConfig.initialized) {
        // 远程 vec 同步走 fire-and-forget，跟 realMergeMemories 一致
        import('./supabaseVector').then(({ deleteVector }) =>
            deleteVector(remoteVectorConfig, nodeId).catch(() => {})
        );
    }
    await MemoryNodeDB.delete(nodeId);
}

/**
 * 解散一个 EventBox：
 *  - summary 节点走完整清理链（删 node + 清 vec + 远程同步）
 *  - archived 节点全部复活到"地上"（archived=false, eventBoxId=null），vec 保留 → 各自独立召回
 *  - live 节点全部释放到"地上"（eventBoxId=null），vec 保留
 *  - 盒记录删除
 * 召回效果：原本 1 条 summary 命中的场景，改为命中各自独立记忆时只召回那 1 条。
 */
export async function dissolveEventBox(
    boxId: string,
    options?: { remoteVectorConfig?: RemoteVectorConfig },
): Promise<{
    dissolved: boolean;
    releasedArchived: number;
    releasedLive: number;
    deletedSummary: boolean;
    error?: string;
}> {
    const box = await EventBoxDB.getById(boxId);
    if (!box) {
        return { dissolved: false, releasedArchived: 0, releasedLive: 0, deletedSummary: false, error: 'box 不存在' };
    }

    if (box.summaryNodeId) {
        await deleteMemoryNode(box.summaryNodeId, options?.remoteVectorConfig);
    }

    let releasedArchived = 0;
    for (const id of box.archivedMemoryIds) {
        const node = await MemoryNodeDB.getById(id);
        if (!node) continue;
        node.archived = false;
        node.eventBoxId = null;
        await MemoryNodeDB.save(node);
        releasedArchived++;
    }

    let releasedLive = 0;
    for (const id of box.liveMemoryIds) {
        const node = await MemoryNodeDB.getById(id);
        if (!node) continue;
        node.eventBoxId = null;
        await MemoryNodeDB.save(node);
        releasedLive++;
    }

    await EventBoxDB.delete(boxId);

    console.log(`💥 [EventBox] 解散 ${boxId}：summary ${box.summaryNodeId ? '已删' : '无'}，archived 复活 ${releasedArchived}，live 释放 ${releasedLive}`);
    return { dissolved: true, releasedArchived, releasedLive, deletedSummary: !!box.summaryNodeId };
}

/**
 * 把盒内所有 archived 节点一键复活到活池，盒本身保留。
 * 区别于 dissolveEventBox：这里盒还在，只是不再有"压入 summary 不召回"的 archived。
 * 危险点：archived 复活后 vec 不动，archived=false 是 metadata 标记。
 */
export async function reviveAllArchivedInBox(boxId: string): Promise<{ revived: number; error?: string }> {
    const box = await EventBoxDB.getById(boxId);
    if (!box) return { revived: 0, error: 'box 不存在' };

    let revived = 0;
    for (const id of box.archivedMemoryIds) {
        const node = await MemoryNodeDB.getById(id);
        if (!node) continue;
        node.archived = false;
        await MemoryNodeDB.save(node);
        // box 内部列表：archived → live
        if (!box.liveMemoryIds.includes(id)) {
            box.liveMemoryIds.push(id);
        }
        revived++;
    }
    box.archivedMemoryIds = [];
    box.updatedAt = Date.now();
    await EventBoxDB.save(box);

    console.log(`🌅 [EventBox] ${boxId} 一键复活 ${revived} 条 archived → live`);
    return { revived };
}
