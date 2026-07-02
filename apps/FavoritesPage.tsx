// FavoritesPage — 收藏页（发现页子页）
// 顶 Tab：消息收藏 / 语音收藏（暮色拍板）
// 内容：按角色分组的收藏列表（每条一个格子，分割线分开）
// 不再用"选角色"层级（暮色最初提议，但 4 层太深）—— 直接 Tab 切换
// 星标：每条卡片自带的星标按钮（独立 tab 不需要"全部/星标"二级）

import React, { useEffect, useState } from 'react';
import { CaretLeft, Star, StarFour, ArrowSquareOut, Quotes, ChatCircleDots } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  FavoriteItem,
  getAllFavorites,
  getVoiceFavorites,
  getStarredFavorites,
  removeFavorite,
  updateFavorite,
  markFavoriteInvalid,
} from '../utils/favoritesStorage';

type TabKey = 'text' | 'voice';

const FavoritesPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { characters, jumpToMessage, addToast } = useOS();
  const [tab, setTab] = useState<TabKey>('voice');
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 加载数据（按 tab 筛选 + 按时间倒序）
  useEffect(() => {
    const load = () => {
      const all = getAllFavorites().filter((f) => f.type === tab);
      setItems(all);
    };
    load();
    const onStorage = () => load();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [tab]);

  // 按角色分组
  const grouped = items.reduce<Record<string, FavoriteItem[]>>((acc, item) => {
    if (!acc[item.charId]) acc[item.charId] = [];
    acc[item.charId].push(item);
    return acc;
  }, {});

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
      <div className="flex items-center px-2 py-3 bg-white border-b border-slate-200/60 shrink-0">
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

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="space-y-0">
            {Object.entries(grouped).map(([charId, charItems]) => {
              const char = characters.find((c) => c.id === charId);
              const charName = charItems[0]?.charName || char?.name || 'AI';
              return (
                <div key={charId}>
                  {/* 角色分组 header */}
                  <div className="px-4 py-2 bg-slate-100/80 flex items-center gap-2 sticky top-0 z-10">
                    {char?.avatar ? (
                      <img src={char.avatar} alt={charName} className="w-6 h-6 rounded-full object-cover bg-white" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-300" />
                    )}
                    <span className="text-xs font-bold text-slate-700">{charName}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{charItems.length} 条</span>
                  </div>
                  {/* 该角色的收藏列表 */}
                  {charItems.map((item) => (
                    <FavoriteCard
                      key={item.id}
                      item={item}
                      expanded={expandedId === item.id}
                      onToggleExpand={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                      onLocate={() => handleLocate(item)}
                      onRemove={() => handleRemove(item)}
                      onToggleStar={() => handleToggleStar(item)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// === 单条收藏卡片 ===
const FavoriteCard: React.FC<{
  item: FavoriteItem;
  expanded: boolean;
  onToggleExpand: () => void;
  onLocate: () => void;
  onRemove: () => void;
  onToggleStar: () => void;
}> = ({ item, expanded, onToggleExpand, onLocate, onRemove, onToggleStar }) => {
  const { addToast } = useOS();
  const date = new Date(item.createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const isVoice = item.type === 'voice';
  const isText = item.type === 'text';

  const handleAudioError = () => {
    markFavoriteInvalid(item.id);
    addToast('语音已失效（CDN 链接过期）', 'warning');
  };

  return (
    <div className="bg-white px-4 py-3.5 border-b border-slate-100">
      {/* 日期 + 星标 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-400 font-medium">{dateStr}</span>
        <div className="flex items-center gap-1">
          {item.starred && <StarFour size={14} weight="fill" className="text-amber-500" />}
          <button
            onClick={onToggleStar}
            className="p-1.5 rounded-full hover:bg-slate-100 active:scale-95 transition-all"
            aria-label={item.starred ? '取消星标' : '加星标'}
          >
            <Star size={14} weight={item.starred ? 'fill' : 'regular'} className={item.starred ? 'text-amber-500' : 'text-slate-400'} />
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
      <button
        onClick={onToggleExpand}
        className={`mt-2 w-full text-left ${isText ? 'mt-0' : ''}`}
      >
        <div className={`text-[13px] text-slate-700 leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}>
          {item.text || '（无文字）'}
        </div>
        {item.text && item.text.length > 80 && (
          <div className="text-[10px] text-amber-600 mt-0.5">{expanded ? '收起' : '展开'}</div>
        )}
      </button>

      {/* 操作按钮 */}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={onLocate}
          className="flex-1 py-1.5 bg-amber-50 text-amber-600 text-xs font-bold rounded-full flex items-center justify-center gap-1 active:scale-95 transition-transform"
        >
          <ArrowSquareOut size={12} weight="bold" />
          定位到聊天
        </button>
        <button
          onClick={onRemove}
          className="px-3 py-1.5 bg-slate-50 text-slate-500 text-xs rounded-full active:bg-slate-100 transition-colors"
        >
          删除
        </button>
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
