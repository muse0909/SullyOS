// mcpStorage — MCP 服务器配置的持久化封装（2026-08-23）
// 暮色 2026-08-23："配置持久化使用现有 DB / storage 封装，不要直接散落 localStorage"
// 选 localStorage 而非 IndexedDB：
//   - 配置项少（个位数 server × 小 JSON）
//   - 同步读写方便（首屏渲染时直接读）
//   - 跟 os_api_config / sully_proxy_worker_url_v1 同款风格
// 严禁在外部直接 localStorage.getItem(LS_KEY)，都走这里的封装（未来要换 IndexedDB 改一个文件就行）

import { McpServerConfig, McpAuthType, McpTransport, McpTool } from '../types';

const LS_KEY = 'os_mcp_servers_v1';

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

    /** 只更新测试结果（不重置其他字段） */
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
                tools: result.tools,
            });
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
};
