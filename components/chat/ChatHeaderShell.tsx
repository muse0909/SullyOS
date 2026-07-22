import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, GearSix, Star } from '@phosphor-icons/react';
import ChatMusicPlayer from './ChatMusicPlayer';
import { ApiPreset, CharacterBuff, CharacterProfile } from '../../types';
import { getBuffColor, darkenHex, lightenHex } from '../../utils/buffColor';

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
    onOpenChatSettings?: () => void;
    // 暮色 2026-07-12：右上角星星按钮 → 触发回 WeChat 联系人列表 + 切到发现 tab
    onOpenDiscover?: () => void;
    headerStyle?: 'default' | 'minimal' | 'gradient' | 'wechat' | 'telegram' | 'discord' | 'pixel';
    avatarShape?: 'circle' | 'rounded' | 'square';
    headerAlign?: 'left' | 'center';
    headerDensity?: 'compact' | 'default' | 'airy';
    statusStyle?: 'subtle' | 'pill' | 'dot' | 'none';
    chromeStyle?: 'soft' | 'flat' | 'floating' | 'pixel';
}

const getBuffLabel = (buff: CharacterBuff) => buff.label || buff.innerState || '';
const getBuffInnerState = (buff: CharacterBuff) => buff.innerState || buff.label || '';

/**
 * 按 buff.label 哈希到马卡龙色盘，再用 HSL 算法算三档"清透"配色：
 *   - bg     = lightenHex(color, 0.5)  → 接近 bg-amber-50 的极浅奶油底
 *   - border = darkenHex(color, 0.12)  → 接近 border-amber-200 的柔和边框（注意是 darken 不是 lighten，
 *                                            因为 buff color 起点 L≈0.88，再 lighten 会封顶变白看不见）
 *   - text   = darkenHex(color, 0.45)  → 接近 text-amber-700 的深色字
 *
 * 参考 SullyOS 现有「请选择日程风格」框那套 bg-X-50/border-X-200/text-X-700 三档，
 * 整张心声卡片不再"灰突突"，而是跟日程框一致的奶油感。
 *
 * intensity 不再影响底色透明度（底色已经够浅），改用 chip 右侧的 ●●○ 三个小圆点视觉表示。
 */
const getBuffStyle = (buff: CharacterBuff) => {
    const color = getBuffColor(buff);
    return {
        bg: lightenHex(color, 0.5),
        border: darkenHex(color, 0.12),
        text: darkenHex(color, 0.45),
    };
};

/**
 * intensity → 视觉小圆点（●●○），跟 ChatHeader.tsx 的 INTENSITY_DOTS 同款
 * 放 chip 右侧外面，作为元数据展示
 */
const INTENSITY_DOTS = (n: number | undefined | null): string => {
    const safe = n === 2 || n === 3 ? n : 1;
    return '●'.repeat(safe) + '○'.repeat(3 - safe);
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
    onOpenChatSettings,
    onOpenDiscover,
    headerStyle = 'default',
    avatarShape = 'circle',
    headerAlign = 'left',
    headerDensity = 'default',
    statusStyle = 'subtle',
    chromeStyle = 'soft',
}) => {
    const buffs: CharacterBuff[] = activeCharacter.activeBuffs || [];
    const emotionHistory: CharacterBuff[] = activeCharacter.emotionHistory || buffs;
    // 心声独立开关：emotionEnabled 显式 false 时不显示 buff（包括不 fallback 到 emotionHistory[0]）
    // 老数据 emotionEnabled === undefined 默认按"开"处理（保持现有行为）
    const emotionEnabled = activeCharacter.emotionEnabled !== false;
    const latestBuff = emotionEnabled ? (buffs[0] || emotionHistory[0] || null) : null;
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
    // onClose 单独：无 hover 底色（暮色偏好 — 不要白圈）
    const onCloseButtonClass = isDarkHeader
        ? 'text-slate-200 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-slate-500 rounded-full';
    const actionButtonClass = isDarkHeader
        ? 'text-sky-300 hover:bg-sky-400/10 rounded-full'
        : isPixelHeader
          ? 'text-[#fff7ed] hover:bg-[#f8f0e0]/20 rounded-[4px] border-2 border-[#8f674a] bg-[#f8f0e0]/10'
          : 'text-indigo-500 hover:bg-indigo-50 rounded-full';

    const onlineStatusNode = (headerStyle === 'telegram' || statusStyle === 'none')
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
                    <button onClick={onClose} className={`absolute left-3 top-1/2 -translate-y-1/2 p-2 ${onCloseButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    <div
                        onClick={onShowCharsPanel}
                        className="flex w-[calc(100%-7rem)] max-w-[420px] cursor-pointer items-center justify-center"
                    >
                        {renderCenteredInfo()}
                    </div>

                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <ChatMusicPlayer />
                        {onOpenDiscover && (
                            <button
                                onClick={onOpenDiscover}
                                className={`p-2 ${iconButtonClass}`}
                                title="发现页"
                                aria-label="发现页"
                            >
                                <Star className="w-5 h-5" weight="bold" />
                            </button>
                        )}
                        {onOpenChatSettings && (
                            <button
                                onClick={onOpenChatSettings}
                                className={`p-2 ${iconButtonClass}`}
                                title="聊天设置"
                                aria-label="聊天设置"
                            >
                                <GearSix className="w-5 h-5" weight="bold" />
                            </button>
                        )}
                    </div>

                </div>
            ) : (
                <div className="flex items-center gap-3 w-full">
                    <button onClick={onClose} className={`p-2 -ml-2 ${onCloseButtonClass}`}>
                        <CaretLeft className="w-5 h-5" weight="bold" />
                    </button>

                    <div onClick={onShowCharsPanel} className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer">
                        {renderStandardInfo()}
                    </div>

                    <div className="relative ml-auto flex items-center gap-1">
                        <ChatMusicPlayer />
                        {onOpenDiscover && (
                            <button
                                onClick={onOpenDiscover}
                                className={`p-2 ${iconButtonClass}`}
                                title="发现页"
                                aria-label="发现页"
                            >
                                <Star className="w-5 h-5" weight="bold" />
                            </button>
                        )}
                        {onOpenChatSettings && (
                            <button
                                onClick={onOpenChatSettings}
                                className={`p-2 ${iconButtonClass}`}
                                title="聊天设置"
                                aria-label="聊天设置"
                            >
                                <GearSix className="w-5 h-5" weight="bold" />
                            </button>
                        )}
                    </div>

                </div>
            )}

            {isBuffListExpanded && emotionHistory.length > 0 && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[100] bg-slate-900/45 backdrop-blur-[1px]" onClick={() => setIsBuffListExpanded(false)}>
                    <div
                        ref={buffPanelRef}
                        className="absolute left-1/2 top-1/2 w-[min(92vw,400px)] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-white/40 bg-white/95 p-5 shadow-2xl shadow-slate-900/25 flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 顶部居中标题：角色名·心声 */}
                        <div className="mb-2 text-center">
                            <div className="text-base font-bold text-slate-800">{activeCharacter.name}·心声</div>
                        </div>

                        {/* 心声列表：每组 = meta 行 + 卡片（meta 行紧贴卡片上沿），组与组之间 space-y 留间距 */}
                        <div className="flex-1 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="space-y-3">
                                {emotionHistory.map((buff) => {
                                    const style = getBuffStyle(buff);
                                    return (
                                        <div key={`panel-${buff.id}`}>
                                            {/* meta 行（紧贴卡片上沿）：日期 + 删除 */}
                                            <div className="flex items-center justify-between gap-3 px-3 pb-0.5">
                                                <div className="text-[10px] font-bold tracking-wide" style={{ color: style.text }}>{formatEmotionTime(buff.createdAt)}</div>
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteFromHistory(buff); }}
                                                    className="shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[9px] font-bold transition-transform active:scale-95"
                                                    style={{ color: style.text, border: `1px solid ${style.border}` }}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                            {/* 卡片本体：chip row + 正文 */}
                                            <div
                                                className="rounded-2xl border p-3.5 shadow-sm select-none"
                                                style={{ borderColor: style.border, background: style.bg, color: style.text }}
                                            >
                                                {/* chip row：左 chip + 右 intensity 圆点（横排，元数据放主元素外） */}
                                                <div className="mb-1.5 flex items-center gap-2">
                                                    <div
                                                        className="inline-flex max-w-full items-center truncate rounded-full border bg-white/85 px-2.5 py-0.5 text-[10px] font-bold leading-none"
                                                        style={{ borderColor: style.border, color: style.text }}
                                                        title={getBuffInnerState(buff)}
                                                    >
                                                        {buff.emoji ? `${buff.emoji} ` : ''}
                                                        {getBuffLabel(buff)}
                                                    </div>
                                                    <span className="shrink-0 text-[9px] font-bold tracking-[1.5px]" style={{ color: style.text, opacity: 0.55 }}>
                                                        {INTENSITY_DOTS(buff.intensity)}
                                                    </span>
                                                </div>
                                                {/* 正文（不加粗 font-normal，跟日程黄色框字重一致）— 加 max-h + overflow 让超长文本在卡片内滚动，不再溢出弹窗 */}
                                                <div className="text-[12px] leading-relaxed max-h-[42vh] overflow-y-auto pr-1" style={{ color: style.text }}>
                                                    {getBuffInnerState(buff)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* footer：心电图 + 沿线漂浮小心（B 方案，参考候选 #B） */}
                        <div className="mt-2 flex justify-center">
                            <svg width="160" height="22" viewBox="0 0 160 22" fill="none" aria-hidden="true">
                                {/* 单一贯穿心电图折线：左侧基线 + 心电图锯齿（2 段）+ 末端基线 */}
                                <path
                                    d="M 0 11 L 30 11 L 34 11 L 38 5 L 42 17 L 46 8 L 50 11 L 78 11 L 82 11 L 86 5 L 90 17 L 94 8 L 98 11 L 160 11"
                                    stroke="#fca5a5"
                                    strokeWidth="1.3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                {/* 小心形 1：基线上方，靠左 */}
                                <path
                                    d="M 18 6 C 18 5, 19 4.4, 20 4.4 C 21 4.4, 22 5, 22 6 C 22 7.5, 20 9, 18 10 C 16 9, 14 7.5, 14 6 C 14 5, 15 4.4, 16 4.4 C 17 4.4, 18 5, 18 6 Z"
                                    fill="#f87171"
                                    opacity="0.85"
                                />
                                {/* 小心形 2：基线下方，中间 */}
                                <path
                                    d="M 64 17 C 64 16, 65 15.4, 66 15.4 C 67 15.4, 68 16, 68 17 C 68 18.5, 66 20, 64 21 C 62 20, 60 18.5, 60 17 C 60 16, 61 15.4, 62 15.4 C 63 15.4, 64 16, 64 17 Z"
                                    fill="#f87171"
                                    opacity="0.7"
                                />
                                {/* 小心形 3：基线上方，靠右 */}
                                <path
                                    d="M 112 7 C 112 6, 113 5.4, 114 5.4 C 115 5.4, 116 6, 116 7 C 116 8.5, 114 10, 112 11 C 110 10, 108 8.5, 108 7 C 108 6, 109 5.4, 110 5.4 C 111 5.4, 112 6, 112 7 Z"
                                    fill="#f87171"
                                    opacity="0.55"
                                />
                            </svg>
                        </div>
                    </div>
                </div>,
                document.body
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
