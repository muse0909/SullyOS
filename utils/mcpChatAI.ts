// mcpChatAI — MCP 工具调用多轮循环（2026-08-23）
// 暮色 2026-08-23 22:11 v3 规格（OpenAI 协议第一版）：
//   - tool_call.function.name 以 mcp__ 开头 → 走 MCP 路径
//   - parseMcpToolName 还原 serverId + toolName → 调 mcpClient.callMcpTool
//   - 多轮循环：tool result 回传后重新请求 LLM，直到不含 mcp__ tool_calls
//   - 单轮多 tool_call → Promise.allSettled 并行
//   - 单轮 maxToolCalls=5 + 全局 maxToolRounds=5
//   - 错误（success=false）作为 tool result 回传，不抛异常
//   - parseMcpToolName=null → "工具不存在或已被禁用" 错误回传
//   - 每次循环前重读 storage（用户可能改开关）
//   - Gemini / Claude 留后续 commit（本版只 OpenAI）

import { McpServerConfig, McpCallResult } from '../types';
import { mcpClient } from './mcpClient';
import { mcpToOpenAIToolResult } from './mcpResultConverter';
import { mcpStorage } from './mcpStorage';
import { parseMcpToolName } from './mcpToLlmTools';
import { safeFetchJson } from './safeApi';

export const MAX_MCP_TOOL_ROUNDS = 5;
export const MAX_MCP_TOOL_CALLS_PER_ROUND = 5;

export interface McpToolCallLoopOpts {
    initialData: any;
    baseMessages: any[];
    effectiveApi: any;
    baseUrl: string;
    headers: any;
    apiProtocol: string;
    addToast?: (msg: string, type?: 'info' | 'success' | 'error') => void;
    updateTokenUsage: (data: any, historyMsgCount: number, tag?: string) => void;
    historyMsgCount: number;
}

export interface McpToolCallLoopResult {
    data: any;
    rounds: number;
    /** 哪些 tool_call 实际跑了（含 failed），用于调试 / UI */
    executed: number;
}

/**
 * MCP 工具调用多轮循环
 *   入口：data 是 LLM 主调用的完整响应
 *   退出：data 里没有 mcp__ tool_calls（让外层继续处理 nonMcp tool_call）
 *   上限：5 轮（每轮最多 5 个并行）
 *   错误：callMcpTool 返回 success:false 时作为 tool result 回传，不抛异常
 *   解析：parseMcpToolName=null → "工具不存在或已被禁用" 错误回传
 *   校验：每次循环前重读 storage（用户可能改开关）
 */
export async function processMcpToolCalls(opts: McpToolCallLoopOpts): Promise<McpToolCallLoopResult> {
    let data = opts.initialData;
    let messages = [...opts.baseMessages];
    let rounds = 0;
    let executed = 0;

    for (let r = 0; r < MAX_MCP_TOOL_ROUNDS; r++) {
        const allCalls = getToolCalls(data);
        const mcpCalls = (allCalls || []).filter((tc: any) => (tc.function?.name || '').startsWith('mcp__'));
        if (mcpCalls.length === 0) break;

        // 单轮限制
        const limitedCalls = mcpCalls.slice(0, MAX_MCP_TOOL_CALLS_PER_ROUND);

        // 每次循环前重读 storage（用户可能改了 server/tool 开关）
        const allConfigs = mcpStorage.getAll();

        // UI 反馈：每个并行调用各显示一条
        if (opts.addToast) {
            for (const tc of limitedCalls) {
                const parsed = parseMcpToolName(tc.function?.name || '', allConfigs);
                const tool = parsed
                    ? allConfigs.find((c) => c.id === parsed.serverId)?.tools?.find((t) => t.name === parsed.toolName)
                    : null;
                const label = (tool?.description || tool?.name || tc.function?.name || 'MCP 工具').slice(0, 36);
                opts.addToast(`🔧 正在调用 ${label}...`, 'info');
            }
        }

        // 并行执行
        const promises = limitedCalls.map(async (tc: any) => {
            const toolCallId = tc.id;
            const fname = tc.function?.name || '';
            const parsed = parseMcpToolName(fname, allConfigs);
            if (!parsed) {
                const callResult: McpCallResult = {
                    success: false,
                    content: [],
                    error: { category: 'notFound', code: 'TOOL_NOT_FOUND', message: '该工具不存在或已被禁用' },
                };
                return { toolCallId, content: mcpToOpenAIToolResult(callResult, toolCallId).content };
            }
            const config = allConfigs.find((c) => c.id === parsed.serverId);
            if (!config || !config.enabled) {
                const callResult: McpCallResult = {
                    success: false,
                    content: [],
                    error: { category: 'notFound', code: 'SERVER_DISABLED', message: 'MCP 服务器不存在或已禁用' },
                };
                return { toolCallId, content: mcpToOpenAIToolResult(callResult, toolCallId).content };
            }
            const tool = config.tools?.find((t) => t.name === parsed.toolName);
            if (!tool || tool.enabled === false) {
                const callResult: McpCallResult = {
                    success: false,
                    content: [],
                    error: { category: 'notFound', code: 'TOOL_DISABLED', message: '该工具已被禁用' },
                };
                return { toolCallId, content: mcpToOpenAIToolResult(callResult, toolCallId).content };
            }
            // 解析 arguments
            let args: Record<string, any> = {};
            try {
                const raw = tc.function?.arguments || '{}';
                args = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
            } catch (e: any) {
                const callResult: McpCallResult = {
                    success: false,
                    content: [],
                    error: { category: 'protocol', code: 'INVALID_ARGS', message: `参数 JSON 解析失败: ${e?.message || e}` },
                };
                return { toolCallId, content: mcpToOpenAIToolResult(callResult, toolCallId).content };
            }
            // 实际调用（错误统一在 callMcpTool 内被收成 McpCallResult，不抛）
            const result = await mcpClient.callMcpTool(config, parsed.toolName, args, { timeoutMs: config.timeoutMs });
            return { toolCallId, content: mcpToOpenAIToolResult(result, toolCallId).content };
        });

        const settled = await Promise.allSettled(promises);
        executed += limitedCalls.length;

        // 追加 messages：assistant (with tool_calls) + 每个 tool 角色消息
        //   OpenAI 协议要求 tool_calls 必须在 assistant role 消息里 + tool 角色回传带 tool_call_id
        messages.push({
            role: 'assistant',
            content: data.choices?.[0]?.message?.content || '',
            tool_calls: limitedCalls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '{}' },
            })),
        });
        settled.forEach((r, i) => {
            const fallback = { toolCallId: limitedCalls[i]?.id || 'unknown', content: `[MCP 工具调用失败: ${(r as any).reason?.message || 'unknown'}]` };
            const res = r.status === 'fulfilled' ? r.value : fallback;
            messages.push({ role: 'tool', tool_call_id: res.toolCallId, content: res.content });
        });

        // 重新调 LLM（非流式 — 暮色规格：流式模式也不在 MCP 循环里走流，避免边流边调）
        const followBody: any = {
            model: opts.effectiveApi.model,
            messages,
            temperature: opts.effectiveApi.temperature ?? 0.85,
            max_tokens: 8000,
            stream: false,
        };
        try {
            data = await safeFetchJson(`${opts.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: opts.headers,
                body: JSON.stringify(followBody),
            }, 2, 0, opts.apiProtocol);
            opts.updateTokenUsage(data, opts.historyMsgCount, `mcp-r${r + 1}`);
            rounds++;
        } catch (e: any) {
            // 重发失败：保留最后一次响应（MCP 循环不应该崩聊天主流程）
            console.error('[MCP Loop] 重发 LLM 失败:', e);
            if (opts.addToast) {
                opts.addToast(`MCP 工具调用后续请求失败：${e?.message || e}`, 'error');
            }
            break;
        }
    }

    if (rounds >= MAX_MCP_TOOL_ROUNDS) {
        // 暮色规格：超过 5 轮截断，把已有内容直接输出给用户
        if (opts.addToast) {
            opts.addToast(`MCP 工具调用达到最大 ${MAX_MCP_TOOL_ROUNDS} 轮，已自动截断`, 'info');
        }
    }

    return { data, rounds, executed };
}

/** 兼容旧 import 路径（useChatAI 内嵌实现已删，改为从这里 import） */
export { processMcpToolCalls as processMcpToolCallsDefault };

/** 复制自 useChatAI 的 getToolCalls（避免反向依赖大 hook 文件） */
function getToolCalls(data: any): any[] {
    if (!data) return [];
    const msg = data?.choices?.[0]?.message;
    if (!msg) return [];
    return msg.tool_calls || data?.choices?.[0]?.tool_calls || [];
}
