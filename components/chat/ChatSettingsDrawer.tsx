
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash, MagnifyingGlass } from '@phosphor-icons/react';
import { CharacterProfile } from '../../types';
import { DB } from '../../utils/db';
import { isMessageSemanticallyRelevant } from '../../utils/messageFormat';

interface ChatSettingsDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    activeCharacter: CharacterProfile;

    // 聊天背景
    onBgUpload: (file: File) => void;
    onRemoveBg: () => void;

    // 搜索聊天记录
    onOpenSearch: () => void;

    // 语音消息
    chatVoiceEnabled: boolean;
    onToggleChatVoice: () => void;
    chatVoiceLang: string;
    onSetChatVoiceLang: (lang: string) => void;

    // 心声（独立于日程）
    emotionEnabled: boolean;
    onToggleEmotion: () => void;

    // 上下文条数
    contextLimit: number;
    onSetContextLimit: (n: number) => void;

    // 暮色 2026-07-18：聊天模式开关（'full' = 完整 / 'pure' = 纯聊天）
    chatMode: 'full' | 'pure';
    onSetChatMode: (mode: 'full' | 'pure') => void;

    // 隐藏系统日志
    hideSysLogs: boolean;
    onSetHideSysLogs: (v: boolean) => void;

    // 翻译
    translationEnabled: boolean;
    onToggleTranslation: () => void;
    translateSourceLang: string;
    translateTargetLang: string;
    onSetTranslateSourceLang: (lang: string) => void;
    onSetTranslateLang: (lang: string) => void;

    // 小红书
    xhsEnabled: boolean;
    onToggleXhs: () => void;

    // HTML 模块模式
    htmlModeEnabled: boolean;
    onToggleHtmlMode: () => void;
    htmlModeCustomPrompt: string;
    onSetHtmlModeCustomPrompt: (v: string) => void;

    // 管理上下文
    onOpenHistoryManager: () => void;

    // 记忆宫殿一键向量化
    isMemoryPalaceEnabled: boolean;
    isVectorizing: boolean;
    onForceVectorize: () => void;

    // 危险区域
    preserveCount: number;
    setPreserveCount: (v: number) => void;
    onClearHistory: () => void;

    // 角色独立 API（暮色 2026-07-24）
    perCharApiBaseUrl: string;
    setPerCharApiBaseUrl: (v: string) => void;
    perCharApiKey: string;
    setPerCharApiKey: (v: string) => void;
    perCharApiModel: string;
    setPerCharApiModel: (v: string) => void;
    showPerCharKey: boolean;
    setShowPerCharKey: (v: boolean) => void;
    onSavePerCharApi: () => void;
    onClearPerCharApi: () => void;
}

const ChatSettingsDrawer: React.FC<ChatSettingsDrawerProps> = ({
    isOpen, onClose, activeCharacter,
    onBgUpload, onRemoveBg, onOpenSearch,
    chatVoiceEnabled, onToggleChatVoice, chatVoiceLang, onSetChatVoiceLang,
    emotionEnabled, onToggleEmotion,
    contextLimit, onSetContextLimit,
    chatMode, onSetChatMode,
    hideSysLogs, onSetHideSysLogs,
    translationEnabled, onToggleTranslation, translateSourceLang, translateTargetLang, onSetTranslateSourceLang, onSetTranslateLang,
    xhsEnabled, onToggleXhs,
    htmlModeEnabled, onToggleHtmlMode, htmlModeCustomPrompt, onSetHtmlModeCustomPrompt,
    onOpenHistoryManager,
    isMemoryPalaceEnabled, isVectorizing, onForceVectorize,
    preserveCount, setPreserveCount,
    onClearHistory,

    // 角色独立 API（暮色 2026-07-24）
    perCharApiBaseUrl, setPerCharApiBaseUrl,
    perCharApiKey, setPerCharApiKey,
    perCharApiModel, setPerCharApiModel,
    showPerCharKey, setShowPerCharKey,
    onSavePerCharApi, onClearPerCharApi,
}) => {
    const bgInputRef = useRef<HTMLInputElement>(null);

    // 暮色 2026-07-18：未向量化消息条数（提示用 — 上下文条数设置参考）
    //   记忆宫殿已向量化过的消息（id <= hwm）默认不进上下文
    //   "未向量化条数" = DB 里 id > hwm 且真正会进记忆宫殿的消息数
    //   查这个数 0 token 消耗（纯 localStorage + IndexedDB 客户端查询）
    const [unvectorizedCount, setUnvectorizedCount] = useState<number | null>(null);
    useEffect(() => {
        if (!isOpen || !activeCharacter?.id) return;
        let cancelled = false;
        (async () => {
            try {
                const hwm = parseInt(localStorage.getItem(`mp_lastMsgId_${activeCharacter.id}`) || '0', 10) || 0;
                // 查 char 所有消息数（limit 设大点）
                const allMsgs = await DB.getRecentMessagesByCharId(activeCharacter.id, 99999, true);
                if (cancelled) return;
                // 未向量化 = id > hwm，并排除纯图片/表情/语音占位
                const unvec = allMsgs.filter(m => m.id > hwm && isMessageSemanticallyRelevant(m)).length;
                setUnvectorizedCount(unvec);
            } catch (e) {
                console.error('Failed to count unvectorized messages:', e);
                if (!cancelled) setUnvectorizedCount(null);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, activeCharacter?.id]);

    const effectiveContextMax = Math.max(20, Math.min(5000, unvectorizedCount ?? 5000));
    const displayContextLimit = Math.min(contextLimit, effectiveContextMax);

    // Esc 关闭
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[200] bg-slate-900/45 backdrop-blur-[1px] animate-fade-in"
            onClick={onClose}
        >
            <div
                className="absolute right-0 top-0 bottom-0 w-[88%] max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right"
                onClick={e => e.stopPropagation()}
            >
                {/* 抽屉顶部：标题 + 关闭 */}
                <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
                    <div className="text-base font-bold text-slate-700">聊天设置</div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 active:scale-90"
                        title="关闭"
                        aria-label="关闭"
                    >
                        <X className="w-5 h-5" weight="bold" />
                    </button>
                </div>

                {/* 设置项：可滚动 */}
                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
                    {/* === 聊天背景（置顶） === */}
                    <section>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">聊天背景</label>
                        </div>
                        <div onClick={() => bgInputRef.current?.click()} className="h-24 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center cursor-pointer hover:border-primary/50 overflow-hidden relative">
                            {activeCharacter.chatBackground ? (
                                <img src={activeCharacter.chatBackground} className="w-full h-full object-cover opacity-60" />
                            ) : (
                                <span className="text-xs text-slate-400">点击上传图片（原画质）</span>
                            )}
                            {activeCharacter.chatBackground && (
                                <span className="absolute z-10 text-xs bg-white/80 px-2 py-1 rounded-lg">更换</span>
                            )}
                        </div>
                        <input
                            type="file"
                            ref={bgInputRef}
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => e.target.files?.[0] && onBgUpload(e.target.files[0])}
                        />
                        {activeCharacter.chatBackground && (
                            <button onClick={onRemoveBg} className="text-[10px] text-red-400 mt-1.5">移除背景</button>
                        )}
                    </section>

                    {/* === 聊天模式（暮色 2026-07-18 新增，背景下面第一位） === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">聊天模式</label>
                        </div>
                        <div className="flex gap-1.5 bg-slate-100/60 p-1 rounded-xl">
                            <button
                                type="button"
                                onClick={() => onSetChatMode('full')}
                                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${chatMode !== 'pure' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                            >完整</button>
                            <button
                                type="button"
                                onClick={() => onSetChatMode('pure')}
                                className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${chatMode === 'pure' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                            >纯聊天</button>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            {chatMode === 'pure' ? (
                                <>✅ 纯聊天模式已开启：已关闭朋友圈/音乐/群聊/日记列表/笔记列表/心声底色/slotHeader/小红书/Notion/飞书/搜索/转账/HTML。目标就是只留聊天必要内容。</>
                            ) : (
                                <>纯聊天模式会关闭朋友圈/音乐/群聊/日记列表/笔记列表/心声底色/slotHeader/小红书/Notion/飞书/搜索/转账/HTML，只保留对话必要内容。</>
                            )}
                        </p>
                    </section>

                    {/* === 心声（独立于日程）— 模式切换下面，暮色 2026-07-18 要求 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleEmotion}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">心声</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${emotionEnabled ? 'bg-violet-400' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${emotionEnabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后，角色会在聊天中自动生成一段第一人称的内心独白。
                        </p>
                    </section>

                    {/* === 语音消息 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleChatVoice}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">语音消息</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${chatVoiceEnabled ? 'bg-emerald-400' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${chatVoiceEnabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后，AI 回复自动生成语音条（需配置 MiniMax 和角色语音）。
                        </p>
                        {chatVoiceEnabled && (
                            <div className="mt-3">
                                <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">语音语种</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {[{v:'',l:'默认'},{v:'en',l:'English'},{v:'ja',l:'日本語'},{v:'ko',l:'한국어'},{v:'fr',l:'Français'},{v:'es',l:'Español'}].map(opt => (
                                        <button key={opt.v} onClick={() => onSetChatVoiceLang(opt.v)}
                                            className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${chatVoiceLang === opt.v ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                            {opt.l}
                                        </button>
                                    ))}
                                </div>
                                {chatVoiceLang && <p className="text-[10px] text-emerald-600/70 mt-1.5">选择非默认语种时，AI 台词会先翻译再生成语音。</p>}
                            </div>
                        )}
                    </section>

                    {/* === 搜索聊天记录（挪到上下文条数上面，暮色 2026-07-18 要求） === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">搜索聊天记录</label>
                            <button
                                onClick={onOpenSearch}
                                title="搜索聊天记录"
                                aria-label="搜索聊天记录"
                                className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 active:scale-90 transition-transform"
                            >
                                <MagnifyingGlass className="w-4.5 h-4.5" weight="bold" />
                            </button>
                        </div>
                    </section>

                    {/* === 上下文条数 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">上下文条数 ({displayContextLimit})</label>
                        </div>
                        <input
                            type="range"
                            min="20"
                            max={effectiveContextMax}
                            step="10"
                            value={displayContextLimit}
                            onChange={e => onSetContextLimit(Math.min(parseInt(e.target.value), effectiveContextMax))}
                            className="w-full h-2 bg-slate-200 rounded-full appearance-none accent-primary"
                        />
                        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                            <span>20 (省流)</span>
                            <span>{effectiveContextMax} (当前上限)</span>
                        </div>
                        {/* 暮色 2026-07-18：未向量化条数提示 + 解释记忆宫殿过滤 */}
                        {unvectorizedCount !== null && (
                            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                                💡 当前还有 <b className="text-slate-600">{unvectorizedCount}</b> 条未进入记忆宫殿向量化，实际生效的上下文条数 ≤ {unvectorizedCount}。
                                <br />已向量化的消息不再重复发给 AI，节省 token。
                            </p>
                        )}
                    </section>

                    {/* === 隐藏系统日志 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => onSetHideSysLogs(!hideSysLogs)}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">隐藏系统日志</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${hideSysLogs ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${hideSysLogs ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后，将不再显示 Date/App 产生的上下文提示文本（转账、戳一戳、图片发送提示除外）。
                        </p>
                    </section>

                    {/* === 消息翻译 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleTranslation}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">消息翻译</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${translationEnabled ? 'bg-primary' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${translationEnabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后，AI 消息自动翻译为「选」的语言显示，点「译」切换到目标语言。
                        </p>
                        {translationEnabled && (
                            <div className="mt-3 space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">选（气泡显示语言）</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                            <button
                                                key={`src-${lang}`}
                                                onClick={() => onSetTranslateSourceLang(lang)}
                                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateSourceLang === lang ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {lang}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">译（翻译目标语言）</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {['中文', 'English', '日本語', '한국어', 'Français', 'Español'].map(lang => (
                                            <button
                                                key={`tgt-${lang}`}
                                                onClick={() => onSetTranslateLang(lang)}
                                                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${translateTargetLang === lang ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {lang}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="text-[11px] text-center text-slate-500 bg-slate-50 rounded-lg py-2">
                                    选<span className="font-bold text-slate-700">{translateSourceLang || '?'}</span> 译<span className="font-bold text-primary">{translateTargetLang || '?'}</span>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* === 小红书 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleXhs}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">小红书</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${xhsEnabled ? 'bg-red-400' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${xhsEnabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后，角色在聊天中可以搜索、浏览、发帖、评论小红书。需要在全局设置中配置 MCP 或 Cookie。
                        </p>
                    </section>

                    {/* === HTML 模块模式 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between cursor-pointer" onClick={onToggleHtmlMode}>
                            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider pointer-events-none">HTML 模块模式</label>
                            <div className={`w-10 h-6 rounded-full p-1 transition-colors flex items-center ${htmlModeEnabled ? 'bg-fuchsia-500' : 'bg-slate-200'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${htmlModeEnabled ? 'translate-x-4' : ''}`} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                            开启后注入"用 [html]...[/html] 包裹的精美卡片"提示词，AI 会在合适场景输出邀请函 / 票据 / 通知等可视化模块。
                            历史上下文里只保留剥离 HTML 后的文字摘要，不浪费 token。
                        </p>
                        {htmlModeEnabled && (
                            <div className="mt-3">
                                <label className="text-[10px] font-bold text-slate-400 mb-1.5 block">自定义提示词补充（追加在内置提示词之后，不会覆盖）</label>
                                <textarea
                                    value={htmlModeCustomPrompt}
                                    onChange={e => onSetHtmlModeCustomPrompt(e.target.value)}
                                    placeholder="比如：偏好暖色调 / 默认风格走 minimal 杂志感 / 票据类必须含二维码占位…"
                                    className="w-full h-28 bg-slate-50 rounded-2xl p-3 text-[12px] resize-none border border-slate-200 focus:outline-none focus:border-fuchsia-300"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">留空则只使用内置提示词。</p>
                            </div>
                        )}
                    </section>

                    {/* === 角色独立 API（暮色 2026-07-24）==  */}
                    <section className="pt-2 border-t border-slate-100">
                        <div className="text-[11px] font-bold text-slate-500 mb-2">🔌 这个角色的 API</div>
                        <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                            留空就用全局 API 设置。设了的话，跟这个角色说话走自己的通道。
                        </p>
                        <div className="space-y-2.5">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Base URL</label>
                                <input
                                    type="text"
                                    value={perCharApiBaseUrl}
                                    onChange={(e) => setPerCharApiBaseUrl(e.target.value)}
                                    placeholder="留空回退全局"
                                    className="w-full bg-slate-50 rounded-xl p-2.5 text-[12px] font-mono border border-slate-200 focus:outline-none focus:border-emerald-300"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">API Key</label>
                                <div className="relative">
                                    <input
                                        type={showPerCharKey ? 'text' : 'password'}
                                        value={perCharApiKey}
                                        onChange={(e) => setPerCharApiKey(e.target.value)}
                                        placeholder="留空回退全局"
                                        className="w-full bg-slate-50 rounded-xl p-2.5 pr-14 text-[12px] font-mono border border-slate-200 focus:outline-none focus:border-emerald-300"
                                    />
                                    <button onClick={() => setShowPerCharKey(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold px-2 py-0.5 rounded">
                                        {showPerCharKey ? '隐藏' : '显示'}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">Model</label>
                                <input
                                    type="text"
                                    value={perCharApiModel}
                                    onChange={(e) => setPerCharApiModel(e.target.value)}
                                    placeholder="留空回退全局"
                                    className="w-full bg-slate-50 rounded-xl p-2.5 text-[12px] font-mono border border-slate-200 focus:outline-none focus:border-emerald-300"
                                />
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={onSavePerCharApi} className="flex-1 py-2.5 bg-emerald-500 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform">保存</button>
                                {perCharApiBaseUrl && (
                                    <button onClick={onClearPerCharApi} className="px-4 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl active:scale-95 transition-transform">清空（用全局）</button>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* === 管理上下文 / 隐藏历史 === */}
                    <section className="pt-2 border-t border-slate-100">
                        <button onClick={onOpenHistoryManager} className="w-full py-3 bg-slate-50 text-slate-600 font-bold rounded-2xl border border-slate-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                            管理上下文 / 隐藏历史
                        </button>
                        <p className="text-[10px] text-slate-400 mt-2 text-center">可选择从某条消息开始显示，隐藏之前的记录（不被 AI 读取）。</p>
                    </section>

                    {/* === 记忆宫殿：一键向量化 === */}
                    {isMemoryPalaceEnabled && (
                        <section className="pt-2 border-t border-slate-100">
                            <button
                                onClick={onForceVectorize}
                                disabled={isVectorizing}
                                className="w-full py-3 bg-emerald-50 text-emerald-600 font-bold rounded-2xl border border-emerald-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                            >
                                {isVectorizing ? '🏰 向量化处理中...' : '🏰 一键向量化所有聊天记录'}
                            </button>
                            <p className="text-[10px] text-slate-400 mt-2 text-center leading-relaxed">
                                将所有未处理的聊天记录交给记忆宫殿向量化，完成后可安全清空聊天。<br />
                                <span className="text-slate-300">看不懂这是什么的话不需要操作此按钮。</span>
                            </p>
                        </section>
                    )}

                    {/* === 危险区域 === */}
                    <section className="pt-2 border-t border-red-100 mt-2">
                        <div className="text-[11px] font-bold text-red-400 uppercase mb-3">危险区域 (Danger Zone)</div>
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-[12px] text-slate-600 whitespace-nowrap">清空时建议保留最后</span>
                            <input
                                type="number"
                                min={0}
                                value={preserveCount ?? 10}
                                onChange={(e) => setPreserveCount(Math.max(0, parseInt(e.target.value) || 0))}
                                className="w-14 text-center text-sm font-bold border border-slate-300 rounded-lg py-1 px-1 focus:ring-1 focus:ring-primary/30 focus:border-primary"
                            />
                            <span className="text-[12px] text-slate-600 whitespace-nowrap">条记录以维持语境</span>
                        </div>
                        <button
                            onClick={onClearHistory}
                            className="w-full py-3 bg-red-50 text-red-500 font-bold rounded-2xl border border-red-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                        >
                            <Trash className="w-4 h-4" weight="bold" />
                            执行清空
                        </button>
                        <p className="text-[10px] text-red-300/80 mt-2 text-center leading-relaxed">
                            不可恢复。建议先到「记忆宫殿」一键向量化后再清空。
                        </p>
                    </section>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ChatSettingsDrawer;
