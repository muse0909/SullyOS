// PrivateNotesPage — 私密记事独立页面（暮色 2026-07-17：从 RoomApp 侧边栏抽出来）
// 入口：发现页 → 私密记事
// 暮色 2026-07-17 改：搜索全部移到右侧设置抽屉里，顶部只留角色筛选 + 齿轮

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, GearSix, ArrowsClockwise, X, Funnel } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useRoomNotes } from '../hooks/useRoomNotes';
import { RoomNote } from '../types';
import NotebookCard from '../components/notes/NotebookCard';
import NotebookDetail from '../components/notes/NotebookDetail';
import NoteSearchBar from '../components/notes/NoteSearchBar';
import NotebookBackground, {
    BgStylePicker,
    getStoredNotebookBg,
    setStoredNotebookBg,
    setStoredNotebookBuiltin,
    BuiltinBg,
} from '../components/notes/NotebookBackground';
import { PRIVATE_NOTES_PROMPT_STORAGE_KEY } from '../utils/chatPrompts';

const PrivateNotesPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { characters, activeCharacterId } = useOS();

    // ── 状态 ──
    const [view, setView] = useState<'list' | 'detail'>('list');
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [filterCharId, setFilterCharId] = useState<string>('all');
    const [keyword, setKeyword] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [showSettings, setShowSettings] = useState(false);

    // 背景
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const [bgBuiltin, setBgBuiltin] = useState<BuiltinBg>('cream-paper');
    useEffect(() => {
        const stored = getStoredNotebookBg();
        if (stored.url) setBgUrl(stored.url);
        if (stored.builtin) setBgBuiltin(stored.builtin);
    }, []);

    const handleBgChange = (next: { url: string | null; builtin: BuiltinBg }) => {
        setBgUrl(next.url);
        setBgBuiltin(next.builtin);
        setStoredNotebookBg(next.url);
        setStoredNotebookBuiltin(next.builtin);
    };

    // 数据
    const targetCharId = filterCharId === 'all' ? (activeCharacterId || characters[0]?.id || null) : filterCharId;
    const { notes, loading, refresh, deleteNote, addReply } = useRoomNotes(targetCharId);

    // 搜索 + 日期筛选
    const filtered = useMemo<RoomNote[]>(() => {
        let list = notes;
        if (keyword.trim()) {
            const kw = keyword.trim().toLowerCase();
            list = list.filter(n => n.content.toLowerCase().includes(kw));
        }
        if (dateFrom) {
            const fromTs = new Date(dateFrom).getTime();
            list = list.filter(n => n.timestamp >= fromTs);
        }
        if (dateTo) {
            const toTs = new Date(dateTo).getTime() + 24 * 60 * 60 * 1000;
            list = list.filter(n => n.timestamp < toTs);
        }
        return list;
    }, [notes, keyword, dateFrom, dateTo]);

    const selectedNote = useMemo(
        () => notes.find(n => n.id === selectedNoteId) || null,
        [notes, selectedNoteId]
    );

    const charName = (id?: string) => characters.find(c => c.id === id)?.name || '角色';

    // ── 详情视图 ──
    if (view === 'detail' && selectedNote) {
        return (
            <NotebookDetail
                note={selectedNote}
                charName={charName(selectedNote.charId)}
                onBack={() => { setView('list'); setSelectedNoteId(null); }}
                onDelete={async () => {
                    if (!confirm('确定删除这条私密记事？回复也会一起删除。')) return;
                    await deleteNote(selectedNote.id);
                    setView('list');
                    setSelectedNoteId(null);
                }}
                onAddReply={async (content) => {
                    await addReply(selectedNote.id, {
                        author: 'user',
                        content,
                        timestamp: Date.now(),
                    });
                }}
            />
        );
    }

    const hasFilter = !!keyword || !!dateFrom || !!dateTo;

    // ── 列表视图 ──
    return (
        <NotebookBackground url={bgUrl} builtin={bgBuiltin}>
            {/* 顶部 */}
            <div className="flex items-center justify-between px-2 py-3 shrink-0">
                <button
                    onClick={onBack}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-700 hover:bg-white/60 active:scale-95 transition-all"
                    aria-label="返回"
                >
                    <CaretLeft size={18} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">私密记事</h1>
                <div className="flex items-center gap-1">
                    <button
                        onClick={refresh}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-white/60 active:scale-95 transition-all"
                        aria-label="刷新"
                        title="刷新"
                    >
                        <ArrowsClockwise size={15} />
                    </button>
                    <button
                        onClick={() => setShowSettings(true)}
                        className={`relative w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition-all ${
                            hasFilter ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:bg-white/60'
                        }`}
                        aria-label="设置"
                        title="搜索 / 背景"
                    >
                        <GearSix size={16} />
                        {hasFilter && (
                            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                        )}
                    </button>
                </div>
            </div>

            {/* 角色筛选（顶部常驻） */}
            {characters.length > 1 && (
                <div className="px-3 mb-2">
                    <div className="flex items-center gap-1.5 px-1 py-1 overflow-x-auto no-scrollbar">
                        <Funnel size={12} className="text-slate-500 ml-1 shrink-0" />
                        <button
                            onClick={() => setFilterCharId('all')}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors shrink-0 ${
                                filterCharId === 'all' ? 'bg-slate-800 text-white' : 'bg-white/60 text-slate-600'
                            }`}
                        >
                            全部
                        </button>
                        {characters.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setFilterCharId(c.id)}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors truncate max-w-[100px] shrink-0 ${
                                    filterCharId === c.id ? 'bg-slate-800 text-white' : 'bg-white/60 text-slate-600'
                                }`}
                            >
                                {c.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-6 no-scrollbar">
                {loading ? (
                    <div className="flex items-center justify-center h-40 text-xs text-slate-400">加载中…</div>
                ) : filtered.length === 0 ? (
                    <EmptyState hasFilter={hasFilter} onOpenSettings={() => setShowSettings(true)} />
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        {filtered.map(note => (
                            <NotebookCard
                                key={note.id}
                                note={note}
                                charName={charName(note.charId)}
                                onClick={() => { setSelectedNoteId(note.id); setView('detail'); }}
                                onDelete={async () => {
                                    if (!confirm('确定删除？')) return;
                                    await deleteNote(note.id);
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* 右侧设置抽屉（70% 宽） */}
            {showSettings && (
                <SettingsDrawer
                    onClose={() => setShowSettings(false)}
                    bgUrl={bgUrl}
                    bgBuiltin={bgBuiltin}
                    onBgChange={handleBgChange}
                    keyword={keyword}
                    onKeywordChange={setKeyword}
                    dateFrom={dateFrom}
                    onDateFromChange={setDateFrom}
                    dateTo={dateTo}
                    onDateToChange={setDateTo}
                />
            )}
        </NotebookBackground>
    );
};

// 右侧 70% 宽设置抽屉
interface SettingsDrawerProps {
    onClose: () => void;
    bgUrl: string | null;
    bgBuiltin: BuiltinBg;
    onBgChange: (next: { url: string | null; builtin: BuiltinBg }) => void;
    keyword: string;
    onKeywordChange: (v: string) => void;
    dateFrom: string;
    onDateFromChange: (v: string) => void;
    dateTo: string;
    onDateToChange: (v: string) => void;
    onCustomPromptChange?: () => void;  // 2026-07-22：保存自定义 prompt 后通知父组件刷新
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
    onClose, bgUrl, bgBuiltin, onBgChange,
    keyword, onKeywordChange,
    dateFrom, onDateFromChange, dateTo, onDateToChange,
    onCustomPromptChange,
}) => {
    // 2026-07-22：自定义 prompt 状态（写进 localStorage，chatPrompts.ts 实时读）
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const [statusMsg, setStatusMsg] = useState<string>('');
    useEffect(() => {
        try {
            const v = localStorage.getItem(PRIVATE_NOTES_PROMPT_STORAGE_KEY);
            if (v) setCustomPrompt(v);
        } catch { /* ignore */ }
    }, []);

    const handleSave = () => {
        try {
            const v = customPrompt.trim();
            if (v) {
                localStorage.setItem(PRIVATE_NOTES_PROMPT_STORAGE_KEY, v);
                setStatusMsg('已保存');
            } else {
                localStorage.removeItem(PRIVATE_NOTES_PROMPT_STORAGE_KEY);
                setStatusMsg('已清空');
            }
            onCustomPromptChange?.();
            setTimeout(() => setStatusMsg(''), 1500);
        } catch (e: any) {
            setStatusMsg('保存失败：' + (e?.message || '未知错误'));
        }
    };
    const handleReset = () => {
        setCustomPrompt('');
        try { localStorage.removeItem(PRIVATE_NOTES_PROMPT_STORAGE_KEY); } catch {}
        onCustomPromptChange?.();
        setStatusMsg('已恢复默认（点保存生效）');
        setTimeout(() => setStatusMsg(''), 2000);
    };

    return (
        <div
            className="absolute inset-0 z-50 flex"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/35" />
            <div
                className="relative ml-auto h-full bg-white shadow-2xl flex flex-col animate-slide-in-right"
                style={{ width: 'min(70vw, 360px)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 顶部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                    <h2 className="text-base font-bold text-slate-800">设置</h2>
                    <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400">
                        <X size={16} />
                    </button>
                </div>

                {/* 内容 */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6 no-scrollbar">
                    {/* 搜索区 */}
                    <section>
                        <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">搜索</div>
                        <NoteSearchBar
                            keyword={keyword}
                            onKeywordChange={onKeywordChange}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            onDateFromChange={onDateFromChange}
                            onDateToChange={onDateToChange}
                        />
                    </section>

                    {/* 背景区 */}
                    <section>
                        <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">背景</div>
                        <BgStylePicker
                            url={bgUrl}
                            builtin={bgBuiltin}
                            onChange={onBgChange}
                        />
                    </section>

                    {/* 2026-07-22：自定义提示词（在背景下面，跟其他设置放一起） */}
                    <section>
                        <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">AI 写小纸条的指导</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                            留空用默认。想让 AI 按你希望的方式写，就在这里改。不改的话，默认会把这条提示词发给 AI：「这是一张你随手撕下来塞在对方口袋里的纸条，站在"你"的角度写，不是分析报告」。
                        </p>
                        <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="留空 = 用默认"
                            className="w-full h-32 bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed focus:bg-white focus:border-slate-300 transition-all resize-y"
                        />
                        <div className="flex gap-2 mt-2">
                            <button
                                onClick={handleSave}
                                className="flex-1 py-2 rounded-xl font-bold text-white shadow-md bg-gradient-to-br from-emerald-400 to-teal-500 active:scale-95 transition-all text-xs"
                            >
                                {statusMsg || '保存'}
                            </button>
                            <button
                                onClick={handleReset}
                                className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold active:scale-95 transition-all"
                            >
                                恢复默认
                            </button>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

// 空状态
const EmptyState: React.FC<{ hasFilter: boolean; onOpenSettings?: () => void }> = ({ hasFilter, onOpenSettings }) => (
    <div className="flex flex-col items-center justify-center h-60 text-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-white/70 backdrop-blur shadow-md flex items-center justify-center mb-3 rotate-[-4deg]">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-slate-300">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.75V16.5L12 14.25 7.5 16.5V3.75m9 0H18A2.25 2.25 0 0 1 20.25 6v12A2.25 2.25 0 0 1 18 20.25H6A2.25 2.25 0 0 1 3.75 18V6A2.25 2.25 0 0 1 6 3.75h1.5m9 0h-9" />
            </svg>
        </div>
        <div className="text-sm font-bold text-slate-600">
            {hasFilter ? '没有匹配的便签' : '私密记事还是空的'}
        </div>
        <div className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {hasFilter ? (
                <>试试去设置里清空筛选条件</>
            ) : (
                <>等 AI 写点什么给你看吧</>
            )}
        </div>
    </div>
);

export default PrivateNotesPage;
