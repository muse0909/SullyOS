// XiaoZhiTiaoDetail — 小纸条详情页（2026-07-22：跟 NotebookDetail 完全独立）
// 暮色原话："小纸条完全脱离小小窝 app" — 独立组件，独立标题"小纸条"
// 暮色 2026-07-23：详情页重构
//   - 顶部只留日期+时间（"7/23 23:57" 格式），去掉作者名
//   - 卡片撑满屏幕（min-h 加大）
//   - 字不压边框（保持 60% max-w，字号 12px）
//   - 底部居中"回复"胶囊（图标+文字"回复"）

import React, { useEffect, useRef, useState } from 'react';
import { CaretLeft, Trash, PaperPlaneRight, ChatCircleText } from '@phosphor-icons/react';
import { XiaoZhiTiao, XiaoZhiTiaoReply } from '../../types';
import { getStoredNotebookBg, BUILTIN_BG, type BuiltinBg } from './NotebookBackground';

interface XiaoZhiTiaoDetailProps {
    note: XiaoZhiTiao;
    charName?: string;
    onBack: () => void;
    onDelete: () => void;
    onAddReply: (content: string) => Promise<void>;
}

// 2026-07-23：手动 format 时间（修 toLocaleString 偶发 33:57 这种错位的 bug）
// 暮色要的格式 "7/23 23:57"：月/日 24小时制
const formatStamp = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const XiaoZhiTiaoDetail: React.FC<XiaoZhiTiaoDetailProps> = ({ note, charName, onBack, onDelete, onAddReply }) => {
    const [replyText, setReplyText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [isReplying, setIsReplying] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // 2026-07-22：背景图跟列表页同步
    const [bgUrl, setBgUrl] = useState<string | null>(null);
    const [bgBuiltin, setBgBuiltin] = useState<BuiltinBg>('cream-paper');
    useEffect(() => {
        const stored = getStoredNotebookBg();
        if (stored.url) setBgUrl(stored.url);
        if (stored.builtin) setBgBuiltin(stored.builtin);
    }, []);

    // 监听输入法弹起
    useEffect(() => {
        if (!isReplying) return;
        const vv = window.visualViewport;
        if (!vv) return;
        const onResize = () => {
            const kbh = Math.max(0, window.innerHeight - vv.height);
            setKeyboardHeight(kbh);
        };
        vv.addEventListener('resize', onResize);
        onResize();
        return () => vv.removeEventListener('resize', onResize);
    }, [isReplying]);

    useEffect(() => {
        if (isReplying) {
            const t = setTimeout(() => inputRef.current?.focus(), 80);
            return () => clearTimeout(t);
        }
    }, [isReplying]);

    const submitReply = async () => {
        const text = replyText.trim();
        if (!text || submitting) return;
        setSubmitting(true);
        try {
            await onAddReply(text);
            setReplyText('');
            setIsReplying(false);
        } finally {
            setSubmitting(false);
        }
    };

    const cancelReply = () => {
        setReplyText('');
        setIsReplying(false);
    };

    return (
        <div className="absolute inset-0 flex flex-col">
            {bgUrl ? (
                <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${bgUrl})` }} />
            ) : (
                <div className="absolute inset-0" style={BUILTIN_BG[bgBuiltin].css} />
            )}
            <div className="relative flex-1 flex flex-col">
            {/* 顶部 */}
            <div className="flex items-center justify-between px-2 py-3 bg-white/60 backdrop-blur border-b border-white/40 shrink-0">
                <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 active:scale-95 transition-transform" aria-label="返回">
                    <CaretLeft size={18} weight="bold" />
                </button>
                <h1 className="text-base font-semibold text-slate-800 tracking-wide">
                    {charName ? `${charName} · 小纸条` : '小纸条'}
                </h1>
                <button onClick={onDelete} className="w-9 h-9 flex items-center justify-center rounded-full text-slate-500 hover:bg-rose-50 hover:text-rose-500 active:scale-95 transition-all" aria-label="删除" title="删除">
                    <Trash size={16} />
                </button>
            </div>

            {/* 主便签 */}
            <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4 no-scrollbar">
                <FullXiaoZhiTiaoCard
                    note={note}
                    onReplyClick={() => setIsReplying(true)}
                    hideReplyButton={isReplying}
                />

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

            {isReplying && (
                <div
                    className="absolute left-0 right-0 px-3 py-3 bg-white/95 backdrop-blur border-t border-white/40 flex items-center gap-2 z-30"
                    style={{ bottom: keyboardHeight }}
                >
                    <button onClick={cancelReply} className="px-3 py-2 rounded-full text-xs font-bold text-slate-500 hover:bg-slate-100 active:scale-95 transition-all">
                        取消
                    </button>
                    <input
                        ref={inputRef}
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
            )}
            </div>
        </div>
    );
};

// 详情页用的大版便签
// 2026-07-23：暮色最新要求
//   - 顶部日期+时间（"7/23 23:57" 格式），无作者名
//   - 底部居中"回复"胶囊（图标+回复文字）
//   - 字 12px + max-w-[60%] 不压边框
//   - min-h 加大撑满屏幕
const FullXiaoZhiTiaoCard: React.FC<{
    note: XiaoZhiTiao;
    charName?: string;
    onReplyClick?: () => void;
    hideReplyButton?: boolean;
}> = ({ note, charName: _charName, onReplyClick, hideReplyButton }) => {
    return (
        <div
            // 暮色原图直接显示（不加底/框/阴影）
            className="relative w-full min-h-[70vh] bg-no-repeat"
            style={
                note.styleImageUrl
                    // 透明底 PNG 直接显示
                    ? {
                        backgroundImage: `url(${note.styleImageUrl})`,
                        backgroundSize: 'contain',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                    }
                    // 无图兜底
                    : { backgroundColor: '#ffffff' }
            }
        >
            {/* 顶部日期+时间（纯文字，无作者名） */}
            <div className="absolute top-3 left-0 right-0 z-10 text-center text-[11px] font-mono text-slate-600">
                {formatStamp(note.timestamp)}
            </div>

            {/* 文字：纯文字（无底无框），居中放在图中央留白区 */}
            <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-[60%] text-center">
                    <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-slate-800 line-clamp-6">
                        {note.content}
                    </div>
                </div>
            </div>

            {/* 底部居中"回复"胶囊（暮色要：图标+回复文字，胶囊包住） */}
            {!hideReplyButton && onReplyClick && (
                <div className="absolute bottom-3 left-0 right-0 z-10 flex justify-center">
                    <button
                        onClick={onReplyClick}
                        className="rounded-full bg-slate-900/80 text-white px-4 py-1.5 flex items-center gap-1.5 text-[11px] font-medium active:scale-95 transition-transform shadow-md"
                        title="回复"
                    >
                        <ChatCircleText size={14} weight="fill" />
                        <span>回复</span>
                    </button>
                </div>
            )}
        </div>
    );
};

const ReplyBubble: React.FC<{ reply: XiaoZhiTiaoReply }> = ({ reply }) => {
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

export default XiaoZhiTiaoDetail;
