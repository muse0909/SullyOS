/**
 * Safe API response parsing utilities.
 *
 * Prevents "Unexpected token <" crashes that happen when API proxies
 * return HTML error pages (CloudFlare, nginx 502/503, rate limits)
 * instead of JSON responses.
 */

/** Parse a fetch Response as JSON safely (text-first, then JSON.parse) */
export async function safeResponseJson(response: Response): Promise<any> {
    const text = await response.text();

    // Detect HTML / XML responses
    const trimmed = text.trimStart();
    if (trimmed.startsWith('<')) {
        // Extract useful info from HTML error pages
        const titleMatch = trimmed.match(/<title>(.*?)<\/title>/i);
        const hint = titleMatch ? titleMatch[1] : trimmed.slice(0, 120);
        throw new Error(
            `API返回了HTML而非JSON (HTTP ${response.status}): ${hint}`
        );
    }

    // Empty body
    if (!trimmed) {
        throw new Error(`API返回了空响应 (HTTP ${response.status})`);
    }

    // SSE / 流式响应（有些 OpenAI 兼容代理无视 stream:false 强行流式返回）：
    // 形如 "data: {...}\ndata: {...}\ndata: [DONE]\n"，把 deltas 拼成完整 content
    if (trimmed.startsWith('data:')) {
        const assembled = parseSseToCompletion(text);
        if (assembled) return assembled;
        // 解析不出来 → 继续往下尝试当普通 JSON 抛错，保留原 preview
    }

    try {
        return JSON.parse(text);
    } catch (e) {
        // Show a snippet of what we got for debugging
        const preview = text.slice(0, 200);
        throw new Error(
            `API返回了无效JSON (HTTP ${response.status}): ${preview}`
        );
    }
}

/**
 * 把 OpenAI 兼容的 SSE 流响应合成一个普通 chat/completion 响应对象。
 *
 * 支持两种形态：
 *  1. delta 流：每个 chunk 的 choices[0].delta.content 是增量片段，拼接起来
 *  2. 一次性 SSE：choices[0].message.content 直接就是全部内容（少见）
 *
 * 返回 { choices: [{ message: { content, role }, finish_reason }], ... } 方便上游
 * 用现有的 data.choices[0].message.content 路径消费，无需改调用点。
 */
function parseSseToCompletion(raw: string): any | null {
    let assembled = '';
    let role = 'assistant';
    let finishReason: string | null = null;
    let firstChunk: any = null;
    let usage: any = undefined;
    const toolCalls: any[] = [];
    let gotAnyChunk = false;

    const ensureToolCall = (index: number) => {
        if (!toolCalls[index]) {
            toolCalls[index] = {
                index,
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
            };
        }
        return toolCalls[index];
    };

    // 按行切，逐行找 "data: " 开头（允许 \r\n、空行分隔）
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { continue; }
        gotAnyChunk = true;
        if (!firstChunk) firstChunk = chunk;
        // OpenAI 流式 usage 在最后一个 chunk（include_usage=true 时），也可能出现在中途；
        // 始终取最后一个非空的 usage，兼容各家代理。
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        // delta 路径（OpenAI 流式常见）
        if (choice.delta) {
            if (typeof choice.delta.content === 'string') assembled += choice.delta.content;
            if (choice.delta.role) role = choice.delta.role;
            if (Array.isArray(choice.delta.tool_calls)) {
                for (const tc of choice.delta.tool_calls) {
                    const idx = typeof tc?.index === 'number' ? tc.index : toolCalls.length;
                    const target = ensureToolCall(idx);
                    if (tc?.id) target.id = tc.id;
                    if (tc?.type) target.type = tc.type;
                    if (tc?.function?.name) target.function.name = tc.function.name;
                    if (typeof tc?.function?.arguments === 'string') {
                        target.function.arguments += tc.function.arguments;
                    }
                }
            }
        }
        // message 路径（一次性 SSE，不常见但兼容）
        else if (choice.message) {
            if (typeof choice.message.content === 'string') {
                assembled += choice.message.content;
            }
            if (choice.message.role) role = choice.message.role;
            if (Array.isArray(choice.message.tool_calls)) {
                toolCalls.splice(0, toolCalls.length, ...choice.message.tool_calls);
            }
        }
        if (Array.isArray(choice.tool_calls)) {
            toolCalls.splice(0, toolCalls.length, ...choice.tool_calls);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    if (!gotAnyChunk) return null;

    // 合成兼容结构
    const message: any = { role, content: assembled };
    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls
            .filter(Boolean)
            .map(({ index, ...rest }) => rest);
    }

    return {
        id: firstChunk?.id || 'sse-assembled',
        object: 'chat.completion',
        created: firstChunk?.created || Math.floor(Date.now() / 1000),
        model: firstChunk?.model || '',
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason,
        }],
        usage: usage || firstChunk?.usage,
    };
}

/**
 * Fetch with automatic retry for transient errors.
 * Retries on: 429, 500, 502, 503, 504 and network failures.
 * Returns the parsed JSON data directly.
 *
 * `timeoutMs`：每次尝试的硬超时。如果调用方没在 options.signal 里自带 AbortController，
 * 这里会给每次 attempt 起一个内部 AbortController，超时就 abort，避免提供方 stall
 * 住整个页面（用户误以为卡死，只能重新打开网页）。0 / 未传 = 不超时。
 *
 * `protocol`：
 *   - 'openai' (默认): 发到 {url}/chat/completions，OpenAI 标准协议
 *   - 'claude':         发到 {url}/v1/messages，Anthropic 协议
 *                     headers 自动加 x-api-key + anthropic-version
 *                     响应体内部转成 OpenAI 格式合成对象返回，调用方 19 处
 *                     data.choices[0].message.content 一行不用改
 *                     ⚠️ Claude 协议下不实现工具调用 / 流式（callers 须自己
 *                        不挂 tools、强制 stream=false）
 */

// CORS 代理：讯飞等不支持浏览器跨域的 API，走 Vercel 服务端转发
async function proxyFetch(url: string, options: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.headers) {
        const h = options.headers as Record<string, string>;
        for (const [k, v] of Object.entries(h)) {
            headers[k] = v;
        }
    }
    const { 'Content-Type': _, ...forwardHeaders } = headers;
    const resp = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            targetUrl: url,
            headers: forwardHeaders,
            body: options.body ? JSON.parse(options.body as string) : undefined,
        }),
    });
    return resp;
}

export async function safeFetchJson(
    url: string,
    options: RequestInit,
    maxRetries: number = 2,
    timeoutMs: number = 0,
    protocol: 'openai' | 'claude' = 'openai',
): Promise<any> {
    // 暮色 2026-07-17：协议分支
    //   - OpenAI (默认): {url}/chat/completions，原样转发
    //   - Claude:         {url}/v1/messages，自动加 x-api-key + anthropic-version
    //                   响应体转成 OpenAI 格式合成对象返回
    let actualUrl = url;
    let actualOptions = options;
    if (protocol === 'claude') {
        // 路径切到 /v1/messages（如果 caller 传的 url 已经以 /v1/messages 结尾就不动）
        if (!url.endsWith('/v1/messages')) {
            const base = url.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, '');
            actualUrl = `${base}/v1/messages`;
        }
        // headers：加 x-api-key + anthropic-version
        // Anthropic 协议也接受 Authorization: Bearer，但 x-api-key 是标准头
        const h: Record<string, string> = {};
        if (options.headers) {
            const oh = options.headers as Record<string, string>;
            for (const [k, v] of Object.entries(oh)) {
                h[k] = v;
            }
        }
        if (!h['x-api-key'] && !h['X-Api-Key']) {
            const authVal = h['Authorization'] || h['authorization'] || '';
            const m = authVal.match(/^Bearer\s+(.+)$/i);
            h['x-api-key'] = m ? m[1] : '';
        }
        h['anthropic-version'] = h['anthropic-version'] || '2023-06-01';
        actualOptions = { ...options, headers: h };
    }
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        // 每次 attempt 建一个独立的 AbortController（仅用于 timeout）
        // 调用方自己的 options.signal 仍然有效，两者任一触发就 abort
        let attemptOptions = actualOptions;
        let timeoutHandle: any = null;
        if (timeoutMs > 0) {
            const ac = new AbortController();
            timeoutHandle = setTimeout(() => ac.abort(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
            if (actualOptions.signal) {
                // 串联外部 signal：外部 abort 也触发内部
                if (actualOptions.signal.aborted) {
                    clearTimeout(timeoutHandle);
                    throw new Error('aborted');
                }
                actualOptions.signal.addEventListener('abort', () => ac.abort(), { once: true });
            }
            attemptOptions = { ...actualOptions, signal: ac.signal };
        }
        try {
            const response = await fetch(actualUrl, attemptOptions);
            if (timeoutHandle) clearTimeout(timeoutHandle);

            if (!response.ok) {
                // For retryable status codes, retry before giving up
                if (retryableStatuses.has(response.status) && attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // 1s, 2s
                    console.warn(`[SafeAPI] HTTP ${response.status}, retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                // Non-retryable or last attempt: parse body for error details
                const data = await safeResponseJson(response);
                // If we somehow got valid JSON with error info, wrap it
                // 暮色 2026-07-17：Anthropic 错误体是 { error: { type, message } }，
                //   .message 在两种协议下都存在，所以这里不用协议分支
                const errMsg = data?.error?.message || data?.error || `HTTP ${response.status}`;
                throw new Error(`API Error ${response.status}: ${errMsg}`);
            }

            const rawData = await safeResponseJson(response);
            // 暮色 2026-07-17：Anthropic 协议响应 → 转 OpenAI 格式合成对象
            //   这样调用方 19 处 data.choices[0].message.content 一行不用改
            if (protocol === 'claude') {
                return anthropicResponseToOpenAI(rawData);
            }
            return rawData;
                       } catch (e: any) {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            lastError = e;

            // CORS 失败自动走代理（TypeError: Load failed 是典型 CORS 报错）
            const isCorsLikely = e.name === 'TypeError' && /load failed|failed to fetch|network/i.test(e.message || '');
            if (isCorsLikely && attempt === 0) {
                console.log('[SafeAPI] CORS blocked, retrying via /api/proxy...');
                try {
                    const proxyResp = await proxyFetch(url, options);
                    if (!proxyResp.ok) {
                        const data = await safeResponseJson(proxyResp);
                        const errMsg = data?.error?.message || data?.error || `HTTP ${proxyResp.status}`;
                        throw new Error(`API Error ${proxyResp.status}: ${errMsg}`);
                    }
                    return await safeResponseJson(proxyResp);
                } catch (proxyErr: any) {
                    console.warn('[SafeAPI] Proxy also failed:', proxyErr.message);
                    lastError = proxyErr;
                    if (attempt < maxRetries) {
                        const delay = Math.pow(2, attempt) * 1000;
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    throw proxyErr;
                }
            }

            // AbortError（含 timeout）
            const isAbort = e?.name === 'AbortError' || /aborted|timeout/i.test(e?.message || '');

            if ((e.name === 'TypeError' || isAbort) && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[SafeAPI] ${isAbort ? 'Timeout/Abort' : 'Network error'}, retry ${attempt + 1}/${maxRetries} in ${delay}ms:`, e.message);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (attempt < maxRetries && e.message?.includes('API返回了HTML')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[SafeAPI] HTML response, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            throw e;
        }
    }


    throw lastError || new Error('API请求失败');
}

/**
 * 暮色 2026-07-17：把 Anthropic 协议响应体转成 OpenAI 格式合成对象。
 *
 * Anthropic 协议响应：
 *   {
 *     "id": "msg_...",
 *     "type": "message",
 *     "role": "assistant",
 *     "content": [{"type": "text", "text": "..."}],
 *     "stop_reason": "end_turn",
 *     "usage": { "input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens" }
 *   }
 *
 * OpenAI 协议响应：
 *   {
 *     "choices": [{ "message": { "role": "assistant", "content": "..." }, "finish_reason": "stop" }],
 *     "usage": { ... }
 *   }
 *
 * 合成 OpenAI 格式后，上层 19 处 data.choices[0].message.content 一行不用改。
 *
 * 注意：
 *   - 多个 text block 用空串连接（实际不会同时出现多个 text block，工具调用是单独的 content block）
 *   - tool_use block 暂不处理（Claude 协议分支目前不挂 tool，参见 useChatAI 的 toolsList）
 *   - stop_reason 'end_turn' → 'stop'，'max_tokens' → 'length'，'tool_use' → 'tool_calls'（兼容）
 *   - usage 字段透传（包括 cache_creation_input_tokens / cache_read_input_tokens，调用方看 ccmax 控制台时还能看到）
 */
function anthropicResponseToOpenAI(anth: any): any {
    if (!anth || typeof anth !== 'object') return anth;
    // 如果已经是 OpenAI 格式（有人帮我们转过了），原样返回
    if (Array.isArray(anth.choices)) return anth;

    const contentBlocks = Array.isArray(anth.content) ? anth.content : [];
    // 提取所有 text block（通常只有一个，但保险起见拼起来）
    const text = contentBlocks
        .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('');

    // stop_reason 兼容映射
    let finishReason: string = anth.stop_reason || 'stop';
    if (finishReason === 'end_turn') finishReason = 'stop';
    else if (finishReason === 'max_tokens') finishReason = 'length';
    else if (finishReason === 'tool_use') finishReason = 'tool_calls';

    return {
        id: anth.id || 'claude-assembled',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: anth.model || 'claude',
        choices: [{
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: finishReason,
        }],
        usage: anth.usage || undefined,
        // 原始 Anthropic 响应也保留一份，调试 / 工具调用时可能需要
        _anthropic_raw: anth,
    };
}

/**
 * Safely extract the AI content string from an OpenAI-compatible response.
 * Returns '' instead of crashing when the structure is unexpected.
 *
 * Handles thinking models (DeepSeek-R1, GLM-4.5, QwQ, Qwen3, ...):
 *  - Falls back to `reasoning_content` when `content` is missing/empty
 *  - Strips hidden <think>...</think> chain-of-thought blocks
 */
export function extractContent(data: any): string {
    const msg = data?.choices?.[0]?.message;
    let text: string = msg?.content || '';
    if (!text.trim()) text = msg?.reasoning_content || '';
    // Strip hidden chain-of-thought blocks
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    text = text.replace(/<think>[\s\S]*$/gi, '');
    return text.trim();
}

/**
 * Robustly extract a JSON object from AI-generated text.
 *
 * Handles common Claude format instabilities:
 *  - JSON wrapped in ```json ... ``` code blocks
 *  - Extra prose before/after the JSON ("Here is the result: { ... }")
 *  - Trailing commas in arrays/objects  (common Claude habit)
 *  - Single-quoted strings
 *  - Unquoted keys
 *
 * Returns parsed object on success, null on total failure.
 */
/**
 * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
 * Handles the common case where LLM output is cut off mid-string.
 */
function repairTruncatedJson(text: string): string | null {
    // If it already ends with } or ], it's probably not truncated in a way we can fix
    const trimmed = text.trim();
    if (trimmed.endsWith('}') || trimmed.endsWith(']')) return null; // let other steps handle it

    // Walk through the string tracking state
    let inString = false;
    let escaped = false;
    const stack: ('{' | '[')[] = [];
    let lastKeyValueEnd = 0; // position after last complete key:value pair

    for (let i = 0; i < trimmed.length; i++) {
        const ch = trimmed[i];

        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }

        if (ch === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (ch === '{') stack.push('{');
        else if (ch === '[') stack.push('[');
        else if (ch === '}') { if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop(); }
        else if (ch === ']') { if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop(); }

        // Track positions after complete values at object level
        if (stack.length === 1 && stack[0] === '{' && (ch === ',' || ch === '}')) {
            lastKeyValueEnd = i + 1;
        }
    }

    if (stack.length === 0) return null; // balanced, nothing to repair

    // Strategy: truncate to last complete key:value, then close brackets
    let repaired = '';
    if (lastKeyValueEnd > 0) {
        repaired = trimmed.slice(0, lastKeyValueEnd).replace(/,\s*$/, '');
    } else {
        // No complete key:value found at top level, try closing from current position
        repaired = trimmed;
        // If we're in an open string, close it
        if (inString) repaired += '"';
    }

    // Close remaining open brackets in reverse order
    for (let i = stack.length - 1; i >= 0; i--) {
        repaired += stack[i] === '{' ? '}' : ']';
    }

    return repaired;
}

export function extractJson(raw: string): any | null {
    if (!raw) return null;

    // 1. Strip markdown code fences
    let text = raw
        .replace(/^```(?:json|JSON)?\s*\n?/gm, '')
        .replace(/\n?```\s*$/gm, '')
        .trim();

    // 2. Try direct parse first (fast path)
    try { return JSON.parse(text); } catch {}

    // 3. Extract the outermost { ... } or [ ... ]
    const objMatch = text.match(/(\{[\s\S]*\})/);
    const arrMatch = text.match(/(\[[\s\S]*\])/);
    // Prefer whichever starts earlier in the text
    let jsonStr = '';
    if (objMatch && arrMatch) {
        jsonStr = (text.indexOf(objMatch[1]) <= text.indexOf(arrMatch[1]))
            ? objMatch[1] : arrMatch[1];
    } else {
        jsonStr = objMatch?.[1] || arrMatch?.[1] || '';
    }

    if (!jsonStr) return null;

    // 4. Try parsing the extracted substring
    try { return JSON.parse(jsonStr); } catch {}

    // 5. Fix common AI formatting issues and retry
    let fixed = jsonStr
        // Trailing commas: ,} or ,]
        .replace(/,\s*([}\]])/g, '$1')
        // Single quotes → double quotes (careful with apostrophes in text)
        // Only replace quotes that look like JSON string delimiters
        .replace(/'/g, '"')
        // Unquoted keys:  { foo: "bar" } → { "foo": "bar" }
        .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');

    try { return JSON.parse(fixed); } catch {}

    // 6. Try to repair truncated JSON (LLM hit max_tokens)
    // Find the first { and attempt to close any open strings/brackets
    const firstBrace = text.indexOf('{');
    if (firstBrace >= 0) {
        let truncated = text.slice(firstBrace);
        const repaired = repairTruncatedJson(truncated);
        if (repaired) {
            try { return JSON.parse(repaired); } catch {}
            // Also try with common fixes applied
            try {
                return JSON.parse(repaired
                    .replace(/,\s*([}\]])/g, '$1')
                    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":'));
            } catch {}
        }
    }

    // 7. Last resort: try to extract individual JSON objects if there are multiple
    // (AI sometimes outputs two JSON blocks, take the larger one)
    const allObjects = [...text.matchAll(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g)];
    if (allObjects.length > 0) {
        // Sort by length, try the longest first (most likely the full response)
        const sorted = allObjects.sort((a, b) => b[0].length - a[0].length);
        for (const m of sorted) {
            try {
                return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
            } catch {}
        }
    }

    // 8. AI sometimes wraps the expected JSON in a wrapper object like {"result": {...}}
    // Try to find the first nested object value and return it
    for (const m of allObjects) {
        try {
            const parsed = JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
            const vals = Object.values(parsed);
            if (vals.length === 1 && typeof vals[0] === 'object' && vals[0] !== null) return vals[0];
        } catch {}
    }

    console.error('[extractJson] All attempts failed. Raw:', raw.slice(0, 300));
    return null;
}
