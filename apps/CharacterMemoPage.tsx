// CharacterMemoPage — 角色备忘录只读页（江澈 9-5 指令）
//
// 暮色在发现页 → 角色备忘录进入，看角色（AI）自己通过 [[MEMO_ADD|EDIT|DEL:...]] 维护的备忘录
// 暮色不能编辑——这是角色自己的备忘。
//
// 麦麦 2026-09-05 实现

import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, Notebook, Smiley, Heart, BookOpen } from '@phosphor-icons/react';
import { getMemo, sortEntries, REGION_LABELS } from '../utils/characterMemo';
import type { CharacterMemo, CharacterMemoEntry, CharacterMemoRegion } from '../types';

const REGION_ICONS: Record<CharacterMemoRegion, React.ReactNode> = {
    status: <Smiley size={14} weight="regular" />,
    event: <Heart size={14} weight="regular" />,
    private: <BookOpen size={14} weight="regular" />,
};

const REGION_BG: Record<CharacterMemoRegion, string> = {
    status: 'bg-sky-50 text-sky-700 border-sky-100',
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

    const activeChar = characters.find((c) => c.id === activeCharId);
    const sorted = memo ? sortEntries(memo.entries) : [];
    const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
        status: [],
        event: [],
        private: [],
    };
    for (const e of sorted) byRegion[e.region].push(e);

    return (
        <div className="absolute inset-0 flex flex-col" style={{ background: 'linear-gradient(180deg, #f3f4f6 0%, #e7e9ee 100%)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/60 backdrop-blur shrink-0">
                <button
                    onClick={onBack}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
                    aria-label="返回"
                >
                    <CaretLeft size={20} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">角色备忘录</h1>
                <div className="w-9 h-9" aria-hidden />
            </div>

            {/* 角色切换 */}
            <div className="px-5 pt-3 shrink-0">
                <div className="bg-white rounded-2xl shadow-sm p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                        <Notebook size={16} weight="regular" className="text-amber-600" />
                    </div>
                    <select
                        value={activeCharId}
                        onChange={(e) => setActiveCharId(e.target.value)}
                        className="flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none cursor-pointer"
                    >
                        {characters.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}的备忘录
                            </option>
                        ))}
                    </select>
                </div>
                <p className="text-xs text-slate-500 mt-2 px-1">
                    {activeChar?.name}自己记的备忘录，暮色只能看不能改。
                </p>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
                {loading ? (
                    <div className="text-center text-slate-400 text-sm py-12">加载中…</div>
                ) : sorted.length === 0 ? (
                    <EmptyState charName={activeChar?.name ?? '该角色'} />
                ) : (
                    <div className="space-y-4">
                        {(['status', 'event', 'private'] as CharacterMemoRegion[]).map((region) => {
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
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

const EmptyState: React.FC<{ charName: string }> = ({ charName }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <Notebook size={28} weight="regular" className="text-slate-400" />
        </div>
        <p className="text-sm text-slate-500 mb-1">还没有备忘录</p>
        <p className="text-xs text-slate-400 max-w-[240px]">
            {charName}会在聊天中通过 [[MEMO_ADD: ...]] token 自己记下想记住的事。
            <br />这是给角色看的私人笔记，暮色只能浏览。
        </p>
    </div>
);

export default CharacterMemoPage;
