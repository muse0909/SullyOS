// CoupleSpaceApp — 情侣空间（暮色 2026-07-31 启动的基础版）
// 基础版 3 模块：打卡 / 时间线 / 悄悄话
// 暮色 2026-07-31 确认：
//   - 只服务暮色一个人（不开放多用户，但代码留扩展）
//   - 用户-角色一对一，每对独立数据
//   - 关系开始日可设置
//   - 邀请机制照抄 miya（发邀请消息 + AI 决策）
//   - AI 主动打卡：30% 概率 / 一天最多 3 条 / 距离上次主动 > 6 小时
//   - 任务清单：去掉"说早安"和"看朋友圈"，合并"听歌"+"一起听"为"邀请一起听"
//   - Launcher 不放图标（暮色 2026-07-31 "Launcher 主页的就不要了"），只从发现页进

import React, { useState, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { CoupleSpace, CharacterProfile, DEFAULT_COUPLE_TASKS } from '../types';
import {
  getAllSpaces,
  getSpace,
  daysTogether,
  addCheckin,
} from '../utils/coupleSpaceStorage';
import { Heart as HeartIcon, ArrowLeft, Sparkle, Plus, X, Flame as FlameIcon, Check as CheckIcon } from '@phosphor-icons/react';

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
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setSpaces(getAllSpaces());
    if (activeCharId) {
      setActiveSpace(getSpace('default', activeCharId));
    }
    setReloadKey(k => k + 1);
  };

  useEffect(() => {
    setSpaces(getAllSpaces());
  }, []);

  useEffect(() => {
    if (activeCharId) {
      setActiveSpace(getSpace('default', activeCharId));
    } else {
      setActiveSpace(null);
    }
  }, [activeCharId]);

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

        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6">
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100/70 text-rose-500 text-xs font-medium mb-2">
              <HeartIcon size={12} weight="fill" />
              <span>你和 ta 的小窝</span>
            </div>
            <p className="text-xs text-slate-500">
              {spaces.length === 0 ? '还没有空间，点下方按钮邀请第一个 ta' : `已有 ${spaces.length} 个空间`}
            </p>
          </div>

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
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-200 to-pink-200 flex items-center justify-center text-rose-500 shrink-0 overflow-hidden">
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

  const char = characters.find(c => c.id === activeSpace.charId) || null;
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
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-6">
        {tab === 'checkin' && (
          <CheckinTab space={activeSpace} char={char} onUpdate={reload} />
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

// ──────────────────────────────────────────
// 打卡 Tab（阶段 2：完整实现）
// ──────────────────────────────────────────

const CheckinTab: React.FC<{
  space: CoupleSpace;
  char: CharacterProfile | null;
  onUpdate: () => void;
}> = ({ space, char, onUpdate }) => {
  const { addToast } = useOS();
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  // 12 个任务今天打卡状态
  const taskStatus = useMemo(() => {
    const todayCheckins = space.checkins.filter(c => c.date === today);
    return DEFAULT_COUPLE_TASKS.map(task => {
      const userDone = todayCheckins.some(c => c.taskId === task.id && c.fromUser);
      const charDone = todayCheckins.some(c => c.taskId === task.id && c.fromChar);
      return { ...task, userDone, charDone };
    });
  }, [space.checkins, today]);

  const todayUserCompleted = taskStatus.filter(t => t.userDone).length;
  const todayCharCompleted = taskStatus.filter(t => t.charDone).length;

  // 用户手动打卡
  const handleUserCheckin = (taskId: string) => {
    const task = DEFAULT_COUPLE_TASKS.find(t => t.id === taskId);
    if (!task) return;
    const result = addCheckin('default', space.charId, {
      date: today,
      taskId: task.id,
      taskName: task.name,
      content: `我完成了「${task.name}」`,
      fromUser: true,
      fromChar: false,
    });
    if (result) {
      onUpdate();
      addToast({ type: 'success', message: `已打卡「${task.name}」` });
    } else {
      addToast({ type: 'error', message: '打卡失败' });
    }
  };

  // 撤销打卡（长按任务卡片）
  const handleUndoCheckin = (taskId: string) => {
    // 简化：直接调 addCheckin 覆盖（用最新的 fromUser=false 标记）
    // 实际应该用单独的 removeCheckin 函数，阶段 3 再加
    addToast({ type: 'info', message: '撤销功能下个版本加' });
  };

  return (
    <div className="space-y-4">
      {/* 顶部统计卡片：连续天数 + 今日进度 */}
      <div className="bg-gradient-to-br from-rose-100 to-pink-100 rounded-2xl p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FlameIcon size={14} weight="fill" className="text-rose-500" />
              <div className="text-xs text-rose-500 font-medium">连续打卡</div>
            </div>
            <div className="text-3xl font-black text-rose-500 tracking-tighter">
              {space.consecutiveDays}
              <span className="text-sm ml-1">天</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-rose-400 mb-1">今日进度</div>
            <div className="flex items-baseline gap-2">
              <div>
                <div className="text-lg font-bold text-rose-500 leading-none">{todayUserCompleted}</div>
                <div className="text-[9px] text-rose-400 mt-0.5">我</div>
              </div>
              <div className="text-rose-300">/</div>
              <div>
                <div className="text-lg font-bold text-rose-400 leading-none">{todayCharCompleted}</div>
                <div className="text-[9px] text-rose-400 mt-0.5">ta</div>
              </div>
              <div className="text-rose-300 text-xs">/ {DEFAULT_COUPLE_TASKS.length}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 任务列表 */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="text-xs text-slate-500 font-medium">今日任务</div>
          <div className="text-[10px] text-slate-400">点打卡 / 长按撤销</div>
        </div>
        <div className="space-y-2">
          {taskStatus.map(task => (
            <CheckinTaskCard
              key={task.id}
              task={task}
              onCheckin={() => handleUserCheckin(task.id)}
              onUndo={() => handleUndoCheckin(task.id)}
            />
          ))}
        </div>
      </div>

      {/* 最近 7 天日历 */}
      <Last7DaysStrip space={space} />

      {/* AI 提示：阶段 2 不接 AI 主动 */}
      <div className="bg-white/40 rounded-2xl p-3 border border-rose-100/40">
        <div className="flex items-center gap-1.5 text-rose-300">
          <Sparkle size={12} weight="fill" />
          <div className="text-[10px]">ta 的主动打卡：阶段 3 接 AI（30% 概率 / 一天最多 3 条）</div>
        </div>
      </div>
    </div>
  );
};

// 单个任务卡片
const CheckinTaskCard: React.FC<{
  task: typeof DEFAULT_COUPLE_TASKS[number] & { userDone: boolean; charDone: boolean };
  onCheckin: () => void;
  onUndo: () => void;
}> = ({ task, onCheckin, onUndo }) => {
  const [longPressTimer, setLongPressTimer] = useState<number | null>(null);

  const handleTouchStart = () => {
    if (!task.userDone) return;
    const t = window.setTimeout(() => {
      onUndo();
    }, 800);
    setLongPressTimer(t);
  };

  const handleTouchEnd = () => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      className={`bg-white rounded-2xl p-3 border transition-all ${
        task.userDone || task.charDone
          ? 'border-rose-200/60 bg-rose-50/30'
          : 'border-rose-100/60 active:scale-[0.98]'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`text-2xl shrink-0 ${task.userDone ? 'grayscale' : ''}`}>
          {task.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${
            task.userDone ? 'text-slate-400 line-through' : 'text-slate-800'
          }`}>
            {task.name}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1.5">
            {task.userDone && (
              <span className="text-rose-400">
                <CheckIcon size={10} weight="bold" className="inline" /> 你
              </span>
            )}
            {task.userDone && task.charDone && <span>·</span>}
            {task.charDone && (
              <span className="text-rose-400">💗 ta</span>
            )}
            {!task.userDone && !task.charDone && (
              <span className="text-slate-300">今天还没打卡</span>
            )}
          </div>
        </div>
        {!task.userDone && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCheckin();
            }}
            className="px-3 py-1.5 bg-rose-400 text-white rounded-full text-xs font-medium active:scale-95 transition-transform shrink-0"
          >
            打卡
          </button>
        )}
      </div>
    </div>
  );
};

// 最近 7 天小日历
const Last7DaysStrip: React.FC<{ space: CoupleSpace }> = ({ space }) => {
  const last7 = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().split('T')[0];
    });
  }, []);

  return (
    <div>
      <div className="text-xs text-slate-500 mb-2 px-1 font-medium">最近 7 天</div>
      <div className="bg-white/60 rounded-2xl p-3 border border-rose-100/40">
        <div className="flex gap-1">
          {last7.map(date => {
            const count = space.checkins.filter(c => c.date === date).length;
            const userCount = space.checkins.filter(c => c.date === date && c.fromUser).length;
            const charCount = space.checkins.filter(c => c.date === date && c.fromChar).length;
            const isToday = date === new Date().toISOString().split('T')[0];
            return (
              <div key={date} className="flex-1 text-center">
                <div className={`text-[9px] mb-1.5 font-medium ${isToday ? 'text-rose-500' : 'text-slate-400'}`}>
                  {date.slice(5)}
                </div>
                <div className={`h-8 rounded-lg flex flex-col items-center justify-center text-[8px] ${
                  count > 0
                    ? 'bg-rose-100 text-rose-500'
                    : 'bg-slate-50 text-slate-300'
                }`}>
                  {count > 0 ? (
                    <>
                      <div className="font-bold leading-none">{count}</div>
                      <div className="text-[7px] mt-0.5 leading-none">
                        {userCount > 0 && `我${userCount}`}
                        {userCount > 0 && charCount > 0 && '·'}
                        {charCount > 0 && `ta${charCount}`}
                      </div>
                    </>
                  ) : (
                    <div className="opacity-30">·</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CoupleSpaceApp;
