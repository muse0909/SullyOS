
import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CaretDown } from '@phosphor-icons/react';
import Modal from '../os/Modal';
import { CharacterProfile, Message, EmojiCategory, DailySchedule, ScheduleSlot, ApiPreset, APIConfig } from '../../types';
import ScheduleCard from '../schedule/ScheduleCard';
import { saveRemoteImage } from '../../utils/file';
import { addFavorite, genFavoriteId, getAllFavorites } from '../../utils/favoritesStorage';
import { useOS } from '../../context/OSContext';

interface ChatModalsProps {
    modalType: string;
    setModalType: (v: any) => void;
    // Data Props
    transferAmt: string;
    setTransferAmt: (v: string) => void;
    emojiImportText: string;
    setEmojiImportText: (v: string) => void;

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
    // Emoji Manager（新全屏管理页）— 父组件 Chat.tsx 传入
    categories: EmojiCategory[];
    activeCategory: string;
    onSaveManagerOrder?: () => void;
    onBatchDeleteEmojis?: (names: string[]) => void;
    onMoveEmojisToCategory?: (names: string[], targetCategoryId: string) => void;
    onRenameEmojiInManager?: (oldName: string, newName: string) => void;
    // 切换管理页当前分类（点顶部下拉菜单里其他分类时调）
    onActiveCategoryChange?: (id: string) => void;
    // Category Visibility
    allCharacters?: CharacterProfile[];
    onSaveCategoryVisibility?: (categoryId: string, allowedCharacterIds: string[] | undefined) => void;
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
    // Voice generation from long-press
    onGenerateVoice?: () => void;
    voiceAvailable?: boolean; // true if char has voiceProfile configured
}

const ChatModals: React.FC<ChatModalsProps> = ({
    modalType, setModalType,
    transferAmt, setTransferAmt,
    emojiImportText, setEmojiImportText,
    editContent, setEditContent,
    newCategoryName, setNewCategoryName, onAddCategory,
    archivePrompts, selectedPromptId, setSelectedPromptId,
    editingPrompt, setEditingPrompt, isSummarizing, archiveProgress,
    selectedMessage, selectedEmoji, selectedCategory, activeCharacter, messages,
    allHistoryMessages = [],
    onTransfer, onImportEmoji, onClearHistory,
    onArchive, onCreatePrompt, onEditPrompt, onSavePrompt, onDeletePrompt,
    onSetHistoryStart, onEnterSelectionMode, onReplyMessage, onEditMessageStart, onConfirmEditMessage, onDeleteMessage, onCopyMessage, onDeleteEmoji, onDeleteCategory,
    editEmojiNewName, setEditEmojiNewName, onEditEmojiConfirm,
    reorderList, onSaveReorder, onCancelReorder, onMoveEmoji,
    categories, activeCategory,
    onSaveManagerOrder, onBatchDeleteEmojis, onMoveEmojisToCategory, onRenameEmojiInManager, onActiveCategoryChange,
    allCharacters = [], onSaveCategoryVisibility,
    scheduleData, isScheduleGenerating, onScheduleEdit, onScheduleDelete, onScheduleReroll, onScheduleCoverChange,
    onScheduleStyleChange,
    isScheduleFeatureEnabled, onToggleScheduleFeature,
    voiceAvailable, onGenerateVoice,
}) => {
    const { addToast } = useOS();
    const [visibilitySelection, setVisibilitySelection] = useState<Set<string>>(new Set());
    const [historyPage, setHistoryPage] = useState(0);
    const HISTORY_PAGE_SIZE = 50;

    // --- Emoji Manager 状态（取代旧的 emoji-options / emoji-reorder 长按弹窗）---
    const [selectedEmojiNames, setSelectedEmojiNames] = useState<Set<string>>(new Set());
    const [showMoveEmojiModal, setShowMoveEmojiModal] = useState(false);
    const [showBatchDeleteEmojiConfirm, setShowBatchDeleteEmojiConfirm] = useState(false);
    // 重命名 inline 模式：1 个选中时点"重命名" → 上下文条变成输入条
    const [isRenamingEmoji, setIsRenamingEmoji] = useState(false);
    // 顶部"管理表情包 · X"点击展开分类切换下拉
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [renameEmojiValue, setRenameEmojiValue] = useState('');

    // 关闭 manager 前保存顺序（拖动改的）— 父组件传 onSaveManagerOrder
    const handleCloseManager = () => {
        if (reorderList.length > 0) {
            onSaveManagerOrder?.();
        }
        // 清理 manager 内部状态，避免下次打开残留
        setSelectedEmojiNames(new Set());
        setIsRenamingEmoji(false);
        setRenameEmojiValue('');
        setShowMoveEmojiModal(false);
        setShowBatchDeleteEmojiConfirm(false);
        setModalType('none');
    };

    const toggleSelectEmoji = (name: string) => {
        setSelectedEmojiNames(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const toggleSelectAllEmojis = () => {
        const allNames = reorderList.map(e => e.name);
        if (selectedEmojiNames.size === reorderList.length) {
            setSelectedEmojiNames(new Set());
        } else {
            setSelectedEmojiNames(new Set(allNames));
        }
    };

    const clearEmojiSelection = () => setSelectedEmojiNames(new Set());

    const startRenameEmoji = () => {
        if (selectedEmojiNames.size !== 1) return;
        const name = Array.from(selectedEmojiNames)[0];
        setRenameEmojiValue(name);
        setIsRenamingEmoji(true);
    };

    const handleConfirmRenameEmoji = () => {
        const oldName = Array.from(selectedEmojiNames)[0];
        const newName = renameEmojiValue.trim();
        if (!oldName) {
            setIsRenamingEmoji(false);
            return;
        }
        if (!newName) {
            addToast('名字不能为空', 'error');
            return;
        }
        if (newName === oldName) {
            setIsRenamingEmoji(false);
            return;
        }
        if (reorderList.some(e => e.name === newName)) {
            addToast('已存在同名表情包', 'error');
            return;
        }
        // 直接调父组件的改名 handler
        onRenameEmojiInManager?.(oldName, newName);
        setIsRenamingEmoji(false);
        setSelectedEmojiNames(new Set());
    };

    const handleMoveEmojisToCategory = (targetCategoryId: string) => {
        const names = Array.from(selectedEmojiNames);
        if (names.length === 0) return;
        onMoveEmojisToCategory?.(names, targetCategoryId);
        setShowMoveEmojiModal(false);
        setSelectedEmojiNames(new Set());
    };

    const handleConfirmBatchDeleteEmojis = () => {
        const names = Array.from(selectedEmojiNames);
        if (names.length === 0) {
            setShowBatchDeleteEmojiConfirm(false);
            return;
        }
        onBatchDeleteEmojis?.(names);
        setShowBatchDeleteEmojiConfirm(false);
        setSelectedEmojiNames(new Set());
    };

    // 拖动排序在 mobile touchmove 拦截、PC 鼠标长按别扭，passive listener 等一堆坑里反复挣扎后，
    // 改用最稳的方案：选中 1 个时 tile 上下加 ↑↓ 浮动按钮，点击 = 移动一格。
    // 工具栏 1 选中态加 [置顶] [置底] 按钮，长距离移动更快。
    // 这里不需要任何 drag state，直接用 props 里的 reorderList + onMoveEmoji。

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
            
            <Modal isOpen={modalType === 'message-options'} title="消息操作" onClose={() => setModalType('none')} adaptiveHeight footer={<></>}>
                <div className="grid grid-cols-2 gap-3">
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

                    {/* 收藏消息 — 用户/AI 文本消息都支持（type: 'text'） */}
                    {selectedMessage?.type === 'text' && selectedMessage?.content && (
                        <button
                            onClick={() => {
                                if (!selectedMessage) return;
                                const text = selectedMessage.content || '';
                                if (!text.trim()) return;
                                // 防重复：同 sourceMessageId 不重复加
                                const existing = getAllFavorites().find(
                                    (f) => f.sourceMessageId === selectedMessage.id && f.type === 'text'
                                );
                                if (existing) {
                                    addToast('这条消息已收藏过', 'info');
                                    return;
                                }
                                addFavorite({
                                    id: genFavoriteId(),
                                    type: 'text',
                                    text: text,
                                    charId: activeCharacter.id,
                                    charName: activeCharacter.name,
                                    sourceMessageId: selectedMessage.id,
                                    createdAt: Date.now(),
                                });
                                addToast('已加入收藏', 'success');
                                setModalType('none');
                            }}
                            className="w-full py-3 bg-amber-50 text-amber-600 font-medium rounded-2xl active:bg-amber-100 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                                <path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006Z" clipRule="evenodd" />
                            </svg>
                            收藏消息
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

            {/* Edit Emoji (rename) Modal — 编辑名字仍走这里（从 manager 的 1 选中态触发） */}
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
                    {selectedCategory && selectedCategory.id !== 'default' && (
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
                    className="w-full h-full min-h-[280px] bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed"
                />
            </Modal>

            {/* Schedule Modal */}
            <Modal
                isOpen={modalType === 'schedule'} title={`${activeCharacter?.name || '角色'}の日程`} onClose={() => setModalType('none')}
            >
                <div className="max-h-[70vh] overflow-y-auto -mx-2 px-2">
                    {/* 总开关：关闭时不生成日程（2026-06-29 与心声解耦后：不再影响情绪/意识流） */}
                    {onToggleScheduleFeature && (
                        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-2xl p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 pr-3">
                                    <p className="text-xs font-bold text-slate-700">日程</p>
                                    <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                                        {isScheduleFeatureEnabled
                                            ? '已开启：会生成今日日程。'
                                            : '已关闭：不生成日程。'}
                                    </p>
                                </div>
                                <button
                                    onClick={onToggleScheduleFeature}
                                    aria-label="切换日程总开关"
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
                        </>
                    )}
                </div>
            </Modal>

            {/* ===== Emoji Manager — 全屏管理页（createPortal 到 body 绕开 backdrop-filter 祖先） ===== */}
            {modalType === 'emoji-manager' && createPortal(
                <div className="fixed inset-0 z-[100] bg-slate-50 flex flex-col">
                    {/* 顶部标题栏 — sticky（标题是可点开下拉切分类的按钮） */}
                    <div
                        className="relative shrink-0 bg-white border-b border-slate-200 px-3 py-3 flex items-center gap-2"
                        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
                    >
                        <button
                            onClick={handleCloseManager}
                            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center shrink-0"
                            aria-label="返回"
                        >
                            <ArrowLeft className="w-4 h-4 text-slate-700" weight="bold" />
                        </button>
                        <button
                            onClick={() => setShowCategoryDropdown(v => !v)}
                            className="flex-1 flex items-center justify-center gap-1 text-base font-bold text-slate-800 active:opacity-70 min-w-0"
                            title="点击切换分类"
                        >
                            <span className="truncate">管理表情包 · {(activeCategory || 'default') === 'default' ? '默认' : (categories?.find(c => c.id === activeCategory)?.name || '未知')}</span>
                            <CaretDown className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${showCategoryDropdown ? 'rotate-180' : ''}`} weight="bold" />
                        </button>
                        {/* 占位保持标题居中 */}
                        <div className="w-9 h-9 shrink-0" />
                        {/* 分类切换下拉浮层（点空白处关闭） */}
                        {showCategoryDropdown && (
                            <>
                                <div className="fixed inset-0 z-30" onClick={() => setShowCategoryDropdown(false)} />
                                <div className="absolute top-full left-3 right-3 mt-1 bg-white border border-slate-200 rounded-2xl shadow-lg z-40 max-h-60 overflow-y-auto no-scrollbar">
                                    {[{ id: 'default', name: '默认' }, ...(categories || [])].map(cat => {
                                        const isActive = (activeCategory || 'default') === cat.id;
                                        return (
                                            <button
                                                key={cat.id}
                                                onClick={() => {
                                                    onActiveCategoryChange?.(cat.id);
                                                    setShowCategoryDropdown(false);
                                                    // 切分类时清空之前选中状态，避免跨分类误操作
                                                    setSelectedEmojiNames(new Set());
                                                    setIsRenamingEmoji(false);
                                                }}
                                                className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 transition-colors ${isActive ? 'bg-primary/10 text-primary font-bold' : 'text-slate-700 active:bg-slate-50'}`}
                                            >
                                                {isActive ? (
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3 shrink-0 text-primary">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                    </svg>
                                                ) : (
                                                    <span className="w-3 h-3 shrink-0" />
                                                )}
                                                <span className="truncate">{cat.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>

                    {/* 主体内容 — flex-1 滚动 */}
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-3 py-3">
                        <div className="space-y-3 max-w-2xl mx-auto">
                            {/* 顶部状态条：选中数 / 重命名 inline 输入 / 提示 */}
                            {isRenamingEmoji ? (
                                <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-2xl">
                                    <input
                                        autoFocus
                                        value={renameEmojiValue}
                                        onChange={e => setRenameEmojiValue(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleConfirmRenameEmoji()}
                                        maxLength={20}
                                        className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/30"
                                    />
                                    <button onClick={() => setIsRenamingEmoji(false)} className="px-3 py-1.5 text-xs bg-slate-100 text-slate-600 font-bold rounded-full active:scale-95 transition-transform">取消</button>
                                    <button onClick={handleConfirmRenameEmoji} className="px-3 py-1.5 text-xs bg-primary text-white font-bold rounded-full active:scale-95 transition-transform">保存</button>
                                </div>
                            ) : selectedEmojiNames.size > 0 ? (
                                <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border border-primary/20 rounded-2xl">
                                    <span className="text-xs text-primary font-bold">已选 {selectedEmojiNames.size} 个</span>
                                    <button
                                        onClick={clearEmojiSelection}
                                        className="px-3 py-1 text-xs text-slate-500 font-medium active:scale-95 transition-transform"
                                    >
                                        取消选择
                                    </button>
                                </div>
                            ) : (
                                <p className="text-[10px] text-slate-400 text-center">点击选择 · 选中后用 ↑↓ 按钮或工具栏「置顶/置底」调整顺序</p>
                            )}

                            {/* 表情包网格：点选 + 选中 1 个时 tile 上下各显示 ↑↓ 浮动按钮（管移动一格） */}
                            <div className="grid grid-cols-5 gap-2 select-none">
                                {reorderList.length === 0 ? (
                                    <p className="col-span-5 text-center text-sm text-slate-400 py-6">当前分类下没有表情包</p>
                                ) : reorderList.map((e, idx) => {
                                    const isSelected = selectedEmojiNames.has(e.name);
                                    return (
                                        <div
                                            key={e.name}
                                            className={`relative aspect-square rounded-xl border-2 transition-all select-none ${
                                                isSelected
                                                    ? 'border-primary bg-primary/5'
                                                    : 'border-slate-200/60 bg-white'
                                            }`}
                                        >
                                            <button
                                                onClick={() => toggleSelectEmoji(e.name)}
                                                className="w-full h-full p-1 active:scale-95 transition-transform"
                                            >
                                                <img src={e.url} className={`w-full h-full object-contain pointer-events-none transition-opacity ${isSelected ? 'opacity-60' : ''}`} />
                                                <span className="absolute bottom-0 left-0.5 right-0.5 text-[8px] text-slate-500 text-center truncate pointer-events-none leading-tight">{e.name}</span>
                                            </button>
                                            {/* 选中标识（右上对勾） */}
                                            {isSelected && (
                                                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center shadow-sm pointer-events-none z-10">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-2.5 h-2.5 text-white">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                    </svg>
                                                </div>
                                            )}
                                            {/* 上下左右 4 个浮动箭头：1 选中时显示，点 = 移动一格到正上/正下/正左/正右
                                                注意：grid 是 5 列 1D 数组，idx ± 5 是上下方向（同一列），idx ± 1 是左右方向（同一行） */}
                                            {isSelected && (() => {
                                                const COLS = 5;
                                                const canUp = idx - COLS >= 0;
                                                const canDown = idx + COLS < reorderList.length;
                                                const canLeft = idx % COLS !== 0;
                                                const canRight = (idx + 1) % COLS !== 0 && idx + 1 < reorderList.length;
                                                const arrowClass = (enabled: boolean) => `absolute w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-md z-20 ${enabled ? 'bg-primary active:scale-90' : 'bg-slate-300'}`;
                                                return (
                                                    <>
                                                        {/* ↑ 上：移到正上方（同列上一行） */}
                                                        <button
                                                            onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx - COLS); }}
                                                            disabled={!canUp}
                                                            title="向上移"
                                                            aria-label="向上移"
                                                            className={`${arrowClass(canUp)} -top-2 left-1/2 -translate-x-1/2`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
                                                        </button>
                                                        {/* ↓ 下：移到正下方（同列下一行） */}
                                                        <button
                                                            onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx + COLS); }}
                                                            disabled={!canDown}
                                                            title="向下移"
                                                            aria-label="向下移"
                                                            className={`${arrowClass(canDown)} -bottom-2 left-1/2 -translate-x-1/2`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                                        </button>
                                                        {/* ← 左：移到正左方（同行前一列） */}
                                                        <button
                                                            onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx - 1); }}
                                                            disabled={!canLeft}
                                                            title="向左移"
                                                            aria-label="向左移"
                                                            className={`${arrowClass(canLeft)} top-1/2 -left-2 -translate-y-1/2`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                                                        </button>
                                                        {/* → 右：移到正右方（同行后一列） */}
                                                        <button
                                                            onClick={(ev) => { ev.stopPropagation(); onMoveEmoji(idx, idx + 1); }}
                                                            disabled={!canRight}
                                                            title="向右移"
                                                            aria-label="向右移"
                                                            className={`${arrowClass(canRight)} top-1/2 -right-2 -translate-y-1/2`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* 底部工具栏 — sticky 底部 */}
                    <div
                        className="shrink-0 bg-white border-t border-slate-200 px-3 py-3"
                        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
                    >
                        <div className="max-w-2xl mx-auto flex gap-2">
                            {selectedEmojiNames.size === 0 ? (
                                // 0 选中：全选 + 完成
                                <>
                                    <button
                                        onClick={toggleSelectAllEmojis}
                                        disabled={reorderList.length === 0}
                                        className={`flex-1 py-3 rounded-full font-bold transition-colors ${reorderList.length === 0 ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-700 active:bg-slate-200'}`}
                                    >
                                        {reorderList.length > 0 && selectedEmojiNames.size === reorderList.length ? '取消全选' : '全选'}
                                    </button>
                                    <button
                                        onClick={handleCloseManager}
                                        className="flex-1 py-3 bg-primary text-white font-bold rounded-full active:scale-95 transition-transform"
                                    >
                                        完成
                                    </button>
                                </>
                            ) : selectedEmojiNames.size === 1 ? (
                                // 1 选中：置顶 + 置底 + 重命名 + 移动 + 删除（5 按钮）
                                // 先调 onMoveEmoji 把选中项移到 0 或 last 位置，max-w-2xl 居中够放
                                <>
                                    <button
                                        onClick={() => {
                                            const idx = reorderList.findIndex(e => selectedEmojiNames.has(e.name));
                                            if (idx > 0) onMoveEmoji(idx, 0);
                                        }}
                                        disabled={reorderList.length < 2 || reorderList.findIndex(e => selectedEmojiNames.has(e.name)) === 0}
                                        className={`flex-1 py-3 rounded-full font-bold transition-colors ${reorderList.length < 2 || reorderList.findIndex(e => selectedEmojiNames.has(e.name)) === 0 ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-700 active:bg-slate-200'}`}
                                    >
                                        置顶
                                    </button>
                                    <button
                                        onClick={() => {
                                            const idx = reorderList.findIndex(e => selectedEmojiNames.has(e.name));
                                            if (idx !== -1 && idx < reorderList.length - 1) onMoveEmoji(idx, reorderList.length - 1);
                                        }}
                                        disabled={reorderList.length < 2 || reorderList.findIndex(e => selectedEmojiNames.has(e.name)) === reorderList.length - 1}
                                        className={`flex-1 py-3 rounded-full font-bold transition-colors ${reorderList.length < 2 || reorderList.findIndex(e => selectedEmojiNames.has(e.name)) === reorderList.length - 1 ? 'bg-slate-100 text-slate-300' : 'bg-slate-100 text-slate-700 active:bg-slate-200'}`}
                                    >
                                        置底
                                    </button>
                                    <button
                                        onClick={startRenameEmoji}
                                        className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-full active:bg-slate-200 transition-colors"
                                    >
                                        重命名
                                    </button>
                                    <button
                                        onClick={() => setShowMoveEmojiModal(true)}
                                        className="flex-1 py-3 bg-amber-50 text-amber-600 font-bold rounded-full active:bg-amber-100 transition-colors"
                                    >
                                        移动
                                    </button>
                                    <button
                                        onClick={() => setShowBatchDeleteEmojiConfirm(true)}
                                        className="flex-1 py-3 bg-red-500 text-white font-bold rounded-full active:bg-red-600 transition-colors"
                                    >
                                        删除
                                    </button>
                                </>
                            ) : (
                                // ≥2 选中：取消选择 + 移动 + 删除(N)
                                <>
                                    <button
                                        onClick={clearEmojiSelection}
                                        className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-full active:bg-slate-200 transition-colors"
                                    >
                                        取消选择
                                    </button>
                                    <button
                                        onClick={() => setShowMoveEmojiModal(true)}
                                        className="flex-1 py-3 bg-amber-50 text-amber-600 font-bold rounded-full active:bg-amber-100 transition-colors"
                                    >
                                        移动
                                    </button>
                                    <button
                                        onClick={() => setShowBatchDeleteEmojiConfirm(true)}
                                        className="flex-1 py-3 bg-red-500 text-white font-bold rounded-full active:bg-red-600 transition-colors"
                                    >
                                        删除({selectedEmojiNames.size})
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 子弹窗层（绝对定位覆盖在 manager 上面，z-10 相对父层） */}
                    {showMoveEmojiModal && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 animate-fade-in">
                            <div className="absolute inset-0 bg-black/40" onClick={() => setShowMoveEmojiModal(false)} />
                            <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up max-h-[80vh] flex flex-col">
                                <div className="px-6 pt-6 pb-2 shrink-0">
                                    <h3 className="text-lg font-bold text-slate-800 text-center">移动到分类</h3>
                                </div>
                                <div className="px-6 py-4 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                                    <div className="space-y-2">
                                        {(() => {
                                            const others = (categories || []).filter(c => c.id !== activeCategory && c.id !== 'default');
                                            const allTargets = activeCategory !== 'default'
                                                ? [{ id: 'default', name: '默认' }, ...others]
                                                : others;
                                            if (allTargets.length === 0) {
                                                return <p className="text-center text-sm text-slate-400 py-4">没有其他分类可移动</p>;
                                            }
                                            return allTargets.map(cat => (
                                                <button
                                                    key={cat.id}
                                                    onClick={() => handleMoveEmojisToCategory(cat.id)}
                                                    className="w-full py-3 px-4 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 rounded-2xl text-left font-bold text-sm text-slate-700 transition-colors flex items-center gap-2"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400 shrink-0">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" />
                                                    </svg>
                                                    {cat.name}
                                                </button>
                                            ));
                                        })()}
                                    </div>
                                </div>
                                <div className="px-6 pb-6 shrink-0">
                                    <button
                                        onClick={() => setShowMoveEmojiModal(false)}
                                        className="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
                                    >
                                        取消
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}


                    {showBatchDeleteEmojiConfirm && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 animate-fade-in">
                            <div className="absolute inset-0 bg-black/40" onClick={() => setShowBatchDeleteEmojiConfirm(false)} />
                            <div className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up flex flex-col">
                                <div className="px-6 pt-6 pb-2 shrink-0">
                                    <h3 className="text-lg font-bold text-slate-800 text-center">删除确认</h3>
                                </div>
                                <div className="px-6 py-4 flex-1 min-h-0">
                                    <div className="py-4 text-center">
                                        <p className="text-sm text-slate-600 leading-relaxed">
                                            确认删除 <span className="font-bold text-red-500 text-base mx-1">{selectedEmojiNames.size}</span> 个表情包？
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-2">删除后无法恢复</p>
                                    </div>
                                </div>
                                <div className="px-6 pb-6 flex gap-3 shrink-0">
                                    <button onClick={() => setShowBatchDeleteEmojiConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:bg-slate-200">取消</button>
                                    <button onClick={handleConfirmBatchDeleteEmojis} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl active:bg-red-600">删除</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}

            {/* Move Emoji + Delete Confirm 子弹窗（已经包含在上面的 emoji-manager createPortal 里渲染） */}
        </>
    );
};

export default ChatModals;
