/**
 * 剧情模式状态栏 — 暮色 8-25 第四步+第二批
 *
 * 暮色 8-25 第四步:
 *   - 两层(表层/底层)都默认折叠,只显示小图标
 *   - 点开 → 两层一起展示
 *
 * 暮色 8-25 第二批:
 *   - 加状态变量展示(暮色自定义追踪的变量,LLM 回复 [状态] 行解析后)
 *   - 在表层/底层卡片下方,绿色淡绿背景
 *   - 没有 variables → 不显示这块
 */

import React, { useState } from 'react';
import { Sparkle, MaskHappy, MaskSad, CaretDown, Sliders } from '@phosphor-icons/react';
import type { StoryStatusSnapshot } from '../../../types';

interface Props {
    status: StoryStatusSnapshot | null;
    charName: string;
}

const StoryStatusPanel: React.FC<Props> = ({ status, charName }) => {
    const [expanded, setExpanded] = useState(false);

    // 没 status → 不显示(LLM fallback 时正常)
    if (!status) return null;

    // 暮色 8-25 第二批:状态变量(可选,有就显示)
    const hasVariables = status.variables && Object.keys(status.variables).length > 0;

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

                    {/* 暮色 8-25 第二批:状态变量(暮色自定义追踪)— 在表层/底层卡片下方 */}
                    {hasVariables && (
                        <div
                            className="px-2.5 py-1.5 rounded-xl text-[10px] leading-relaxed"
                            style={{
                                background: 'linear-gradient(135deg,rgba(34,197,94,0.08),rgba(16,185,129,0.05))',
                                border: '1px solid rgba(34,197,94,0.25)',
                                color: '#064e3b',
                            }}
                        >
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <Sliders size={11} weight="fill" style={{ color: '#10b981' }} />
                                <span className="font-bold tracking-wider" style={{ color: '#047857' }}>状态</span>
                            </div>
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                {Object.entries(status.variables!).map(([name, value]) => (
                                    <span key={name}>
                                        <span style={{ color: 'rgba(16,185,129,0.7)' }}>{name}</span>{' '}
                                        <span className="font-bold" style={{ color: '#064e3b' }}>{value}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default StoryStatusPanel;
