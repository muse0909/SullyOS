// 暮色 2026-07-27：副 LLM 统一调用 helper — 跟主 API 一样的 3 tab 协议切换
//   - protocol === 'openai' (默认): 走 /v1/chat/completions（OpenAI 兼容）
//   - protocol === 'claude':         走 /v1/messages（Anthropic）
//   - protocol === 'gemini':         走 /v1beta/models/{model}:generateContent
//
// 把原来 6 处散落的"llmConfig.baseUrl + /chat/completions + Bearer + OpenAI 协议"调用全部统一到这里
// 旧代码保留兼容（不传 protocol 默认走 OpenAI 兼容）

import type { LightLLMConfig } from './pipeline';

export interface CallLLMOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    responseFormatJson?: boolean; // 提取时需要严格 JSON 输出
}

export interface CallLLMResult {
    text: string;          // 提取的纯文本
    raw: any;              // 原始响应（按协议转成 OpenAI 格式）
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export async function callLLM(
    llmConfig: LightLLMConfig,
    systemPrompt: string,
    userPrompt: string,
    options: CallLLMOptions = {}
): Promise<CallLLMResult> {
    const protocol = llmConfig.protocol || 'openai';
    const cleanBase = (llmConfig.baseUrl || '').replace(/\/+$/, '');
    if (!cleanBase) {
        throw new Error('LightLLM baseUrl 未配置');
    }
    const temperature = options.temperature ?? 0.4;
    const maxTokens = options.maxTokens ?? 4096;

    if (protocol === 'gemini') {
        return callGemini(cleanBase, llmConfig, systemPrompt, userPrompt, temperature, maxTokens);
    }
    if (protocol === 'claude') {
        return callClaude(cleanBase, llmConfig, systemPrompt, userPrompt, temperature, maxTokens);
    }
    return callOpenAI(cleanBase, llmConfig, systemPrompt, userPrompt, temperature, maxTokens, options.stream ?? false);
}

async function callOpenAI(
    baseUrl: string,
    llmConfig: LightLLMConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens: number,
    stream: boolean
): Promise<CallLLMResult> {
    const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llmConfig.apiKey || ''}`,
        },
        body: JSON.stringify({
            model: llmConfig.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
            stream,
        }),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LightLLM OpenAI ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return {
        text,
        raw: data,
        usage: data?.usage ? {
            prompt_tokens: data.usage.prompt_tokens || 0,
            completion_tokens: data.usage.completion_tokens || 0,
            total_tokens: data.usage.total_tokens || 0,
        } : undefined,
    };
}

async function callClaude(
    baseUrl: string,
    llmConfig: LightLLMConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens: number
): Promise<CallLLMResult> {
    // Claude 协议走 /v1/messages
    const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': llmConfig.apiKey || '',
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: llmConfig.model,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }],
            temperature,
            max_tokens: maxTokens,
        }),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LightLLM Claude ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data: any = await res.json();
    // 响应: { content: [{type:'text', text:'...'}], usage: {input_tokens, output_tokens} }
    const text = data?.content?.[0]?.text || '';
    return {
        text,
        raw: data,
        usage: data?.usage ? {
            prompt_tokens: data.usage.input_tokens || 0,
            completion_tokens: data.usage.output_tokens || 0,
            total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : undefined,
    };
}

async function callGemini(
    baseUrl: string,
    llmConfig: LightLLMConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens: number
): Promise<CallLLMResult> {
    // Gemini 协议走 /v1beta/models/{model}:generateContent?key=xxx
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/models/${encodeURIComponent(llmConfig.model)}:generateContent?key=${encodeURIComponent(llmConfig.apiKey || '')}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`LightLLM Gemini ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data: any = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
        text,
        raw: data,
        usage: data?.usageMetadata ? {
            prompt_tokens: data.usageMetadata.promptTokenCount || 0,
            completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
            total_tokens: data.usageMetadata.totalTokenCount || 0,
        } : undefined,
    };
}
