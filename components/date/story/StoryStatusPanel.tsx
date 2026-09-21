/**
 * 剧情模式状态栏 + 皮下 — 暮色 9-21 第四轮终极版
 *
 * 暮色 9-21 第四轮:
 *   - 状态栏 + 皮下 都放进同一个气泡里
 *   - 两个都用外层浅紫色框(一个外框,内部分两个折叠区)
 *   - 跟图二「江澈的状态」那种样式一样:一个紫色外框 + 两个独立折叠卡片
 *   - 默认折叠
 *   - 状态栏 5 维度:时间 / 地点 / 衣着 / 关系 / 事件
 *
 * 老格式(surface/deep)保留兼容
 */

import React, { useState } from 'react';
import { CaretDown, Clock, MapPin, TShirt, Heart, Article, MaskHappy } from '@phosphor-icons/react';
import type { StoryStatusSnapshot } from '../../../types';

interface Props {
    status: StoryStatusSnapshot | null;
    charName: string;
}

const StoryStatusPanel: React.FC<Props> = ({ status }) => {
    const [barExpanded, setBarExpanded] = useState(false);
    const [subExpanded, setSubExpanded] = useState(false);

    // 没 status → 不显示
    if (!status) return null;

    const hasStatusBar = !!status.statusBar;
    const hasSubOs = !!status.subOs;
    const hasLegacy = !!(status.surface && status.deep);
    const hasVariables = status.variables && Object.keys(status.variables).length > 0;

    // 都没 → 不显示
    if (!hasStatusBar && !hasSubOs && !hasVariables && !hasLegacy) return null;

    // 暮色 9-21 第四轮终极版:整个外层一个紫色框,内部分两个独立折叠区
    //   - 状态栏折叠按钮 + 状态栏展开内容
    //   - 皮下折叠按钮 + 皮下展开内容
    //   - 两个都包在同一个 div 里
    return (
        <div
            className="mt-1.5 rounded-xl overflow-hidden"
            style={{
                background: 'rgba(167,139,250,0.1)',
                border: '1px solid rgba(167,139,250,0.3)',
            }}
        >
            {/* === 状态栏折叠区 === */}
            {(hasStatusBar || hasLegacy) && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); setBarExpanded(v => !v); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 active:scale-[0.99] transition-all"
                    >
                        <Clock size={11} weight="fill" style={{ color: '#7c3aed' }} />
                        <span className="text-[10px] font-bold tracking-wider flex-1 text-left" style={{ color: '#715d99' }}>状态栏</span>
                        <CaretDown
                            size={9} weight="bold"
                            style={{
                                color: 'rgba(150,120,190,0.7)',
                                transition: 'transform 200ms',
                                transform: barExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            }}
                        />
                    </button>
                    {barExpanded && (
                        <div className="px-2.5 pb-2 pt-0.5 text-[10px] leading-relaxed space-y-1 animate-fade-in border-t"
                             style={{ borderColor: 'rgba(167,139,250,0.2)' }}
                             onClick={e => e.stopPropagation()}>
                            {hasStatusBar ? (
                                <>
                                    <StatusBarRow label="时间" value={status.statusBar!.time} />
                                    <StatusBarRow label="地点" value={status.statusBar!.location} />
                                    <StatusBarRow label="衣着" value={status.statusBar!.clothing} />
                                    <StatusBarRow label="关系" value={status.statusBar!.relation} />
                                    <StatusBarRow label="事件" value={status.statusBar!.event} />
                                </>
                            ) : hasLegacy && status.surface && status.deep ? (
                                <>
                                    <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>情绪:</span> {status.surface.emotion}</div>
                                    <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>动作:</span> {status.surface.action}</div>
                                    <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>真实情绪:</span> {status.deep.realEmotion}</div>
                                    <div><span style={{ color: 'rgba(150,120,190,0.7)' }}>在想:</span> {status.deep.thought}</div>
                                </>
                            ) : null}
                            {/* 暮色 8-25 第二批:自定义状态变量 */}
                            {hasVariables && (
                                <div className="pt-1 mt-1 border-t" style={{ borderColor: 'rgba(167,139,250,0.15)' }}>
                                    {Object.entries(status.variables!).map(([k, v]) => (
                                        <div key={k}><span style={{ color: 'rgba(150,120,190,0.7)' }}>{k}:</span> {v}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* === 状态栏和皮下之间的分隔线 === */}
            {(hasStatusBar || hasLegacy) && hasSubOs && (
                <div className="h-px" style={{ background: 'rgba(167,139,250,0.2)' }} />
            )}

            {/* === 皮下折叠区 === */}
            {hasSubOs && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); setSubExpanded(v => !v); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 active:scale-[0.99] transition-all"
                    >
                        <MaskHappy size={11} weight="fill" style={{ color: '#7c3aed' }} />
                        <span className="text-[10px] font-bold tracking-wider flex-1 text-left" style={{ color: '#715d99' }}>皮下</span>
                        <CaretDown
                            size={9} weight="bold"
                            style={{
                                color: 'rgba(150,120,190,0.7)',
                                transition: 'transform 200ms',
                                transform: subExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                            }}
                        />
                    </button>
                    {subExpanded && (
                        <div className="px-2.5 pb-2 pt-0.5 text-[10px] leading-relaxed animate-fade-in border-t"
                             style={{ borderColor: 'rgba(167,139,250,0.2)', color: '#4a3a6a' }}
                             onClick={e => e.stopPropagation()}>
                            {status.subOs}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

/* 状态栏一行(暮色 9-21 第四轮:简化图标,字段名加粗 + 值) */
const StatusBarRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex items-start gap-1.5">
        <span className="flex-shrink-0 font-bold" style={{ color: '#715d99' }}>{label}:</span>
        <span className="flex-1">{value || <span style={{ color: 'rgba(150,120,190,0.5)' }}>（空）</span>}</span>
    </div>
);

export default StoryStatusPanel;
