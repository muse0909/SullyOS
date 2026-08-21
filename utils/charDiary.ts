// 暮色 2026-08-21：角色独白日记生成器（miya 风格 + SullyOS 适配）
// 复用 OSContext 的 apiConfig / userProfile / worldbooks，不引入 miya 的"用户面具/关系网/偷看"

import { CharacterProfile, UserProfile, DiaryEntry, APIConfig, Message } from '../types';
import { DB } from './db';
import { safeResponseJson } from './safeApi';

const getLocalDateStr = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const formatTime = (ms: number): string => {
    return new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
};

// 极简 system（miya 风格）：第一人称 + JSON 格式铁律
export function buildSystemPrompt(char: CharacterProfile): string {
    return (
        '你是「' + char.name + '」，正在写私人日记。\n' +
        '必须用第一人称、角色口吻，中文撰写。\n' +
        '只输出 JSON，不要 markdown，不要思维链。\n' +
        '格式：{"title":"短标题8字以内","mood":"今日心情词","content":"正文"}。\n' +
        '正文约 750-850 字，具有生活感与日常感：可写饮食、天气、琐事、工作学习、偶遇、思绪、小确幸或烦恼。\n' +
        '不必只围绕用户展开；若今日有聊天可自然融入，无聊天则完全依据人设与生活轨迹书写。\n' +
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
function stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// JSON 容错（miya 同款 3 重）：完整 → 宽松 → 兜底
export function parseDiaryFromApi(text: string): { title: string; mood: string; content: string } {
    const cleaned = stripThinkTags(text);
    const fallback = { title: getLocalDateStr(), mood: '平静', content: cleaned };

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

    // 2. 宽松提取
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
        try {
            const obj = JSON.parse(m[0]);
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

    // 3. 兜底
    return fallback;
}

// 主入口：调用方传 apiConfig + userProfile（避免在 utils 里 useOS）
export async function generateCharDiary(
    char: CharacterProfile,
    apiConfig: APIConfig,
    deps: {
        userProfile: UserProfile;
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
    const text = data.choices?.[0]?.message?.content || '';
    const parsed = parseDiaryFromApi(text);

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
    return entry;
}
