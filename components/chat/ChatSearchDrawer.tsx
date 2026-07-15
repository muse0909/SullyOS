
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlass, X, CaretDown, CaretUp } from '@phosphor-icons/react';
import { DB } from '../../utils/db';
import { Message, CharacterProfile } from '../../types';

interface ChatSearchDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    activeCharacter: CharacterProfile;
    userName: string;
    // 暮色 2026-07-15：点结果跳到聊天 — Chat 注入，Drawer 调一下 + 自己关掉
    onJumpToMessage?: (messageId: string) => void;
}

const FOLD_PREVIEW_LEN = 60; // 折叠时显示的字数
const SEARCH_DEBOUNCE_MS = 200;

function formatResultDate(ts: number): string {
    const d = new Date(ts);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hh}:${mm}`;
}

const ChatSearchDrawer: React.FC<ChatSearchDrawerProps> = ({
    isOpen,
    onClose,
    activeCharacter,
    userName,
    onJumpToMessage,
}) => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [allMessages, setAllMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
    const inputRef = useRef<HTMLInputElement>(null);

    // Esc 关闭
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    // 打开时：拉取该角色所有消息 + 自动 focus 搜索框
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setLoading(true);
        setQuery('');
        setDebouncedQuery('');
        setExpandedIds(new Set());
        DB.getMessagesByCharId(activeCharacter.id, true).then((msgs) => {
            if (cancelled) return;
            // 跟 Chat.tsx 一样的过滤：date/call 来源不进聊天主界面
            const filtered = msgs.filter(m => m.metadata?.source !== 'date' && m.metadata?.source !== 'call');
            setAllMessages(filtered);
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 80);
        }).catch(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, activeCharacter.id]);

    // 搜索 debounce
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(t);
    }, [query]);

    // 过滤 + 排序（最新的在前）
    const results = useMemo(() => {
        const q = debouncedQuery.toLowerCase();
        if (!q) return [];
        return allMessages
            .filter(m => typeof m.content === 'string' && m.content.toLowerCase().includes(q))
            .sort((a, b) => b.timestamp - a.timestamp);
    }, [allMessages, debouncedQuery]);

    // 高亮关键词：把内容按关键词切成几段，命中的包 <mark>
    const renderHighlighted = (text: string, q: string) => {
        if (!q) return text;
        const lower = text.toLowerCase();
        const lowerQ = q.toLowerCase();
        const parts: React.ReactNode[] = [];
        let i = 0;
        let key = 0;
        while (i < text.length) {
            const idx = lower.indexOf(lowerQ, i);
            if (idx === -1) {
                parts.push(text.slice(i));
                break;
            }
            if (idx > i) parts.push(text.slice(i, idx));
            parts.push(
                <mark key={`hl-${key++}`} className="bg-amber-200/70 text-slate-800 rounded-sm px-0.5">
                    {text.slice(idx, idx + q.length)}
                </mark>
            );
            i = idx + q.length;
        }
        return parts;
    };

    const toggleExpand = (id: number) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[200] bg-slate-900/45 backdrop-blur-[1px] animate-fade-in"
            onClick={onClose}
        >
            <div
                className="absolute right-0 top-0 bottom-0 w-[88%] max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right"
                onClick={e => e.stopPropagation()}
            >
                {/* 顶部：搜索框 + 取消 */}
                <div className="px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex-1 relative">
                            <MagnifyingGlass
                                className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
                                weight="bold"
                            />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="搜索聊天记录"
                                className="w-full h-11 pl-10 pr-10 rounded-2xl bg-slate-100 border border-transparent focus:bg-white focus:border-primary/40 text-[14px] text-slate-700 placeholder:text-slate-400 outline-none transition-colors"
                            />
                            {query && (
                                <button
                                    onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-slate-300 text-white flex items-center justify-center active:scale-90"
                                    title="清空"
                                >
                                    <X className="w-3 h-3" weight="bold" />
                                </button>
                            )}
                        </div>
                        <button
                            onClick={onClose}
                            className="text-[14px] text-slate-600 font-medium active:opacity-60 px-1 py-2"
                        >
                            取消
                        </button>
                    </div>
                </div>

                {/* 搜索结果列表 */}
                <div className="flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
                    {/* 搜索结果标题 + 数量 */}
                    {debouncedQuery && (
                        <div className="flex items-baseline justify-between mb-3 mt-1">
                            <span className="text-[12px] text-slate-400">搜索结果</span>
                            <span className="text-[11px] text-slate-300">{results.length} 条结果</span>
                        </div>
                    )}

                    {/* 加载中 */}
                    {loading && (
                        <div className="text-center text-slate-400 text-[12px] py-10">载入中…</div>
                    )}

                    {/* 空状态 */}
                    {!loading && debouncedQuery && results.length === 0 && (
                        <div className="text-center text-slate-400 text-[12px] py-10">
                            没有找到「{debouncedQuery}」相关内容
                        </div>
                    )}

                    {/* 还没输入关键词 */}
                    {!loading && !debouncedQuery && (
                        <div className="text-center text-slate-400 text-[12px] py-10">
                            输入关键词搜索当前角色的所有聊天记录
                        </div>
                    )}

                    {/* 结果列表 */}
                    <div className="space-y-3">
                        {results.map((m) => {
                            const isExpanded = expandedIds.has(m.id);
                            const content = m.content || '';
                            const isLong = content.length > FOLD_PREVIEW_LEN;
                            const display = !isExpanded && isLong
                                ? content.slice(0, FOLD_PREVIEW_LEN)
                                : content;
                            const speakerName = m.role === 'user' ? userName : activeCharacter.name;
                            // 暮色 2026-07-15：整张卡片可点跳转，展开按钮 stopPropagation 防误触
                            const handleJump = onJumpToMessage
                                ? () => onJumpToMessage(String(m.id))
                                : undefined;
                            return (
                                <div
                                    key={m.id}
                                    className={`bg-slate-50/80 rounded-2xl px-4 py-3 border border-slate-100/60 ${onJumpToMessage ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''}`}
                                    onClick={handleJump}
                                    role={onJumpToMessage ? 'button' : undefined}
                                    tabIndex={onJumpToMessage ? 0 : undefined}
                                    onKeyDown={onJumpToMessage ? (e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            handleJump?.();
                                        }
                                    } : undefined}
                                >
                                    <div className="flex items-baseline justify-between mb-1.5">
                                        <span className="text-[12px] text-slate-500 font-medium">{speakerName}</span>
                                        <span className="text-[11px] text-slate-300">{formatResultDate(m.timestamp)}</span>
                                    </div>
                                    <div className={`text-[13px] text-slate-700 leading-relaxed ${!isExpanded && isLong ? 'line-clamp-3' : ''} whitespace-pre-wrap break-words`}>
                                        {renderHighlighted(display, debouncedQuery)}
                                        {!isExpanded && isLong && <span className="text-slate-400">…</span>}
                                    </div>
                                    {isLong && (
                                        <div className="flex justify-center mt-1.5">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); toggleExpand(m.id); }}
                                                className="w-7 h-7 rounded-full hover:bg-white/80 flex items-center justify-center text-slate-400 active:scale-90 transition-transform"
                                                title={isExpanded ? '收起' : '展开全部'}
                                            >
                                                {isExpanded
                                                    ? <CaretUp className="w-3.5 h-3.5" weight="bold" />
                                                    : <CaretDown className="w-3.5 h-3.5" weight="bold" />}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* 底部留白 + 小提示，让空搜索状态不那么空 */}
                    {!loading && results.length === 0 && debouncedQuery && (
                        <div className="mt-4 text-center text-[10.5px] text-slate-300 leading-relaxed">
                            试试别的关键词，或滑回聊天页查看上下文
                        </div>
                    )}
                    {!loading && !debouncedQuery && allMessages.length > 0 && (
                        <div className="mt-4 text-center text-[10.5px] text-slate-300 leading-relaxed">
                            共载入 {allMessages.length} 条该角色聊天记录
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ChatSearchDrawer;
