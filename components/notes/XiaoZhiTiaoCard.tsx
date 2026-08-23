// XiaoZhiTiaoCard — 小纸条便签卡片（2026-07-22：跟 NotebookCard 完全独立）
// 暮色 2026-07-23：列表卡只显示 5 行字，日期/作者/回复数全删（暮色要纯净）
// 暮色原图直接显示（不加任何底/框/阴影）
// 保留轻微旋转 + hover 归正放大
// 暮色 2026-08-23 v3：
//   - 8 套 cjjc 便签 CSS（note.style）+ 用户上传图（note.styleImageUrl）并存；图优先
//   - revealedAt == null 时**不显示文字**（空白便签，暮色反馈"不要未拆封，空白就行"）
//   - 老数据兜底：!styleImageUrl && !note.style 时默认走 note-pink（暮色反馈"老纸条也用新样式"）
//   - 划线渲染：sanitizeNoteHtml + dangerouslySetInnerHTML（白名单 <s> 标签）

import React from 'react';
import { XiaoZhiTiao } from '../../types';
import { sanitizeNoteHtml, isOldXiaoZhiTiao, pickFallbackBuiltinStyle } from '../../utils/xiaoZhiTiaoStyles';
import './builtinNoteStyles.css';

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

    // 暮色 2026-08-23 v3：便签样式优先级
    //   1. styleImageUrl 存在且不是老便签 → 走图（用户上传图）
    //   2. style 存在 → 走 CSS（cjjc 8 套便签）
    //   3. 都没 → 按 note.id hash 从 8 套里选一套（老便签随机性 — 暮色 8-23 反馈"全一个样式"）
    // 暮色 8-23 反馈：老数据有 styleImageUrl 的也走新 CSS
    const isOld = isOldXiaoZhiTiao(note);
    const useImage = !!note.styleImageUrl && !isOld;
    const noteClassName = useImage ? '' : (note.style || pickFallbackBuiltinStyle(note.id));

    // 暮色 2026-08-23 v3：未看过（revealedAt == null）→ 空白
    // 暮色 8-23 反馈：老便签没 revealedAt 字段时当作"已看"（否则老便签全显示"未拆封"）
    const isRevealed = note.revealedAt != null || isOld;

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
                className={`relative w-full h-44 bg-no-repeat ${noteClassName}`}
                style={
                    useImage
                        // 透明底 PNG 直接显示，不加 backgroundColor
                        ? {
                            backgroundImage: `url(${note.styleImageUrl})`,
                            backgroundSize: 'contain',
                            backgroundPosition: 'center',
                            backgroundRepeat: 'no-repeat',
                        }
                        // 暮色 2026-08-23 v3：CSS 类名时由 builtinNoteStyles.css 决定；不强制 backgroundColor
                        : undefined
                }
            >
                {/* 文字：纯文字（无底无框），居中放在图中央留白区 */}
                {/* 暮色 2026-08-23 v3 反馈 1：未拆封态 = 空白（不显示任何东西） */}
                {/* 暮色 2026-08-23 反馈 6：字号 10px → 14px + 字体手写体（builtinNoteStyles.css） */}
                {isRevealed && (
                    <div className="absolute inset-0 flex items-center justify-center p-5">
                        <div className="max-w-[60%] text-center">
                            <div
                                className="text-[14px] leading-relaxed line-clamp-5 overflow-hidden text-slate-800"
                                dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(note.content) }}
                            />
                        </div>
                    </div>
                )}
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
