// mcpToLlmTools — 把 MCP 服务器配置转成 LLM 工具列表（2026-08-23）
// 暮色 2026-08-23 22:11 规格：
//   - 只注入 server.enabled && tool.enabled !== false && 通过敏感工具授权的工具
//   - show_api_key 等 isSensitive 工具默认不注入，用户在 UI 二次确认 + server.allowSensitive 后才注入
//   - 工具内部名称稳定且可还原：mcp__{sid8}__{tName}（serverId 截前 8 + toolName 完整/截断+hash）
//   - 必须保证不同 (serverId, toolName) 映射后绝不冲突
//   - maxTools 上限默认 10（22 个 jina 工具不可能都注入）
//   - 截断顺序：按用户启用顺序 / 最近使用频率 / A-Z
//   - 不做 Claude（暮色已删）
//
// 两套输出：
//   - mcpToOpenAITools(configs) → { type: 'function', function: { name, description, parameters } }[]
//   - mcpToGeminiTools(configs)  → { functionDeclarations: [{ name, description, parameters }] }
//
// 反向：
//   - parseMcpToolName(modelName, allConfigs) → { serverId, toolName } | null

import { McpServerConfig, McpTool } from '../types';

// ==================== 常量 ====================

const PREFIX = 'mcp__';
const SEP = '__';
const DEFAULT_SID_LEN = 8;          // serverId 截前 8 字符
const EXPANDED_SID_LEN = 16;        // 冲突时扩到 16
const TNAME_MAX_LEN = 39;           // toolName 最大 39（mcp__{8}__{39} = 51 字符）
const HASH_LEN = 8;                 // 截断后 hash 后缀 8 位
const MAX_NAME_LEN = 64;            // OpenAI function name 限制
export const DEFAULT_MAX_TOOLS = 10;

// ==================== 工具名映射 ====================

/** 简单 djb2 hash → 8 位 hex */
const hashStr = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(HASH_LEN, '0').slice(0, HASH_LEN);
};

/**
 * 检测 serverId 前缀冲突，返回安全的截断长度
 *   - 默认 8
 *   - 有其他 server 同样前 8 字符 → 扩到 16
 *   - 16 仍冲突 → 继续扩（按 8 递增），理论上 32 字符必不冲突
 */
const pickSafeSidLen = (serverId: string, allServerIds: string[]): number => {
    for (const len of [DEFAULT_SID_LEN, EXPANDED_SID_LEN, 24, 32, EXPANDED_SID_LEN + 32]) {
        const prefix = serverId.slice(0, len);
        const conflict = allServerIds.some((s) => s !== serverId && s.startsWith(prefix));
        if (!conflict) return len;
    }
    return serverId.length;  // 兜底：用完整
};

/**
 * 把 (serverId, toolName) 映射成 LLM 工具名
 *   - serverId 截前 safeLen（默认 8，冲突时扩）
 *   - toolName 短于 TNAME_MAX_LEN（39）→ 直接用
 *   - toolName 长 → 截前 39 + `_` + 8 位 hash
 * 暮色规格："必须保证不同 serverId + toolName 映射后绝不冲突" — 截断+hash 已保证
 */
export const buildMcpToolName = (serverId: string, toolName: string, allServerIds: string[]): string => {
    const sidLen = pickSafeSidLen(serverId, allServerIds);
    const sid = serverId.slice(0, sidLen);
    if (toolName.length <= TNAME_MAX_LEN) {
        return `${PREFIX}${sid}${SEP}${toolName}`;
    }
    const hash = hashStr(toolName);
    return `${PREFIX}${sid}${SEP}${toolName.slice(0, TNAME_MAX_LEN)}_${hash}`;
};

/**
 * 反向：从模型工具名还原 (serverId, toolName)
 *   - 找 server：按 sid 段（前缀匹配）
 *   - 找 tool：先尝试完整匹配；不匹配再尝试截断+hash 匹配
 * 暮色规格："必须能从模型工具名稳定还原 serverId 和原始 toolName"
 */
export const parseMcpToolName = (
    modelName: string,
    allConfigs: McpServerConfig[]
): { serverId: string; toolName: string } | null => {
    if (!modelName.startsWith(PREFIX)) return null;
    const rest = modelName.slice(PREFIX.length);
    const sepIdx = rest.indexOf(SEP);
    if (sepIdx < 0) return null;
    const sid = rest.slice(0, sepIdx);
    const tnamePart = rest.slice(sepIdx + SEP.length);

    // 找 server：按 sid 前缀匹配所有 enabled 服务器
    const candidates = allConfigs.filter((c) => c.id.startsWith(sid));
    if (candidates.length !== 1) return null;
    const server = candidates[0];

    // 找 tool：先尝试完整匹配
    const exact = server.tools?.find((t) => t.name === tnamePart);
    if (exact) return { serverId: server.id, toolName: exact.name };

    // 不匹配：可能是 截断+hash 形式（tName39 + _ + hash8）
    if (tnamePart.length > TNAME_MAX_LEN + 1 + HASH_LEN) return null;
    const lastUnderscore = tnamePart.lastIndexOf('_');
    if (lastUnderscore < 0) return null;
    const possibleShort = tnamePart.slice(0, lastUnderscore);
    const possibleHash = tnamePart.slice(lastUnderscore + 1);
    if (!/^[0-9a-f]{8}$/.test(possibleHash)) return null;
    // 完整 toolName 长度 = possibleShort.length + (原 toolName.length - TNAME_MAX_LEN) < maybe
    // hash 用完整 toolName 算的，所以扫 server.tools 看哪个 hash 匹配 + 以 possibleShort 开头
    const match = server.tools?.find(
        (t) => t.name.length > TNAME_MAX_LEN &&
            t.name.startsWith(possibleShort) &&
            hashStr(t.name) === possibleHash
    );
    if (match) return { serverId: server.id, toolName: match.name };

    return null;
};

// ==================== 过滤 ====================

export interface McpToLlmOptions {
    maxTools?: number;     // 默认 10
    /** 排序：默认按 server.id 升序 + tool.name 升序（稳定） */
    sortBy?: 'name' | 'server';
}

/**
 * 过滤出应注入 LLM 的工具列表（不含映射，只是过滤后的 McpTool 列表）
 * 暮色规格过滤（全部 AND）：
 *   - server.enabled === true
 *   - tool.enabled !== false（兼容旧数据：缺字段视为 true）
 *   - !tool.isSensitive || server.allowSensitive === true
 */
export const filterInjectableTools = (configs: McpServerConfig[]): Array<{ server: McpServerConfig; tool: McpTool }> => {
    const out: Array<{ server: McpServerConfig; tool: McpTool }> = [];
    for (const server of configs) {
        if (!server.enabled) continue;
        if (!server.tools) continue;
        for (const tool of server.tools) {
            if (tool.enabled === false) continue;  // 显式禁用
            if (tool.isSensitive && !server.allowSensitive) continue;  // 敏感工具未授权
            out.push({ server, tool });
        }
    }
    return out;
};

/**
 * 把过滤后的工具按 maxTools 截断（暮色规格：默认 10，超出按启用顺序）
 * 简单策略：按 server.id 升序 + tool.name 升序（稳定）+ 截前 maxTools
 * 后续可加"最近使用频率"（需要引入 usage stats 字段）
 */
const limitTools = <T>(arr: T[], maxTools: number): T[] => {
    if (arr.length <= maxTools) return arr;
    return arr.slice(0, maxTools);
};

// ==================== OpenAI 协议 ====================

export interface OpenAIToolDef {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;   // JSON Schema
    };
}

/**
 * 把 configs 转成 OpenAI tools 数组
 * 暮色规格：22 个 jina 工具不全注入，按 maxTools 截断
 */
export const mcpToOpenAITools = (configs: McpServerConfig[], options: McpToLlmOptions = {}): OpenAIToolDef[] => {
    const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
    const allServerIds = configs.map((c) => c.id);
    const filtered = filterInjectableTools(configs);
    // 稳定排序：server.id → tool.name
    filtered.sort((a, b) => {
        const s = a.server.id.localeCompare(b.server.id);
        return s !== 0 ? s : a.tool.name.localeCompare(b.tool.name);
    });
    const limited = limitTools(filtered, maxTools);
    return limited.map(({ server, tool }) => ({
        type: 'function',
        function: {
            name: buildMcpToolName(server.id, tool.name, allServerIds),
            // 暮色 2026-08-23 23:32：截断 description 到 80 字符
            //   原因：完整 description 注入 LLM 后，LLM 第二次响应会"复读" description
            //   截图显示的"readable markdown format. Perfect for reading articles..."
            //   100+ 字符的 jina 官方 description 被 LLM 复读到 chat 消息里
            //   80 字符足够 LLM 理解工具用途，但不会被复读
            description: truncateDescription(tool.description ?? `MCP tool: ${tool.name}`, 80),
            parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        },
    }));
};

// ==================== Gemini 协议 ====================

export interface GeminiToolDef {
    functionDeclarations: Array<{
        name: string;
        description: string;
        parameters: any;
    }>;
}

export const mcpToGeminiTools = (configs: McpServerConfig[], options: McpToLlmOptions = {}): GeminiToolDef => {
    const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
    const allServerIds = configs.map((c) => c.id);
    const filtered = filterInjectableTools(configs);
    filtered.sort((a, b) => {
        const s = a.server.id.localeCompare(b.server.id);
        return s !== 0 ? s : a.tool.name.localeCompare(b.tool.name);
    });
    const limited = limitTools(filtered, maxTools);
    return {
        functionDeclarations: limited.map(({ server, tool }) => ({
            name: buildMcpToolName(server.id, tool.name, allServerIds),
            description: truncateDescription(tool.description ?? `MCP tool: ${tool.name}`, 80),
            parameters: tool.inputSchema ?? { type: 'object', properties: {} },
        })),
    };
};

/** 截断工具 description 到 max 字符（带省略号） */
const truncateDescription = (desc: string, max: number): string => {
    if (desc.length <= max) return desc;
    return desc.slice(0, max - 1) + '…';
};

// ==================== 工具：检查工具是否被允许注入 ====================

/** 单个工具在当前状态下是否能注入 LLM（不实际生成定义） */
export const isToolInjectable = (config: McpServerConfig, tool: McpTool): boolean => {
    if (!config.enabled) return false;
    if (tool.enabled === false) return false;
    if (tool.isSensitive && !config.allowSensitive) return false;
    return true;
};
