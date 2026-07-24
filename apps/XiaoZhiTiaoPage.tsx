// XiaoZhiTiaoPage — 小纸条独立页面（2026-07-22：跟 PrivateNotesPage 完全独立）
// 暮色原话："小纸条完全脱离小小窝 app" — 独立数据 / 独立 hook / 独立组件 / 独立 prompt
// 入口：发现页 → 小纸条

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, GearSix, ArrowsClockwise, X, Funnel } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useXiaoZhiTiao } from '../hooks/useXiaoZhiTiao';
import { XiaoZhiTiao } from '../types';
import XiaoZhiTiaoCard from '../components/notes/XiaoZhiTiaoCard';
import XiaoZhiTiaoDetail from '../components/notes/XiaoZhiTiaoDetail';
import NoteSearchBar from '../components/notes/NoteSearchBar';
import NotebookBackground, {
    BgStylePicker,
    getStoredNotebookBg,
    setStoredNotebookBg,
    setStoredNotebookBuiltin,
    BuiltinBg,
} from '../components/notes/NotebookBackground';
import { XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY } from '../utils/chatPrompts';
import {
    getStoredXiaoZhiTiaoStyles,
    setStoredXiaoZhiTiaoStyles,
    compressImageForXiaoZhiTiao,
    type XiaoZhiTiaoStyles,
} from '../utils/xiaoZhiTiaoStyles';

const XiaoZhiTiaoPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
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

    // 数据（独立 hook）
    const targetCharId = filterCharId === 'all' ? (activeCharacterId || characters[0]?.id || null) : filterCharId;
    const { notes, loading, refresh, deleteNote, addReply } = useXiaoZhiTiao(targetCharId);

    // 搜索 + 日期筛选
    const filtered = useMemo<XiaoZhiTiao[]>(() => {
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
            <XiaoZhiTiaoDetail
                note={selectedNote}
                charName={charName(selectedNote.charId)}
                onBack={() => { setView('list'); setSelectedNoteId(null); }}
                onDelete={async () => {
                    if (!confirm('确定删除这条小纸条？回复也会一起删除。')) return;
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
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">小纸条</h1>
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
                        title="搜索 / 背景 / 样式 / AI 指导"
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
                            <XiaoZhiTiaoCard
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

// 右侧 70% 宽设置抽屉（独立命名：小纸条相关）
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
    onCustomPromptChange?: () => void;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
    onClose, bgUrl, bgBuiltin, onBgChange,
    keyword, onKeywordChange,
    dateFrom, onDateFromChange, dateTo, onDateToChange,
    onCustomPromptChange,
}) => {
    // 2026-07-22：自定义 prompt 状态（独立 key：小纸条）
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const [statusMsg, setStatusMsg] = useState<string>('');
    useEffect(() => {
        try {
            const v = localStorage.getItem(XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY);
            if (v) setCustomPrompt(v);
        } catch { /* ignore */ }
    }, []);

    // 2026-07-22：自定义小纸条样式（独立命名 + 独立 key）
    const [styles, setStyles] = useState<XiaoZhiTiaoStyles>({ groups: {}, activeGroup: null });
    const [newGroupName, setNewGroupName] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => { setStyles(getStoredXiaoZhiTiaoStyles()); }, []);
    const persistStyles = (next: XiaoZhiTiaoStyles) => {
        setStyles(next);
        setStoredXiaoZhiTiaoStyles(next);
    };
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) return;
        try {
            const compressed = await compressImageForXiaoZhiTiao(file);
            if (!styles.activeGroup) {
                persistStyles({ groups: { '默认样式': [compressed] }, activeGroup: '默认样式' });
            } else {
                const urls = styles.groups[styles.activeGroup] || [];
                persistStyles({
                    ...styles,
                    groups: { ...styles.groups, [styles.activeGroup]: [...urls, compressed] },
                });
            }
        } catch (err) {
            console.error('[xiaoZhiTiaoStyles] 压缩失败:', err);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };
    const handleNewGroup = () => {
        const name = newGroupName.trim();
        if (!name) return;
        if (styles.groups[name]) {
            alert('已存在同名分组');
            return;
        }
        persistStyles({ ...styles, groups: { ...styles.groups, [name]: [] }, activeGroup: name });
        setNewGroupName('');
    };
    const handleDeleteGroup = (name: string) => {
        if (!confirm(`确定删除分组「${name}」？里面的图也会一起删。`)) return;
        const nextGroups = { ...styles.groups };
        delete nextGroups[name];
        const remaining = Object.keys(nextGroups);
        persistStyles({
            groups: nextGroups,
            activeGroup: styles.activeGroup === name ? (remaining[0] || null) : styles.activeGroup,
        });
    };
    const handleDeleteImage = (url: string) => {
        if (!styles.activeGroup) return;
        const urls = styles.groups[styles.activeGroup] || [];
        persistStyles({
            ...styles,
            groups: { ...styles.groups, [styles.activeGroup]: urls.filter(u => u !== url) },
        });
    };

    const handleSave = () => {
        try {
            const v = customPrompt.trim();
            if (v) {
                localStorage.setItem(XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY, v);
                setStatusMsg('已保存');
            } else {
                localStorage.removeItem(XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY);
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
        try { localStorage.removeItem(XIAO_ZHI_TIAO_PROMPT_STORAGE_KEY); } catch {}
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

                    {/* 2026-07-22：自定义小纸条样式（多分组 + 随机选图） */}
                    <section>
                        <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">小纸条样式</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                            上传你自己画的小纸条图，AI 写时从激活分组里随机选一张当背景，文字会居中显示。
                            <span className="text-amber-600 font-medium">推荐 PNG 格式，四周留白多一点</span>，字就不会盖到图。
                        </p>

                        <div className="flex gap-2 mb-2">
                            <select
                                value={styles.activeGroup || ''}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    persistStyles({ ...styles, activeGroup: v || null });
                                }}
                                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-xl text-xs"
                            >
                                <option value="">未激活（用 type 默认）</option>
                                {Object.keys(styles.groups).map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                            {styles.activeGroup && (
                                <button
                                    onClick={() => handleDeleteGroup(styles.activeGroup!)}
                                    className="px-3 py-2 text-rose-500 text-xs font-bold bg-rose-50 rounded-xl active:scale-95 transition-all"
                                >
                                    删组
                                </button>
                            )}
                        </div>

                        <div className="flex gap-2 mb-3">
                            <input
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNewGroup(); } }}
                                placeholder="新建分组名（如：和风便签）"
                                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200/60 rounded-xl text-xs"
                            />
                            <button
                                onClick={handleNewGroup}
                                className="px-3 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl active:scale-95 transition-all"
                            >
                                新建
                            </button>
                        </div>

                        {styles.activeGroup && (styles.groups[styles.activeGroup] || []).length > 0 && (
                            <div className="grid grid-cols-3 gap-2 mb-3">
                                {(styles.groups[styles.activeGroup] || []).map((url) => (
                                    <div key={url} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                                        <img src={url} alt="" className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => handleDeleteImage(url)}
                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 text-rose-500 text-[11px] flex items-center justify-center shadow-sm active:scale-95"
                                            title="删除这张图"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={!styles.activeGroup}
                            className="w-full py-2.5 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white text-xs font-bold shadow-md active:scale-95 transition-all disabled:opacity-40"
                        >
                            📷 上传图片到当前组
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleFile}
                            className="hidden"
                        />

                        <div className="text-[10px] text-slate-400 mt-2 text-center">
                            {styles.activeGroup
                                ? `当前激活：${styles.activeGroup}（${(styles.groups[styles.activeGroup] || []).length} 张）`
                                : '未激活分组 — 用 type 默认颜色'}
                        </div>
                    </section>

                    {/* 2026-07-22：自定义提示词 */}
                    <section>
                        <div className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-widest">AI 写小纸条的指导</div>
                        <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                            留空用默认。想让 AI 按你希望的方式写，就在这里改。
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
            {hasFilter ? '没有匹配的便签' : '小纸条还是空的'}
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

export default XiaoZhiTiaoPage;
