// CoReadBookshelfPage — 共读书架页（DiscoverPage 内嵌子页）
// 麦麦 2026-09-18：第 2 步，发现页入口进这里
//   - 当前正在读（最近读的那本 + 进度）
//   - 全部共读书列表（书名 / 作者 / 章节进度 / 最后读时间）
//   - [+ 传书] 按钮：选 txt → 编码识别 → 拆章 → 存 IDB
//   - 每本书：「继续读」（步骤 3 接入阅读器）+ 删除
//   - ⚙ 右下（步骤 4/5 接入帮工 API 配置 + 工作台账本）

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Plus, Trash, BookOpen, CaretRight, Gear } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB, CoReadBook } from '../utils/db';
import {
  detectFileEncoding,
  decodeByEncoding,
  splitIntoChapters,
  extractTitleCandidates,
  type FileEncoding,
  type SplitResult,
} from '../utils/coReadChapterParser';
// 第 3 步：全屏阅读器
import CoReadReaderPage from './CoReadReaderPage';
// 第 4 步：帮工 API 兜底
import { loadHelperConfig, type MainApiConfigForHelper } from '../utils/coReadHelperConfig';
import { callHelperForChapterTitles } from '../utils/coReadHelperClient';
// 第 4 步：设置抽屉（步骤 4 接入 帮工 API / 步骤 5 接入 工作台账本）
import CoReadSettingsDrawer from './CoReadSettingsDrawer';

// 第 4 步：用帮工返回的章节标题行号,反向构建 chapters 数组
//   titleLineNos = 标题所在的行号(0-based)，行号必须是升序的
function buildChaptersByLineNos(text: string, titleLineNos: number[]): SplitResult {
  const lines = text.split(/\r?\n/);
  const sortedNo = Array.from(new Set(titleLineNos)).filter(n => n >= 0 && n < lines.length).sort((a, b) => a - b);
  const chapters = sortedNo.map((lineNo, idx) => {
    const title = (lines[lineNo] || '').trim() || `第 ${idx + 1} 部分`;
    const startLine = lineNo + 1;
    const endLine = idx + 1 < sortedNo.length ? sortedNo[idx + 1] : lines.length;
    const content = lines.slice(startLine, endLine).join('\n').trim();
    return {
      index: idx,
      title,
      content,
      charCount: content.length,
    };
  }).filter(c => c.content.length > 0);
  return { method: 'helper-llm', chapters };
}

interface Props {
  onBack: () => void;
}

const CoReadBookshelfPage: React.FC<Props> = ({ onBack }) => {
  const { addToast, activeCharacterId, apiConfig } = useOS();
  const [books, setBooks] = useState<CoReadBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // 第 3 步:点"读"后切到全屏阅读器,用 activeBookId 标识
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  // 第 4 步:设置抽屉
  const [showSettings, setShowSettings] = useState(false);
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
      // 拆章 — 本地
      let splitResult: SplitResult = splitIntoChapters(text);
      let helperUsed = false;
      let helperError: string | null = null;
      // 第 4 步：如果本地拆出 < 2 章,启用帮工兜底
      //   本地 regex 全部失败 或 fallback-chunks 都属于"本地不行"
      if (splitResult.chapters.length < 2) {
        const helperCfg = loadHelperConfig();
        if (helperCfg.enabled) {
          const mainApi: MainApiConfigForHelper | null = apiConfig
            ? {
                baseUrl: (apiConfig as any).baseUrl || '',
                apiKey: (apiConfig as any).apiKey || '',
                model: (apiConfig as any).model || '',
                protocol: ((apiConfig as any).protocol === 'gemini' ? 'gemini' : 'openai'),
              }
            : null;
          const candidates = extractTitleCandidates(text);
          const totalLines = text.split(/\r?\n/).length;
          if (candidates.length === 0) {
            helperError = '没有候选标题行可分析';
          } else {
            addToast('本地拆不出,调帮工兜底…', 'info');
            const helperRes = await callHelperForChapterTitles(candidates, totalLines, helperCfg, mainApi);
            if (helperRes.ok && helperRes.titleLineNos && helperRes.titleLineNos.length >= 2) {
              // 用帮工返回的行号重新切片
              splitResult = buildChaptersByLineNos(text, helperRes.titleLineNos);
              helperUsed = true;
            } else {
              helperError = helperRes.error || '帮工没认出章节';
              addToast(`帮工失败:${helperError},用本地兜底切`, 'error');
            }
          }
        } else {
          addToast('本地正则没认出来,帮工 API 未启用,按 5000 字兜底切片', 'info');
        }
      }
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
        chapterSplitMethod: helperUsed ? 'helper-llm' : splitResult.method,
        fileSize: file.size,
        primaryCharId: activeCharacterId || 'active',
      };
      await DB.saveCoReadBook(book);
      const methodLabel = helperUsed
        ? '帮工识别'
        : splitResult.method === 'regex-auto'
          ? `本地正则(${splitResult.matchedRule})`
          : '按 5000 字兜底切片';
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
      {/* 顶部工具栏 — 暮色 9-18 反馈: ⚙ 和 + 紧贴在一起(没空隙) */}
      <div className="flex items-center px-2 py-3 bg-white/60 backdrop-blur shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={18} weight="regular" />
        </button>
        <h1 className="flex-1 text-base font-semibold text-slate-800 tracking-wide text-center">共读书架</h1>
        {/* ⚙ 和 + 紧贴一起,在右侧 */}
        <button
          onClick={() => setShowSettings(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="设置"
        >
          <Gear size={18} weight="regular" />
        </button>
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
            长按下方 ⚙ 看帮工 API + 工作台账本
          </div>
        )}
      </div>

      {/* 第 4 步:⚙ 已移到顶栏(暮色 9-18 反馈被底下挡住) — 这里不再有浮动按钮 */}

      <CoReadSettingsDrawer open={showSettings} onClose={() => setShowSettings(false)} activeTab="helper" />
    </div>
  );
};

export default CoReadBookshelfPage;
