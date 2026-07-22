// DiscoverPage — 发现页（WeChat 内嵌子页）
// 3 入口：朋友圈 / 收藏 / 日记 + 齿轮 → 朋友圈设置页

import React, { useState } from 'react';
import { CaretRight, BookOpen, BookmarkSimple, Smiley, Notebook } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import MomentsPage from './MomentsPage';
import FavoritesPage from './FavoritesPage';
import MomentsSettingsPage from './MomentsSettingsPage';
import XiaoZhiTiaoPage from './XiaoZhiTiaoPage';

type SubPage = 'list' | 'moments' | 'favorites' | 'journal' | 'moments-settings' | 'xiao-zhi-tiao';

const DiscoverPage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { addToast } = useOS();
  const [subPage, setSubPage] = useState<SubPage>('list');

  // 子页：朋友圈
  if (subPage === 'moments') {
    return <MomentsPage onBack={() => setSubPage('list')} />;
  }

  // 子页：收藏（语音收藏，按角色分组）
  if (subPage === 'favorites') {
    return <FavoritesPage onBack={() => setSubPage('list')} />;
  }

  // 子页：小纸条（2026-07-22：跟 PrivateNotesPage 完全独立，互不影响）
  if (subPage === 'xiao-zhi-tiao') {
    return <XiaoZhiTiaoPage onBack={() => setSubPage('list')} />;
  }

  // 子页：朋友圈设置（暮色 2026-07-03 新增）
  if (subPage === 'moments-settings') {
    return <MomentsSettingsPage onBack={() => setSubPage('list')} />;
  }

  // 子页：日记（暂未实现）
  if (subPage === 'journal') {
    return (
      <div className="absolute inset-0 flex flex-col bg-[#ededed]">
        <div className="flex items-center justify-between px-2 py-3 bg-white border-b border-slate-200/60 shrink-0">
          <button
            onClick={() => setSubPage('list')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
            aria-label="返回"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-slate-800 tracking-wide">日记</h1>
          <div className="w-9 h-9" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-white flex items-center justify-center mb-4 shadow-sm">
            <BookOpen size={28} weight="regular" className="text-slate-300" />
          </div>
          <div className="text-sm text-slate-500">日记 — 敬请期待</div>
          <div className="text-[11px] text-slate-400 mt-1">先把朋友圈跑通，下一轮做</div>
        </div>
      </div>
    );
  }

  // 默认：3 入口列表
  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: 'linear-gradient(180deg, #f3f4f6 0%, #e7e9ee 100%)' }}>
      {/* Header */}
<div className="flex items-center justify-between px-2 py-3 bg-white/60 backdrop-blur shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-base font-semibold text-slate-800 tracking-wide">发现</h1>
        {/* 暮色 2026-07-04：齿轮入口从 DiscoverPage 移除，迁到 MomentsPage 顶部工具栏（相机左边） */}
        <div className="w-9 h-9" aria-hidden />
      </div>

      {/* 入口列表 */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        <div className="bg-white rounded-2xl mb-3 shadow-sm overflow-hidden">
          <button
            onClick={() => setSubPage('moments')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-slate-50 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center">
              <Smiley size={16} weight="regular" className="text-emerald-600" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">朋友圈</span>
            <CaretRight size={16} className="text-slate-300" />
          </button>
          <div className="border-t border-slate-100" />
          <button
            onClick={() => setSubPage('favorites')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-slate-50 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-sky-50 flex items-center justify-center">
              <BookmarkSimple size={16} weight="regular" className="text-sky-500" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">收藏</span>
            <CaretRight size={16} className="text-slate-300" />
          </button>
          <div className="border-t border-slate-100" />
          <button
            onClick={() => setSubPage('xiao-zhi-tiao')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-slate-50 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-rose-50 flex items-center justify-center">
              <Notebook size={16} weight="regular" className="text-rose-500" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">小纸条</span>
            <CaretRight size={16} className="text-slate-300" />
          </button>
          <div className="border-t border-slate-100" />
          <button
            onClick={() => setSubPage('journal')}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-slate-50 transition-colors text-left"
          >
            <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center">
              <BookOpen size={16} weight="regular" className="text-amber-500" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">日记</span>
            <CaretRight size={16} className="text-slate-300" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiscoverPage;
