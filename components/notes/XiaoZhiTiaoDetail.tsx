// XiaoZhiTiaoDetail — 小纸条详情页（2026-07-22：跟 NotebookDetail 完全独立）
// 暮色原话："小纸条完全脱离小小窝 app" — 独立组件，独立标题"小纸条"
// 复用 XiaoZhiTiaoCard 视觉风格（全屏放大版 + 完整内容 + 右下角时间戳和回复按钮）
// 暮色 2026-07-22：输入区交互（默认"回复"按钮 + 点开弹输入框 + 键盘联动）

import React, { useEffect, useRef, useState } from 'react';
import { CaretLeft, Trash, PaperPlaneRight } from '@phosphor-icons/react';
import { XiaoZhiTiao, XiaoZhiTiaoReply } from '../../types';
import { getStoredNotebookBg, BUILTIN_BG, type BuiltinBg } from './NotebookBackground';

interface XiaoZhiTiaoDetailProps {
    note: XiaoZhiTiao;
    charName?: string;
    onBack: () => void;
    onDelete: () => void;
    onAddReply: (content: string) => Promise<void>;
}

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
            <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4 no-scrollbar">
                <FullXiaoZhiTiaoCard
                    note={note}
                    charName={charName}
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

// 详情页用的大版便签（2026-07-22：5 type 视觉全部废弃，简化为图背景 + 纯白兜底）
// 2026-07-23：文字以图中心为原点绝对居中（不依赖图中央留白），半透明白底让字清晰
const FullXiaoZhiTiaoCard: React.FC<{
    note: XiaoZhiTiao;
    charName?: string;
    onReplyClick?: () => void;
    hideReplyButton?: boolean;
}> = ({ note, charName, onReplyClick, hideReplyButton }) => {
    return (
        <div
            // 暮色原图直接显示，不加圆角/边框/阴影（暮色不要被"框起来"）
            className="relative w-full min-h-[320px] overflow-hidden bg-no-repeat"
            style={
                note.styleImageUrl
                    // contain 完整显示不裁切
                    ? {
                        backgroundImage: `url(${note.styleImageUrl})`,
                        backgroundSize: 'contain',
                        backgroundPosition: 'center',
                        backgroundRepeat: 'no-repeat',
                        backgroundColor: '#f8fafc',  // contain 模式图外浅灰
                    }
                    // 无图时纯白兜底
                    : { backgroundColor: '#ffffff' }
            }
        >
            {/* 文字层：绝对居中（以图中心为原点），给字加半透明白底（清晰可读 + 不压边框） */}
            <div className="absolute inset-0 flex items-center justify-center p-6 pb-14">
                <div className={`max-w-[60%] rounded-2xl px-4 py-3 text-center ${note.styleImageUrl ? 'bg-white/85 backdrop-blur-sm shadow-md' : ''}`}>
                    {charName && (
                        <div className="text-[10px] font-bold text-slate-500 mb-1">— {charName}</div>
                    )}
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-slate-800 line-clamp-6">
                        {note.content}
                    </div>
                </div>
            </div>

            {/* 右下角时间戳 + 回复按钮 */}
            <div className="absolute bottom-2 right-3 flex items-center gap-2 z-10">
                {!hideReplyButton && onReplyClick && (
                    <button
                        onClick={onReplyClick}
                        className="w-7 h-7 rounded-full bg-white/85 backdrop-blur shadow-sm border border-white/60 flex items-center justify-center active:scale-95 transition-transform text-[11px]"
                        title="回复"
                    >
                        💬
                    </button>
                )}
                <span className="text-[10px] font-mono text-slate-500 bg-white/70 backdrop-blur-sm px-1.5 py-0.5 rounded">
                    {new Date(note.timestamp).toLocaleString('zh-CN')}
                </span>
            </div>
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
