// CoupleSpaceApp — 情侣空间（暮色 2026-07-31 启动的基础版）
// 基础版 3 模块：打卡 / 时间线 / 悄悄话
// 暮色 2026-07-31 确认：
//   - 只服务暮色一个人（不开放多用户，但代码留扩展）
//   - 用户-角色一对一，每对独立数据
//   - 关系开始日可设置
//   - 邀请机制照抄 miya（发邀请消息 + AI 决策）
//   - AI 主动打卡：30% 概率 / 一天最多 3 条 / 距离上次主动 > 6 小时
//   - 任务清单：去掉"说早安"和"看朋友圈"，合并"听歌"+"一起听"为"邀请一起听"

import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { CoupleSpace, DEFAULT_COUPLE_TASKS } from '../types';
import {
  getAllSpaces,
  getSpace,
  daysTogether,
} from '../utils/coupleSpaceStorage';
import { Heart as HeartIcon, ArrowLeft, Sparkle, Plus, X } from '@phosphor-icons/react';

// ──────────────────────────────────────────
// 视图状态
// ──────────────────────────────────────────

type View = 'gate' | 'space';
type Tab = 'checkin' | 'timeline' | 'whisper';

const CoupleSpaceApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, addToast } = useOS();
  const [view, setView] = useState<View>('gate');
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('checkin');
  const [spaces, setSpaces] = useState<CoupleSpace[]>([]);
  const [activeSpace, setActiveSpace] = useState<CoupleSpace | null>(null);

  // 加载所有空间
  const reload = () => {
    setSpaces(getAllSpaces());
    if (activeCharId) {
      setActiveSpace(getSpace('default', activeCharId));
    }
  };

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (activeCharId) {
      setActiveSpace(getSpace('default', activeCharId));
    }
  }, [activeCharId]);

  // 默认选中当前聊天角色
  useEffect(() => {
    if (!activeCharId && activeCharacterId) {
      setActiveCharId(activeCharacterId);
    }
  }, [activeCharacterId]);

  // ──────────────────────────────────────────
  // Gate 视图：空间列表 + 邀请入口
  // ──────────────────────────────────────────

  if (view === 'gate') {
    return (
      <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-rose-50 via-white to-pink-50">
        {/* 顶部 Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-white/70 backdrop-blur-md border-b border-rose-100/60 shrink-0">
          <button
            onClick={closeApp}
            className="w-9 h-9 flex items-center justify-center rounded-full text-rose-400 hover:bg-rose-50 active:scale-95 transition-transform"
            aria-label="返回"
          >
            <ArrowLeft size={20} weight="bold" />
          </button>
          <h1 className="text-base font-bold text-slate-800 tracking-wide">情侣空间</h1>
          <div className="w-9 h-9" />
        </div>

        {/* 列表内容 */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          {/* 顶部副标题 */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100/70 text-rose-500 text-xs font-medium mb-2">
              <HeartIcon size={12} weight="fill" />
              <span>你和 ta 的小窝</span>
            </div>
            <p className="text-xs text-slate-500">
              {spaces.length === 0 ? '还没有空间，点下方按钮邀请第一个 ta' : `已有 ${spaces.length} 个空间`}
            </p>
          </div>

          {/* 已开通空间列表 */}
          {spaces.length > 0 && (
            <div className="space-y-3 mb-4">
              {spaces.map(space => {
                const char = characters.find(c => c.id === space.charId);
                const days = daysTogether(space.annivDate);
                return (
                  <button
                    key={space.pairId}
                    onClick={() => {
                      setActiveCharId(space.charId);
                      setView('space');
                    }}
                    className="w-full bg-white rounded-2xl p-4 shadow-sm border border-rose-100/60 active:scale-[0.98] transition-transform text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-200 to-pink-200 flex items-center justify-center text-rose-500 shrink-0">
                        {char?.avatar ? (
                          <img src={char.avatar} alt={char.name} className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <HeartIcon size={20} weight="fill" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-800">
                          我 & {char?.name || 'TA'}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          在一起 {days} 天 · {space.checkins.length} 次打卡
                        </div>
                      </div>
                      <div className="text-rose-300 text-xs">›</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* 邀请新空间入口 */}
          <button
            onClick={() => {
              addToast({ type: 'info', message: '邀请功能开发中，敬请期待' });
            }}
            className="w-full bg-gradient-to-r from-rose-100 to-pink-100 rounded-2xl p-4 border-2 border-dashed border-rose-200/80 active:scale-[0.98] transition-transform"
          >
            <div className="flex flex-col items-center gap-2 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center">
                <Plus size={20} weight="bold" />
              </div>
              <div className="text-sm font-medium">邀请 ta 开通情侣空间</div>
              <div className="text-[10px] text-rose-300">（开发中）</div>
            </div>
          </button>

          {/* 任务清单预览 */}
          <div className="mt-6 bg-white/60 rounded-2xl p-4 border border-rose-100/60">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkle size={14} weight="fill" className="text-rose-400" />
              <span className="text-xs font-bold text-slate-700">任务清单预览</span>
            </div>
            <div className="text-[10px] text-slate-500 mb-2">
              12 个打卡任务，AI 主动触发
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_COUPLE_TASKS.slice(0, 6).map(task => (
                <div key={task.id} className="px-2 py-1 bg-rose-50/80 rounded-full text-[10px] text-rose-500">
                  {task.emoji} {task.name}
                </div>
              ))}
              <div className="px-2 py-1 bg-rose-50/80 rounded-full text-[10px] text-rose-500">
                +{DEFAULT_COUPLE_TASKS.length - 6}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────
  // Space 视图：3 Tab
  // ──────────────────────────────────────────

  if (!activeSpace) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-rose-50">
        <div className="text-slate-500 text-sm">空间不存在</div>
      </div>
    );
  }

  const char = characters.find(c => c.id === activeSpace.charId);
  const days = daysTogether(activeSpace.annivDate);

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-rose-50 via-white to-pink-50">
      {/* 顶部 Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/70 backdrop-blur-md border-b border-rose-100/60 shrink-0">
        <button
          onClick={() => setView('gate')}
          className="w-9 h-9 flex items-center justify-center rounded-full text-rose-400 hover:bg-rose-50 active:scale-95 transition-transform"
          aria-label="返回"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <h1 className="text-base font-bold text-slate-800 tracking-wide">
          我 & {char?.name || 'TA'}
        </h1>
        <div className="w-9 h-9" />
      </div>

      {/* 关系天数 */}
      <div className="px-4 py-4 text-center bg-white/40 shrink-0">
        <div className="text-3xl font-black text-rose-400 tracking-tighter">{days}</div>
        <div className="text-[10px] text-slate-500 mt-1 tracking-wider">DAYS TOGETHER</div>
        <div className="text-[10px] text-slate-400 mt-1">Since {activeSpace.annivDate}</div>
      </div>

      {/* 3 Tab 切换 */}
      <div className="flex items-center justify-center gap-2 px-4 py-3 shrink-0">
        {[
          { id: 'checkin' as Tab, label: '打卡', emoji: '✨' },
          { id: 'timeline' as Tab, label: '时间线', emoji: '📖' },
          { id: 'whisper' as Tab, label: '悄悄话', emoji: '💌' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
              tab === t.id
                ? 'bg-rose-400 text-white shadow-sm'
                : 'bg-white/60 text-slate-500 hover:bg-white/80'
            }`}
          >
            <span className="mr-1">{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'checkin' && (
          <div className="bg-white/60 rounded-2xl p-6 text-center">
            <div className="text-rose-300 text-xs mb-2">打卡模块</div>
            <div className="text-slate-400 text-sm">开发中，下一轮做</div>
            <div className="text-[10px] text-slate-400 mt-2">
              连续打卡 {activeSpace.consecutiveDays} 天 · 共 {activeSpace.checkins.length} 次
            </div>
          </div>
        )}
        {tab === 'timeline' && (
          <div className="bg-white/60 rounded-2xl p-6 text-center">
            <div className="text-rose-300 text-xs mb-2">时间线模块</div>
            <div className="text-slate-400 text-sm">开发中，下一轮做</div>
            <div className="text-[10px] text-slate-400 mt-2">
              共 {activeSpace.timeline.length} 条记录
            </div>
          </div>
        )}
        {tab === 'whisper' && (
          <div className="bg-white/60 rounded-2xl p-6 text-center">
            <div className="text-rose-300 text-xs mb-2">悄悄话模块</div>
            <div className="text-slate-400 text-sm">开发中，下一轮做</div>
            <div className="text-[10px] text-slate-400 mt-2">
              共 {activeSpace.whispers.length} 条
              {activeSpace.whisperUnread > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 bg-rose-400 text-white rounded-full text-[9px]">
                  {activeSpace.whisperUnread} 未读
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CoupleSpaceApp;
