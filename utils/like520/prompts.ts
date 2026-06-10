/**
 * like520/prompts.ts
 *
 * 520 特别活动 LLM 调用函数（Call A / Call B）。
 * Call A：生成开场剧本（yangcheng + uncovered_line + ending）
 * Call B：根据用户选择的吐槽，生成 wake_up + letter
 */
import { safeResponseJson } from '../safeApi';
import type { CharacterProfile, UserProfile, APIConfig, Message } from '../../types';

// ============================================================
// 导出类型
// ============================================================

export type Like520TucaoKey = 'becamesmall' | 'cute' | 'yangcheng_meta';

export interface Like520CallAResult {
    uncovered_line: string[];
    ending: {
        title: string;
        description: string;
    };
}

export interface Like520CallBResult {
    wake_up: string[];
    letter: string;
}

// ============================================================
// Prompt 模板
// ============================================================

function buildCallASystemPrompt(char: CharacterProfile, userName: string): string {
    return `你正在参与一个520特别活动，主题是"如果角色变得小小的"。

你是 ${char.name}，今天你突然变得非常小（只有手掌大小），
${userName} 发现并照顾小小的你。

请生成以下内容（严格按 JSON 格式返回）：

1. "uncovered_line"：一个小剧情序列，包含 3-5 句短台词（简中），描述你和 ${userName} 在这个下午的互动，从被发现到逐渐亲近。

2. "ending"：一个包含 "title" 和 "description" 的对象——
   - title：这整个下午的主题/标题（一句浪漫温馨的话，10字以内）
   - description：对这段时光的描述（20字以内，温馨）

请只返回一个 JSON 对象，不要包含任何额外的说明文字。`;
}

function buildCallBSystemPrompt(
    char: CharacterProfile,
    userName: string,
    aResult: Like520CallAResult,
    tucao: Like520TucaoKey,
): string {
    const tucaoLabels: Record<Like520TucaoKey, string> = {
        becamesmall: '你怎么变小了！',
        cute: '你今天好可爱！',
        yangcheng_meta: '这什么天杀的养成游戏',
    };
    const chosenLabel = tucaoLabels[tucao] || '你怎么变小了！';

    return `你正在参与一个520特别活动，主题是"如果角色变得小小的"。

你是 ${char.name}。刚才你和 ${userName} 一起度过了一段温馨的时光，
${userName} 对你说了一句：${chosenLabel}

从漫长的午睡中醒来，你恢复到了原来的大小。
刚才发生的一切就像一场梦。

请生成以下内容（严格按 JSON 格式返回）：

1. "wake_up"：一个包含 2-4 句短台词的数组，描述你醒来后恍惚的状态，
   意识到刚才变小的事情好像一场梦，但对 ${userName} 感到格外亲近。
   语气温柔、略带羞涩。

2. "letter"：一封给 ${userName} 的简短留言/信（50-150字），
   以"亲爱的${userName}"开头，表达你对这个下午的珍惜。
   要真挚、细腻，带一点梦幻感。

请只返回一个 JSON 对象，不要包含任何额外的说明文字。`;
}

// ============================================================
// Call A：生成开场剧本
// ============================================================

export async function runLike520CallA(
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: APIConfig,
    recent: Message[],
): Promise<Like520CallAResult> {
    const userName = (userProfile.name || '').trim() || '你';

    const systemPrompt = buildCallASystemPrompt(char, userName);
    const userPrompt = `请为 ${char.name} 和 ${userName} 生成一个温馨的小故事（JSON格式）。`;

    const body = {
        model: apiConfig.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.8,
        stream: false,
    };

    const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    const data = await safeResponseJson(response);
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);

    return {
        uncovered_line: parsed.uncovered_line || [],
        ending: parsed.ending || { title: '一个小小的下午', description: '温暖而难忘' },
    };
}

// ============================================================
// Call B：根据吐槽生成收尾
// ============================================================

export async function runLike520CallB(
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: APIConfig,
    aResult: Like520CallAResult,
    tucao: Like520TucaoKey,
    recent: Message[],
): Promise<Like520CallBResult> {
    const userName = (userProfile.name || '').trim() || '你';

    const systemPrompt = buildCallBSystemPrompt(char, userName, aResult, tucao);
    const userPrompt = `${userName} 对 ${char.name} 说了一句话。请生成醒来后的对话和留言。`;

    const body = {
        model: apiConfig.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        max_tokens: 1024,
        temperature: 0.8,
        stream: false,
    };

    const baseUrl = apiConfig.baseUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.apiKey}`,
        },
        body: JSON.stringify(body),
    });

    const data = await safeResponseJson(response);
    const content = data?.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);

    return {
        wake_up: parsed.wake_up || ['……我们好像一起做了一个梦呀。', '不过，不是坏的那种。'],
        letter: parsed.letter || '（信生成出了一点小问题。这是一段属于你的、未完成的话——但它一直在。）',
    };
}