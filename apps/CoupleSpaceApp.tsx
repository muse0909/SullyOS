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
import { CoupleSpace, CharacterProfile, DEFAULT_COUPLE_TASKS, AppID } from '../types';
import { DB } from '../utils/db';
import {
  getAllSpaces,
  getSpace,
  daysTogether,
  addCheckin,
  initSpace,
  markPending,
  acceptInvite,
  declineInvite,
  expireOldPendingInvites,
  deleteSpace,
  setAnnivDate,
} from '../utils/coupleSpaceStorage';
import Modal from '../components/os/Modal';
import {
  Heart as HeartIcon,
  ArrowLeft,
  Sparkle,
  Plus,
  Flame as FlameIcon,
  Check as CheckIcon,
  Gear as GearIcon,
  Warning as WarningIcon,
} from '@phosphor-icons/react';

// ──────────────────────────────────────────
// 视图状态
// ──────────────────────────────────────────

type View = 'gate' | 'space';
type Tab = 'checkin' | 'timeline' | 'whisper';

const todayStr = () => new Date().toISOString().split('T')[0];

const CoupleSpaceApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, addToast, coupleSpaceAccept, coupleSpaceDecline, requestCoupleSpaceDecision, requestCoupleSpaceInviteFromChar, jumpToChat } = useOS();
  const [view, setView] = useState<View>('gate');
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('checkin');
  const [spaces, setSpaces] = useState<CoupleSpace[]>([]);
  const [activeSpace, setActiveSpace] = useState<CoupleSpace | null>(null);

  // 邀请弹窗状态
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSelectedCharId, setInviteSelectedCharId] = useState<string>('');
  const [inviteAnnivDate, setInviteAnnivDate] = useState<string>(todayStr());

  // 暮色 2026-07-31 反馈"没有关掉情侣空间的设置"
  //   设置弹窗：改关系开始日 + 解除情侣空间
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editableAnnivDate, setEditableAnnivDate] = useState<string>('');
  const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);

  const reload = () => {
    setSpaces(getAllSpaces());
    if (activeCharId) {
      setActiveSpace(getSpace('default', activeCharId));
    }
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

  // 暮色 2026-07-31：window 全局方案废——CoupleSpaceApp 没挂载时 window.__coupleSpaceAccept 是 undefined
  //   修法：handleUserAccept / handleUserDecline 直接用 OSContext 的 coupleSpaceAccept / coupleSpaceDecline
  //   useEffect 删掉（不再需要挂 window）

  // 打开邀请弹窗（重置默认值）
  const openInviteModal = () => {
    setInviteAnnivDate(todayStr());
    setInviteSelectedCharId('');
    setShowInviteModal(true);
  };

  // 打开设置弹窗（暮色 2026-07-31：关掉情侣空间 + 改开始日）
  const openSettingsModal = () => {
    if (activeSpace) {
      setEditableAnnivDate(activeSpace.annivDate);
      setShowSettingsModal(true);
    }
  };

  // 保存关系开始日
  const handleSaveAnnivDate = () => {
    if (!activeSpace || !editableAnnivDate) return;
    setAnnivDate('default', activeSpace.charId, editableAnnivDate);
    setShowSettingsModal(false);
    reload();
    addToast({ type: 'success', message: '关系开始日已更新' });
  };

  // 解除情侣空间（删除数据 + 推消息 + 跳回 gate）
  const handleUnbindSpace = async () => {
    if (!activeSpace) return;
    const char = characters.find(c => c.id === activeSpace.charId);
    deleteSpace('default', activeSpace.charId);
    // 推一条 system 消息告诉角色（跟开通时对称）
    try {
      await DB.saveMessage({
        charId: activeSpace.charId,
        role: 'system',
        type: 'couple_space_event',
        content: '暮色关掉了和你的情侣空间。',
        metadata: {
          source: 'couple_space_unbind',
          pairId: activeSpace.pairId,
        },
      });
    } catch (e) {
      console.error('[coupleSpace] 发送解除消息失败', e);
    }
    setShowUnbindConfirm(false);
    setShowSettingsModal(false);
    setView('gate');
    setActiveCharId('');
    reload();
    addToast({ type: 'info', message: `已解除和 ${char?.name || 'TA'} 的情侣空间` });
  };

  // 提交邀请
  // 暮色 2026-07-31 反馈"前面咱们说的你不记得了吗"——补完整 miya 流程
  // 完整版 B：markPending + 发邀请消息 + 跳聊天 + AI 决策（让江澈用 LLM 决定接受/拒绝）
  const handleConfirmInvite = async () => {
    if (!inviteSelectedCharId) {
      addToast({ type: 'error', message: '请选一个 ta' });
      return;
    }
    const char = characters.find(c => c.id === inviteSelectedCharId);
    if (!char) return;

    // 1. 把旧 pending 邀请标 expired
    expireOldPendingInvites('default', char.id);

    // 2. 标 pending 状态
    const space = markPending({
      profileId: 'default',
      charId: char.id,
      charName: char.name,
      profileName: '我',
      annivDate: inviteAnnivDate,
    });

    // 3. 发邀请消息到聊天（type: couple_space_invite + status: pending）
    try {
      await DB.saveMessage({
        charId: char.id,
        role: 'system',
        type: 'couple_space_invite',
        content: `暮色向你发出情侣空间邀请 💕（从 ${inviteAnnivDate} 开始）。点下方"接受"开通，或"拒绝"放弃。`,
        metadata: {
          source: 'couple_space_invite',
          pairId: space.pairId,
          annivDate: inviteAnnivDate,
          status: 'pending',
        },
      });
    } catch (e) {
      console.error('[coupleSpace] 发送邀请消息失败', e);
      addToast({ type: 'error', message: '邀请消息发送失败，请重试' });
      return;
    }

    setShowInviteModal(false);
    setActiveCharId(char.id);
    reload();
    addToast({ type: 'info', message: `邀请已发送给 ${char.name}，等 ta 回应...` });

    // 4. 跳转到角色的私聊（用 jumpToChat 真正跳到江澈的 chat，不是联系人列表）
    //   暮色 2026-07-31 反馈"跳的是联系人页，不是聊天页"——之前用 openApp(AppID.Chat) 错
    //   SullyOS 已经有 jumpToChat（line 3230）：设 pending ref + setActiveCharacterId + setActiveApp
    //   WeChat mount 时 consume pending ref 自动 open 私聊
    setTimeout(() => jumpToChat(char.id), 600);

    // 5. 触发 AI 决策（异步，不等返回）
    //   暮色 2026-07-31 选 B 完整版：让江澈用 LLM 决定接受/拒绝
    //   失败/超时 → 默认接受（不会卡流程）
    requestCoupleSpaceDecision(char.id).catch(e => {
      console.error('[coupleSpace] AI 决策失败', e);
    });
  };

  // 暮色手动接受邀请（卡片上"接受"按钮 onClick）
  // 暮色 2026-07-31 反馈：之前 window 全局方案在 CoupleSpaceApp 没挂载时失败
  //   改用 OSContext.coupleSpaceAccept（永远可用）
  const handleUserAccept = async (charId: string) => {
    await coupleSpaceAccept(charId);
    setActiveCharId(charId);
    setView('space');
    reload();
    const char = characters.find(c => c.id === charId);
    addToast({ type: 'success', message: `和 ${char?.name || 'TA'} 的情侣空间已开通` });
  };

  // 暮色手动拒绝邀请
  const handleUserDecline = async (charId: string) => {
    await coupleSpaceDecline(charId);
    const char = characters.find(c => c.id === charId);
    addToast({ type: 'info', message: `已拒绝 ${char?.name || 'TA'} 的情侣空间邀请` });
  };

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
            onClick={openInviteModal}
            className="w-full bg-gradient-to-r from-rose-100 to-pink-100 rounded-2xl p-4 border-2 border-dashed border-rose-200/80 active:scale-[0.98] transition-transform"
          >
            <div className="flex flex-col items-center gap-2 text-rose-400">
              <div className="w-10 h-10 rounded-full bg-white/80 flex items-center justify-center">
                <Plus size={20} weight="bold" />
              </div>
              <div className="text-sm font-medium">邀请 ta 开通情侣空间</div>
            </div>
          </button>

          {/* 暮色 2026-07-31：让 ta 邀请我（角色主动发邀请） */}
          <button
            onClick={async () => {
              const charId = activeCharacterId;
              if (!charId) {
                addToast({ type: 'error', message: '先去聊天里选个角色' });
                return;
              }
              const char = characters.find(c => c.id === charId);
              if (!char) return;
              addToast({ type: 'info', message: `${char.name} 正在准备邀请...` });
              await requestCoupleSpaceInviteFromChar(charId);
            }}
            className="w-full mt-3 bg-white/60 rounded-2xl p-3 border border-rose-100/40 active:scale-[0.98] transition-transform"
          >
            <div className="flex items-center justify-center gap-2 text-slate-500">
              <div className="text-[10px]">让 ta 邀请我</div>
            </div>
          </button>
        </div>

        {/* 邀请弹窗 */}
        <InviteModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onConfirm={handleConfirmInvite}
          characters={characters}
          existingCharIds={new Set(spaces.map(s => s.charId))}
          selectedCharId={inviteSelectedCharId}
          setSelectedCharId={setInviteSelectedCharId}
          annivDate={inviteAnnivDate}
          setAnnivDate={setInviteAnnivDate}
        />
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
        {/* 暮色 2026-07-31：加齿轮入口到空间设置（改日期 / 解除） */}
        <button
          onClick={openSettingsModal}
          className="w-9 h-9 flex items-center justify-center rounded-full text-rose-400 hover:bg-rose-50 active:scale-95 transition-transform"
          aria-label="设置"
        >
          <GearIcon size={20} weight="bold" />
        </button>
      </div>

      {/* 关系天数 + 设置入口 */}
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

      {/* 暮色 2026-07-31：情侣空间设置弹窗（齿轮入口） */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        charName={char?.name || 'TA'}
        editableAnnivDate={editableAnnivDate}
        setEditableAnnivDate={setEditableAnnivDate}
        onSaveAnniv={handleSaveAnnivDate}
        onUnbindClick={() => setShowUnbindConfirm(true)}
      />

      {/* 解除确认弹窗（二次确认） */}
      <UnbindConfirmModal
        isOpen={showUnbindConfirm}
        onClose={() => setShowUnbindConfirm(false)}
        onConfirm={handleUnbindSpace}
        charName={char?.name || 'TA'}
      />
    </div>
  );
};

// ──────────────────────────────────────────
// 邀请弹窗（暮色 2026-07-31 反馈"没邀请测不了"，先做简化版）
//   简化版：暮色点开通就直接 initSpace（不等 AI 决策）
//   后续阶段：补"发邀请消息到聊天 + AI 决策"（miya 完整机制）
// ──────────────────────────────────────────

const InviteModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  characters: CharacterProfile[];
  existingCharIds: Set<string>;
  selectedCharId: string;
  setSelectedCharId: (id: string) => void;
  annivDate: string;
  setAnnivDate: (d: string) => void;
}> = ({ isOpen, onClose, onConfirm, characters, existingCharIds, selectedCharId, setSelectedCharId, annivDate, setAnnivDate }) => {
  const available = characters.filter(c => !existingCharIds.has(c.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="邀请 ta 开通情侣空间"
      footer={
        <div className="flex gap-2 w-full">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 text-slate-500 font-bold rounded-full active:scale-95 transition-transform"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!selectedCharId}
            className="flex-1 py-2.5 bg-rose-400 text-white font-bold rounded-full active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            开通
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 选 ta */}
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">选择 ta</div>
          {available.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-6">
              {characters.length === 0
                ? '还没有角色，先去聊天里加一个'
                : '所有角色都已开通情侣空间'}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto no-scrollbar">
              {available.map(char => (
                <button
                  key={char.id}
                  onClick={() => setSelectedCharId(char.id)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-2xl transition-all ${
                    selectedCharId === char.id
                      ? 'bg-rose-50 border border-rose-200'
                      : 'bg-slate-50 border border-transparent active:scale-[0.98]'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-200 to-pink-200 flex items-center justify-center overflow-hidden shrink-0">
                    {char.avatar ? (
                      <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                    ) : (
                      <HeartIcon size={16} weight="fill" className="text-rose-400" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-slate-800">{char.name}</div>
                  </div>
                  {selectedCharId === char.id && (
                    <CheckIcon size={16} weight="bold" className="text-rose-500" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 关系开始日 */}
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">关系开始日</div>
          <input
            type="date"
            value={annivDate}
            onChange={e => setAnnivDate(e.target.value)}
            max={todayStr()}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-2xl text-sm text-slate-800 border border-slate-200 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
          <div className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
            可以填历史日期，比如你和 ta 第一次说话那天
          </div>
        </div>
      </div>
    </Modal>
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
  const today = useMemo(() => todayStr(), []);

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
          <div className="text-[10px] text-slate-400">点打卡 · 长按撤销</div>
        </div>
        <div className="space-y-2">
          {taskStatus.map(task => (
            <CheckinTaskCard
              key={task.id}
              task={task}
              onCheckin={() => handleUserCheckin(task.id)}
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
}> = ({ task, onCheckin }) => {
  return (
    <div className={`bg-white rounded-2xl p-3 border transition-all ${
      task.userDone || task.charDone
        ? 'border-rose-200/60 bg-rose-50/30'
        : 'border-rose-100/60 active:scale-[0.98]'
    }`}>
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
            onClick={onCheckin}
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
            const isToday = date === todayStr();
            return (
              <div key={date} className="flex-1 text-center">
                <div className={`text-[9px] mb-1.5 font-medium ${isToday ? 'text-rose-500' : 'text-slate-400'}`}>
                  {date.slice(5)}
                </div>
                <div className={`h-10 rounded-lg flex flex-col items-center justify-center text-[8px] ${
                  count > 0
                    ? 'bg-rose-100 text-rose-500'
                    : 'bg-slate-50 text-slate-300'
                }`}>
                  {count > 0 ? (
                    <>
                      <div className="font-bold leading-none text-[11px]">{count}</div>
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

// ──────────────────────────────────────────
// 设置弹窗（暮色 2026-07-31 反馈"没有关掉情侣空间的设置"）
//   改关系开始日 + 解除情侣空间
// ──────────────────────────────────────────

const SettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  charName: string;
  editableAnnivDate: string;
  setEditableAnnivDate: (d: string) => void;
  onSaveAnniv: () => void;
  onUnbindClick: () => void;
}> = ({ isOpen, onClose, charName, editableAnnivDate, setEditableAnnivDate, onSaveAnniv, onUnbindClick }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="情侣空间设置"
      footer={
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-slate-100 text-slate-500 font-bold rounded-full active:scale-95 transition-transform"
        >
          关闭
        </button>
      }
    >
      <div className="space-y-5">
        {/* 关系开始日 */}
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">关系开始日</div>
          <div className="text-[10px] text-slate-400 mb-2">在 {charName} 的关系从哪一天开始算？</div>
          <input
            type="date"
            value={editableAnnivDate}
            onChange={e => setEditableAnnivDate(e.target.value)}
            max={todayStr()}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-2xl text-sm text-slate-800 border border-slate-200 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
          <button
            onClick={onSaveAnniv}
            disabled={!editableAnnivDate}
            className="w-full mt-3 py-2.5 bg-rose-400 text-white font-bold rounded-full active:scale-95 transition-transform disabled:opacity-50"
          >
            保存
          </button>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-slate-200" />

        {/* 解除情侣空间 */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <WarningIcon size={14} weight="fill" className="text-red-500" />
            <div className="text-xs text-red-500 font-medium">解除情侣空间</div>
          </div>
          <div className="text-[10px] text-slate-500 mb-3 leading-relaxed">
            解除后会删除所有打卡 / 时间线 / 悄悄话数据，<span className="text-red-500 font-medium">不可恢复</span>。
          </div>
          <button
            onClick={onUnbindClick}
            className="w-full py-2.5 bg-red-50 text-red-500 font-bold rounded-full border border-red-200/60 active:scale-95 transition-transform"
          >
            解除...
          </button>
        </div>
      </div>
    </Modal>
  );
};

// 解除确认弹窗（二次确认）
const UnbindConfirmModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  charName: string;
}> = ({ isOpen, onClose, onConfirm, charName }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="确定要解除吗？"
      footer={
        <div className="flex gap-2 w-full">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 text-slate-500 font-bold rounded-full active:scale-95 transition-transform"
          >
            再想想
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-500 text-white font-bold rounded-full active:scale-95 transition-transform"
          >
            确认解除
          </button>
        </div>
      }
    >
      <div className="text-center py-2">
        <div className="text-4xl mb-3">💔</div>
        <div className="text-sm text-slate-700 leading-relaxed">
          和 <span className="font-bold text-rose-500">{charName}</span> 的情侣空间会被删除
        </div>
        <div className="text-[10px] text-slate-400 mt-2 leading-relaxed">
          所有打卡 / 时间线 / 悄悄话都会消失<br />
          还会告诉 {charName} 这个决定
        </div>
      </div>
    </Modal>
  );
};

export default CoupleSpaceApp;
