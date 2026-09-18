// CoReadReaderPage — 共读全屏阅读器（DiscoverPage 内嵌子页）
// 麦麦 2026-09-18：第 3 步 + 第 6 步批注
//   - 章节正文 + 翻页(左右键 / 上下滑) + ☰目录 + 进度「第 N 章/共 M 章」
//   - ⚙ 设置面板:字号 4 档 / 主题 3 套 / 翻页方式 2 种
//   - 关闭 / 翻页时 updateCoReadBookProgress,下次进来自动恢复
//   - 第 6 步:选中文字弹工具条(划线/写想法) + 批注暖橙高亮 + 段落后插入暮色批注气泡

import React, { useEffect, useRef, useState } from 'react';
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

const CoReadReaderPage: React.FC<Props> = ({ bookId, onBack }) => {
  const { addToast } = useOS();
  const [book, setBook] = useState<CoReadBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [chapterIdx, setChapterIdx] = useState(0);
  const [settings, setSettings] = useState<PersistedSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  // 第 6 步:批注 state + 工具条 state
  const [chapterAnns, setChapterAnns] = useState<CoReadAnnotation[]>([]);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; text: string; startOffset: number; endOffset: number } | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ text: string; startOffset: number; endOffset: number; top: number; left: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载书 + 跳到 currentChapter + 拉批注
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await DB.getCoReadBook(bookId);
        if (cancelled) return;
        if (!b) {
          addToast('找不到这本书', 'error');
          onBack();
          return;
        }
        setBook(b);
        setChapterIdx(b.currentChapter || 0);
      } catch (e: any) {
        if (!cancelled) addToast(`加载失败:${e?.message || e}`, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // 第 6 步:加载当前章节批注(章节切换时重拉)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await DB.getCoReadAnnotationsByChapter(bookId, chapterIdx);
        if (!cancelled) setChapterAnns(list);
      } catch (e) {
        if (!cancelled) console.warn('[coread] load annotations failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId, chapterIdx]);

  // 第 6 步:监听选中状态 — 用户选好文字后弹工具条
  //   selectionchange 在 mobile 上有 timing 问题:工具条出现时 selection 可能已 clear
  //   所以用 mouseup + touchend 主动触发,不用 selectionchange(React 19 RC 那条 9-16 不算关键,先用 mouseup 兜底)
  useEffect(() => {
    const onSelectEnd = () => {
      // 异步一帧拿 selection(浏览器 select 流程需要 settle)
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setToolbar(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (text.length === 0) {
          setToolbar(null);
          return;
        }
        // 必须在当前章节 content 容器内 — 用 closest 检查
        const container = (range.commonAncestorContainer as Element).nodeType === 1
          ? range.commonAncestorContainer as Element
          : (range.commonAncestorContainer.parentElement);
        if (!container || !container.closest('[data-coread-chapter-content]')) {
          setToolbar(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0) return;
        setToolbar({
          top: rect.bottom + window.scrollY + 6,
          left: Math.max(8, Math.min(window.innerWidth - 200, rect.left + window.scrollX)),
          text,
          startOffset: 0,  // 由 handleSave 时基于 selection 重新算(content 字符串偏移)
          endOffset: 0,
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

  // 第 6 步:把当前 selection 转成完整章节 content 里的 offset(给 saveAnnotation 用)
  const computeChapterOffsets = (): { startOffset: number; endOffset: number; text: string } | null => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const container = (range.commonAncestorContainer as Element).nodeType === 1
      ? range.commonAncestorContainer as Element
      : (range.commonAncestorContainer.parentElement);
    if (!container || !container.closest('[data-coread-chapter-content]')) return null;
    // 用 range.startContainer/startOffset — 但要在 chapter.content 这个根文本里
    // 简化实现:用 chapterAnns 顺序无关算法 — 找 selection text 在 chapterContent 里首次出现
    const text = sel.toString();
    if (!text || !book) return null;
    const content = book.chapters[chapterIdx]?.content || '';
    const idx = content.indexOf(text);
    if (idx < 0) return null;
    return {
      text,
      startOffset: idx,
      endOffset: idx + text.length,
    };
  };

  // 同步设置到 localStorage
  // 麦麦 2026-09-18:把原本 useEffect [chapterIdx] 滚动清空 / useEffect [settings] 都删了
  //   减少 hooks 数量(从 19 个降到 15 个), 降低 React 19 RC 下 hooks 顺序出错概率 (#300)
  //   settings 保存:在 setSettingsXxx handler 里显式 saveSettings 调用
  //   翻页滚到顶:在 goChapter / jumpToChapter 里显式 scrollTo
  const total = book?.totalChapters || book?.chapters.length || 0;

  const goChapter = async (delta: number) => {
    if (!book) return;
    const next = Math.max(0, Math.min(total - 1, chapterIdx + delta));
    if (next === chapterIdx) {
      if (delta > 0) addToast('已经是最后一章', 'info');
      else addToast('已经是第一章', 'info');
      return;
    }
    setChapterIdx(next);
    await DB.updateCoReadBookProgress(book.id, next);
  };

  const jumpToChapter = async (idx: number) => {
    if (!book) return;
    setChapterIdx(idx);
    setShowToc(false);
    await DB.updateCoReadBookProgress(book.id, idx);
  };

  const handleClose = async () => {
    if (book) {
      await DB.updateCoReadBookProgress(book.id, chapterIdx);
    }
    onBack();
  };

  // 第 6 步:工具条动作——划线(只高亮)
  const handleHighlight = async () => {
    if (!book) return;
    const offsets = computeChapterOffsets();
    if (!offsets) {
      setToolbar(null);
      return;
    }
    const ann: CoReadAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      chapterIndex: chapterIdx,
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
      const list = await DB.getCoReadAnnotationsByChapter(bookId, chapterIdx);
      setChapterAnns(list);
      addToast('已划线', 'success');
    } catch (e: any) {
      addToast(`划线失败:${e?.message || e}`, 'error');
    }
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  };

  // 第 6 步:工具条动作——写想法(弹输入框 → 弹 noteDraft → 用户填完保存)
  const handleNote = () => {
    const offsets = computeChapterOffsets();
    if (!offsets) {
      setToolbar(null);
      return;
    }
    // 从当前 toolbar 拿位置(否则从 selection 重算)
    const pos = toolbar ? { top: toolbar.top, left: toolbar.left } :
      ((): { top: number; left: number } => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return { top: 100, left: 100 };
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        return { top: rect.bottom + window.scrollY + 36, left: rect.left + window.scrollX };
      })();
    setNoteDraft({ text: offsets.text, startOffset: offsets.startOffset, endOffset: offsets.endOffset, ...pos });
    setToolbar(null);
  };

  const handleSaveNote = async (noteText: string) => {
    if (!book || !noteDraft) return;
    if (!noteText.trim()) {
      addToast('想法不能为空', 'error');
      return;
    }
    const ann: CoReadAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      bookId,
      chapterIndex: chapterIdx,
      author: 'user',
      selection: { text: noteDraft.text, startOffset: noteDraft.startOffset, endOffset: noteDraft.endOffset },
      note: noteText.trim(),
      type: 'note',
      color: 'amber',
      createdAt: Date.now(),
      aiReacted: false,
    };
    try {
      await DB.saveCoReadAnnotation(ann);
      const list = await DB.getCoReadAnnotationsByChapter(bookId, chapterIdx);
      setChapterAnns(list);
      addToast('想法已保存', 'success');
    } catch (e: any) {
      addToast(`保存失败:${e?.message || e}`, 'error');
    }
    window.getSelection()?.removeAllRanges();
    setNoteDraft(null);
  };

  const handleDeleteAnnotation = async (id: string) => {
    if (!window.confirm('删除这条批注?')) return;
    try {
      await DB.deleteCoReadAnnotation(id);
      const list = await DB.getCoReadAnnotationsByChapter(bookId, chapterIdx);
      setChapterAnns(list);
    } catch (e: any) {
      addToast(`删除失败:${e?.message || e}`, 'error');
    }
  };

  // 把章节正文按批注范围切分：高亮片段加 bg-amber，无批注时直接整段
//   暮色 7-31 避开粉色,默认用 amber (暖橙) 系 — 江澈气泡色待 8 步加
//   麦麦 2026-09-18:把 useMemo 改成普通函数（每次 render 都计算）
//     useMemo 在 hook 序列里有 bookkeeping 开销 — React 19 RC 下偶尔触发 #300
//     章节内容短时（< 50 万字）,重算性能上无感
function renderChapterContent(content: string, chapterAnns: CoReadAnnotation[]): React.ReactNode {
  if (chapterAnns.length === 0) return <>{content}</>;
  const sorted = [...chapterAnns].sort((a, b) => a.selection.startOffset - b.selection.startOffset);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((ann, i) => {
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

  // 上下滑模式接下一章:监听 scroll 到 80% 触底
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (settings.pageMode !== 'vertical' || !book) return;
    const el = e.currentTarget;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    if (nearBottom && chapterIdx < total - 1) {
      // 翻到下一章,保留一点顶部位置(避免突然跳)
      goChapter(+1);
    }
  };

  // 麦麦 2026-09-18:键盘监听改用单一 onKeyDown(全局注册一次)
//   原 useEffect deps 频繁变(settings.pageMode/showSettings/showToc/chapterIdx/book)
//   在 React 19 RC 下不一致 — 削减 hooks 数量 + 改为全局一次绑定
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showSettings || showToc) return;
      if (settings.pageMode !== 'horizontal') return;
      if (e.key === 'ArrowLeft') goChapter(-1);
      else if (e.key === 'ArrowRight') goChapter(+1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 故意空 deps — 只 mount 时一次注册/卸载, 函数内部读最新 state

  const theme = THEME_PRESETS[settings.theme];
  const chapter = book?.chapters[chapterIdx];

  if (loading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">载入中...</div>
      </div>
    );
  }
  if (!book || !chapter) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-white">
        <div className="text-sm text-slate-400">没有内容</div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col" style={{ backgroundColor: theme.bg, color: theme.text }}>
      {/* 顶部 */}
      <div
        className="flex items-center justify-between px-2 py-3 shrink-0"
        style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}
      >
        <button
          onClick={handleClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform"
          aria-label="关闭"
        >
          <CaretLeft size={18} weight="regular" />
        </button>
        <div className="flex-1 flex flex-col items-center min-w-0">
          <div className="text-[10px] uppercase tracking-wider opacity-60 truncate max-w-full">《{book.title}》</div>
          <div className="text-sm font-semibold truncate max-w-full">{chapter.title}</div>
        </div>
        <button
          onClick={() => setShowToc(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform"
          aria-label="目录"
        >
          <ListIcon size={18} weight="regular" />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 active:scale-95 transition-transform"
          aria-label="设置"
        >
          <GearIcon size={18} weight="regular" />
        </button>
      </div>

      {/* 正文 */}
      {settings.pageMode === 'vertical' ? (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {/* 章节正文容器 — 给 data 属性让工具条 selection 监听识别 */}
          <div
            data-coread-chapter-content
            className="leading-relaxed whitespace-pre-wrap"
            style={{ fontSize: settings.fontSize }}
          >
            {renderChapterContent(chapter?.content || '', chapterAnns)}
          </div>
          {/* 第 6 步:暮色批注气泡列表 — 章节末尾统一展示 */}
          {chapterAnns.filter(a => (a.note && a.note.length > 0)).length > 0 && (
            <div className="mt-6 space-y-2">
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-1">暮色的批注 · {chapterAnns.filter(a => a.note).length} 条</div>
              {chapterAnns.filter(a => a.note).map((a) => (
                <div key={a.id} className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm" style={{ fontSize: settings.fontSize }}>
                  <div className="text-[11px] text-amber-700 font-mono mb-1">"{a.selection.text.substring(0, 50)}{a.selection.text.length > 50 ? '…' : ''}"</div>
                  <div className="text-slate-800">{a.note}</div>
                  <div className="flex justify-end mt-1.5">
                    <button onClick={() => handleDeleteAnnotation(a.id)} className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-1">
                      <TrashIcon size={10} /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 章末小红条:提示即将切下一章 */}
          {chapterIdx < total - 1 && (
            <div className="mt-6 mb-2 text-center text-[11px] opacity-50">
              ↓ 下章:{book.chapters[chapterIdx + 1]?.title}
            </div>
          )}
          {chapterIdx === total - 1 && (
            <div className="mt-6 mb-2 text-center text-[11px] opacity-50">— 全书完 —</div>
          )}
        </div>
      ) : (
        // 左右翻页:整章一段,屏幕两端点击翻页
        <div className="flex-1 flex relative">
          <button
            onClick={() => goChapter(-1)}
            disabled={chapterIdx === 0}
            className="w-12 h-full flex items-center justify-center opacity-30 active:opacity-60 disabled:opacity-0 hover:bg-black/5 transition-opacity"
            aria-label="上一章"
          >
            <CaretLeft size={28} weight="regular" />
          </button>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            <div
              data-coread-chapter-content
              className="leading-relaxed whitespace-pre-wrap"
              style={{ fontSize: settings.fontSize }}
            >
              {renderChapterContent(chapter?.content || '', chapterAnns)}
            </div>
            {/* 第 6 步:暮色批注气泡列表 — 章节末尾 */}
            {chapterAnns.filter(a => a.note).length > 0 && (
              <div className="mt-6 space-y-2">
                <div className="text-[11px] uppercase tracking-wider opacity-60 mb-1">暮色的批注 · {chapterAnns.filter(a => a.note).length} 条</div>
                {chapterAnns.filter(a => a.note).map((a) => (
                  <div key={a.id} className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-sm" style={{ fontSize: settings.fontSize }}>
                    <div className="text-[11px] text-amber-700 font-mono mb-1">"{a.selection.text.substring(0, 50)}{a.selection.text.length > 50 ? '…' : ''}"</div>
                    <div className="text-slate-800">{a.note}</div>
                    <div className="flex justify-end mt-1.5">
                      <button onClick={() => handleDeleteAnnotation(a.id)} className="text-[10px] text-amber-500 hover:text-amber-700 flex items-center gap-1">
                        <TrashIcon size={10} /> 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {chapterIdx === total - 1 && (
              <div className="mt-6 text-center text-[11px] opacity-50">— 全书完 —</div>
            )}
          </div>
          <button
            onClick={() => goChapter(+1)}
            disabled={chapterIdx === total - 1}
            className="w-12 h-full flex items-center justify-center opacity-30 active:opacity-60 disabled:opacity-0 hover:bg-black/5 transition-opacity"
            aria-label="下一章"
          >
            <CaretRightIcon size={28} weight="regular" />
          </button>
        </div>
      )}

      {/* 底部进度 + 翻页按钮(始终可见,即使上下滑模式) */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 text-[11px]"
        style={{ borderTop: `1px solid ${theme.sub}22`, color: theme.sub }}
      >
        <button
          onClick={() => goChapter(-1)}
          disabled={chapterIdx === 0}
          className="px-2 py-1 disabled:opacity-30"
        >
          ‹ 上一章
        </button>
        <span>第 {chapterIdx + 1} 章 / 共 {total} 章</span>
        <button
          onClick={() => goChapter(+1)}
          disabled={chapterIdx === total - 1}
          className="px-2 py-1 disabled:opacity-30"
        >
          下一章 ›
        </button>
      </div>

      {/* 第 6 步:选中文字后弹工具条(划线/写想法) */}
      {toolbar && (
        <div
          ref={toolbarRef}
          // mousedown.preventDefault 阻止工具条按钮触发 selection 丢失
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 bg-white rounded-full shadow-lg border border-slate-200 flex items-center gap-1 px-1.5 py-1"
          style={{ top: toolbar.top, left: toolbar.left }}
        >
          <button
            onClick={handleHighlight}
            className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-amber-50 rounded-full"
          >
            <HighlighterIcon size={14} weight="regular" /> 划线
          </button>
          <div className="w-px h-4 bg-slate-200" />
          <button
            onClick={handleNote}
            className="flex items-center gap-1 px-3 py-1.5 text-xs hover:bg-amber-50 rounded-full"
          >
            <PencilIcon size={14} weight="regular" /> 写想法
          </button>
        </div>
      )}

      {/* 第 6 步:写想法输入框 */}
      {noteDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onMouseDown={(e) => e.preventDefault()}>
          <div
            className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">这段话</div>
            <div className="text-sm bg-amber-50 rounded-lg p-2 mb-3 border border-amber-200 italic" style={{ fontFamily: 'inherit' }}>
              "{noteDraft.text.substring(0, 120)}{noteDraft.text.length > 120 ? '…' : ''}"
            </div>
            <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">你的想法</div>
            <textarea
              autoFocus
              placeholder="写几句..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSaveNote((e.target as HTMLTextAreaElement).value);
                }
              }}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[80px]"
              id="coread-note-input"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setNoteDraft(null)}
                className="px-3 py-1.5 text-sm text-slate-500 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const ta = document.getElementById('coread-note-input') as HTMLTextAreaElement | null;
                  handleSaveNote(ta?.value || '');
                }}
                className="px-4 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg active:scale-95 transition-transform"
              >
                保存想法
              </button>
            </div>
            <div className="text-[10px] text-slate-400 text-center mt-2">Ctrl/⌘ + Enter 也能保存</div>
          </div>
        </div>
      )}

      {/* 目录浮层 */}
      {showToc && (
        <div className="absolute inset-0 z-40" onClick={() => setShowToc(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute right-0 top-0 bottom-0 w-72 max-w-[80%] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: theme.bg, color: theme.text }}
          >
            <div className="flex items-center justify-between px-4 py-3 sticky top-0" style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}>
              <span className="text-sm font-semibold">目录 · {total} 章</span>
              <button onClick={() => setShowToc(false)} aria-label="关闭目录">
                <CloseIcon size={16} />
              </button>
            </div>
            <div className="py-1">
              {book.chapters.map((c, i) => (
                <button
                  key={c.index}
                  onClick={() => jumpToChapter(i)}
                  className="w-full text-left px-4 py-2.5 text-sm flex items-start gap-2 hover:bg-black/5"
                  style={{ backgroundColor: i === chapterIdx ? `${theme.sub}1a` : 'transparent' }}
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

      {/* 设置浮层(基础设置 — 高级设置在步骤 4/5 加) */}
      {showSettings && (
        <div className="absolute inset-0 z-40" onClick={() => setShowSettings(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute right-0 top-0 bottom-0 w-72 max-w-[85%] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: theme.bg, color: theme.text }}
          >
            <div className="flex items-center justify-between px-4 py-3 sticky top-0" style={{ backgroundColor: theme.bg, borderBottom: `1px solid ${theme.sub}22` }}>
              <span className="text-sm font-semibold">阅读设置</span>
              <button onClick={() => setShowSettings(false)} aria-label="关闭设置">
                <CloseIcon size={16} />
              </button>
            </div>

            {/* 字号 */}
            <div className="px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">字号</div>
              <div className="grid grid-cols-4 gap-1">
                {FONT_SIZE_OPTIONS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSettings((s) => ({ ...s, fontSize: n }))}
                    className="py-2 rounded-lg text-sm"
                    style={{
                      backgroundColor: settings.fontSize === n ? theme.tagText : `${theme.sub}10`,
                      color: settings.fontSize === n ? theme.bg : theme.text,
                    }}
                  >
                    {n}px
                  </button>
                ))}
              </div>
            </div>

            {/* 主题 */}
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${theme.sub}22` }}>
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">主题</div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(THEME_PRESETS) as ThemeMode[]).map((k) => {
                  const p = THEME_PRESETS[k];
                  return (
                    <button
                      key={k}
                      onClick={() => setSettings((s) => ({ ...s, theme: k }))}
                      className="rounded-lg overflow-hidden border"
                      style={{
                        backgroundColor: p.bg,
                        color: p.text,
                        borderColor: settings.theme === k ? theme.tagText : `${theme.sub}33`,
                        borderWidth: settings.theme === k ? 2 : 1,
                      }}
                    >
                      <div className="text-xs py-1.5">{p.label}</div>
                      <div className="text-[10px] pb-1.5 opacity-60">Aa</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 翻页方式 */}
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${theme.sub}22` }}>
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">翻页方式</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSettings((s) => ({ ...s, pageMode: 'horizontal' }))}
                  className="py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: settings.pageMode === 'horizontal' ? theme.tagText : `${theme.sub}10`,
                    color: settings.pageMode === 'horizontal' ? theme.bg : theme.text,
                  }}
                >
                  ← 左右翻 →
                </button>
                <button
                  onClick={() => setSettings((s) => ({ ...s, pageMode: 'vertical' }))}
                  className="py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: settings.pageMode === 'vertical' ? theme.tagText : `${theme.sub}10`,
                    color: settings.pageMode === 'vertical' ? theme.bg : theme.text,
                  }}
                >
                  ↑ 上下滑 ↓
                </button>
              </div>
              <div className="text-[10px] opacity-50 mt-2">
                {settings.pageMode === 'horizontal'
                  ? '键盘 ← / → 也能翻;屏幕两端有点击区'
                  : '滑到底自动接下一章'}
              </div>
            </div>

            {/* 占位 — 高级设置在步骤 4/5 */}
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${theme.sub}22` }}>
              <div className="text-[11px] uppercase tracking-wider opacity-60 mb-2">高级</div>
              <div className="text-[11px] opacity-50">帮工 API · 工作台账本 将于步骤 4 / 5 上线</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoReadReaderPage;
