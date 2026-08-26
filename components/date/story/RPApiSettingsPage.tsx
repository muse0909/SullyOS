/**
 * RP API 设置页 — 暮色 8-25 第六步第一批
 *
 * 暮色 8-25:
 *   - RP 模式可单独选模型/API key/endpoint,默认继承主聊天 API
 *   - 列表页齿轮按钮进入
 *   - 本步只实现 openai 协议流式,claude/gemini 协议 fallback 非流式(在 StoryTheaterSession 提示)
 *   - 测通用普通 completion 请求(发"hi"看是否回),不用流式(中转站可能支持普通不支持流式)
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus, PencilSimple, Trash, Lightning, Check, X, CircleNotch, ArrowSquareOut } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { DB } from '../../../utils/db';
import { testRPApiConfig as testRPApiConfigFn } from '../../../utils/storyTheater';
import { generateClientId } from '../../../utils/db';
import { SELECT_THEME } from './storyTheme';
import Modal from '../../os/Modal';
import type { RPApiConfig } from '../../../types';

interface Props {
    onClose: () => void;
}

const RPApiSettingsPage: React.FC<Props> = ({ onClose }) => {
    const { apiConfig: mainApiConfig, addToast } = useOS();
    const [configs, setConfigs] = useState<RPApiConfig[]>([]);
    const [editing, setEditing] = useState<RPApiConfig | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [deletingCfg, setDeletingCfg] = useState<RPApiConfig | null>(null);

    // 加载
    const reload = useCallback(async () => {
        const stored = await DB.getRPApiConfigs();
        setConfigs(stored);
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    // 新建配置(打开 modal,初始填主 apiConfig 套壳)
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

    return (
        <div className="absolute inset-0 z-50 flex flex-col font-light" style={{ background: SELECT_THEME.pageBg }}>
            <div className="absolute inset-0 pointer-events-none opacity-70" style={{ backgroundImage: SELECT_THEME.stars }} />

            {/* 顶栏 */}
            <div className="relative z-10 shrink-0" style={{ paddingTop: 'max(1.25rem, var(--safe-top))' }}>
                <div className="relative flex items-center justify-center px-5 pt-2">
                    <button onClick={onClose} className="absolute left-4 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all"
                            style={{ color: '#8f7bb5', background: 'rgba(255,255,255,0.6)', boxShadow: '0 2px 8px rgba(150,120,200,0.15)' }}>
                        <ArrowLeft size={18} weight="bold" />
                    </button>
                    <div className="text-center">
                        <h1 className="text-[22px] tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, color: SELECT_THEME.title, textShadow: `0 2px 18px ${SELECT_THEME.titleShadow}` }}>API 设置</h1>
                        <div className="flex items-center justify-center gap-2 mt-1.5">
                            <span className="h-px w-10" style={{ background: `linear-gradient(90deg,transparent,${SELECT_THEME.line})` }} />
                            <span className="text-[9px] tracking-[0.4em] font-bold" style={{ color: 'rgba(150,120,190,0.75)' }}>✦ RP API ✦</span>
                            <span className="h-px w-10" style={{ background: `linear-gradient(270deg,transparent,${SELECT_THEME.line})` }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* 主体滚动 */}
            <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-5 py-4">
                {configs.length === 0 ? (
                    <div className="text-center text-[12px] py-12" style={{ color: 'rgba(150,120,190,0.7)' }}>
                        还没有独立配置,剧场用主聊天 API
                    </div>
                ) : (
                    <div className="space-y-2">
                        {configs.map(cfg => (
                            <div
                                key={cfg.id}
                                className="rounded-2xl px-3.5 py-3"
                                style={{
                                    background: 'rgba(255,255,255,0.7)',
                                    border: '1px solid rgba(170,140,210,0.3)',
                                    boxShadow: '0 2px 8px rgba(150,120,200,0.08)',
                                }}
                            >
                                <div className="flex items-start gap-2 mb-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[14px] font-bold" style={{ color: '#4a3a6a' }}>{cfg.name}</span>
                                            {cfg.isDefault && (
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,250,0.15)', color: '#715d99' }}>默认</span>
                                            )}
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: cfg.protocol === 'openai' ? 'rgba(99,102,241,0.12)' : 'rgba(150,150,150,0.12)', color: cfg.protocol === 'openai' ? '#4f46e5' : '#666' }}>{cfg.protocol}</span>
                                        </div>
                                        <div className="text-[10px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.7)' }}>{cfg.model}</div>
                                        <div className="text-[9px] mt-0.5 truncate" style={{ color: 'rgba(150,120,190,0.5)' }}>{cfg.baseUrl}</div>
                                    </div>
                                </div>
                                <div className="flex gap-1.5">
                                    <button onClick={() => handleTest(cfg)} disabled={testingId === cfg.id}
                                            className="flex-1 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                                            style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
                                        {testingId === cfg.id ? <CircleNotch size={11} className="animate-spin" /> : <Lightning size={11} weight="fill" />}
                                        测通
                                    </button>
                                    <button onClick={() => handleEdit(cfg)} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
                                            style={{ background: 'rgba(99,102,241,0.1)', color: '#4f46e5' }}>
                                        <PencilSimple size={11} weight="bold" />编辑
                                    </button>
                                    {!cfg.isDefault && (
                                        <button onClick={() => setDeletingCfg(cfg)} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
                                                style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                            <Trash size={11} weight="fill" />删除
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 底部"+ 新建" */}
            <div className="relative z-10 shrink-0 px-5 pb-5 pt-2" style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}>
                <button onClick={handleNew} className="w-full py-3 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                        style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 6px 20px rgba(124,58,237,0.3)' }}>
                    <Plus size={16} weight="bold" />新建配置
                </button>
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
                <div className="flex gap-3 w-full">
                    <button onClick={() => setDeletingCfg(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">取消</button>
                    <button onClick={() => deletingCfg && handleDelete(deletingCfg)} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold shadow-lg shadow-red-200">删除</button>
                </div>
            }>
                <div className="text-center text-slate-600 text-sm py-4">
                    确定删除「{deletingCfg?.name}」吗?
                    <div className="text-xs text-slate-400 mt-2">使用此配置的剧场会回退到主聊天 API</div>
                </div>
            </Modal>
        </div>
    );
};

/* ── 编辑 modal ── */
const EditApiConfigModal: React.FC<{
    config: RPApiConfig;
    onChange: (c: RPApiConfig) => void;
    onSave: () => void;
    onClose: () => void;
}> = ({ config, onChange, onSave, onClose }) => {
    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
            <div className="w-full max-w-md max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}
                 style={{ background: 'linear-gradient(160deg,#ffffff 0%,#f7f2fb 100%)', borderRadius: 24, border: '1px solid rgba(170,140,210,0.3)', boxShadow: '0 20px 50px -20px rgba(150,120,200,0.4)' }}>
                <div className="h-[2px] w-full" style={{ background: 'linear-gradient(90deg,transparent,#a78bfa,#7c3aed,transparent)' }} />
                <div className="px-6 pt-5 pb-2 text-center">
                    <div className="text-[10px] tracking-[0.3em] uppercase font-bold" style={{ color: '#7c3aed' }}>EDIT API</div>
                    <h3 className="text-[18px] font-bold mt-1" style={{ color: '#4a3a6a' }}>{config.isDefault ? '查看默认配置' : '编辑配置'}</h3>
                </div>
                <div className="px-6 py-3 space-y-3 overflow-y-auto no-scrollbar">
                    <Field label="名称">
                        <input value={config.name} onChange={e => onChange({ ...config, name: e.target.value, updatedAt: Date.now() })}
                               disabled={config.isDefault}
                               className="w-full mt-1 px-3 py-2 rounded-xl text-[13px] focus:outline-none disabled:opacity-60"
                               style={inputStyle} />
                    </Field>
                    <Field label="协议(本步只测通 openai)">
                        <div className="grid grid-cols-3 gap-1.5 mt-1">
                            {(['openai', 'claude', 'gemini'] as const).map(p => (
                                <button key={p} onClick={() => !config.isDefault && onChange({ ...config, protocol: p, updatedAt: Date.now() })}
                                        disabled={config.isDefault}
                                        className="py-1.5 rounded-lg text-[11px] font-bold uppercase active:scale-95 transition-all disabled:opacity-60"
                                        style={{
                                            background: config.protocol === p ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.5)',
                                            border: config.protocol === p ? '1.5px solid #a78bfa' : '1px solid rgba(170,140,210,0.25)',
                                            color: config.protocol === p ? '#715d99' : 'rgba(150,120,190,0.7)',
                                        }}>{p}</button>
                            ))}
                        </div>
                        <div className="text-[9px] mt-1" style={{ color: 'rgba(150,120,190,0.6)' }}>
                            非 openai 协议当前只支持非流式(整段回复)
                        </div>
                    </Field>
                    <Field label="baseUrl">
                        <input value={config.baseUrl} onChange={e => onChange({ ...config, baseUrl: e.target.value, updatedAt: Date.now() })}
                               disabled={config.isDefault}
                               placeholder="https://api.openai.com/v1"
                               className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none disabled:opacity-60 font-mono"
                               style={inputStyle} />
                    </Field>
                    <Field label="apiKey">
                        <input value={config.apiKey} onChange={e => onChange({ ...config, apiKey: e.target.value, updatedAt: Date.now() })}
                               disabled={config.isDefault}
                               type="password" placeholder="sk-..."
                               className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none disabled:opacity-60 font-mono"
                               style={inputStyle} />
                    </Field>
                    <Field label="model">
                        <input value={config.model} onChange={e => onChange({ ...config, model: e.target.value, updatedAt: Date.now() })}
                               disabled={config.isDefault}
                               placeholder="gpt-4o / claude-3-5-sonnet / gemini-2.0-flash"
                               className="w-full mt-1 px-3 py-2 rounded-xl text-[12px] focus:outline-none disabled:opacity-60 font-mono"
                               style={inputStyle} />
                    </Field>
                </div>
                <div className="px-6 pb-5 pt-2 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold"
                            style={{ background: 'rgba(170,140,210,0.1)', color: '#715d99' }}>取消</button>
                    {!config.isDefault && (
                        <button onClick={onSave} className="flex-1 py-2.5 rounded-2xl text-[13px] font-bold flex items-center justify-center gap-1.5"
                                style={{ background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', color: 'white', boxShadow: '0 4px 14px rgba(124,58,237,0.3)' }}>
                            <Check size={13} weight="bold" />保存
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div>
        <div className="text-[10px] font-bold tracking-wider" style={{ color: '#715d99' }}>{label}</div>
        {children}
    </div>
);

const inputStyle: React.CSSProperties = {
    background: 'white',
    border: '1px solid rgba(170,140,210,0.3)',
    color: '#1f2937',
};

export default RPApiSettingsPage;
