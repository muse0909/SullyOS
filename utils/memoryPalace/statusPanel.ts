/**
 * 状态面板 — 替代旧的便利贴（pinDays）机制。
 *
 * 旧机制：每条 MemoryNode 带一个 pinnedUntil 字段，到期自动解 pin。
 * 新机制：全局 5 个固定槽位的键值对（location / health / schedule / mood / reminder），
 *        LLM 提取时按槽位粒度判断变化，每次只覆盖有变化的那一格。
 *        跨设备/跨角色共享同一份面板（per-user，非 per-character）。
 *
 * 存储：localStorage（单条 key-value，无需独立 IDB store）。
 * 持久化：本地优先；云端同步由后续需求决定。
 */

import type { MemoryNode } from './types';

const STORAGE_KEY = 'user_status_panel';
const PINNED_CLEARED_FLAG = 'user_status_panel_pinned_cleared_v1';

/** 状态面板的 5 个固定槽位 */
export const STATUS_SLOTS = [
    'location',   // 所在地
    'health',     // 身体
    'schedule',   // 在忙
    'mood',       // 情绪
    'reminder',   // 约定/待办
] as const;

export type StatusSlot = typeof STATUS_SLOTS[number];

/** 当前生效的状态面板（键值对；缺位 = 未设置） */
export type UserStatusPanel = Partial<Record<StatusSlot, string>>;

/** LLM 提取时输出的 statusUpdate：
 *  - 整体 null = 整批对话无变化，不动
 *  - 某槽位 null = 该槽位无变化，不动
 *  - 某槽位 "[清除]" = 显式清除该槽位
 *  - 某槽位 字符串 = 覆盖该槽位 */
export type StatusSlotUpdate = string | null;
export type StatusUpdate = Partial<Record<StatusSlot, StatusSlotUpdate>> | null;

/** 哨兵值：LLM 用此字符串显式清除某槽位 */
export const STATUS_PANEL_CLEAR = '[清除]';

const SLOT_LABELS: Record<StatusSlot, string> = {
    location: '所在地',
    health: '身体',
    schedule: '在忙',
    mood: '情绪',
    reminder: '约定',
};

// ─── localStorage 读写 ─────────────────────────────────

function readPanel(): UserStatusPanel {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const panel: UserStatusPanel = {};
        for (const slot of STATUS_SLOTS) {
            const v = (parsed as any)[slot];
            if (typeof v === 'string' && v.length > 0) panel[slot] = v;
        }
        return panel;
    } catch {
        return {};
    }
}

function writePanel(panel: UserStatusPanel): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(panel));
    } catch (e) {
        console.warn('[StatusPanel] localStorage write failed:', e);
    }
}

/** 读取当前状态面板 */
export function getStatusPanel(): UserStatusPanel {
    return readPanel();
}

/** 直接覆盖整个状态面板（暮色手动编辑保存用）。
 *  - 传 5 槽位的 object，缺位 = 清除
 *  - 与 applyStatusUpdate（LLM 增量更新）区分，这个是"全量替换"
 *  - 不会触发任何副作用，单纯写 localStorage */
export function setStatusPanel(panel: UserStatusPanel): void {
    const clean: UserStatusPanel = {};
    for (const slot of STATUS_SLOTS) {
        const v = panel[slot];
        if (typeof v === 'string' && v.length > 0) clean[slot] = v;
    }
    writePanel(clean);
}

// ─── 提取端：把 LLM 的 statusUpdate 应用到面板 ─────────

/**
 * 应用一次 LLM 提取的 statusUpdate 到存储。
 *  - update === null → 不动
 *  - 某槽位 null/undefined → 不动
 *  - 某槽位 "[清除]" → 删除该槽位
 *  - 某槽位 字符串 → 覆盖
 *  返回应用后的最新面板。
 */
export function applyStatusUpdate(update: StatusUpdate): UserStatusPanel {
    if (update == null) return readPanel();
    const panel = readPanel();
    let changed = false;
    for (const slot of STATUS_SLOTS) {
        const v = update[slot];
        if (v == null) continue;
        if (v === STATUS_PANEL_CLEAR) {
            if (slot in panel) {
                delete panel[slot];
                changed = true;
            }
        } else if (typeof v === 'string') {
            if (panel[slot] !== v) {
                panel[slot] = v;
                changed = true;
            }
        }
    }
    if (changed) writePanel(panel);
    return panel;
}

// ─── 注入端：把面板拼成 prompt 文本 ────────────────────

/** 拼接 [所在地] xxx | [身体] xxx | ... 一行；全空返回 '' */
export function buildStatusPanelLine(panel: UserStatusPanel): string {
    const parts: string[] = [];
    for (const slot of STATUS_SLOTS) {
        const v = panel[slot];
        if (typeof v === 'string' && v.length > 0) {
            parts.push(`[${SLOT_LABELS[slot]}] ${v}`);
        }
    }
    return parts.join(' | ');
}

/** 提取端 system prompt 用的区块（带 markdown 标题，供 LLM 看到当前面板以判断变化） */
export function buildStatusPanelSectionForExtraction(panel: UserStatusPanel): string {
    const line = buildStatusPanelLine(panel);
    if (!line) return '';
    return `\n## 当前状态面板（供你判断本轮是否有变化；statusUpdate 整批无变化时填 null）\n${line}\n`;
}

/** 注入端（formatter）用的区块（带 📌 标题，注入在记忆宫殿最前面） */
export function buildStatusPanelSectionForInjection(panel: UserStatusPanel): string {
    const line = buildStatusPanelLine(panel);
    if (!line) return '';
    return `📌 当前状态面板\n${line}\n\n`;
}

// ─── 一次性迁移：把旧便利贴全部解 pin ─────────────────

/** 一次性扫描所有角色的记忆节点，把 pinnedUntil > now 的全部置 null。
 *  用 localStorage flag 标记已执行，保证只跑一次。 */
let ensurePromise: Promise<void> | null = null;

export function ensureLegacyPinnedCleared(): Promise<void> {
    if (ensurePromise) return ensurePromise;
    ensurePromise = (async () => {
        try {
            if (localStorage.getItem(PINNED_CLEARED_FLAG) === '1') return;
            const { clearedCount } = await clearAllPinnedMemories();
            localStorage.setItem(PINNED_CLEARED_FLAG, '1');
            if (clearedCount > 0) {
                console.log(`🧹 [StatusPanel] 一次性解 pin ${clearedCount} 条老便利贴`);
            }
        } catch (e) {
            console.warn('[StatusPanel] legacy pinned clear failed:', e);
            // 失败时重置 promise，下一次重试
            ensurePromise = null;
        }
    })();
    return ensurePromise;
}

async function clearAllPinnedMemories(): Promise<{ clearedCount: number }> {
    // 动态 import 避免循环：statusPanel → memoryPalace/db → openDB → utils/db
    const { MemoryNodeDB } = await import('./db');
    const { DB } = await import('../db');
    const chars = await DB.getAllCharacters();
    const now = Date.now();
    let cleared = 0;
    for (const char of chars) {
        // 老数据可能带 pinnedUntil 字段（已从 MemoryNode 类型移除），cast 后做一次性清理
        const nodes = (await MemoryNodeDB.getByCharId(char.id)) as Array<MemoryNode & { pinnedUntil?: number | null }>;
        const pinned = nodes.filter(n => n.pinnedUntil && n.pinnedUntil > now);
        if (pinned.length === 0) continue;
        const updated: MemoryNode[] = pinned.map(({ pinnedUntil: _pu, ...rest }) => rest as MemoryNode);
        await MemoryNodeDB.saveMany(updated);
        cleared += updated.length;
    }
    return { clearedCount: cleared };
}
