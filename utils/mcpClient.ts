// mcpClient — 通用 MCP (Model Context Protocol) 客户端（2026-08-23）
// 暮色 2026-08-23：cjjc 截图带来"自己添加 MCP"需求
//
// v1：JSON-RPC 2.0 over HTTP（Streamable HTTP 协议结构）+ 多 server session +
//     鉴权 + 错误分类 + UI 管理接口
// v2：工具级开关/删除/风险标记
// v2.1：删过标记 + 敏感工具改硬编码
// v3（暮色 8-23 22:11 规格）：
//   - callMcpTool 实际实现：AbortController + 默认 30s 超时 + per-server timeoutMs +
//     外部 AbortSignal + 统一 McpCallResult 错误结构
//   - 错误消息脱敏：不出现 Authorization / Bearer Token / 自定义 Header / 完整请求配置
//   - 保留完整 MCP content[] + isError + structuredContent（不只拼接纯文本）
//   - listMcpTools(serverId)：返回该 server 的 enabled 工具列表（兼容缺字段视为 true）
//
// 不实现：
//   - SSE 长连接
//   - OAuth
//   - 注入 system prompt / 解析 LLM tool_call（useChatAI 那一步）
//
// 参考：utils/xhsMcpClient.ts（小红书单一 server 的实现），下面是多 server + 鉴权 + 错误分类的版本

import { McpServerConfig, McpTool, McpErrorType, McpCallResult, McpContentBlock, McpCallError } from '../types';
import { getProxyWorkerUrl } from './proxyWorker';

// ==================== 常量 ====================

const DEFAULT_TIMEOUT_MS = 30_000;     // 暮色 8-23 22:11 规格：默认 30s 超时

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
        throw makeError(`无法解析 MCP 响应: ${text.slice(0, 300)}`, 'protocol');
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

// ==================== 错误消息脱敏（v3 暮色 8-23 22:11）====================
//  暮色规格：错误消息不得包含 Authorization、Bearer Token、自定义 Header 或完整请求配置
//  策略：通用敏感 pattern 正则 + buildAuthHeaders 实际产出的 header 名 全部 *** 化
const SENSITIVE_HEADER_NAMES = [
    'Authorization', 'X-Api-Key', 'X-Auth-Token', 'X-API-TOKEN',
    'Api-Key', 'Token', 'Cookie', 'Set-Cookie', 'Proxy-Authorization',
];

const sanitizeErrorMessage = (msg: string): string => {
    if (!msg) return msg;
    let s = msg;
    // Bearer token
    s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer ***');
    // Authorization: <value>
    s = s.replace(/Authorization\s*[:=]\s*[^\s,;"']+/gi, 'Authorization: ***');
    // 自定义 header 名字（大小写不敏感）
    for (const name of SENSITIVE_HEADER_NAMES) {
        if (name === 'Authorization') continue;  // 上面已处理
        const re = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:=]\\s*[^\\s,;"']+`, 'gi');
        s = s.replace(re, `${name}: ***`);
    }
    // jina_xxx / sk-xxx / ghp_xxx / xoxb-xxx 等常见 token 模式
    s = s.replace(/\b(jina_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{20,})\b/g, '***TOKEN***');
    return s;
};

/** 把抛出的 McpError / 普通 Error 包成统一的 McpCallResult 失败结构
 *  关键：如果 e 已经是带 mcpErrorType 的 McpError（post() / classifyError 抛的），
 *       直接读 mcpErrorType，不要再调 classifyError（避免二次分类丢失信息）
 *  HTTP 错误：读 e.httpStatus 做 code（如 HTTP_401）
 */
const classifyAndWrap = (e: any, defaultCode: string = 'CLASSIFIED'): { success: false; content: []; error: McpCallError } => {
    if (e && typeof e === 'object' && e.success === false && e.error) {
        return e;  // 已经是 McpCallResult 失败结构
    }
    if (e && typeof e === 'object' && e.mcpErrorType) {
        const code = typeof e.httpStatus === 'number' ? `HTTP_${e.httpStatus}` : defaultCode;
        return {
            success: false,
            content: [],
            error: {
                category: e.mcpErrorType,
                code,
                message: sanitizeErrorMessage(e.message || String(e)),
            },
        };
    }
    // 兜底：未分类错误
    const classified = classifyError(e, 'protocol');
    return {
        success: false,
        content: [],
        error: {
            category: classified.mcpErrorType,
            code: defaultCode,
            message: sanitizeErrorMessage(classified.message),
        },
    };
};

// ==================== HTTP POST ====================

const post = async (
    config: McpServerConfig,
    body: McpJsonRpcRequest,
    expectResponse: boolean,
    session: McpSession,
    signal?: AbortSignal
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
        resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e: any) {
        // AbortController 取消的 fetch 抛 AbortError（部分浏览器）或 TypeError
        if (e?.name === 'AbortError' || signal?.aborted) {
            throw makeError('请求被取消', 'cancelled');
        }
        throw classifyError(e, 'http');
    }

    // 从响应头读 session id（如果服务器给了）
    const sessionId = resp.headers.get('Mcp-Session-Id') || resp.headers.get('mcp-session-id');

    if (resp.status === 202) return { response: null, sessionId };
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const err = classifyError(new Error(`MCP HTTP ${resp.status}: ${errText.slice(0, 200)}`), 'http');
        // 给 HTTP 错误附 status 字段，callMcpTool 用作 code（如 HTTP_401）
        (err as any).httpStatus = resp.status;
        throw err;
    }
    if (!expectResponse) return { response: null, sessionId };

    const contentType = resp.headers.get('content-type') || '';
    const text = await resp.text();
    try {
        return { response: parseResponse(text, contentType), sessionId };
    } catch (e: any) {
        // parseResponse 抛的已经带 mcpErrorType='protocol'，rethrow 避免二次分类
        if (e?.mcpErrorType) throw e;
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

    // ==================== v3：callMcpTool / listMcpTools（暮色 8-23 22:11）====================

    /**
     * 列出指定 server 的"已启用"工具列表（按 serverId 查 storage；mcpToLlmTools 不在这里做）
     * 兼容旧数据：tool.enabled 缺字段视为 true
     * 不在这里做敏感工具过滤（由 mcpToLlmTools 决定）
     */
    listMcpTools(serverId: string, allConfigs: McpServerConfig[]): McpTool[] {
        const config = allConfigs.find((c) => c.id === serverId);
        if (!config?.tools) return [];
        return config.tools.filter((t) => t.enabled !== false);
    },

    /**
     * 实际调用工具（v3 实现，暮色 8-23 22:11 规格）：
     *   - AbortController 默认 30s 超时
     *   - 支持 per-server timeoutMs 覆盖
     *   - 支持外部 AbortSignal
     *   - 统一 McpCallResult 返回结构
     *   - 错误消息脱敏
     *   - 保留完整 MCP content[] + isError + structuredContent
     *
     * 输入 config 必须包含 url / authType / 鉴权字段 / timeoutMs
     * options.timeoutMs 覆盖 config.timeoutMs
     * options.signal 外部取消（合并到内部 AbortController）
     *
     * 注意：本调用**不**校验 server.enabled / tool.enabled — 这是上层（mcpToLlmTools / 运行时校验）的责任
     *   避免重复校验逻辑，统一在调用方决定
     */
    async callMcpTool(
        config: McpServerConfig,
        toolName: string,
        args: Record<string, any> = {},
        options: { timeoutMs?: number; signal?: AbortSignal } = {}
    ): Promise<McpCallResult> {
        // 1. 合并超时：options > config > default
        const effectiveTimeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('timeout')), effectiveTimeoutMs);

        // 2. 合并外部 signal
        const externalSignal = options.signal;
        const onExternalAbort = () => controller.abort(externalSignal?.reason);
        if (externalSignal) {
            if (externalSignal.aborted) {
                clearTimeout(timer);
                return {
                    success: false,
                    content: [],
                    error: { category: 'cancelled', code: 'CANCELLED_BEFORE_START', message: '调用在开始前已被取消' },
                };
            }
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        try {
            // 3. ensure session（没有就 initialize）
            const session = getOrCreateSession(config.id);
            if (!session.initialized) {
                try {
                    await this.initialize(config);
                } catch (e: any) {
                    return classifyAndWrap(e, 'INIT_FAILED');
                }
            }

            // 4. tools/call 请求
            const req = buildRequest('tools/call', { name: toolName, arguments: args }, false, session);
            let postResult;
            try {
                postResult = await post(config, req, true, session, controller.signal);
            } catch (e: any) {
                // 区分 timeout / cancelled / 其他
                if (e?.mcpErrorType === 'cancelled' || (controller.signal.aborted && !externalSignal?.aborted)) {
                    return {
                        success: false,
                        content: [],
                        error: {
                            category: 'timeout',
                            code: `TIMEOUT_${effectiveTimeoutMs}MS`,
                            message: `工具调用超时（${effectiveTimeoutMs}ms）`,
                        },
                    };
                }
                if (controller.signal.aborted && externalSignal?.aborted) {
                    return {
                        success: false,
                        content: [],
                        error: { category: 'cancelled', code: 'CANCELLED', message: '调用被外部取消' },
                    };
                }
                return classifyAndWrap(e, 'POST_FAILED');
            }

            const { response } = postResult;
            if (response?.error) {
                // JSON-RPC 错误（如 -32601 Method not found / -32602 Invalid params）
                const code = response.error.code;
                let category: McpCallError['category'] = 'protocol';
                let errorCode = `JSONRPC_${code}`;
                if (code === -32601) {
                    category = 'notFound';
                    errorCode = 'TOOL_NOT_FOUND';
                } else if (code === -32602) {
                    category = 'protocol';
                    errorCode = 'INVALID_PARAMS';
                }
                return {
                    success: false,
                    content: [],
                    error: {
                        category,
                        code: errorCode,
                        message: sanitizeErrorMessage(`工具 ${toolName} 错误: ${response.error.message || '未知错误'}`),
                    },
                };
            }

            const result = response?.result;
            if (!result) {
                return {
                    success: false,
                    content: [],
                    error: { category: 'protocol', code: 'NO_RESULT', message: 'tools/call 无 result 字段' },
                };
            }

            // 5. 正常返回 — 保留完整 content + isError + structuredContent
            return {
                success: true,
                content: Array.isArray(result.content) ? result.content as McpContentBlock[] : [],
                isError: !!result.isError,
                structuredContent: result.structuredContent,
            };
        } finally {
            clearTimeout(timer);
            if (externalSignal) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        }
    },
};

// 默认代理（仅供 UI 显示"是否走代理"用）
export const getMcpDefaultProxyHint = (): string => {
    return getProxyWorkerUrl();
};
