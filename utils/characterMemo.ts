/**
 * 角色备忘录（CharacterMemo）— 暮色 9-5 指令
 *
 * 江澈 2026-09-05 指令（暮色从江澈那收到后转交给麦麦实现）：
 *   暮色 9-5 进一步要求（暮色 9-5 20:32 改）：
 *   - **结构独立分离**：状态面板 + 备忘录条目 两个独立模块
 *   - 状态面板 = 5 个固定槽（location/health/schedule/mood/reminder）整体覆盖
 *   - 备忘录条目 = 重点事件（5 条滚动） + 私人笔记（不限）
 *   - 两个模块**数据结构 + 更新逻辑解耦**
 *
 * 麦麦 2026-09-05 重构：
 *   - 状态面板拆成独立 IDB store: character_status_panels（按 charId 唯一）
 *   - 备忘录 IDB store: character_memos（剩 event + private 2 种 region）
 *   - 状态面板走 setStatusSlot(charId, slot, value) 整体覆盖
 *   - 备忘录走 addMemo / editMemo / deleteMemo（不变）
 */

import { DB } from './db';
import type {
    CharacterMemo,
    CharacterMemoEntry,
    CharacterMemoRegion,
    CharacterStatusPanel,
    CharacterStatusSlot,
} from '../types';

const REGION_ORDER: Record<CharacterMemoRegion, number> = {
    event: 0,
    private: 1,
};

const MAX_ENTRIES = 30;            // memo 合计上限
const MAX_EVENT_ENTRIES = 5;       // event 区滚动上限
const DEFAULT_REGION_LABELS: Record<CharacterMemoRegion, string> = {
    event: '最近重点事件',
    private: '私人笔记',
};

const DEFAULT_STATUS_LABELS: Record<CharacterStatusSlot, string> = {
    location: '所在地',
    health: '身体',
    schedule: '在忙',
    mood: '情绪',
    reminder: '约定/待办',
};

// ==================== 状态面板 ====================

/** 取状态面板（不存在就返回空骨架） */
export async function getStatusPanel(charId: string): Promise<CharacterStatusPanel> {
    const existing = await DB.getCharacterStatusPanel(charId);
    if (existing) return existing;
    return {
        charId,
        slots: {},
        updatedAt: Date.now(),
    };
}

/** 整体覆盖单个槽 */
export async function setStatusSlot(
    charId: string,
    slot: CharacterStatusSlot,
    value: string
): Promise<CharacterStatusPanel> {
    const panel = await getStatusPanel(charId);
    panel.slots[slot] = value.trim();
    panel.updatedAt = Date.now();
    await DB.saveCharacterStatusPanel(panel);
    return panel;
}

/** 清空单个槽（传空字符串 = 删除） */
export async function clearStatusSlot(
    charId: string,
    slot: CharacterStatusSlot
): Promise<CharacterStatusPanel> {
    const panel = await getStatusPanel(charId);
    delete panel.slots[slot];
    panel.updatedAt = Date.now();
    await DB.saveCharacterStatusPanel(panel);
    return panel;
}

/** 状态面板拼成 prompt 文本（5 个固定槽，没值就显示空槽提示） */
export function formatStatusPanelForPrompt(panel: CharacterStatusPanel | null | undefined): string {
    if (!panel) return '';
    const slotOrder: CharacterStatusSlot[] = ['location', 'health', 'schedule', 'mood', 'reminder'];
    const lines: string[] = [];
    let hasAny = false;
    for (const slot of slotOrder) {
        const v = panel.slots[slot];
        if (v && v.trim()) {
            hasAny = true;
        }
    }
    if (!hasAny) return '';
    lines.push('【当前状态面板 (Status Panel)】');
    lines.push('以下是你最近的状态（暮色 9-5 让你自己维护，单条整体覆盖）。');
    lines.push('');
    for (const slot of slotOrder) {
        const v = panel.slots[slot];
        if (v && v.trim()) {
            lines.push(`- ${DEFAULT_STATUS_LABELS[slot]}: ${v}`);
        }
    }
    return lines.join('\n');
}

// ==================== 备忘录条目（event + private） ====================

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
    // 区域 event 超 5 条 — 按 updatedAt 淘汰最老的
    const eventEntries = memo.entries.filter((e) => e.region === 'event')
        .sort((a, b) => a.updatedAt - b.updatedAt);
    if (eventEntries.length > MAX_EVENT_ENTRIES) {
        const toEvictIds = new Set(eventEntries.slice(0, eventEntries.length - MAX_EVENT_ENTRIES).map((e) => e.id));
        memo.entries = memo.entries.filter((e) => !toEvictIds.has(e.id));
    }
    // 合计超 30 — 按 updatedAt 淘汰最老的
    const evictable = memo.entries
        .slice()
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

/** memo 拼成 prompt 文本（按 region 分组，event 在前、private 在后） */
export function formatMemoForPrompt(memo: CharacterMemo | null | undefined): string {
    if (!memo || memo.entries.length === 0) return '';
    const sorted = sortEntries(memo.entries);
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        event: [],
        private: [],
    };
    for (const e of sorted) byRegion[e.region].push(e);

    const lines: string[] = [];
    for (const region of ['event', 'private'] as CharacterMemoRegion[]) {
        const items = byRegion[region];
        if (items.length === 0) continue;
        lines.push(`【${DEFAULT_REGION_LABELS[region]}】`);
        lines.push('以下是你想记住的事（暮色 9-5 让你自己维护，重点事件最多 5 条，私人笔记不限）。');
        lines.push('');
        for (const item of items) {
            lines.push(`#${item.id} ${item.content}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}

// ==================== 导出 ====================

export const REGION_LABELS = DEFAULT_REGION_LABELS;
export const STATUS_LABELS = DEFAULT_STATUS_LABELS;
