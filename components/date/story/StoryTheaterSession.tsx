/**
 * 剧情剧院 Session — 暮色 8-25 第三步
 *
 * 核心功能:
 *   A. 双方收发消息(暮色发文字 → 调主 LLM 生成角色回复)
 *   B. 角色 system prompt 在进入 session 时追加 RP 模式专用指令
 *      (含默认兜底"你可以主动推动剧情...",预留 __RP_INJECTION_POINT__)
 *   C. 上下文管理:最近 5 轮保留原文,满 10 条触发 lightLLM 整理成叙事摘要
 *      (narrative 累加式合并,不是 JSON 数组)
 *   D. 退出时调 syncStoryToMainMemory:写 memory_node + 发 comment 到聊天框
 *
 * 不在本步:
 *   - 流式输出(第四步或之后)
 *   - 状态栏(第四步)
 *   - 多角色(暮色只要单人)
 *   - 面具(暮色不要)
 *   - 自定义预设 UI(类型已存,本步不实现 UI)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, PaperPlaneTilt, SpinnerGap, BookOpen } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { DB } from '../../../utils/db';
import { safeFetchJson } from '../../../utils/safeApi';
import { ContextBuilder } from '../../../utils/context';
import {
    getSessionMessages,
    appendSessionMessage,
    maybeSummarizeBatch,
    syncStoryToMainMemory,
    KEEP_RECENT,
} from '../../../utils/storyTheater';
import { buildRPSystemPrompt } from '../../../utils/storyTheater/prompts';
import { SELECT_THEME } from './storyTheme';
import type { CharacterProfile, Message, StoryTheaterEntry, UserProfile } from '../../../types';
import type { MemoryPalaceGlobalConfig } from '../../../context/OSContext';
import type { APIConfig } from '../../../types';

interface Props {
    entry: StoryTheaterEntry;
    onExit: () => void;     // 退出回列表页(已同步完成)
    onUpdateEntry: (entry: StoryTheaterEntry) => void;  // 摘要更新后通知父组件
}

const StoryTheaterSession: React.FC<Props> = ({ entry: initialEntry, onExit, onUpdateEntry }) => {
    const { characters, userProfile, apiConfig, memoryPalaceConfig, addToast } = useOS();
    const [entry, setEntry] = useState<StoryTheaterEntry>(initialEntry);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [summarizing, setSummarizing] = useState(false);
    const [showExitModal, setShowExitModal] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const char = characters.find(c => c.id === entry.characterId);
    if (!char) {
        return (
            <div className="h-full w-full flex items-center justify-center" style={{ background: SELECT_THEME.pageBg }}>
                <div className="text-center">
                    <div className="text-[14px] mb-3" style={{ color: SELECT_THEME.title }}>角色不存在</div>
                    <button onClick={onExit} className="px-4 py-2 rounded-xl text-[12px] font-bold" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>返回列表</button>
                </div>
            </div>
        );
    }

    // 加载历史消息
    const reload = useCallback(async () => {
        const msgs = await getSessionMessages(entry.id);
        setMessages(msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)));
    }, [entry.id]);

    useEffect(() => { void reload(); }, [reload]);

    // 滚到底
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages.length]);

    // 发送消息
    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || sending) return;
        setInput('');
        setSending(true);

        // 1. 追加 user 消息
        await appendSessionMessage(entry.id, 'user', text);
        await reload();

        // 2. 触发自动摘要(满 10 条才调)
        setSummarizing(true);
        const summarizerDeps = { memoryPalaceConfig, apiConfig, char, userProfile };
        try {
            const updated = await maybeSummarizeBatch(entry, summarizerDeps);
            if (updated) {
                setEntry(updated);
                onUpdateEntry(updated);
                addToast?.('已整理前 5 轮剧情', 'info');
            }
        } catch (e) {
            console.warn('[StoryTheater] auto-summarize failed:', e);
        } finally {
            setSummarizing(false);
        }

        // 3. 调主 LLM 生成角色回复
        try {
            const allMsgs = await getSessionMessages(entry.id);
            const recent = allMsgs.slice(-KEEP_RECENT);
            const reply = await callMainLLM({
                char,
                userProfile,
                entry: { ...entry, summary: entry.summary },
                history: recent.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
                apiConfig,
            });

            if (reply) {
                await appendSessionMessage(entry.id, 'assistant', reply);
                await reload();
            }
        } catch (e: any) {
            console.error('[StoryTheater] LLM call failed:', e);
            addToast?.(`角色回复失败: ${e?.message || e}`, 'error');
        } finally {
            setSending(false);
        }
    }, [input, sending, entry, char, userProfile, apiConfig, memoryPalaceConfig, addToast, reload, onUpdateEntry]);

    // 退出流程
    const handleExitClick = useCallback(() => {
        setShowExitModal(true);
    }, []);

    const handleConfirmExit = useCallback(async () => {
        if (syncing) return;
        setSyncing(true);
        setShowExitModal(false);
        addToast?.('正在同步到主记忆宫殿...', 'info');

        try {
            await syncStoryToMainMemory(entry, {
                memoryPalaceConfig,
                apiConfig,
                char,
                userProfile,
                addToast,
            });
        } catch (e) {
            console.error('[StoryTheater] sync failed:', e);
            addToast?.('同步失败,但剧场已保存', 'error');
        } finally {
            setSyncing(false);
            onExit();
        }
    }, [syncing, entry, memoryPalaceConfig, apiConfig, char, userProfile, addToast, onExit]);

    return (
        <div className="h-full w-full relative overflow-hidden flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={handleExitClick} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[20px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>{entry.title}</h1>
                        <div className="text-[10px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>与 {char.name} · {messages.length} 句</div>
                    </div>
                    {summarizing && (
                        <div className="absolute right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: 'rgba(167,139,250,0.15)' }}>
                            <SpinnerGap size={12} className="animate-spin" style={{ color: '#7c3aed' }} />
                            <span className="text-[10px]" style={{ color: '#715d99' }}>整理</span>
                        </div>
                    )}
                </div>
            </div>

            {/* 消息流 */}
            <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto px-4 py-4 no-scrollbar">
                {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6">
                        <BookOpen size={36} weight="light" style={{ color: '#a78bfa', marginBottom: 12 }} />
                        <div className="text-[14px] font-bold mb-1" style={{ color: '#715d99' }}>开始一场 RP</div>
                        <div className="text-[11px] leading-relaxed" style={{ color: 'rgba(150,120,190,0.7)' }}>
                            {entry.premise ? `前提:${entry.premise.slice(0, 60)}${entry.premise.length > 60 ? '...' : ''}` : '没有写前提,自由发挥'}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {messages.map(m => (
                            <MessageBubble key={m.id} message={m} charName={char.name} userName={userProfile?.name || '暮色'} />
                        ))}
                        {sending && (
                            <div className="flex justify-start">
                                <div className="px-3 py-2 rounded-2xl flex items-center gap-2" style={{ background: 'rgba(255,255,255,0.6)' }}>
                                    <SpinnerGap size={12} className="animate-spin" style={{ color: '#a78bfa' }} />
                                    <span className="text-[11px]" style={{ color: '#715d99' }}>{char.name} 正在想...</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* 输入框 */}
            <div className="relative z-10 shrink-0 px-4 pb-4 pt-2" style={{ paddingBottom: 'max(1rem, var(--safe-bottom))' }}>
                <div className="flex items-end gap-2">
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend();
                            }
                        }}
                        placeholder="暮色 写下你的台词、动作、心理..."
                        rows={2}
                        disabled={sending}
                        className="flex-1 px-3.5 py-2.5 rounded-2xl text-[13px] resize-none focus:outline-none disabled:opacity-50"
                        style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937', maxHeight: 120 }}
                        onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                    />
                    <button
                        onClick={() => void handleSend()}
                        disabled={!input.trim() || sending}
                        className="w-11 h-11 rounded-full flex items-center justify-center active:scale-90 transition-all disabled:opacity-30"
                        style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}
                    >
                        <PaperPlaneTilt size={18} weight="fill" />
                    </button>
                </div>
            </div>

            {/* 退出确认 modal */}
            {showExitModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={() => !syncing && setShowExitModal(false)}>
                    <div className="w-full max-w-sm flex flex-col" onClick={e => e.stopPropagation()}
                         style={{ background: 'linear-gradient(160deg,#ffffff 0%,#f7f2fb 100%)', borderRadius: 24, border: '1px solid rgba(170,140,210,0.3)', boxShadow: '0 20px 50px -20px rgba(150,120,200,0.4)' }}>
                        <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg,transparent,#a78bfa,#7c3aed,transparent)' }} />
                        <div className="px-6 pt-6 pb-2 text-center">
                            <div className="text-[10px] tracking-[0.3em] uppercase font-bold" style={{ color: '#7c3aed' }}>EXIT THEATER</div>
                            <h3 className="text-[18px] font-bold mt-1" style={{ color: '#4a3a6a' }}>退出剧场?</h3>
                        </div>
                        <div className="px-6 py-4 text-center text-[12px] leading-relaxed" style={{ color: '#4a3a6a' }}>
                            退出时会:
                            <ul className="mt-2 space-y-1 text-left">
                                <li>· {char.name} 写一段第一人称叙事摘要,写进记忆宫殿「自我房间」</li>
                                <li>· {char.name} 写一句观后感,发到你的聊天框</li>
                            </ul>
                            <div className="mt-3 text-[10px]" style={{ color: 'rgba(150,120,190,0.7)' }}>已摘要的 {entry.summary?.rawBatchCount || 0} 批 / 共 {messages.length} 句对话</div>
                        </div>
                        <div className="px-6 pb-6 pt-2 flex gap-3">
                            <button onClick={() => setShowExitModal(false)} disabled={syncing} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold disabled:opacity-50"
                                    style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>继续 RP</button>
                            <button onClick={() => void handleConfirmExit()} disabled={syncing} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold disabled:opacity-50 flex items-center justify-center gap-2"
                                    style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>
                                {syncing ? <><SpinnerGap size={14} className="animate-spin" />同步中</> : '退出 + 同步'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ── 单条消息气泡 ── */
const MessageBubble: React.FC<{ message: Message; charName: string; userName: string }> = ({ message, charName, userName }) => {
    const isUser = message.role === 'user';
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className="max-w-[78%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{
                    background: isUser
                        ? 'linear-gradient(135deg,#a78bfa,#7c3aed)'
                        : 'rgba(255,255,255,0.85)',
                    color: isUser ? 'white' : '#1f2937',
                    border: isUser ? 'none' : '1px solid rgba(170,140,210,0.25)',
                    boxShadow: isUser ? '0 4px 12px rgba(124,58,237,0.2)' : '0 2px 8px rgba(150,120,200,0.1)',
                    borderTopRightRadius: isUser ? 4 : undefined,
                    borderTopLeftRadius: isUser ? undefined : 4,
                }}
            >
                <div className="text-[9px] mb-1 font-bold tracking-wider" style={{ color: isUser ? 'rgba(255,255,255,0.7)' : 'rgba(150,120,190,0.7)' }}>
                    {isUser ? userName : charName}
                </div>
                {message.content}
            </div>
        </div>
    );
};

/* ── 主 LLM 调用(非流式) ── */
async function callMainLLM(args: {
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    history: { role: 'user' | 'assistant'; content: string }[];
    apiConfig: APIConfig;
}): Promise<string> {
    const { char, userProfile, entry, history, apiConfig } = args;
    if (!apiConfig?.baseUrl || !apiConfig?.apiKey || !apiConfig?.model) {
        throw new Error('主 LLM 未配置(apiConfig 缺 baseUrl/apiKey/model)');
    }

    // 拼 system prompt:角色原本的 + RP 模式追加
    let baseSystem = '';
    try {
        baseSystem = ContextBuilder.buildCoreContext(char, userProfile || undefined);
    } catch {
        // 如果 buildCoreContext 失败,降级用最简 system
        baseSystem = `你是${char.name}。${char.description || ''}`;
    }
    const systemPrompt = buildRPSystemPrompt({
        base: baseSystem,
        char,
        userProfile,
        entry,
        summary: entry.summary,
    });

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
    ];

    const res = await safeFetchJson(
        `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiConfig.apiKey}`,
            },
            body: JSON.stringify({
                model: apiConfig.model,
                messages,
                temperature: 0.85,
                max_tokens: 4096,
                stream: false,
            }),
        },
        1, 0,
        { appName: '剧情模式', purpose: 'RP 对话', charId: char.id, charName: char.name },
    );

    return res?.choices?.[0]?.message?.content || '';
}

export default StoryTheaterSession;
