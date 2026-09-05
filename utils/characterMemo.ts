/**
 * 角色备忘录 (CharacterMemo)
 *
 * 江澈 2026-09-05 指令（暮色从江澈那收到后转交给麦麦实现）：
 *   - 三区域：status（状态面板，从 memoryPalace.statusPanel 迁过来）/
 *             event（最近重点事件，5 条以内，滚动更新）/
 *             private（私人笔记）
 *   - 30 条上限 = 三区域合计
 *   - 角色（AI）通过聊天回复里输出 [[MEMO_ADD|EDIT|DEL:...]] token 维护
 *   - 暮色（用户）只读，不能编辑
 *   - 注入：每次拼提示词时全量注入（30 条以内不长），放在 BP3 记忆宫殿之前
 *
 * 麦麦 2026-09-05 落地方案：
 *   - IDB store: character_memos（keyPath: charId）
 *   - 角色写：chatParser 解析 token → 调 add/edit/deleteMemo
 *   - 暮色读：useCharacterMemo hook + DiscoverPage 只读展示
 *   - 状态面板：memoryPalace.statusPanel 迁过来后，旧的 panel store 标记 deprecated
 */

import { DB } from './db';
import type { CharacterMemo, CharacterMemoEntry, CharacterMemoRegion } from '../types';

const REGION_ORDER: Record<CharacterMemoRegion, number> = {
    status: 0,
    event: 1,
    private: 2,
};

const MAX_ENTRIES = 30;            // 三区域合计上限
const MAX_EVENT_ENTRIES = 5;       // 区域二（event）滚动上限
const DEFAULT_REGION_LABELS: Record<CharacterMemoRegion, string> = {
    status: '状态面板',
    event: '最近重点事件',
    private: '私人笔记',
};

/** 取一份（不存在就返回空骨架） */
export async function getMemo(charId: string): Promise<CharacterMemo> {
    const existing = await DB.getCharacterMemo(charId);
    if (existing) return existing;
    return {
        charId,
        entries: [],
        nextId: 1,
        updatedAt: Date.now(),
    };
}

/** 按区域排序后的 entries */
export function sortEntries(entries: CharacterMemoEntry[]): CharacterMemoEntry[] {
    return [...entries].sort((a, b) => {
        const r = REGION_ORDER[a.region] - REGION_ORDER[b.region];
        if (r !== 0) return r;
        // 同区域按 updatedAt 倒序（最新在前）
        return b.updatedAt - a.updatedAt;
    });
}

/** 添加一条（ID 自增，超 30 条按 updatedAt 淘汰老的） */
export async function addMemo(
    charId: string,
    region: CharacterMemoRegion,
    content: string
): Promise<CharacterMemoEntry> {
    const memo = await getMemo(charId);
    const now = Date.now();
    const entry: CharacterMemoEntry = {
        id: memo.nextId,
        charId,
        region,
        content: content.trim(),
        createdAt: now,
        updatedAt: now,
    };
    memo.nextId += 1;
    memo.entries.push(entry);
    // 区域二（event）超 5 条 — 按 updatedAt 淘汰最老的
    const eventEntries = memo.entries.filter((e) => e.region === 'event')
        .sort((a, b) => a.updatedAt - b.updatedAt);
    if (eventEntries.length > MAX_EVENT_ENTRIES) {
        const toEvictIds = new Set(eventEntries.slice(0, eventEntries.length - MAX_EVENT_ENTRIES).map((e) => e.id));
        memo.entries = memo.entries.filter((e) => !toEvictIds.has(e.id));
    }
    // 三区域合计超 30 — 按 updatedAt 淘汰最老的（非 status，因为状态是当前态）
    const evictable = memo.entries
        .filter((e) => e.region !== 'status')
        .sort((a, b) => a.updatedAt - b.updatedAt);
    if (memo.entries.length > MAX_ENTRIES) {
        const overage = memo.entries.length - MAX_ENTRIES;
        const toEvictIds = new Set(evictable.slice(0, overage).map((e) => e.id));
        memo.entries = memo.entries.filter((e) => !toEvictIds.has(e.id));
    }
    memo.updatedAt = now;
    memo.entries = sortEntries(memo.entries);
    await DB.saveCharacterMemo(memo);
    return entry;
}

/** 修改一条（按 ID） */
export async function editMemo(
    charId: string,
    id: number,
    newContent: string
): Promise<CharacterMemoEntry | null> {
    const memo = await getMemo(charId);
    const target = memo.entries.find((e) => e.id === id);
    if (!target) return null;
    target.content = newContent.trim();
    target.updatedAt = Date.now();
    memo.updatedAt = target.updatedAt;
    memo.entries = sortEntries(memo.entries);
    await DB.saveCharacterMemo(memo);
    return target;
}

/** 删除一条（按 ID） */
export async function deleteMemo(
    charId: string,
    id: number
): Promise<boolean> {
    const memo = await getMemo(charId);
    const before = memo.entries.length;
    memo.entries = memo.entries.filter((e) => e.id !== id);
    if (memo.entries.length === before) return false;
    memo.updatedAt = Date.now();
    await DB.saveCharacterMemo(memo);
    return true;
}

/** 拼成纯文本注入 prompt（暮色定的"分区显示"） */
export function formatMemoForPrompt(memo: CharacterMemo | null | undefined): string {
    if (!memo || memo.entries.length === 0) return '';
    const sorted = sortEntries(memo.entries);
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        status: [],
        event: [],
        private: [],
    };
    for (const e of sorted) byRegion[e.region].push(e);

    const lines: string[] = [];
    for (const region of ['status', 'event', 'private'] as CharacterMemoRegion[]) {
        const items = byRegion[region];
        if (items.length === 0) continue;
        lines.push(`【${DEFAULT_REGION_LABELS[region]}】`);
        for (const item of items) {
            lines.push(`#${item.id} ${item.content}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}

/** 区域中文 label（UI 用） */
export const REGION_LABELS = DEFAULT_REGION_LABELS;
