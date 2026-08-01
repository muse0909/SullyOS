/**
 * 暮色 2026-08-01 22:40：共享播放队列浮层组件
 *
 * 给 GlobalMiniPlayer 和 MusicApp 播放页共用。统一用项目级居中卡片样式
 * （max-w-sm + rounded-[2.5rem] + 白底 + 紫调文字），跟 Modal 一致。
 *
 * 关键点：
 * 1) createPortal 挂到 document.body —— 避免被父容器 transform/overflow 影响
 *    浮层定位和 touch 事件（之前半屏底部弹层 touchmove 冒泡到下层聊天流）
 * 2) onTouchMove stopPropagation 兜底
 * 3) 自适应高度（max-h-[80vh] + flex-1 滚动），内容少时卡片自动变矮
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { List, X, Trash } from '@phosphor-icons/react';
import { useMusic } from '../../context/MusicContext';

interface QueuePanelProps {
    open: boolean;
    onClose: () => void;
    /**
     * 浮层标题，默认 "播放队列"。
     * 播放页可以传 "当前播放 · 队列" 区分场景。
     */
    title?: string;
}

const QueuePanel: React.FC<QueuePanelProps> = ({ open, onClose, title = '播放队列' }) => {
    const { queue, idx, jumpToQueueIndex, removeFromQueue } = useMusic();

    if (!open) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="absolute inset-0 bg-slate-900/45 backdrop-blur-[1px]"
                onClick={onClose}
            />
            <div
                className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up max-h-[80vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
            >
                {/* header */}
                <div className="px-6 pt-6 pb-2 shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <List size={16} weight="bold" style={{ color: '#807c9d' }} />
                        <h3 className="text-base font-bold truncate" style={{ color: '#22232a' }}>
                            {title}
                        </h3>
                        <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ background: '#ebe9f5', color: '#807c9d' }}
                        >
                            {queue.length} 首
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full active:scale-95 shrink-0"
                        style={{ color: '#7c779a' }}
                        aria-label="关闭队列"
                    >
                        <X size={16} weight="bold" />
                    </button>
                </div>

                {/* list */}
                <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                    {queue.length === 0 ? (
                        <div className="text-center py-12 text-[11px]" style={{ color: '#bcb8cc' }}>
                            队列为空
                        </div>
                    ) : (
                        queue.map((s, i) => {
                            const isCurrent = i === idx;
                            return (
                                <div
                                    key={`${s.id}-${i}`}
                                    className="flex items-center gap-2.5 py-2 rounded-xl active:scale-[0.99] transition-transform"
                                    style={{
                                        background: isCurrent ? '#ebe9f5' : 'transparent',
                                    }}
                                >
                                    {/* 序号 / 当前播放标志 */}
                                    <div
                                        className="shrink-0 w-7 h-7 flex items-center justify-center text-[10px] font-mono rounded-full"
                                        style={{
                                            color: isCurrent ? '#fff' : '#bcb8cc',
                                            background: isCurrent ? 'linear-gradient(135deg, #807c9d, #b3a8ce)' : 'transparent',
                                            fontWeight: isCurrent ? 700 : 400,
                                        }}
                                    >
                                        {isCurrent ? '♪' : i + 1}
                                    </div>

                                    {/* 封面 */}
                                    <img
                                        src={s.albumPic}
                                        alt=""
                                        className="shrink-0 w-9 h-9 rounded-lg object-cover"
                                        draggable={false}
                                    />

                                    {/* 歌名 / 艺人 — 点跳播 */}
                                    <button
                                        onClick={() => {
                                            jumpToQueueIndex(i);
                                            onClose();
                                        }}
                                        className="flex-1 min-w-0 text-left active:opacity-70"
                                    >
                                        <div
                                            className="text-[12px] truncate"
                                            style={{
                                                color: isCurrent ? '#807c9d' : '#22232a',
                                                fontWeight: isCurrent ? 600 : 500,
                                            }}
                                        >
                                            {s.name}
                                        </div>
                                        <div className="text-[10px] truncate" style={{ color: '#7c779a' }}>
                                            {s.artists}
                                        </div>
                                    </button>

                                    {/* 删除按钮 */}
                                    <button
                                        onClick={() => removeFromQueue(s.id)}
                                        className="shrink-0 p-1.5 rounded-full active:scale-95"
                                        style={{ color: '#7c779a' }}
                                        aria-label={`从队列删除 ${s.name}`}
                                    >
                                        <Trash size={14} weight="regular" />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* footer */}
                <div className="px-6 pb-6 shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-3 font-bold rounded-2xl active:scale-95 transition-transform"
                        style={{ background: '#ebe9f5', color: '#807c9d' }}
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default QueuePanel;
