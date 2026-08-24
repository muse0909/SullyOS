// McpSettings — MCP 服务器管理 UI（2026-08-23）
// 暮色 2026-08-23：cjjc 截图带来"自己添加 MCP"需求
// v1：配置存储 + UI 管理 + 测试连接
//   - 多服务器
//   - Bearer Token / Custom Headers 鉴权（脱敏）
//   - 可选代理（每 server 单独配；默认从 getProxyWorkerUrl() 拿）
//   - 错误分类展示
// v2：工具级管理
//   - 每个服务器展开后列出该 server 的 tools
//   - 工具独立启用/禁用 + 删除（删除后下次 tools/list 可重新出现）
//   - server enabled=false 时所有工具即使单独 enabled 也不能注入（AND 逻辑）
//   - 敏感工具（API key / token 等）自动打风险标记
//   - 工具状态按 serverId+toolName 稳定键保存，避免不同 server 同名互相覆盖
// 不接 useChatAI 实际 tool_call 调用链（第二版）

import React, { useEffect, useState } from 'react';
import { McpServerConfig, McpAuthType, McpErrorType, McpTool } from '../../types';
import { mcpStorage } from '../../utils/mcpStorage';
import { mcpClient, getMcpDefaultProxyHint } from '../../utils/mcpClient';

const KEY_INPUT_CLASS = "w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono focus:bg-white transition-all";

type EditDraft = {
    name: string;
    url: string;
    authType: McpAuthType;
    bearerToken: string;
    customHeadersRaw: string;     // 文本形式 "K1: V1\nK2: V2"，编辑态用
    proxyUrl: string;
    enabled: boolean;
};

const blankDraft = (): EditDraft => ({
    name: '',
    url: '',
    authType: 'none',
    bearerToken: '',
    customHeadersRaw: '',
    proxyUrl: '',
    enabled: true,
});

const draftFromConfig = (c: McpServerConfig): EditDraft => ({
    name: c.name,
    url: c.url,
    authType: c.authType,
    bearerToken: c.bearerToken ?? '',
    customHeadersRaw: c.customHeaders
        ? Object.entries(c.customHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')
        : '',
    proxyUrl: c.proxyUrl ?? '',
    enabled: c.enabled,
});

const parseCustomHeaders = (raw: string): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        const idx = line.indexOf(':');
        if (idx < 0) continue;
        const k = line.slice(0, idx).trim();
        const v = line.slice(idx + 1).trim();
        if (k && v) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
};

const ERROR_HINT: Record<McpErrorType, string> = {
    cors: '提示：浏览器 CORS 限制。配置代理或让 MCP 服务器允许跨域。',
    network: '提示：网络层错误（DNS / 连接 / 超时）。检查 URL 或网络。',
    auth: '提示：鉴权失败。检查 Bearer Token / 自定义 Header 是否正确。',
    protocol: '提示：MCP 协议层错误（响应格式不对 / 状态码 4xx/5xx）。',
    toolsList: '提示：连接成功但 tools/list 失败。MCP 服务器实现可能不完整。',
    unknown: '',
};

const statusBadge = (c: McpServerConfig): { text: string; color: string; dot: string } => {
    if (!c.lastTestedAt) {
        return { text: '未测试', color: 'text-slate-400', dot: 'bg-slate-300' };
    }
    if (c.lastError) {
        return {
            text: ERROR_HINT[c.lastErrorType ?? 'unknown'] || c.lastError.slice(0, 30),
            color: 'text-rose-600',
            dot: 'bg-rose-500',
        };
    }
    return { text: '已连接', color: 'text-emerald-600', dot: 'bg-emerald-500' };
};

// 暮色 2026-08-23 v2：单个工具行
//   - enabled 开关（server disabled 时强制关闭，不可点）
//   - 删除按钮（二次确认）
//   - 敏感工具标记
//   - inputSchema 状态展示
const McpToolRow: React.FC<{
    serverId: string;
    tool: McpTool;
    serverEnabled: boolean;
    onChanged: () => void;
}> = ({ serverId, tool, serverEnabled, onChanged }) => {
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const enabled = tool.enabled ?? true;   // 兼容旧数据
    // 暮色 2026-08-24 12:45：按需注入。缺字段视为 true（跟高频工具默认 true 一致）
    const inject = tool.inject ?? true;
    const blocked = !serverEnabled;

    const toggle = (e?: React.ChangeEvent<HTMLInputElement>) => {
        if (blocked) return;   // server disabled 时禁止
        e?.stopPropagation();   // 暮色 2026-08-23 23:51 修复：阻止 change 事件冒泡
        // 保险：阻止 change 事件冒泡
        e?.stopPropagation();
        mcpStorage.updateToolEnabled(serverId, tool.name, !enabled);
        onChanged();
    };
    // 暮色 2026-08-24 12:45：切换"自动注入"开关
    //   enabled=true 时才能切 inject（disabled 时 inject 也不生效，没必要显示）
    const toggleInject = (e?: React.ChangeEvent<HTMLInputElement>) => {
        if (blocked || !enabled) return;   // server/tool 禁用时不允许
        e?.stopPropagation();
        e?.stopPropagation();
        mcpStorage.updateToolInject(serverId, tool.name, !inject);
        onChanged();
    };
    const handleDelete = () => {
        mcpStorage.removeTool(serverId, tool.name);
        setConfirmingDelete(false);
        onChanged();
    };

    return (
        <div className={`rounded-xl border p-2.5 mb-1.5 ${blocked ? 'bg-slate-50/70 border-slate-200/40' : 'bg-white/80 border-slate-200/60'}`}>
            <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-mono font-bold text-slate-800 truncate">{tool.name}</span>
                        {tool.wasDeleted ? (
                            <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0" title="你之前删过这个工具，下次 testConnection 拿到时会自动重新出现">之前删过</span>
                        ) : null}
                        {tool.isSensitive ? (
                            <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0">⚠ 风险</span>
                        ) : null}
                        {blocked ? (
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">服务器已禁用</span>
                        ) : null}
                    </div>
                    {tool.description ? (
                        <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{tool.description}</div>
                    ) : null}
                    <div className="text-[9px] text-slate-400 mt-0.5">
                        {tool.inputSchema ? '✓ 有 inputSchema' : '无 schema'}
                    </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <label className={`flex items-center cursor-pointer ${blocked ? 'opacity-40 pointer-events-none' : ''}`}>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onChange={toggle}
                            className="sr-only peer"
                        />
                        <div className="w-8 h-4 bg-slate-200 rounded-full peer peer-checked:bg-emerald-500 relative transition-colors">
                            <div className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                        </div>
                    </label>
                    {/* 暮色 2026-08-24 12:45：自动注入开关（按需注入）
                        - 独立小开关，蓝色 = 自动注入 LLM schema
                        - server disabled / tool disabled 时灰掉
                        - 不存工具名进 system prompt 末尾，让 LLM 知道"有但没展示参数" */}
                    <label
                        className={`flex items-center cursor-pointer ${blocked || !enabled ? 'opacity-40 pointer-events-none' : ''}`}
                        title={inject ? '已注入：工具 schema 进 LLM context' : '未注入：只告诉 LLM 工具有，schema 不进 context'}
                    >
                        <input
                            type="checkbox"
                            checked={inject}
                            onChange={toggleInject}
                            className="sr-only peer"
                        />
                        <div className="w-7 h-3.5 bg-slate-200 rounded-full peer peer-checked:bg-sky-500 relative transition-colors">
                            <div className="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform peer-checked:translate-x-3.5" />
                        </div>
                    </label>
                    {!confirmingDelete ? (
                        <button
                            onClick={() => setConfirmingDelete(true)}
                            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:bg-rose-50 px-1.5 py-0.5 rounded"
                            title="删除（下次 tools/list 拿到会重新出现）"
                        >
                            删
                        </button>
                    ) : (
                        <button
                            onClick={handleDelete}
                            className="text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 px-1.5 py-0.5 rounded"
                        >
                            确认
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// 暮色 2026-08-23 v3：敏感工具授权二次确认弹窗
//   isSensitive 工具（如 show_api_key）默认不注入 LLM
//   用户必须点"启用风险工具"→ 弹窗确认 → 写 server.allowSensitive=true
//   弹窗里列出会被授权的具体工具名 + 风险提示
const McpAllowSensitiveConfirm: React.FC<{
    serverName: string;
    sensitiveToolNames: string[];
    onConfirm: () => void;
    onCancel: () => void;
}> = ({ serverName, sensitiveToolNames, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl shrink-0">⚠️</div>
                    <div>
                        <div className="text-base font-bold text-slate-800">启用风险工具</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">服务器「{serverName}」</div>
                    </div>
                </div>
                <div className="text-[12px] text-slate-700 leading-relaxed mb-3">
                    以下工具已知会暴露敏感信息（API key、token 等）。启用后这些工具会被注入 LLM，
                    <span className="font-bold text-rose-700">AI 可以随时调用它们</span>。
                </div>
                <div className="bg-amber-50 border border-amber-200/60 rounded-xl px-3 py-2 mb-3 max-h-32 overflow-y-auto">
                    {sensitiveToolNames.map((n) => (
                        <div key={n} className="text-[11px] font-mono text-amber-900 py-0.5">• {n}</div>
                    ))}
                </div>
                <div className="text-[10px] text-slate-500 leading-relaxed mb-4">
                    提示：如果你不确定这些工具的作用，建议保持默认（不注入）。可以单独禁用某个工具的开关
                    （在下方"工具"列表里关掉），不必启用整个"风险工具"授权。
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 text-[12px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 py-2 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 text-[12px] font-bold text-white bg-amber-600 hover:bg-amber-700 py-2 rounded-lg transition-colors"
                    >
                        我已了解风险，启用
                    </button>
                </div>
            </div>
        </div>
    );
};

const McpServerRow: React.FC<{
    config: McpServerConfig;
    onChanged: () => void;
    onEdit: (c: McpServerConfig) => void;
    editingId: string | null;
    cancelEdit: () => void;
}> = ({ config, onChanged, onEdit, editingId, cancelEdit }) => {
    const [draft, setDraft] = useState<EditDraft>(draftFromConfig(config));
    const [showBearer, setShowBearer] = useState(false);
    const [testing, setTesting] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [toolsExpanded, setToolsExpanded] = useState(false);   // 暮色 2026-08-23 v2：工具列表展开
    const [allowSensitiveConfirmOpen, setAllowSensitiveConfirmOpen] = useState(false);   // 暮色 2026-08-23 v3：敏感工具授权二次确认

    const isEditing = editingId === config.id;
    const badge = statusBadge(config);

    useEffect(() => {
        if (isEditing) setDraft(draftFromConfig(config));
    }, [isEditing, config]);

    const handleSave = () => {
        if (!draft.url.trim()) return;
        mcpStorage.update(config.id, {
            name: draft.name.trim() || '未命名 MCP',
            url: draft.url.trim(),
            authType: draft.authType,
            bearerToken: draft.bearerToken.trim() || undefined,
            customHeaders: draft.authType === 'headers' ? parseCustomHeaders(draft.customHeadersRaw) : undefined,
            proxyUrl: draft.proxyUrl.trim() || undefined,
            enabled: draft.enabled,
        });
        cancelEdit();
        onChanged();
    };

    const handleTest = async () => {
        setTesting(true);
        try {
            // 用最新 draft 测（编辑态下也能测）
            const live = isEditing ? mcpStorage.update(config.id, {
                name: draft.name.trim() || '未命名 MCP',
                url: draft.url.trim(),
                authType: draft.authType,
                bearerToken: draft.bearerToken.trim() || undefined,
                customHeaders: draft.authType === 'headers' ? parseCustomHeaders(draft.customHeadersRaw) : undefined,
                proxyUrl: draft.proxyUrl.trim() || undefined,
                enabled: draft.enabled,
            }) || config : config;
            const result = await mcpClient.testConnection(live);
            if (result.ok) {
                mcpStorage.recordTestResult(config.id, { ok: true, tools: result.tools });
            } else {
                mcpStorage.recordTestResult(config.id, { ok: false, error: result.error, errorType: result.errorType });
            }
            onChanged();
        } finally {
            setTesting(false);
        }
    };

    const handleDelete = () => {
        mcpClient.resetSession(config.id);
        mcpStorage.remove(config.id);
        setConfirmingDelete(false);
        onChanged();
    };

    const handleToggleEnabled = () => {
        mcpStorage.update(config.id, { enabled: !config.enabled });
        onChanged();
    };

    const sensitiveToolNames = (config.tools ?? []).filter((t) => t.isSensitive).map((t) => t.name);
    const hasSensitiveTools = sensitiveToolNames.length > 0;

    return (
        <div className="bg-white/70 rounded-2xl border border-slate-200/60 p-3 mb-2">
            {!isEditing ? (
                <>
                    <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${badge.dot} shrink-0`} />
                                <span className="text-sm font-bold text-slate-800 truncate">{config.name}</span>
                                {config.enabled ? null : (
                                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">已禁用</span>
                                )}
                                {hasSensitiveTools ? (
                                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded" title="此服务器包含风险工具（API key / token 等），默认不注入 LLM">
                                        ⚠ {sensitiveToolNames.length} 个风险工具
                                    </span>
                                ) : null}
                                {config.allowSensitive ? (
                                    <span className="text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded" title="已授权将风险工具注入 LLM">
                                        风险已授权
                                    </span>
                                ) : null}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5" title={config.url}>{config.url}</div>
                            <div className={`text-[10px] mt-1.5 ${badge.color}`} title={config.lastError || badge.text}>
                                {badge.text}
                                {config.tools && config.tools.length > 0 ? ` · ${config.tools.length} 个工具` : ''}
                            </div>
                        </div>
                        <label className="flex items-center cursor-pointer shrink-0">
                            <input
                                type="checkbox"
                                checked={config.enabled}
                                onChange={handleToggleEnabled}
                                className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:bg-emerald-500 relative transition-colors">
                                <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                            </div>
                        </label>
                    </div>
                    <div className="flex gap-1.5 mt-2.5">
                        <button
                            onClick={handleTest}
                            disabled={testing}
                            className="flex-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 py-1.5 rounded-lg transition-colors"
                        >
                            {testing ? '测试中…' : '测试连接'}
                        </button>
                        <button
                            onClick={() => onEdit(config)}
                            className="flex-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 py-1.5 rounded-lg transition-colors"
                        >
                            编辑
                        </button>
                        {!confirmingDelete ? (
                            <button
                                onClick={() => setConfirmingDelete(true)}
                                className="text-[11px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                删除
                            </button>
                        ) : (
                            <button
                                onClick={handleDelete}
                                className="text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 px-3 py-1.5 rounded-lg transition-colors"
                            >
                                确认删除
                            </button>
                        )}
                    </div>

                    {/* 暮色 2026-08-23 v3：风险工具授权开关（仅当 server 有敏感工具时显示） */}
                    {hasSensitiveTools ? (
                        <div className="mt-2 flex items-center justify-between gap-2 px-1">
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold text-amber-800">风险工具授权</div>
                                <div className="text-[9px] text-slate-500 leading-relaxed">
                                    {config.allowSensitive
                                        ? `已授权 ${sensitiveToolNames.length} 个工具注入 LLM`
                                        : `默认不注入 ${sensitiveToolNames.length} 个敏感工具（API key / token 等）`}
                                </div>
                            </div>
                            {config.allowSensitive ? (
                                <button
                                    onClick={() => {
                                        // 暮色 2026-08-23 v3 修复：撤销授权必须刷新 UI
                                        //   之前写成 update(...) || onChanged()，但 update 返回 truthy 对象
                                        //   || 短路，onChanged() 永远不被调用 → 按钮"无响应"
                                        mcpStorage.update(config.id, { allowSensitive: false });
                                        onChanged();
                                    }}
                                    className="text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition-colors"
                                >
                                    撤销授权
                                </button>
                            ) : (
                                <button
                                    onClick={() => setAllowSensitiveConfirmOpen(true)}
                                    className="text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg transition-colors"
                                >
                                    启用
                                </button>
                            )}
                        </div>
                    ) : null}

                    {/* 暮色 2026-08-23 v2：工具列表展开 */}
                    {config.tools && config.tools.length > 0 ? (
                        <div className="mt-2.5">
                            <button
                                onClick={() => setToolsExpanded((v) => !v)}
                                className="w-full flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1 py-1 hover:text-slate-700"
                            >
                                <span>工具 ({config.tools.length})</span>
                                <span className="text-slate-400">{toolsExpanded ? '收起 ▴' : '展开 ▾'}</span>
                            </button>
                            {toolsExpanded ? (
                                <div className="mt-1.5">
                                    {config.tools.map((t) => (
                                        <McpToolRow
                                            key={t.name}
                                            serverId={config.id}
                                            tool={t}
                                            serverEnabled={config.enabled}
                                            onChanged={onChanged}
                                        />
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </>
            ) : (
                <McpEditor
                    draft={draft}
                    setDraft={setDraft}
                    showBearer={showBearer}
                    setShowBearer={setShowBearer}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                    onTest={handleTest}
                    testing={testing}
                />
            )}
            {allowSensitiveConfirmOpen ? (
                <McpAllowSensitiveConfirm
                    serverName={config.name}
                    sensitiveToolNames={sensitiveToolNames}
                    onConfirm={() => {
                        mcpStorage.update(config.id, { allowSensitive: true });
                        setAllowSensitiveConfirmOpen(false);
                        onChanged();
                    }}
                    onCancel={() => setAllowSensitiveConfirmOpen(false)}
                />
            ) : null}
        </div>
    );
};

const McpEditor: React.FC<{
    draft: EditDraft;
    setDraft: (d: EditDraft) => void;
    showBearer: boolean;
    setShowBearer: (b: boolean) => void;
    onSave: () => void;
    onCancel: () => void;
    onTest: () => void;
    testing: boolean;
}> = ({ draft, setDraft, showBearer, setShowBearer, onSave, onCancel, onTest, testing }) => {
    const defaultProxy = getMcpDefaultProxyHint();
    return (
        <div className="space-y-2.5">
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">名称</label>
                <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="如：cjjc 小红书"
                    className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm focus:bg-white transition-all"
                />
            </div>
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">URL</label>
                <input
                    type="text"
                    value={draft.url}
                    onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                    placeholder="https://example.com/mcp"
                    className={KEY_INPUT_CLASS}
                />
            </div>
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">鉴权方式</label>
                <div className="flex gap-1.5">
                    {(['none', 'bearer', 'headers'] as McpAuthType[]).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => setDraft({ ...draft, authType: t })}
                            className={`flex-1 text-[11px] font-bold py-1.5 rounded-lg transition-colors ${
                                draft.authType === t
                                    ? 'bg-slate-800 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                            {t === 'none' ? '无' : t === 'bearer' ? 'Bearer' : '自定义头'}
                        </button>
                    ))}
                </div>
            </div>
            {draft.authType === 'bearer' ? (
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">Bearer Token</label>
                    <div className="relative">
                        <input
                            type={showBearer ? 'text' : 'password'}
                            value={draft.bearerToken}
                            onChange={(e) => setDraft({ ...draft, bearerToken: e.target.value })}
                            placeholder="sk-..."
                            className={KEY_INPUT_CLASS}
                        />
                        <button
                            type="button"
                            onClick={() => setShowBearer(!showBearer)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100"
                        >
                            {showBearer ? '隐藏' : '显示'}
                        </button>
                    </div>
                </div>
            ) : null}
            {draft.authType === 'headers' ? (
                <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">
                        自定义 Headers（每行一个，格式：键: 值）
                    </label>
                    <textarea
                        value={draft.customHeadersRaw}
                        onChange={(e) => setDraft({ ...draft, customHeadersRaw: e.target.value })}
                        placeholder={'X-API-Key: abc123\nX-Tenant: foo'}
                        rows={3}
                        className={KEY_INPUT_CLASS}
                    />
                </div>
            ) : null}
            <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">
                    代理 URL（可选，留空走默认）
                </label>
                <input
                    type="text"
                    value={draft.proxyUrl}
                    onChange={(e) => setDraft({ ...draft, proxyUrl: e.target.value })}
                    placeholder={defaultProxy}
                    className={KEY_INPUT_CLASS}
                />
                <div className="text-[10px] text-slate-400 mt-1 pl-1">
                    默认代理：<span className="font-mono">{defaultProxy}</span>
                </div>
            </div>
            <div className="flex gap-1.5 pt-1">
                <button
                    onClick={onSave}
                    disabled={!draft.url.trim()}
                    className="flex-1 text-[11px] font-bold text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-40 py-1.5 rounded-lg transition-colors"
                >
                    保存
                </button>
                <button
                    onClick={onTest}
                    disabled={testing || !draft.url.trim()}
                    className="flex-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 py-1.5 rounded-lg transition-colors"
                >
                    {testing ? '测试中…' : '测试'}
                </button>
                <button
                    onClick={onCancel}
                    className="flex-1 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 py-1.5 rounded-lg transition-colors"
                >
                    取消
                </button>
            </div>
        </div>
    );
};

const McpSettings: React.FC = () => {
    const [configs, setConfigs] = useState<McpServerConfig[]>(() => mcpStorage.getAll());
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [addDraft, setAddDraft] = useState<EditDraft>(blankDraft());
    const [addShowBearer, setAddShowBearer] = useState(false);

    const refresh = () => setConfigs(mcpStorage.getAll());

    const handleAdd = () => {
        if (!addDraft.url.trim()) return;
        mcpStorage.add({
            name: addDraft.name.trim() || '未命名 MCP',
            url: addDraft.url.trim(),
            enabled: addDraft.enabled,
            transport: 'streamable-http',
            authType: addDraft.authType,
            bearerToken: addDraft.bearerToken.trim() || undefined,
            customHeaders: addDraft.authType === 'headers' ? parseCustomHeaders(addDraft.customHeadersRaw) : undefined,
        });
        setAddDraft(blankDraft());
        setShowAdd(false);
        refresh();
    };

    const handleTestNew = async () => {
        // 新增态先临时 add 再测，测完保留（也可加"测完即丢弃"但第一版简化为测完保留）
        if (!addDraft.url.trim()) return;
        const temp = mcpStorage.add({
            name: addDraft.name.trim() || '未命名 MCP',
            url: addDraft.url.trim(),
            enabled: addDraft.enabled,
            transport: 'streamable-http',
            authType: addDraft.authType,
            bearerToken: addDraft.bearerToken.trim() || undefined,
            customHeaders: addDraft.authType === 'headers' ? parseCustomHeaders(addDraft.customHeadersRaw) : undefined,
        });
        const result = await mcpClient.testConnection(temp);
        if (result.ok) {
            mcpStorage.recordTestResult(temp.id, { ok: true, tools: result.tools });
        } else {
            mcpStorage.recordTestResult(temp.id, { ok: false, error: result.error, errorType: result.errorType });
        }
        setAddDraft(blankDraft());
        setShowAdd(false);
        refresh();
    };

    return (
        <div className="px-3 pb-3">
            <div className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                MCP（Model Context Protocol）服务器管理。第一版只做配置 + 测试连接，
                工具调用接入 chat 在第二版。鉴权头和 token 不会被写入日志。
            </div>

            {configs.length === 0 && !showAdd ? (
                <div className="text-center text-[11px] text-slate-400 py-6">
                    还没有 MCP 服务器。点下方"添加"开始。
                </div>
            ) : null}

            {configs.map((c) => (
                <McpServerRow
                    key={c.id}
                    config={c}
                    onChanged={refresh}
                    onEdit={(cfg) => { setShowAdd(false); setEditingId(cfg.id); }}
                    editingId={editingId}
                    cancelEdit={() => setEditingId(null)}
                />
            ))}

            {showAdd ? (
                <div className="bg-white/70 rounded-2xl border-2 border-emerald-200 p-3 mb-2">
                    <div className="text-[11px] font-bold text-emerald-700 mb-2">添加 MCP 服务器</div>
                    <McpEditor
                        draft={addDraft}
                        setDraft={setAddDraft}
                        showBearer={addShowBearer}
                        setShowBearer={setAddShowBearer}
                        onSave={handleAdd}
                        onCancel={() => { setShowAdd(false); setAddDraft(blankDraft()); }}
                        onTest={handleTestNew}
                        testing={false}
                    />
                </div>
            ) : (
                <button
                    onClick={() => { setEditingId(null); setShowAdd(true); }}
                    className="w-full text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 py-2 rounded-xl transition-colors"
                >
                    + 添加 MCP 服务器
                </button>
            )}
        </div>
    );
};

export default McpSettings;
