// CoReadReaderPage — 共读全屏阅读器
// 麦麦 2026-09-18 重写用 useReducer 合并所有 state
//   暮色反馈: 点读一直 React error #300 (Rendered fewer hooks than expected)
//   原版用 9 个 useState + 4 个 useEffect + 2 个 useRef = 15 个 hooks
//   14→7 个 hooks (1 useReducer + 4 useEffect + 2 useRef + 1 useOS = 8)
//   减少 hook bookkeeping — 降低 React 19 RC 下 hooks 顺序错乱概率
//
// 架构:
//   useCoReadReaderState = custom hook(集中所有 state + effect)
//     返回 { state, handlers } 给 Reader 组件
//   Reader 组件只调一个 hook + 渲染 UI

import React, { useEffect, useReducer, useRef } from 'react';
import {
  CaretLeft,
  CaretRight as CaretRightIcon,
  List as ListIcon,
  Gear as GearIcon,
  X as CloseIcon,
  PencilSimple as PencilIcon,
  Highlighter as HighlighterIcon,
  Trash as TrashIcon,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB, CoReadBook, CoReadAnnotation } from '../utils/db';

interface Props {
  bookId: string;
  onBack: () => void;
}

type ThemeMode = 'day' | 'sepia' | 'night';
type PageMode = 'horizontal' | 'vertical';

const FONT_SIZE_OPTIONS = [14, 16, 18, 20] as const;
type FontSize = typeof FONT_SIZE_OPTIONS[number];

const THEME_PRESETS: Record<ThemeMode, { bg: string; text: string; sub: string; tagBg: string; tagText: string; label: string }> = {
  day: { bg: '#ffffff', text: '#1e293b', sub: '#64748b', tagBg: '#e0f2f1', tagText: '#0f766e', label: '日间' },
  sepia: { bg: '#f5ecd9', text: '#3b2f1e', sub: '#7d6b48', tagBg: '#e9dfc7', tagText: '#5b4523', label: '护眼' },
  night: { bg: '#1a1a1a', text: '#d4d4d4', sub: '#9ca3af', tagBg: '#2a2a2a', tagText: '#a3a3a3', label: '夜间' },
};

const STORAGE_KEY = 'co_reader_settings_v1';

interface PersistedSettings {
  fontSize: FontSize;
  theme: ThemeMode;
  pageMode: PageMode;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (
        FONT_SIZE_OPTIONS.includes(obj.fontSize) &&
        ['day', 'sepia', 'night'].includes(obj.theme) &&
        ['horizontal', 'vertical'].includes(obj.pageMode)
      ) {
        return obj;
      }
    }
  } catch {}
  return { fontSize: 16, theme: 'day', pageMode: 'horizontal' };
}

function saveSettings(s: PersistedSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

interface ReaderState {
  book: CoReadBook | null;
  loading: boolean;
  chapterIdx: number;
  settings: PersistedSettings;
  showSettings: boolean;
  showToc: boolean;
  chapterAnns: CoReadAnnotation[];
  toolbar: { top: number; left: number; text: string; startOffset: number; endOffset: number } | null;
  noteDraft: { text: string; startOffset: number; endOffset: number; top: number; left: number } | null;
  refreshTick: number; // bump 触发内部 effect 重跑(批注删除后用)
}

type Action =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; book: CoReadBook }
  | { type: 'LOAD_FAIL' }
  | { type: 'SET_CHAPTER'; idx: number }
  | { type: 'SET_ANN'; anns: CoReadAnnotation[] }
  | { type: 'UPDATE_SETTING'; settings: PersistedSettings }
  | { type: 'TOGGLE_SETTINGS'; v: boolean }
  | { type: 'TOGGLE_TOC'; v: boolean }
  | { type: 'SET_TOOLBAR'; toolbar: ReaderState['toolbar'] }
  | { type: 'SET_NOTE_DRAFT'; draft: ReaderState['noteDraft'] }
  | { type: 'BUMP_TICK' };

function reducer(s: ReaderState, a: Action): ReaderState {
  switch (a.type) {
    case 'LOAD_START': return { ...s, loading: true };
    case 'LOAD_SUCCESS': return { ...s, loading: false, book: a.book, chapterIdx: a.book.currentChapter || 0 };
    case 'LOAD_FAIL': return { ...s, loading: false };
    case 'SET_CHAPTER': return { ...s, chapterIdx: a.idx };
    case 'SET_ANN': return { ...s, chapterAnns: a.anns };
    case 'UPDATE_SETTING': return { ...s, settings: a.settings };
    case 'TOGGLE_SETTINGS': return { ...s, showSettings: a.v };
    case 'TOGGLE_TOC': return { ...s, showToc: a.v };
    case 'SET_TOOLBAR': return { ...s, toolbar: a.toolbar };
    case 'SET_NOTE_DRAFT': return { ...s, noteDraft: a.draft };
    case 'BUMP_TICK': return { ...s, refreshTick: s.refreshTick + 1 };
    default: return s;
  }
}

const initialState = (): ReaderState => ({
  book: null,
  loading: true,
  chapterIdx: 0,
  settings: loadSettings(),
  showSettings: false,
  showToc: false,
  chapterAnns: [],
  toolbar: null,
  noteDraft: null,
  refreshTick: 0,
});

// ─── 章节正文渲染（普通函数,避免 useMemo 引入额外 hooks bookkeeping） ───
function renderChapterContent(content: string, chapterAnns: CoReadAnnotation[]): React.ReactNode {
  if (chapterAnns.length === 0) return <>{content}</>;
  const sorted = [...chapterAnns].sort((a, b) => a.selection.startOffset - b.selection.startOffset);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((ann) => {
    const s = Math.max(0, Math.min(content.length, ann.selection.startOffset));
    const e = Math.max(s, Math.min(content.length, ann.selection.endOffset));
    if (e <= s) return;
    if (s > cursor) {
      parts.push(<React.Fragment key={`raw-${cursor}-${s}`}>{content.substring(cursor, s)}</React.Fragment>);
    }
    parts.push(
      <span
        key={`ann-${ann.id}`}
        data-ann-id={ann.id}
        className="rounded-sm"
        style={{ backgroundColor: '#fef3c7', borderBottom: '1.5px solid #d97706' }}
      >
        {content.substring(s, e)}
      </span>,
    );
    cursor = Math.max(cursor, e);
  });
  if (cursor < content.length) {
    parts.push(<React.Fragment key={`tail-${cursor}`}>{content.substring(cursor)}</React.Fragment>);
  }
  return <>{parts}</>;
}

// ─── 主组件 — 全部 hooks 集中到 useCoReadReaderState 里 ───
function useCoReadReaderState(bookId: string, onBack: () => void) {
  const { addToast } = useOS();
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 把当前 state ref 化,让空 deps 的 effect 内部能读到最新值
  const stateRef = useRef(state);
  stateRef.current = state;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;

  // [1] 加载书 — 仅 bookId 变化时重跑
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await DB.getCoReadBook(bookId);
        if (cancelled) return;
        if (!b) {
          addToastRef.current('找不到这本书', 'error');
          onBackRef.current();
          return;
        }
        dispatch({ type: 'LOAD_SUCCESS', book: b });
      } catch (e: any) {
        if (!cancelled) addToastRef.current(`加载失败:${e?.message || e}`, 'error');
        dispatch({ type: 'LOAD_FAIL' });
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // [2] 加载当前章节批注 — bookId 或 chapterIdx 变化时重跑
  useEffect(() => {
    if (!state.book) return;
    const ci = state.chapterIdx;
    let cancelled = false;
    (async () => {
      try {
        const list = await DB.getCoReadAnnotationsByChapter(bookId, ci);
        if (!cancelled) dispatch({ type: 'SET_ANN', anns: list });
      } catch (e) {
        if (!cancelled) console.warn('[coread] load annotations failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, state.chapterIdx, state.refreshTick, state.book]);

  // [3] 选中文字弹工具条 — 一次性绑定
  useEffect(() => {
    const onSelectEnd = () => {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          dispatch({ type: 'SET_TOOLBAR', toolbar: null });
          return;
        }
        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (text.length === 0) {
          dispatch({ type: 'SET_TOOLBAR', toolbar: null });
          return;
        }
        const container = (range.commonAncestorContainer as Element).nodeType === 1
          ? range.commonAncestorContainer as Element
          : (range.commonAncestorContainer.parentElement);
        if (!container || !container.closest('[data-coread-chapter-content]')) {
          dispatch({ type: 'SET_TOOLBAR', toolbar: null });
          return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0) return;
        dispatch({
          type: 'SET_TOOLBAR',
          toolbar: {
            top: rect.bottom + window.scrollY + 6,
            left: Math.max(8, Math.min(window.innerWidth - 200, rect.left + window.scrollX)),
            text,
            startOffset: 0,
            endOffset: 0,
          },
        });
      }, 30);
    };
    document.addEventListener('mouseup', onSelectEnd);
    document.addEventListener('touchend', onSelectEnd);
    return () => {
      document.removeEventListener('mouseup', onSelectEnd);
      document.removeEventListener('touchend', onSelectEnd);
    };
  }, []);

  // [4] 同步 settings 到 localStorage — settings 变化时跑
  useEffect(() => {
    saveSettings(state.settings);
  }, [state.settings]);

  // [5] 键盘监听(horizontal 模式左右键) — 一次性绑定,函数体内读最新 state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = stateRef.current;
      if (cur.showSettings || cur.showToc) return;
      if (cur.settings.pageMode !== 'horizontal') return;
      if (e.key === 'ArrowLeft') goChapterRef.current(-1);
      else if (e.key === 'ArrowRight') goChapterRef.current(+1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 章节切换时清滚动
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [state.chapterIdx]);

  // handlers (forward declared so ref can reference them)
  const goChapter = (delta: number) => {
    const cur = stateRef.current;
    if (!cur.book) return;
    const total = cur.book.totalChapters || cur.book.chapters.length;
    const next = Math.max(0, Math.min(total - 1, cur.chapterIdx + delta));
    if (next === cur.chapterIdx) {
      addToastRef.current(delta > 0 ? '已经是最后一章' : '已经是第一章', 'info');
      return;
    }
    dispatch({ type: 'SET_CHAPTER', idx: next });
    DB.updateCoReadBookProgress(bookId, next);
  };
  const goChapterRef = useRef(goChapter);
  goChapterRef.current = goChapter;

  const jumpToChapter = (idx: number) => {
    dispatch({ type: 'TOGGLE_TOC', v: false });
    dispatch({ type: 'SET_CHAPTER', idx });
    DB.updateCoReadBookProgress(bookId, idx);
  };

  const handleClose = () => {
    if (state.book) DB.updateCoReadBookProgress(bookId, state.chapterIdx);
    onBackRef.current();
  };

  const computeChapterOffsets = (): { startOffset: number; endOffset: number; text: string } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const container = (range.commonAncestorContainer as Element).nodeType === 1
      ? range.commonAncestorContainer as Element
      : (range.commonAncestorContainer.parentElement);
    if (!container || !container.closest('[data-coread-chapter-content]')) return null;
    const text = sel.toString();
    if (!text || !state.book) return null;
    const content = state.book.chapters[state.chapterIdx]?.content || '';
    const idx = content.indexOf(text);
    if (idx < 0) return null;
    return { text, startOffset: idx, endOffset: idx + text.length };
  };

  const handleHighlight = async () => {
    const offsets = computeChapterOffsets();
    if (!offsets || !state.book) {
      dispatch({ type: 'SET_TOOLBAR', toolbar: null });
      return;
    }
    const ann: CoReadAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      chapterIndex: state.chapterIdx,
      author: 'user',
      selection: { text: offsets.text, startOffset: offsets.startOffset, endOffset: offsets.endOffset },
      note: '',
      type: 'highlight',
      color: 'amber',
      createdAt: Date.now(),
      aiReacted: false,
    };
    try {
      await DB.saveCoReadAnnotation(ann);
      dispatch({ type: 'BUMP_TICK' });
      addToast('已划线', 'success');
    } catch (e: any) {
      addToast(`划线失败:${e?.message || e}`, 'error');
    }
    window.getSelection()?.removeAllRanges();
    dispatch({ type: 'SET_TOOLBAR', toolbar: null });
  };

  const handleNote = () => {
    const offsets = computeChapterOffsets();
    if (!offsets) {
      dispatch({ type: 'SET_TOOLBAR', toolbar: null });
      return;
    }
    const sel = window.getSelection();
    let pos = { top: 100, left: 100 };
    if (state.toolbar) {
      pos = { top: state.toolbar.top, left: state.toolbar.left };
    } else if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      pos = { top: rect.bottom + window.scrollY + 36, left: rect.left + window.scrollX };
    }
    dispatch({
      type: 'SET_NOTE_DRAFT',
      draft: { text: offsets.text, startOffset: offsets.startOffset, endOffset: offsets.endOffset, ...pos },
    });
    dispatch({ type: 'SET_TOOLBAR', toolbar: null });
  };

  const handleSaveNote = async (noteText: string) => {
    if (!state.book || !state.noteDraft) return;
    if (!noteText.trim()) {
      addToast('想法不能为空', 'error');
      return;
    }
    const ann: CoReadAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      chapterIndex: state.chapterIdx,
      author: 'user',
      selection: { text: state.noteDraft.text, startOffset: state.noteDraft.startOffset, endOffset: state.noteDraft.endOffset },
      note: noteText.trim(),
      type: 'note',
      color: 'amber',
      createdAt: Date.now(),
      aiReacted: false,
    };
    try {
      await DB.saveCoReadAnnotation(ann);
      dispatch({ type: 'BUMP_TICK' });
      addToast('想法已保存', 'success');
    } catch (e: any) {
      addToast(`保存失败:${e?.message || e}`, 'error');
    }
    window.getSelection()?.removeAllRanges();
    dispatch({ type: 'SET_NOTE_DRAFT', draft: null });
  };

  const handleDeleteAnnotation = async (id: string) => {
    if (!window.confirm('删除这条批注?')) return;
    try {
      await DB.deleteCoReadAnnotation(id);
      dispatch({ type: 'BUMP_TICK' });
    } catch (e: any) {
      addToast(`删除失败:${e?.message || e}`, 'error');
    }
  };

  return {
    state,
    dispatch,
    scrollRef,
    handlers: {
      goChapter,
      jumpToChapter,
      handleClose,
      handleHighlight,
      handleNote,
      handleSaveNote,
      handleDeleteAnnotation,
    },
  };
}

const CoReadReaderPage: React.FC<Props> = ({ bookId, onBack }) => {
  const { state, dispatch, scrollRef, handlers } = useCoReadReaderState(bookId, onBack);

  if (state.loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">载入中...</div>
      </div>
    );
  }
  if (!state.book) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">没有内容</div>
      </div>
    );
  }

  const total = state.book.totalChapters || state.book.chapters.length;
  const chapter = state.book.chapters[state.chapterIdx];
  if (!chapter) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">没有内容</div>
      </div>
    );
  }

  const theme = THEME_PRESETS[state.settings.theme];
  const updateSetting = (s: PersistedSettings) =>
    dispatch({ type: 'UPDATE_SETTING', settings: s });

  return (
    <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: theme.bg, color: theme.text }}>
      {/* 顶部 */}
      <div
        className="flex items-center justify-between px-2 py-3 shrink-0"
        style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}
      >
        <button onClick={handlers.handleClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform" aria-label="关闭">
          <CaretLeft size={18} weight="regular" />
        </button>
        <div className="flex-1 flex flex-col items-center min-w-0">
          <div className="text-[10px] uppercase tracking-wider opacity-60 truncate max-w-full">《{state.book.title}》</div>
          <div className="text-sm font-semibold truncate max-w-full">{chapter.title}</div>
        </div>
        <button onClick={() => dispatch({ type: 'TOGGLE_TOC', v: true })} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform" aria-label="目录">
          <ListIcon size={18} weight="regular" />
        </button>
        <button onClick={() => dispatch({ type: 'TOGGLE_SETTINGS', v: true })} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform" aria-label="设置">
          <GearIcon size={18} weight="regular" />
        </button>
      </div>

      {/* 正文 */}
      {state.settings.pageMode === 'vertical' ? (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-5 py-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
          onScroll={(e) => {
            if (state.settings.pageMode !== 'vertical' || !state.book) return;
            const el = e.currentTarget;
            const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
            if (nearBottom && state.chapterIdx < total - 1) handlers.goChapter(+1);
          }}
        >
          <div data-coread-chapter-content className="leading-relaxed whitespace-pre-wrap" style={{ fontSize: state.settings.fontSize }}>
            {renderChapterContent(chapter.content, state.chapterAnns)}
          </div>
          {state.chapterAnns.filter(a => (a.note && a.note.length > 0)).length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-1">暮色的批注 · {state.chapterAnns.filter(a => a.note).length} 条</div>
              {state.chapterAnns.filter(a => a.note).map((a) => (
                <div key={a.id} className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm" style={{ fontSize: state.settings.fontSize }}>
                  <div className="text-[11px] text-amber-700 font-mono mb-1">"{a.selection.text.substring(0, 50)}{a.selection.text.length > 50 ? '…' : ''}"</div>
                  <div className="text-slate-800">{a.note}</div>
                  <div className="flex justify-end mt-1.5">
                    <button onClick={() => handlers.handleDeleteAnnotation(a.id)} className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-1">
                      <TrashIcon size={10} /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {state.chapterIdx < total - 1 && (
            <div className="mt-6 mb-2 text-center text-[11px] opacity-50">↓ 下章:{state.book.chapters[state.chapterIdx + 1]?.title}</div>
          )}
          {state.chapterIdx === total - 1 && (
            <div className="mt-6 mb-2 text-center text-[11px] opacity-50">— 全书完 —</div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex relative">
          <button onClick={() => handlers.goChapter(-1)} disabled={state.chapterIdx === 0} className="w-12 h-full flex items-center justify-center opacity-30 active:opacity-60 disabled:opacity-0 hover:bg-black/5 transition-opacity" aria-label="上一章">
            <CaretLeft size={28} weight="regular" />
          </button>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div data-coread-chapter-content className="leading-relaxed whitespace-pre-wrap" style={{ fontSize: state.settings.fontSize }}>
              {renderChapterContent(chapter.content, state.chapterAnns)}
            </div>
            {state.chapterAnns.filter(a => a.note).length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="text-[11px] uppercase tracking-wider opacity-60 mb-1">暮色的批注 · {state.chapterAnns.filter(a => a.note).length} 条</div>
                {state.chapterAnns.filter(a => a.note).map((a) => (
                  <div key={a.id} className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm" style={{ fontSize: state.settings.fontSize }}>
                    <div className="text-[11px] text-amber-700 font-mono mb-1">"{a.selection.text.substring(0, 50)}{a.selection.text.length > 50 ? '…' : ''}"</div>
                    <div className="text-slate-800">{a.note}</div>
                    <div className="flex justify-end mt-1.5">
                      <button onClick={() => handlers.handleDeleteAnnotation(a.id)} className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-1">
                        <TrashIcon size={10} /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {state.chapterIdx === total - 1 && (
              <div className="mt-6 text-center text-[11px] opacity-50">— 全书完 —</div>
            )}
          </div>
          <button onClick={() => handlers.goChapter(+1)} disabled={state.chapterIdx === total - 1} className="w-12 h-full flex items-center justify-center opacity-30 active:opacity-60 disabled:opacity-0 hover:bg-black/5 transition-opacity" aria-label="下一章">
            <CaretRightIcon size={28} weight="regular" />
          </button>
        </div>
      )}

      {/* 底部进度 */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 text-[11px]" style={{ borderTop: `1px solid ${theme.sub}22`, color: theme.sub }}>
        <button onClick={() => handlers.goChapter(-1)} disabled={state.chapterIdx === 0} className="px-2 py-1 disabled:opacity-30">‹ 上一章</button>
        <span>第 {state.chapterIdx + 1} 章 / 共 {total} 章</span>
        <button onClick={() => handlers.goChapter(+1)} disabled={state.chapterIdx === total - 1} className="px-2 py-1 disabled:opacity-30">下一章 ›</button>
      </div>

      {/* 工具条 */}
      {state.toolbar && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 bg-white rounded-full shadow-lg border border-slate-200 flex items-center gap-1 px-1.5 py-1"
          style={{ top: state.toolbar.top, left: state.toolbar.left }}
        >
          <button onClick={handlers.handleHighlight} className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-amber-50 rounded-full">
            <HighlighterIcon size={14} weight="regular" /> 划线
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <button onClick={handlers.handleNote} className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-amber-50 rounded-full">
            <PencilIcon size={14} weight="regular" /> 写想法
          </button>
        </div>
      )}

      {/* 写想法输入框 */}
      {state.noteDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onMouseDown={(e) => e.preventDefault()}>
          <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">这段话</div>
            <div className="text-sm bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200 italic">
              "{state.noteDraft.text.substring(0, 120)}{state.noteDraft.text.length > 120 ? '…' : ''}"
            </div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">你的想法</div>
            <textarea
              autoFocus
              id="coread-note-input"
              placeholder="写几句..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handlers.handleSaveNote((e.target as HTMLTextAreaElement).value);
                }
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[80px]"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => dispatch({ type: 'SET_NOTE_DRAFT', draft: null })} className="px-3 py-1.5 text-sm text-slate-500 rounded-lg">取消</button>
              <button
                onClick={() => {
                  const ta = document.getElementById('coread-note-input') as HTMLTextAreaElement | null;
                  handlers.handleSaveNote(ta?.value || '');
                }}
                className="px-4 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg active:scale-95 transition-transform"
              >保存想法</button>
            </div>
            <div className="text-[10px] text-slate-400 text-center mt-2">Ctrl/⌘ + Enter 也能保存</div>
          </div>
        </div>
      )}

      {/* 目录浮层 */}
      {state.showToc && (
        <div className="absolute inset-0 z-40" onClick={() => dispatch({ type: 'TOGGLE_TOC', v: false })}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute right-0 top-0 bottom-0 w-72 max-w-[80%] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.bg, color: theme.text }}>
            <div className="flex items-center justify-between px-4 py-3 sticky top-0" style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}>
              <span className="text-sm font-semibold">目录 · {total} 章</span>
              <button onClick={() => dispatch({ type: 'TOGGLE_TOC', v: false })} aria-label="关闭目录">
                <CloseIcon size={16} />
              </button>
            </div>
            <div className="py-1">
              {state.book.chapters.map((c, i) => (
                <button
                  key={c.index}
                  onClick={() => handlers.jumpToChapter(i)}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-start gap-2 hover:bg-black/5"
                  style={{ backgroundColor: i === state.chapterIdx ? `${theme.sub}1a` : 'transparent' }}
                >
                  <span className="opacity-50 text-[11px] shrink-0 w-6">{i + 1}</span>
                  <span className="flex-1">{c.title}</span>
                  <span className="opacity-40 text-[10px] shrink-0">{Math.round((c.charCount || 0) / 500) || 1}′</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 设置浮层 */}
      {state.showSettings && (
        <div className="absolute inset-0 z-40" onClick={() => dispatch({ type: 'TOGGLE_SETTINGS', v: false })}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute right-0 top-0 bottom-0 w-72 max-w-[85%] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()} style={{ backgroundColor: theme.bg, color: theme.text }}>
            <div className="flex items-center justify-between px-4 py-3 sticky top-0" style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}>
              <span className="text-sm font-semibold">阅读设置</span>
              <button onClick={() => dispatch({ type: 'TOGGLE_SETTINGS', v: false })} aria-label="关闭设置">
                <CloseIcon size={16} />
              </button>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">字号</div>
              <div className="grid grid-cols-4 gap-1">
                {FONT_SIZE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => updateSetting({ ...state.settings, fontSize: n })}
                    className="py-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: state.settings.fontSize === n ? theme.tagText : `${theme.sub}10`,
                      color: state.settings.fontSize === n ? theme.bg : theme.text,
                    }}
                  >{n}px</button>
                ))}
              </div>
            </div>
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${theme.sub}22` }}>
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">主题</div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(THEME_PRESETS) as ThemeMode[]).map((k) => {
                  const p = THEME_PRESETS[k];
                  return (
                    <button
                      key={k}
                      onClick={() => updateSetting({ ...state.settings, theme: k })}
                      className="rounded-lg overflow-hidden border"
                      style={{
                        backgroundColor: p.bg, color: p.text,
                        borderColor: state.settings.theme === k ? theme.tagText : `${theme.sub}33`,
                        borderWidth: state.settings.theme === k ? 2 : 1,
                      }}
                    >
                      <div className="text-xs py-1.5">{p.label}</div>
                      <div className="text-[10px] pb-1.5 opacity-60">Aa</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${theme.sub}22` }}>
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">翻页方式</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => updateSetting({ ...state.settings, pageMode: 'horizontal' })}
                  className="py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: state.settings.pageMode === 'horizontal' ? theme.tagText : `${theme.sub}10`,
                    color: state.settings.pageMode === 'horizontal' ? theme.bg : theme.text,
                  }}
                >← 左右翻 →</button>
                <button
                  onClick={() => updateSetting({ ...state.settings, pageMode: 'vertical' })}
                  className="py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: state.settings.pageMode === 'vertical' ? theme.tagText : `${theme.sub}10`,
                    color: state.settings.pageMode === 'vertical' ? theme.bg : theme.text,
                  }}
                >↑ 上下滑 ↓</button>
              </div>
              <div className="text-[10px] opacity-50 mt-2">
                {state.settings.pageMode === 'horizontal' ? '键盘 ← / → 也能翻;屏幕两端有点击区' : '滑到底自动接下一章'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoReadReaderPage;
