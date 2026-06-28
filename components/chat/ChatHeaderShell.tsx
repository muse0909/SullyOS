import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft } from '@phosphor-icons/react';
import ChatMusicPlayer from './ChatMusicPlayer';
import { ApiPreset, CharacterBuff, CharacterProfile } from '../../types';
import { getBuffColor } from '../../utils/buffColor';

interface TokenBreakdown {
    prompt: number;
    completion: number;
    total: number;
    msgCount: number;
    pass: string;
}

interface ChatHeaderShellProps {
    selectionMode: boolean;
    selectedCount: number;
    onCancelSelection: () => void;
    activeCharacter: CharacterProfile;
    isTyping: boolean;
    isSummarizing: boolean;
    isEmotionEvaluating?: boolean;
    isMemoryPalaceProcessing?: boolean;
    memoryPalaceStatusText?: string;
    lastTokenUsage: number | null;
    tokenBreakdown?: TokenBreakdown | null;
    onClose: () => void;
    onTriggerAI: () => void;
    apiPresets?: ApiPreset[];
    currentApiName?: string;
    onSwitchPreset?: (preset: any) => void;
    onShowCharsPanel: () => void;
    onDeleteBuff?: (buffId: string) => void;
    headerStyle?: 'default' | 'minimal' | 'gradient' | 'wechat' | 'telegram' | 'discord' | 'pixel';
    avatarShape?: 'circle' | 'rounded' | 'square';
    headerAlign?: 'left' | 'center';
    headerDensity?: 'compact' | 'default' | 'airy';
    statusStyle?: 'subtle' | 'pill' | 'dot';
    chromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
}

const getBuffLabel = (buff: CharacterBuff) => buff.label || buff.innerState || '';
const getBuffInnerState = (buff: CharacterBuff) => buff.innerState || buff.label || '';

/**
 * 按 buff.label 哈希到马卡龙色盘算基础色，intensity 调背景明度：
 *   1 → 卡片背景淡（透明度 60%），2 → 中（80%），3 → 浓（100% 满色）
 * 文字色固定深灰（slate-800），不依赖 buff color——这样时间戳/正文/按钮字
 * 在淡色卡片上都能看清。边框用满色 buff color。
 */
const getBuffStyle = (buff: CharacterBuff) => {
    const color = getBuffColor(buff);
    const intensity = buff.intensity === 2 || buff.intensity === 3 ? buff.intensity : 1;
    const bgAlpha = intensity === 3 ? 'FF' : intensity === 2 ? 'D0' : 'A0';
    return {
        bg: `${color}${bgAlpha}`,
        border: color,
        text: '#1e293b',  // slate-800
    };
};

const formatEmotionTime = (timestamp?: number) => {
    if (!timestamp) return '旧记录';
    const date = new Date(timestamp);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const ChatHeaderShell: React.FC<ChatHeaderShellProps> = ({
    selectionMode,
    selectedCount,
    onCancelSelection,
    activeCharacter,
    isEmotionEvaluating,
    isMemoryPalaceProcessing,
    memoryPalaceStatusText,
    lastTokenUsage,
    tokenBreakdown,
    onClose,
    onTriggerAI,
    apiPresets = [],
    currentApiName = '',
    onSwitchPreset,
    onShowCharsPanel,
    onDeleteBuff,
    headerStyle = 'default',
    avatarShape = 'circle',
    headerAlign = 'left',
    headerDensity = 'default',
    statusStyle = 'subtle',
    chromeStyle = 'soft',
}) => {
    const buffs: CharacterBuff[] = activeCharacter.activeBuffs || [];
    const emotionHistory: CharacterBuff[] = activeCharacter.emotionHistory || buffs;
    const latestBuff = buffs[0] || emotionHistory[0] || null;
    const [isBuffListExpanded, setIsBuffListExpanded] = useState(false);
    const [confirmDeleteBuff, setConfirmDeleteBuff] = useState<CharacterBuff | null>(null);
    const buffPanelRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleLongPressStart = (buff: CharacterBuff) => {
        longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            setConfirmDeleteBuff(buff);
        }, 600);
    };

    const handleLongPressEnd = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const handleConfirmDelete = () => {
        if (confirmDeleteBuff && onDeleteBuff) {
            onDeleteBuff(confirmDeleteBuff.id);
        }
        setConfirmDeleteBuff(null);
    };

    const handleDeleteFromHistory = (buff: CharacterBuff) => {
        if (onDeleteBuff) onDeleteBuff(buff.id);
    };

    useEffect(() => {
        if (!isBuffListExpanded) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            const clickedInsideBuffPanel = !!buffPanelRef.current?.contains(target);
            if (!clickedInsideBuffPanel) {
                setIsBuffListExpanded(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isBuffListExpanded]);

    useEffect(() => {
        setIsBuffListExpanded(false);
    }, [activeCharacter.id, latestBuff?.id]);

    const isDarkHeader = headerStyle === 'discord';
    const isPixelHeader = headerStyle === 'pixel';
    const useCenteredLayout = headerAlign === 'center' || headerStyle === 'telegram' || headerStyle === 'minimal';
    const avatarRadiusClass = avatarShape === 'square' ? 'rounded-sm' : avatarShape === 'rounded' ? 'rounded-xl' : 'rounded-full';

    const headerToneClass =
        headerStyle === 'gradient'
            ? 'bg-gradient-to-r from-primary/20 via-primary/10 to-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm'
            : headerStyle === 'minimal'
              ? 'bg-white/95 backdrop-blur-md border-b border-slate-200/50 shadow-sm'
              : headerStyle === 'wechat'
                ? 'bg-[#f7f7f7]/95 backdrop-blur-md border-b border-black/5 shadow-none'
                : headerStyle === 'telegram'
                  ? 'bg-white/85 backdrop-blur-xl border-b border-sky-100 shadow-sm'
                  : headerStyle === 'discord'
                    ? 'bg-slate-900/95 backdrop-blur-xl border-b border-white/10 shadow-[0_10px_30px_rgba(15,23,42,0.35)]'
                    : headerStyle === 'pixel'
                      ? 'bg-[#c99872] border-b-[3px] border-[#7b5a40] shadow-[0_4px_0_rgba(123,90,64,0.25)]'
                      : chromeStyle === 'flat'
                        ? 'bg-white border-b border-slate-200 shadow-none'
                        : chromeStyle === 'floating'
                          ? 'bg-white/85 backdrop-blur-xl border-b border-white/70 shadow-sm'
                          : 'bg-white/80 backdrop-blur-xl border-b border-slate-200/60 shadow-sm';
    const headerDensityClass = headerDensity === 'compact' ? 'h-16 px-4' : headerDensity === 'airy' ? 'h-24 px-6 pb-5' : 'h-[72px] px-3';
    const primaryTextClass = isDarkHeader ? 'text-white' : isPixelHeader ? 'text-[#fff7ed]' : 'text-slate-800';
    const secondaryTextClass = isDarkHeader ? 'text-slate-400' : isPixelHeader ? 'text-[#f3ddc7]' : 'text-slate-400';
    const iconButtonClass = isDarkHeader
        ? 'text-slate-200 hover:bg-white/10 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] hover:bg-[#f8f0e0]/20 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-slate-500 hover:bg-slate-100 rounded-full';
    const actionButtonClass = isDarkHeader
        ? 'text-sky-300 hover:bg-sky-400/10 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] hover:bg-[#f8f0e0]/20 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-indigo-500 hover:bg-indigo-50 rounded-full';

    const onlineStatusNode = headerStyle === 'telegram'
        ? null
        : statusStyle === 'pill' ? (
            <div className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${isDarkHeader ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/25' : 'bg-emerald-50 text-emerald-500 border-emerald-100'}`}>
                online
            </div>
        ) : statusStyle === 'dot' ? (
            <div className={`flex items-center gap-1 text-[10px] ${secondaryTextClass}`}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Online</span>
            </div>
        ) : (
            <div className={`text-[10px] uppercase ${secondaryTextClass}`}>Online</div>
        );

    const renderBuffRow = (centered: boolean) => {
        if (!latestBuff) return null;
        const label = getBuffLabel(latestBuff);
        const innerState = getBuffInnerState(latestBuff);
        const style = getBuffStyle(latestBuff);
        return (
            <div className={`relative w-full min-w-0 max-w-full ${centered ? 'flex justify-center' : ''}`}>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsBuffListExpanded((prev) => !prev); }}
                    onTouchStart={(e) => { e.stopPropagation(); handleLongPressStart(latestBuff); }}
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                    onMouseDown={(e) => { if (e.button === 0) handleLongPressStart(latestBuff); }}
                    onMouseUp={handleLongPressEnd}
                    onMouseLeave={handleLongPressEnd}
                    className="shrink-0 max-w-full truncate text-[10px] leading-none px-2.5 py-1 rounded-full font-bold border cursor-pointer transition-colors select-none shadow-[0_1px_4px_rgba(120,80,90,0.12)]"
                    style={{ color: style.text, borderColor: style.border, background: style.bg }}
                    title={innerState}
                >
                    {latestBuff.emoji ? `${latestBuff.emoji} ` : ''}
                    {label}
                </button>
            </div>
        );
    };

    const floatingStatusNodes = (lastTokenUsage || isEmotionEvaluating || isMemoryPalaceProcessing) ? (
        <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
            {lastTokenUsage && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono border ${isDarkHeader ? 'bg-slate-800 text-slate-300 border-white/10' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-slate-100/95 text-slate-400 border-slate-200'}`}>
                    {lastTokenUsage}
                </div>
            )}
            {isEmotionEvaluating && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-violet-500/15 text-violet-200 border-violet-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-violet-50/95 text-violet-500 border-violet-200'}`}>
                    情绪分析中
                </div>
            )}
            {isMemoryPalaceProcessing && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border animate-pulse ${isDarkHeader ? 'bg-indigo-500/15 text-indigo-200 border-indigo-400/20' : isPixelHeader ? 'bg-[#f5f3ff] text-[#4338ca] border-[#4338ca]/20' : 'bg-indigo-50/95 text-indigo-600 border-indigo-200'}`}>
                    {memoryPalaceStatusText || '记忆整理中'}
                </div>
            )}
        </div>
    ) : null;

                const renderCenteredInfo = () => (
        <div className="flex items-center gap-3 w-full min-w-0">
            <img src={activeCharacter.avatar} className={`w-11 h-11 object-cover shadow-sm ${avatarRadiusClass}`} alt="avatar" />
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`font-semibold text-sm truncate ${primaryTextClass}`}>{activeCharacter.name}</div>
                    {onlineStatusNode}
                    {lastTokenUsage ? (
                        <span 
                            className={`text-[11px] font-mono ${secondaryTextClass} opacity-85 ml-1 truncate`}
                            title={tokenBreakdown ? `prompt: ${tokenBreakdown.prompt} | completion: ${tokenBreakdown.completion}` : ''}
                        >
                             {lastTokenUsage}
                        </span>
                    ) : null}
                </div>
                <div className="mt-1 min-h-[16px] flex items-center gap-1.5 text-xs truncate">
                    {latestBuff ? (
                        <div className="flex items-center gap-0.5 min-w-0 flex-1">
                            {renderBuffRow(false)}
                        </div>
                    ) : null}
                    {isEmotionEvaluating && (
                        <div className={`inline-block shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap border animate-pulse ${isDarkHeader ? 'bg-violet-500/15 text-violet-200 border-violet-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-violet-50/95 text-violet-500 border-violet-200'}`}>
                            情绪分析中
                        </div>
                    )}
                    {isMemoryPalaceProcessing && !isEmotionEvaluating && (
                        <div className={`inline-block shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap border animate-pulse ${isDarkHeader ? 'bg-indigo-500/15 text-indigo-200 border-indigo-400/20' : isPixelHeader ? 'bg-[#f5f3ff] text-[#4338ca] border-[#4338ca]/20' : 'bg-indigo-50/95 text-indigo-600 border-indigo-200'}`}>
                            {memoryPalaceStatusText || '记忆整理中'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    const renderStandardInfo = () => (
        <>
            <img src={activeCharacter.avatar} className={`w-11 h-11 object-cover shadow-sm ${avatarRadiusClass}`} alt="avatar" />
            <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={`font-semibold text-sm truncate ${primaryTextClass}`}>{activeCharacter.name}</div>
                    {onlineStatusNode}
                    {lastTokenUsage ? (
                        <span 
                            className={`text-[11px] font-mono ${secondaryTextClass} opacity-85 ml-1 truncate`}
                            title={tokenBreakdown ? `prompt: ${tokenBreakdown.prompt} | completion: ${tokenBreakdown.completion}` : ''}
                        >
                             {lastTokenUsage}
                        </span>
                    ) : null}
                </div>
                <div className="mt-1 min-h-[16px] flex items-center gap-1.5 text-xs truncate">
                    {latestBuff ? (
                        <div className="flex items-center gap-0.5 min-w-0 flex-1">
                            {renderBuffRow(false)}
                        </div>
                    ) : null}
                    {isEmotionEvaluating && (
                        <div className={`inline-block shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap border animate-pulse ${isDarkHeader ? 'bg-violet-500/15 text-violet-200 border-violet-400/20' : isPixelHeader ? 'bg-[#fff7ed] text-[#8f674a] border-[#8f674a]/20' : 'bg-violet-50/95 text-violet-500 border-violet-200'}`}>
                            情绪分析中
                        </div>
                    )}
                    {isMemoryPalaceProcessing && !isEmotionEvaluating && (
                        <div className={`inline-block shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold whitespace-nowrap border animate-pulse ${isDarkHeader ? 'bg-indigo-500/15 text-indigo-200 border-indigo-400/20' : isPixelHeader ? 'bg-[#f5f3ff] text-[#4338ca] border-[#4338ca]/20' : 'bg-indigo-50/95 text-indigo-600 border-indigo-200'}`}>
                            {memoryPalaceStatusText || '记忆整理中'}
                        </div>
                    )}
                </div>
            </div>
        </>
    );



    return (
        <div className={`${headerDensityClass} flex items-center shrink-0 z-30 sticky top-0 relative ${headerToneClass}`}>
            {selectionMode ? (
                <div className="flex items-center justify-between w-full">
                    <button onClick={onCancelSelection} className={`text-sm font-bold px-2 py-1 ${secondaryTextClass}`}>取消</button>
                    <span className={`text-sm font-bold ${primaryTextClass}`}>已选 {selectedCount} 项</span>
                    <div className="w-10" />
                </div>
            ) : useCenteredLayout ? (
                <div className="relative w-full flex items-center justify-center">
                    <button onClick={onClose} className={`absolute left-3 top-1/2 -translate-y-1/2 p-2 ${iconButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    <div
                        onClick={onShowCharsPanel}
                        className="flex w-[calc(100%-7rem)] max-w-[420px] cursor-pointer items-center justify-center"
                    >
                        {renderCenteredInfo()}
                    </div>

                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <ChatMusicPlayer />
                        <div>
                            
                            
                        </div>
                    </div>

                </div>
            ) : (
                <div className="flex items-center gap-3 w-full">
                    <button onClick={onClose} className={`p-2 -ml-2 ${iconButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    <div onClick={onShowCharsPanel} className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer">
                        {renderStandardInfo()}
                    </div>

                    <div className="relative ml-auto flex items-center gap-2">
                        <ChatMusicPlayer />
                        
                    </div>

                </div>
            )}

            {isBuffListExpanded && emotionHistory.length > 0 && (
                <div className="fixed inset-0 z-[100] bg-slate-900/45 backdrop-blur-[1px]" onClick={() => setIsBuffListExpanded(false)}>
                    <div
                        ref={buffPanelRef}
                        className="absolute left-1/2 top-1/2 w-[min(94vw,460px)] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/40 bg-white/95 p-4 shadow-2xl shadow-slate-900/25 flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 顶部居中标题：角色名·心声 */}
                        <div className="mb-3 text-center">
                            <div className="text-base font-bold text-slate-800">{activeCharacter.name}·心声</div>
                        </div>

                        {/* 心声列表：卡片间距加大，整体缩小 */}
                        <div className="flex-1 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="space-y-4">
                                {emotionHistory.map((buff) => {
                                    const style = getBuffStyle(buff);
                                    return (
                                        <div
                                            key={`panel-${buff.id}`}
                                            className="rounded-xl border p-2.5 shadow-sm select-none"
                                            style={{ borderColor: style.border, background: style.bg, color: style.text }}
                                        >
                                            {/* 第一行：日期 + 删除 */}
                                            <div className="mb-1.5 flex items-center justify-between gap-3">
                                                <div className="text-[10px] font-bold text-slate-600">{formatEmotionTime(buff.createdAt)}</div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteFromHistory(buff); }}
                                                    className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-bold shadow-sm transition-transform active:scale-95 text-slate-700"
                                                    style={{ border: `1px solid ${style.border}` }}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                            {/* 日期下分割线 */}
                                            <div className="mb-1.5 h-px bg-slate-300/50" />
                                            {/* chip + 正文 */}
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); }}
                                                className="mb-1.5 inline-flex max-w-full items-center rounded-full border bg-white/55 px-2 py-0.5 text-[10px] font-bold leading-none"
                                                style={{ borderColor: style.border, color: style.text }}
                                                title={getBuffInnerState(buff)}
                                            >
                                                <span className="truncate">
                                                    {buff.emoji ? `${buff.emoji} ` : ''}
                                                    {getBuffLabel(buff)}
                                                </span>
                                            </button>
                                            <div className="text-[11px] leading-relaxed font-medium text-slate-800">
                                                {getBuffInnerState(buff)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteBuff && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-[1px] z-[100]" onClick={() => setConfirmDeleteBuff(null)}>
                    <div className="absolute left-1/2 top-1/2 w-[min(88vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/40 bg-white/95 p-5 shadow-2xl shadow-slate-900/25" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center mb-4">
                            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-100 to-red-100 text-xl shadow-inner">
                                {confirmDeleteBuff.emoji || '🗑'}
                            </div>
                            <div className="font-bold text-slate-800 text-sm">删除心声</div>
                            <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                                确定要删除“{getBuffLabel(confirmDeleteBuff)}”吗？
                                <br />
                                对应的提示也会一起移除。
                            </div>
                        </div>
                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setConfirmDeleteBuff(null)}
                                className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                className="flex-1 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-rose-500 to-red-500 rounded-2xl hover:from-rose-600 hover:to-red-600 shadow-lg shadow-red-200/80 transition-all"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

export default ChatHeaderShell;
