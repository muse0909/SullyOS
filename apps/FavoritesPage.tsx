// FavoritesPage — 收藏页（发现页子页）
// 顶 Tab：消息收藏 / 语音收藏
// 内容：所有 favorite 混在一起按时间倒序，不按角色分组（暮色明确"不喜欢混在一起的"是指不喜欢分组本身）
// 卡片操作：右上角横排 ⭐→📍→🗑（暮色拍板顺序）
// 批量删除：进 selection 模式后卡片左侧多选框（2026-07-13）

import React, { useEffect, useState } from 'react';
import { CaretLeft, Star, ArrowSquareOut, Quotes, ChatCircleDots, Trash, Check, X, Broom } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  FavoriteItem,
  getAllFavorites,
  removeFavorite,
  updateFavorite,
  markFavoriteInvalid,
  getFavoriteVoiceBlob,
  deleteVoiceFavoriteCloud,
} from '../utils/favoritesStorage';

type TabKey = 'text' | 'voice';

const FavoritesPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { jumpToMessage, addToast } = useOS();
  const [tab, setTab] = useState<TabKey>('voice');
  const [items, setItems] = useState<FavoriteItem[]>([]);

  // selection 模式（批量删除）—— 暮色 2026-07-13 要求批量删除老收藏
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  // 切 tab 时自动退出 selection 模式
  useEffect(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [tab]);

  const handleLocate = (item: FavoriteItem) => {
    jumpToMessage(item.charId, item.sourceMessageId);
    addToast('正在跳转到聊天...', 'info');
  };

  const handleRemove = (item: FavoriteItem) => {
    if (window.confirm(`确定要删除这条收藏吗？`)) {
      removeFavorite(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      // 云端 blob 也清掉（fire-and-forget，失败不影响主流程）
      if (item.type === 'voice') {
        deleteVoiceFavoriteCloud(item.sourceMessageId).catch((e) => {
          console.warn('[favorites] cloud delete failed', e);
        });
      }
      addToast('已删除', 'success');
    }
  };

  const handleToggleStar = (item: FavoriteItem) => {
    const next = !item.starred;
    updateFavorite(item.id, { starred: next });
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, starred: next } : i)));
    addToast(next ? '已加入星标' : '已取消星标', 'success');
  };

  // === 批量删除 ===
  const enterSelectionMode = () => {
    setSelectionMode(true);
    setSelectedIds(new Set());
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 选中即删除（带确认）
  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定要删除选中的 ${selectedIds.size} 条收藏吗？`)) return;
    const toDelete = items.filter((i) => selectedIds.has(i.id));
    toDelete.forEach((item) => {
      removeFavorite(item.id);
      if (item.type === 'voice') {
        deleteVoiceFavoriteCloud(item.sourceMessageId).catch((e) => {
          console.warn('[favorites] cloud delete failed', e);
        });
      }
    });
    setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
    addToast(`已删除 ${toDelete.length} 条`, 'success');
    exitSelectionMode();
  };

  // 一键全选 + 删除所有失效（invalid=true）条目 —— 暮色 2026-07-13 要求清掉"语音数据已丢失"那批
  const handleCleanInvalid = () => {
    const invalidItems = items.filter((i) => i.invalid);
    if (invalidItems.length === 0) {
      addToast('没有失效的收藏', 'info');
      return;
    }
    if (!window.confirm(`清理 ${invalidItems.length} 条已失效的收藏？此操作不可撤销。`)) return;
    invalidItems.forEach((item) => {
      removeFavorite(item.id);
      if (item.type === 'voice') {
        deleteVoiceFavoriteCloud(item.sourceMessageId).catch((e) => {
          console.warn('[favorites] cloud delete failed', e);
        });
      }
    });
    setItems((prev) => prev.filter((i) => !i.invalid));
    addToast(`已清理 ${invalidItems.length} 条失效收藏`, 'success');
  };

  const invalidCount = items.filter((i) => i.invalid).length;

  return (
    <div className="absolute inset-0 flex flex-col bg-[#ededed]">
      {/* Header — selection 模式下变成「已选 N + 删除 + 取消」 */}
      <div className="flex items-center justify-between px-3 py-3 bg-white border-b border-slate-200/60 shrink-0">
        {selectionMode ? (
          <>
            <button
              onClick={exitSelectionMode}
              className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
              aria-label="取消"
            >
              <X size={18} weight="bold" />
            </button>
            <h1 className="text-base font-semibold text-slate-800 tracking-wide">
              已选 {selectedIds.size}
            </h1>
            <button
              onClick={handleBatchDelete}
              disabled={selectedIds.size === 0}
              className={`px-3 h-9 flex items-center justify-center rounded-full text-sm font-medium transition-all ${
                selectedIds.size === 0
                  ? 'text-slate-300'
                  : 'text-red-500 hover:bg-red-50 active:scale-95'
              }`}
              aria-label="删除选中"
            >
              <Trash size={16} weight="bold" className="mr-1" />
              删除
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onBack}
              className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
              aria-label="返回"
            >
              <CaretLeft size={20} weight="bold" />
            </button>
            <h1 className="text-base font-semibold text-slate-800 tracking-wide">收藏</h1>
            <button
              onClick={enterSelectionMode}
              disabled={items.length === 0}
              className={`px-2.5 h-9 flex items-center justify-center rounded-full text-xs font-medium transition-all ${
                items.length === 0
                  ? 'text-slate-300'
                  : 'text-slate-600 hover:bg-slate-100 active:scale-95'
              }`}
              aria-label="多选"
            >
              <Check size={14} weight="bold" className="mr-1" />
              多选
            </button>
          </>
        )}
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

      {/* 失效清理快捷按钮（仅 voice tab 且有失效条目时显示） */}
      {tab === 'voice' && invalidCount > 0 && !selectionMode && (
        <div className="px-5 pt-3 shrink-0">
          <button
            onClick={handleCleanInvalid}
            className="w-full py-2.5 bg-amber-50 text-amber-700 text-sm font-medium rounded-2xl active:bg-amber-100 transition-colors flex items-center justify-center gap-2 border border-amber-100"
          >
            <Broom size={16} weight="bold" />
            清理 {invalidCount} 条已失效收藏
          </button>
        </div>
      )}

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
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
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
// selection 模式下：左侧 checkbox 替代操作按钮，checkbox 选中状态
const FavoriteCard: React.FC<{
  item: FavoriteItem;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onLocate: () => void;
  onRemove: () => void;
  onToggleStar: () => void;
}> = ({ item, selectionMode, selected, onToggleSelect, onLocate, onRemove, onToggleStar }) => {
  const { addToast } = useOS();
  const date = new Date(item.createdAt);
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

  const isVoice = item.type === 'voice';

  // voice 卡片：mount 时从 IndexedDB 读 blob + 生成 blob URL（解决跨页面 blob 失效）
  // voice 卡片：mount 时按优先级取音源
  // 优先级（2026-07-13 升级）：云端 URL（item.url）> IndexedDB > invalid
  // - 云端 URL 跨设备/换浏览器/清缓存都能用
  // - IndexedDB 兜底老数据（升级前收藏 / 上传失败时）
  // - blob URL（`blob:` 开头）跨页面失效，HEAD 探活不通过直接跳到下一级
  const [voiceSrc, setVoiceSrc] = React.useState<string | null>(null);
  const [voiceResolved, setVoiceResolved] = React.useState(false);
  React.useEffect(() => {
    if (!isVoice || item.invalid) {
      setVoiceResolved(true);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        // 1) 优先云端 URL —— 跳过 blob URL（已经失效）
        if (item.url && !item.url.startsWith('blob:')) {
          const ok = await checkUrlAvailable(item.url);
          if (cancelled) return;
          if (ok) {
            setVoiceSrc(item.url);
            setVoiceResolved(true);
            return;
          }
          // 云端没了（用户手动删 / 后端故障）→ 继续回退
        }

        // 2) 回退 IndexedDB —— 升级前的收藏或本次未上传成功的本地数据
        const blob = await getFavoriteVoiceBlob(item.sourceMessageId);
        if (cancelled) return;
        if (blob) {
          url = URL.createObjectURL(blob);
          setVoiceSrc(url);
        } else {
          // 3) 都没了 → 标 invalid，卡片渲染成「语音已失效」灰块，不再弹 toast
          // 2026-07-22：暮色明确要求关掉这个提示
          // —— 原因：失效条目多时一次性弹 N 个 toast，10 秒才消失，视觉上「挂着不消」
          // —— 失效统一由卡片灰显表达，用户想清理进选择模式一键全选删除
          markFavoriteInvalid(item.id);
        }
        setVoiceResolved(true);
      } catch (e) {
        console.warn('[favorites] read voice failed', e);
        markFavoriteInvalid(item.id);
        addToast('语音读取失败', 'error');
        setVoiceResolved(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [item.id, item.url, item.sourceMessageId, isVoice, item.invalid, addToast]);

  const handleAudioError = () => {
    markFavoriteInvalid(item.id);
    addToast('语音播放失败', 'error');
  };

  return (
    <div
      className={`bg-white rounded-2xl px-4 py-3 shadow-sm border transition-colors ${
        selected ? 'border-amber-300 bg-amber-50/30' : 'border-slate-100/80'
      }`}
      onClick={selectionMode ? onToggleSelect : undefined}
    >
      {/* 日期 + 右上角操作按钮 / selection 模式下显示选中圈 */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {selectionMode && (
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                selected
                  ? 'bg-amber-500 border-amber-500'
                  : 'border-slate-300 bg-white'
              }`}
            >
              {selected && <Check size={12} weight="bold" className="text-white" />}
            </div>
          )}
          <span className="text-[11px] text-slate-400 font-medium">{dateStr}</span>
        </div>
        {!selectionMode && (
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
        )}
      </div>

      {/* 语音条（仅 voice） */}
      {isVoice && (
        item.invalid ? (
          <div className="bg-slate-50 rounded-2xl px-3 py-2.5 text-xs text-slate-400 text-center">
            语音已失效
          </div>
        ) : !voiceResolved ? (
          <div className="bg-slate-50 rounded-2xl px-3 py-2.5 text-xs text-slate-400 text-center">
            加载中...
          </div>
        ) : voiceSrc ? (
          <audio
            controls
            src={voiceSrc}
            onError={handleAudioError}
            className="w-full h-9"
            preload="metadata"
          />
        ) : null
      )}

      {/* 文字版（voice 显示文字，text 显示原文） */}
      <div className={`text-[13px] text-slate-700 leading-relaxed ${isVoice ? 'mt-2' : ''}`}>
        {item.text || '（无文字）'}
      </div>
    </div>
  );
};

// 轻量探活 —— HEAD 请求检查云端 URL 是否还可用
// 失败原因：用户手动删了 / 后端故障 / 跨域
const checkUrlAvailable = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
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
      {tab === 'voice' ? '聊天页 AI 语音条 → 菜单 → 🌟 收藏' : '聊天页消息操作 → 🌟 收藏'}
    </div>
  </div>
);

export default FavoritesPage;
