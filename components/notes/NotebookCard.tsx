// NotebookCard — 私密记事便签卡片（暮色 2026-07-17：手帐风小纸条视觉）
// 5 种 type 对应 5 种便签样式（暮色参考图）：
//   - thought 感想  → 蓝色便签 + 左上角外侧蓝圆钉
//   - doodle  涂鸦  → 白色方格纸 + 右上角粉色折角
//   - search  搜索  → 牛皮纸 + 顶部外侧黑色小钉
//   - lyric   歌词  → 粉色便签 + 顶部外侧回形针
//   - gossip  八卦  → 黄色便签 + 顶部外侧胶带 + 横线
// 暮色 2026-07-17 修：之前 thought 漏写 backgroundColor，导致便签透到背景
// 暮色审美：便签纸必须实心 + 圆钉/徽章位置错开（圆钉在便签外，徽章在便签内左上）
// 每张轻微旋转（-1.2°~+1.2°），hover 时归正+放大

import React from 'react';
import { RoomNote } from '../../types';

const TYPE_LABELS: Record<RoomNote['type'], string> = {
    thought: '感想',
    doodle: '涂鸦',
    search: '搜索',
    lyric: '歌词',
    gossip: '八卦',
};

// 每种 type 的"实心纸"配置：背景色 + 墨水色（字色）+ 可选底纹
interface TypeStyle {
    bg: string;
    ink: string;
    badgeBg: string;          // 徽章背景（跟 ink 区分）
    badgeText: string;        // 徽章文字色
    patternCss?: React.CSSProperties;  // 可选底纹（doodle 方格 / gossip 横线）
}

const TYPE_STYLE: Record<RoomNote['type'], TypeStyle> = {
    thought: {
        bg: '#dbeafe',
        ink: '#1e3a8a',
        badgeBg: '#1e3a8a',
        badgeText: '#ffffff',
    },
    doodle: {
        bg: '#ffffff',
        ink: '#374151',
        badgeBg: '#374151',
        badgeText: '#ffffff',
        patternCss: {
            backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)',
            backgroundSize: '14px 14px',
        },
    },
    search: {
        bg: '#d4a574',
        ink: '#fef3c7',          // 牛皮纸底用奶白字
        badgeBg: '#451a03',
        badgeText: '#fef3c7',
    },
    lyric: {
        bg: '#fce7f3',
        ink: '#9d174d',
        badgeBg: '#9d174d',
        badgeText: '#ffffff',
    },
    gossip: {
        bg: '#fef3c7',
        ink: '#92400e',
        badgeBg: '#92400e',
        badgeText: '#ffffff',
        patternCss: {
            backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 22px, #fde68a 22px, #fde68a 23px)',
        },
    },
};

interface NotebookCardProps {
    note: RoomNote;
    onClick?: () => void;
    onDelete?: () => void;
    charName?: string;
    style?: React.CSSProperties;
}

const NotebookCard: React.FC<NotebookCardProps> = ({ note, onClick, onDelete, charName, style }) => {
    const type = note.type || 'thought';
    const palette = TYPE_STYLE[type];

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
            {/* 便签纸（实心 + 圆角 + 阴影 + 描边） */}
            <div
                className="relative w-full h-48 rounded-2xl shadow-md border border-white/40 p-3.5 pt-7"
                style={{ backgroundColor: palette.bg, ...(palette.patternCss || {}) }}
            >
                {/* 顶部徽章 + 时间（便签内左上） */}
                <div className="flex items-center justify-between mb-2 text-[10px] font-bold">
                    <span
                        className="px-2 py-0.5 rounded-md shadow-sm"
                        style={{ backgroundColor: palette.badgeBg, color: palette.badgeText }}
                    >
                        {TYPE_LABELS[type]}
                    </span>
                    <span style={{ color: palette.ink, opacity: 0.7 }}>
                        {new Date(note.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                    </span>
                </div>

                {/* 内容预览 */}
                <div
                    className="text-[11px] leading-relaxed line-clamp-4 overflow-hidden"
                    style={{ color: palette.ink }}
                >
                    {note.content}
                </div>

                {/* 底部作者 + 回复数 */}
                <div
                    className="absolute bottom-2 left-3.5 right-3.5 flex items-center justify-between text-[9px] font-medium"
                    style={{ color: palette.ink, opacity: 0.7 }}
                >
                    {charName ? <span>— {charName}</span> : <span />}
                    {(note.replies?.length || 0) > 0 && <span>💬 {note.replies!.length}</span>}
                </div>
            </div>

            {/* 装饰物（便签外） */}
            <StickerDecoration type={type} />

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

// 5 种装饰物（圆钉/折角/钉子/回形针/胶带）—— 都在便签外，避免跟内部徽章重叠
const StickerDecoration: React.FC<{ type: RoomNote['type'] }> = ({ type }) => {
    switch (type) {
        case 'thought':
            // 蓝圆钉：便签外左上
            return (
                <div className="absolute -top-2 -left-2 w-6 h-6 rounded-full shadow-md z-10"
                    style={{ background: 'radial-gradient(circle at 30% 30%, #60a5fa, #2563eb)', border: '2px solid #1e40af' }} />
            );
        case 'doodle':
            // 粉色折角：便签外右上
            return (
                <div className="absolute -top-1 -right-1 w-0 h-0 z-10"
                    style={{
                        borderTop: '24px solid #fbcfe8',
                        borderLeft: '24px solid transparent',
                        filter: 'drop-shadow(-1px 1px 1px rgba(0,0,0,0.1))',
                    }} />
            );
        case 'search':
            // 黑色小钉：便签外顶部居中
            return (
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full z-10"
                    style={{ background: 'radial-gradient(circle at 30% 30%, #4b5563, #111827)' }} />
            );
        case 'lyric':
            // 回形针：便签外顶部居中
            return (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-3.5 h-7 z-10"
                    style={{
                        border: '2.5px solid #64748b',
                        borderRadius: '6px',
                        backgroundColor: 'transparent',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                    }} />
            );
        case 'gossip':
            // 胶带：便签外顶部居中
            return (
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-14 h-4 z-10"
                    style={{
                        backgroundColor: 'rgba(255,255,255,0.75)',
                        border: '1px solid rgba(0,0,0,0.05)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    }} />
            );
        default:
            return null;
    }
};

export default NotebookCard;
