// CoReadFloatingWindow — 共读浮窗（暮色 2026-09-22 拍板）
//   聊天页 ➕ 号里点"共读"→ 选书 → 出现这个浮窗
//   - 内容跟全屏阅读器一样（章节 + 翻页 + 字号 + 主题）
//   - 可拖动（顶部拖把）
//   - 高度三档：小/中/大，存 localStorage
//   - 浮窗翻页触发 onSendChapter → Chat.tsx 那边的 handler 自动发一条
//     「共读邀请：《书名》第 X 章《标题》\n\n（章节正文）」给江澈
//   - 每章只发一次（内部维护 sentChapters Set）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, X, ArrowsOutSimple, ArrowsInSimple } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { DB, CoReadBook, CoReadAnnotation } from '../utils/db';

interface Props {
  book: CoReadBook;
  initialChapter: number;
  onClose: () => void;
  onChapterChange: (chapterIndex: number) => void;
  // 🛟 暮色 2026-09-22 反馈：不再传章节正文 — 正文只塞到 system 上下文(路线 C),
  //   聊天框只发简短 hint;onSendChapter 只传章节号
  onSendChapter: (chapterIndex: number) => void;
}

// 🛟 麦麦 2026-09-22：高度三档 + 位置都存 localStorage（用户调过一次记住）
const SIZE_STORAGE_KEY = 'co_read_floating_size_v1';
const POS_STORAGE_KEY = 'co_read_floating_pos_v1';
const FONT_STORAGE_KEY = 'co_read_floating_font_v1';
const THEME_STORAGE_KEY = 'co_read_floating_theme_v1';

type SizeMode = 'small' | 'medium' | 'large';
const SIZE_HEIGHT: Record<SizeMode, number> = {
  small: 240,
  medium: 420,
  large: 600,
};
const SIZE_WIDTH: Record<SizeMode, number> = {
  small: 320,
  medium: 380,
  large: 440,
};

const FONT_SIZE_OPTIONS = [14, 16, 18, 20] as const;
type FontSize = typeof FONT_SIZE_OPTIONS[number];

const THEME_PRESETS: Record<'day' | 'sepia' | 'night', { bg: string; text: string; sub: string }> = {
  day: { bg: '#ffffff', text: '#1e293b', sub: '#64748b' },
  sepia: { bg: '#f5ecd9', text: '#3b2f1e', sub: '#7d6b48' },
  night: { bg: '#1a1a1a', text: '#d4d4d4', sub: '#9ca3af' },
};

// 🛟 复用 CoReadReaderPage 的章节内容渲染（划线批注高亮 + 普通文本）
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

const CoReadFloatingWindow: React.FC<Props> = ({ book, initialChapter, onClose, onChapterChange, onSendChapter }) => {
  const [chapterIndex, setChapterIndex] = useState(initialChapter);
  // 🛟 麦麦 2026-09-22：每章只发一次 — 维护已发过的章节集合
  const sentChaptersRef = useRef<Set<number>>(new Set());
  // 🛟 浮窗挂载时立即给江澈发一次当前章节（暮色"邀请共读"那一下）
  useEffect(() => {
    if (sentChaptersRef.current.has(initialChapter)) return;
    sentChaptersRef.current.add(initialChapter);
    const chapter = book.chapters[initialChapter];
    if (chapter) onSendChapter(initialChapter);
  }, []); // 仅挂载时跑一次
  // 浮窗拖动 — 复用 ApiQuickFloat 的 onPointerDown/Move/Up 模式
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(POS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
        }
      } catch {}
    }
    // 默认屏幕中央
    const w = SIZE_WIDTH.medium;
    const h = SIZE_HEIGHT.medium;
    return {
      x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
      y: Math.max(8, Math.round((window.innerHeight - h) / 2 - 60)), // 偏上避开输入框
    };
  });
  const [size, setSize] = useState<SizeMode>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(SIZE_STORAGE_KEY);
      if (raw === 'small' || raw === 'medium' || raw === 'large') return raw;
    }
    return 'medium';
  });
  const [fontSize, setFontSize] = useState<FontSize>(() => {
    if (typeof window !== 'undefined') {
      const raw = parseInt(localStorage.getItem(FONT_STORAGE_KEY) || '', 10);
      if ((FONT_SIZE_OPTIONS as readonly number[]).includes(raw)) return raw as FontSize;
    }
    return 16;
  });
  const [theme, setTheme] = useState<'day' | 'sepia' | 'night'>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === 'day' || raw === 'sepia' || raw === 'night') return raw;
    }
    return 'day';
  });
  const dragging = useRef(false);
  const dragRef = useRef({ sx: 0, sy: 0, bx: 0, by: 0 });

  // 拉当前章节批注（用于高亮）
  const [chapterAnns, setChapterAnns] = useState<CoReadAnnotation[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await DB.getCoReadAnnotationsByChapter(book.id, chapterIndex);
        if (!cancelled) setChapterAnns(list);
      } catch (e) {
        if (!cancelled) console.warn('[coread-float] load anns failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [book.id, chapterIndex]);

  // 持久化尺寸 / 位置 / 字号 / 主题
  useEffect(() => {
    try { localStorage.setItem(SIZE_STORAGE_KEY, size); } catch {}
  }, [size]);
  useEffect(() => {
    try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);
  useEffect(() => {
    try { localStorage.setItem(FONT_STORAGE_KEY, String(fontSize)); } catch {}
  }, [fontSize]);
  useEffect(() => {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  }, [theme]);

  // 翻页 → 触发自动发消息（每章一次）
  const goChapter = useCallback((delta: number) => {
    const total = book.chapters.length;
    const next = Math.max(0, Math.min(total - 1, chapterIndex + delta));
    if (next === chapterIndex) return;
    setChapterIndex(next);
    onChapterChange(next);
    // 同步进度到 IDB
    DB.updateCoReadBookProgress(book.id, next).catch(() => {});
    // 自动发章节内容（首次进入该章节才发）
    if (!sentChaptersRef.current.has(next)) {
      sentChaptersRef.current.add(next);
      const chapter = book.chapters[next];
      onSendChapter(next);
    }
  }, [book, chapterIndex, onChapterChange, onSendChapter]);

  // 拖动
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y };
    dragging.current = true;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    const w = SIZE_WIDTH[size];
    const h = SIZE_HEIGHT[size];
    const nextX = Math.max(4, Math.min(window.innerWidth - w - 4, dragRef.current.bx + dx));
    const nextY = Math.max(4, Math.min(window.innerHeight - h - 4, dragRef.current.by + dy));
    setPos({ x: nextX, y: nextY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const total = book.chapters.length;
  const chapter = book.chapters[chapterIndex];
  if (!chapter) return null;
  const t = THEME_PRESETS[theme];
  const w = SIZE_WIDTH[size];
  const h = SIZE_HEIGHT[size];

  return createPortal(
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: w,
        height: h,
        touchAction: 'none',
        zIndex: 200,
      }}
      className="rounded-2xl shadow-2xl border border-white/30 flex flex-col overflow-hidden animate-slide-up select-none"
    >
      {/* 顶部（拖把 + 章节标题 + 关闭） */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ backgroundColor: t.bg, borderBottom: `1px solid ${t.sub}22`, cursor: 'grab' }}
        title="拖动浮窗"
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: t.sub }}>
            《{book.title}》
          </div>
          <div className="text-sm font-semibold truncate" style={{ color: t.text }}>
            第 {chapterIndex + 1} 章 · {chapter.title || '无标题'}
          </div>
        </div>
        {/* 调高度按钮 */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            // 三档循环: small → medium → large → small
            setSize((cur) => cur === 'small' ? 'medium' : cur === 'medium' ? 'large' : 'small');
          }}
          className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-all mr-1"
          style={{ color: t.sub, backgroundColor: `${t.sub}15` }}
          aria-label="切换浮窗大小"
          title="切换浮窗大小（小/中/大）"
        >
          {size === 'large' ? <ArrowsInSimple size={12} weight="bold" /> : <ArrowsOutSimple size={12} weight="bold" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-all"
          style={{ color: t.sub, backgroundColor: `${t.sub}15` }}
          aria-label="关闭浮窗"
        >
          <X size={14} weight="bold" />
        </button>
      </div>

      {/* 正文 */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{ WebkitOverflowScrolling: 'touch', backgroundColor: t.bg, color: t.text }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="leading-relaxed whitespace-pre-wrap" style={{ fontSize }}>
          {renderChapterContent(chapter.content, chapterAnns)}
        </div>
      </div>

      {/* 底部翻页 */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 text-[11px]"
        style={{ backgroundColor: t.bg, borderTop: `1px solid ${t.sub}22`, color: t.sub }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => goChapter(-1)}
          disabled={chapterIndex === 0}
          className="px-2 py-1 disabled:opacity-30 active:scale-95 transition-transform font-bold"
        >
          ‹ 上一章
        </button>
        <span className="font-mono">第 {chapterIndex + 1} 章 / 共 {total} 章</span>
        <button
          onClick={() => goChapter(+1)}
          disabled={chapterIndex === total - 1}
          className="px-2 py-1 disabled:opacity-30 active:scale-95 transition-transform font-bold"
        >
          下一章 ›
        </button>
      </div>

      {/* 字号 + 主题（在标题栏角落小按钮：tap 切换） */}
      <div
        className="absolute top-1 right-16 flex gap-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            const idx = FONT_SIZE_OPTIONS.indexOf(fontSize);
            const next = FONT_SIZE_OPTIONS[(idx + 1) % FONT_SIZE_OPTIONS.length];
            setFontSize(next);
          }}
          className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center"
          style={{ color: t.sub, backgroundColor: `${t.sub}10` }}
          title={`字号 ${fontSize}px（点切换）`}
        >
          A
        </button>
        <button
          onClick={() => setTheme((cur) => cur === 'day' ? 'sepia' : cur === 'sepia' ? 'night' : 'day')}
          className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center"
          style={{ color: t.sub, backgroundColor: `${t.sub}10` }}
          title={`主题 ${theme}（点切换）`}
        >
          ☀
        </button>
      </div>
    </div>,
    document.body
  );
};

export default CoReadFloatingWindow;