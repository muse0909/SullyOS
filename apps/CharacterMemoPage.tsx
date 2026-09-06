// CharacterMemoPage — 角色备忘录只读页（江澈 9-5 指令）
//
// 暮色在发现页 → 角色备忘录进入，看角色（AI）自己通过 [[MEMO_ADD|EDIT|DEL:...]] 维护的备忘录
// 暮色不能编辑——这是角色自己的备忘。
//
// 麦麦 2026-09-05 实现

import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Notebook, Smiley, Heart, BookOpen } from '@phosphor-icons/react';
import { getMemo, getStatusPanel, sortEntries, REGION_LABELS, STATUS_LABELS } from '../utils/characterMemo';
import type { CharacterMemo, CharacterMemoEntry, CharacterMemoRegion, CharacterStatusPanel, CharacterStatusSlot } from '../types';

const REGION_ICONS: Record<CharacterMemoRegion, React.ReactNode> = {
    event: <Heart size={14} weight="regular" />,
    private: <BookOpen size={14} weight="regular" />,
};

const REGION_BG: Record<CharacterMemoRegion, string> = {
    event: 'bg-rose-50 text-rose-700 border-rose-100',
    private: 'bg-amber-50 text-amber-700 border-amber-100',
};

interface Props {
    onBack: () => void;
}

const CharacterMemoPage: React.FC<Props> = ({ onBack }) => {
    const { characters } = useOS();
    const [activeCharId, setActiveCharId] = useState<string>('');
    const [memo, setMemo] = useState<CharacterMemo | null>(null);
    const [loading, setLoading] = useState(false);

    // 默认选第一个角色
    useEffect(() => {
        if (characters.length > 0 && !activeCharId) {
            setActiveCharId(characters[0].id);
        }
    }, [characters, activeCharId]);

    // 读 memo（每切角色刷新一次）
    useEffect(() => {
        if (!activeCharId) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            const m = await getMemo(activeCharId);
            if (!cancelled) {
                setMemo(m);
                setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeCharId]);

    // 麦麦 2026-09-06：监听 memo-updated 事件（addMemo/setStatusSlot 写完 IDB 后派发）
    //   暮色 9-6 反馈：APK 端写完不显示 — 因为 useEffect 只在 activeCharId 变化时重读
    //   写 memo 后没主动重新读。现在监听事件 + 检查 charId 匹配 → 重读
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ charId: string; kind: string }>).detail;
            if (!detail || !activeCharId) return;
            if (detail.charId !== activeCharId) return;  // 别的角色变化不重读
            (async () => {
                const m = await getMemo(activeCharId);
                setMemo(m);
            })();
        };
        window.addEventListener('memo-updated', handler);
        return () => window.removeEventListener('memo-updated', handler);
    }, [activeCharId]);

    // 状态面板独立监听（同事件但 kind='status' 也要刷）
    const [statusPanel, setStatusPanelState] = useState<CharacterStatusPanel | null>(null);
    useEffect(() => {
        if (!activeCharId) return;
        (async () => {
            const p = await getStatusPanel(activeCharId);
            setStatusPanelState(p);
        })();
    }, [activeCharId]);
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ charId: string; kind: string }>).detail;
            if (!detail || !activeCharId) return;
            if (detail.charId !== activeCharId) return;
            if (detail.kind !== 'status' && detail.kind !== 'both') return;
            (async () => {
                const p = await getStatusPanel(activeCharId);
                setStatusPanelState(p);
            })();
        };
        window.addEventListener('memo-updated', handler);
        return () => window.removeEventListener('memo-updated', handler);
    }, [activeCharId]);

    // 麦麦 2026-09-06：双保险 — pageshow / visibilitychange 触发重读
    //   暮色 9-6 反馈"APK 端写完还是不显示" — CustomEvent 理论上能 work，但 APK WebView
    //   切后台/回前台的事件流更稳。这里加 pageshow（页面显示/恢复）+ visibilitychange 兜底
    //   从聊天页切回备忘录页时主动重读，绕过 CustomEvent 监听器挂载时机问题
    useEffect(() => {
        if (!activeCharId) return;
        const reload = () => {
            if (document.visibilityState === 'hidden') return;  // 切到后台时跳过
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
    // 麦麦 2026-09-06：兜底 unknown region（5d71187 之前 IDB 里 region='status' 的旧 entries
    //   暮色 IDB 里有 5d71187 之前写入的 memo，跑新代码 region type='event'|'private' 时
    //   byRegion['status'] 是 undefined → push 报错）
    //   防御写法：忽略 unknown region（不崩），下次 DB 升级（v72）会主动清掉
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        event: [],
        private: [],
    };
    for (const e of sorted) {
        const bucket = byRegion[e.region];
        if (bucket) bucket.push(e);
        // else: 未知 region（5d71187 之前的 'status' 残留），跳过 — 不崩
    }

    // 麦麦 2026-09-06：状态面板固定槽位顺序
    const STATUS_SLOT_ORDER: CharacterStatusSlot[] = ['location', 'health', 'schedule', 'mood', 'reminder'];
    // 暮色 9-6 16:14 反馈"状态面板要一直在备忘录页面置顶显示"
    //   改：5 个固定槽永远显示，没值显示"未填"（不是整块隐藏）
    //   statusEntries 改成全 5 槽都返回（不再 filter）
    const statusEntries = STATUS_SLOT_ORDER.map(slot => ({
        slot,
        value: statusPanel?.slots?.[slot]?.trim() || '',
    }));
    const hasStatus = statusEntries.some(e => e.value);  // 给老逻辑兼容用，但不影响置顶显示
    const hasMemo = sorted.length > 0;

    return (
        <div className="absolute inset-0 flex flex-col" style={{ background: 'linear-gradient(180deg, #f3f4f6 0%, #e7e9ee 100%)' }}>
            {/* 麦麦 2026-09-06 16:25：角色下拉框合并到 header 那一行（暮色 9-6 16:25 反馈"切换角色想改到顶上"）
                - 删独立的角色切换卡（原本 header 下面那一块）
                - header 改成：返回 + 标题 + 角色下拉框（带图标，inline，rounded-full 胶囊样式）
                - 副标题"X 自己记的备忘录"挪到内容区上方 */}
            <div className="flex items-center gap-2 px-2 py-3 bg-white/60 backdrop-blur shrink-0">
                <button
                    onClick={onBack}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
                    aria-label="返回"
                >
                    <CaretLeft size={20} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">角色备忘录</h1>
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

            {/* 副标题挪到内容区上方 */}
            <div className="px-5 pt-3 shrink-0">
                <p className="text-xs text-slate-500 px-1">
                    {activeChar?.name}自己记的备忘录，暮色只能看不能改。
                </p>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
                {loading ? (
                    <div className="text-center text-slate-400 text-sm py-12">加载中…</div>
                ) : (
                    <div className="space-y-4">
                        {/* 暮色 9-6 16:14 要求"状态面板要一直在备忘录页面置顶显示"——5 槽永远渲染，没值显示"未填" */}
                        <div className="bg-white rounded-2xl shadow-sm p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-sky-50 text-sky-700 border-sky-100">
                                    <Smiley size={14} weight="regular" />
                                    当前状态面板
                                </span>
                            </div>
                            <div className="space-y-2">
                                {statusEntries.map(({ slot, value }) => (
                                    <div key={slot} className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 leading-relaxed">
                                        <div className="text-[10px] text-slate-400 mb-1 font-mono">{STATUS_LABELS[slot]}</div>
                                        {value ? value : <span className="text-slate-300 italic">未填</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {hasMemo ? (
                            (['event', 'private'] as CharacterMemoRegion[]).map((region) => {
                                const items = byRegion[region];
                                if (items.length === 0) return null;
                                return (
                                    <div key={region} className="bg-white rounded-2xl shadow-sm p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${REGION_BG[region]}`}>
                                                {REGION_ICONS[region]}
                                                {REGION_LABELS[region]}
                                            </span>
                                            <span className="text-xs text-slate-400">{items.length} 条</span>
                                        </div>
                                        <div className="space-y-2">
                                            {items.map((e) => (
                                                <div
                                                    key={e.id}
                                                    className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 leading-relaxed"
                                                >
                                                    <div className="text-[10px] text-slate-400 mb-1 font-mono">#{e.id}</div>
                                                    {e.content}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <EmptyMemoState charName={activeChar?.name ?? '该角色'} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const EmptyMemoState: React.FC<{ charName: string }> = ({ charName }) => (
    <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-slate-50 text-slate-500 border-slate-100">
                <Notebook size={14} weight="regular" />
                备忘录
            </span>
            <span className="text-xs text-slate-400">0 条</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
            {charName}还没记任何事。在聊天中{charName}可以通过 <code className="px-1 py-0.5 bg-slate-50 rounded font-mono text-[11px]">[[MEMO_ADD: event|private | 内容]]</code> 自己记下想记住的事。
        </p>
    </div>
);

export default CharacterMemoPage;
