// CoReadFloatingBookshelf — 共读迷你书架选择器
//   暮色 2026-09-22：聊天页 ➕ 号里点"共读"→ 弹这个浮层列共读书
//   点书 → 触发 onPick → 关闭自己 → 出现 CoReadFloatingWindow
//
//   复用 CoReadBookshelfPage 的 books 加载逻辑（DB.getCoReadBooks），UI 上做精简版（只列书+继续读按钮）

import React, { useEffect, useState } from 'react';
import { BookOpen, X } from '@phosphor-icons/react';
import { DB, CoReadBook } from '../utils/db';
import { createPortal } from 'react-dom';

interface Props {
  onClose: () => void;
  onPick: (book: CoReadBook) => void;
}

const CoReadFloatingBookshelf: React.FC<Props> = ({ onClose, onPick }) => {
  const [books, setBooks] = useState<CoReadBook[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await DB.getCoReadBooks();
        if (!cancelled) setBooks(list);
      } catch (e) {
        console.error('[coread-float-shelf] load failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-sm bg-white rounded-[2rem] shadow-2xl overflow-hidden animate-slide-up max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">共读</div>
            <div className="text-base font-semibold text-slate-800">选一本书,跟江澈一起看</div>
          </div>
          <button onClick={onClose} aria-label="关闭" className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 active:scale-95 transition-all">
            <X size={16} weight="regular" />
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-center text-sm text-slate-400 py-12">载入中...</div>
          ) : books.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-12">
              <BookOpen size={32} weight="regular" className="mx-auto mb-2 text-slate-300" />
              <div>书架还是空的</div>
              <div className="text-[11px] mt-1">先去发现页共读书架上传一本 txt</div>
            </div>
          ) : (
            <div className="space-y-2">
              {books.map((book) => {
                const total = book.totalChapters || book.chapters.length;
                const cur = (book.currentChapter || 0) + 1;
                const hasProgress = (book.lastReadAt || 0) > 0;
                return (
                  <button
                    key={book.id}
                    onClick={() => onPick(book)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 active:scale-[0.98] transition-all text-left"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center shrink-0 border border-slate-100">
                      <BookOpen size={16} weight="regular" className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">《{book.title}》</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {total} 章 · {hasProgress ? `读至第 ${cur} 章` : '还没翻开过'}
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                      {hasProgress ? '继续读' : '读'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-3 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
          选好后会出现浮窗,可以一边看一边在下面跟江澈聊。每翻到新的一章,自动给江澈发一次章节内容。
        </div>
      </div>
    </div>,
    document.body
  );
};

export default CoReadFloatingBookshelf;