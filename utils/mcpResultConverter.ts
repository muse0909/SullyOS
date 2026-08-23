// mcpResultConverter — MCP 工具结果转不同 LLM 协议（2026-08-23）
// 暮色 2026-08-23 22:11 规格：
//   - MCP 工具返回结果保留完整 content 数组、isError 和 structuredContent
//   - 传给不同模型协议时分别转换为 OpenAI tool result、Gemini functionResponse
//   - 不做 Claude（暮色确认协议已删）
//   - 写协议单测确认格式
//
// 协议格式参考：
//   OpenAI tool message:
//     { role: 'tool', tool_call_id: string, content: string }
//     content 必须是 string（OpenAI 协议要求），多 content block 拼接
//
//   Gemini functionResponse part:
//     { functionResponse: { name: string, response: { ... }, id?: string } }
//     response 是结构化对象（Gemini 喜欢 schema，不限制 string）

import { McpCallResult, McpContentBlock } from '../types';

// ==================== 共享：把 MCP content 数组转成可读文本 ====================

/**
 * 把 MCP content 数组序列化成单字符串（用于 OpenAI tool result.content）
 *   - text block → 直接 text
 *   - image/audio block → "[image: mimeType, N chars base64]" 标注（OpenAI content 必须是 string）
 *   - resource block → "[resource: {...}]" JSON 截断
 *   - 其他类型 → "[type: {...}]" 兜底
 *
 * 暮色 8-23 22:11 v3 规格："不要只拼接纯文本" → 标注形式 + 关键字段保留
 *   完整图片/音频 base64 不放 tool result（太大），由 resource 链接交给模型自行 fetch
 */
export const serializeMcpContent = (blocks: McpContentBlock[] | undefined | null): string => {
    if (!blocks?.length) return '';
    return blocks.map((b) => {
        if (b.type === 'text') return b.text || '';
        if (b.type === 'image') {
            return `[image: ${b.mimeType || 'unknown'}, ${(b.data?.length ?? 0)} chars base64]`;
        }
        if (b.type === 'audio') {
            return `[audio: ${b.mimeType || 'unknown'}, ${(b.data?.length ?? 0)} chars base64]`;
        }
        if (b.type === 'resource') {
            return `[resource: ${truncate(JSON.stringify(b.resource ?? b), 200)}]`;
        }
        return `[${b.type}: ${truncate(JSON.stringify(b), 200)}]`;
    }).filter(Boolean).join('\n');
};

const truncate = (s: string, n: number): string => s.length > n ? s.slice(0, n) + '…' : s;

// ==================== 共享：把 MCP content 数组转成 Gemini response value ====================

/**
 * Gemini 喜欢结构化，所以 multi-block 时返回 array of objects（不丢字段）
 * 单 text block → 直接 string（Gemini 文本最常见）
 */
export const mcpContentToGeminiValue = (blocks: McpContentBlock[] | undefined | null): any => {
    if (!blocks?.length) return null;
    if (blocks.length === 1) {
        const b = blocks[0];
        if (b.type === 'text') return b.text || '';
        if (b.type === 'image' || b.type === 'audio') {
            return { type: b.type, mimeType: b.mimeType, data: b.data };
        }
        // resource / 其他单 block：原样
        return b;
    }
    return blocks.map((b) => {
        if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
        if (b.type === 'image' || b.type === 'audio') {
            return { type: b.type, mimeType: b.mimeType, data: b.data };
        }
        return b;
    });
};

// ==================== OpenAI 协议 ====================

export interface OpenAIToolResultMessage {
    role: 'tool';
    tool_call_id: string;
    content: string;
}

/**
 * 把 McpCallResult 转成 OpenAI tool message
 * 三种语义区分：
 *   1. success: true + isError: false → content 序列化 text
 *   2. success: true + isError: true  → 标注 "[MCP 工具返回 isError=true] ..."
 *      （工具执行成功但业务失败，让 LLM 知道）
 *   3. success: false                → 标注 "[MCP 工具调用失败: ...]"
 *      （调用本身失败：超时 / 取消 / HTTP / 协议错误）
 */
export const mcpToOpenAIToolResult = (
    callResult: McpCallResult,
    toolCallId: string
): OpenAIToolResultMessage => {
    if (!callResult.success) {
        const e = callResult.error;
        return {
            role: 'tool',
            tool_call_id: toolCallId,
            content: `[MCP 工具调用失败: ${e.category} (${e.code})] ${e.message}`,
        };
    }
    const text = serializeMcpContent(callResult.content);
    if (callResult.isError) {
        return {
            role: 'tool',
            tool_call_id: toolCallId,
            content: `[MCP 工具返回 isError=true] ${text}`.trim(),
        };
    }
    return {
        role: 'tool',
        tool_call_id: toolCallId,
        content: text,
    };
};

// ==================== Gemini 协议 ====================

export interface GeminiFunctionResponsePart {
    functionResponse: {
        name: string;
        response: Record<string, any>;
        id?: string;
    };
}

/**
 * 把 McpCallResult 转成 Gemini functionResponse part
 * 与 OpenAI 不同：Gemini response 是结构化对象
 *   - success + isError=true  → { isError: true, content: ..., structuredContent: ... }
 *   - success + isError=false → { content: ..., structuredContent: ... }
 *   - success=false            → { error: true, category, code, message }
 */
export const mcpToGeminiFunctionResponse = (
    callResult: McpCallResult,
    name: string,
    callId?: string
): GeminiFunctionResponsePart => {
    let response: Record<string, any>;
    if (!callResult.success) {
        const e = callResult.error;
        response = {
            error: true,
            category: e.category,
            code: e.code,
            message: e.message,
        };
    } else if (callResult.isError) {
        response = {
            isError: true,
            content: mcpContentToGeminiValue(callResult.content),
        };
        if (callResult.structuredContent !== undefined) {
            response.structuredContent = callResult.structuredContent;
        }
    } else {
        response = {
            content: mcpContentToGeminiValue(callResult.content),
        };
        if (callResult.structuredContent !== undefined) {
            response.structuredContent = callResult.structuredContent;
        }
    }
    const fr: { name: string; response: Record<string, any>; id?: string } = { name, response };
    if (callId) fr.id = callId;
    return { functionResponse: fr };
};
