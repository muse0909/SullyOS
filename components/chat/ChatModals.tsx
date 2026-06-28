
import React, { useRef, useState, useEffect } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile, Message, EmojiCategory, DailySchedule, ScheduleSlot, ApiPreset, APIConfig } from '../../types';
import ScheduleCard from '../schedule/ScheduleCard';
import EmotionSettingsPanel from './EmotionSettingsPanel';
import { saveRemoteImage } from '../../utils/file';

interface ChatModalsProps {
    modalType: string;
    setModalType: (v: any) => void;
    // Data Props
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    emojiImportText: string;
    setEmojiImportText: (v: string) => void;
    settingsContextLimit: number;
    setSettingsContextLimit: (v: number) => void;
    settingsHideSysLogs: boolean;
    setSettingsHideSysLogs: (v: boolean) => void;
    preserveCount: number;
    setPreserveCount: (v: number) => void;

    editContent: string;
    setEditContent: (v: string) => void;
    
    // New Category Props
    newCategoryName: string;
    setNewCategoryName: (v: string) => void;
    onAddCategory: () => void;

    // Archive Props
    archivePrompts: {id: string, name: string, content: string}[];
    selectedPromptId: string;
    setSelectedPromptId: (id: string) => void;
    editingPrompt: {id: string, name: string, content: string} | null;
    setEditingPrompt: (p: any) => void;
    isSummarizing: boolean;
    archiveProgress?: string;

    // Selection Props
    selectedMessage: Message | null;
    selectedEmoji: {name: string, url: string} | null;
    selectedCategory: EmojiCategory | null;
    activeCharacter: CharacterProfile;
    messages: Message[];
    allHistoryMessages?: Message[];

    // Handlers
    onTransfer: () => void;
    onImportEmoji: () => void;
    onSaveSettings: () => void;
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;
    onClearHistory: () => void;
    onArchive: () => void;
    onCreatePrompt: () => void;
    onEditPrompt: () => void;
    onSavePrompt: () => void;
    onDeletePrompt: (id: string) => void;
    onSetHistoryStart: (id: number | undefined) => void;
    onEnterSelectionMode: () => void;
    onReplyMessage: () => void;
    onEditMessageStart: () => void;
    onConfirmEditMessage: () => void;
    onDeleteMessage: () => void;
    onCopyMessage: () => void;
    onDeleteEmoji: () => void;
    onDeleteCategory: () => void;
    // Edit emoji (rename)
    editEmojiNewName: string;
    setEditEmojiNewName: (v: string) => void;
    onEditEmojiConfirm: () => void;
    // Reorder emojis
    reorderList: { name: string; url: string; categoryId?: string; order?: number }[];
    onSaveReorder: () => void;
    onCancelReorder: () => void;
    onMoveEmoji: (from: number, to: number) => void;
    // Category Visibility
    allCharacters?: CharacterProfile[];
    onSaveCategoryVisibility?: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
    // Translation
    translationEnabled?: boolean;
    onToggleTranslation?: () => void;
    translateSourceLang?: string;
    translateTargetLang?: string;
    onSetTranslateSourceLang?: (lang: string) => void;
    onSetTranslateLang?: (lang: string) => void;
    // XHS toggle
    xhsEnabled?: boolean;
    onToggleXhs?: () => void;
    // HTML mode
    htmlModeEnabled?: boolean;
    onToggleHtmlMode?: () => void;
    htmlModeCustomPrompt?: string;
    setHtmlModeCustomPrompt?: (v: string) => void;
    // Voice TTS
    chatVoiceEnabled?: boolean;
    onToggleChatVoice?: () => void;
    chatVoiceLang?: string;
    onSetChatVoiceLang?: (lang: string) => void;
    // Voice generation from long-press
    onGenerateVoice?: () => void;
    voiceAvailable?: boolean; // true if char has voiceProfile configured
    // Schedule
    scheduleData?: DailySchedule | null;
    isScheduleGenerating?: boolean;
    onScheduleEdit?: (index: number, slot: ScheduleSlot) => void;
    onScheduleDelete?: (index: number) => void;
    onScheduleReroll?: () => void;
    onScheduleCoverChange?: (dataUrl: string) => void;
    onScheduleStyleChange?: (style: 'lifestyle' | 'mindful') => void;
    // Schedule master toggle
    isScheduleFeatureEnabled?: boolean;
    onToggleScheduleFeature?: () => void;
    // Memory Palace force vectorize
    isMemoryPalaceEnabled?: boolean;
    isVectorizing?: boolean;
    onForceVectorize?: () => void;
    // Emotion (embedded under schedule modal, synced on/off with scheduleStyle)
    apiPresets?: ApiPreset[];
    onAddApiPreset?: (name: string, config: APIConfig, kind?: ApiPreset['kind']) => void;
    onSaveEmotion?: (config: NonNullable<CharacterProfile['emotionConfig']>) => void;
    onClearBuffs?: () => void;
}

const ChatModals: React.FC<ChatModalsProps> = ({
    modalType, setModalType,
    transferAmt, setTransferAmt,
    emojiImportText, setEmojiImportText,
    settingsContextLimit, setSettingsContextLimit,
    settingsHideSysLogs, setSettingsHideSysLogs,
    preserveCount, setPreserveCount,
    editContent, setEditContent,
    newCategoryName, setNewCategoryName, onAddCategory,
    archivePrompts, selectedPromptId, setSelectedPromptId,
    editingPrompt, setEditingPrompt, isSummarizing, archiveProgress,
    selectedMessage, selectedEmoji, selectedCategory, activeCharacter, messages,
    allHistoryMessages = [],
    onTransfer, onImportEmoji, onSaveSettings,
    onBgUpload, onRemoveBg, onClearHistory,
    onArchive, onCreatePrompt, onEditPrompt, onSavePrompt, onDeletePrompt,
    onSetHistoryStart, onEnterSelectionMode, onReplyMessage, onEditMessageStart, onConfirmEditMessage, onDeleteMessage, onCopyMessage, onDeleteEmoji, onDeleteCategory,
    editEmojiNewName, setEditEmojiNewName, onEditEmojiConfirm,
    reorderList, onSaveReorder, onCancelReorder, onMoveEmoji,
    allCharacters = [], onSaveCategoryVisibility,
    translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang, onSetTranslateSourceLang, onSetTranslateLang,
    xhsEnabled, onToggleXhs,
    htmlModeEnabled, onToggleHtmlMode, htmlModeCustomPrompt, setHtmlModeCustomPrompt,
    chatVoiceEnabled, onToggleChatVoice, chatVoiceLang, onSetChatVoiceLang,
    onGenerateVoice, voiceAvailable,
    scheduleData, isScheduleGenerating, onScheduleEdit, onScheduleDelete, onScheduleReroll, onScheduleCoverChange,
    onScheduleStyleChange,
    isScheduleFeatureEnabled, onToggleScheduleFeature,
    isMemoryPalaceEnabled, isVectorizing, onForceVectorize,
    apiPresets, onAddApiPreset, onSaveEmotion, onClearBuffs,
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);
    const [visibilitySelection, setVisibilitySelection] = useState<Set<string>>(new Set());
    const [historyPage, setHistoryPage] = useState(0);
    const HISTORY_PAGE_SIZE = 50;

    // --- Emoji Reorder 拖拽排序 state ---
    // 用 position: fixed 浮层让被拖动项脱离文档流，避免 reorder 时 DOM 位置变化造成的视觉跳跃
    // 拖动时 mousemove/mouseup 挂到 document 上，确保鼠标移出容器也能继续拖
    const reorderListRef = useRef<HTMLDivElement>(null);
    const reorderItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dragStartPointerYRef = useRef<number>(0);
    const dragOffsetYRef = useRef<number>(0); // 长按启动时手指相对 item.top 的偏移
    const scrollRafRef = useRef<number | null>(null);
    const scrollDirRef = useRef<-1 | 0 | 1>(0);
    const [draggingName, setDraggingName] = useState<string | null>(null);
    const [draggingStyle, setDraggingStyle] = useState<{ left: number; top: number; width: number } | null>(null);
    const isDragging = draggingName !== null;

    const clearLongPress = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const startAutoScroll = (dir: -1 | 0 | 1) => {
        scrollDirRef.current = dir;
        if (scrollRafRef.current !== null) return;
        const tick = () => {
            const el = reorderListRef.current;
            if (!el || scrollDirRef.current === 0) {
                scrollRafRef.current = null;
                return;
            }
            const speed = scrollDirRef.current * 6;
            el.scrollTop += speed;
            scrollRafRef.current = requestAnimationFrame(tick);
        };
        scrollRafRef.current = requestAnimationFrame(tick);
    };
    const stopAutoScroll = () => {
        scrollDirRef.current = 0;
        if (scrollRafRef.current !== null) {
            cancelAnimationFrame(scrollRafRef.current);
            scrollRafRef.current = null;
        }
    };

    // 拖动核心逻辑（接收纯 clientY，文档级监听器复用同一函数）
    const updateDragAt = (clientY: number) => {
        // 1) 更新拖动浮层位置（position: fixed 跟随手指，不受 DOM 变化影响）
        setDraggingStyle(prev => prev ? { ...prev, top: clientY - dragOffsetYRef.current } : prev);

        // 2) 自动滚动：靠近顶部/底部阈值区
        const container = reorderListRef.current;
        if (container) {
            const rect = container.getBoundingClientRect();
            const THRESHOLD = 60;
            if (clientY - rect.top < THRESHOLD) startAutoScroll(-1);
            else if (rect.bottom - clientY < THRESHOLD) startAutoScroll(1);
            else stopAutoScroll();
        }

        // 3) 计算落点 target index
        if (!container) return;
        const currentName = draggingNameRef.current;
        if (!currentName) return;
        const currentIdx = reorderList.findIndex(it => it.name === currentName);
        if (currentIdx === -1) return;
        const items = reorderList
            .map(it => reorderItemRefs.current.get(it.name))
            .filter((el): el is HTMLDivElement => !!el);
        let target = currentIdx;
        for (let i = 0; i < items.length; i++) {
            const r = items[i].getBoundingClientRect();
            if (clientY < r.top + r.height / 2) {
                target = i;
                break;
            }
        }
        if (target !== currentIdx) {
            onMoveEmoji(currentIdx, target);
        }
    };

    const endDrag = () => {
        clearLongPress();
        stopAutoScroll();
        setDraggingName(null);
        setDraggingStyle(null);
    };

    // draggingName 同步到 ref，供 updateDragAt 在 document mousemove 中读取（避免闭包过期）
    const draggingNameRef = useRef<string | null>(null);
    useEffect(() => { draggingNameRef.current = draggingName; }, [draggingName]);

    // 拖动启动后，把 mousemove/mouseup 挂到 document（不依赖容器边界）
    useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (e: MouseEvent) => updateDragAt(e.clientY);
        const handleTouchMove = (e: TouchEvent) => {
            const t = e.touches[0];
            if (t) updateDragAt(t.clientY);
        };
        const handleUp = () => endDrag();
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleUp);
        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleUp);
        };
    }, [isDragging]);

    const handleReorderPointerDown = (name: string, e: React.MouseEvent | React.TouchEvent) => {
        // 如果点在 ↑↓ 按钮上，不进入拖拽（让按钮 onClick 生效）
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;

        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        dragStartPointerYRef.current = clientY;

        longPressTimerRef.current = setTimeout(() => {
            const itemEl = reorderItemRefs.current.get(name);
            if (!itemEl) return;
            const rect = itemEl.getBoundingClientRect();
            dragOffsetYRef.current = clientY - rect.top;
            setDraggingName(name);
            setDraggingStyle({ left: rect.left, top: rect.top, width: rect.width });
            // 触觉反馈（如果浏览器支持）
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                (navigator as any).vibrate?.(30);
            }
        }, 300);
    };

    // 容器内 mousemove：仅用于长按计时器取消判断（>10px 自动取消）
    const handleReorderContainerMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (isDragging) return; // 拖动中由 document 监听器处理
        if (longPressTimerRef.current) {
            const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
            if (Math.abs(clientY - dragStartPointerYRef.current) > 10) clearLongPress();
        }
    };

    // 容器 mouseleave：只清除未启动的长按计时；拖动中不响应
    const handleReorderContainerLeave = () => {
        if (!isDragging) clearLongPress();
    };

    const openVisibilityModal = () => {
        if (selectedCategory) {
            setVisibilitySelection(new Set(selectedCategory.allowedCharacterIds || []));
            setModalType('category-visibility');
        }
    };

    const toggleVisibilityChar = (charId: string) => {
        setVisibilitySelection(prev => {
            const next = new Set(prev);
            if (next.has(charId)) next.delete(charId);
            else next.add(charId);
            return next;
        });
    };

    const handleSaveVisibility = () => {
        if (selectedCategory && onSaveCategoryVisibility) {
            const ids = Array.from(visibilitySelection);
            onSaveCategoryVisibility(selectedCategory.id, ids.length > 0 ? ids : undefined);
        }
        setModalType('none');
    };

        const handleSaveImageMessage = async () => {
        if (!selectedMessage?.content) return;

        await saveRemoteImage(selectedMessage.content);

        setModalType('none');
    };

    return (
        <>
            <Modal 
                isOpen={modalType === 'transfer'} title="Credits 转账" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onTransfer} className="flex-1 py-3 bg-orange-500 text-white rounded-2xl">确认</button></>}
            ><input type="number" value={transferAmt} onChange={e => setTransferAmt(e.target.value)} className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-lg font-bold" autoFocus /></Modal>

            {/* New Category Modal */}
            <Modal 
                isOpen={modalType === 'add-category'} title="新建表情分类" onClose={() => setModalType('none')}
                footer={<button onClick={onAddCategory} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">创建</button>}
            >
                <input 
                    value={newCategoryName} 
                    onChange={e => setNewCategoryName(e.target.value)} 
                    placeholder="输入分类名称..." 
                    className="w-full bg-slate-100 rounded-2xl px-5 py-4 text-base font-bold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-slate-700" 
                    autoFocus 
                />
            </Modal>

            <Modal 
                isOpen={modalType === 'emoji-import'} title="表情注入" onClose={() => setModalType('none')}
                footer={<button onClick={onImportEmoji} className="w-full py-4 bg-primary text-white font-bold rounded-2xl">添加至当前分类</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-400">表情将导入到你当前选中的分类。</p>
                    <textarea value={emojiImportText} onChange={e => setEmojiImportText(e.target.value)} placeholder="Name--URL (每行一个)" className="w-full h-40 bg-slate-100 rounded-2xl p-4 resize-none" />
                </div>
            </Modal>

            <Modal 
                isOpen={modalType === 'chat-settings'} title="聊天设置" onClose={() => setModalType('none')}
                footer={<button onClick={onSaveSettings} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-6">
                     <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">聊天背景</label>
                         <div onClick={() => bgInputRef.current?.click()} className="h-24 bg-slate-100 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden relative">
                             {activeCharacter.chatBackground ? <img src={activeCharacter.chatBackground} className="w-full h-full object-cover opacity-60" /> : <span className="text-xs text-slate-400">点击上传图片 (原画质)</span>}
                             {activeCharacter.chatBackground && <span className="absolute z-10 text-xs bg-white/80 px-2 py-1 rounded">更换</span>}
                         </div>
                         <input type="file" ref={bgInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])} />
                         {activeCharacter.chatBackground && <button onClick={onRemoveBg} className="text-[10px] text-red-400 mt-1">移除背景</button>}
                     </div>
                     <div>
                         <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">上下文条数 ({settingsContextLimit})</label>
                         <input type="range" min="20" max="5000" step="10" value={settingsContextLimit} onChange={e => setSettingsContextLimit(parseInt(e.target.value))} className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary" />
                         <div className="flex justify-between text-[10px] text-slate-400 mt-1"><span>20 (省流)</span><span>5000 (超长记忆)</span></div>
                     </div>

                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={() => setSettingsHideSysLogs(!settingsHideSysLogs)}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">隐藏系统日志</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${settingsHideSysLogs ? 'bg-primary' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${settingsHideSysLogs ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后，将不再显示 Date/App 产生的上下文提示文本（转账、戳一戳、图片发送提示除外）。
                         </p>
                     </div>

                     {/* Translation Settings */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleTranslation}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">消息翻译</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${translationEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${translationEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。
                         </p>
                         {translationEnabled && (
                             <div className="mt-3 space-y-3">
                                 {/* Source Language (选) */}
                                 <div>
                                     <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">选（气泡显示语言）</label>
                                     <div className="flex flex-wrap gap-1.5">
                                         {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                             <button
                                                 key={`src-${lang}`}
                                                 onClick={() => onSetTranslateSourceLang?.(lang)}
                                                 className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateSourceLang === lang ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}
                                             >
                                                 {lang}
                                             </button>
                                         ))}
                                     </div>
                                 </div>
                                 {/* Target Language (译) */}
                                 <div>
                                     <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">译（翻译目标语言）</label>
                                     <div className="flex flex-wrap gap-1.5">
                                         {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                             <button
                                                 key={`tgt-${lang}`}
                                                 onClick={() => onSetTranslateLang?.(lang)}
                                                 className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateTargetLang === lang ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}
                                             >
                                                 {lang}
                                             </button>
                                         ))}
                                     </div>
                                 </div>
                                 {/* Preview */}
                                 <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                                     选<span className="font-bold text-slate-700">{translateSourceLang || '?'}</span> 译<span className="font-bold text-primary">{translateTargetLang || '?'}</span>
                                 </div>
                             </div>
                         )}
                     </div>

                     {/* XHS Toggle */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleXhs}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">小红书</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${xhsEnabled ? 'bg-red-400' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${xhsEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后，角色在聊天中可以搜索、浏览、发帖、评论小红书。需要在全局设置中配置 MCP 或 Cookie。
                         </p>
                     </div>

                     {/* HTML 模块模式 */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleHtmlMode}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">HTML 模块模式</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${htmlModeEnabled ? 'bg-fuchsia-500' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${htmlModeEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                             开启后注入"用 [html]...[/html] 包裹的精美卡片"提示词，AI 会在合适场景输出邀请函 / 票据 / 通知等可视化模块。
                             历史上下文里只保留剥离 HTML 后的文字摘要，不浪费 token。
                         </p>
                         {htmlModeEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">自定义提示词补充（追加在内置提示词之后，不会覆盖）</label>
                                 <textarea
                                     value={htmlModeCustomPrompt || ''}
                                     onChange={e => setHtmlModeCustomPrompt?.(e.target.value)}
                                     placeholder="比如：偏好暖色调 / 默认风格走 minimal 杂志感 / 票据类必须含二维码占位…"
                                     className="w-full h-28 bg-slate-50 rounded-2xl p-3 text-[12px] resize-none border border-slate-200 focus:outline-none focus:border-fuchsia-300"
                                 />
                                 <p className="text-[10px] text-slate-400 mt-1">留空则只使用内置提示词。</p>
                             </div>
                         )}
                     </div>

                     {/* Voice TTS */}
                     <div className="pt-2 border-t border-slate-100">
                         <div className="flex justify-between items-center cursor-pointer" onClick={onToggleChatVoice}>
                             <label className="text-xs font-bold text-slate-400 uppercase pointer-events-none">语音消息</label>
                             <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${chatVoiceEnabled ? 'bg-emerald-400' : 'bg-slate-200'}`}>
                                 <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${chatVoiceEnabled ? 'translate-x-4' : ''}`}></div>
                             </div>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                             开启后，AI 回复自动生成语音条（需配置 MiniMax 和角色语音）。
                         </p>
                         {chatVoiceEnabled && (
                             <div className="mt-3">
                                 <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">语音语种</label>
                                 <div className="flex flex-wrap gap-1.5">
                                     {[{v:'',l:'默认'},{v:'en',l:'English'},{v:'ja',l:'日本語'},{v:'ko',l:'한국어'},{v:'fr',l:'Français'},{v:'es',l:'Español'}].map(opt => (
                                         <button key={opt.v} onClick={() => onSetChatVoiceLang?.(opt.v)}
                                             className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${chatVoiceLang === opt.v ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                             {opt.l}
                                         </button>
                                     ))}
                                 </div>
                                 {chatVoiceLang && <p className="text-[10px] text-emerald-600/70 mt-1.5">选择非默认语种时，AI 台词会先翻译再生成语音。</p>}
                             </div>
                         )}
                     </div>

                     <div className="pt-2 border-t border-slate-100">
                         <button onClick={() => setModalType('history-manager')} className="w-full py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                             管理上下文 / 隐藏历史
                         </button>
                         <p className="text-[10px] text-slate-400 mt-2 text-center">可选择从某条消息开始显示，隐藏之前的记录（不被 AI 读取）。</p>
                     </div>
                     
                     {/* 记忆宫殿：一键向量化所有聊天记录 */}
                     {isMemoryPalaceEnabled && onForceVectorize && (
                         <div className="pt-2 border-t border-slate-100">
                             <button
                                 onClick={onForceVectorize}
                                 disabled={isVectorizing}
                                 className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-2xl border border-emerald-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                             >
                                 {isVectorizing ? '🏰 向量化处理中...' : '🏰 一键向量化所有聊天记录'}
                             </button>
                             <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
                                 将所有未处理的聊天记录交给记忆宫殿向量化，完成后可安全清空聊天。<br/>
                                 <span className="text-slate-300">看不懂这是什么的话不需要操作此按钮。</span>
                             </p>
                         </div>
                     )}

                     <div className="pt-2 border-t border-slate-100">
    <label className="text-xs font-bold text-red-400 uppercase mb-3 block">危险区域 (Danger Zone)</label>
    <div className="flex items-center gap-2 mb-3">
        <span className="text-sm text-slate-600 whitespace-nowrap">清空时建议保留最后</span>
        <input
            type="number"
            min={0}
            value={preserveCount ?? 10}
            onChange={(e) => setPreserveCount(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-14 text-center text-sm font-bold border border-slate-300 rounded-lg py-1 px-1 focus:ring-1 focus:ring-primary/30 focus:border-primary"
        />
        <span className="text-sm text-slate-600 whitespace-nowrap">条记录以维持语境</span>
    </div>
    <button onClick={onClearHistory} className="w-full py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-100 active:scale-95 transition-transform flex items-center justify-center gap-2">
        执行清空
    </button>
</div>

                </div>
            </Modal>

            {/* Archive Settings Modal */}
            <Modal isOpen={modalType === 'archive-settings'} title="记忆归档设置" onClose={() => { if (!isSummarizing) setModalType('none'); }} footer={
                isSummarizing ?
                <div className="w-full py-3 bg-slate-100 text-indigo-600 font-bold rounded-2xl text-center flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>{archiveProgress || '归档中...'}</div> :
                <button onClick={onArchive} disabled={isSummarizing} className="w-full py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200">开始归档</button>
            }>
                <div className="space-y-4">
                    {(() => {
                        const palaceOn = !!(activeCharacter as any).memoryPalaceEnabled;
                        const autoOn = !!(activeCharacter as any).autoArchiveEnabled;
                        const activePrompt = archivePrompts.find(p => p.id === selectedPromptId);
                        const activeName = activePrompt?.name || '理性精炼 (Rational)';
                        if (palaceOn && autoOn) {
                            return (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-[11px] text-emerald-800 leading-relaxed">
                                    ✅ <b>自动归档已开启</b>。palace 处理后系统会按日期自动把聊天归档到"本月日度总结"。<br/>
                                    自动归档走的是 <b>记忆宫殿内置风格</b>（保证向量检索质量稳定），
                                    下方模板<b>只对这里的"开始归档"按钮生效</b>——你在这换风格不会影响自动归档。
                                </div>
                            );
                        }
                        if (palaceOn && !autoOn) {
                            return (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] text-amber-900 leading-relaxed">
                                    ⚠️ 记忆宫殿已开，但 <b>自动归档没开</b>——palace 只在后台做向量索引，
                                    <b>不</b>会自动写到"本月日度总结"里。<br/>
                                    想让它自动写 → 神经链接 → 角色 → 记忆宫殿开关下面的 <b>"📚 自动归档"</b>；
                                    或者继续用下方按钮手动按当前选中的 <b>「{activeName}」</b> 风格跑。
                                </div>
                            );
                        }
                        return (
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-[11px] text-slate-700 leading-relaxed">
                                📋 <b>纯手动模式</b>（没开记忆宫殿）。下方按钮会用选中的
                                <b className="text-slate-900"> 「{activeName}」</b> 风格把聊天按天总结到"本月日度总结"。
                                归档完会自动隐藏已总结的旧消息（保留最近一部分可见）。
                            </div>
                        );
                    })()}
                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                        <label className="text-[10px] font-bold text-indigo-400 uppercase mb-2 block">选择提示词模板</label>
                        <div className="flex flex-col gap-2">
                            {archivePrompts.map(p => {
                                const isSelected = selectedPromptId === p.id;
                                return (
                                <div key={p.id} onClick={() => setSelectedPromptId(p.id)} className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between ${isSelected ? 'bg-white border-indigo-500 shadow-sm ring-1 ring-indigo-500' : 'bg-white/50 border-indigo-200 hover:bg-white'}`}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className={`text-xs font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-600'}`}>{p.name}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={(e) => { e.stopPropagation(); setSelectedPromptId(p.id); onEditPrompt(); }} className="text-[10px] text-slate-400 hover:text-indigo-500 px-2 py-1 rounded bg-slate-100 hover:bg-indigo-50">编辑/查看</button>
                                        {!p.id.startsWith('preset_') && (
                                            <button onClick={(e) => { e.stopPropagation(); onDeletePrompt(p.id); }} className="text-[10px] text-red-300 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50">×</button>
                                        )}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        <button onClick={onCreatePrompt} className="mt-3 w-full py-2 text-xs font-bold text-indigo-500 border border-dashed border-indigo-300 rounded-lg hover:bg-indigo-100">+ 新建自定义提示词</button>
                    </div>
                    <div className="text-[10px] text-slate-400 bg-slate-50 p-3 rounded-xl leading-relaxed">
                        • <b>理性精炼</b>: 适合生成条理清晰的事件日志，便于 AI 长期记忆检索。<br/>
                        • <b>日记风格</b>: 适合生成第一人称的角色日记，更有代入感和情感色彩。<br/>
                        • 支持变量: <code>{'${dateStr}'}</code>, <code>{'${char.name}'}</code>, <code>{'${userProfile.name}'}</code>, <code>{'${rawLog}'}</code>
                    </div>
                </div>
            </Modal>

            {/* Prompt Editor Modal */}
            <Modal isOpen={modalType === 'prompt-editor'} title="编辑提示词" onClose={() => setModalType('archive-settings')} footer={<button onClick={onSavePrompt} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存预设</button>}>
                <div className="space-y-3">
                    <input 
                        value={editingPrompt?.name || ''} 
                        onChange={e => setEditingPrompt((prev: any) => prev ? {...prev, name: e.target.value} : null)}
                        placeholder="预设名称"
                        className="w-full px-4 py-2 bg-slate-100 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <textarea 
                        value={editingPrompt?.content || ''} 
                        onChange={e => setEditingPrompt((prev: any) => prev ? {...prev, content: e.target.value} : null)}
                        className="w-full h-64 bg-slate-100 rounded-xl p-3 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 leading-relaxed"
                        placeholder="输入提示词内容..."
                    />
                </div>
            </Modal>

            {/* History Manager Modal */}
            <Modal
                isOpen={modalType === 'history-manager'} title="历史记录断点" onClose={() => { setModalType('none'); setHistoryPage(0); }}
                footer={<><button onClick={() => onSetHistoryStart(undefined)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">恢复全部</button><button onClick={() => { setModalType('none'); setHistoryPage(0); }} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">完成</button></>}
            >
                <div className="space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar p-1">
                    <p className="text-xs text-slate-400 text-center mb-2">点击某条消息，将其设为"新的起点"。此条之前的消息将被隐藏且不发送给 AI。</p>
                    {typeof activeCharacter.hideBeforeMessageId === 'number' && activeCharacter.hideBeforeMessageId > 0 && (
                        <div className="bg-violet-50 border border-violet-200 rounded-xl p-2.5 text-[11px] text-violet-800 leading-relaxed mb-2">
                            <b>💡 已经有隐藏起点了</b>：灰色消息是自动/手动归档时标记为"已总结"的，AI 现在看不到原文，但能看到它们的总结。<br/>
                            <span className="text-violet-600">记忆宫殿向量记忆有自己的水位线（和这里无关），不用手动管。</span>
                        </div>
                    )}
                    {(() => {
                        const reversed = allHistoryMessages.slice().reverse();
                        const totalPages = Math.max(1, Math.ceil(reversed.length / HISTORY_PAGE_SIZE));
                        const pageMessages = reversed.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
                        const hideCut = activeCharacter.hideBeforeMessageId;
                        return (<>
                            {reversed.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-between px-1 py-1">
                                    <button onClick={() => setHistoryPage(p => Math.max(0, p - 1))} disabled={historyPage === 0} className={`px-3 py-1 text-xs rounded-lg ${historyPage === 0 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>上一页</button>
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}（共 {reversed.length} 条）</span>
                                    <button onClick={() => setHistoryPage(p => Math.min(totalPages - 1, p + 1))} disabled={historyPage >= totalPages - 1} className={`px-3 py-1 text-xs rounded-lg ${historyPage >= totalPages - 1 ? 'text-slate-300' : 'text-primary hover:bg-primary/10'}`}>下一页</button>
                                </div>
                            )}
                            {pageMessages.map(m => {
                                const isCurrentStart = hideCut === m.id;
                                const isHidden = !!(hideCut && m.id < hideCut);
                                const cls = isCurrentStart
                                    ? 'bg-primary/10 border-primary ring-1 ring-primary'
                                    : isHidden
                                        ? 'bg-slate-50 border-slate-100 opacity-55'
                                        : 'bg-white border-slate-100 hover:bg-slate-50';
                                return (
                                    <div key={m.id} onClick={() => onSetHistoryStart(m.id)} className={`p-3 rounded-xl border cursor-pointer text-xs flex gap-2 items-start ${cls}`}>
                                        <span className="text-slate-400 font-mono whitespace-nowrap pt-0.5">[{new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]</span>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-slate-600 mb-0.5">{m.role === 'user' ? '我' : activeCharacter.name}</div>
                                            <div className={isHidden ? 'text-slate-400 truncate line-through decoration-slate-300/70' : 'text-slate-500 truncate'}>{m.content}</div>
                                        </div>
                                        {isCurrentStart && <span className="text-primary font-bold text-[10px] bg-white px-2 rounded-full border border-primary/20">起点</span>}
                                        {!isCurrentStart && isHidden && <span className="text-slate-400 font-bold text-[10px] bg-white px-2 rounded-full border border-slate-200">已隐</span>}
                                    </div>
                                );
                            })}
                            {reversed.length > HISTORY_PAGE_SIZE && (
                                <div className="flex items-center justify-center px-1 pt-2">
                                    <span className="text-xs text-slate-400">{historyPage + 1} / {totalPages}</span>
                                </div>
                            )}
                        </>);
                    })()}
                </div>
            </Modal>
            
            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={onEnterSelectionMode} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        多选 / 批量删除
                    </button>
                    <button onClick={onReplyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        引用 / 回复
                    </button>
                    {selectedMessage?.type === 'text' && (
                        <button onClick={onEditMessageStart} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            编辑内容
                        </button>
                    )}
                    {selectedMessage?.type === 'text' && (
                        <button onClick={onCopyMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            复制文字
                        </button>
                    )}
                                        {selectedMessage?.content && selectedMessage?.type !== 'text' && (
                        <button onClick={handleSaveImageMessage} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                            保存图片
                        </button>
                    )}

                    {voiceAvailable && selectedMessage?.role === 'assistant' && selectedMessage?.type === 'text' && onGenerateVoice && (
                        <button onClick={() => { onGenerateVoice(); setModalType('none'); }} className="w-full py-3 bg-emerald-50 text-emerald-600 font-medium rounded-2xl active:bg-emerald-100 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" /></svg>
                            转换语音
                        </button>
                    )}
                    <button onClick={onDeleteMessage} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                        删除消息
                    </button>
                </div>
            </Modal>
            
             <Modal
                isOpen={modalType === 'delete-emoji'} title="删除表情包" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onDeleteEmoji} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">删除</button></>}
            >
                <div className="flex flex-col items-center gap-4 py-2">
                    {selectedEmoji && <img src={selectedEmoji.url} className="w-24 h-24 object-contain rounded-xl border" />}
                    <p className="text-center text-sm text-slate-500">确定要删除这个表情包吗？</p>
                </div>
            </Modal>

            {/* Emoji Options Menu (长按弹出) — 编辑名字 / 调整顺序 / 删除 */}
            <Modal isOpen={modalType === 'emoji-options'} title="表情包操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={() => setModalType('edit-emoji')} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                        编辑名字
                    </button>
                    <button onClick={() => setModalType('emoji-reorder')} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                        </svg>
                        调整顺序
                    </button>
                    <button onClick={() => setModalType('delete-emoji')} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                        删除
                    </button>
                </div>
            </Modal>

            {/* Edit Emoji (rename) Modal */}
            <Modal
                isOpen={modalType === 'edit-emoji'} title="编辑表情包名字" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onEditEmojiConfirm} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <div className="flex flex-col items-center gap-4 py-2">
                    {selectedEmoji && <img src={selectedEmoji.url} className="w-24 h-24 object-contain rounded-xl border" />}
                    <input
                        type="text"
                        value={editEmojiNewName}
                        onChange={(e) => setEditEmojiNewName(e.target.value)}
                        placeholder="表情包名字"
                        maxLength={20}
                        className="w-full bg-slate-100 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
                        autoFocus
                    />
                </div>
            </Modal>

            {/* Reorder Emojis Modal — 列表 + ↑↓ 按钮 */}
            <Modal
                isOpen={modalType === 'emoji-reorder'} title="调整表情包顺序" onClose={onCancelReorder}
                footer={<><button onClick={onCancelReorder} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onSaveReorder} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <p className="text-xs text-slate-400 text-center pb-2">长按表情包 0.3s 后可拖动；贴近顶部/底部会自动滚动</p>
                <div
                    ref={reorderListRef}
                    className="space-y-2 max-h-96 overflow-y-auto no-scrollbar -mx-1 px-1 py-1 touch-none select-none"
                    onMouseMove={handleReorderContainerMove}
                    onTouchMove={handleReorderContainerMove}
                    onMouseLeave={handleReorderContainerLeave}
                >
                    {reorderList.length === 0 ? (
                        <p className="text-center text-sm text-slate-400 py-6">当前分类下没有表情包</p>
                    ) : reorderList.map((e, idx) => {
                        const isDragging = draggingName === e.name;
                        // 拖动中的项脱离列表，在 fixed 浮层渲染；原位置留虚线占位
                        if (isDragging) {
                            return (
                                <div
                                    key={e.name}
                                    className="h-14 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50"
                                />
                            );
                        }
                        return (
                            <div
                                key={e.name}
                                ref={(el) => {
                                    if (el) reorderItemRefs.current.set(e.name, el);
                                    else reorderItemRefs.current.delete(e.name);
                                }}
                                onMouseDown={(ev) => handleReorderPointerDown(e.name, ev)}
                                onTouchStart={(ev) => handleReorderPointerDown(e.name, ev)}
                                data-reorder-item
                                className="flex items-center gap-3 bg-slate-50 rounded-2xl px-3 py-2 cursor-grab active:bg-slate-100"
                            >
                                {/* 拖拽手柄图标，提示用户可拖动 */}
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-300 shrink-0">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5h.008v.008H8.25V4.5Zm0 7.5h.008v.008H8.25V12Zm0 7.5h.008v.008H8.25V19.5Zm7.5-15h.008v.008h-.008V4.5Zm0 7.5h.008v.008h-.008V12Zm0 7.5h.008v.008h-.008V19.5Z" />
                                </svg>
                                <img src={e.url} className="w-10 h-10 object-contain rounded-lg shrink-0 pointer-events-none" />
                                <span className="flex-1 text-sm text-slate-700 truncate font-medium pointer-events-none">{e.name}</span>
                                <div className="flex flex-col gap-0.5 shrink-0">
                                    <button
                                        onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx - 1); }}
                                        disabled={idx === 0}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${idx === 0 ? 'bg-slate-100 text-slate-300' : 'bg-white text-slate-600 active:bg-slate-200 border border-slate-200'}`}
                                        aria-label="上移"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
                                    </button>
                                    <button
                                        onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx + 1); }}
                                        disabled={idx === reorderList.length - 1}
                                        className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${idx === reorderList.length - 1 ? 'bg-slate-100 text-slate-300' : 'bg-white text-slate-600 active:bg-slate-200 border border-slate-200'}`}
                                        aria-label="下移"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
                {/* 拖动浮层（position: fixed 脱离 reorderList 文档流，跟随手指不抖动） */}
                {draggingName && draggingStyle && (() => {
                    const e = reorderList.find(it => it.name === draggingName);
                    if (!e) return null;
                    return (
                        <div
                            className="fixed z-[60] flex items-center gap-3 bg-white rounded-2xl px-3 py-2 shadow-xl shadow-indigo-200/60 border border-indigo-200 scale-[1.03] cursor-grabbing"
                            style={{
                                left: draggingStyle.left,
                                top: draggingStyle.top,
                                width: draggingStyle.width,
                            }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-300 shrink-0">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5h.008v.008H8.25V4.5Zm0 7.5h.008v.008H8.25V12Zm0 7.5h.008v.008H8.25V19.5Zm7.5-15h.008v.008h-.008V4.5Zm0 7.5h.008v.008h-.008V12Zm0 7.5h.008v.008h-.008V19.5Z" />
                            </svg>
                            <img src={e.url} className="w-10 h-10 object-contain rounded-lg shrink-0" />
                            <span className="flex-1 text-sm text-slate-700 truncate font-medium">{e.name}</span>
                        </div>
                    );
                })()}
            </Modal>

            {/* Delete Category Modal */}
            <Modal
                isOpen={modalType === 'delete-category'} title="删除分类" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onDeleteCategory} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">删除</button></>}
            >
                <div className="py-4 text-center">
                    <p className="text-sm text-slate-600">确定要删除分类 <br/><span className="font-bold">"{selectedCategory?.name}"</span> 吗？</p>
                    <p className="text-[10px] text-red-400 mt-2">注意：分类下的所有表情也将被删除！</p>
                </div>
            </Modal>

            {/* Category Options Modal (shown on long-press) */}
            <Modal isOpen={modalType === 'category-options'} title="分类操作" onClose={() => setModalType('none')}>
                <div className="space-y-3">
                    <button onClick={openVisibilityModal} className="w-full py-3 bg-slate-50 text-slate-700 font-medium rounded-2xl active:bg-slate-100 transition-colors flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                        设置可见角色
                    </button>
                    {selectedCategory && !selectedCategory.isSystem && selectedCategory.id !== 'default' && (
                        <button onClick={() => setModalType('delete-category')} className="w-full py-3 bg-red-50 text-red-500 font-medium rounded-2xl active:bg-red-100 transition-colors flex items-center justify-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                            删除分类
                        </button>
                    )}
                </div>
            </Modal>

            {/* Category Visibility Modal */}
            <Modal
                isOpen={modalType === 'category-visibility'} title={`"${selectedCategory?.name}" 可见角色`} onClose={() => setModalType('none')}
                footer={<button onClick={handleSaveVisibility} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存设置</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-400 leading-relaxed">
                        选择哪些角色可以使用此表情分组。不勾选任何角色表示所有角色均可使用。
                    </p>
                    <div className="space-y-2 max-h-[40vh] overflow-y-auto no-scrollbar">
                        {allCharacters.map(c => (
                            <div
                                key={c.id}
                                onClick={() => toggleVisibilityChar(c.id)}
                                className={`flex items-center gap-3 p-3 rounded-2xl border cursor-pointer transition-all ${visibilitySelection.has(c.id) ? 'bg-primary/5 border-primary/30' : 'bg-white border-slate-100 hover:bg-slate-50'}`}
                            >
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors shrink-0 ${visibilitySelection.has(c.id) ? 'bg-primary border-primary' : 'bg-slate-100 border-slate-300'}`}>
                                    {visibilitySelection.has(c.id) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
                                </div>
                                <img src={c.avatar} className="w-9 h-9 rounded-xl object-cover" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-700">{c.name}</div>
                                    <div className="text-[10px] text-slate-400 truncate">{c.description}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    {visibilitySelection.size > 0 && (
                        <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                            已选 <span className="font-bold text-primary">{visibilitySelection.size}</span> 个角色可使用此分组
                        </div>
                    )}
                </div>
            </Modal>

            <Modal
                isOpen={modalType === 'edit-message'} title="编辑内容" onClose={() => setModalType('none')}
                footer={<><button onClick={() => setModalType('none')} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={onConfirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}
            >
                <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed"
                />
            </Modal>

            {/* Schedule Modal */}
            <Modal
                isOpen={modalType === 'schedule'} title={`${activeCharacter?.name || '角色'}の日程`} onClose={() => setModalType('none')}
            >
                <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
                    {/* 总开关：关闭时不生成日程、不注入情绪 buff */}
                    {onToggleScheduleFeature && (
                        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 pr-3">
                                    <p className="text-xs font-bold text-slate-700">日程与情绪 Buff</p>
                                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                                        {isScheduleFeatureEnabled
                                            ? '已开启：会生成今日日程，并在对话中评估情绪 buff。'
                                            : '已关闭：不生成日程，不注入情绪 buff。'}
                                    </p>
                                </div>
                                <button
                                    onClick={onToggleScheduleFeature}
                                    aria-label="切换日程与情绪总开关"
                                    className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center flex-shrink-0 ${isScheduleFeatureEnabled ? 'bg-primary' : 'bg-slate-300'}`}
                                >
                                    <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${isScheduleFeatureEnabled ? 'translate-x-4' : ''}`}></div>
                                </button>
                            </div>
                        </div>
                    )}

                    {isScheduleFeatureEnabled && (
                        <>
                            {/* Schedule Style Selector */}
                            {onScheduleStyleChange && (
                                <div className="mb-4">
                                    {!activeCharacter?.scheduleStyle && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-3">
                                            <p className="text-xs text-amber-700 font-bold mb-1">请选择日程风格</p>
                                            <p className="text-[11px] text-amber-600 leading-relaxed">
                                                不同风格会影响角色的内心独白生成方式。选择后会自动重新生成今日日程。
                                            </p>
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => onScheduleStyleChange('lifestyle')}
                                            disabled={isScheduleGenerating}
                                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                                                (activeCharacter?.scheduleStyle || 'lifestyle') === 'lifestyle'
                                                    ? 'bg-violet-100 border-violet-300 text-violet-700'
                                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                            }`}
                                        >
                                            <span className="block text-sm mb-0.5">生活系</span>
                                            <span className="block text-[10px] opacity-70 font-normal">虚构日常 · 跑步做饭逛街</span>
                                        </button>
                                        <button
                                            onClick={() => onScheduleStyleChange('mindful')}
                                            disabled={isScheduleGenerating}
                                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all border ${
                                                activeCharacter?.scheduleStyle === 'mindful'
                                                    ? 'bg-teal-100 border-teal-300 text-teal-700'
                                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                                            }`}
                                        >
                                            <span className="block text-sm mb-0.5">意识系</span>
                                            <span className="block text-[10px] opacity-70 font-normal">真实内心 · 不虚构不说谎</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            <ScheduleCard
                                schedule={scheduleData || null}
                                character={activeCharacter}
                                compact={false}
                                onEdit={onScheduleEdit}
                                onDelete={onScheduleDelete}
                                onReroll={onScheduleReroll}
                                onCoverImageChange={onScheduleCoverChange}
                                isGenerating={isScheduleGenerating}
                            />
                            <p className="text-[10px] text-slate-400 text-center mt-3 leading-relaxed">
                                点击日程项可编辑 · 长按可删除
                            </p>

                            {/* 情绪 buff 现已合并到主回复，无需单独配置 API。此处 API 仅用于日程生成。 */}
                            {activeCharacter && apiPresets && onAddApiPreset && onSaveEmotion && onClearBuffs && (
                                <EmotionSettingsPanel
                                    char={activeCharacter}
                                    apiPresets={apiPresets}
                                    addApiPreset={onAddApiPreset}
                                    onSave={onSaveEmotion}
                                    onClearBuffs={onClearBuffs}
                                />
                            )}
                        </>
                    )}
                </div>
            </Modal>
        </>
    );
};

export default ChatModals;
