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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { CoupleSpace, CoupleTimelineItem, CoupleWhisper, CharacterProfile, DEFAULT_COUPLE_TASKS, AppID } from '../types';
import { DB } from '../utils/db';
import {
  getAllSpaces,
  getSpace,
  daysTogether,
  addCheckin,
  pickRandomTask,
  initSpace,
  markPending,
  acceptInvite,
  declineInvite,
  expireOldPendingInvites,
  deleteSpace,
  setAnnivDate,
  addTimelineItem,
  updateTimelineItem,
  deleteTimelineItem,
  addWhisper,
  markWhispersRead,
  deleteWhisper,
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
  PencilSimple,
  Trash,
  PaperPlaneTilt,
  ArrowUUpLeft,
  X,
} from '@phosphor-icons/react';

// ──────────────────────────────────────────
// 视图状态
// ──────────────────────────────────────────

type View = 'gate' | 'space';
type Tab = 'checkin' | 'timeline' | 'whisper';

const todayStr = () => new Date().toISOString().split('T')[0];

const CoupleSpaceApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, addToast, coupleSpaceAccept, coupleSpaceDecline, requestCoupleSpaceInviteFromChar, jumpToChat, apiConfig, decideCoupleSpaceInvite } = useOS();
  const [view, setView] = useState<View>('gate');
  const [activeCharId, setActiveCharId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('checkin');
  const [spaces, setSpaces] = useState<CoupleSpace[]>([]);
  const [activeSpace, setActiveSpace] = useState<CoupleSpace | null>(null);

  // 邀请弹窗状态
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSelectedCharId, setInviteSelectedCharId] = useState<string>('');
  const [inviteAnnivDate, setInviteAnnivDate] = useState<string>(todayStr());

  // 暮色 2026-07-31 反馈"让 ta 邀请我没有选择角色功能" — 加选角色弹窗
  const [showCharSelectForInviteModal, setShowCharSelectForInviteModal] = useState(false);

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
    addToast('关系开始日已更新', 'success');
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
    addToast(`已解除和 ${char?.name || 'TA'} 的情侣空间`, 'info');
  };

  // 提交邀请
  // 暮色 2026-08-01 反馈"用户发邀请应该触发 LLM 真决定接/拒 + 写回应消息"
  //   完整版 C：markPending + 发邀请卡 + LLM 真决定（decideCoupleSpaceInvite 'respond'）
  //   - LLM accept: 自动 acceptInvite + 改 message status='accepted' + 写 assistant 心情消息
  //   - LLM decline: 自动 declineInvite + 改 message status='declined' + 写 assistant 拒绝消息（说明原因）
  //   - LLM 失败: 保持 pending，等用户手动按按钮
  const handleConfirmInvite = async () => {
    if (!inviteSelectedCharId) {
      addToast('请选一个 ta', 'error');
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
      addToast('邀请消息发送失败，请重试', 'error');
      return;
    }

    setShowInviteModal(false);
    setActiveCharId(char.id);
    reload();
    addToast(`邀请已发送给 ${char.name}，等 ta 回应...`, 'info');

    // 4. 跳转到私聊（暮色能看到邀请卡 + 角色回应消息）
    setTimeout(() => jumpToChat(char.id), 600);

    // 5. 调 LLM 真决定接/拒（fire-and-forget，避免阻塞 UI）
    //   暮色 2026-08-01 反馈"什么情况都接受"——这次是 LLM 真判断（不是 60s 超时默认）
    //   失败 fallback：保持 pending，等用户手动按按钮
    void (async () => {
      try {
        const decision = await decideCoupleSpaceInvite(char.id, 'respond', inviteAnnivDate);
        if (!decision) {
          console.log('[coupleSpace] AI 决策失败/无 API，保持 pending 等用户手动按按钮');
          return;
        }
        if (decision.action === 'accept') {
          // LLM 接受：自动调用 acceptInvite + 改 message status
          const { acceptInvite } = await import('../utils/coupleSpaceStorage');
          acceptInvite('default', char.id);
          try {
            const { updateMessageMeta } = await import('../utils/db');
            const msgs = await DB.getMessagesByCharId(char.id, true);
            const pending = msgs
              .filter((mm: any) => mm.type === 'couple_space_invite' && mm.metadata?.status === 'pending')
              .sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
            if (pending[0]?.id) {
              await updateMessageMeta(pending[0].id, { status: 'accepted', resolvedAt: Date.now() });
            }
          } catch (e) {
            console.error('[coupleSpace] 更新邀请卡 status 失败', e);
          }
          const responseText = decision.message || `${char.name}接受了你的情侣空间邀请 💕`;
          try {
            await DB.saveMessage({
              charId: char.id,
              role: 'assistant',
              type: 'text',
              content: responseText,
              metadata: { source: 'couple_space_ai_decision', decision: 'accept' },
            });
          } catch (e) {
            console.error('[coupleSpace] 写 AI 接受回应消息失败', e);
          }
          addToast(`${char.name} 接受了你的邀请 💕`, 'success');
          window.dispatchEvent(new CustomEvent('coupleSpaceInviteResolved', { detail: { charId: char.id, status: 'accepted' } }));
        } else {
          // LLM 拒绝：自动调用 declineInvite + 改 message status
          const { declineInvite } = await import('../utils/coupleSpaceStorage');
          declineInvite('default', char.id);
          try {
            const { updateMessageMeta } = await import('../utils/db');
            const msgs = await DB.getMessagesByCharId(char.id, true);
            const pending = msgs
              .filter((mm: any) => mm.type === 'couple_space_invite' && mm.metadata?.status === 'pending')
              .sort((a: any, b: any) => (b.id || 0) - (a.id || 0));
            if (pending[0]?.id) {
              await updateMessageMeta(pending[0].id, { status: 'declined', resolvedAt: Date.now() });
            }
          } catch (e) {
            console.error('[coupleSpace] 更新邀请卡 status 失败', e);
          }
          const responseText = decision.message || `${char.name}婉拒了你的情侣空间邀请。`;
          try {
            await DB.saveMessage({
              charId: char.id,
              role: 'assistant',
              type: 'text',
              content: responseText,
              metadata: { source: 'couple_space_ai_decision', decision: 'decline' },
            });
          } catch (e) {
            console.error('[coupleSpace] 写 AI 拒绝回应消息失败', e);
          }
          addToast(`${char.name} 婉拒了邀请`, 'info');
          window.dispatchEvent(new CustomEvent('coupleSpaceInviteResolved', { detail: { charId: char.id, status: 'declined' } }));
        }
      } catch (e) {
        console.error('[coupleSpace] AI 决策整体失败', e);
      }
    })();
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
    addToast(`和 ${char?.name || 'TA'} 的情侣空间已开通`, 'success');
  };

  // 暮色手动拒绝邀请
  const handleUserDecline = async (charId: string) => {
    await coupleSpaceDecline(charId);
    const char = characters.find(c => c.id === charId);
    addToast(`已拒绝 ${char?.name || 'TA'} 的情侣空间邀请`, 'info');
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
            onClick={() => {
              if (characters.length === 0) {
                addToast('还没有角色，先去聊天里加一个', 'error');
                return;
              }
              setShowCharSelectForInviteModal(true);
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

        {/* 暮色 2026-07-31：选角色弹窗（让 ta 邀请我） */}
        <CharSelectForInviteModal
          isOpen={showCharSelectForInviteModal}
          onClose={() => setShowCharSelectForInviteModal(false)}
          characters={characters}
          existingCharIds={new Set(spaces.map(s => s.charId))}
          onConfirm={async (charId) => {
            setShowCharSelectForInviteModal(false);
            const char = characters.find(c => c.id === charId);
            if (!char) return;
            addToast(`${char.name} 正在准备邀请...`, 'info');
            await requestCoupleSpaceInviteFromChar(charId);
          }}
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
          <TimelineTab space={activeSpace} char={char} onUpdate={reload} />
        )}
        {tab === 'whisper' && (
          <WhisperTab space={activeSpace} char={char} onUpdate={reload} />
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

// 暮色 2026-07-31 反馈"让 ta 邀请我没有选择角色功能"——加一个只选角色的弹窗
// 区别于 InviteModal：
//   - 不要日期（关系开始日用今天）
//   - 暮色反馈"已开通的不能重新发"——只显示未开通的角色
const CharSelectForInviteModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  characters: CharacterProfile[];
  existingCharIds: Set<string>;
  onConfirm: (charId: string) => void;
}> = ({ isOpen, onClose, characters, existingCharIds, onConfirm }) => {
  const [selectedCharId, setSelectedCharId] = useState<string>('');
  const available = characters.filter(c => !existingCharIds.has(c.id));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="让 ta 邀请我"
      footer={
        <div className="flex gap-2 w-full">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 text-slate-500 font-bold rounded-full active:scale-95 transition-transform"
          >
            取消
          </button>
          <button
            onClick={() => selectedCharId && onConfirm(selectedCharId)}
            disabled={!selectedCharId}
            className="flex-1 py-2.5 bg-rose-400 text-white font-bold rounded-full active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            让 ta 邀请
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">选择 ta</div>
          <div className="text-[10px] text-slate-400 mb-2 leading-relaxed">
            选一个角色，ta 会主动发邀请卡片给你
          </div>
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
      addToast(`已打卡「${task.name}」`, 'success');
    } else {
      addToast('打卡失败', 'error');
    }
  };

  // 暮色 2026-08-01：测试 ta 主动打卡（绕过 30% 概率 / 6 小时间隔 / 一天 3 条）
  //   触发逻辑跟 OSContext.runProactive 完全一样，只是强制走 addCheckin 路径
  const charName = char?.name || 'TA';
  const handleTestAiCheckin = async () => {
    const task = pickRandomTask();
    addCheckin('default', space.charId, {
      date: today,
      taskId: task.id,
      taskName: task.name,
      content: `ta 完成了「${task.name}」`,
      fromUser: false,
      fromChar: true,
    });
    await DB.saveMessage({
      charId: space.charId,
      role: 'system',
      type: 'couple_space_event',
      content: `[情侣空间事件] ${charName} 完成了「${task.name}」`,
      metadata: { source: 'couple_space_ai_checkin_test', taskId: task.id },
    });
    window.dispatchEvent(new CustomEvent('proactive-message-sent', {
      detail: { charId: space.charId, charName, body: `完成了「${task.name}」` }
    }));
    onUpdate();
    addToast(`已模拟：${charName} 主动打卡「${task.name}」`, 'success');
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

      {/* 暮色 2026-08-01：测试 ta 主动打卡（真路径要等 30% 概率 / 6 小时间隔 / 一天 3 条，测一下绕过） */}
      <div className="bg-white/40 rounded-2xl p-3 border border-rose-100/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-rose-300 min-w-0">
          <Sparkle size={12} weight="fill" />
          <div className="text-[10px] truncate">ta 主动打卡由 runProactive 触发，测一下立即跑</div>
        </div>
        <button
          onClick={handleTestAiCheckin}
          className="px-2.5 py-1 bg-white text-slate-500 text-[10px] font-medium rounded-full border border-slate-200 active:scale-95 transition-transform shrink-0"
        >
          测一下
        </button>
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
// 通用确认弹窗（暮色 2026-08-01：情侣空间统一用）
// ──────────────────────────────────────────

const ConfirmModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmStyle?: 'primary' | 'danger';
}> = ({ isOpen, onClose, onConfirm, title, message, confirmText = '确定', confirmStyle = 'primary' }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
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
            className={`flex-1 py-2.5 text-white font-bold rounded-full active:scale-95 transition-transform ${
              confirmStyle === 'danger' ? 'bg-rose-500' : 'bg-rose-400'
            }`}
          >
            {confirmText}
          </button>
        </div>
      }
    >
      <div className="text-sm text-slate-600 leading-relaxed text-center py-2">
        {message}
      </div>
    </Modal>
  );
};

// ──────────────────────────────────────────
// 时间线 Tab
// ──────────────────────────────────────────

const MOOD_OPTIONS: { value: NonNullable<CoupleTimelineItem['mood']>; emoji: string; label: string }[] = [
  { value: 'happy', emoji: '😊', label: '开心' },
  { value: 'sweet', emoji: '🍯', label: '甜蜜' },
  { value: 'miss', emoji: '🥺', label: '想念' },
  { value: 'sad', emoji: '😢', label: '难过' },
  { value: 'angry', emoji: '😠', label: '生气' },
  { value: 'neutral', emoji: '😐', label: '一般' },
];

const moodEmoji = (m: CoupleTimelineItem['mood']): string => {
  return MOOD_OPTIONS.find(o => o.value === m)?.emoji || '📌';
};

const sourceLabel = (s: CoupleTimelineItem['source'], charName: string): string => {
  if (s === 'user-manual') return '我加';
  if (s === 'char-manual') return charName;
  return 'AI 抽取';
};

const sourceBadgeClass = (s: CoupleTimelineItem['source']): string => {
  if (s === 'user-manual') return 'bg-rose-100 text-rose-500';
  if (s === 'char-manual') return 'bg-pink-100 text-pink-500';
  return 'bg-slate-100 text-slate-500';
};

const TimelineTab: React.FC<{
  space: CoupleSpace;
  char: CharacterProfile | null;
  onUpdate: () => void;
}> = ({ space, char, onUpdate }) => {
  const { addToast } = useOS();
  const charName = char?.name || 'TA';
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = editingId ? space.timeline.find(t => t.id === editingId) || null : null;

  const handleAdd = (data: {
    title: string;
    content: string;
    date: string;
    mood?: CoupleTimelineItem['mood'];
    source: 'user-manual' | 'char-manual';
  }) => {
    const result = addTimelineItem('default', space.charId, data);
    if (result) {
      onUpdate();
      addToast('已添加时间线记录', 'success');
      setShowAddModal(false);
    } else {
      addToast('添加失败', 'error');
    }
  };

  const handleSaveEdit = (data: {
    title: string;
    content: string;
    date: string;
    mood?: CoupleTimelineItem['mood'];
    source: 'user-manual' | 'char-manual';
  }) => {
    if (!editingId) return;
    const result = updateTimelineItem('default', space.charId, editingId, data);
    if (result) {
      onUpdate();
      addToast('已更新', 'success');
      setEditingId(null);
    } else {
      addToast('更新失败', 'error');
    }
  };

  const handleDelete = () => {
    if (!deleteId) return;
    const result = deleteTimelineItem('default', space.charId, deleteId);
    if (result) {
      onUpdate();
      addToast('已删除', 'success');
      setDeleteId(null);
    } else {
      addToast('删除失败', 'error');
    }
  };

  // 暮色 2026-08-01：测试 AI 抽时间线（mock 一条，模拟 LLM 抽取效果）
  //   真实 LLM 抽取要做 pipeline（聊记忆宫殿），目前没接通
  //   这个按钮让暮色能立即看到 "source: ai-extract" 标签 + mood 渲染对不对
  const handleTestAiExtract = () => {
    const sampleTitles = [
      '第一次牵手', '深夜聊到天亮', '一起看日落', '下雨天的拥抱',
      '生日惊喜', '吵架后和好', '吃到很好吃的东西', '一起做的梦',
    ];
    const sampleContents = [
      '那天在老街逛着逛着，你突然拉了我的手。心脏快跳出来。',
      '聊到凌晨 4 点，外面天都亮了也不困。',
      '太阳从海面滑下去，你靠在我肩上。',
      '下着雨我们躲在便利店屋檐下，你把外套披给我。',
      '你准备的惊喜让我哭了半小时。',
      '吵得很凶，但最后还是舍不得。',
      '那家小店的馄饨，我们现在还常去。',
      '梦到我们一起去了一个没名字的小岛。',
    ];
    const moods: NonNullable<CoupleTimelineItem['mood']>[] = ['happy', 'sweet', 'miss', 'neutral'];
    const i = Math.floor(Math.random() * sampleTitles.length);
    const result = addTimelineItem('default', space.charId, {
      title: sampleTitles[i],
      content: sampleContents[i],
      date: todayStr(),
      mood: moods[Math.floor(Math.random() * moods.length)],
      source: 'ai-extract',
      sourceRef: 'mock-test',
    });
    if (result) {
      onUpdate();
      addToast('已模拟 AI 抽取一条时间线', 'success');
    } else {
      addToast('测试失败', 'error');
    }
  };

  return (
    <div className="space-y-3">
      {/* 顶部：统计 + 添加按钮 + 测试按钮 */}
      <div className="flex items-center justify-between px-1">
        <div className="text-xs text-slate-500 font-medium">
          共 {space.timeline.length} 条记录
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleTestAiExtract}
            className="px-2.5 py-1.5 bg-white text-slate-500 text-[10px] font-medium rounded-full border border-slate-200 active:scale-95 transition-transform"
          >
            测一下 AI 抽
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 bg-rose-400 text-white text-xs font-medium rounded-full active:scale-95 transition-transform flex items-center gap-1"
          >
            <Plus size={12} weight="bold" />
            添加
          </button>
        </div>
      </div>

      {/* 空状态 */}
      {space.timeline.length === 0 && (
        <div className="bg-white/60 rounded-2xl p-6 text-center">
          <div className="text-rose-300 text-xs mb-2">时间线</div>
          <div className="text-slate-400 text-sm">还没有记录，点上方"添加"记下重要时刻吧</div>
        </div>
      )}

      {/* 列表 */}
      <div className="space-y-2">
        {space.timeline.map(item => (
          <TimelineItemCard
            key={item.id}
            item={item}
            charName={charName}
            onEdit={() => setEditingId(item.id)}
            onDelete={() => setDeleteId(item.id)}
          />
        ))}
      </div>

      {/* 添加模态框 */}
      <AddTimelineItemModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAdd}
        title="添加时间线记录"
      />

      {/* 编辑模态框 */}
      {editing && (
        <AddTimelineItemModal
          isOpen={true}
          onClose={() => setEditingId(null)}
          onSubmit={handleSaveEdit}
          initial={{
            title: editing.title,
            content: editing.content,
            date: editing.date,
            mood: editing.mood,
            source: (editing.source === 'ai-extract' ? 'user-manual' : editing.source) as 'user-manual' | 'char-manual',
          }}
          title="编辑时间线"
        />
      )}

      {/* 删除确认 */}
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="删除这条记录？"
        message="删除后无法恢复"
        confirmText="删除"
        confirmStyle="danger"
      />
    </div>
  );
};

// 单条时间线卡片
const TimelineItemCard: React.FC<{
  item: CoupleTimelineItem;
  charName: string;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ item, charName, onEdit, onDelete }) => {
  return (
    <div className="bg-white rounded-2xl p-3 border border-rose-100/60">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-100 to-pink-100 flex items-center justify-center text-lg shrink-0">
          {moodEmoji(item.mood)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium text-slate-800 truncate">
              {item.title}
            </div>
            <div className="text-[10px] text-slate-400 shrink-0">
              {item.date.slice(5)}
            </div>
          </div>
          {item.content && (
            <div className="text-xs text-slate-500 mt-1 leading-relaxed line-clamp-3 break-words">
              {item.content}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${sourceBadgeClass(item.source)}`}>
              {sourceLabel(item.source, charName)}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 active:scale-95 transition-all"
            aria-label="编辑"
          >
            <PencilSimple size={12} weight="bold" />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 active:scale-95 transition-all"
            aria-label="删除"
          >
            <Trash size={12} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
};

// 时间线添加/编辑模态框
const AddTimelineItemModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    content: string;
    date: string;
    mood?: CoupleTimelineItem['mood'];
    source: 'user-manual' | 'char-manual';
  }) => void;
  initial?: {
    title: string;
    content: string;
    date: string;
    mood?: CoupleTimelineItem['mood'];
    source: 'user-manual' | 'char-manual';
  };
  title?: string;
}> = ({ isOpen, onClose, onSubmit, initial, title }) => {
  const [text, setText] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [date, setDate] = useState(initial?.date || todayStr());
  const [mood, setMood] = useState<CoupleTimelineItem['mood']>(initial?.mood);
  const [source, setSource] = useState<'user-manual' | 'char-manual'>(
    initial?.source || 'user-manual'
  );

  // 弹窗打开时初始化
  useEffect(() => {
    if (isOpen) {
      setText(initial?.title || '');
      setContent(initial?.content || '');
      setDate(initial?.date || todayStr());
      setMood(initial?.mood);
      setSource(initial?.source || 'user-manual');
    }
  }, [isOpen, initial]);

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit({
      title: text.trim(),
      content: content.trim(),
      date,
      mood,
      source,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || '添加时间线记录'}
      footer={
        <div className="flex gap-2 w-full">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 text-slate-500 font-bold rounded-full active:scale-95 transition-transform"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="flex-1 py-2.5 bg-rose-400 text-white font-bold rounded-full active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            保存
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 标题 */}
        <div>
          <div className="text-xs text-slate-500 mb-1.5 font-medium">标题</div>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="比如：第一次牵手"
            className="w-full px-3 py-2.5 bg-slate-50 rounded-2xl text-sm text-slate-800 border border-slate-200 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
        </div>

        {/* 内容 */}
        <div>
          <div className="text-xs text-slate-500 mb-1.5 font-medium">详情（可选）</div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="记录一下这一刻..."
            rows={3}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-2xl text-sm text-slate-800 border border-slate-200 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100 resize-none"
          />
        </div>

        {/* 日期 */}
        <div>
          <div className="text-xs text-slate-500 mb-1.5 font-medium">日期</div>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            max={todayStr()}
            className="w-full px-3 py-2.5 bg-slate-50 rounded-2xl text-sm text-slate-800 border border-slate-200 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
        </div>

        {/* 心情 */}
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">心情（可选）</div>
          <div className="flex flex-wrap gap-1.5">
            {MOOD_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMood(mood === opt.value ? undefined : opt.value)}
                className={`px-2.5 py-1.5 rounded-full text-xs flex items-center gap-1 transition-all ${
                  mood === opt.value
                    ? 'bg-rose-400 text-white'
                    : 'bg-slate-50 text-slate-600 active:scale-95'
                }`}
              >
                <span>{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 谁加的 */}
        <div>
          <div className="text-xs text-slate-500 mb-2 font-medium">谁加的</div>
          <div className="flex gap-2">
            <button
              onClick={() => setSource('user-manual')}
              className={`flex-1 py-2 rounded-full text-xs font-medium transition-all ${
                source === 'user-manual'
                  ? 'bg-rose-400 text-white'
                  : 'bg-slate-50 text-slate-600 active:scale-95'
              }`}
            >
              我
            </button>
            <button
              onClick={() => setSource('char-manual')}
              className={`flex-1 py-2 rounded-full text-xs font-medium transition-all ${
                source === 'char-manual'
                  ? 'bg-rose-400 text-white'
                  : 'bg-slate-50 text-slate-600 active:scale-95'
              }`}
            >
              模拟 ta
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ──────────────────────────────────────────
// 悄悄话 Tab
// ──────────────────────────────────────────

const WhisperTab: React.FC<{
  space: CoupleSpace;
  char: CharacterProfile | null;
  onUpdate: () => void;
}> = ({ space, char, onUpdate }) => {
  const { addToast } = useOS();
  const charName = char?.name || 'TA';
  const [text, setText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef(space.whisperUnread);

  // 进入 tab 自动标记已读
  useEffect(() => {
    if (space.whisperUnread > 0) {
      markWhispersRead('default', space.charId);
      // 短暂延迟后 reload（避免 mark 完但 onUpdate 没生效就滚）
      const t = setTimeout(() => onUpdate(), 50);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.charId]);

  // 新消息滚到底
  useEffect(() => {
    if (prevUnreadRef.current !== space.whisperUnread || space.whispers.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    prevUnreadRef.current = space.whisperUnread;
  }, [space.whispers.length, space.whisperUnread]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    const result = addWhisper('default', space.charId, {
      from: 'user',
      content: trimmed,
    });
    setSubmitting(false);
    if (result) {
      setText('');
      onUpdate();
    } else {
      addToast('发送失败', 'error');
    }
  };

  const handleDelete = () => {
    if (!deletingId) return;
    const result = deleteWhisper('default', space.charId, deletingId);
    if (result) {
      onUpdate();
      addToast('已删除', 'success');
      setDeletingId(null);
    } else {
      addToast('删除失败', 'error');
    }
  };

  // 暮色 2026-08-01：测试 ta 留悄悄话（绕过 proactive 通道 + LLM，mock 一条）
  //   真实"角色主动留"要走 proactive 通道（runProactive）分支，这波没接通
  //   这个按钮让暮色能立即看到 ta 的悄悄话气泡 + 未读样式
  const handleTestCharWhisper = () => {
    const samples = [
      '想你啦，今天有什么想跟我说的吗？',
      '刚才突然梦到我们一起去了海边。',
      '今晚想跟你聊聊天，但我先忙一会儿。',
      '看到个东西想到你，等会儿发给你。',
      '你今天有没有好好吃饭呀？',
      '刚刚听到一首好听的歌，想你也在听。',
    ];
    const content = samples[Math.floor(Math.random() * samples.length)];
    const result = addWhisper('default', space.charId, {
      from: 'char',
      content,
    });
    if (result) {
      onUpdate();
      addToast(`已模拟：${charName} 留了悄悄话`, 'success');
    } else {
      addToast('测试失败', 'error');
    }
  };

  // 倒序：最新在上（情侣空间消息流习惯）
  const list = useMemo(() => [...space.whispers].reverse(), [space.whispers]);

  return (
    <div className="flex flex-col h-full min-h-[400px]">
      {/* 顶部统计 + 测试按钮 */}
      <div className="flex items-center justify-between px-1 mb-2 gap-2">
        <div className="text-xs text-slate-500 font-medium">
          共 {space.whispers.length} 条悄悄话
        </div>
        <div className="flex items-center gap-2">
          {space.whisperUnread > 0 && (
            <div className="text-[10px] text-rose-500 font-medium">
              {space.whisperUnread} 条未读
            </div>
          )}
          <button
            onClick={handleTestCharWhisper}
            className="px-2.5 py-1 bg-white text-slate-500 text-[10px] font-medium rounded-full border border-slate-200 active:scale-95 transition-transform"
          >
            测一下
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto no-scrollbar space-y-3 pb-2">
        {list.length === 0 ? (
          <div className="bg-white/60 rounded-2xl p-6 text-center">
            <div className="text-rose-300 text-xs mb-2">悄悄话</div>
            <div className="text-slate-400 text-sm">在下面写第一句悄悄话给 ta 吧</div>
          </div>
        ) : (
          list.map(w => (
            <WhisperItem
              key={w.id}
              whisper={w}
              charName={charName}
              charAvatar={char?.avatar}
              onDelete={() => setDeletingId(w.id)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 底部输入区 */}
      <div className="shrink-0 pt-2 border-t border-rose-100/60">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`跟 ${charName} 说悄悄话…`}
            rows={1}
            className="flex-1 px-3 py-2 bg-white rounded-2xl text-sm text-slate-800 border border-rose-100/60 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100 resize-none max-h-24"
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || submitting}
            className="w-10 h-10 flex items-center justify-center bg-rose-400 text-white rounded-full active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            aria-label="发送"
          >
            <PaperPlaneTilt size={16} weight="fill" />
          </button>
        </div>
        <div className="text-[9px] text-slate-400 mt-1 px-1">
          Enter 发送 · Shift+Enter 换行
        </div>
      </div>

      {/* 删除确认 */}
      <ConfirmModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={handleDelete}
        title="删除这条悄悄话？"
        message="删除后无法恢复"
        confirmText="删除"
        confirmStyle="danger"
      />
    </div>
  );
};

// 单条悄悄话
const WhisperItem: React.FC<{
  whisper: CoupleWhisper;
  charName: string;
  charAvatar?: string;
  onDelete: () => void;
}> = ({ whisper, charName, charAvatar, onDelete }) => {
  const isUser = whisper.from === 'user';
  const isUnread = !isUser && !whisper.isRead;

  const time = useMemo(() => {
    const d = new Date(whisper.createdAt);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }, [whisper.createdAt]);

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* 头像 */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-200 to-pink-200 flex items-center justify-center overflow-hidden shrink-0">
        {isUser ? (
          <span className="text-rose-500 text-[10px] font-bold">我</span>
        ) : charAvatar ? (
          <img src={charAvatar} alt={charName} className="w-full h-full object-cover" />
        ) : (
          <HeartIcon size={12} weight="fill" className="text-rose-400" />
        )}
      </div>

      {/* 气泡 + 时间 */}
      <div className={`flex flex-col max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-1.5 mb-0.5 px-1">
          <span className="text-[10px] text-slate-500 font-medium">
            {isUser ? '我' : charName}
          </span>
          {isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          )}
        </div>
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed break-words ${
            isUser
              ? 'bg-rose-400 text-white rounded-tr-md'
              : isUnread
                ? 'bg-white border-2 border-rose-200 text-slate-800 rounded-tl-md'
                : 'bg-white border border-rose-100/60 text-slate-800 rounded-tl-md'
          }`}
          onDoubleClick={onDelete}
        >
          {whisper.content}
        </div>
        <div className="flex items-center gap-2 mt-0.5 px-1">
          <span className="text-[9px] text-slate-400">{time}</span>
          <button
            onClick={onDelete}
            className="text-[9px] text-slate-300 hover:text-rose-500 active:scale-95 transition-all"
            aria-label="删除"
          >
            删除
          </button>
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
