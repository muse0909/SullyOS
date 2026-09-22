// CoReadBookshelfPage — 共读书架页（DiscoverPage 内嵌子页）
// 麦麦 2026-09-18：第 2 步，发现页入口进这里
//   - 当前正在读（最近读的那本 + 进度）
//   - 全部共读书列表（书名 / 作者 / 章节进度 / 最后读时间）
//   - [+ 传书] 按钮：选 txt → 编码识别 → 拆章 → 存 IDB
//   - 每本书：「继续读」（步骤 3 接入阅读器）+ 删除
//   - ⚙ 右下（步骤 4/5 接入帮工 API 配置 + 工作台账本）

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft, Plus, Trash, BookOpen, CaretRight, Gear, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB, CoReadBook } from '../utils/db';
import {
  detectFileEncoding,
  decodeByEncoding,
  splitIntoChapters,
  extractTitleCandidates,
  type FileEncoding,
  type SplitResult,
  type ParsedChapter,
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

// 🛟 麦麦 2026-09-22：上传预览状态（暮色原话「想要拆分时手动调帮工」）
//   - 上传完先进入预览,用户看本地拆出的章节标题
//   - 觉得不对 → 点「用帮工重拆」调帮工 → 重新显示拆出结果
//   - 不像拆 → 点「当作整本读」存为 1 章
//   - 觉得对 → 点「保存这 N 章」直接存
interface UploadPreviewState {
  fileName: string;
  fileSize: number;
  text: string;
  encoding: FileEncoding;
  chapters: ParsedChapter[];
  splitMethod: 'regex-auto' | 'helper-llm' | 'fallback-chunks';
  matchedRule?: string;
  loading: boolean;
  helperError: string | null;
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
  // 🛟 麦麦 2026-09-22：上传预览状态 — 上传完进预览,用户点保存/重拆/当整本读
  const [preview, setPreview] = useState<UploadPreviewState | null>(null);
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

  // 🛟 麦麦 2026-09-21 修复 React #300:
  //   useMemo 必须放在所有 early return 之前 — 否则点"读"切换到 CoReadReaderPage 时
  //   hooks 数量从 8 减到 7，React 抛 "Rendered fewer hooks than expected"。
  //   (跟 Chat.tsx 早 9-06 那次同款坑)
  const lastReadBook = useMemo(() => {
    if (books.length === 0) return null;
    return books.reduce((a, b) => ((b.lastReadAt || 0) > (a.lastReadAt || 0) ? b : a));
  }, [books]);

  // 第 3 步:点"读"后切到全屏阅读器（必须放所有 hooks 之后）
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
      // 🛟 麦麦 2026-09-22：本地拆章后进预览（不再自动调帮工）
      //   暮色原话:本地拆得不对就手动调帮工,不是本地拆不出才调
      const splitResult = splitIntoChapters(text);
      const rawTitle = file.name.replace(/\.txt$/i, '').trim();
      const bookTitle = rawTitle || '未命名';
      setPreview({
        fileName: bookTitle,
        fileSize: file.size,
        text,
        encoding: encoding as FileEncoding,
        chapters: splitResult.chapters,
        splitMethod: splitResult.method,
        matchedRule: splitResult.matchedRule,
        loading: false,
        helperError: null,
      });
    } catch (err: any) {
      console.error('[coread] upload error:', err);
      addToast(`上传失败:${err?.message || err}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  // 🛟 麦麦 2026-09-22：预览里「保存这 N 章」 — 把当前 preview.chapters 存为 book
  const handlePreviewSave = async () => {
    if (!preview) return;
    const chapters = preview.chapters;
    if (chapters.length === 0) {
      addToast('当前预览里没章节,先调帮工或选当整本读', 'error');
      return;
    }
    const book: CoReadBook = {
      id: `coread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: preview.fileName,
      author: '',
      uploadTime: Date.now(),
      lastReadAt: 0,
      totalChapters: chapters.length,
      chapters,
      currentChapter: 0,
      fileEncoding: preview.encoding,
      chapterSplitMethod: preview.splitMethod,
      fileSize: preview.fileSize,
      primaryCharId: activeCharacterId || 'active',
    };
    try {
      await DB.saveCoReadBook(book);
      const methodLabel = preview.splitMethod === 'helper-llm'
        ? '帮工识别'
        : preview.splitMethod === 'fallback-chunks'
          ? '按 5000 字兜底切片'
          : preview.matchedRule
            ? `本地正则(${preview.matchedRule})`
            : '本地兜底';
      addToast(`《${preview.fileName}》已加入书架（${chapters.length}章,${methodLabel}）`, 'success');
      setPreview(null);
      await reload();
    } catch (e: any) {
      addToast(`保存失败:${e?.message || e}`, 'error');
    }
  };

  // 🛟 麦麦 2026-09-22：预览里「当作整本读」 — 把整个 txt 存为 1 章
  const handlePreviewSaveAsWhole = async () => {
    if (!preview) return;
    const wholeBook: CoReadBook = {
      id: `coread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title: preview.fileName,
      author: '',
      uploadTime: Date.now(),
      lastReadAt: 0,
      totalChapters: 1,
      chapters: [{
        index: 0,
        title: preview.fileName,
        content: preview.text.trim(),
        charCount: preview.text.trim().length,
      }],
      currentChapter: 0,
      fileEncoding: preview.encoding,
      chapterSplitMethod: preview.splitMethod,
      fileSize: preview.fileSize,
      primaryCharId: activeCharacterId || 'active',
    };
    try {
      await DB.saveCoReadBook(wholeBook);
      addToast(`《${preview.fileName}》已按整本加入书架（1 章）`, 'success');
      setPreview(null);
      await reload();
    } catch (e: any) {
      addToast(`保存失败:${e?.message || e}`, 'error');
    }
  };

  // 🛟 麦麦 2026-09-22：预览里「用帮工重拆」 — 调帮工更新 preview.chapters
  const handlePreviewReSplit = async () => {
    if (!preview || preview.loading) return;
    const helperCfg = loadHelperConfig();
    if (!helperCfg.enabled) {
      addToast('帮工 API 没启用,先去共读设置里开', 'error');
      return;
    }
    setPreview((cur) => cur ? { ...cur, loading: true, helperError: null } : cur);
    try {
      const mainApi: MainApiConfigForHelper | null = apiConfig
        ? {
            baseUrl: (apiConfig as any).baseUrl || '',
            apiKey: (apiConfig as any).apiKey || '',
            model: (apiConfig as any).model || '',
            protocol: ((apiConfig as any).protocol === 'gemini' ? 'gemini' : 'openai'),
          }
        : null;
      const candidates = extractTitleCandidates(preview.text);
      const totalLines = preview.text.split(/\r?\n/).length;
      if (candidates.length === 0) {
        setPreview((cur) => cur ? { ...cur, loading: false, helperError: '没有候选标题行可分析' } : cur);
        addToast('这本书里找不到疑似标题的行', 'error');
        return;
      }
      const helperRes = await callHelperForChapterTitles(candidates, totalLines, helperCfg, mainApi);
      if (helperRes.ok && helperRes.titleLineNos && helperRes.titleLineNos.length >= 2) {
        const rebuilt = buildChaptersByLineNos(preview.text, helperRes.titleLineNos);
        setPreview((cur) => cur ? {
          ...cur,
          loading: false,
          helperError: null,
          chapters: rebuilt.chapters,
          splitMethod: 'helper-llm',
          matchedRule: undefined,
        } : cur);
        addToast(`帮工识别出 ${rebuilt.chapters.length} 章`, 'success');
      } else {
        setPreview((cur) => cur ? { ...cur, loading: false, helperError: helperRes.error || '帮工没认出章节' } : cur);
        addToast(`帮工失败:${helperRes.error || '没认出章节'}`, 'error');
      }
    } catch (e: any) {
      setPreview((cur) => cur ? { ...cur, loading: false, helperError: e?.message || String(e) } : cur);
      addToast(`帮工调用出错:${e?.message || e}`, 'error');
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

      {/* 🛟 麦麦 2026-09-22：上传预览 modal（暮色 12:57 决定 — 本地拆得对就保存,不对手动调帮工,不像拆就当整本读） */}
      {preview && (
        <div className="absolute inset-0 z-50" onClick={() => !preview.loading && setPreview(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-3 sm:inset-6 bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 顶部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <div className="min-w-0 flex-1 pr-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold">上传预览</div>
                <div className="text-base font-semibold text-slate-800 truncate">《{preview.fileName}》</div>
              </div>
              <button
                onClick={() => setPreview(null)}
                disabled={preview.loading}
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 active:scale-95 transition-all disabled:opacity-40"
                aria-label="关闭预览"
              >
                <X size={16} weight="regular" />
              </button>
            </div>

            {/* 主体 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {preview.chapters.length >= 2 ? (
                <>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-2">
                    本地拆出 {preview.chapters.length} 章
                    {preview.splitMethod === 'helper-llm'
                      ? ' · 帮工识别'
                      : preview.splitMethod === 'fallback-chunks'
                        ? ' · 按 5000 字兜底切片'
                        : preview.matchedRule
                          ? ` · 本地正则（${preview.matchedRule}）`
                          : ''}
                  </div>
                  <div className="space-y-1">
                    {preview.chapters.map((c) => (
                      <div key={c.index} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 text-sm">
                        <span className="text-slate-400 text-xs shrink-0 w-8">{c.index + 1}</span>
                        <span className="flex-1 text-slate-700 truncate">{c.title || `第 ${c.index + 1} 部分`}</span>
                        <span className="text-[10px] text-slate-400 shrink-0">{Math.round((c.charCount || 0) / 500) || 1}′</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-2">
                    没识别出章节标记,整本可读
                  </div>
                  <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-2xl p-4 max-h-96 overflow-y-auto">
                    {preview.text.slice(0, 1200)}
                    {preview.text.length > 1200 && <span className="text-slate-400">...（后续 {preview.text.length - 1200} 字省略）</span>}
                  </div>
                </>
              )}
              {preview.helperError && (
                <div className="mt-3 text-xs text-rose-500 bg-rose-50 rounded-xl px-3 py-2 border border-rose-100">
                  帮工出错:{preview.helperError}
                </div>
              )}
              {preview.loading && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-emerald-600">
                  <div className="w-4 h-4 border-2 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
                  帮工识别中...
                </div>
              )}
            </div>

            {/* 底部按钮 — 3 个并排（暮色 9-22 反馈：当作整本读不再放第二行） */}
            <div className="border-t border-slate-100 px-5 py-4 shrink-0">
              <div className="flex gap-2">
                {preview.chapters.length >= 2 ? (
                  <button
                    onClick={handlePreviewSave}
                    disabled={preview.loading}
                    className="flex-1 py-3 text-sm font-bold rounded-2xl bg-emerald-500 text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40"
                  >
                    保存这 {preview.chapters.length} 章
                  </button>
                ) : (
                  <button
                    onClick={handlePreviewSaveAsWhole}
                    disabled={preview.loading}
                    className="flex-1 py-3 text-sm font-bold rounded-2xl bg-emerald-500 text-white shadow-sm active:scale-95 transition-transform disabled:opacity-40"
                  >
                    当作整本读
                  </button>
                )}
                <button
                  onClick={handlePreviewReSplit}
                  disabled={preview.loading}
                  className="flex-1 py-3 text-[11px] font-bold rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform disabled:opacity-40"
                >
                  {preview.splitMethod === 'helper-llm' ? '再用帮工' : '用帮工重拆'}
                </button>
                {preview.chapters.length >= 2 && (
                  <button
                    onClick={handlePreviewSaveAsWhole}
                    disabled={preview.loading}
                    className="flex-1 py-3 text-[11px] font-bold rounded-2xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 transition-transform disabled:opacity-40"
                  >
                    当作整本读
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoReadBookshelfPage;
