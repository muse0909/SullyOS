// XiaoZhiTiaoCard — 小纸条便签卡片（2026-07-22：跟 NotebookCard 完全独立）
// 暮色 2026-07-22：5 type 视觉全部废弃，改为图背景 + 文字居中
//   - 有 styleImageUrl：图当背景，文字居中 + 白字 + drop-shadow
//   - 无 styleImageUrl：纯白便签 + 圆角阴影（等暮色给图后换默认）
//   - 保留轻微旋转 + hover 归正放大

import React from 'react';
import { XiaoZhiTiao } from '../../types';

interface XiaoZhiTiaoCardProps {
    note: XiaoZhiTiao;
    onClick?: () => void;
    onDelete?: () => void;
    charName?: string;
    style?: React.CSSProperties;
}

const XiaoZhiTiaoCard: React.FC<XiaoZhiTiaoCardProps> = ({ note, onClick, onDelete, charName, style }) => {
    // 轻微随机旋转（用 note.id hash 一下，保证稳定不抖动）
    const seedHash = note.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const rotateDeg = ((seedHash % 5) - 2) * 0.6; // -1.2° ~ +1.2°
    const finalStyle: React.CSSProperties = {
        transform: `rotate(${rotateDeg}deg)`,
        transition: 'transform 0.2s ease',
        ...style,
    };

    return (
        <div
            onClick={onClick}
            className="relative group cursor-pointer"
            style={finalStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = `rotate(0deg) scale(1.03)`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = `rotate(${rotateDeg}deg)`; }}
        >
            {/* 便签纸 */}
            <div
                className="relative w-full h-48 rounded-2xl shadow-md p-3.5 pt-7 border border-white/40"
                style={
                    note.styleImageUrl
                        // 2026-07-22：图当背景，文字居中（暮色画的图中间留大块空白）
                        ? {
                            backgroundImage: `url(${note.styleImageUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                        }
                        // 2026-07-22：无图时纯白便签（暮色说删 5 type 视觉，这里留简洁兜底）
                        : { backgroundColor: '#ffffff' }
                }
            >
                {/* 顶部时间 */}
                <div className="flex items-center justify-end mb-2 text-[10px] font-bold">
                    <span style={note.styleImageUrl ? { color: 'rgba(255,255,255,0.85)' } : { color: '#94a3b8' }}>
                        {new Date(note.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                    </span>
                </div>

                {/* 内容预览 */}
                <div
                    className={`text-[11px] leading-relaxed line-clamp-4 overflow-hidden ${note.styleImageUrl ? 'text-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]' : 'text-slate-700'}`}
                >
                    {note.content}
                </div>

                {/* 底部作者 + 回复数 */}
                <div
                    className="absolute bottom-2 left-3.5 right-3.5 flex items-center justify-between text-[9px] font-medium"
                    style={note.styleImageUrl ? { color: 'rgba(255,255,255,0.85)' } : { color: '#94a3b8' }}
                >
                    {charName ? <span>— {charName}</span> : <span />}
                    {(note.replies?.length || 0) > 0 && <span>💬 {note.replies!.length}</span>}
                </div>
            </div>

            {onDelete && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs z-10"
                    title="删除"
                >
                    ×
                </button>
            )}
        </div>
    );
};

export default XiaoZhiTiaoCard;
