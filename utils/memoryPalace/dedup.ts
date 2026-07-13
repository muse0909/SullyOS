/**
 * Memory Palace — 查重工具
 *
 * 提供两个能力：
 *  1. findDuplicates — 对某角色的所有记忆跑两两 cosine 比对，返回相似度 ≥ 阈值的对
 *  2. filterByAccess — 按访问次数分档筛记忆（0 / 1-5 / 5+ / 全部）
 *
 * 性能考虑：
 *  - 不引入 web worker 复杂度，直接主线程跑（O(N²) 但按 room 分桶，N_b ≤ 200）
 *  - 同 room 的语义最可能重复，跨 room 的（如"客厅的加班"vs"书房的加班"）
 *    不应该合并，按 room 分桶天然过滤了
 *  - 用 id 字典 key 去重避免 (A,B)/(B,A) 报两次
 */

import { MemoryNodeDB, MemoryVectorDB, ensureFloat32 } from './db';
import { cosineSimilarity } from './embedding';
import type { MemoryNode, MemoryRoom } from './types';

// ─── 公开类型 ─────────────────────────────────────────

/** 用户可选的相似度阈值（UI 是下拉） */
export const DEDUP_THRESHOLDS = [0.75, 0.80, 0.85, 0.90] as const;
export type DedupThreshold = typeof DEDUP_THRESHOLDS[number];

/** 访问次数分档（用户说"档可以拉大点" → 0 / 1-5 / 5+） */
export type AccessRange = 'all' | 'zero' | 'low' | 'mid';

export const ACCESS_RANGES: { value: AccessRange; label: string; match: (n: number) => boolean }[] = [
    { value: 'all', label: '全部访问次数', match: () => true },
    { value: 'zero', label: '0 次（从未被召回）', match: n => n === 0 },
    { value: 'low', label: '1-5 次（低访问）', match: n => n >= 1 && n <= 5 },
    { value: 'mid', label: '5 次以上（高访问）', match: n => n > 5 },
];

export interface DuplicatePair {
    aId: string;
    bId: string;
    aContent: string;
    bContent: string;
    aRoom: MemoryRoom;
    bRoom: MemoryRoom;
    aAccess: number;
    bAccess: number;
    aCreatedAt: number;
    bCreatedAt: number;
    similarity: number;
}

// ─── 主体 ─────────────────────────────────────────────

/**
 * 找某角色所有"内容相似"的对。
 *
 * @param charId    角色 ID
 * @param threshold 相似度阈值（0.75 / 0.80 / 0.85 / 0.90）
 * @param options.roomFilter 只看某个房间的；'all' 或 undefined = 全部
 * @param options.accessRange 访问次数过滤；'all' 或 undefined = 全部
 * @param options.onProgress 进度回调（每跑完一个房间触发一次）
 *
 * @returns 按 similarity 降序的 DuplicatePair 列表
 */
export async function findDuplicates(
    charId: string,
    threshold: number,
    options?: {
        roomFilter?: MemoryRoom | 'all';
        accessRange?: AccessRange;
        onProgress?: (done: number, total: number) => void;
    },
): Promise<DuplicatePair[]> {
    const roomFilter = options?.roomFilter ?? 'all';
    const accessRange = options?.accessRange ?? 'all';
    const accessMatch = ACCESS_RANGES.find(r => r.value === accessRange)?.match ?? (() => true);

    // 1. 拿所有节点（按房间过滤）
    let nodes: MemoryNode[];
    if (roomFilter === 'all') {
        nodes = await MemoryNodeDB.getByCharId(charId);
    } else {
        nodes = await MemoryNodeDB.getByRoom(charId, roomFilter);
    }
    // 按访问次数过滤
    nodes = nodes.filter(n => accessMatch(n.accessCount ?? 0));
    // 必须有向量化（没向量的没法比）
    nodes = nodes.filter(n => n.embedded);

    if (nodes.length === 0) return [];

    // 2. 拿所有向量，按 memoryId 建字典
    const vectors = await MemoryVectorDB.getAllByCharId(charId);
    const vectorById = new Map(vectors.map(v => [v.memoryId, v]));
    // 过滤掉没向量的节点
    const validNodes = nodes.filter(n => vectorById.has(n.id));
    if (validNodes.length === 0) return [];

    // 3. 按 room 分桶（跨房间不参与比对——同语义不同分类的事不该合并）
    const byRoom = new Map<MemoryRoom, MemoryNode[]>();
    for (const n of validNodes) {
        const arr = byRoom.get(n.room) ?? [];
        arr.push(n);
        byRoom.set(n.room, arr);
    }
    const roomKeys = Array.from(byRoom.keys());
    const totalRooms = roomKeys.length;

    // 4. 桶内两两比
    const seen = new Set<string>();
    const results: DuplicatePair[] = [];

    for (let ri = 0; ri < roomKeys.length; ri++) {
        const room = roomKeys[ri];
        const bucket = byRoom.get(room)!;
        const m = bucket.length;
        options?.onProgress?.(ri, totalRooms);

        // 桶内两两：N² 但 N ≤ 200 时 ~40k 对，< 5s 可接受
        for (let i = 0; i < m; i++) {
            const a = bucket[i];
            const va = ensureFloat32(vectorById.get(a.id)!.vector);
            for (let j = i + 1; j < m; j++) {
                const b = bucket[j];
                const sim = cosineSimilarity(va, ensureFloat32(vectorById.get(b.id)!.vector));
                if (sim >= threshold) {
                    // 去重（理论上同 room 桶内不会 (A,B) (B,A)，但保险起见）
                    const key = a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    results.push({
                        aId: a.id,
                        bId: b.id,
                        aContent: a.content,
                        bContent: b.content,
                        aRoom: a.room,
                        bRoom: b.room,
                        aAccess: a.accessCount ?? 0,
                        bAccess: b.accessCount ?? 0,
                        aCreatedAt: a.createdAt,
                        bCreatedAt: b.createdAt,
                        similarity: sim,
                    });
                }
            }
        }
    }

    options?.onProgress?.(totalRooms, totalRooms);
    // 按相似度降序
    results.sort((x, y) => y.similarity - x.similarity);
    return results;
}

/**
 * 按访问次数分档筛记忆（不涉及向量）
 */
export function filterByAccess(
    nodes: MemoryNode[],
    range: AccessRange,
): MemoryNode[] {
    const match = ACCESS_RANGES.find(r => r.value === range)?.match ?? (() => true);
    return nodes.filter(n => match(n.accessCount ?? 0));
}
