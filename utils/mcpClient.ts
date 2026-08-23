// mcpClient — 通用 MCP (Model Context Protocol) 客户端（2026-08-23）
// 暮色 2026-08-23：cjjc 截图带来"自己添加 MCP"需求
//
// 第一版范围（按暮色规格）：
//   - JSON-RPC 2.0 over HTTP（Streamable HTTP 协议结构，第一版不实现 SSE 长连接）
//   - 多 server session 管理（Map<serverId, McpSession>）
//   - Bearer Token / Custom Headers 鉴权（OAuth 留接口不实现）
//   - 可选本地代理 URL（默认走 getProxyWorkerUrl()，可被 config.proxyUrl 覆盖）
//   - 错误分类：cors / network / auth / protocol / toolsList
//   - 鉴权头 + token 严禁出现在 console.log
//
// 不实现（第二版再做）：
//   - tools/call 实际调用（接口 listMcpTools / callMcpTool 占位）
//   - SSE 长连接
//   - OAuth
//   - 注入 system prompt / 解析 tool_call
//
// 参考：utils/xhsMcpClient.ts（小红书单一 server 的实现），下面是多 server + 鉴权 + 错误分类的版本

import { McpServerConfig, McpTool, McpErrorType } from '../types';
import { getProxyWorkerUrl } from './proxyWorker';

// ==================== 内部类型 ====================

interface McpJsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: any;
    id?: number;
}

interface McpJsonRpcResponse {
    jsonrpc: '2.0';
    id?: number;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

interface McpSession {
    serverId: string;
    sessionId: string | null;
    initialized: boolean;
    requestIdCounter: number;
    discoveredTools: McpTool[];
}

// ==================== Session 管理 ====================

const sessions = new Map<string, McpSession>();

const getOrCreateSession = (serverId: string): McpSession => {
    let s = sessions.get(serverId);
    if (!s) {
        s = {
            serverId,
            sessionId: null,
            initialized: false,
            requestIdCounter: 0,
            discoveredTools: [],
        };
        sessions.set(serverId, s);
    }
    return s;
};

const resetSession = (serverId: string): void => {
    sessions.delete(serverId);
};

// ==================== URL 构造 ====================

/**
 * 拼出最终请求 URL
 * - config.proxyUrl 非空 → 拼前缀（用户明确指定的代理）
 * - 否则看 getProxyWorkerUrl()，如果主代理有 /mcp/ 路由支持则走默认
 * - 不强制走代理：默认情况下直连，浏览器 CORS 受限时由用户主动配
 */
const buildUrl = (config: McpServerConfig): string => {
    const base = config.url.replace(/\/+$/, '');
    if (config.proxyUrl && /^https?:\/\//i.test(config.proxyUrl)) {
        const proxy = config.proxyUrl.replace(/\/+$/, '');
        // 代理 URL 模式：{proxy}/{原 url} 或直接 proxy
        return `${proxy}${base.startsWith('/') ? '' : '/'}${base}`;
    }
    return base;
};

// ==================== 鉴权头构造（敏感，不进日志） ====================

const buildAuthHeaders = (config: McpServerConfig): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (config.authType === 'bearer' && config.bearerToken) {
        headers['Authorization'] = `Bearer ${config.bearerToken}`;
    } else if (config.authType === 'headers' && config.customHeaders) {
        for (const [k, v] of Object.entries(config.customHeaders)) {
            if (k && v) headers[k] = v;
        }
    }
    return headers;
};

// ==================== JSON-RPC 工具 ====================

const buildRequest = (method: string, params?: any, isNotification = false, session: McpSession): McpJsonRpcRequest => {
    const req: McpJsonRpcRequest = { jsonrpc: '2.0', method, params };
    if (!isNotification) req.id = ++session.requestIdCounter;
    return req;
};

const parseSseResponse = (text: string): McpJsonRpcResponse | null => {
    const lines = text.split('\n');
    const dataLines: string[] = [];
    for (const line of lines) {
        if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        else if (line.startsWith('data:')) dataLines.push(line.slice(5));
    }
    if (dataLines.length === 0) return null;
    for (let i = dataLines.length - 1; i >= 0; i--) {
        try { return JSON.parse(dataLines[i]); } catch { continue; }
    }
    return null;
};

const parseResponse = (text: string, contentType: string): McpJsonRpcResponse => {
    if (contentType.includes('text/event-stream') || text.trimStart().startsWith('event:') || text.trimStart().startsWith('data:')) {
        const parsed = parseSseResponse(text);
        if (parsed) return parsed;
    }
    try { return JSON.parse(text); } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) { try { return JSON.parse(match[0]); } catch { /* fall through */ } }
        throw new Error(`无法解析 MCP 响应: ${text.slice(0, 300)}`);
    }
};

// ==================== 错误分类 ====================

interface McpError extends Error {
    mcpErrorType: McpErrorType;
}

const classifyError = (e: any, stage: 'http' | 'protocol' | 'toolsList'): McpError => {
    const msg: string = (e?.message || String(e)).toString();

    // 网络层
    if (/Failed to fetch|NetworkError|net::ERR/i.test(msg) || e?.name === 'TypeError') {
        const cors = /CORS|cors/i.test(msg) || /opaque/i.test(msg) ||
            (stage === 'http' && /Failed to fetch/i.test(msg));
        return makeError(
            cors
                ? '浏览器 CORS 限制：MCP 服务器未返回 Access-Control-Allow-Origin。请配置代理或让服务器允许跨域。'
                : `网络错误：${msg}`,
            cors ? 'cors' : 'network'
        );
    }
    // HTTP 状态码分类
    const httpMatch = msg.match(/MCP HTTP (\d+)/);
    if (httpMatch) {
        const status = parseInt(httpMatch[1], 10);
        if (status === 401 || status === 403) {
            return makeError(`鉴权失败 (HTTP ${status})：请检查 Bearer Token / 自定义 Header`, 'auth');
        }
        if (status === 404) {
            return makeError(`未找到 MCP endpoint (HTTP 404)：请检查 URL`, 'protocol');
        }
        if (status >= 500) {
            return makeError(`MCP 服务器错误 (HTTP ${status})：请稍后重试`, 'network');
        }
        return makeError(`MCP HTTP ${status}：${msg}`, 'protocol');
    }
    if (stage === 'toolsList') {
        return makeError(`tools/list 失败：${msg}`, 'toolsList');
    }
    return makeError(msg, 'unknown');
};

const makeError = (message: string, type: McpErrorType): McpError => {
    const err = new Error(message) as McpError;
    err.mcpErrorType = type;
    return err;
};

// ==================== HTTP POST ====================

const post = async (
    config: McpServerConfig,
    body: McpJsonRpcRequest,
    expectResponse: boolean,
    session: McpSession
): Promise<{ response: McpJsonRpcResponse | null; sessionId: string | null }> => {
    const url = buildUrl(config);
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    };
    // 鉴权（不写日志）
    Object.assign(headers, buildAuthHeaders(config));
    // session id
    if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;

    let resp: Response;
    try {
        resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e: any) {
        throw classifyError(e, 'http');
    }

    // 从响应头读 session id（如果服务器给了）
    const sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');

    if (resp.status === 202) return { response: null, sessionId };
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw classifyError(new Error(`MCP HTTP ${resp.status}: ${errText.slice(0, 200)}`), 'http');
    }
    if (!expectResponse) return { response: null, sessionId };

    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    try {
        return { response: parseResponse(text, contentType), sessionId };
    } catch (e: any) {
        throw classifyError(e, 'protocol');
    }
};

// ==================== 公开 API ====================

export const mcpClient = {

    /** 重置某个 server 的 session */
    resetSession(serverId: string): void {
        resetSession(serverId);
    },

    /** 重置所有 server 的 session */
    resetAll(): void {
        sessions.clear();
    },

    /**
     * 完整流程：initialize → initialized → tools/list
     * 成功后 session 标记为已初始化，discoveredTools 写入
     * 失败抛 McpError（含 mcpErrorType）
     */
    async initialize(config: McpServerConfig): Promise<McpTool[]> {
        const session = getOrCreateSession(config.id);
        // 重置：避免上次失败状态污染
        session.sessionId = null;
        session.initialized = false;
        session.requestIdCounter = 0;
        session.discoveredTools = [];

        // 1. initialize
        const initReq = buildRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'SullyOS', version: '1.0.0' },
        }, false, session);
        const { response: initResp, sessionId: initSessionId } = await post(config, initReq, true, session);
        if (initSessionId) session.sessionId = initSessionId;
        if (initResp?.error) {
            throw makeError(`initialize 失败: ${initResp.error.message}`, 'protocol');
        }

        // 浏览器读不到 Mcp-Session-Id 头（被 CORS 限制）时
        if (!session.sessionId) {
            console.warn(
                '[MCP] ⚠️ 浏览器无法读取 Mcp-Session-Id 响应头（CORS 限制）。\n' +
                '请使用代理: settings → 网络代理 (Worker) 配一个支持 /mcp 路由的地址。'
            );
            // 仍然继续，可能服务器不要求 session
        }

        // 2. notifications/initialized (无响应)
        const notifReq = buildRequest('notifications/initialized', {}, true, session);
        try {
            await post(config, notifReq, false, session);
        } catch {
            // notification 失败不致命
        }

        // 3. tools/list
        try {
            const toolsReq = buildRequest('tools/list', undefined, false, session);
            const { response: toolsResp } = await post(config, toolsReq, true, session);
            if (toolsResp?.error) {
                throw makeError(`tools/list 错误: ${toolsResp.error.message}`, 'toolsList');
            }
            const tools = toolsResp?.result?.tools;
            if (Array.isArray(tools)) {
                session.discoveredTools = tools.map((t: any) => ({
                    name: String(t?.name ?? ''),
                    description: t?.description,
                    inputSchema: t?.inputSchema ?? {},
                })).filter((t: McpTool) => t.name);
                console.log(`[MCP] ${config.name}: 发现 ${session.discoveredTools.length} 个工具: ${session.discoveredTools.map(t => t.name).join(', ')}`);
            }
        } catch (e: any) {
            // tools/list 失败分类
            if (e?.mcpErrorType) throw e;
            throw classifyError(e, 'toolsList');
        }

        session.initialized = true;
        return session.discoveredTools;
    },

    /**
     * 测试连接：完整跑 initialize + tools/list，返回结构化结果
     * UI 调用：result.ok = true/false，false 时 result.error 是给用户看的友好提示
     */
    async testConnection(config: McpServerConfig): Promise<
        { ok: true; tools: McpTool[]; sessionId: string | null } |
        { ok: false; error: string; errorType: McpErrorType }
    > {
        try {
            const tools = await this.initialize(config);
            const session = sessions.get(config.id);
            return { ok: true, tools, sessionId: session?.sessionId ?? null };
        } catch (e: any) {
            const type: McpErrorType = e?.mcpErrorType || 'unknown';
            const message: string = e?.message || String(e);
            // 脱敏：去掉任何疑似 token 残留
            const safe = message.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ***');
            return { ok: false, error: safe, errorType: type };
        }
    },

    // ==================== 第二版占位接口（暂不实现） ====================

    /** 第二版：列出指定 server 的工具（第一版请用 testConnection 返回的 tools） */
    async listMcpTools(_serverId: string): Promise<McpTool[]> {
        // 第一版不实现
        return [];
    },

    /** 第二版：调用工具（第一版抛错） */
    async callMcpTool(_serverId: string, _toolName: string, _arguments_: Record<string, any> = {}): Promise<any> {
        throw makeError('callMcpTool 暂未实现（第二版）', 'unknown');
    },
};

// 默认代理（仅供 UI 显示"是否走代理"用）
export const getMcpDefaultProxyHint = (): string => {
    return getProxyWorkerUrl();
};
