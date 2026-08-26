/**
 * Entry 编辑 modal — 暮色 8-25 第二批
 *
 * 暮色 8-25 第二批 C 决策:只改可调字段
 *   可改:前提 / 文风 / 作者注释 / 状态栏定义 / 解锁提示词 / 生成参数 4 字段
 *   不可改:title / characterId / id / createdAt
 *
 * 暮色 8-25 第二批小改:用半屏底部弹窗(bottom sheet),从底部滑上来
 *   - 上半部分透明 → 用户看到上面对话内容
 *   - 下半部分 modal 内容
 *   - 滑入滑出动画
 */

import React, { useEffect, useState } from 'react';
import { CaretDown, Plus, X, Check, Cloud } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { DB } from '../../../utils/db';
import type { RPApiConfig, StoryTheaterEntry } from '../../../types';

interface Props {
    entry: StoryTheaterEntry;
    onClose: () => void;
    onSaved: (updated: StoryTheaterEntry) => void;
}

const EntryEditModal: React.FC<Props> = ({ entry, onClose, onSaved }) => {
    const { addToast } = useOS();
    // 暮色 8-25 第二批 C:可调字段
    const [premise, setPremise] = useState(entry.premise);
    const [writingStyle, setWritingStyle] = useState(entry.writingStyle || '');
    const [authorNote, setAuthorNote] = useState(entry.authorNote || '');
    const [jailbreakPrompt, setJailbreakPrompt] = useState(entry.jailbreakPrompt || '');
    const [statusVars, setStatusVars] = useState<{ name: string; initialValue: string }[]>(
        entry.statusBarDefinitions || []
    );
    const [temperature, setTemperature] = useState(entry.generationParams?.temperature ?? entry.generation?.temperature ?? 0.85);
    const [maxTokens, setMaxTokens] = useState(entry.generationParams?.maxTokens ?? entry.generation?.maxTokens ?? 4096);
    const [topP, setTopP] = useState(entry.generationParams?.topP ?? 1.0);
    const [frequencyPenalty, setFrequencyPenalty] = useState(entry.generationParams?.frequencyPenalty ?? 0);
    const [presencePenalty, setPresencePenalty] = useState(entry.generationParams?.presencePenalty ?? 0);  // 暮色 8-25 第七批
    // 暮色 8-25 第七批:4 个叙事参数(选项卡片)
    const [narrativePerson, setNarrativePerson] = useState<'second' | 'third' | undefined>(entry.narrativePerson);
    const [authorityLevel, setAuthorityLevel] = useState<'none' | 'limited' | 'full' | undefined>(entry.authorityLevel);
    const [lengthPreset, setLengthPreset] = useState<'short' | 'medium' | 'long' | undefined>(entry.lengthPreset);
    const [tensionLevel, setTensionLevel] = useState<'natural' | 'warm' | 'intense' | undefined>(entry.tensionLevel);
    // 暮色 8-25 第六步第一批:API 选择也允许改
    const [apiConfigId, setApiConfigId] = useState<string | null>(entry.apiConfigId || null);
    const [rpApiConfigs, setRpApiConfigs] = useState<RPApiConfig[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        void DB.getRPApiConfigs().then(setRpApiConfigs);
    }, []);

    const handleSave = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const updated: StoryTheaterEntry = {
                ...entry,
                premise: premise.trim(),
                writingStyle: writingStyle.trim() || undefined,
                authorNote: authorNote.trim() || undefined,
                jailbreakPrompt: jailbreakPrompt.trim() || undefined,
                statusBarDefinitions: statusVars.filter(v => v.name.trim()),
                generationParams: { temperature, maxTokens, topP, frequencyPenalty, presencePenalty },
                apiConfigId: apiConfigId || undefined,
                narrativePerson,   // 暮色 8-25 第七批
                authorityLevel,     // 暮色 8-25 第七批
                lengthPreset,       // 暮色 8-25 第七批(底层映射 maxTokens)
                tensionLevel,       // 暮色 8-25 第七批
                updatedAt: Date.now(),
            };
            await DB.saveStoryTheater(updated);
            addToast?.('已保存', 'success');
            onSaved(updated);
            onClose();
        } catch (e: any) {
            addToast?.(`保存失败: ${e?.message || e}`, 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="absolute inset-0 z-50 flex items-end"
            style={{ background: 'rgba(15,23,42,0.45)', animation: 'fadeIn 200ms' }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="w-full flex flex-col overflow-hidden"
                style={{
                    background: 'linear-gradient(180deg,#ffffff 0%,#f7f2fb 100%)',
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    maxHeight: '75vh',
                    boxShadow: '0 -8px 30px rgba(150,120,200,0.3)',
                    animation: 'slideUp 280ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                }}
            >
                {/* 顶栏 */}
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'rgba(170,140,210,0.2)' }}>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                                style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>
                            <X size={14} weight="bold" />
                        </button>
                        <div>
                            <div className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: '#7c3aed' }}>EDIT</div>
                            <div className="text-[15px] font-bold" style={{ color: '#4a3a6a' }}>编辑剧场</div>
                        </div>
                    </div>
                    <button onClick={handleSave} disabled={saving}
                            className="px-4 py-1.5 rounded-xl text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-50"
                            style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>
                        <Check size={12} weight="bold" />{saving ? '保存中' : '保存'}
                    </button>
                </div>

                {/* 主体滚动 */}
                <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-4">
                    {/* 前提 */}
                    <Field label="前提">
                        <textarea value={premise} onChange={e => setPremise(e.target.value)} rows={2}
                                  className="w-full mt-1 px-3 py-2 rounded-xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                                  style={inputStyle} />
                    </Field>

                    {/* 文风 */}
                    <Field label="文风">
                        <textarea value={writingStyle} onChange={e => setWritingStyle(e.target.value)} rows={2}
                                  placeholder="例:现代口语、轻松自然、对话为主"
                                  className="w-full mt-1 px-3 py-2 rounded-xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                                  style={inputStyle} />
                    </Field>

                    {/* 暮色 8-25 第七批:4 个叙事参数选项卡片(在文风下面,生成参数 section 上面) */}
                    <Field label="叙事参数" hint="不选 = 默认(第二人称/不代写/中等篇幅/自然)">
                        <div className="mt-2 space-y-2">
                            <OptionCardRow
                                label="人称"
                                options={[
                                    { value: 'second' as const, label: '第二人称' },
                                    { value: 'third' as const,  label: '第三人称' },
                                ]}
                                value={narrativePerson}
                                onChange={setNarrativePerson}
                            />
                            <OptionCardRow
                                label="执笔权"
                                options={[
                                    { value: 'none' as const,    label: '不代写',     hint: '不替用户写' },
                                    { value: 'limited' as const, label: '有限协演',   hint: '不替用户做决定' },
                                    { value: 'full' as const,    label: '全自动演绎', hint: '可写用户反应' },
                                ]}
                                value={authorityLevel}
                                onChange={setAuthorityLevel}
                            />
                            <OptionCardRow
                                label="篇幅"
                                options={[
                                    { value: 'short' as const,  label: '短', hint: '200-500 字' },
                                    { value: 'medium' as const, label: '中', hint: '500-1500 字' },
                                    { value: 'long' as const,   label: '长', hint: '1500-3000 字' },
                                ]}
                                value={lengthPreset}
                                onChange={setLengthPreset}
                            />
                            <OptionCardRow
                                label="场景张力"
                                options={[
                                    { value: 'natural' as const, label: '自然', hint: '日常节奏' },
                                    { value: 'warm' as const,    label: '微热', hint: '适度升温' },
                                    { value: 'intense' as const, label: '炽烈', hint: '高强度推进' },
                                ]}
                                value={tensionLevel}
                                onChange={setTensionLevel}
                            />
                        </div>
                    </Field>

                    {/* 作者注释 */}
                    <Field label="作者注释" hint="插在 system 之后,对话之前">
                        <textarea value={authorNote} onChange={e => setAuthorNote(e.target.value)} rows={2}
                                  placeholder="补充指令(任意时候改都生效)..."
                                  className="w-full mt-1 px-3 py-2 rounded-xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                                  style={inputStyle} />
                    </Field>

                    {/* 状态变量 */}
                    <Field label="状态栏定义" hint="每行:变量名 + 初始值">
                        <div className="mt-1 space-y-1.5">
                            {statusVars.map((v, i) => (
                                <div key={i} className="flex gap-1.5 items-center">
                                    <input type="text" value={v.name}
                                           onChange={e => setStatusVars(prev => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))}
                                           placeholder="变量名"
                                           className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                           style={inputStyle} />
                                    <input type="text" value={v.initialValue}
                                           onChange={e => setStatusVars(prev => prev.map((x, idx) => idx === i ? { ...x, initialValue: e.target.value } : x))}
                                           placeholder="初始值"
                                           className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                           style={inputStyle} />
                                    <button onClick={() => setStatusVars(prev => prev.filter((_, idx) => idx !== i))}
                                            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-red-400 active:scale-90"
                                            style={{ background: 'rgba(239,68,68,0.08)' }}>×</button>
                                </div>
                            ))}
                            <button onClick={() => setStatusVars(prev => [...prev, { name: '', initialValue: '' }])}
                                    className="w-full py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1"
                                    style={{ background: 'rgba(167,139,250,0.1)', color: '#715d99' }}>
                                <Plus size={11} weight="bold" />加一个变量
                            </button>
                        </div>
                    </Field>

                    {/* 解锁提示词 */}
                    <Field label="解锁提示词" hint="放在整段 prompt 最末">
                        <textarea value={jailbreakPrompt} onChange={e => setJailbreakPrompt(e.target.value)} rows={2}
                                  placeholder="默认空..."
                                  className="w-full mt-1 px-3 py-2 rounded-xl text-[12.5px] resize-none focus:outline-none leading-relaxed"
                                  style={inputStyle} />
                    </Field>

                    {/* 生成参数(暮色 8-25 第二批 4 字段) */}
                    <Field label="生成参数" hint="temperature / 篇幅(maxTokens) / topP / 频率 / 话题惩罚">
                        <div className="mt-1 space-y-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(170,140,210,0.25)' }}>
                            <SliderRow label="温度" value={temperature} min={0.3} max={1.2} step={0.05}
                                       onChange={setTemperature} hint="0.3 稳定 / 0.85 平衡 / 1.2 创意" />
                            {/* 暮色 8-25 第七批:maxTokens 4 选 1 被篇幅预设替代,在下面"叙事参数"section 里设 */}
                            <SliderRow label="topP 核采样" value={topP} min={0} max={1} step={0.05}
                                       onChange={setTopP} hint="0 精确 / 1.0 自由" />
                            <SliderRow label="频率惩罚" value={frequencyPenalty} min={0} max={2} step={0.1}
                                       onChange={setFrequencyPenalty} hint="0 不惩罚 / 2 强" />
                            <SliderRow label="话题惩罚" value={presencePenalty} min={-2} max={2} step={0.1}
                                       onChange={setPresencePenalty} hint="-2 重复 / 0 中性 / 2 引入新" />
                        </div>
                    </Field>

                    {/* API 选择 */}
                    <Field label="使用 API">
                        <div className="mt-1 space-y-1.5">
                            <button onClick={() => setApiConfigId(null)}
                                    className="w-full text-left rounded-xl px-2.5 py-2 active:scale-[0.98] transition-all flex items-center gap-2"
                                    style={{
                                        background: apiConfigId === null ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'rgba(255,255,255,0.5)',
                                        border: apiConfigId === null ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.25)',
                                    }}>
                                <Cloud size={14} weight="fill" style={{ color: '#7c3aed' }} />
                                <span className="text-[12px] font-bold" style={{ color: '#4a3a6a' }}>主聊天同款</span>
                            </button>
                            {rpApiConfigs.map(cfg => (
                                <button key={cfg.id} onClick={() => setApiConfigId(cfg.id)}
                                        className="w-full text-left rounded-xl px-2.5 py-2 active:scale-[0.98] transition-all"
                                        style={{
                                            background: apiConfigId === cfg.id ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))' : 'rgba(255,255,255,0.5)',
                                            border: apiConfigId === cfg.id ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.25)',
                                        }}>
                                    <span className="text-[12px] font-bold" style={{ color: '#4a3a6a' }}>{cfg.name}</span>
                                    <span className="text-[10px] ml-2" style={{ color: 'rgba(150,120,190,0.7)' }}>{cfg.model}</span>
                                </button>
                            ))}
                        </div>
                    </Field>
                </div>

                {/* 底部安全区 */}
                <div style={{ paddingBottom: 'max(1rem, env(safe-bottom))' }} />
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
            `}</style>
        </div>
    );
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div>
        <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</span>
            {hint && <span className="text-[9px]" style={{ color: 'rgba(150,120,190,0.6)' }}>{hint}</span>}
        </div>
        {children}
    </div>
);

const SliderRow: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint: string }> = ({ label, value, min, max, step, onChange, hint }) => (
    <div>
        <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</span>
            <span className="text-[11px] font-mono" style={{ color: '#4a3a6a' }}>{value.toFixed(2)}</span>
        </div>
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
               className="w-full" style={{ accentColor: '#a78bfa' }} />
        <div className="text-[9px] mt-0.5 text-right" style={{ color: 'rgba(150,120,190,0.6)' }}>{hint}</div>
    </div>
);

const MaxTokensRow: React.FC<{ value: number; onChange: (v: number) => void }> = ({ value, onChange }) => (
    <div>
        <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>最大长度</span>
        <div className="grid grid-cols-4 gap-1.5 mt-1.5">
            {[1024, 2048, 4096, 8192].map(v => (
                <button key={v} onClick={() => onChange(v)}
                        className="py-1.5 rounded-lg text-[10px] font-bold active:scale-95 transition-all"
                        style={{
                            background: value === v ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.5)',
                            border: value === v ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.25)',
                            color: value === v ? '#715d99' : 'rgba(150,120,190,0.7)',
                        }}>{v}</button>
            ))}
        </div>
    </div>
);

const inputStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid rgba(170,140,210,0.3)',
    color: '#1f2937',
};

/* 暮色 8-25 第七批:选项卡片行(单选,选中高亮,再点取消)
   value 为 undefined → 全部浅灰态(未选)
   选中态:紫色渐变 + 紫色边框 + 阴影 */
const OptionCardRow = <T extends string>(args: {
    label: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    value: T | undefined;
    onChange: (v: T | undefined) => void;
}) => {
    const { label, options, value, onChange } = args;
    return (
        <div>
            <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</span>
                {value === undefined && options.length > 0 && (
                    <button
                        onClick={() => onChange(options[0].value)}
                        className="text-[9px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(167,139,250,0.1)', color: '#715d99' }}
                    >选默认</button>
                )}
            </div>
            <div className={`grid gap-1.5 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {options.map(opt => {
                    const selected = value === opt.value;
                    return (
                        <button
                            key={opt.value}
                            onClick={() => onChange(selected ? undefined : opt.value)}
                            className="rounded-xl px-2 py-2 active:scale-95 transition-all text-left"
                            style={{
                                background: selected
                                    ? 'linear-gradient(135deg,rgba(167,139,250,0.22),rgba(124,58,237,0.12))'
                                    : 'rgba(255,255,255,0.55)',
                                border: selected
                                    ? '1.5px solid #a78bfa'
                                    : '1px solid rgba(170,140,210,0.25)',
                                boxShadow: selected ? '0 2px 8px rgba(167,139,250,0.2)' : 'none',
                            }}
                        >
                            <div className="text-[11.5px] font-bold" style={{ color: selected ? '#715d99' : '#4a3a6a' }}>{opt.label}</div>
                            {opt.hint && (
                                <div className="text-[9px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>{opt.hint}</div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default EntryEditModal;
