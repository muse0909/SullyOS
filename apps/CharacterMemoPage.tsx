// CharacterMemoPage — 角色备忘录（麦麦 2026-09-28 重构）
//
// 江澈 9-5 指令拍板"暮色只读" → 暮色 9-28 推翻：
//   "实战暴露问题——AI 删除不靠谱 + 重复写入撑爆上限 + 重要内容被静默淘汰
//    完全让 AI 管理还是不行"
//   暮色明确要求暮色可以手动操作（删除 / 编辑 / 永久保存 / 编辑状态面板）。
//
// 9-28 新结构：
//   - 4 个 tab 顶端并列：当前状态 / 重点事件 / 私人笔记 / 核心约定
//   - 状态面板：6 个槽点文字直接进编辑，onBlur 自动保存；每槽 hover 显示 🗑 清空
//   - 三种备忘：点条目弹 Modal 编辑
//       重点事件、私人笔记 弹窗底部：【永久保存】【保存】
//       核心约定 弹窗底部：只有【保存】
//   - 每条卡片右下角快捷 🗑（弹确认）
//   - 核心约定：AI 能编辑不能删除（程序兜底）
//   - 上限调整为：重点事件 10 条、非永久区合计 50 条
//   - 写入去重中档：完全相同 + 关键词袋相似度 70% 视为重复
//
// 历史：
//   9-5 首次实现（江澈 9-5 指令）
//   9-6 16:14 状态面板置顶 + 写入指南永远注入
//   9-6 16:25 matchAll 解析 + 角色下拉框挪到头部
//   9-6 16:40 删副标题（后又加回）
//   9-6 16:43 加 'recent' 状态槽
//   9-28 重构为 4 tab + 暮色可写 + 永久区

import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import {
    CaretLeft,
    Notebook,
    Smiley,
    Heart,
    BookOpen,
    Star,
    Trash,
    PencilSimple,
} from '@phosphor-icons/react';
import {
    getMemo,
    getStatusPanel,
    setStatusSlot,
    clearStatusSlot,
    editMemo,
    deleteMemo,
    promoteMemoToPermanent,
    sortEntries,
    REGION_LABELS,
    STATUS_LABELS,
} from '../utils/characterMemo';
import type {
    CharacterMemo,
    CharacterMemoEntry,
    CharacterMemoRegion,
    CharacterStatusPanel,
    CharacterStatusSlot,
} from '../types';
import Modal from '../components/os/Modal';

// ==================== 配置 ====================

type TabKey = 'status' | 'event' | 'private' | 'permanent';

const TAB_META: Record<TabKey, {
    label: string;
    Icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' }>;
    activeBg: string;
    activeText: string;
    inactiveBg: string;
    inactiveText: string;
}> = {
    status: {
        label: '当前状态',
        Icon: Smiley,
        activeBg: 'bg-sky-500',
        activeText: 'text-white',
        inactiveBg: 'bg-sky-50 text-sky-700 border border-sky-100',
        inactiveText: 'text-sky-700',
    },
    event: {
        label: '重点事件',
        Icon: Heart,
        activeBg: 'bg-emerald-500',
        activeText: 'text-white',
        inactiveBg: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
        inactiveText: 'text-emerald-700',
    },
    private: {
        label: '私人笔记',
        Icon: BookOpen,
        activeBg: 'bg-amber-500',
        activeText: 'text-white',
        inactiveBg: 'bg-amber-50 text-amber-700 border border-amber-100',
        inactiveText: 'text-amber-700',
    },
    permanent: {
        label: '核心约定',
        Icon: Star,
        activeBg: 'bg-violet-500',
        activeText: 'text-white',
        inactiveBg: 'bg-violet-50 text-violet-700 border border-violet-100',
        inactiveText: 'text-violet-700',
    },
};

const STATUS_SLOT_ORDER: CharacterStatusSlot[] = ['location', 'health', 'schedule', 'mood', 'reminder', 'recent'];

// ==================== 主组件 ====================

interface Props {
    onBack: () => void;
}

const CharacterMemoPage: React.FC<Props> = ({ onBack }) => {
    const { characters } = useOS();
    const [activeCharId, setActiveCharId] = useState<string>('');
    const [activeTab, setActiveTab] = useState<TabKey>('status');
    const [memo, setMemo] = useState<CharacterMemo | null>(null);
    const [statusPanel, setStatusPanelState] = useState<CharacterStatusPanel | null>(null);
    const [loading, setLoading] = useState(false);

    // 默认选第一个角色
    useEffect(() => {
        if (characters.length > 0 && !activeCharId) {
            setActiveCharId(characters[0].id);
        }
    }, [characters, activeCharId]);

    // 读 memo + statusPanel（切角色刷新）
    useEffect(() => {
        if (!activeCharId) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            const [m, p] = await Promise.all([getMemo(activeCharId), getStatusPanel(activeCharId)]);
            if (!cancelled) {
                setMemo(m);
                setStatusPanelState(p);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeCharId]);

    // 麦麦 2026-09-06：监听 memo-updated 事件（写完 IDB 后派发）→ 重读
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ charId: string; kind: string }>).detail;
            if (!detail || !activeCharId) return;
            if (detail.charId !== activeCharId) return;
            (async () => {
                if (detail.kind === 'status' || detail.kind === 'both') {
                    const p = await getStatusPanel(activeCharId);
                    setStatusPanelState(p);
                }
                if (detail.kind === 'memo' || detail.kind === 'both') {
                    const m = await getMemo(activeCharId);
                    setMemo(m);
                }
            })();
        };
        window.addEventListener('memo-updated', handler);
        return () => window.removeEventListener('memo-updated', handler);
    }, [activeCharId]);

    // 麦麦 2026-09-06：双保险 — pageshow / visibilitychange 触发重读
    useEffect(() => {
        if (!activeCharId) return;
        const reload = () => {
            if (document.visibilityState === 'hidden') return;
            (async () => {
                const m = await getMemo(activeCharId);
                setMemo(m);
                const p = await getStatusPanel(activeCharId);
                setStatusPanelState(p);
            })();
        };
        window.addEventListener('pageshow', reload);
        document.addEventListener('visibilitychange', reload);
        return () => {
            window.removeEventListener('pageshow', reload);
            document.removeEventListener('visibilitychange', reload);
        };
    }, [activeCharId]);

    const activeChar = characters.find((c) => c.id === activeCharId);
    const sorted = memo ? sortEntries(memo.entries) : [];

    // 按 region 分组（兜底 unknown region 静默跳过）
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        event: [],
        private: [],
        permanent: [],
    };
    for (const e of sorted) {
        const bucket = byRegion[e.region];
        if (bucket) bucket.push(e);
    }

    return (
        <div className="absolute inset-0 flex flex-col" style={{ background: 'linear-gradient(180deg, #f3f4f6 0%, #e7e9ee 100%)' }}>
            {/* 头部：返回 + 角色下拉框 */}
            <div className="flex items-center gap-2 px-2 py-3 bg-white/60 backdrop-blur shrink-0">
                <button
                    onClick={onBack}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
                    aria-label="返回"
                >
                    <CaretLeft size={20} weight="bold" />
                </button>
                <div className="flex-1 flex items-center gap-2 bg-white rounded-full shadow-sm px-3 py-1.5 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                        <Notebook size={12} weight="regular" className="text-amber-600" />
                    </div>
                    <select
                        value={activeCharId}
                        onChange={(e) => setActiveCharId(e.target.value)}
                        className="flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none cursor-pointer min-w-0"
                    >
                        {characters.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}的备忘录
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 4 tab 顶端并列 */}
            <div className="px-3 pt-3 pb-2 shrink-0">
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {(Object.keys(TAB_META) as TabKey[]).map((k) => {
                        const meta = TAB_META[k];
                        const isActive = activeTab === k;
                        const Icon = meta.Icon;
                        return (
                            <button
                                key={k}
                                onClick={() => setActiveTab(k)}
                                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 ${
                                    isActive
                                        ? `${meta.activeBg} ${meta.activeText} shadow-sm`
                                        : `${meta.inactiveBg} hover:opacity-80`
                                }`}
                            >
                                <Icon size={12} weight={isActive ? 'bold' : 'regular'} />
                                {meta.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 内容区：根据 tab 切换 */}
            <div className="flex-1 overflow-y-auto px-4 pt-2 pb-6">
                {loading ? (
                    <div className="text-center text-slate-400 text-sm py-12">加载中…</div>
                ) : (
                    <>
                        {activeTab === 'status' && (
                            <StatusPanelTab
                                charId={activeCharId}
                                statusPanel={statusPanel}
                                onChange={setStatusPanelState}
                            />
                        )}
                        {(activeTab === 'event' || activeTab === 'private' || activeTab === 'permanent') && (
                            <MemoRegionTab
                                charId={activeCharId}
                                region={activeTab}
                                entries={byRegion[activeTab]}
                                onChange={() => {
                                    // 写完后 memo-updated 事件会触发重读，这里兜底
                                    (async () => {
                                        const m = await getMemo(activeCharId);
                                        setMemo(m);
                                    })();
                                }}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

// ==================== 状态面板 tab ====================

const StatusPanelTab: React.FC<{
    charId: string;
    statusPanel: CharacterStatusPanel | null;
    onChange: (p: CharacterStatusPanel) => void;
}> = ({ charId, statusPanel, onChange }) => {
    return (
        <div className="space-y-2.5">
            {STATUS_SLOT_ORDER.map((slot) => (
                <StatusSlotRow
                    key={slot}
                    charId={charId}
                    slot={slot}
                    value={statusPanel?.slots?.[slot]?.trim() || ''}
                    onChange={onChange}
                />
            ))}
        </div>
    );
};

const StatusSlotRow: React.FC<{
    charId: string;
    slot: CharacterStatusSlot;
    value: string;
    onChange: (p: CharacterStatusPanel) => void;
}> = ({ charId, slot, value, onChange }) => {
    const [draft, setDraft] = useState(value);
    const [saving, setSaving] = useState(false);
    const [hovered, setHovered] = useState(false);

    // 外部 value 变化（比如 AI 写入）→ 同步 draft
    useEffect(() => {
        setDraft(value);
    }, [value]);

    const save = async (next: string) => {
        if (next === value) return;
        setSaving(true);
        try {
            const p = await setStatusSlot(charId, slot, next);
            onChange(p);
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        if (!value) return;
        if (!window.confirm(`确认清空「${STATUS_LABELS[slot]}」？`)) return;
        const p = await clearStatusSlot(charId, slot);
        onChange(p);
    };

    // recent 槽可能很长 → textarea；其他槽用 input
    const isLong = slot === 'recent';
    const placeholder = '点击直接编辑';

    return (
        <div
            className="bg-white rounded-2xl shadow-sm p-3.5 group"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="flex items-center justify-between mb-1.5">
                <div className="text-[11px] text-slate-400 font-mono">{STATUS_LABELS[slot]}</div>
                <div className="flex items-center gap-2">
                    {saving && <span className="text-[10px] text-slate-400">保存中…</span>}
                    {value && (hovered || true) && (
                        <button
                            onClick={handleClear}
                            className={`text-slate-300 hover:text-rose-500 transition-all ${
                                hovered ? 'opacity-100' : 'opacity-0'
                            }`}
                            aria-label="清空"
                            title="清空"
                        >
                            <Trash size={14} weight="regular" />
                        </button>
                    )}
                </div>
            </div>
            {isLong ? (
                <textarea
                    value={draft}
                    placeholder={placeholder}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={(e) => save(e.target.value)}
                    rows={3}
                    className="w-full bg-transparent text-sm text-slate-700 leading-relaxed outline-none resize-none placeholder:text-slate-300 placeholder:italic"
                />
            ) : (
                <input
                    type="text"
                    value={draft}
                    placeholder={placeholder}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={(e) => save(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    className="w-full bg-transparent text-sm text-slate-700 leading-relaxed outline-none placeholder:text-slate-300 placeholder:italic"
                />
            )}
        </div>
    );
};

// ==================== 三种备忘 tab ====================

const MemoRegionTab: React.FC<{
    charId: string;
    region: CharacterMemoRegion;
    entries: CharacterMemoEntry[];
    onChange: () => void;
}> = ({ charId, region, entries, onChange }) => {
    const [editing, setEditing] = useState<CharacterMemoEntry | null>(null);
    const meta = TAB_META[region];
    const Icon = meta.Icon;

    const handleDelete = async (id: number) => {
        if (!window.confirm('确认删除这条备忘？')) return;
        // 麦麦 2026-09-28 19:54：UI 路径 — byUser=true 允许删核心约定
        await deleteMemo(charId, id, { byUser: true });
        onChange();
    };

    if (entries.length === 0) {
        return (
            <div className="bg-white rounded-2xl shadow-sm p-5 mt-2">
                <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${meta.inactiveBg}`}>
                        <Icon size={14} weight="regular" />
                        {REGION_LABELS[region]}
                    </span>
                    <span className="text-xs text-slate-400">0 条</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                    暂时没有内容。{region === 'permanent'
                        ? '可以从其他区点"永久保存"升级到核心约定；AI 也可以直接 [[MEMO_ADD: 核心约定|...]] 写入。'
                        : '在聊天里 AI 会按 token 自己记，也可以手动加。'}
                </p>
            </div>
        );
    }

    return (
        <>
            <div className="flex items-center gap-2 mb-3 px-1">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${meta.inactiveBg}`}>
                    <Icon size={14} weight="regular" />
                    {REGION_LABELS[region]}
                </span>
                {region !== 'permanent' && (
                    <span className="text-xs text-slate-400">{entries.length} 条</span>
                )}
            </div>
            <div className="space-y-2.5">
                {entries.map((e) => (
                    <MemoEntryCard
                        key={e.id}
                        entry={e}
                        region={region}
                        onClick={() => setEditing(e)}
                        onDelete={() => handleDelete(e.id)}
                    />
                ))}
            </div>

            {editing && (
                <EditMemoModal
                    entry={editing}
                    region={region}
                    charId={charId}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        onChange();
                    }}
                />
            )}
        </>
    );
};

const MemoEntryCard: React.FC<{
    entry: CharacterMemoEntry;
    region: CharacterMemoRegion;
    onClick: () => void;
    onDelete: () => void;
}> = ({ entry, region, onClick, onDelete }) => {
    const [hovered, setHovered] = useState(false);
    const isPermanent = region === 'permanent';

    return (
        <div
            className="bg-white rounded-2xl shadow-sm p-3.5 cursor-pointer active:scale-[0.98] transition-transform relative"
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="text-[11px] text-slate-400 font-mono">#{entry.id}</div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    className={`text-slate-300 hover:text-rose-500 transition-all ${
                        hovered ? 'opacity-100' : 'opacity-0'
                    }`}
                    aria-label="删除"
                    title="删除"
                >
                    <Trash size={14} weight="regular" />
                </button>
            </div>
            <div className={`text-sm text-slate-700 leading-relaxed ${isPermanent ? 'pl-1 border-l-2 border-violet-300' : ''}`}>
                {entry.content}
            </div>
            {isPermanent && (
                <div className="flex items-center gap-1 mt-2 text-[10px] text-violet-500">
                    <Star size={10} weight="fill" />
                    核心约定 · 永久保存
                </div>
            )}
        </div>
    );
};

// ==================== 编辑 Modal ====================

const EditMemoModal: React.FC<{
    entry: CharacterMemoEntry;
    region: CharacterMemoRegion;
    charId: string;
    onClose: () => void;
    onSaved: () => void;
}> = ({ entry, region, charId, onClose, onSaved }) => {
    const [draft, setDraft] = useState(entry.content);
    const [saving, setSaving] = useState(false);
    const isPermanent = region === 'permanent';

    const handleSave = async () => {
        if (!draft.trim() || draft.trim() === entry.content) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            await editMemo(charId, entry.id, draft);
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    const handlePromote = async () => {
        if (!window.confirm('把这条升级到「核心约定」？原区会删除这条，编号保留。')) return;
        setSaving(true);
        try {
            // 先 edit 新内容（如果有改动），再 promote
            if (draft.trim() && draft.trim() !== entry.content) {
                await editMemo(charId, entry.id, draft);
            }
            await promoteMemoToPermanent(charId, entry.id);
            onSaved();
        } finally {
            setSaving(false);
        }
    };

    const footer = (
        // 麦麦 2026-09-28 19:54：暮色反馈"按钮要对称、平铺、居中、颜色浅一点"
        //   旧版两个按钮用 px-5 py-2.5（不固定宽度，靠文字长度决定）
        //   → "永久保存" 4 字比"保存" 2 字宽，按钮一大一小、整体偏左
        //   改成 flex-1 平铺均分宽度（"保存" 单独时也撑满整行）
        //   颜色 500 → 400 浅一档（hover 还是 500）
        <div className="flex gap-2 w-full">
            {!isPermanent && (
                <button
                    onClick={handlePromote}
                    disabled={saving}
                    className="flex-1 py-2.5 rounded-full bg-violet-400 text-white text-sm font-medium shadow-sm hover:bg-violet-500 active:scale-95 transition-transform disabled:opacity-50"
                >
                    永久保存
                </button>
            )}
            <button
                onClick={handleSave}
                disabled={saving}
                className={`flex-1 py-2.5 rounded-full bg-emerald-400 text-white text-sm font-medium shadow-sm hover:bg-emerald-500 active:scale-95 transition-transform disabled:opacity-50 ${isPermanent ? 'mx-auto max-w-[12rem]' : ''}`}
            >
                {saving ? '保存中…' : '保存'}
            </button>
        </div>
    );

    return (
        <Modal
            isOpen={true}
            title={`编辑 #${entry.id}${isPermanent ? ' · 核心约定' : ''}`}
            onClose={onClose}
            footer={footer}
        >
            <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="内容..."
                autoFocus
                rows={10}
                className="w-full bg-transparent text-sm text-slate-700 leading-relaxed outline-none resize-none placeholder:text-slate-300 placeholder:italic p-1"
            />
        </Modal>
    );
};

export default CharacterMemoPage;