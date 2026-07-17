// NotebookDetail — 私密记事详情页（暮色 2026-07-17：点开便签后全屏看 + 回复）
// 复用 NotebookCard 的便签视觉，放大版 + 完整内容
// 底部：回复列表 + 回复输入框

import React, { useState } from 'react';
import { CaretLeft, Trash, PaperPlaneRight } from '@phosphor-icons/react';
import { RoomNote, NoteReply } from '../../types';

interface NotebookDetailProps {
    note: RoomNote;
    charName?: string;
    onBack: () => void;
    onDelete: () => void;
    onAddReply: (content: string) => Promise<void>;
}

const NotebookDetail: React.FC<NotebookDetailProps> = ({ note, charName, onBack, onDelete, onAddReply }) => {
    const [replyText, setReplyText] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submitReply = async () => {
        const text = replyText.trim();
        if (!text || submitting) return;
        setSubmitting(true);
        try {
            await onAddReply(text);
            setReplyText('');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 flex flex-col bg-[#f3eee5]">
            {/* 顶部 */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/60 backdrop-blur border-b border-white/40 shrink-0">
                <button
                    onClick={onBack}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform"
                    aria-label="返回"
                >
                    <CaretLeft size={18} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">
                    {charName ? `${charName} · 私密记事` : '私密记事'}
                </h1>
                <button
                    onClick={onDelete}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-500 active:scale-95 transition-all"
                    aria-label="删除"
                    title="删除"
                >
                    <Trash size={16} />
                </button>
            </div>

            {/* 主便签（全屏放大版） */}
            <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4 no-scrollbar">
                <FullNoteCard note={note} charName={charName} />
                <div className="text-[10px] text-slate-400 text-center mt-3 font-mono">
                    {new Date(note.timestamp).toLocaleString('zh-CN')}
                </div>

                {/* 回复列表 */}
                {(note.replies && note.replies.length > 0) && (
                    <div className="mt-8 space-y-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">
                            <span>💬</span>
                            <span>回复 ({note.replies.length})</span>
                        </div>
                        {note.replies.map((r) => (
                            <ReplyBubble key={r.id} reply={r} />
                        ))}
                    </div>
                )}
            </div>

            {/* 底部回复输入 */}
            <div className="px-3 py-3 bg-white/85 backdrop-blur border-t border-white/40 shrink-0 flex items-center gap-2"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitReply(); } }}
                    placeholder="说点什么…"
                    className="flex-1 px-4 py-2.5 bg-slate-100 rounded-full text-xs text-slate-700 outline-none focus:bg-slate-50 focus:ring-2 focus:ring-emerald-200 transition-all"
                    disabled={submitting}
                />
                <button
                    onClick={submitReply}
                    disabled={!replyText.trim() || submitting}
                    className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md flex items-center justify-center disabled:opacity-40 active:scale-95 transition-all"
                    aria-label="发送回复"
                >
                    <PaperPlaneRight size={16} weight="fill" />
                </button>
            </div>
        </div>
    );
};

// 详情页用的大版便签（保留 5 种 type 视觉，放大显示）
const FullNoteCard: React.FC<{ note: RoomNote; charName?: string }> = ({ note, charName }) => {
    const type = note.type || 'thought';
    const isSearch = type === 'search';

    return (
        <div
            className="relative w-full rounded-2xl shadow-xl p-6 min-h-[280px]"
            style={{
                backgroundColor: isSearch ? '#d4a574' : (
                    type === 'doodle' ? '#ffffff' :
                    type === 'lyric' ? '#fce7f3' :
                    type === 'gossip' ? '#fef3c7' :
                    type === 'thought' ? '#dbeafe' : '#ffffff'
                ),
                ...(type === 'doodle' && {
                    backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                }),
                ...(type === 'gossip' && {
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 30px, #fde68a 30px, #fde68a 31px)',
                }),
            }}
        >
            {/* 装饰物（按 type） */}
            {type === 'thought' && (
                <div className="absolute top-3 left-3 w-7 h-7 rounded-full shadow-md"
                    style={{ background: 'radial-gradient(circle at 30% 30%, #60a5fa, #2563eb)', border: '2px solid #1e40af' }} />
            )}
            {type === 'doodle' && (
                <div className="absolute top-0 right-0 w-0 h-0"
                    style={{ borderTop: '28px solid #fbcfe8', borderLeft: '28px solid transparent' }} />
            )}
            {type === 'search' && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full"
                    style={{ background: 'radial-gradient(circle at 30% 30%, #4b5563, #111827)' }} />
            )}
            {type === 'lyric' && (
                <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-4 h-8"
                    style={{ border: '2px solid #64748b', borderRadius: '6px' }} />
            )}
            {type === 'gossip' && (
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-16 h-4"
                    style={{ backgroundColor: 'rgba(255,255,255,0.7)', border: '1px solid rgba(0,0,0,0.05)' }} />
            )}

            <div className="flex items-center justify-between mb-3 text-[11px] font-bold">
                <span className={`px-2 py-0.5 rounded ${isSearch ? 'bg-black/15 text-stone-100' : 'bg-white/70 text-slate-700'}`}>
                    {({ thought: '感想', doodle: '涂鸦', search: '搜索', lyric: '歌词', gossip: '八卦' } as Record<string, string>)[type]}
                </span>
                {charName && (
                    <span className={isSearch ? 'text-stone-100' : 'text-slate-500'}>— {charName}</span>
                )}
            </div>

            <div className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${isSearch ? 'text-stone-100' : 'text-slate-800'}`}>
                {note.content}
            </div>
        </div>
    );
};

const ReplyBubble: React.FC<{ reply: NoteReply }> = ({ reply }) => {
    const isUser = reply.author === 'user';
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className={`max-w-[78%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed shadow-sm ${
                    isUser
                        ? 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white rounded-br-sm'
                        : 'bg-white text-slate-700 rounded-bl-sm border border-slate-100'
                }`}
            >
                <div className="whitespace-pre-wrap break-words">{reply.content}</div>
                <div className={`text-[9px] mt-1 ${isUser ? 'text-white/70' : 'text-slate-400'}`}>
                    {new Date(reply.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>
        </div>
    );
};

export default NotebookDetail;
