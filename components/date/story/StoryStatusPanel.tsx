/**
 * 剧情模式状态栏 — 暮色 8-25 第四步
 *
 * 暮色 8-25:
 *   - 两层(表层/底层)都默认折叠,只显示小图标
 *   - 点开一次,两层一起展示(不分两次点)
 *   - 不展开时仅一行,避免长对话时视觉碎、重
 *
 * Props: status 可以是 null(LLM 没按格式输出时,UI 不显示)
 */

import React, { useState } from 'react';
import { Sparkle, MaskHappy, MaskSad, CaretDown } from '@phosphor-icons/react';
import type { StoryStatusSnapshot } from '../../../types';

interface Props {
    status: StoryStatusSnapshot | null;
    charName: string;
}

const StoryStatusPanel: React.FC<Props> = ({ status, charName }) => {
    const [expanded, setExpanded] = useState(false);

    // 没 status → 不显示(LLM fallback 时正常)
    if (!status) return null;

    return (
        <div className="mt-1.5 select-none">
            <button
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                className="flex items-center gap-1 text-[10px] tracking-wider font-bold active:scale-95 transition-all"
                style={{ color: 'rgba(124,58,237,0.7)' }}
            >
                <Sparkle size={10} weight="fill" />
                <span>{charName}的状态</span>
                <CaretDown
                    size={9} weight="bold"
                    style={{
                        transition: 'transform 200ms',
                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                />
            </button>

            {expanded && (
                <div className="mt-1.5 space-y-1 animate-fade-in" onClick={e => e.stopPropagation()}>
                    {/* 表层 — 紫色淡紫背景 */}
                    <div
                        className="px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                        style={{
                            background: 'linear-gradient(135deg,rgba(167,139,250,0.15),rgba(124,58,237,0.08))',
                            border: '1px solid rgba(167,139,250,0.25)',
                            color: '#4a3a6a',
                        }}
                    >
                        <div className="flex items-center gap-1.5 mb-0.5">
                            <MaskHappy size={11} weight="fill" style={{ color: '#7c3aed' }} />
                            <span className="font-bold tracking-wider" style={{ color: '#715d99' }}>表层</span>
                        </div>
                        <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>情绪:</span> {status.surface.emotion}</div>
                        <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>动作:</span> {status.surface.action}</div>
                    </div>

                    {/* 底层 — 灰色淡灰背景 */}
                    <div
                        className="px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                        style={{
                            background: 'rgba(100,100,120,0.08)',
                            border: '1px solid rgba(100,100,120,0.18)',
                            color: '#3a3a4a',
                        }}
                    >
                        <div className="flex items-center gap-1.5 mb-0.5">
                            <MaskSad size={11} weight="fill" style={{ color: '#64748b' }} />
                            <span className="font-bold tracking-wider" style={{ color: '#475569' }}>底层</span>
                        </div>
                        <div><span style={{ color: 'rgba(100,100,120,0.7)' }}>真实情绪:</span> {status.deep.realEmotion}</div>
                        <div><span style={{ color: 'rgba(100,100,120,0.7)' }}>在想:</span> {status.deep.thought}</div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoryStatusPanel;
