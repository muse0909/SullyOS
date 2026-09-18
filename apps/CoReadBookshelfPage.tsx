// CoReadBookshelfPage — 共读书架页（DiscoverPage 内嵌子页）
// 麦麦 2026-09-18：第 2 步，发现页入口进这里
//   - 当前正在读（最近读的那本 + 进度）
//   - 全部共读书列表（书名 / 作者 / 章节进度 / 最后读时间）
//   - [+ 传书] 按钮：选 txt → 编码识别 → 拆章 → 存 IDB
//   - 每本书：「继续读」（步骤 3 接入阅读器）+ 删除
//   - ⚙ 右下（步骤 4/5 接入帮工 API 配置 + 工作台账本）

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Plus, Trash, BookOpen, CaretRight } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB, CoReadBook } from '../utils/db';
import {
  detectFileEncoding,
  decodeByEncoding,
  splitIntoChapters,
  type FileEncoding,
} from '../utils/coReadChapterParser';
// 第 3 步：全屏阅读器
import CoReadReaderPage from './CoReadReaderPage';

interface Props {
  onBack: () => void;
}

const CoReadBookshelfPage: React.FC<Props> = ({ onBack }) => {
  const { addToast, activeCharacterId } = useOS();
  const [books, setBooks] = useState<CoReadBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // 第 3 步:点"读"后切到全屏阅读器,用 activeBookId 标识
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const list = await DB.getCoReadBooks();
      setBooks(list);
    } catch (e) {
      console.error('[coread] load books failed:', e);
      addToast('加载书架失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // 第 3 步:点"读"后切到全屏阅读器
  if (activeBookId) {
    return (
      <CoReadReaderPage
        bookId={activeBookId}
        onBack={() => {
          setActiveBookId(null);
          // 下一帧再 reload,等当前 render 撤掉 reader 后再拉
          setTimeout(reload, 0);
        }}
      />
    );
  }


  const lastReadBook = useMemo(() => {
    if (books.length === 0) return null;
    return books.reduce((a, b) => ((b.lastReadAt || 0) > (a.lastReadAt || 0) ? b : a));
  }, [books]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 重置以便同名文件能再次触发
    if (!file) return;

    // 暮色要求：仅 txt、5MB 限制
    if (!/\.txt$/i.test(file.name)) {
      addToast('只支持 .txt 文件', 'error');
      return;
    }
    const FIVE_MB = 5 * 1024 * 1024;
    if (file.size > FIVE_MB) {
      addToast('文件超过 5MB,请挑短一点的传', 'error');
      return;
    }

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const encoding = detectFileEncoding(buffer);
      const text = decodeByEncoding(buffer, encoding);
      if (!text || text.trim().length < 10) {
        addToast('文件读出来是空的或乱码(可能编码识别有误)', 'error');
        setUploading(false);
        return;
      }
      // 拆章
      const splitResult = splitIntoChapters(text);
      if (!splitResult.chapters || splitResult.chapters.length === 0) {
        addToast('拆章失败,书里没有任何内容', 'error');
        setUploading(false);
        return;
      }
      // 推断书名 = 文件名去后缀；作者暂留空,后续可改进 (步骤 5 后,工作台里允许编辑)
      const rawTitle = file.name.replace(/\.txt$/i, '').trim();
      const bookTitle = rawTitle || '未命名';
      // 找作者行（首段"作者: ..."或"作者 XXX"格式）— 太复杂,先空着
      const book: CoReadBook = {
        id: `coread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: bookTitle,
        author: '',
        uploadTime: Date.now(),
        lastReadAt: 0,
        totalChapters: splitResult.chapters.length,
        chapters: splitResult.chapters,
        currentChapter: 0,
        fileEncoding: encoding as FileEncoding,
        chapterSplitMethod: splitResult.method,
        fileSize: file.size,
        primaryCharId: activeCharacterId || 'active',
      };
      await DB.saveCoReadBook(book);
      const methodLabel =
        splitResult.method === 'regex-auto'
          ? `本地正则(${splitResult.matchedRule})`
          : splitResult.method === 'fallback-chunks'
          ? '按 5000 字兜底切片'
          : '兜底';
      addToast(`《${bookTitle}》已加入书架（${splitResult.chapters.length}章,${methodLabel}）`, 'success');
      await reload();
    } catch (err: any) {
      console.error('[coread] upload error:', err);
      addToast(`上传失败:${err?.message || err}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteBook = async (book: CoReadBook) => {
    if (!window.confirm(`确认删除《${book.title}》？批注和进度都会一起清掉。`)) return;
    try {
      await DB.deleteCoReadBook(book.id);
      addToast('已删除', 'info');
      await reload();
    } catch (e: any) {
      addToast(`删除失败:${e?.message || e}`, 'error');
    }
  };

  const handleContinueRead = (book: CoReadBook) => {
    // 第 3 步：切到全屏阅读器
    setActiveBookId(book.id);
  };

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: 'linear-gradient(180deg, #f3f4f6 0%, #e7e9ee 100%)' }}>
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-2 py-3 bg-white/60 backdrop-blur shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={18} weight="regular" />
        </button>
        <h1 className="text-base font-semibold text-slate-800 tracking-wide">共读书架</h1>
        <button
          onClick={handleUploadClick}
          disabled={uploading}
          className="w-9 h-9 flex items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 active:scale-95 transition-transform disabled:opacity-50"
          aria-label="传书"
        >
          {uploading ? (
            <span className="text-[10px]">…</span>
          ) : (
            <Plus size={18} weight="regular" />
          )}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,text/plain"
        onChange={handleFileSelected}
        style={{ display: 'none' }}
      />

      {/* 滚动区 */}
      <div className="flex-1 overflow-y-auto px-5 pt-3 pb-24">
        {/* 当前在读卡片 */}
        {!loading && lastReadBook && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <BookOpen size={20} weight="regular" className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-emerald-700/70">上次在读</div>
                <div className="text-sm font-medium text-emerald-900 mt-0.5 truncate">《{lastReadBook.title}》</div>
                <div className="text-[11px] text-emerald-700/70 mt-1">
                  第{(lastReadBook.currentChapter || 0) + 1}章/共{lastReadBook.totalChapters || lastReadBook.chapters.length}章
                </div>
              </div>
              <button
                onClick={() => handleContinueRead(lastReadBook)}
                className="self-center px-3 py-1.5 text-xs font-medium rounded-full bg-emerald-600 text-white active:scale-95 transition-transform"
              >
                继续读
              </button>
            </div>
          </div>
        )}

        {/* 书架列表 */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-[11px] uppercase tracking-wider text-slate-500">
            全部共读书 · {books.length} 本
          </div>

          {loading && (
            <div className="px-4 py-12 text-center text-sm text-slate-400">载入中...</div>
          )}

          {!loading && books.length === 0 && (
            <div className="px-4 py-12 flex flex-col items-center gap-2 text-slate-400">
              <BookOpen size={32} weight="regular" />
              <div className="text-sm">书架还是空的</div>
              <div className="text-[11px]">点右上 + 传一本 txt,我们就开始读</div>
            </div>
          )}

          {books.map((book) => {
            const total = book.totalChapters || book.chapters.length;
            const cur = (book.currentChapter || 0) + 1;
            const hasProgress = (book.lastReadAt || 0) > 0;
            return (
              <div key={book.id} className="px-4 py-3 border-t border-slate-100 first:border-t-0">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                    <BookOpen size={16} weight="regular" className="text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">《{book.title}》</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {book.author ? `${book.author} · ` : ''}{total} 章 · {Math.round((book.fileSize || 0) / 1024)} KB
                    </div>
                    <div className="text-[11px] text-emerald-600 mt-0.5">
                      {hasProgress ? `读至第 ${cur} 章` : '还没翻开过'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleContinueRead(book)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-emerald-600 text-white active:scale-95 transition-transform"
                    >
                      读
                    </button>
                    <button
                      onClick={() => handleDeleteBook(book)}
                      className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      aria-label="删除"
                    >
                      <Trash size={14} weight="regular" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 步骤 4/5 占位 */}
        {!loading && books.length > 0 && (
          <div className="mt-4 text-center text-[11px] text-slate-400">
            ⚙ 帮工 API + 工作台账本 将于步骤 4/5 上线
          </div>
        )}
      </div>
    </div>
  );
};

export default CoReadBookshelfPage;
