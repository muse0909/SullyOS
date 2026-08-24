// mcpStorage — MCP 服务器配置的持久化封装（2026-08-23）
// 暮色 2026-08-23："配置持久化使用现有 DB / storage 封装，不要直接散落 localStorage"
// 选 localStorage 而非 IndexedDB：
//   - 配置项少（个位数 server × 小 JSON）
//   - 同步读写方便（首屏渲染时直接读）
//   - 跟 os_api_config / sully_proxy_worker_url_v1 同款风格
// 严禁在外部直接 localStorage.getItem(LS_KEY)，都走这里的封装（未来要换 IndexedDB 改一个文件就行）

import { McpServerConfig, McpAuthType, McpTransport, McpTool } from '../types';

const LS_KEY = 'os_mcp_servers_v1';

/**
 * 暮色 2026-08-23 v3 明确要求：敏感工具**硬编码**列表，**不做自动检测**。
 * 第一版不引入关键词匹配规则（"包含 token / secret / password 之类的就标 sensitive"）
 * 这种方式误伤多（很多合法工具名字里有 token：get_token_from_url、token_counter 之类）
 * 改用已知危险工具名硬编码集合，由暮色人工维护。
 *
 * mcpToLlmTools 默认不注入 sensitive 工具；
 * UI 提供"启用风险工具"二次确认弹窗 + 持久化 server.allowSensitive
 */
export const KNOWN_SENSITIVE_TOOLS: string[] = [
    'show_api_key',         // jina 那个 dump bearer token 的
    'get_bearer_token',
    'get_token',
    'dump_credentials',
    'dump_secrets',
    'reveal_password',
    'get_api_key',
    'reveal_api_key',
    'echo_auth_header',     // 通用：把 Authorization 头回显给模型
    'list_api_keys',
];

const isSensitiveToolName = (name: string): boolean => {
    return KNOWN_SENSITIVE_TOOLS.includes(name);
};

const genId = (): string => {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        return (crypto as any).randomUUID();
    }
    // fallback：时间戳 + 随机数（不够强但够用，老浏览器才走这里）
    return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const readRaw = (): McpServerConfig[] => {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((c: any) => c && typeof c.id === 'string' && typeof c.url === 'string');
    } catch {
        return [];
    }
};

const writeRaw = (configs: McpServerConfig[]): void => {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(configs));
    } catch (e) {
        console.warn('[MCP/Storage] 写入失败（quota 超限？）：', e);
    }
};

export const mcpStorage = {
    /** 读全部，按 createdAt 升序（先加的在前） */
    getAll(): McpServerConfig[] {
        return readRaw().sort((a, b) => a.createdAt - b.createdAt);
    },

    /** 按 id 读单个 */
    get(id: string): McpServerConfig | null {
        return readRaw().find((c) => c.id === id) ?? null;
    },

    /** 新增一个，返回带 id 的对象 */
    add(input: {
        name: string;
        url: string;
        enabled?: boolean;
        transport?: McpTransport;
        authType?: McpAuthType;
        bearerToken?: string;
        customHeaders?: Record<string, string>;
    }): McpServerConfig {
        const config: McpServerConfig = {
            id: genId(),
            name: input.name.trim() || '未命名 MCP',
            url: input.url.trim(),
            enabled: input.enabled ?? true,
            transport: input.transport ?? 'streamable-http',
            authType: input.authType ?? 'none',
            bearerToken: input.bearerToken?.trim() || undefined,
            customHeaders: input.customHeaders,
            createdAt: Date.now(),
        };
        const all = readRaw();
        all.push(config);
        writeRaw(all);
        return config;
    },

    /** 局部更新（id 不可改，name 只做展示） */
    update(id: string, updates: Partial<Omit<McpServerConfig, 'id' | 'createdAt'>>): McpServerConfig | null {
        const all = readRaw();
        const idx = all.findIndex((c) => c.id === id);
        if (idx < 0) return null;
        const merged: McpServerConfig = {
            ...all[idx],
            ...updates,
            id: all[idx].id,                    // 保护 id
            createdAt: all[idx].createdAt,      // 保护 createdAt
        };
        // 清洗空字符串 → undefined
        if (merged.bearerToken === '') merged.bearerToken = undefined;
        if (merged.customHeaders && Object.keys(merged.customHeaders).length === 0) {
            merged.customHeaders = undefined;
        }
        all[idx] = merged;
        writeRaw(all);
        return merged;
    },

    /** 删一个 */
    remove(id: string): void {
        const all = readRaw().filter((c) => c.id !== id);
        writeRaw(all);
    },

    /** 只更新测试结果（不重置其他字段）
     *  暮色 2026-08-23 v2：成功路径走 mergeTools 合并，不无条覆盖用户已禁用的工具
     *  失败路径只更新错误信息，不动 tools
     */
    recordTestResult(
        id: string,
        result: { ok: true; tools: McpTool[] } | { ok: false; error: string; errorType: McpServerConfig['lastErrorType'] }
    ): void {
        const now = Date.now();
        if (result.ok) {
            this.update(id, {
                lastTestedAt: now,
                lastConnectedAt: now,
                lastError: undefined,
                lastErrorType: undefined,
            });
            // 单独走合并逻辑：保留用户已禁用的工具 enabled 状态
            this.mergeTools(id, result.tools);
        } else {
            this.update(id, {
                lastTestedAt: now,
                lastError: result.error,
                lastErrorType: result.errorType,
            });
        }
    },

    /** 清空所有（理论上不该用，留给调试） */
    clearAll(): void {
        writeRaw([]);
    },

    // ==================== 工具级操作（暮色 2026-08-23 v2）====================

    /**
     * 合并新 tools 列表到指定 server。
     * 核心规则（暮色 8-23 v2 规格 + v2.1 删过标记）：
     *   - 按 serverId + toolName 稳定键合并（避免不同 server 同名工具互相覆盖）
     *   - 已有工具保留原 enabled 状态（兼容旧数据：缺 enabled 视为 true）
     *   - 新增工具默认 enabled=true
     *   - 不无条件覆盖用户已经禁用的状态
     *   - 删除 = 从 storage 移除（merge 时不再保留"已删除"标记）
     *     所以用户删过的工具下次 testConnection 拿到会重新出现（按新工具处理）
     *   - 敏感工具名（KNOWN_SENSITIVE_TOOLS 硬编码）自动打 isSensitive
     *   - 暮色 2026-08-23 v2.1：merge 时根据 deletedToolHistory 设 wasDeleted=true
     *     仅 UI 提示用，不阻止重新出现
     */
    mergeTools(serverId: string, newTools: McpTool[]): void {
        const config = this.get(serverId);
        if (!config) return;
        const oldTools = config.tools ?? [];
        const oldMap = new Map<string, McpTool>(oldTools.map((t) => [this.toolKey(serverId, t.name), t]));
        const history = new Set(config.deletedToolHistory ?? []);

        const merged: McpTool[] = newTools.map((nt) => {
            const key = this.toolKey(serverId, nt.name);
            const old = oldMap.get(key);
            const enabled = old?.enabled ?? true;       // 兼容旧数据 + 保留用户已禁用
            // 暮色 2026-08-24 12:45：inject 默认值
            //   - 老数据（无 inject 字段）→ 用 DEFAULT_INJECT_TOOLS 集合判断（高频工具 true）
            //   - 用户手动设过 → 保留（old?.inject）
            const inject = old?.inject ?? DEFAULT_INJECT_TOOLS.has(nt.name);
            const isSensitive = isSensitiveToolName(nt.name);
            const wasDeleted = history.has(nt.name);   // v2.1 删过标记
            return {
                name: nt.name,
                description: nt.description,
                inputSchema: nt.inputSchema,
                enabled,
                inject,
                isSensitive,
                wasDeleted,
            };
        });

        this.update(serverId, { tools: merged });
    },

    /** 改单个工具 enabled */
    updateToolEnabled(serverId: string, toolName: string, enabled: boolean): void {
        const config = this.get(serverId);
        if (!config?.tools) return;
        const next = config.tools.map((t) => (t.name === toolName ? { ...t, enabled } : t));
        this.update(serverId, { tools: next });
    },

    /** 暮色 2026-08-24 12:45：改单个工具 inject（按需注入开关） */
    updateToolInject(serverId: string, toolName: string, inject: boolean): void {
        const config = this.get(serverId);
        if (!config?.tools) return;
        const next = config.tools.map((t) => (t.name === toolName ? { ...t, inject } : t));
        this.update(serverId, { tools: next });
    },

    /** 从 storage 移除一个工具（用户主动删除；下次 mergeTools 拿到会重新出现）
     *  暮色 2026-08-23 v2.1：同时把 toolName 写进 deletedToolHistory（去重）
     *  后续 mergeTools 拿到同名 tool 时设 wasDeleted=true 给 UI 提示
     */
    removeTool(serverId: string, toolName: string): void {
        const config = this.get(serverId);
        if (!config?.tools) return;
        const next = config.tools.filter((t) => t.name !== toolName);
        const history = Array.from(new Set([...(config.deletedToolHistory ?? []), toolName]));
        this.update(serverId, { tools: next, deletedToolHistory: history });
    },

    /** 稳定键：避免不同 server 同名工具互相覆盖 */
    toolKey(serverId: string, toolName: string): string {
        return `${serverId}__${toolName}`;
    },
};
