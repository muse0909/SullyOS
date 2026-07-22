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
                className="relative w-full h-48 rounded-2xl shadow-md overflow-hidden border border-white/40 bg-no-repeat"
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
                        // 无图时纯白
                        : { backgroundColor: '#ffffff' }
                }
            >
                {/* 文字层：绝对居中（以图中心为原点），半透明白底让字清晰，不压边框 */}
                <div className="absolute inset-0 flex items-center justify-center p-4 pb-6">
                    <div className={`max-w-[65%] text-center ${note.styleImageUrl ? 'bg-white/85 backdrop-blur-sm rounded-lg px-2 py-1' : ''}`}>
                        <div className={`text-[10px] leading-snug line-clamp-3 overflow-hidden ${note.styleImageUrl ? 'text-slate-800' : 'text-slate-700'}`}>
                            {note.content}
                        </div>
                    </div>
                </div>

                {/* 顶部时间（右上角，浮在图上） */}
                <div className="absolute top-1.5 right-2 z-10">
                    <span className="text-[9px] font-mono text-slate-500 bg-white/70 backdrop-blur-sm px-1 py-0.5 rounded">
                        {new Date(note.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                    </span>
                </div>

                {/* 底部作者 + 回复数 */}
                <div className="absolute bottom-1.5 left-2 right-2 flex items-center justify-between text-[8px] font-medium z-10">
                    {charName ? <span className="text-slate-500 bg-white/70 backdrop-blur-sm px-1 py-0.5 rounded">— {charName}</span> : <span />}
                    {(note.replies?.length || 0) > 0 && <span className="text-slate-500 bg-white/70 backdrop-blur-sm px-1 py-0.5 rounded">💬 {note.replies!.length}</span>}
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
