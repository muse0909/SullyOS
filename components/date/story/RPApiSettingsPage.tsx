/**
 * RP 设置页 — 暮色 8-25 第六步第一批 + 8-26 加默认配置
 *
 * 暮色 8-25:
 *   - RP 模式可单独选模型/API key/endpoint,默认继承主聊天 API
 *   - 列表页齿轮按钮进入
 *   - 本步只实现 openai 协议流式,claude/gemini 协议 fallback 非流式(在 StoryTheaterSession 提示)
 *   - 测通用普通 completion 请求(发"hi"看是否回),不用流式(中转站可能支持普通不支持流式)
 *
 * 暮色 8-26:
 *   - 页面下半部分加"默认配置"区,新建剧场时继承
 *   - 改默认配置不影响已建好的剧场(隔离)
 *   - 单独剧场改自己的不影响这里
 */

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Plus, PencilSimple, Trash, Lightning, Check, X, CircleNotch, ArrowSquareOut, FloppyDisk, CaretDown, CaretRight } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { DB } from '../../../utils/db';
import { testRPApiConfig as testRPApiConfigFn, MAIN_API_PRESET_PREFIX, MAIN_API_PRESET_ID, isMainApiPresetId } from '../../../utils/storyTheater';
import { generateClientId } from '../../../utils/db';
import { SELECT_THEME } from './storyTheme';
import { WRITING_STYLE_PRESETS, matchWritingStylePreset } from './writingStylePresets';
import Modal from '../../os/Modal';
import type { ApiPreset, RPApiConfig, RPGlobalDefaults } from '../../../types';

interface Props {
    onClose: () => void;
}

const RPApiSettingsPage: React.FC<Props> = ({ onClose }) => {
    const { apiConfig: mainApiConfig, apiPresets, addToast } = useOS();
    const [configs, setConfigs] = useState<RPApiConfig[]>([]);
    const [editing, setEditing] = useState<RPApiConfig | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [deletingCfg, setDeletingCfg] = useState<RPApiConfig | null>(null);

    // 暮色 8-26:全局默认配置
    const [defaults, setDefaults] = useState<RPGlobalDefaults | null>(null);
    // 暮色 8-26 17:00:draftDefaults 默认空对象(不是 null),让没建过 defaults 的新用户也能看到完整表单可编辑
    const [draftDefaults, setDraftDefaults] = useState<RPGlobalDefaults>({ id: 'singleton', updatedAt: 0 });
    const [savingDefaults, setSavingDefaults] = useState(false);

    // 暮色 8-26:API 设置折叠(默认收起,点开展开)— 跟系统设置里 API 设置的折叠行为一致
    const [apiSectionOpen, setApiSectionOpen] = useState(false);

    // 加载 API 配置
    const reload = useCallback(async () => {
        const stored = await DB.getRPApiConfigs();
        setConfigs(stored);
    }, []);

    // 加载全局默认
    const reloadDefaults = useCallback(async () => {
        const stored = await DB.getRPGlobalDefaults();
        setDefaults(stored);
        // 暮色 8-26 17:00:有 stored 用 stored,没有用空对象(新用户也能看到完整表单)
        setDraftDefaults(stored || { id: 'singleton', updatedAt: 0 });
    }, []);

    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => { void reloadDefaults(); }, [reloadDefaults]);

    // 新建配置
    const handleNew = () => {
        setEditing({
            id: generateClientId(),
            name: '新配置',
            baseUrl: mainApiConfig.baseUrl,
            apiKey: mainApiConfig.apiKey,
            model: mainApiConfig.model,
            protocol: 'openai',
            isDefault: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    };

    // 编辑配置
    const handleEdit = (cfg: RPApiConfig) => {
        setEditing({ ...cfg });
    };

    // 保存
    const handleSave = async () => {
        if (!editing) return;
        if (!editing.name.trim()) { addToast?.('名称不能为空', 'error'); return; }
        if (!editing.baseUrl.trim() || !editing.model.trim()) {
            addToast?.('baseUrl 和 model 必填(apiKey 可后填)', 'error');
            return;
        }
        try {
            await DB.saveRPApiConfig(editing);
            addToast?.('已保存', 'success');
            setEditing(null);
            await reload();
        } catch (e: any) {
            addToast?.(`保存失败: ${e?.message || e}`, 'error');
        }
    };

    // 测通
    const handleTest = async (cfg: RPApiConfig) => {
        setTestingId(cfg.id);
        const result = await testRPApiConfigFn(cfg);
        setTestingId(null);
        if (result.ok) {
            addToast?.(`${cfg.name} 测通成功${result.latencyMs ? `(${result.latencyMs}ms)` : ''}`, 'success');
        } else {
            addToast?.(`${cfg.name} 测通失败: ${result.msg}`, 'error');
        }
    };

    // 删除
    const handleDelete = async (cfg: RPApiConfig) => {
        if (cfg.isDefault) { addToast?.('默认配置不可删', 'error'); return; }
        try {
            await DB.deleteRPApiConfig(cfg.id);
            addToast?.('已删除', 'success');
            setDeletingCfg(null);
            await reload();
        } catch (e: any) {
            addToast?.(`删除失败: ${e?.message || e}`, 'error');
        }
    };

    // 暮色 8-26:保存全局默认
    const handleSaveDefaults = async () => {
        if (!draftDefaults) return;
        setSavingDefaults(true);
        try {
            const toSave: RPGlobalDefaults = {
                ...draftDefaults,
                id: 'singleton',
                updatedAt: Date.now(),
            };
            await DB.saveRPGlobalDefaults(toSave);
            setDefaults(toSave);
            addToast?.('已保存默认配置,之后新建的剧场会继承', 'success');
        } catch (e: any) {
            addToast?.(`保存失败: ${e?.message || e}`, 'error');
        } finally {
            setSavingDefaults(false);
        }
    };

    // 暮色 8-26:跟 SceneConfigPage 同款问题(PhoneShell transform/contain 困住 fixed),改用 React Portal 挂到 body
    return createPortal(
        <div className="fixed inset-0 z-50 flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={onClose} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[22px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>RP 设置</h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${SELECT_THEME.line})` }} />
                            <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ RP API & DEFAULTS ✦</span>
                            <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${SELECT_THEME.line})` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 主体滚动 */}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 py-4 space-y-6">
                {/* ─── Section 1:API 配置(暮色 8-26:折叠 + 同步主 API 预设) ─── */}
                <section>
                    <button
                        onClick={() => setApiSectionOpen(v => !v)}
                        className="w-full flex items-center gap-2 active:scale-[0.99] transition-all"
                    >
                        {apiSectionOpen ? <CaretDown size={12} weight="bold" style={{ color: '#715d99' }} /> : <CaretRight size={12} weight="bold" style={{ color: '#715d99' }} />}
                        <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(150,120,190,0.75)' }}>RP API</span>
                        <span className="h-px flex-1 max-w-[3rem]" style={{ background: 'linear-gradient(90deg,rgba(150,120,190,0.5),transparent)' }} />
                        <span className="text-[14px] font-bold tracking-wider" style={{ color: '#4a3a6a' }}>API 配置</span>
                        <span className="text-[9px] ml-1" style={{ color: 'rgba(150,120,190,0.6)' }}>
                            ({(apiPresets || []).filter(p => p.kind === 'main' || !p.kind).length + 1 + configs.length})
                        </span>
                    </button>
                    <div className="text-[10px] mt-1 ml-5" style={{ color: 'rgba(150,120,190,0.6)' }}>
                        整个剧场的 API 默认配置,单个剧场可在 ⚙ 弹窗里单独覆盖
                    </div>
                    {apiSectionOpen && (
                        <div className="mt-3 space-y-1.5">
                            {/* 暮色 8-26 17:00:精简列表 — 只显示名字,可点选作为 RP 默认 API
                                选中态:紫渐变背景 + 紫边框
                                非选中态:白底淡紫边 */}
                            {/* 主聊天同款 — 暮色 8-26 17:00:也作为可选项,可被设为 RP 默认 */}
                            <ApiRow
                                selected={draftDefaults.apiConfigId === MAIN_API_PRESET_ID}
                                onClick={() => setDraftDefaults({ ...draftDefaults, apiConfigId: MAIN_API_PRESET_ID })}
                                title="主聊天同款"
                                subtitle={mainApiConfig.model}
                                badge="默认"
                                badgeColor="#7c3aed"
                            />

                            {/* 主 API 预设(从系统设置同步) */}
                            {(apiPresets || []).filter(p => p.kind === 'main' || !p.kind).map(preset => {
                                const id = MAIN_API_PRESET_PREFIX + preset.id;
                                return (
                                    <ApiRow
                                        key={preset.id}
                                        selected={draftDefaults.apiConfigId === id}
                                        onClick={() => setDraftDefaults({ ...draftDefaults, apiConfigId: id })}
                                        title={preset.name}
                                        subtitle={preset.config.model}
                                        badge="主预设"
                                        badgeColor="#4f46e5"
                                    />
                                );
                            })}

                            {/* 用户自建 RP API 配置(自建的有测通/编辑/删除按钮) */}
                            {configs.length === 0 ? (
                                <div className="text-center text-[10px] py-2" style={{ color: 'rgba(150,120,190,0.55)' }}>
                                    还没有 RP 独立配置
                                </div>
                            ) : (
                                configs.map(cfg => (
                                    <div key={cfg.id} className="flex items-center gap-1">
                                        <div className="flex-1">
                                            <ApiRow
                                                selected={draftDefaults.apiConfigId === cfg.id}
                                                onClick={() => setDraftDefaults({ ...draftDefaults, apiConfigId: cfg.id })}
                                                title={cfg.name}
                                                subtitle={cfg.model}
                                                badge={cfg.protocol === 'openai' ? '自建' : cfg.protocol}
                                                badgeColor={cfg.protocol === 'openai' ? '#715d99' : '#666'}
                                            />
                                        </div>
                                        <button onClick={() => handleTest(cfg)} disabled={testingId === cfg.id}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center disabled:opacity-50 active:scale-90"
                                                style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}
                                                title="测通">
                                            {testingId === cfg.id ? <CircleNotch size={12} className="animate-spin" /> : <Lightning size={12} weight="fill" />}
                                        </button>
                                        <button onClick={() => handleEdit(cfg)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90"
                                                style={{ background: 'rgba(99,102,241,0.1)', color: '#4f46e5' }}
                                                title="编辑">
                                            <PencilSimple size={12} weight="bold" />
                                        </button>
                                        <button onClick={() => setDeletingCfg(cfg)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90"
                                                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                                                title="删除">
                                            <Trash size={12} weight="fill" />
                                        </button>
                                    </div>
                                ))
                            )}

                            <button onClick={handleNew} className="w-full mt-2 py-2 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                                    style={{ background: 'rgba(167,139,250,0.12)', color: '#715d99' }}>
                                <Plus size={12} weight="bold" />新建 RP 独立 API 配置
                            </button>
                        </div>
                    )}
                </section>

                {/* ─── Section 2:全局默认配置(暮色 8-26) ─── */}
                <section className="rounded-2xl px-3.5 py-4" style={{ background: 'rgba(255,255,255,0.45)', border: '1px dashed rgba(170,140,210,0.4)' }}>
                    <SectionHeader title="默认配置" subtitle="NEW THEATER DEFAULTS" inline />
                    <div className="text-[10px] mb-3" style={{ color: 'rgba(150,120,190,0.7)' }}>
                        改这里只影响<strong style={{ color: '#715d99' }}>之后新建</strong>的剧场,已建好的不受影响。
                    </div>

                    {draftDefaults && (
                        <div className="space-y-4">
                            {/* 0. RP 默认 API 当前选中(暮色 8-26 17:00) — 上面 API section 里的可点选列表
                                这里给个简短提示,告诉用户"选哪个"是当前 RP 默认 API */}
                            <div className="rounded-xl px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(167,139,250,0.08)', border: '1px dashed rgba(167,139,250,0.4)' }}>
                                <Cloud size={12} weight="fill" style={{ color: '#7c3aed' }} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[9px] font-bold tracking-wider" style={{ color: '#715d99' }}>当前 RP 默认 API</div>
                                    <div className="text-[11px] mt-0.5 truncate" style={{ color: '#4a3a6a' }}>
                                        {(() => {
                                            const id = draftDefaults.apiConfigId;
                                            if (!id) return '主聊天同款(实时)';
                                            if (id === MAIN_API_PRESET_ID) return '主聊天同款(实时)';
                                            if (id.startsWith(MAIN_API_PRESET_PREFIX)) {
                                                const pid = id.slice(MAIN_API_PRESET_PREFIX.length);
                                                const p = (apiPresets || []).find(x => x.id === pid);
                                                return p ? p.name : '主预设(已删除)';
                                            }
                                            const cfg = configs.find(x => x.id === id);
                                            return cfg ? cfg.name : '自建 RP(已删除)';
                                        })()}
                                    </div>
                                </div>
                                <div className="text-[9px]" style={{ color: 'rgba(150,120,190,0.6)' }}>↑ 上面点选</div>
                            </div>

                            {/* 1. 默认前提(暮色 8-26 17:00) — 新建剧场时填入,用户进中间页后可改/选备选前提覆盖 */}
                            <Field label="默认前提" hint="新建剧场的默认前提;空 = 用户自己写">
                                <textarea
                                    value={draftDefaults.defaultPremise || ''}
                                    onChange={e => setDraftDefaults({ ...draftDefaults, defaultPremise: e.target.value || undefined })}
                                    placeholder="空 = 新建剧场时中间页不预填,用户自己写"
                                    rows={2}
                                    className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                                    style={inputStyle}
                                />
                            </Field>

                            {/* 2. RP 总指令(暮色 8-26) */}
                            <Field label="RP 总指令" hint="角色在 RP 模式下的总体行为指令">
                                <textarea
                                    value={draftDefaults.rpInstructions || ''}
                                    onChange={e => setDraftDefaults({ ...draftDefaults, rpInstructions: e.target.value || undefined })}
                                    placeholder="空就不注入任何 RP 总指令"
                                    rows={2}
                                    className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                                    style={inputStyle}
                                />
                            </Field>

                            {/* 2. 文风预设 */}
                            <Field label="文风预设" hint="7 个预设,默认质感 = 不注入">
                                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                                    {WRITING_STYLE_PRESETS.map(p => {
                                        const activeId = matchWritingStylePreset(draftDefaults.writingStyle || '');
                                        const isActive = activeId === p.id && p.prompt !== '';
                                        return (
                                            <button
                                                key={p.id}
                                                onClick={() => {
                                                    if (p.prompt === '') {
                                                        if (draftDefaults.writingStyle) setDraftDefaults({ ...draftDefaults, writingStyle: undefined });
                                                        return;
                                                    }
                                                    if (isActive) {
                                                        setDraftDefaults({ ...draftDefaults, writingStyle: undefined });
                                                    } else {
                                                        setDraftDefaults({ ...draftDefaults, writingStyle: p.prompt });
                                                    }
                                                }}
                                                className="rounded-lg px-1.5 py-1.5 active:scale-95 transition-all text-left"
                                                style={{
                                                    background: isActive
                                                        ? 'linear-gradient(135deg,rgba(167,139,250,0.22),rgba(124,58,237,0.12))'
                                                        : 'rgba(255,255,255,0.55)',
                                                    border: isActive
                                                        ? '1.5px solid #a78bfa'
                                                        : '1px solid rgba(170,140,210,0.25)',
                                                }}
                                                title={p.description}
                                            >
                                                <div className="text-[10.5px] font-bold" style={{ color: isActive ? '#715d99' : '#4a3a6a' }}>{p.label}</div>
                                                <div className="text-[8.5px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.7)' }}>{p.description}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </Field>

                            {/* 3. 4 个叙事参数默认值 */}
                            <Field label="叙事参数默认值" hint="不选 = 走主模型默认">
                                <div className="mt-1.5 space-y-1.5">
                                    <DefaultsOptionRow
                                        label="人称"
                                        options={[
                                            { value: 'second' as const, label: '第二人称' },
                                            { value: 'third' as const,  label: '第三人称' },
                                        ]}
                                        value={draftDefaults.narrativePerson}
                                        onChange={v => setDraftDefaults({ ...draftDefaults, narrativePerson: v })}
                                    />
                                    <DefaultsOptionRow
                                        label="执笔权"
                                        options={[
                                            { value: 'none' as const,    label: '不代写',     hint: '不替用户写' },
                                            { value: 'limited' as const, label: '有限协演',   hint: '不替用户做决定' },
                                            { value: 'full' as const,    label: '全自动演绎', hint: '可写用户反应' },
                                        ]}
                                        value={draftDefaults.authorityLevel}
                                        onChange={v => setDraftDefaults({ ...draftDefaults, authorityLevel: v })}
                                    />
                                    <DefaultsOptionRow
                                        label="篇幅"
                                        options={[
                                            { value: 'short' as const,  label: '短', hint: '200-500 字' },
                                            { value: 'medium' as const, label: '中', hint: '500-1500 字' },
                                            { value: 'long' as const,   label: '长', hint: '1500-3000 字' },
                                        ]}
                                        value={draftDefaults.lengthPreset}
                                        onChange={v => setDraftDefaults({ ...draftDefaults, lengthPreset: v })}
                                    />
                                    <DefaultsOptionRow
                                        label="场景张力"
                                        options={[
                                            { value: 'natural' as const, label: '自然', hint: '日常节奏' },
                                            { value: 'warm' as const,    label: '微热', hint: '适度升温' },
                                            { value: 'intense' as const, label: '炽烈', hint: '高强度推进' },
                                        ]}
                                        value={draftDefaults.tensionLevel}
                                        onChange={v => setDraftDefaults({ ...draftDefaults, tensionLevel: v })}
                                    />
                                </div>
                            </Field>

                            {/* 4. 作者注释(暮色 8-26 17:00) */}
                            <Field label="作者注释默认值" hint="插在 system 之后,对话之前">
                                <textarea
                                    value={draftDefaults.authorNote || ''}
                                    onChange={e => setDraftDefaults({ ...draftDefaults, authorNote: e.target.value || undefined })}
                                    placeholder="空就不注入作者注释"
                                    rows={2}
                                    className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                                    style={inputStyle}
                                />
                            </Field>

                            {/* 5. 状态栏定义默认值(暮色 8-26 17:00) */}
                            <Field label="状态栏定义默认值" hint="每行:变量名 + 初始值,新建剧场时继承">
                                <div className="mt-1 space-y-1.5">
                                    {(draftDefaults.statusBarDefinitions || []).map((v, i) => (
                                        <div key={i} className="flex gap-1.5 items-center">
                                            <input type="text" value={v.name}
                                                   onChange={e => setDraftDefaults({
                                                       ...draftDefaults,
                                                       statusBarDefinitions: (draftDefaults.statusBarDefinitions || []).map((x, idx) => idx === i ? { ...x, name: e.target.value } : x),
                                                   })}
                                                   placeholder="变量名(如 好感度)"
                                                   className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                                   style={inputStyle} />
                                            <input type="text" value={v.initialValue}
                                                   onChange={e => setDraftDefaults({
                                                       ...draftDefaults,
                                                       statusBarDefinitions: (draftDefaults.statusBarDefinitions || []).map((x, idx) => idx === i ? { ...x, initialValue: e.target.value } : x),
                                                   })}
                                                   placeholder="初始值(如 50/100)"
                                                   className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] focus:outline-none"
                                                   style={inputStyle} />
                                            <button onClick={() => setDraftDefaults({
                                                ...draftDefaults,
                                                statusBarDefinitions: (draftDefaults.statusBarDefinitions || []).filter((_, idx) => idx !== i),
                                            })}
                                                    className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-red-400 active:scale-90"
                                                    style={{ background: 'rgba(239,68,68,0.08)' }}>×</button>
                                        </div>
                                    ))}
                                    <button onClick={() => setDraftDefaults({
                                        ...draftDefaults,
                                        statusBarDefinitions: [...(draftDefaults.statusBarDefinitions || []), { name: '', initialValue: '' }],
                                    })}
                                            className="w-full py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1"
                                            style={{ background: 'rgba(167,139,250,0.1)', color: '#715d99' }}>
                                        <Plus size={11} weight="bold" />加一个变量
                                    </button>
                                </div>
                            </Field>

                            {/* 6. 解锁提示词 */}
                            <Field label="解锁提示词默认值" hint="放在整段 prompt 最末">
                                <textarea
                                    value={draftDefaults.jailbreakPrompt || ''}
                                    onChange={e => setDraftDefaults({ ...draftDefaults, jailbreakPrompt: e.target.value || undefined })}
                                    placeholder="空就不注入"
                                    rows={2}
                                    className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] resize-none focus:outline-none leading-relaxed"
                                    style={inputStyle}
                                />
                            </Field>

                            {/* 5. 生成参数 5 字段默认值 */}
                            <Field label="生成参数默认值" hint="5 字段,temperature/maxTokens/topP/频率/话题惩罚">
                                <div className="mt-1.5 p-3 rounded-xl space-y-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(170,140,210,0.25)' }}>
                                    <DefaultsSliderRow
                                        label="温度"
                                        value={draftDefaults.generationParams?.temperature ?? 0.85}
                                        min={0.3} max={1.2} step={0.05}
                                        onChange={v => setDraftDefaults({
                                            ...draftDefaults,
                                            generationParams: { ...(draftDefaults.generationParams || defaultGenParams()), temperature: v, maxTokens: draftDefaults.generationParams?.maxTokens ?? 4096, topP: draftDefaults.generationParams?.topP ?? 1.0, frequencyPenalty: draftDefaults.generationParams?.frequencyPenalty ?? 0, presencePenalty: draftDefaults.generationParams?.presencePenalty ?? 0 },
                                        })}
                                        hint="0.3 稳定 / 0.85 平衡 / 1.2 创意"
                                    />
                                    <DefaultsSliderRow
                                        label="最大长度(maxTokens)"
                                        value={draftDefaults.generationParams?.maxTokens ?? 4096}
                                        min={256} max={8192} step={256}
                                        onChange={v => setDraftDefaults({
                                            ...draftDefaults,
                                            generationParams: { ...(draftDefaults.generationParams || defaultGenParams()), maxTokens: v, temperature: draftDefaults.generationParams?.temperature ?? 0.85, topP: draftDefaults.generationParams?.topP ?? 1.0, frequencyPenalty: draftDefaults.generationParams?.frequencyPenalty ?? 0, presencePenalty: draftDefaults.generationParams?.presencePenalty ?? 0 },
                                        })}
                                        hint="256 / 4096 平衡 / 8192 长篇"
                                    />
                                    <DefaultsSliderRow
                                        label="topP 核采样"
                                        value={draftDefaults.generationParams?.topP ?? 1.0}
                                        min={0} max={1} step={0.05}
                                        onChange={v => setDraftDefaults({
                                            ...draftDefaults,
                                            generationParams: { ...(draftDefaults.generationParams || defaultGenParams()), topP: v, temperature: draftDefaults.generationParams?.temperature ?? 0.85, maxTokens: draftDefaults.generationParams?.maxTokens ?? 4096, frequencyPenalty: draftDefaults.generationParams?.frequencyPenalty ?? 0, presencePenalty: draftDefaults.generationParams?.presencePenalty ?? 0 },
                                        })}
                                        hint="0 精确 / 1.0 自由"
                                    />
                                    <DefaultsSliderRow
                                        label="频率惩罚"
                                        value={draftDefaults.generationParams?.frequencyPenalty ?? 0}
                                        min={0} max={2} step={0.1}
                                        onChange={v => setDraftDefaults({
                                            ...draftDefaults,
                                            generationParams: { ...(draftDefaults.generationParams || defaultGenParams()), frequencyPenalty: v, temperature: draftDefaults.generationParams?.temperature ?? 0.85, maxTokens: draftDefaults.generationParams?.maxTokens ?? 4096, topP: draftDefaults.generationParams?.topP ?? 1.0, presencePenalty: draftDefaults.generationParams?.presencePenalty ?? 0 },
                                        })}
                                        hint="0 不惩罚 / 2 强"
                                    />
                                    <DefaultsSliderRow
                                        label="话题惩罚"
                                        value={draftDefaults.generationParams?.presencePenalty ?? 0}
                                        min={-2} max={2} step={0.1}
                                        onChange={v => setDraftDefaults({
                                            ...draftDefaults,
                                            generationParams: { ...(draftDefaults.generationParams || defaultGenParams()), presencePenalty: v, temperature: draftDefaults.generationParams?.temperature ?? 0.85, maxTokens: draftDefaults.generationParams?.maxTokens ?? 4096, topP: draftDefaults.generationParams?.topP ?? 1.0, frequencyPenalty: draftDefaults.generationParams?.frequencyPenalty ?? 0 },
                                        })}
                                        hint="-2 重复 / 0 中性 / 2 引入新"
                                    />
                                </div>
                            </Field>

                            {/* 底部保存按钮 */}
                            <button
                                onClick={handleSaveDefaults}
                                disabled={savingDefaults}
                                className="w-full py-2.5 rounded-2xl text-[12px] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
                                style={{
                                    background: 'linear-gradient(135deg,#a78bfa,#7c3aed)',
                                    color: 'white',
                                    boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
                                }}
                            >
                                <FloppyDisk size={13} weight="bold" />{savingDefaults ? '保存中...' : '保存默认配置'}
                            </button>
                        </div>
                    )}
                </section>
            </div>

            {/* 编辑 modal */}
            {editing && (
                <EditApiConfigModal
                    config={editing}
                    onClose={() => setEditing(null)}
                    onSave={async (cfg) => {
                        setEditing(cfg);
                        await handleSave();
                    }}
                    onChange={setEditing}
                />
            )}

            {/* 删除确认 modal */}
            <Modal isOpen={!!deletingCfg} title="删除配置" onClose={() => setDeletingCfg(null)} footer={
                deletingCfg && (
                    <div className="flex gap-2">
                        <button onClick={() => setDeletingCfg(null)} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold" style={{ background: 'rgba(150,150,150,0.1)', color: '#666' }}>取消</button>
                        <button onClick={() => handleDelete(deletingCfg)} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold" style={{ background: 'rgba(239,68,68,0.9)', color: 'white' }}>删除</button>
                    </div>
                )
            }>
                {deletingCfg && <div className="text-[13px]">确定删除 <strong>{deletingCfg.name}</strong> ?</div>}
            </Modal>
        </div>,
        document.body
    );
};

function defaultGenParams() {
    return { temperature: 0.85, maxTokens: 4096, topP: 1.0, frequencyPenalty: 0, presencePenalty: 0 };
}

const SectionHeader: React.FC<{ title: string; subtitle: string; inline?: boolean }> = ({ title, subtitle, inline }) => (
    <div className={inline ? 'mb-2' : 'mb-3'}>
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.3em] uppercase" style={{ color: 'rgba(150,120,190,0.75)' }}>{subtitle}</span>
            <span className="h-px flex-1 max-w-[3rem]" style={{ background: 'linear-gradient(90deg,rgba(150,120,190,0.5),transparent)' }} />
        </div>
        <div className="text-[14px] font-bold tracking-wider mt-1" style={{ color: '#4a3a6a' }}>{title}</div>
    </div>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
    <div>
        <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</span>
            {hint && <span className="text-[9px]" style={{ color: 'rgba(150,120,190,0.6)' }}>{hint}</span>}
        </div>
        {children}
    </div>
);

/* 暮色 8-26:默认配置的单选卡片行(跟中间页一致,但简化无下划线) */
const DefaultsOptionRow = <T extends string>(args: {
    label: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    value: T | undefined;
    onChange: (v: T | undefined) => void;
}) => {
    const { label, options, value, onChange } = args;
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <span className="text-[9.5px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</span>
                {value === undefined && (
                    <button
                        onClick={() => onChange(undefined)}
                        className="text-[8px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(167,139,250,0.1)', color: '#715d99' }}
                    >不设默认</button>
                )}
            </div>
            <div className={`grid gap-1.5 ${options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {options.map(opt => {
                    const selected = value === opt.value;
                    return (
                        <button
                            key={opt.value}
                            onClick={() => onChange(selected ? undefined : opt.value)}
                            className="rounded-lg px-1.5 py-1.5 active:scale-95 transition-all text-left"
                            style={{
                                background: selected
                                    ? 'linear-gradient(135deg,rgba(167,139,250,0.22),rgba(124,58,237,0.12))'
                                    : 'rgba(255,255,255,0.55)',
                                border: selected
                                    ? '1.5px solid #a78bfa'
                                    : '1px solid rgba(170,140,210,0.25)',
                            }}
                        >
                            <div className="text-[10.5px] font-bold" style={{ color: selected ? '#715d99' : '#4a3a6a' }}>{opt.label}</div>
                            {opt.hint && (
                                <div className="text-[8.5px] mt-0.5" style={{ color: 'rgba(150,120,190,0.7)' }}>{opt.hint}</div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const DefaultsSliderRow: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; hint: string }> = ({ label, value, min, max, step, onChange, hint }) => (
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

const inputStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid rgba(170,140,210,0.3)',
    color: '#1f2937',
};

/* 暮色 8-26 17:00:API 列表行 — 精简显示(只名字 + 小角标),可点选作为 RP 默认 API */
const ApiRow: React.FC<{
    selected: boolean;
    onClick: () => void;
    title: string;
    subtitle?: string;
    badge?: string;
    badgeColor?: string;
}> = ({ selected, onClick, title, subtitle, badge, badgeColor = '#715d99' }) => {
    return (
        <button
            onClick={onClick}
            className="w-full text-left rounded-xl px-3 py-2 active:scale-[0.98] transition-all"
            style={{
                background: selected
                    ? 'linear-gradient(135deg,rgba(167,139,250,0.18),rgba(124,58,237,0.08))'
                    : 'rgba(255,255,255,0.6)',
                border: selected
                    ? '1.5px solid #a78bfa'
                    : '1px solid rgba(170,140,210,0.25)',
            }}
        >
            <div className="flex items-center gap-2">
                <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: selected ? '#7c3aed' : 'rgba(150,120,190,0.4)' }}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-bold truncate" style={{ color: selected ? '#715d99' : '#4a3a6a' }}>{title}</span>
                        {badge && (
                            <span
                                className="text-[8.5px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: `${badgeColor}22`, color: badgeColor }}
                            >{badge}</span>
                        )}
                    </div>
                    {subtitle && (
                        <div className="text-[9.5px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.65)' }}>{subtitle}</div>
                    )}
                </div>
            </div>
        </button>
    );
};

/* 编辑 API 配置 modal(暮色 8-25 第六步第一批 + 8-26 保持不变) */
const EditApiConfigModal: React.FC<{
    config: RPApiConfig;
    onChange: (cfg: RPApiConfig) => void;
    onClose: () => void;
    onSave: (cfg: RPApiConfig) => Promise<void> | void;
}> = ({ config, onChange, onClose, onSave }) => {
    return (
        <div className="absolute inset-0 z-[60] flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} className="w-full max-w-md flex flex-col overflow-hidden"
                 style={{ background: 'white', borderRadius: 24, boxShadow: '0 20px 50px -20px rgba(150,120,200,0.4)' }}>
                <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'rgba(170,140,210,0.2)' }}>
                    <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>
                        <X size={14} weight="bold" />
                    </button>
                    <div className="text-[14px] font-bold" style={{ color: '#4a3a6a' }}>编辑配置</div>
                    <button onClick={() => onSave(config)} className="px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1" style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white' }}>
                        <Check size={11} weight="bold" />保存
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    <Field label="名称"><input type="text" value={config.name} onChange={e => onChange({ ...config, name: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none" style={inputStyle} /></Field>
                    <Field label="协议">
                        <select value={config.protocol} onChange={e => onChange({ ...config, protocol: e.target.value as any })} className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none" style={inputStyle}>
                            <option value="openai">OpenAI 兼容</option>
                            <option value="claude">Claude</option>
                            <option value="gemini">Gemini</option>
                        </select>
                    </Field>
                    <Field label="baseUrl"><input type="text" value={config.baseUrl} onChange={e => onChange({ ...config, baseUrl: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none" style={inputStyle} /></Field>
                    <Field label="apiKey"><input type="password" value={config.apiKey} onChange={e => onChange({ ...config, apiKey: e.target.value })} placeholder="可后填" className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none" style={inputStyle} /></Field>
                    <Field label="model"><input type="text" value={config.model} onChange={e => onChange({ ...config, model: e.target.value })} className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none" style={inputStyle} /></Field>
                </div>
            </div>
        </div>
    );
};

export default RPApiSettingsPage;
