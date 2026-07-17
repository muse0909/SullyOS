// NotebookCard — 私密记事便签卡片（暮色 2026-07-17：手帐风小纸条视觉）
// 5 种 type 对应 5 种便签样式（暮色参考图）：
//   - thought 感想  → 蓝色便签 + 左上角蓝圆钉
//   - doodle  涂鸦  → 白色方格纸 + 右上角粉色折角
//   - search  搜索  → 牛皮纸 + 顶部黑色小钉
//   - lyric   歌词  → 粉色便签 + 顶部回形针
//   - gossip  八卦  → 黄色便签 + 顶部胶带
// 每张轻微旋转（-2°~+2°），拟物化

import React from 'react';
import { RoomNote } from '../../types';

const TYPE_LABELS: Record<RoomNote['type'], string> = {
    thought: '感想',
    doodle: '涂鸦',
    search: '搜索',
    lyric: '歌词',
    gossip: '八卦',
};

interface NotebookCardProps {
    note: RoomNote;
    onClick?: () => void;
    onDelete?: () => void;
    charName?: string;          // 列表里多角色时显示作者
    style?: React.CSSProperties; // 外部 override（如详情页全屏时不要旋转）
}

const NotebookCard: React.FC<NotebookCardProps> = ({ note, onClick, onDelete, charName, style }) => {
    const type = note.type || 'thought';

    // 不同 type 渲染不同的便签背景 + 装饰
    // 用 inline style 控色，方便统一风格
    const renderSticker = () => {
        switch (type) {
            case 'thought':
                // 蓝色便签 + 左上角蓝圆钉
                return (
                    <div className="relative h-44 p-4 pl-5">
                        {/* 蓝圆钉 */}
                        <div className="absolute top-2 left-2 w-5 h-5 rounded-full shadow-md"
                            style={{ background: 'radial-gradient(circle at 30% 30%, #60a5fa, #2563eb)', border: '2px solid #1e40af' }} />
                        <CardBody note={note} type={type} charName={charName} />
                    </div>
                );
            case 'doodle':
                // 白色方格纸 + 右上角粉色折角
                return (
                    <div className="relative h-44 p-4"
                        style={{
                            backgroundColor: '#ffffff',
                            backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)',
                            backgroundSize: '16px 16px',
                        }}>
                        {/* 粉色折角 */}
                        <div className="absolute top-0 right-0 w-0 h-0"
                            style={{
                                borderTop: '20px solid #fbcfe8',
                                borderLeft: '20px solid transparent',
                                filter: 'drop-shadow(-1px 1px 1px rgba(0,0,0,0.1))',
                            }} />
                        <CardBody note={note} type={type} charName={charName} />
                    </div>
                );
            case 'search':
                // 牛皮纸 + 顶部黑色小钉
                return (
                    <div className="relative h-44 p-4 pt-5"
                        style={{ backgroundColor: '#d4a574' }}>
                        {/* 黑色小钉 */}
                        <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                            style={{ background: 'radial-gradient(circle at 30% 30%, #4b5563, #111827)' }} />
                        <CardBody note={note} type={type} charName={charName} dark />
                    </div>
                );
            case 'lyric':
                // 粉色便签 + 顶部回形针
                return (
                    <div className="relative h-44 p-4 pt-6"
                        style={{ backgroundColor: '#fce7f3' }}>
                        {/* 回形针 */}
                        <div className="absolute top-1 left-1/2 -translate-x-1/2 w-3 h-6"
                            style={{
                                background: 'linear-gradient(180deg, transparent 0%, transparent 30%, #94a3b8 30%, #94a3b8 70%, transparent 70%)',
                                borderRadius: '4px',
                                border: '1.5px solid #64748b',
                                backgroundColor: 'transparent',
                            }} />
                        <CardBody note={note} type={type} charName={charName} />
                    </div>
                );
            case 'gossip':
                // 黄色便签 + 顶部胶带 + 横线
                return (
                    <div className="relative h-44 p-4 pt-5"
                        style={{
                            backgroundColor: '#fef3c7',
                            backgroundImage: 'repeating-linear-gradient(0deg, transparent 0px, transparent 27px, #fde68a 27px, #fde68a 28px)',
                        }}>
                        {/* 胶带 */}
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-12 h-3"
                            style={{ backgroundColor: 'rgba(255,255,255,0.6)', border: '1px solid rgba(0,0,0,0.05)' }} />
                        <CardBody note={note} type={type} charName={charName} />
                    </div>
                );
            default:
                return null;
        }
    };

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
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = `rotate(0deg) scale(1.02)`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = `rotate(${rotateDeg}deg)`; }}
        >
            {renderSticker()}
            {onDelete && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    title="删除"
                >
                    ×
                </button>
            )}
        </div>
    );
};

// 便签内部内容（type 徽章 + 时间 + 预览）
const CardBody: React.FC<{ note: RoomNote; type: RoomNote['type']; charName?: string; dark?: boolean }> = ({ note, type, charName, dark }) => {
    const isDark = !!dark;
    const replyCount = note.replies?.length || 0;
    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-1.5 text-[9px] font-bold">
                <span className={`px-1.5 py-0.5 rounded ${isDark ? 'bg-black/15 text-stone-100' : 'bg-white/70 text-slate-700'}`}>
                    {TYPE_LABELS[type]}
                </span>
                <span className={`${isDark ? 'text-stone-100' : 'text-slate-500'}`}>
                    {new Date(note.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                </span>
            </div>
            <div className={`flex-1 text-[11px] leading-relaxed line-clamp-4 overflow-hidden ${isDark ? 'text-stone-100' : 'text-slate-800'}`}>
                {note.content}
            </div>
            <div className={`flex items-center justify-between text-[9px] mt-1.5 ${isDark ? 'text-stone-100/80' : 'text-slate-500'}`}>
                {charName ? <span>— {charName}</span> : <span />}
                {replyCount > 0 && <span>💬 {replyCount}</span>}
            </div>
        </div>
    );
};

export default NotebookCard;
