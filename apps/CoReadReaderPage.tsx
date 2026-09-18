// CoReadReaderPage — 共读全屏阅读器（DiscoverPage 内嵌子页）
// 麦麦 2026-09-18：第 3 步
//   - 章节正文 + 翻页(左右键 / 上下滑) + ☰目录 + 进度「第 N 章/共 M 章」
//   - ⚙ 设置面板:字号 4 档 / 主题 3 套 / 翻页方式 2 种
//   - 关闭 / 翻页时 updateCoReadBookProgress,下次进来自动恢复
//   - 高级(帮工 API + 工作台账本)放步骤 4/5

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CaretLeft,
  CaretRight as CaretRightIcon,
  List as ListIcon,
  Gear as GearIcon,
  X as CloseIcon,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB, CoReadBook } from '../utils/db';

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载书 + 跳到 currentChapter
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

  // 同步设置到 localStorage
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // 翻页时清空滚动位置(改章节)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [chapterIdx]);

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

  // 把章节正文按段落切,vertical 模式时一段一段上下滑自动接下一章
  const paragraphs = useMemo(() => {
    if (!book) return [];
    const c = book.chapters[chapterIdx];
    if (!c) return [];
    return c.content.split(/\n\s*\n/).filter(p => p.trim());
  }, [book, chapterIdx]);

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

  // 左右翻模式:键盘左右键
  useEffect(() => {
    if (settings.pageMode !== 'horizontal') return;
    const onKey = (e: KeyboardEvent) => {
      if (showSettings || showToc) return;
      if (e.key === 'ArrowLeft') goChapter(-1);
      else if (e.key === 'ArrowRight') goChapter(+1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.pageMode, showSettings, showToc, chapterIdx, book]);

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
          {paragraphs.map((p, i) => (
            <p key={i} className="mb-4 leading-relaxed whitespace-pre-wrap" style={{ fontSize: settings.fontSize }}>
              {p}
            </p>
          ))}
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
            {paragraphs.map((p, i) => (
              <p key={i} className="mb-4 leading-relaxed whitespace-pre-wrap" style={{ fontSize: settings.fontSize }}>
                {p}
              </p>
            ))}
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
