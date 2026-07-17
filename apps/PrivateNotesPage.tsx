// PrivateNotesPage — 私密记事独立页面（暮色 2026-07-17：从 RoomApp 侧边栏抽出来）
// 入口：发现页 → 私密记事
// 功能：列表 + 关键词/日期搜索 + 角色筛选 + 点开看详情 + 回复
// 数据：useRoomNotes hook 加载（与 RoomApp 侧边栏共用数据源）
// 背景：用户上传 / 3 种默认风格（NotebookBackground 组件）
// 暮色审美：马卡龙色 + 居中胶囊 + 留白

import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, Funnel, BookOpen, ArrowsClockwise } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useRoomNotes } from '../hooks/useRoomNotes';
import { RoomNote } from '../types';
import NotebookCard from '../components/notes/NotebookCard';
import NotebookDetail from '../components/notes/NotebookDetail';
import NoteSearchBar from '../components/notes/NoteSearchBar';
import NotebookBackground, {
    getStoredNotebookBg,
    setStoredNotebookBg,
    setStoredNotebookBuiltin,
    BuiltinBg,
} from '../components/notes/NotebookBackground';

const PrivateNotesPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { characters, activeCharacterId, setActiveCharacterId } = useOS();

    // ── 状态 ──
    const [view, setView] = useState<'list' | 'detail'>('list');
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [filterCharId, setFilterCharId] = useState<string>('all');  // 'all' | charId
    const [keyword, setKeyword] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // 背景（用户上传 / 默认）
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

    // 数据（按筛选的角色加载）
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
            // dateTo 包含整天：加 24 小时
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
    const selectedCharName = filterCharId === 'all'
        ? (characters.find(c => c.id === activeCharacterId)?.name || '角色')
        : charName(filterCharId);

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

    // ── 列表视图 ──
    return (
        <NotebookBackground url={bgUrl} builtin={bgBuiltin} onChange={handleBgChange}>
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
                <button
                    onClick={refresh}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-white/60 active:scale-95 transition-all"
                    aria-label="刷新"
                    title="刷新"
                >
                    <ArrowsClockwise size={15} />
                </button>
            </div>

            {/* 角色筛选 */}
            {characters.length > 1 && (
                <div className="px-3 mb-2">
                    <div className="flex items-center gap-1.5 px-1 py-1">
                        <Funnel size={12} className="text-slate-500 ml-1" />
                        <button
                            onClick={() => setFilterCharId('all')}
                            className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors ${
                                filterCharId === 'all' ? 'bg-slate-800 text-white' : 'bg-white/60 text-slate-600'
                            }`}
                        >
                            全部
                        </button>
                        {characters.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setFilterCharId(c.id)}
                                className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-colors truncate max-w-[100px] ${
                                    filterCharId === c.id ? 'bg-slate-800 text-white' : 'bg-white/60 text-slate-600'
                                }`}
                            >
                                {c.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 搜索 */}
            <div className="px-3 mb-3">
                <NoteSearchBar
                    keyword={keyword}
                    onKeywordChange={setKeyword}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                />
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto px-4 pb-6 no-scrollbar">
                {loading ? (
                    <div className="flex items-center justify-center h-40 text-xs text-slate-400">加载中…</div>
                ) : filtered.length === 0 ? (
                    <EmptyState hasFilter={!!(keyword || dateFrom || dateTo)} />
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
        </NotebookBackground>
    );
};

// 空状态
const EmptyState: React.FC<{ hasFilter: boolean }> = ({ hasFilter }) => (
    <div className="flex flex-col items-center justify-center h-60 text-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-white/70 backdrop-blur shadow-md flex items-center justify-center mb-3 rotate-[-4deg]">
            <BookOpen size={28} weight="regular" className="text-slate-300" />
        </div>
        <div className="text-sm font-bold text-slate-600">
            {hasFilter ? '没有匹配的便签' : '私密记事还是空的'}
        </div>
        <div className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            {hasFilter ? '试试清空筛选条件' : '等 AI 写点什么给你看吧'}
        </div>
    </div>
);

export default PrivateNotesPage;
