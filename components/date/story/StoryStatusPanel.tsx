/**
 * 剧情模式状态栏 + 皮下 — 暮色 9-21 第四轮重做
 *
 * 暮色 9-21 第四轮:
 *   - 状态栏 + 皮下都放进气泡内(不再气泡外单独放)
 *   - 两块都是浅紫色框(跟之前"表层"那种样式)
 *   - 默认折叠(点开才展开)
 *   - 状态栏 5 维度:时间 / 地点 / 衣着 / 关系 / 事件
 *
 * 暮色 8-25 第二批:
 *   - 自定义状态变量(有就显示,在状态栏下方)
 *
 * 老格式(surface/deep)保留兼容
 */

import React, { useState } from 'react';
import { CaretDown, Clock, MapPin, TShirt, Heart, Article, MaskHappy, Sparkle } from '@phosphor-icons/react';
import type { StoryStatusSnapshot } from '../../../types';

interface Props {
    status: StoryStatusSnapshot | null;
    charName: string;
}

const StoryStatusPanel: React.FC<Props> = ({ status, charName }) => {
    const [barExpanded, setBarExpanded] = useState(false);
    const [subExpanded, setSubExpanded] = useState(false);

    // 没 status → 不显示
    if (!status) return null;

    const hasStatusBar = !!status.statusBar;
    const hasSubOs = !!status.subOs;
    const hasVariables = status.variables && Object.keys(status.variables).length > 0;
    const hasLegacy = !!(status.surface && status.deep);

    // 全部为空 → 不显示
    if (!hasStatusBar && !hasSubOs && !hasVariables && !hasLegacy) return null;

    return (
        <div className="mt-1.5 select-none space-y-1">
            {/* === 状态栏卡片(浅紫色框,默认折叠)== = */}
            {(hasStatusBar || hasLegacy) && (
                <div className="rounded-xl overflow-hidden"
                     style={{
                         background: 'linear-gradient(135deg,rgba(167,139,250,0.15),rgba(124,58,237,0.08))',
                         border: '1px solid rgba(167,139,250,0.3)',
                     }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setBarExpanded(v => !v); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 active:scale-[0.99] transition-all"
                    >
                        <Sparkle size={10} weight="fill" style={{ color: '#7c3aed' }} />
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>状态栏</span>
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
                        <div className="px-2.5 pb-2 pt-0.5 text-[10px] leading-relaxed space-y-1 animate-fade-in"
                             onClick={e => e.stopPropagation()}>
                            {hasStatusBar ? (
                                <>
                                    <StatusBarRow icon={<Clock size={11} weight="fill" />} label="时间" value={status.statusBar!.time} />
                                    <StatusBarRow icon={<MapPin size={11} weight="fill" />} label="地点" value={status.statusBar!.location} />
                                    <StatusBarRow icon={<TShirt size={11} weight="fill" />} label="衣着" value={status.statusBar!.clothing} />
                                    <StatusBarRow icon={<Heart size={11} weight="fill" />} label="关系" value={status.statusBar!.relation} />
                                    <StatusBarRow icon={<Article size={11} weight="fill" />} label="事件" value={status.statusBar!.event} />
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
                                <div className="pt-1 mt-1 border-t" style={{ borderColor: 'rgba(167,139,250,0.2)' }}>
                                    {Object.entries(status.variables!).map(([k, v]) => (
                                        <div key={k}><span style={{ color: 'rgba(150,120,190,0.7)' }}>{k}:</span> {v}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* === 皮下卡片(浅紫色框,默认折叠)== = */}
            {hasSubOs && (
                <div className="rounded-xl overflow-hidden"
                     style={{
                         background: 'rgba(167,139,250,0.08)',
                         border: '1px solid rgba(167,139,250,0.25)',
                     }}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setSubExpanded(v => !v); }}
                        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 active:scale-[0.99] transition-all"
                    >
                        <MaskHappy size={10} weight="fill" style={{ color: '#7c3aed' }} />
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>皮下</span>
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
                        <div className="px-2.5 pb-2 pt-0.5 text-[10px] leading-relaxed animate-fade-in"
                             style={{ color: '#3a3a4a' }}
                             onClick={e => e.stopPropagation()}>
                            {status.subOs}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/* 暮色 9-21 第三轮:状态栏一行(图标 + 字段名 + 值) */
const StatusBarRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
    <div className="flex items-start gap-1.5">
        <span className="mt-0.5 flex-shrink-0" style={{ color: '#7c3aed' }}>{icon}</span>
        <span className="flex-shrink-0 font-bold" style={{ color: '#715d99' }}>{label}:</span>
        <span className="flex-1">{value || <span style={{ color: 'rgba(150,120,190,0.5)' }}>（空）</span>}</span>
    </div>
);

export default StoryStatusPanel;
