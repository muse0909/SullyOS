/**
 * 剧情剧院 StoryTheater — 暮色 8-25 第二步
 *
 * 本步只实现:
 *   1. 顶栏(返回 + 衬线标题 + 齿轮占位)
 *   2. 区块 1:预设区(customPresets 为空时显示"暂未配置预设"占位)
 *   3. 区块 2:我的剧场 — Entry 列表 / 空态 / 新建 modal / 删除 / 进入占位
 *
 * 不实现(后面步骤):
 *   - 6 个子组件(Editor / Session / MaskBox / PresetMaker / QuickPresetPanel / Theme)
 *   - AI 生成(LLM 调用 / 上下文拼装 / 摘要触发)
 *   - 向量记忆面板(暮色不要,会写回主记忆宫殿)
 *   - 退出同步到主聊天上下文
 *   - 面具 / 多人选演员(暮色只要单人,暮色 = 暮色)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, GearSix, Plus, Trash, Sparkle, BookOpen } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { DB } from '../../../utils/db';
import { createStoryTheaterDraft, normalizeStoryTheater } from '../../../utils/storyTheater';
import Modal from '../../os/Modal';
import type { StoryTheaterEntry } from '../../../types';
import { SELECT_THEME, CARD_TINTS } from './storyTheme';

interface Props {
    onSwitchCompanion: () => void;  // 点"陪伴" tab 切回去
    onClose: () => void;             // 退出见面 app
}

const StoryTheater: React.FC<Props> = ({ onSwitchCompanion, onClose }) => {
    const { characters, activeCharacterId } = useOS();
    const [entries, setEntries] = useState<StoryTheaterEntry[]>([]);
    const [showNewModal, setShowNewModal] = useState(false);
    const [activeEntry, setActiveEntry] = useState<StoryTheaterEntry | null>(null);
    const [deletingEntry, setDeletingEntry] = useState<StoryTheaterEntry | null>(null);

    // 加载 Entry 列表
    const reload = useCallback(async () => {
        const stored = await DB.getStoryTheaters();
        setEntries(stored.map(normalizeStoryTheater).sort((a, b) => b.updatedAt - a.updatedAt));
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    // 保存新建的 Entry
    const handleCreate = useCallback(async (title: string, premise: string) => {
        if (!activeCharacterId) return;
        const now = Date.now();
        const entry = createStoryTheaterDraft(activeCharacterId, title.trim() || '新剧场', premise.trim(), now);
        await DB.saveStoryTheater(entry);
        setShowNewModal(false);
        await reload();
    }, [activeCharacterId, reload]);

    // 删除 Entry
    const handleDelete = useCallback(async (entry: StoryTheaterEntry) => {
        await DB.deleteStoryTheater(entry.id);
        setDeletingEntry(null);
        if (activeEntry?.id === entry.id) setActiveEntry(null);
        await reload();
    }, [activeEntry, reload]);

    // 当前选中角色
    const activeChar = activeCharacterId ? characters.find(c => c.id === activeCharacterId) : null;

    return (
        <div className="h-full w-full relative overflow-hidden flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            {/* 柔星点氛围 */}
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 + 衬线标题 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={onClose} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[26px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>剧情剧院</h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${SELECT_THEME.line})` }} />
                            <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ STORY THEATER ✦</span>
                            <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${SELECT_THEME.line})` }} />
                        </div>
                    </div>
                    {/* 右侧齿轮占位(第三步再做设置) */}
                    <button className="absolute right-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all opacity-50 cursor-not-allowed"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)' }} title="设置(开发中)" disabled>
                        <GearSix size={16} weight="bold" />
                    </button>
                </div>
            </div>

            {/* 主体滚动区 */}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 pt-4 pb-6">
                {/* 区块 1:预设区(占位) */}
                <SectionHeader title="预设" subtitle="PRESET" />
                <div className="rounded-2xl px-4 py-5 mb-5 flex items-center gap-3"
                     style={{ background: 'rgba(255,255,255,0.55)', border: '1px dashed rgba(170,140,210,0.35)' }}>
                    <Sparkle size={20} weight="light" style={{ color: '#a78bfa', flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold" style={{ color: '#715d99' }}>暂未配置预设</div>
                        <div className="text-[10px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>第三步做 session 时再设计 — 可选温度/系统消息/采样参数</div>
                    </div>
                </div>

                {/* 区块 2:我的剧场 */}
                <div className="flex items-center justify-between mb-3">
                    <SectionHeader title="我的剧场" subtitle="MY THEATER" inline />
                    <button onClick={() => {
                        if (!activeCharacterId) {
                            // 兜底:当前没选角色,提示先去聊天页选
                            alert('请先在聊天页选一个角色,再开剧场');
                            return;
                        }
                        setShowNewModal(true);
                    }} className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}
                            title={activeCharacterId ? '新建剧场' : '请先在聊天页选一个角色'}>
                        <Plus size={16} weight="bold" />
                    </button>
                </div>

                {entries.length === 0 ? (
                    // 空态
                    <div onClick={() => {
                        if (!activeCharacterId) {
                            alert('请先在聊天页选一个角色,再开剧场');
                            return;
                        }
                        setShowNewModal(true);
                    }}
                         className="rounded-2xl py-12 flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-transform"
                         style={{ background: 'rgba(255,255,255,0.45)', border: '1.5px dashed rgba(170,140,210,0.4)' }}>
                        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-3"
                             style={{ background: 'rgba(167,139,250,0.15)', border: '1.5px solid rgba(167,139,250,0.4)' }}>
                            <Plus size={28} weight="light" style={{ color: '#7c3aed' }} />
                        </div>
                        <div className="text-[13px] font-bold mb-1" style={{ color: '#715d99' }}>还没有剧场</div>
                        <div className="text-[10px]" style={{ color: 'rgba(150,120,190,0.7)' }}>点此处开新剧场</div>
                    </div>
                ) : (
                    // 列表
                    <div className="grid grid-cols-1 gap-3">
                        {entries.map((entry, idx) => {
                            const char = characters.find(c => c.id === entry.characterId);
                            const tint = CARD_TINTS[idx % CARD_TINTS.length];
                            return (
                                <div key={entry.id}
                                     onClick={() => setActiveEntry(entry)}
                                     className="group relative rounded-2xl px-3 pt-4 pb-4 active:scale-[0.98] transition-all cursor-pointer overflow-hidden"
                                     style={{ background: tint, border: `1px solid ${SELECT_THEME.cardBorder}`, boxShadow: SELECT_THEME.cardShadow }}>
                                    {/* 内描框 + 四角宝石 */}
                                    <div className="absolute inset-[6px] rounded-xl pointer-events-none" style={{ border: `1px solid ${SELECT_THEME.inner}` }} />
                                    <span className="absolute top-[8px] left-[8px] w-1.5 h-1.5 rotate-45" style={{ background: SELECT_THEME.gem }} />
                                    <span className="absolute top-[8px] right-[8px] w-1.5 h-1.5 rotate-45" style={{ background: SELECT_THEME.gem }} />
                                    <span className="absolute bottom-[8px] left-[8px] w-1.5 h-1.5 rotate-45" style={{ background: SELECT_THEME.gem }} />
                                    <span className="absolute bottom-[8px] right-[8px] w-1.5 h-1.5 rotate-45" style={{ background: SELECT_THEME.gem }} />

                                    {/* 角色头像 + 名字 */}
                                    <div className="flex items-center gap-3 mb-2">
                                        {char ? (
                                            <img src={char.avatar} className="w-10 h-10 rounded-full object-cover" style={{ boxShadow: '0 2px 8px rgba(150,120,200,0.3)' }} />
                                        ) : (
                                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: 'rgba(150,120,190,0.2)', color: '#715d99' }}>?</div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[14px] font-bold truncate" style={{ color: '#4a3a6a' }}>{entry.title}</div>
                                            <div className="text-[10px]" style={{ color: 'rgba(150,120,190,0.7)' }}>与 {char?.name || '未知角色'} · {new Date(entry.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                                        </div>
                                        {/* 删除按钮 */}
                                        <button onClick={(e) => { e.stopPropagation(); setDeletingEntry(entry); }}
                                                className="w-8 h-8 rounded-lg text-red-500 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
                                                style={{ background: 'rgba(255,255,255,0.88)' }} title="删除">
                                            <Trash size={14} weight="fill" />
                                        </button>
                                    </div>
                                    {/* 前提预览 */}
                                    {entry.premise && (
                                        <div className="text-[11px] leading-relaxed line-clamp-2" style={{ color: 'rgba(74,58,106,0.75)' }}>
                                            {entry.premise}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 新建 modal */}
            <NewTheaterModal
                open={showNewModal}
                characterName={activeChar?.name || '当前角色'}
                characterAvatar={activeChar?.avatar}
                onClose={() => setShowNewModal(false)}
                onConfirm={handleCreate}
            />

            {/* 删除确认 modal */}
            <Modal isOpen={!!deletingEntry} title="删除剧场" onClose={() => setDeletingEntry(null)} footer={
                <div className="flex gap-3 w-full">
                    <button onClick={() => setDeletingEntry(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">取消</button>
                    <button onClick={() => deletingEntry && handleDelete(deletingEntry)} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold shadow-lg shadow-red-200">删除</button>
                </div>
            }>
                <div className="text-center text-slate-600 text-sm py-4">
                    确定删除「{deletingEntry?.title}」吗?<br/>
                    <span className="text-xs text-slate-400 mt-2 block">剧场内消息也会一并清除(第三步实现)</span>
                </div>
            </Modal>

            {/* 进入 entry 占位(第三步实现 session) */}
            {activeEntry && (
                <div className="absolute inset-0 z-50 flex flex-col" style={{ background: SELECT_THEME.pageBg }}>
                    <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />
                    <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                        <div className="relative flex items-center justify-center px-5 pt-2">
                            <button onClick={() => setActiveEntry(null)} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                                    style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)' }}>
                                <ArrowLeft size={18} weight="bold" />
                            </button>
                            <div className="text-center">
                                <h1 className="text-[22px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title }}>{activeEntry.title}</h1>
                                <div className="text-[10px] mt-1" style={{ color: 'rgba(150,120,190,0.7)' }}>与 {characters.find(c => c.id === activeEntry.characterId)?.name || '未知角色'}</div>
                            </div>
                        </div>
                    </div>
                    <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-8 text-center">
                        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
                             style={{ background: 'rgba(255,255,255,0.6)', border: '1.5px solid rgba(170,140,210,0.35)' }}>
                            <BookOpen size={42} weight="light" style={{ color: '#a78bfa' }} />
                        </div>
                        <h2 className="text-[18px] font-bold tracking-[0.1em] mb-2" style={{ color: SELECT_THEME.title, fontFamily: `'Noto Serif SC',serif` }}>会话功能开发中</h2>
                        <p className="text-xs" style={{ color: 'rgba(150,120,190,0.7)' }}>第三步实现 — RP 对话 + AI 回复 + 上下文管理</p>
                        {activeEntry.premise && (
                            <div className="mt-6 p-4 rounded-2xl max-w-md text-left" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(170,140,210,0.3)' }}>
                                <div className="text-[10px] font-bold mb-1" style={{ color: '#715d99' }}>前提</div>
                                <div className="text-[12px] leading-relaxed" style={{ color: '#4a3a6a' }}>{activeEntry.premise}</div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

/* ── 区块标题(本文件内联,避免再开 theme 文件重复 CSS) ── */
const SectionHeader: React.FC<{ title: string; subtitle: string; inline?: boolean }> = ({ title, subtitle, inline }) => (
    <div className={inline ? '' : 'mb-3'}>
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(150,120,190,0.75)' }}>{subtitle}</span>
            <span className="h-px flex-1 max-w-[3rem]" style={{ background: 'linear-gradient(90deg,rgba(150,120,190,0.5),transparent)' }} />
        </div>
        <div className="text-[15px] font-bold tracking-wider mt-1" style={{ color: '#4a3a6a' }}>{title}</div>
    </div>
);

/* ── 新建剧场 modal ── */
const NewTheaterModal: React.FC<{
    open: boolean;
    characterName: string;
    characterAvatar?: string;
    onClose: () => void;
    onConfirm: (title: string, premise: string) => void;
}> = ({ open, characterName, characterAvatar, onClose, onConfirm }) => {
    const [title, setTitle] = useState('');
    const [premise, setPremise] = useState('');

    // modal 打开时重置
    useEffect(() => {
        if (open) { setTitle(''); setPremise(''); }
    }, [open]);

    if (!open) return null;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
            <div className="w-full max-w-sm flex flex-col" onClick={(e) => e.stopPropagation()}
                 style={{ background: 'linear-gradient(160deg,#ffffff 0%,#f7f2fb 100%)', borderRadius: 24, border: '1px solid rgba(170,140,210,0.3)', boxShadow: '0 20px 50px -20px rgba(150,120,200,0.4)' }}>
                {/* 顶渐变线 */}
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg,transparent,#a78bfa,#7c3aed,transparent)' }} />
                <div className="px-6 pt-6 pb-2 text-center">
                    <div className="text-[10px] tracking-[0.3em] uppercase font-bold" style={{ color: '#7c3aed' }}>NEW THEATER</div>
                    <h3 className="text-[18px] font-bold mt-1" style={{ color: '#4a3a6a' }}>开新剧场</h3>
                </div>
                <div className="px-6 py-4 space-y-4">
                    {/* 角色(自动填) */}
                    <div>
                        <label className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>角色</label>
                        <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)' }}>
                            {characterAvatar && <img src={characterAvatar} className="w-7 h-7 rounded-full object-cover" />}
                            <span className="text-[13px] font-bold" style={{ color: '#4a3a6a' }}>{characterName}</span>
                            <span className="ml-auto text-[9px]" style={{ color: 'rgba(150,120,190,0.7)' }}>当前对话角色</span>
                        </div>
                    </div>
                    {/* 标题 */}
                    <div>
                        <label className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>标题</label>
                        <input
                            type="text"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                            placeholder="给剧场起个名字(可留空)"
                            className="w-full mt-1.5 px-3 py-2 rounded-xl text-[13px] focus:outline-none"
                            style={{ background: 'white', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                        />
                    </div>
                    {/* 前提 */}
                    <div>
                        <label className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>前提 / 世界观</label>
                        <textarea
                            value={premise}
                            onChange={e => setPremise(e.target.value)}
                            placeholder="背景设定、剧情起点、你想怎么开始…(可留空,稍后再写)"
                            className="w-full mt-1.5 px-3 py-2 rounded-xl text-[13px] resize-none focus:outline-none"
                            style={{ background: 'white', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937', minHeight: 100 }}
                            onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                        />
                    </div>
                </div>
                <div className="px-6 pb-6 pt-2 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold"
                            style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>取消</button>
                    <button onClick={() => onConfirm(title, premise)} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold"
                            style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>开剧场</button>
                </div>
            </div>
        </div>
    );
};

export default StoryTheater;
