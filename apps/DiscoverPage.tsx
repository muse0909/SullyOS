// DiscoverPage — 发现页（WeChat 内嵌子页）
// 3 入口：朋友圈 / 收藏 / 日记 + 齿轮 → 朋友圈设置页

import React, { useState, useEffect } from 'react';
import { CaretRight, BookmarkSimple, Smiley, Notebook, Heart as HeartIcon, Images, Envelope } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { DB } from '../utils/db';
import { getJournalLastSeenAt } from '../utils/journalSeenAt';
import MomentsPage from './MomentsPage';
import FavoritesPage from './FavoritesPage';
import MomentsSettingsPage from './MomentsSettingsPage';
import XiaoZhiTiaoPage from './XiaoZhiTiaoPage';
// 暮色 8-25：信箱（双向信件）
import MailboxPage from './MailboxPage';
// 麦麦 2026-09-05：角色备忘录（江澈 9-5 指令）— 暮色只读
import CharacterMemoPage from './CharacterMemoPage';

type SubPage = 'list' | 'moments' | 'favorites' | 'moments-settings' | 'xiao-zhi-tiao' | 'mailbox' | 'character-memo';

const DiscoverPage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { addToast, characters } = useOS();
  const [subPage, setSubPage] = useState<SubPage>('list');

  // 暮色 2026-08-22：日记小红点 — 查所有角色最新 diary 的最大 timestamp
  //   跟 journal_last_seen_at 比：latest > seen → 显示小红点
  //   每次 DiscoverPage mount（从别的页面切回来）重查一次
  const [hasNewDiary, setHasNewDiary] = useState(false);

  useEffect(() => {
    if (subPage !== 'list') return;
    if (characters.length === 0) return;
    let cancelled = false;
    (async () => {
      const seenAt = getJournalLastSeenAt();
      const lists = await Promise.all(characters.map(c => DB.getDiariesByCharId(c.id)));
      if (cancelled) return;
      let maxTs = 0;
      for (const list of lists) {
        for (const d of list) {
          if ((d.timestamp || 0) > maxTs) maxTs = d.timestamp || 0;
        }
      }
      setHasNewDiary(seenAt > 0 && maxTs > seenAt);
    })();
    return () => { cancelled = true; };
  }, [subPage, characters]);

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

  // 子页：信箱（2026-08-25：暮色写的双向信件 + 角色来信）
  if (subPage === 'mailbox') {
    return <MailboxPage onBack={() => setSubPage('list')} />;
  }

  // 子页：角色备忘录（2026-09-05：江澈 9-5 指令，暮色只读）
  if (subPage === 'character-memo') {
    return <CharacterMemoPage onBack={() => setSubPage('list')} />;
  }

  // 子页：朋友圈设置（暮色 2026-07-03 新增）
  if (subPage === 'moments-settings') {
    return <MomentsSettingsPage onBack={() => setSubPage('list')} />;
  }

  // 子页：日记（暮色 2026-08-22：去掉 placeholder，由 JournalEntry 直接 openApp(AppID.Journal)）

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
      <div className="flex-1 overflow-y-auto px-5 pt-3">
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
          {/* 暮色 8-25：信箱（双向信件）— 跟小纸条、日记并列 */}
          <MailboxEntry onOpen={() => setSubPage('mailbox')} />
          <div className="border-t border-slate-100" />
          {/* 麦麦 2026-09-05：角色备忘录入口 — 江澈 9-5 指令，暮色只读 */}
          <CharacterMemoEntry onOpen={() => setSubPage('character-memo')} />
          <div className="border-t border-slate-100" />
          {/* 暮色 2026-08-22：日记入口（接通 AppID.Journal，跟相册/情侣空间同模式） */}
          <JournalEntry onClose={onClose} hasNew={hasNewDiary} />
          <div className="border-t border-slate-100" />
          {/* 暮色 2026-08-21：相册入口 — 跟情侣空间同模式（从发现页打开，parent=Chat 让 closeApp 回 WeChat） */}
          <GalleryEntry onClose={onClose} />
          <div className="border-t border-slate-100" />
          {/* 暮色 2026-07-31：情侣空间入口 — 直接打开独立 app，不在 DiscoverPage 内嵌 */}
          {/* 暮色 2026-08-21：补传 parent=AppID.Chat — 跟相册统一"从发现页打开→返回发现页" */}
          <CoupleSpaceEntry onClose={onClose} />
        </div>
      </div>
    </div>
  );
};

// 暮色 2026-08-21：相册入口
// 跟 CoupleSpaceEntry 同模式：关掉发现页 + 打开相册，传 parent=AppID.Chat
// closeApp 时回 WeChat（看到发现页），不是回桌面
const GalleryEntry: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { openApp } = useOS();
  return (
    <button
      onClick={() => {
        onClose();
        // 下一帧再 openApp，避免 DiscoverPage onClose 路由冲突
        setTimeout(() => openApp(AppID.Gallery, AppID.Chat), 50);
      }}
      className="w-full flex items-center gap-3 px-4 py-4 active:bg-indigo-50 transition-colors text-left"
    >
      <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center">
        <Images size={16} weight="regular" className="text-indigo-500" />
      </div>
      <span className="flex-1 text-sm font-medium text-slate-800">相册</span>
      <CaretRight size={16} className="text-slate-300" />
    </button>
  );
};

// 暮色 2026-07-31：情侣空间入口
// 在 DiscoverPage 入口列表里加一项，点直接关掉发现页 + 打开 CoupleSpaceApp
// 暮色 2026-08-21：补传 parent=AppID.Chat — 跟相册统一规则
const CoupleSpaceEntry: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { openApp } = useOS();
  return (
    <button
      onClick={() => {
        onClose();
        // 下一帧再 openApp，避免 DiscoverPage onClose 路由冲突
        setTimeout(() => openApp(AppID.CoupleSpace, AppID.Chat), 50);
      }}
      className="w-full flex items-center gap-3 px-4 py-4 active:bg-rose-50 transition-colors text-left"
    >
      <div className="w-7 h-7 rounded-full bg-rose-50 flex items-center justify-center">
        <HeartIcon size={16} weight="fill" className="text-rose-500" />
      </div>
      <span className="flex-1 text-sm font-medium text-slate-800">情侣空间</span>
      <CaretRight size={16} className="text-slate-300" />
    </button>
  );
};

// 暮色 2026-08-22：日记入口
// 跟 GalleryEntry / CoupleSpaceEntry 同模式：onClose + setTimeout(openApp(AppID.Journal, AppID.Chat), 50)
//   暮色：默认进当前角色（JournalApp 启动 useEffect 会从 activeCharacterId 拿）
//   小红点：有未读日记时 CaretRight 左边显示小红点
const JournalEntry: React.FC<{ onClose: () => void; hasNew: boolean }> = ({ onClose, hasNew }) => {
  const { openApp } = useOS();
  return (
    <button
      onClick={() => {
        onClose();
        setTimeout(() => openApp(AppID.Journal, AppID.Chat), 50);
      }}
      className="w-full flex items-center gap-3 px-4 py-4 active:bg-amber-50 transition-colors text-left"
    >
      <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center">
        <Notebook size={16} weight="regular" className="text-amber-500" />
      </div>
      <span className="flex-1 text-sm font-medium text-slate-800">日记</span>
      {hasNew && (
        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" aria-label="有新日记" />
      )}
      <CaretRight size={16} className="text-slate-300" />
    </button>
  );
};

// 暮色 8-25：信箱入口（跟小纸条、日记并列）
// 跟 XiaoZhiTiao 同模式：在 DiscoverPage 内嵌 subPage，不需要 openApp
// MailboxEntry 在 DiscoverPage 函数体外，通过 onOpen prop 传 setSubPage
// 麦麦 2026-09-05：角色备忘录入口（江澈 9-5 指令，暮色只读）
const CharacterMemoEntry: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
    return (
        <button
            onClick={onOpen}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-amber-50 transition-colors text-left"
        >
            <div className="w-7 h-7 rounded-full bg-amber-50 flex items-center justify-center">
                <Notebook size={16} weight="regular" className="text-amber-600" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">角色备忘录</span>
            <CaretRight size={16} className="text-slate-300" />
        </button>
    );
};

const MailboxEntry: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
    return (
        <button
            onClick={onOpen}
            className="w-full flex items-center gap-3 px-4 py-4 active:bg-indigo-50 transition-colors text-left"
        >
            <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center">
                <Envelope size={16} weight="regular" className="text-indigo-500" />
            </div>
            <span className="flex-1 text-sm font-medium text-slate-800">信箱</span>
            <CaretRight size={16} className="text-slate-300" />
        </button>
    );
};

export default DiscoverPage;
