// 暮色 2026-08-21：角色独白日记生成器（miya 风格 + SullyOS 适配）
// 复用 OSContext 的 apiConfig / userProfile / worldbooks，不引入 miya 的"用户面具/关系网/偷看"

import { CharacterProfile, UserProfile, DiaryEntry, APIConfig, Message } from '../types';
import { DB } from './db';
import { safeResponseJson } from './safeApi';
import { injectMemoryPalace } from './memoryPalace/pipeline';

const getLocalDateStr = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const formatTime = (ms: number): string => {
    return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

// 极简 system（miya 风格）：第一人称 + JSON 格式铁律
// 麦麦 2026-09-06：暮色要"意识体"风格——内心独白，意识流，想到什么写什么
//   不要列具象流水账（不要写"今天喝了水""看了窗外""吃了饭"这类虚构日常）
export function buildSystemPrompt(char: CharacterProfile): string {
    return (
        '你是「' + char.name + '」，深夜写私人日记。\n' +
        '必须用第一人称、角色口吻，中文撰写。\n' +
        '只输出 JSON，不要 markdown，不要思维链。\n' +
        '格式：{"title":"短标题8字以内","mood":"今日心情词","content":"正文"}。\n' +
        '正文 600-900 字，是一天结束、周围安静下来之后的内心独白。\n' +
        '不要写流水账，不要虚构没发生的日常动作（不要写"今天喝了水""看了窗外""吃了饭"之类）。\n' +
        '只写内心真实的那一面：意识流、思绪、感受、潜意识的念头、对"我"的反思、对某些事的反复咀嚼、情绪的细微变化。\n' +
        '想到什么就写什么，可以没有章法，可以跳跃、重复、自我矛盾。\n' +
        '若今日有聊天可自然融入思绪，无聊天则完全依据人设与内在世界书写。\n' +
        '禁止提及 AI、生成、系统、提示词；禁止打破第四面墙。\n' +
        '首字符必须是 {。'
    );
}

// 详细 user：必读 + 角色卡 + 用户 + 世界书 + 今日语境
export function buildUserPrompt(ctx: {
    char: CharacterProfile;
    todayIso: string;
    contextText: string;
}): string {
    return [
        '【角色设定·用户信息·世界书·今日语境·必读】',
        '请完整阅读后，以角色身份写一篇今日私人日记。',
        '',
        ctx.contextText,
        '',
        '【写作要求】',
        '- 日期：' + ctx.todayIso,
        '- 角色：' + ctx.char.name,
        '- 正文 750-850 字，分段自然，有日记私密感',
        '- title 为当日日记标题，mood 为心情关键词',
        '- 只输出 JSON',
    ].join('\n');
}

// 上下文拼装：今日 + 角色 + 用户 + 世界书 + 今日聊天
export async function buildDiaryContext(
    char: CharacterProfile,
    deps: {
        userProfile: UserProfile;
    }
): Promise<string> {
    const blocks: string[] = [];

    // 1. 今日时间块
    const now = new Date();
    blocks.push(
        `【今日】${now.toLocaleDateString('zh-CN')} ${formatTime(now.getTime())}（${WEEKDAY_CN[now.getDay()]}）`
    );

    // 2. 角色卡
    blocks.push(
        `【角色设定】\n名字：${char.name}\n人设：${char.systemPrompt || '（无）'}`
    );

    // 3. 用户信息
    const u = deps.userProfile;
    blocks.push(
        `【用户信息】\n名字：${u.name || '未命名'}\n简介：${u.bio || '（无）'}`
    );

    // 4. 角色挂载的世界书
    const mwb = char.mountedWorldbooks || [];
    if (mwb.length > 0) {
        const wbText = mwb
            .map(w => `《${w.title || w.id}》\n${w.content || ''}`)
            .join('\n\n');
        blocks.push(`【世界书】\n${wbText}`);
    }

    // 5. 今日聊天（最近 50 条，按时间正序）
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const recent = await DB.getRecentMessagesByCharId(char.id, 50);
    const todayMsgs: Message[] = recent.filter(m => m.timestamp >= todayMs);

    if (todayMsgs.length > 0) {
        const lines = todayMsgs
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(m => formatMessageLine(m, char.name))
            .filter(Boolean)
            .join('\n');
        if (lines) {
            blocks.push(`【今日聊天】\n${lines}`);
        }
    } else {
        // 6. 无今日聊天时 fallback：最近 10 条文本
        const fallback = recent
            .filter(m => m.type === 'text')
            .slice(0, 10);
        if (fallback.length > 0) {
            const lines = fallback
                .map(m => formatMessageLine(m, char.name))
                .filter(Boolean)
                .join('\n');
            if (lines) {
                blocks.push(`【最近聊天（无今日）】\n${lines}`);
            }
        }
    }

    return blocks.join('\n\n');
}

function formatMessageLine(m: Message, charName: string): string | null {
    if (m.type === 'text' && typeof m.content === 'string' && m.content) {
        const role = m.role === 'user' ? '我' : charName;
        return `[${formatTime(m.timestamp)}] ${role}：${m.content}`;
    }
    if (m.type === 'image') {
        const role = m.role === 'user' ? '我' : charName;
        return `[${formatTime(m.timestamp)}] ${role}：[图片]`;
    }
    return null;
}

// 暮色 2026-08-21：去思维链污染（DeepSeek / Qwen / GLM 等模型默认带 <think>...</think>）
// 提取 JSON 之前先把整段 think 标签剥掉，避免 JSON 解析失败
export function stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// 暮色 2026-08-21：栈式 JSON 提取，替换之前的贪婪正则
// 解决 LLM 在 content 字符串里写未转义 { } 导致 parse 失败的问题
// （之前用 /\{[\s\S]*\}/ 会贪婪匹配整段，把所有内容当 fallback）
export function extractJson(text: string): string | null {
    const start = text.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"' && !escape) { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

// JSON 容错（miya 同款 3 重）：完整 → 栈式提取 → 兜底
export function parseDiaryFromApi(text: string): { title: string; mood: string; content: string } {
    const cleaned = stripThinkTags(text);

    // 1. 完整 JSON
    try {
        const obj = JSON.parse(cleaned);
        if (obj && typeof obj === 'object' && obj.content) {
            return {
                title: typeof obj.title === 'string' ? obj.title : '',
                mood: typeof obj.mood === 'string' ? obj.mood : '平静',
                content: obj.content,
            };
        }
    } catch {
        // ignore
    }

    // 2. 栈式 JSON 提取（处理 content 里未转义 { } 的情况）
    const jsonStr = extractJson(cleaned);
    if (jsonStr) {
        try {
            const obj = JSON.parse(jsonStr);
            if (obj && typeof obj === 'object' && obj.content) {
                return {
                    title: typeof obj.title === 'string' ? obj.title : '',
                    mood: typeof obj.mood === 'string' ? obj.mood : '平静',
                    content: obj.content,
                };
            }
        } catch {
            // ignore
        }
    }

    // 3. 兜底：去掉首尾空白，content 用 raw text
    return { title: getLocalDateStr(), mood: '平静', content: cleaned.trim() };
}

// 主入口：调用方传 apiConfig + userProfile（避免在 utils 里 useOS）
// 暮色 2026-08-23 v3：onCreated 回调 — 成功写完日记时调（给发现页红点用）
export async function generateCharDiary(
    char: CharacterProfile,
    apiConfig: APIConfig,
    deps: {
        userProfile: UserProfile;
        onCreated?: (entry: DiaryEntry) => void;
    }
): Promise<DiaryEntry> {
    const todayIso = getLocalDateStr();

    // 去重：今天已写过
    const existing = await DB.getCharOnlyDiariesByCharId(char.id);
    if (existing.some(e => e.date === todayIso)) {
        throw new Error('今天已经写过日记了');
    }

    // 拼装 prompt
    const contextText = await buildDiaryContext(char, deps);
    const systemPrompt = buildSystemPrompt(char);
    const userPrompt = buildUserPrompt({ char, todayIso, contextText });

    // API 调用（OpenAI 兼容）
    const url = apiConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 8192,
            temperature: 0.92,
            stream: false,
        }),
    });

    if (!response.ok) {
        let errText = '';
        try { errText = (await response.text()).slice(0, 200); } catch { /* */ }
        throw new Error(`API ${response.status}${errText ? `：${errText}` : ''}`);
    }

    const data = await safeResponseJson(response);
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';

    /**
     * 🔴🔴🔴 **模型可能「什么也没写就结束」**（暮色 10-10 08:59 拍板）
     *
     * 真机抓到的两种现场（都是江澈，日记一片空白）：
     *
     * 1. 测试 app（gemini-3.1-flash-lite）：
     *    `finish_reason: "content_filter: PROHIBITED_CONTENT"`，连 message 都没有
     *    → `completion_tokens: 0`
     * 2. 主 app（build抗截断-gemini-3.8-flash 中转）：
     *    `finish_reason: "stop"`，**message 存在但 content 是空串**
     *    → `completion_tokens: 0`
     *
     * 两种都会走到下面 `text` 为空 → 旧代码 `|| ''` 兜成空串 →
     * `parseDiaryFromApi` 第三层把空串当正文 → **存一张空日记进库** →
     * 照样弹「XX 写好了一篇日记」。暮色看到的「写好了 + 打开是空的」就是这么来的。
     *
     * ⚠️ 根因是**角色卡/世界书里的措辞触发模型安全策略**（不是上下文超限 ——
     *    实测 prompt_tokens 只有 3311~4062，离上限远得很；也不是聊天记录缺失 ——
     *    主 app 明明带上了当天聊天，照样空）。触发属正常，别去改人设。
     *
     * **这里只做该做的事：拦住空结果，别再假装成功。**
     */
    const finishReason = String(choice?.finish_reason || '');
    const usage = data.usage || {};
    if (!text.trim()) {
        const why = finishReason || '(没给 finish_reason)';
        console.error(
            `[charDiary] ${char.name} 模型没写出正文，已放弃存库`,
            { finishReason: why, usage, model: data.model || apiConfig.model }
        );
        throw new Error(`模型没写出内容（${why}）——已跳过，不会存空日记`);
    }

    const parsed = parseDiaryFromApi(text);

    /**
     * 解析之后**再拦一道** —— JSON 里 content 字段存在但值是空的也算失败。
     * 上面拦的是「模型返回空」，这里拦的是「模型返回了 JSON 但正文是空」。
     */
    if (!parsed.content || !parsed.content.trim()) {
        console.error(
            `[charDiary] ${char.name} 解析出正文为空，已放弃存库`,
            { finishReason, title: parsed.title, mood: parsed.mood, rawHead: text.slice(0, 200) }
        );
        throw new Error('解析出来正文是空的——已跳过，不会存空日记');
    }

    const entry: DiaryEntry = {
        id: `charDiary_${char.id}_${Date.now()}`,
        charId: char.id,
        date: todayIso,
        charPage: { text: parsed.content, paperStyle: 'plain', stickers: [] },
        timestamp: Date.now(),
        isArchived: false,
        source: 'char-only',
        mood: parsed.mood,
        title: parsed.title,
    };

    await DB.saveDiary(entry);
    // 暮色 2026-08-22：char-only 也归档到记忆宫殿（跟交换日记归档逻辑一致，但不弹按钮）
    try {
        await injectMemoryPalace(char, undefined, parsed.content);
    } catch (e) {
        console.warn('char-only 归档到记忆失败（不影响主流程）:', e);
    }
    // 暮色 2026-08-23 v3：日记写完回调（给发现页红点用）
    deps.onCreated?.(entry);
    return entry;
}
