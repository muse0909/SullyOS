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
    permanent: 2,
};

const MAX_ENTRIES = 50;            // 麦麦 2026-09-28：暮色从 30 调到 50（非永久区合计上限）
const MAX_EVENT_ENTRIES = 10;      // 麦麦 2026-09-28：暮色从 5 调到 10
const DEFAULT_REGION_LABELS: Record<CharacterMemoRegion, string> = {
    event: '最近重点事件',
    private: '私人笔记',
    // 麦麦 2026-09-28：新增"核心约定"区（permanent）
    //   暮色手动"永久保存"或 AI 直接 [[MEMO_ADD: permanent|...]] 写入
    //   不参与任何淘汰；AI 能编辑不能删除
    permanent: '核心约定',
};

const DEFAULT_STATUS_LABELS: Record<CharacterStatusSlot, string> = {
    location: '所在地',
    health: '身体',
    schedule: '在忙',
    mood: '情绪',
    reminder: '约定/待办',
    // 麦麦 2026-09-06 16:43：暮色要求"在状态面板再增加一格，写最近发生的重要的事，比如吵架什么的"
    recent: '最近关系事件',
};

// ==================== 状态面板 ====================

/**
 * 麦麦 2026-09-06：派发 memo-updated 事件，通知 UI（CharacterMemoPage）重新读 IDB
 *   暮色 9-6 反馈：APK 端写完不显示——因为 addMemo/setStatusSlot 只写 IDB，
 *   CharacterMemoPage 的 useEffect([activeCharId]) 不会因 IDB 变化而重新读。
 *   派发 CustomEvent 触发主动重读。
 *   带 charId 字段，UI 端按需重读（多角色场景只刷一个）。
 */
function emitMemoUpdated(charId: string, kind: 'status' | 'memo' | 'both') {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(new CustomEvent('memo-updated', {
            detail: { charId, kind }
        }));
    } catch { /* SSR / 非浏览器环境安全 */ }
}

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
    emitMemoUpdated(charId, 'status');  // 麦麦 2026-09-06：通知 UI 重新读
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
    emitMemoUpdated(charId, 'status');  // 麦麦 2026-09-06：通知 UI 重新读
    return panel;
}

/** 状态面板拼成 prompt 文本（5 个固定槽，没值就显示空槽提示） */
export function formatStatusPanelForPrompt(panel: CharacterStatusPanel | null | undefined): string {
    if (!panel) return '';
    const slotOrder: CharacterStatusSlot[] = ['location', 'health', 'schedule', 'mood', 'reminder', 'recent'];
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

/**
 * 添加一条（ID 自增，超上限按 updatedAt 淘汰老的）
 * 麦麦 2026-09-28：暮色反馈"图上 5 条完全一样的写入"——
 *   1. 完全相同内容 → 丢弃
 *   2. 关键词袋相似度 ≥ 0.7 → 视为重复，丢弃
 *   3. permanent 区绕开所有上限淘汰
 *   4. 上限调整为：重点事件 10 条、非永久区合计 50 条
 */
export async function addMemo(
    charId: string,
    region: CharacterMemoRegion,
    content: string
): Promise<CharacterMemoEntry | null> {
    const memo = await getMemo(charId);
    const now = Date.now();
    const trimmedContent = content.trim();

    // 麦麦 2026-09-28：去重中档 — 完全相同 + 关键词袋相似度 70%
    // 拿最近 10 条（按 updatedAt 倒序）作为比对基准
    const recentEntries = memo.entries
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10);

    // 1. 完全相同 → 直接丢弃
    const exactDup = recentEntries.find((e) => e.content === trimmedContent);
    if (exactDup) {
        console.log(`📝 [Memo] 去重命中（完全相同） #${exactDup.id} (char=${charId})`);
        return null;
    }

    // 2. 关键词袋相似度 ≥ 0.7 → 视为重复，丢弃
    const newTokens = tokenize(trimmedContent);
    for (const old of recentEntries.slice(0, 5)) {
        const oldTokens = tokenize(old.content);
        const sim = jaccard(newTokens, oldTokens);
        if (sim >= SIMILARITY_THRESHOLD) {
            console.log(`📝 [Memo] 去重命中（相似度 ${sim.toFixed(2)}） #${old.id} (char=${charId})`);
            return null;
        }
    }

    const entry: CharacterMemoEntry = {
        id: memo.nextId,
        charId,
        region,
        content: trimmedContent,
        createdAt: now,
        updatedAt: now,
    };
    memo.nextId += 1;
    memo.entries.push(entry);
    // 麦麦 2026-09-28：permanent 绕开所有淘汰
    //   重点事件超 10 条 — 按 updatedAt 淘汰最老的
    const eventEntries = memo.entries.filter((e) => e.region === 'event')
        .sort((a, b) => a.updatedAt - b.updatedAt);
    if (eventEntries.length > MAX_EVENT_ENTRIES) {
        const toEvictIds = new Set(eventEntries.slice(0, eventEntries.length - MAX_EVENT_ENTRIES).map((e) => e.id));
        memo.entries = memo.entries.filter((e) => !toEvictIds.has(e.id));
    }
    // 合计非永久区超 50 — 按 updatedAt 淘汰最老的（permanent 不算入）
    const evictable = memo.entries
        .filter((e) => e.region !== 'permanent')
        .slice()
        .sort((a, b) => a.updatedAt - b.updatedAt);
    if (evictable.length > MAX_ENTRIES) {
        const overage = evictable.length - MAX_ENTRIES;
        const toEvictIds = new Set(evictable.slice(0, overage).map((e) => e.id));
        memo.entries = memo.entries.filter((e) => !toEvictIds.has(e.id));
    }
    memo.updatedAt = now;
    memo.entries = sortEntries(memo.entries);
    await DB.saveCharacterMemo(memo);
    emitMemoUpdated(charId, 'memo');  // 麦麦 2026-09-06：通知 UI 重新读
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
    emitMemoUpdated(charId, 'memo');  // 麦麦 2026-09-06：通知 UI 重新读
    return target;
}

/**
 * 删除一条（按 ID）
 * 麦麦 2026-09-28：核心约定 (permanent) 拒绝删除——
 *   暮色要求永久区只能手动删，AI 用 [[MEMO_DEL]] 命中 permanent 时静默拒绝
 *   写入指南已告知 AI 永久区不能删，但程序兜底一道
 */
export async function deleteMemo(
    charId: string,
    id: number
): Promise<boolean> {
    const memo = await getMemo(charId);
    const target = memo.entries.find((e) => e.id === id);
    if (!target) return false;
    if (target.region === 'permanent') {
        console.warn(`📝 [Memo] DEL 被拒（核心约定不可删） #${id} (char=${charId})`);
        return false;
    }
    memo.entries = memo.entries.filter((e) => e.id !== id);
    memo.updatedAt = Date.now();
    await DB.saveCharacterMemo(memo);
    emitMemoUpdated(charId, 'memo');  // 麦麦 2026-09-06：通知 UI 重新读
    return true;
}

/**
 * 麦麦 2026-09-28：把一条 memo 提升到核心约定 (permanent) 区
 *   暮色手动操作：从"重点事件"或"私人笔记"点"永久保存"按钮 → 调这个
 *   - 保留原 id（避免编号混乱）
 *   - region 改成 'permanent'
 *   - updatedAt 更新
 *   - 已经永久的条目调这个是 no-op（返回原 target）
 */
export async function promoteMemoToPermanent(
    charId: string,
    id: number
): Promise<CharacterMemoEntry | null> {
    const memo = await getMemo(charId);
    const target = memo.entries.find((e) => e.id === id);
    if (!target) return null;
    if (target.region === 'permanent') return target;  // 已经在永久区
    const now = Date.now();
    target.region = 'permanent';
    target.updatedAt = now;
    memo.updatedAt = now;
    memo.entries = sortEntries(memo.entries);
    await DB.saveCharacterMemo(memo);
    emitMemoUpdated(charId, 'memo');
    return target;
}

/** memo 拼成 prompt 文本（按 region 分组，event → private → permanent 顺序） */
export function formatMemoForPrompt(memo: CharacterMemo | null | undefined): string {
    if (!memo || memo.entries.length === 0) return '';
    const sorted = sortEntries(memo.entries);
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        event: [],
        private: [],
        permanent: [],
    };
    for (const e of sorted) byRegion[e.region].push(e);

    const lines: string[] = [];
    // 麦麦 2026-09-28：3 个 region 输出顺序固定 event → private → permanent
    for (const region of ['event', 'private', 'permanent'] as CharacterMemoRegion[]) {
        const items = byRegion[region];
        if (items.length === 0) continue;
        lines.push(`【${DEFAULT_REGION_LABELS[region]}】`);
        if (region === 'event') {
            lines.push('以下是你想记住的最近重点事件（暮色 9-28 上限 10 条）。');
        } else if (region === 'private') {
            lines.push('以下是你的私人笔记（暮色 9-28 上限 50 条，可写任何你想记的）。');
        } else {
            lines.push('以下是核心约定（永久保存，永不淘汰。AI 不能删，只能改）。');
        }
        lines.push('');
        for (const item of items) {
            lines.push(`#${item.id} ${item.content}`);
        }
        lines.push('');
    }
    return lines.join('\n').trimEnd();
}

// ==================== 麦麦 2026-09-28：去重算法（中档 — 关键词袋 Jaccard） ====================

const SIMILARITY_THRESHOLD = 0.7;  // Jaccard ≥ 0.7 视为重复

// 常见中文停用词（覆盖 60% 高频噪音）。简化版本，不追求穷举。
const STOP_WORDS = new Set([
    '的', '了', '是', '我', '你', '他', '她', '它', '们', '在', '有', '和', '跟', '与', '或', '但',
    '就', '也', '都', '还', '才', '已', '将', '要', '会', '能', '可', '可能', '应该', '必须',
    '然后', '那个', '这个', '这样', '那样', '所以', '因为', '如果', '虽然', '即使', '只要', '只有',
    '不是', '没', '不', '很', '非常', '比较', '更', '最', '说', '讲', '问', '答', '叫', '让',
    '把', '被', '给', '从', '到', '向', '为', '为了', '对', '关于',
    '啊', '吧', '呢', '嘛', '哦', '嗯', '哈', '呀', '哎', '哇', '嘿',
    '什么', '怎么', '为什么', '怎样', '如何', '哪里', '哪儿', '哪个', '多少', '几个',
    '就是', '还是', '或者', '可是', '但是', '不过', '而且', '并且', '于是', '因此',
    '今天', '昨天', '明天', '晚上', '早上', '中午', '下午', '凌晨',
]);

/**
 * 把文本切成关键词袋
 * - 中文：每 2 字一组（2-gram），过滤停用词
 * - 英文：按空格分词，统一小写，过滤停用词
 * - 标点 / 空格 / 数字先按一个简易规则剥离
 */
function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    // 剥离常见标点 + 数字 + 空白
    const cleaned = text.replace(/[\s。，！？、；：""''【】《》()（）\.\,\!\?\;\:\(\)\[\]\{\}\-_—…·\\\/]+/g, ' ').trim();
    if (!cleaned) return tokens;
    const parts = cleaned.split(/\s+/).filter(Boolean);
    for (const part of parts) {
        if (/^[a-zA-Z]+$/.test(part)) {
            // 英文单词
            const w = part.toLowerCase();
            if (w.length >= 2 && !STOP_WORDS.has(w)) tokens.add(w);
        } else {
            // 中文 / 含数字混合：2-gram
            for (let i = 0; i < part.length - 1; i++) {
                const gram = part.slice(i, i + 2);
                if (!/^\d+$/.test(gram) && !STOP_WORDS.has(gram)) tokens.add(gram);
            }
        }
    }
    return tokens;
}

/** Jaccard 相似度 = |A ∩ B| / |A ∪ B| */
function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
}

// ==================== 导出 ====================

export const REGION_LABELS = DEFAULT_REGION_LABELS;
export const STATUS_LABELS = DEFAULT_STATUS_LABELS;
