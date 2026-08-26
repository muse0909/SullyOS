/**
 * 场景配置中间页 — 暮色 8-25 第五步
 *
 * 用户从列表页点场景模板卡后进这个中间页:
 *   1. 备选前提(单选 radio,3-5 个)
 *   2. 自定义前提输入框(选了就预填可改,可清空自写)
 *   3. 文风(默认填模板的 writingStyle,可点开编辑)
 *   4. 底部"开剧场"按钮 → 建 Entry + 跳到 StoryTheaterSession
 *
 * 暮色 8-25 第五步明确:
 *   - 不直接跳 session,先到这页选/改前提 + 文风
 *   - writingStyle 写入 Entry(持久化),buildRPSystemPrompt 读它做风格指令
 *   - 改后的文风以用户确认的为准
 */

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Sparkle, PencilSimple, Check, X, Cloud, Plus } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { createEntryFromSceneTemplate } from '../../../utils/storyTheater';
import { DB } from '../../../utils/db';
import { SELECT_THEME } from './storyTheme';
import type { RPApiConfig, StorySceneTemplate } from '../../../types';

interface Props {
    template: StorySceneTemplate;
    onCancel: () => void;             // 返回列表页
    onConfirm: (entryId: string) => void;  // 建 Entry 完成,跳 session
}

const SceneConfigPage: React.FC<Props> = ({ template, onCancel, onConfirm }) => {
    const { activeCharacterId, addToast } = useOS();
    const [selectedIdx, setSelectedIdx] = useState<number>(0);  // 默认选第一个备选
    const [customPremise, setCustomPremise] = useState<string>('');
    const [writingStyle, setWritingStyle] = useState<string>(template.writingStyle);
    const [editingStyle, setEditingStyle] = useState(false);
    const [temperature, setTemperature] = useState<number>(0.85);     // 暮色 8-25 第五步+:中间页可调
    const [maxTokens, setMaxTokens] = useState<number>(4096);
    const [topP, setTopP] = useState<number>(1.0);                      // 暮色 8-25 第二批:加
    const [frequencyPenalty, setFrequencyPenalty] = useState<number>(0);// 暮色 8-25 第二批:加
    const [authorNote, setAuthorNote] = useState<string>('');          // 暮色 8-25 第二批:作者注释
    const [jailbreakPrompt, setJailbreakPrompt] = useState<string>(''); // 暮色 8-25 第二批:解锁提示词
    const [statusVars, setStatusVars] = useState<{ name: string; initialValue: string }[]>([]); // 暮色 8-25 第二批:状态变量
    const [submitting, setSubmitting] = useState(false);
    // 暮色 8-25 第六步第一批:API 选择(null = 主 apiConfig,'',set 时直接传 undefined)
    const [apiConfigId, setApiConfigId] = useState<string | null>(null);
    const [rpApiConfigs, setRpApiConfigs] = useState<RPApiConfig[]>([]);

    // 加载 RP API 配置列表
    useEffect(() => {
        void DB.getRPApiConfigs().then(setRpApiConfigs);
    }, []);

    // 选备选时自动填自定义输入框(用户可改/可清空)
    useEffect(() => {
        if (selectedIdx >= 0 && selectedIdx < template.premiseOptions.length) {
            setCustomPremise(template.premiseOptions[selectedIdx]);
        }
    }, [selectedIdx, template.premiseOptions]);

    if (!activeCharacterId) {
        return (
            <div className="h-full w-full flex items-center justify-center px-6" style={{ background: SELECT_THEME.pageBg }}>
                <div className="text-center">
                    <div className="text-[14px] mb-3" style={{ color: SELECT_THEME.title }}>请先在聊天页选一个角色</div>
                    <button onClick={onCancel} className="px-4 py-2 rounded-xl text-[12px] font-bold" style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>返回</button>
                </div>
            </div>
        );
    }

    const handleConfirm = async () => {
        if (submitting) return;
        if (!customPremise.trim()) {
            addToast?.('前提不能为空', 'error');
            return;
        }
        if (!writingStyle.trim()) {
            addToast?.('文风不能为空', 'error');
            return;
        }
        setSubmitting(true);
        try {
            const { DB } = await import('../../../utils/db');
            const entry = createEntryFromSceneTemplate({
                template,
                characterId: activeCharacterId,
                premise: customPremise.trim(),
                writingStyle: writingStyle.trim(),
                generation: { temperature, maxTokens },  // 暮色 8-25 老字段保留
                generationParams: { temperature, maxTokens, topP, frequencyPenalty },  // 暮色 8-25 第二批:新 4 字段
                apiConfigId: apiConfigId || undefined,    // 暮色 8-25 第六步第一批:null = 主 apiConfig
                authorNote: authorNote.trim() || undefined,           // 暮色 8-25 第二批
                jailbreakPrompt: jailbreakPrompt.trim() || undefined, // 暮色 8-25 第二批
                statusBarDefinitions: statusVars.filter(v => v.name.trim()),  // 暮色 8-25 第二批
            });
            await DB.saveStoryTheater(entry);
            onConfirm(entry.id);
        } catch (e: any) {
            addToast?.(`开剧场失败: ${e?.message || e}`, 'error');
            setSubmitting(false);
        }
    };

    return (
        <div className="absolute inset-0 z-50 flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={onCancel} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[22px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>配置剧场</h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${SELECT_THEME.line})` }} />
                            <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ STORY SETUP ✦</span>
                            <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${SELECT_THEME.line})` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 主体滚动 */}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 py-4">
                {/* 场景信息卡 */}
                <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${SELECT_THEME.cardBorder}` }}>
                    <div className="flex items-center gap-3 mb-2">
                        <span className="text-[28px]">{template.emoji}</span>
                        <div className="flex-1 min-w-0">
                            <div className="text-[16px] font-bold" style={{ color: '#4a3a6a' }}>{template.name}</div>
                            <div className="text-[11px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>{template.description}</div>
                        </div>
                    </div>
                    {template.tags.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap">
                            {template.tags.map(tag => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,250,0.12)', color: '#715d99' }}>#{tag}</span>
                            ))}
                        </div>
                    )}
                </div>

                {/* 1. 备选前提(单选) */}
                <SectionTitle title="选个前情提要" subtitle="CHOOSE PREMISE" />
                <div className="space-y-2 mb-4">
                    {template.premiseOptions.map((p, idx) => (
                        <button
                            key={idx}
                            onClick={() => setSelectedIdx(idx)}
                            className="w-full text-left rounded-2xl px-3.5 py-3 active:scale-[0.98] transition-all"
                            style={{
                                background: selectedIdx === idx ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'rgba(255,255,255,0.55)',
                                border: selectedIdx === idx ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.3)',
                                boxShadow: selectedIdx === idx ? '0 4px 14px rgba(167,139,250,0.2)' : 'none',
                            }}
                        >
                            <div className="flex items-start gap-2.5">
                                <div
                                    className="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
                                    style={{
                                        border: selectedIdx === idx ? '5px solid #7c3aed' : '1.5px solid rgba(150,120,190,0.4)',
                                        background: 'white',
                                    }}
                                />
                                <div className="text-[12px] leading-relaxed flex-1" style={{ color: '#4a3a6a' }}>{p}</div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* 2. 自定义前提输入框 */}
                <SectionTitle title="或自己改写前提" subtitle="CUSTOM PREMISE" />
                <textarea
                    value={customPremise}
                    onChange={e => {
                        setCustomPremise(e.target.value);
                        // 改了说明用户自写了,清掉选中态
                        if (selectedIdx !== -1) setSelectedIdx(-1);
                    }}
                    placeholder="想怎么开始?背景设定、剧情起点、你想怎么玩…"
                    rows={3}
                    className="w-full px-3.5 py-2.5 rounded-2xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                />

                {/* 3. 文风 */}
                <SectionTitle title="文风" subtitle="WRITING STYLE" />
                {editingStyle ? (
                    <div className="space-y-2">
                        <textarea
                            value={writingStyle}
                            onChange={e => setWritingStyle(e.target.value)}
                            rows={2}
                            className="w-full px-3.5 py-2.5 rounded-2xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                            style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid #a78bfa', color: '#1f2937' }}
                            placeholder="例:现代口语、轻松自然、对话为主"
                        />
                        <div className="flex gap-2">
                            <button onClick={() => setEditingStyle(false)} className="flex-1 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5"
                                    style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>
                                <X size={11} weight="bold" /> 取消
                            </button>
                            <button onClick={() => setEditingStyle(false)} className="flex-1 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5"
                                    style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white' }}>
                                <Check size={11} weight="bold" /> 确认
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setEditingStyle(true)}
                        className="w-full text-left rounded-2xl px-3.5 py-3 active:scale-[0.98] transition-all flex items-start gap-2"
                        style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(170,140,210,0.3)' }}
                    >
                        <Sparkle size={14} weight="fill" style={{ color: '#a78bfa', marginTop: 1, flexShrink: 0 }} />
                        <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed" style={{ color: '#4a3a6a' }}>
                            {writingStyle || '(点此处设置文风)'}
                        </div>
                        <PencilSimple size={12} weight="bold" style={{ color: 'rgba(150,120,190,0.6)', flexShrink: 0 }} />
                    </button>
                )}

                {/* 4. 预设(暮色 8-25 第五步+:LLM 采样参数) */}
                <SectionTitle title="预设" subtitle="GENERATION" />
                <div className="rounded-2xl px-3.5 py-3 mb-4 space-y-3" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(170,140,210,0.3)' }}>
                    {/* 温度 */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>温度</span>
                            <span className="text-[11px] font-mono" style={{ color: '#4a3a6a' }}>{temperature.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.3"
                            max="1.2"
                            step="0.05"
                            value={temperature}
                            onChange={e => setTemperature(parseFloat(e.target.value))}
                            className="w-full"
                            style={{ accentColor: '#a78bfa' }}
                        />
                        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>
                            <span>稳定 0.3</span>
                            <span>平衡 0.85</span>
                            <span>创意 1.2</span>
                        </div>
                    </div>
                    {/* 最大长度 */}
                    <div>
                        <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>最大长度</span>
                        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                            {[1024, 2048, 4096, 8192].map(v => (
                                <button
                                    key={v}
                                    onClick={() => setMaxTokens(v)}
                                    className="py-1.5 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
                                    style={{
                                        background: maxTokens === v ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.5)',
                                        border: maxTokens === v ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.25)',
                                        color: maxTokens === v ? '#715d99' : 'rgba(150,120,190,0.7)',
                                    }}
                                >{v}</button>
                            ))}
                        </div>
                    </div>
                    {/* 暮色 8-25 第二批:topP 核采样 */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>topP 核采样</span>
                            <span className="text-[11px] font-mono" style={{ color: '#4a3a6a' }}>{topP.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={topP}
                            onChange={e => setTopP(parseFloat(e.target.value))}
                            className="w-full"
                            style={{ accentColor: '#a78bfa' }}
                        />
                        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>
                            <span>精确 0</span>
                            <span>1.0</span>
                        </div>
                    </div>
                    {/* 暮色 8-25 第二批:frequency_penalty */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>频率惩罚</span>
                            <span className="text-[11px] font-mono" style={{ color: '#4a3a6a' }}>{frequencyPenalty.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="2"
                            step="0.1"
                            value={frequencyPenalty}
                            onChange={e => setFrequencyPenalty(parseFloat(e.target.value))}
                            className="w-full"
                            style={{ accentColor: '#a78bfa' }}
                        />
                        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>
                            <span>不惩罚 0</span>
                            <span>2.0 强</span>
                        </div>
                    </div>
                </div>

                {/* 6. 作者注释(暮色 8-25 第二批) */}
                <SectionTitle title="作者注释" subtitle="AUTHOR'S NOTE" />
                <textarea
                    value={authorNote}
                    onChange={e => setAuthorNote(e.target.value)}
                    placeholder="补充指令(任意时候改都生效),会插在 system 之后、对话之前..."
                    rows={2}
                    className="w-full mb-4 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                />

                {/* 7. 状态栏定义(暮色 8-25 第二批) */}
                <SectionTitle title="状态栏定义" subtitle="STATUS VARS" />
                <div className="rounded-2xl px-3 py-2.5 mb-4 space-y-1.5" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(170,140,210,0.3)' }}>
                    {statusVars.map((v, i) => (
                        <div key={i} className="flex gap-1.5 items-center">
                            <input
                                type="text"
                                value={v.name}
                                onChange={e => setStatusVars(prev => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                                placeholder="变量名(如 好感度)"
                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                style={inputStyle}
                            />
                            <input
                                type="text"
                                value={v.initialValue}
                                onChange={e => setStatusVars(prev => prev.map((x, idx) => idx === i ? { ...x, initialValue: e.target.value } : x))}
                                placeholder="初始值(如 50/100)"
                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                style={inputStyle}
                            />
                            <button
                                onClick={() => setStatusVars(prev => prev.filter((_, idx) => idx !== i))}
                                className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-red-400 active:scale-90"
                                style={{ background: 'rgba(239,68,68,0.08)' }}
                            >×</button>
                        </div>
                    ))}
                    <button
                        onClick={() => setStatusVars(prev => [...prev, { name: '', initialValue: '' }])}
                        className="w-full py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1"
                        style={{ background: 'rgba(167,139,250,0.1)', color: '#715d99' }}
                    ><Plus size={11} weight="bold" />加一个变量</button>
                </div>

                {/* 8. 解锁提示词(暮色 8-25 第二批) */}
                <SectionTitle title="解锁提示词" subtitle="JAILBREAK" />
                <textarea
                    value={jailbreakPrompt}
                    onChange={e => setJailbreakPrompt(e.target.value)}
                    placeholder="放在整段 prompt 最末,默认空。后续填具体内容..."
                    rows={2}
                    className="w-full mb-4 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                    style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(170,140,210,0.3)', color: '#1f2937' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#a78bfa'; }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'rgba(170,140,210,0.3)'; }}
                />

                {/* 5. 使用 API(暮色 8-25 第六步第一批) */}
                <SectionTitle title="使用 API" subtitle="API" />
                <div className="rounded-2xl px-3 py-2 mb-4 space-y-1.5" style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(170,140,210,0.3)' }}>
                    <button
                        onClick={() => setApiConfigId(null)}
                        className="w-full text-left rounded-xl px-2.5 py-2 active:scale-[0.98] transition-all flex items-center gap-2"
                        style={{
                            background: apiConfigId === null ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'transparent',
                            border: apiConfigId === null ? '1.5px solid #a78bfa' : '1px solid transparent',
                        }}
                    >
                        <Cloud size={14} weight="fill" style={{ color: apiConfigId === null ? '#7c3aed' : 'rgba(150,120,190,0.6)', flexShrink: 0 }} />
                        <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-bold" style={{ color: apiConfigId === null ? '#715d99' : '#4a3a6a' }}>主聊天同款</div>
                            <div className="text-[9px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.7)' }}>用主聊天当前 API 配置</div>
                        </div>
                    </button>
                    {rpApiConfigs.map(cfg => (
                        <button
                            key={cfg.id}
                            onClick={() => setApiConfigId(cfg.id)}
                            className="w-full text-left rounded-xl px-2.5 py-2 active:scale-[0.98] transition-all flex items-center gap-2"
                            style={{
                                background: apiConfigId === cfg.id ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'transparent',
                                border: apiConfigId === cfg.id ? '1.5px solid #a78bfa' : '1px solid transparent',
                            }}
                        >
                            <div className="w-2 h-2 rounded-full" style={{ background: apiConfigId === cfg.id ? '#7c3aed' : 'rgba(150,120,190,0.4)' }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-[12px] font-bold" style={{ color: apiConfigId === cfg.id ? '#715d99' : '#4a3a6a' }}>{cfg.name}</div>
                                <div className="text-[9px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.7)' }}>{cfg.model} · {cfg.protocol}</div>
                            </div>
                        </button>
                    ))}
                    {rpApiConfigs.length === 0 && (
                        <div className="text-[10px] text-center py-2" style={{ color: 'rgba(150,120,190,0.55)' }}>
                            没有独立配置 → 顶部齿轮可添加
                        </div>
                    )}
                </div>
            </div>

            {/* 底部"开剧场"按钮 */}
            <div className="relative z-10 shrink-0 px-5 pb-5 pt-2" style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>
                <button
                    onClick={handleConfirm}
                    disabled={submitting || !customPremise.trim() || !writingStyle.trim()}
                    className="w-full py-3 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-40"
                    style={{
                        background: 'linear-gradient(135deg,#a78bfa,#7c3aed)',
                        color: 'white',
                        boxShadow: '0 6px 20px rgba(124,58,237,0.3)',
                    }}
                >
                    {submitting ? '开剧场中...' : '开剧场 →'}
                </button>
            </div>
        </div>
    );
};

const SectionTitle: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
    <div className="mb-2 mt-1">
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(150,120,190,0.75)' }}>{subtitle}</span>
            <span className="h-px flex-1 max-w-[3rem]" style={{ background: 'linear-gradient(90deg,rgba(150,120,190,0.5),transparent)' }} />
        </div>
        <div className="text-[13px] font-bold tracking-wider mt-1" style={{ color: '#4a3a6a' }}>{title}</div>
    </div>
);

const inputStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid rgba(170,140,210,0.3)',
    color: '#1f2937',
};

export default SceneConfigPage;
