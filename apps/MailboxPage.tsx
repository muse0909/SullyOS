// MailboxPage — 信箱（双向信件，2026-08-25）
// 暮色 8-25 信箱方案：
//   - 双向：暮色写信给角色 + 角色写信给暮色
//   - 4 种信封：classic(信件) / love(情书) / handwrite(手札) / wax(贺卡)
//   - 暮色写信可选"立即发送"或"定时发送"
//   - 暮色在发现页"信箱"入口（跟小纸条、日记并列）
//   - 无字数限制
// UI 风格：iOS 邮件留白 + Linear 卡片布局 + 现有 app 配色体系
//   - 白底、大圆角、充足留白
//   - 不用拟物化翻开动画 / 花体字 / 厚重阴影

import React, { useEffect, useMemo, useState } from 'react';
import { CaretLeft, Envelope, Heart, PencilSimple, Trash, Clock, PaperPlaneTilt, Check } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
    MailboxLetter, MailboxEnvelope, MailboxStatus,
    getReceivedByUser, getSentByUser, createLetter, markRead, markUserSeen, deleteLetter,
} from '../utils/mailboxStorage';

// 暮色 8-25：iOS 邮件留白 + Linear 卡片布局
// 4 种信封对应 4 种浅色系（不抢眼，识别度靠左侧色块）
const ENVELOPE_STYLE: Record<MailboxEnvelope, { name: string; bg: string; ring: string; accent: string; thin: string; desc: string }> = {
    classic:    { name: '信件', bg: 'bg-sky-50',     ring: 'ring-sky-400',    accent: 'text-sky-600',    thin: 'from-sky-200 via-sky-300 to-sky-200',     desc: '米色信纸' },
    love:       { name: '情书', bg: 'bg-rose-50',    ring: 'ring-rose-400',   accent: 'text-rose-600',   thin: 'from-rose-200 via-rose-300 to-rose-200', desc: '粉色 + 爱心' },
    handwrite:  { name: '手札', bg: 'bg-amber-50',   ring: 'ring-amber-500',  accent: 'text-amber-700',  thin: 'from-amber-200 via-amber-300 to-amber-200', desc: '牛皮纸' },
    wax:        { name: '贺卡', bg: 'bg-yellow-50',  ring: 'ring-yellow-500', accent: 'text-yellow-700', thin: 'from-yellow-200 via-yellow-300 to-yellow-200', desc: '金色蜡封' },
};

type TabKey = 'inbox' | 'sent' | 'compose';
type ViewKey = 'list' | 'detail' | 'compose';

const MailboxPage: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { characters, activeCharacterId, addToast, userProfile } = useOS();
    const [view, setView] = useState<ViewKey>('list');
    const [tab, setTab] = useState<TabKey>('inbox');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [filterCharId, setFilterCharId] = useState<string>('all');

    // 暮色只跟当前激活角色通信，默认收件人 = activeCharacterId
    const targetCharId = filterCharId === 'all' ? (activeCharacterId || characters[0]?.id || '') : filterCharId;

    const [allLetters, setAllLetters] = useState<MailboxLetter[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        if (!targetCharId) {
            setAllLetters([]);
            return;
        }
        setLoading(true);
        try {
            const [received, sent] = await Promise.all([
                getReceivedByUser(targetCharId),
                getSentByUser(targetCharId),
            ]);
            // 合并：暮色收到的 + 暮色寄出的，按时间倒序
            setAllLetters([...received, ...sent].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)));
        } catch (e) {
            console.warn('📬 [MailboxPage] 加载失败:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, [targetCharId]);

    // ── 收件箱 / 已发送 tab 切换时回到列表 ──
    const handleTab = (t: TabKey) => {
        setTab(t);
        if (t === 'compose') {
            setView('compose');
        } else {
            setView('list');
            setSelectedId(null);
        }
    };

    // ── 写信成功 → 回到收件箱 ──
    const handleSent = async () => {
        await refresh();
        setView('list');
        setTab('sent');
        setSelectedId(null);
    };

    // ── 渲染 ──
    return (
        <div className="absolute inset-0 flex flex-col bg-slate-50">
            {view === 'list' && (
                <ListView
                    letters={allLetters}
                    tab={tab}
                    onTabChange={handleTab}
                    onOpenLetter={async (l) => {
                        setSelectedId(l.id);
                        if (l.toUser === 'user' && l.status === 'delivered') {
                            await markUserSeen(l.id);
                        }
                        setView('detail');
                    }}
                    onRefresh={refresh}
                    onDelete={async (l) => {
                        await deleteLetter(l.id);
                        addToast?.('已删除', 'info');
                        await refresh();
                    }}
                    charName={(id) => characters.find(c => c.id === id)?.name || '角色'}
                    onBack={onBack}
                    filterCharId={filterCharId}
                    onFilterCharChange={setFilterCharId}
                    characters={characters.map(c => ({ id: c.id, name: c.name }))}
                />
            )}
            {view === 'detail' && selectedId && (() => {
                const letter = allLetters.find(l => l.id === selectedId);
                if (!letter) {
                    setView('list');
                    return null;
                }
                return (
                    <DetailView
                        letter={letter}
                        onBack={() => setView('list')}
                        onReply={() => { setView('compose'); }}
                        onDelete={async () => {
                            await deleteLetter(letter.id);
                            addToast?.('已删除', 'info');
                            await refresh();
                            setView('list');
                        }}
                        charName={characters.find(c => c.id === letter.charId)?.name || '角色'}
                        userName={userProfile.name}
                    />
                );
            })()}
            {view === 'compose' && (
                <ComposeView
                    onBack={() => { setView('list'); setTab('inbox'); }}
                    onSent={handleSent}
                    charId={targetCharId}
                    charName={characters.find(c => c.id === targetCharId)?.name || '角色'}
                    userName={userProfile.name}
                    addToast={addToast}
                    replyTo={allLetters.find(l => l.id === selectedId) || null}
                />
            )}
        </div>
    );
};

// =================== 列表视图 ===================
const ListView: React.FC<{
    letters: MailboxLetter[];
    tab: TabKey;
    onTabChange: (t: TabKey) => void;
    onOpenLetter: (l: MailboxLetter) => void;
    onRefresh: () => void;
    onDelete: (l: MailboxLetter) => void;
    charName: (id: string) => string;
    onBack: () => void;
    filterCharId: string;
    onFilterCharChange: (id: string) => void;
    characters: { id: string; name: string }[];
}> = ({ letters, tab, onTabChange, onOpenLetter, onRefresh, onDelete, charName, onBack, filterCharId, onFilterCharChange, characters }) => {
    // 暮色 8-25 列表筛选
    const filtered = useMemo(() => {
        let list = letters;
        if (tab === 'inbox') list = list.filter(l => l.toUser === 'user');
        if (tab === 'sent') list = list.filter(l => l.fromUser === 'user');
        return list;
    }, [letters, tab]);

    // 暮色 8-25：定时发送显示"待发送（X月X日 HH:MM）"
    const formatDeliverAt = (ts: number) => {
        const d = new Date(ts);
        return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    return (
        <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/80 backdrop-blur shrink-0 border-b border-slate-100">
                <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform" aria-label="返回">
                    <CaretLeft size={20} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">信箱</h1>
                <div className="w-9 h-9" aria-hidden />
            </div>

            {/* Tab 切换：收件箱 / 已发送 / 写信 */}
            <div className="flex items-center gap-1 px-5 pt-4 pb-2 shrink-0">
                {(['inbox', 'sent', 'compose'] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => onTabChange(t)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            tab === t
                                ? 'bg-slate-800 text-white'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                    >
                        {t === 'inbox' ? '我收到的' : t === 'sent' ? '我寄出的' : '写新信'}
                    </button>
                ))}
            </div>

            {/* 角色筛选（多角色时显示） */}
            {characters.length > 1 && (
                <div className="px-5 pb-2 shrink-0">
                    <select
                        value={filterCharId}
                        onChange={(e) => onFilterCharChange(e.target.value)}
                        className="text-xs px-2 py-1 bg-white border border-slate-200 rounded-lg text-slate-600"
                    >
                        <option value="all">所有角色</option>
                        {characters.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* 列表 */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
                {filtered.length === 0 ? (
                    <EmptyState tab={tab} />
                ) : (
                    <div className="space-y-3">
                        {filtered.map(letter => (
                            <LetterCard
                                key={letter.id}
                                letter={letter}
                                onOpen={() => onOpenLetter(letter)}
                                onDelete={() => onDelete(letter)}
                                charName={charName(letter.charId)}
                                formatDeliverAt={formatDeliverAt}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// 暮色 8-25 UI 规范：白底大圆角卡片，左色块 / 中预览 / 右状态点
const LetterCard: React.FC<{
    letter: MailboxLetter;
    onOpen: () => void;
    onDelete: () => void;
    charName: string;
    formatDeliverAt: (ts: number) => string;
}> = ({ letter, onOpen, onDelete, charName, formatDeliverAt }) => {
    const env = ENVELOPE_STYLE[letter.envelope] || ENVELOPE_STYLE.classic;
    const isUnread = letter.toUser === 'user' && letter.status === 'delivered';
    const isPending = letter.status === 'pending';
    const firstLine = letter.content.split('\n')[0]?.slice(0, 40) || '';
    const date = new Date(letter.sentAt);
    const dateLabel = `${date.getMonth() + 1}/${date.getDate()}`;

    return (
        <div className="relative group">
            <button
                onClick={onOpen}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm hover:shadow-md active:scale-[0.99] transition-all"
            >
                <div className="flex items-start gap-3">
                    {/* 左侧：信封样式色块 */}
                    <div className={`shrink-0 w-10 h-10 rounded-xl ${env.bg} flex items-center justify-center`}>
                        <Envelope size={18} weight="regular" className={env.accent} />
                    </div>

                    {/* 中间：标题 + 预览 + 时间 */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <h3 className={`text-[15px] truncate ${isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'}`}>
                                {letter.title}
                            </h3>
                            <span className="text-[11px] text-slate-400 shrink-0">{dateLabel}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-slate-500">
                            <span className={env.accent + ' text-[11px] font-medium'}>{env.name}</span>
                            <span className="text-slate-300">·</span>
                            <span className="truncate">{letter.fromUser === 'user' ? '你写给' : `${charName} 写`}</span>
                            {isPending && (
                                <>
                                    <span className="text-slate-300">·</span>
                                    <span className="text-amber-600 inline-flex items-center gap-1">
                                        <Clock size={10} />待发送 {formatDeliverAt(letter.deliverAt!)}
                                    </span>
                                </>
                            )}
                        </div>
                        {firstLine && (
                            <p className="text-[12px] text-slate-500 mt-1.5 line-clamp-1 leading-relaxed">
                                {firstLine}…
                            </p>
                        )}
                    </div>

                    {/* 右侧：未读/已读小圆点 */}
                    <div className="shrink-0 pt-1.5">
                        {isUnread ? (
                            <span className="block w-2 h-2 rounded-full bg-rose-500" aria-label="未读" />
                        ) : (
                            <Check size={14} className="text-slate-300" weight="bold" />
                        )}
                    </div>
                </div>
            </button>
            {/* 删除按钮（小图标 hover 显示） */}
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-rose-500 transition-all"
                aria-label="删除"
            >
                <Trash size={14} />
            </button>
        </div>
    );
};

const EmptyState: React.FC<{ tab: TabKey }> = ({ tab }) => {
    const text = tab === 'inbox' ? '还没有收到信' : tab === 'sent' ? '还没有寄出过信' : '点上方"写新信"开始';
    return (
        <div className="flex flex-col items-center justify-center pt-20 text-center">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <Envelope size={24} className="text-slate-400" weight="regular" />
            </div>
            <p className="text-sm text-slate-400">{text}</p>
        </div>
    );
};

// =================== 详情视图 ===================
// 暮色 8-25 UI 规范：
//   - 顶部 1px 极细渐变边线（轻）
//   - 大留白、行高 1.6-1.8、字号 15-16px
//   - 底部"回信"按钮
//   - 不用花体字 / 厚重阴影
const DetailView: React.FC<{
    letter: MailboxLetter;
    onBack: () => void;
    onReply: () => void;
    onDelete: () => void;
    charName: string;
    userName: string;
}> = ({ letter, onBack, onReply, onDelete, charName, userName }) => {
    const env = ENVELOPE_STYLE[letter.envelope] || ENVELOPE_STYLE.classic;
    const date = new Date(letter.sentAt);
    const dateLabel = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

    // 暮色 8-25：love 款顶部加极细粉色渐变边线
    const topAccent = letter.envelope === 'love'
        ? 'bg-gradient-to-r from-rose-200 via-rose-300 to-rose-200'
        : letter.envelope === 'classic'
        ? 'bg-gradient-to-r from-sky-200 via-sky-300 to-sky-200'
        : letter.envelope === 'handwrite'
        ? 'bg-gradient-to-r from-amber-200 via-amber-300 to-amber-200'
        : 'bg-gradient-to-r from-yellow-200 via-yellow-300 to-yellow-200';

    return (
        <div className="flex-1 flex flex-col bg-white">
            {/* 极细顶部装饰边线（1px） */}
            <div className={`h-px ${topAccent}`} />

            {/* Header */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/80 backdrop-blur shrink-0">
                <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform" aria-label="返回">
                    <CaretLeft size={20} weight="bold" />
                </button>
                <span className={`text-xs font-medium ${env.accent}`}>{env.name}</span>
                <button onClick={onDelete} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors" aria-label="删除">
                    <Trash size={16} />
                </button>
            </div>

            {/* 正文（大量留白 + 行高 1.8） */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-2xl mx-auto px-7 py-10">
                    {/* 标题 */}
                    <h1 className="text-2xl font-semibold text-slate-900 mb-3 tracking-tight">
                        {letter.title}
                    </h1>
                    {/* 元信息：发信人 + 日期 */}
                    <div className="flex items-center gap-2 text-[12px] text-slate-400 mb-10">
                        <span>{letter.fromUser === 'user' ? `你写给 ${charName}` : `${charName} 写给 ${userName}`}</span>
                        <span className="text-slate-300">·</span>
                        <span>{dateLabel}</span>
                    </div>

                    {/* 正文 */}
                    <article className="text-[15.5px] text-slate-800 leading-[1.8] whitespace-pre-wrap font-normal">
                        {letter.content}
                    </article>

                    {/* 占位空间 */}
                    <div className="h-32" />
                </div>
            </div>

            {/* 底部"回信"按钮（只有收到角色来信时显示） */}
            {letter.fromUser === 'char' && (
                <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur px-5 py-3">
                    <button
                        onClick={onReply}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white rounded-2xl font-medium transition-colors"
                    >
                        <PaperPlaneTilt size={18} weight="fill" />
                        回一封信
                    </button>
                </div>
            )}
        </div>
    );
};

// =================== 写信视图 ===================
// 暮色 8-25 UI 规范：
//   - 简洁 textarea
//   - 上方：4 个小圆形色块横排（选中的加 ring）
//   - 下方：发送/定时选项
//   - 不用花体字 / 拟物化
const ComposeView: React.FC<{
    onBack: () => void;
    onSent: () => void;
    charId: string;
    charName: string;
    userName: string;
    addToast?: (msg: string, type?: any) => void;
    replyTo: MailboxLetter | null;
}> = ({ onBack, onSent, charId, charName, userName, addToast, replyTo }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [envelope, setEnvelope] = useState<MailboxEnvelope>('classic');
    const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('20:00');
    const [sending, setSending] = useState(false);

    const charCount = content.length;

    const handleSend = async () => {
        if (!content.trim()) {
            addToast?.('正文不能为空', 'error');
            return;
        }
        if (!charId) {
            addToast?.('请先选择角色', 'error');
            return;
        }
        setSending(true);
        try {
            let deliverAt: number | null = null;
            if (sendMode === 'schedule') {
                if (!scheduleDate) {
                    addToast?.('请选择日期', 'error');
                    setSending(false);
                    return;
                }
                const dt = new Date(`${scheduleDate}T${scheduleTime || '20:00'}:00`);
                deliverAt = dt.getTime();
                if (deliverAt <= Date.now()) {
                    addToast?.('定时时间必须在未来', 'error');
                    setSending(false);
                    return;
                }
            }
            const letter = await createLetter({
                charId,
                fromUser: 'user',
                title: title.trim() || '无题',
                content: content.trim(),
                envelope,
                deliverAt,
                replyToId: replyTo?.id || null,
            });
            if (sendMode === 'schedule' && letter.deliverAt) {
                const d = new Date(letter.deliverAt);
                addToast?.(`信已安排在 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 送达`, 'success');
            } else {
                addToast?.(`信已寄出`, 'success');
            }
            onSent();
        } catch (e) {
            console.warn('📬 [MailboxPage] 发送失败:', e);
            addToast?.('发送失败', 'error');
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-white">
            {/* Header */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/80 backdrop-blur shrink-0 border-b border-slate-100">
                <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform" aria-label="返回">
                    <CaretLeft size={20} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">
                    {replyTo ? `回信给 ${charName}` : `写信给 ${charName}`}
                </h1>
                <div className="w-9 h-9" aria-hidden />
            </div>

            <div className="flex-1 overflow-y-auto">
                {/* 回复提示（如果有 replyTo） */}
                {replyTo && (
                    <div className="mx-5 mt-4 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[12px] text-slate-500">
                        回复：《{replyTo.title}》
                    </div>
                )}

                {/* 收件人（只读） */}
                <div className="px-5 pt-5 pb-3 flex items-center gap-2 text-sm text-slate-500">
                    <span>收件人</span>
                    <span className="font-medium text-slate-800">{charName}</span>
                </div>

                {/* 信封样式选择：4 个小圆色块横排 */}
                <div className="px-5 pb-5">
                    <div className="text-[11px] text-slate-400 mb-2 uppercase tracking-wider">信封样式</div>
                    <div className="flex items-center gap-3">
                        {(Object.keys(ENVELOPE_STYLE) as MailboxEnvelope[]).map((key) => {
                            const env = ENVELOPE_STYLE[key];
                            const isSelected = envelope === key;
                            return (
                                <button
                                    key={key}
                                    onClick={() => setEnvelope(key)}
                                    className={`flex flex-col items-center gap-1.5 transition-all`}
                                    aria-label={`信封样式 ${env.name}`}
                                >
                                    <span
                                        className={`w-10 h-10 rounded-full ${env.bg} flex items-center justify-center transition-all ${
                                            isSelected ? `ring-2 ${env.ring} ring-offset-2 ring-offset-white scale-110` : ''
                                        }`}
                                    >
                                        <Envelope size={18} weight={isSelected ? 'fill' : 'regular'} className={env.accent} />
                                    </span>
                                    <span className={`text-[11px] ${isSelected ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>{env.name}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* 标题 */}
                <div className="px-5 pb-4">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="标题（可空）"
                        maxLength={40}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-[15px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
                    />
                </div>

                {/* 正文（无字数限制） */}
                <div className="px-5 pb-3">
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="写下你想对 ta 说的话…"
                        rows={14}
                        className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-[15.5px] text-slate-800 leading-[1.8] placeholder-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors resize-none"
                    />
                </div>

                {/* 字符计数 */}
                <div className="px-5 pb-4 text-right text-[11px] text-slate-400">
                    {charCount} 字
                </div>
            </div>

            {/* 底部：发送 / 定时 */}
            <div className="shrink-0 border-t border-slate-100 bg-white/95 backdrop-blur">
                {/* 发送方式切换 */}
                <div className="px-5 pt-3 pb-2 flex items-center gap-4 text-sm">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="radio"
                            checked={sendMode === 'now'}
                            onChange={() => setSendMode('now')}
                            className="accent-slate-800"
                        />
                        <span className={sendMode === 'now' ? 'text-slate-900 font-medium' : 'text-slate-500'}>立即发送</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="radio"
                            checked={sendMode === 'schedule'}
                            onChange={() => setSendMode('schedule')}
                            className="accent-slate-800"
                        />
                        <span className={sendMode === 'schedule' ? 'text-slate-900 font-medium' : 'text-slate-500'}>定时发送</span>
                    </label>
                </div>

                {/* 定时时间选择 */}
                {sendMode === 'schedule' && (
                    <div className="px-5 pb-3 flex items-center gap-2 text-sm">
                        <input
                            type="date"
                            value={scheduleDate}
                            onChange={(e) => setScheduleDate(e.target.value)}
                            min={new Date().toISOString().split('T')[0]}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                        />
                        <input
                            type="time"
                            value={scheduleTime}
                            onChange={(e) => setScheduleTime(e.target.value)}
                            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                        />
                    </div>
                )}

                {/* 发送按钮 */}
                <div className="px-5 pb-3">
                    <button
                        onClick={handleSend}
                        disabled={sending || !content.trim()}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white rounded-2xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <PaperPlaneTilt size={18} weight="fill" />
                        {sending ? '发送中...' : (sendMode === 'schedule' ? '安排发送' : '寄出')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MailboxPage;
