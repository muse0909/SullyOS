// FavoritesPage — 收藏页（发现页子页）
// 顶 Tab：消息收藏 / 语音收藏
// 内容：所有 favorite 混在一起按时间倒序，不按角色分组（暮色明确"不喜欢混在一起的"是指不喜欢分组本身）
// 卡片操作：右上角横排 ⭐→📍→🗑（暮色拍板顺序）

import React, { useEffect, useState } from 'react';
import { CaretLeft, Star, StarFour, ArrowSquareOut, Quotes, ChatCircleDots, Trash } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  FavoriteItem,
  getAllFavorites,
  removeFavorite,
  updateFavorite,
  markFavoriteInvalid,
} from '../utils/favoritesStorage';

type TabKey = 'text' | 'voice';

const FavoritesPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { jumpToMessage, addToast } = useOS();
  const [tab, setTab] = useState<TabKey>('voice');
  const [items, setItems] = useState<FavoriteItem[]>([]);

  // 加载数据（按 tab 筛选 + 按时间倒序）
  useEffect(() => {
    const load = () => {
      const all = getAllFavorites()
        .filter((f) => f.type === tab)
        .sort((a, b) => b.createdAt - a.createdAt);
      setItems(all);
    };
    load();
    const onStorage = () => load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [tab]);

  const handleLocate = (item: FavoriteItem) => {
    jumpToMessage(item.charId, item.sourceMessageId);
    addToast('正在跳转到聊天...', 'info');
  };

  const handleRemove = (item: FavoriteItem) => {
    if (window.confirm(`确定要删除这条收藏吗？`)) {
      removeFavorite(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      addToast('已删除', 'success');
    }
  };

  const handleToggleStar = (item: FavoriteItem) => {
    const next = !item.starred;
    updateFavorite(item.id, { starred: next });
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: next } : i)));
    addToast(next ? '已加入星标' : '已取消星标', 'success');
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed]">
      {/* Header */}
      <div className="flex items-center px-3 py-3 bg-white border-b border-slate-200/60 shrink-0">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <CaretLeft size={20} weight="bold" />
        </button>
        <h1 className="flex-1 text-center text-base font-semibold text-slate-800 tracking-wide -ml-9">收藏</h1>
        <div className="w-9 h-9" />
      </div>

      {/* Tab Bar — 一级 Tab：消息收藏 / 语音收藏 */}
      <div className="flex bg-white border-b border-slate-200/60 shrink-0">
        <button
          onClick={() => setTab('text')}
          className={`flex-1 py-2.5 text-sm font-medium relative ${tab === 'text' ? 'text-amber-600' : 'text-slate-500'}`}
        >
          消息收藏
          {tab === 'text' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-amber-500 rounded-full" />}
        </button>
        <button
          onClick={() => setTab('voice')}
          className={`flex-1 py-2.5 text-sm font-medium relative ${tab === 'voice' ? 'text-amber-600' : 'text-slate-500'}`}
        >
          语音收藏
          {tab === 'voice' && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-amber-500 rounded-full" />}
        </button>
      </div>

      {/* 列表 — 所有 favorite 混在一起按时间倒序，不分组 */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="px-5 py-3 space-y-2.5">
            {items.map((item) => (
              <FavoriteCard
                key={item.id}
                item={item}
                onLocate={() => handleLocate(item)}
                onRemove={() => handleRemove(item)}
                onToggleStar={() => handleToggleStar(item)}
              />
            ))}
            <div className="h-4" />
          </div>
        )}
      </div>
    </div>
  );
};

// === 单条收藏卡片 ===
// 操作按钮右上角横排 ⭐→📍→🗑（暮色拍板顺序）
const FavoriteCard: React.FC<{
  item: FavoriteItem;
  onLocate: () => void;
  onRemove: () => void;
  onToggleStar: () => void;
}> = ({ item, onLocate, onRemove, onToggleStar }) => {
  const { addToast } = useOS();
  const date = new Date(item.createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const isVoice = item.type === 'voice';

  const handleAudioError = () => {
    markFavoriteInvalid(item.id);
    addToast('语音已失效（CDN 链接过期）', 'warning');
  };

  return (
    <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100/80">
      {/* 日期 + 右上角操作按钮（⭐→📍→🗑） */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-400 font-medium">{dateStr}</span>
        <div className="flex items-center gap-0.5 -mr-1.5">
          <button
            onClick={onToggleStar}
            className="p-1.5 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
            aria-label={item.starred ? '取消星标' : '加星标'}
          >
            <Star size={14} weight={item.starred ? 'fill' : 'regular'} className={item.starred ? 'text-amber-500' : 'text-slate-400'} />
          </button>
          <button
            onClick={onLocate}
            className="p-1.5 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
            aria-label="定位到聊天"
          >
            <ArrowSquareOut size={14} weight="bold" className="text-amber-500" />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
            aria-label="删除"
          >
            <Trash size={14} weight="regular" className="text-slate-400" />
          </button>
        </div>
      </div>

      {/* 语音条（仅 voice） */}
      {isVoice && (
        item.invalid ? (
          <div className="bg-slate-50 rounded-2xl px-3 py-2.5 text-xs text-slate-400 text-center">
            语音已失效
          </div>
        ) : (
          <audio
            controls
            src={item.url}
            onError={handleAudioError}
            className="w-full h-9"
            preload="metadata"
          />
        )
      )}

      {/* 文字版（voice 显示文字，text 显示原文） */}
      <div className={`text-[13px] text-slate-700 leading-relaxed ${isVoice ? 'mt-2' : ''}`}>
        {item.text || '（无文字）'}
      </div>
    </div>
  );
};

// === 空状态 ===
const EmptyState: React.FC<{ tab: TabKey }> = ({ tab }) => (
  <div className="flex flex-col items-center justify-center py-20 text-slate-400">
    {tab === 'voice' ? (
      <Quotes size={40} weight="regular" className="mb-3 opacity-50" />
    ) : (
      <ChatCircleDots size={40} weight="regular" className="mb-3 opacity-50" />
    )}
    <div className="text-sm">
      {tab === 'voice' ? '还没有收藏的语音' : '还没有收藏的消息'}
    </div>
    <div className="text-[11px] mt-1.5 text-center max-w-[240px] leading-relaxed">
      {tab === 'voice' ? 'AI 角色说话时会自动加入收藏' : '聊天页消息操作 → 🌟 收藏'}
    </div>
  </div>
);

export default FavoritesPage;