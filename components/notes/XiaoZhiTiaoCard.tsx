// XiaoZhiTiaoCard — 小纸条便签卡片（2026-07-22：跟 NotebookCard 完全独立）
// 暮色 2026-07-23：列表卡只显示 5 行字，日期/作者/回复数全删（暮色要纯净）
// 暮色原图直接显示（不加任何底/框/阴影）
// 保留轻微旋转 + hover 归正放大

import React from 'react';
import { XiaoZhiTiao } from '../../types';

interface XiaoZhiTiaoCardProps {
    note: XiaoZhiTiao;
    onClick?: () => void;
    onDelete?: () => void;
    charName?: string;
    style?: React.CSSProperties;
}

const XiaoZhiTiaoCard: React.FC<XiaoZhiTiaoCardProps> = ({ note, onClick, onDelete, charName: _charName, style }) => {
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
            {/* 便签纸：暮色原图直接显示（不加任何底/框/阴影） */}
            <div
                className="relative w-full h-48 bg-no-repeat"
                style={
                    note.styleImageUrl
                        // 透明底 PNG 直接显示，不加 backgroundColor
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
                {/* 文字：纯文字（无底无框），居中放在图中央留白区 */}
                {/* 2026-07-23：line-clamp 3→5，暮色"上下空白还很大，增加到5行" */}
                <div className="absolute inset-0 flex items-center justify-center p-5">
                    <div className="max-w-[60%] text-center">
                        <div className="text-[10px] leading-snug line-clamp-5 overflow-hidden text-slate-800">
                            {note.content}
                        </div>
                    </div>
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
