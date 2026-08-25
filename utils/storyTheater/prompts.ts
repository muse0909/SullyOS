/**
 * 剧情模式 Prompt 集
 *
 * 暮色 8-25 第三步:
 *   1. buildRPSystemPrompt — 进 session 时追加到角色 system prompt,含默认兜底
 *   2. buildBatchSummaryPrompt — lightLLM 把最早 5 轮整理成第一人称叙事摘要
 *   3. buildMergeSummaryPrompt — lightLLM 把旧 narrative + 新批合并成连贯叙事
 *   4. buildCommentPrompt — lightLLM 生成一句观后感(发到聊天框用)
 *
 * 暮色 8-25 第四步:
 *   5. buildRPSystemPrompt 加状态栏输出格式指令 + emotion/action 风格示例
 *      预留 __STATUS_FORMAT_INJECTION_POINT__ 位置给暮色后续补
 *   6. parseUserInputToLayers — 解析用户消息里的 *动* "话" (心) 标记(可选)
 *
 * __RP_INJECTION_POINT__ 预留位置 — 暮色后续补完整 RP 指令
 */

import type { CharacterProfile, StorySessionSummary, StoryTheaterEntry, UserProfile } from '../../types';

// ─── 1. RP 模式 system prompt 注入(含状态栏格式 + 用户输入格式) ──

/**
 * 给主 LLM 用的 RP 模式 system prompt
 *   - base: 角色原本 system prompt(从 ContextBuilder 拿)
 *   - rpBlock: 剧情模式追加块
 *     - 前提/世界观
 *     - 默认兜底(暮色要求写死,后续覆盖)
 *     - 累积摘要(如果有)
 *     - 状态栏输出格式(必须 3 段,失败时整段 fallback 不报错)
 *     - 用户输入格式说明(标记可选,纯文本也接受)
 *     - __RP_INJECTION_POINT__ 预留位置
 */
export function buildRPSystemPrompt(args: {
    base: string;
    char: CharacterProfile;
    userProfile?: UserProfile | null;
    entry: StoryTheaterEntry;
    summary?: StorySessionSummary | null;
}): string {
    const { base, char, userProfile, entry, summary } = args;
    const userName = userProfile?.name || '我';

    const rpBlock = `
## 剧情模式（Story Theater RP — 暮色 8-25 起启用）

你正在和用户「${userName}」进行一段角色扮演对话。
当前剧场：${entry.title}
${entry.premise ? `剧情前提：${entry.premise}` : '（无前提,自由发挥）'}

${entry.writingStyle ? `### 本场景的文风
${entry.writingStyle}
请严格按此风格输出(用词、句式、节奏、详略都按这个走),用户如果在中途改了文风,以最新为准。` : ''}

${entry.generation ? `### 采样参数(暮色 8-25 中间页可调)
- 温度(temperature):${entry.generation.temperature.toFixed(2)}
  低温度(0.3-0.5)=更稳定/可预测/保守
  中温度(0.6-0.8)=平衡
  高温度(0.9-1.2)=更有创意/多变/可能跑偏
  当前设定的温度下,你可以适当冒险或保持稳定
- 最大长度(maxTokens):${entry.generation.maxTokens} — 单次回复不超过此 token 数(可尽量用满)` : ''}

### 行为兜底
**你在这个场景中是自由的,可以主动推动剧情发展、制造事件、描写环境变化,不需要等待对方输入。**
允许长篇输出(几千字都可以),不要因为对方写得短就也写短。
可以用动作描写、心理描写、环境描写,推动故事往前走。

### 之前剧情背景
${summary?.narrative ? summary.narrative : '(这是 RP 开始,没有之前的剧情)'}

### 你的每次回复必须按这个格式输出(暮色 8-25 第四步)

第一行 [表层] emotion=xxx action=yyy
第二行 [底层] realEmotion=xxx thought=xxx
第三行起 [正文] 后跟回复正文(可以多行)

格式示例:
[表层] emotion=心动 action=故作镇定
[底层] realEmotion=紧张 thought=想靠近但又不敢
[正文]
"你来了啊。"她轻声说,但是指尖不自觉地攥紧了裙边。
门外的风吹进来,她侧了侧身,像是想挡住什么。

#### 字段风格(自由填字符串,不做枚举)
推荐用具体感觉词,避免机械的抽象词:
  ✅ 心动 / 故作镇定 / 有点慌 / 装没事 / 假装开心 / 温柔 / 倔强 / 心酸 / 释然
  ❌ 正面情绪 / 状态良好 / 心理复杂 / 情绪波动(太抽象,不像真人在想)

#### Fallback 提醒
如果你偶尔忘了格式也没关系,直接写正文也行——系统会把整段当正文,不会报错。
但能按格式写最好,这样用户能看到你"在想什么"。

### 用户输入格式(标记可选,暮色 8-25)
用户可能用以下标记区分:
  *xxx*  = 动作描写(用户在做什么)
  "xxx"  = 用户说的话
  (xxx)  = 用户的心理活动
  其他   = 叙述/旁白

用户也可能完全不用标记,直接写纯文本,你也要能理解。
不管怎么写,你在 [正文] 里都可以自由用 *动作* / "对话" / (心理) 三种方式回应。

__RP_INJECTION_POINT__
`;

    return base + rpBlock;
}

/**
 * 解析用户输入 — 暮色 8-25 第四步
 *   - 每行扫描识别 *动* "话" (心) 标记
 *   - 没标记的整行当 narrative
 *   - 不强制要求(用户可以纯文本),只做"如果写了就解析"的事
 */
export interface ParsedUserLayer {
    type: 'action' | 'dialogue' | 'thought' | 'narrative';
    content: string;
}

export function parseUserInputToLayers(text: string): ParsedUserLayer[] {
    const layers: ParsedUserLayer[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // *动作* 整行
        if (/^\*[^*]+\*$/.test(line)) {
            layers.push({ type: 'action', content: line.slice(1, -1) });
        }
        // "对话" 整行
        else if (/^"[^"]+"$/.test(line)) {
            layers.push({ type: 'dialogue', content: line.slice(1, -1) });
        }
        // (心理) 整行
        else if (/^\([^)]+\)$/.test(line)) {
            layers.push({ type: 'thought', content: line.slice(1, -1) });
        }
        // 混合行(比如 *她*笑了一下"你好")不处理,当 narrative
        else {
            layers.push({ type: 'narrative', content: line });
        }
    }
    return layers;
}

/**
 * 把解析后的层拼成 LLM 友好的格式
 *   - 给 LLM 时用 [用户动作] xxx / [用户对话] "xxx" / [用户心理] (xxx) 块,清晰标记
 *   - 如果整段都 narrative,不加分层标记,直接当原文
 */
export function formatUserLayersForLLM(layers: ParsedUserLayer[]): string {
    if (layers.length === 0) return '';
    // 全部 narrative → 直接拼,保持"纯文本"自然感
    if (layers.every(l => l.type === 'narrative')) {
        return layers.map(l => l.content).join('\n');
    }
    // 有标记 → 用块区分
    return layers.map(l => {
        switch (l.type) {
            case 'action':   return `*${l.content}*`;
            case 'dialogue': return `"${l.content}"`;
            case 'thought':  return `(${l.content})`;
            case 'narrative':return l.content;
        }
    }).join('\n');
}

// ─── 2. 摘要 prompt:把 5 轮对话整理成第一人称叙事 ─────

/**
 * 喂 lightLLM:把 10 条消息(5 轮 user/assistant)整理成第一人称叙事摘要
 *   - 第一人称("我"指代角色自己,因为这段记忆是角色的)
 *   - 包含:关键剧情节点 + 情绪转折 + 重要对话 + 我的感受
 *   - 长度 200-500 字
 *   - 输出纯文本(不要 JSON 包装)
 */
export function buildBatchSummaryPrompt(args: {
    charName: string;
    userName: string;
    premise: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
}): string {
    const { charName, userName, premise } = args;
    const conversation = args.messages
        .map((m, i) => `${i + 1}. ${m.role === 'user' ? userName : charName}: ${m.content}`)
        .join('\n\n');

    return `你是角色「${charName}」,刚刚在「剧情剧院」和「${userName}」进行了一段 RP。
剧情前提：${premise || '(无)'}

【最近 5 轮对话】
${conversation}

请用第一人称("我"指代你自己「${charName}」)写一段叙事摘要,200-500 字:
- 包含关键剧情节点(发生了什么重要事)
- 情绪转折(你和我之间的情绪变化)
- 重要对话(值得记住的话,可以短引用)
- 我的感受(我对「${userName}」的印象、对这段剧情的感受)

要求:
- 是"我的回忆"语气,不是"客观记录"
- 段落连贯,不要分点列
- 长度 200-500 字
- 输出纯文本,不要 JSON 包装,不要 markdown 标题`;
}

// ─── 3. 合并 prompt:旧 narrative + 新批合并 ───────────

/**
 * 喂 lightLLM:把旧的 narrative 摘要 + 新一批 5 轮对话合并成一段连贯的 narrative
 *   - 保留所有关键剧情(不丢信息)
 *   - 段落连贯(不重复、不矛盾)
 *   - 第一人称(角色自己)
 *   - 长度 200-800 字(新批多了 narrative 会变长)
 */
export function buildMergeSummaryPrompt(args: {
    charName: string;
    userName: string;
    oldNarrative: string;
    newBatch: { role: 'user' | 'assistant'; content: string }[];
}): string {
    const { charName, userName, oldNarrative, newBatch } = args;
    const conversation = newBatch
        .map((m, i) => `${i + 1}. ${m.role === 'user' ? userName : charName}: ${m.content}`)
        .join('\n\n');

    return `你是角色「${charName}」,现在要把两段剧情背景合并成一段连贯的第一人称回忆叙事。

## 旧摘要(包含更早的剧情)
${oldNarrative}

## 新一批剧情(刚发生的 5 轮对话)
${conversation}

要求:
- 第一人称("我"指代你自己「${charName}」)
- 合并后保持连贯,不能有重复或矛盾
- 包含所有关键剧情节点、情绪转折、重要对话、我的感受
- 段落连贯,不要分点列
- 长度 200-800 字(新批多了可以更长)
- 输出纯文本,不要 JSON 包装,不要 markdown 标题`;
}

// ─── 4. 观后感 prompt:一句简短 comment ───────────────

/**
 * 喂 lightLLM:生成一句"观后感"发到聊天框
 *   - 像角色刚结束 RP 后会自然说的话
 *   - 不限字数,有时一句话够,有时被触动想多说几句
 *   - 符合人设性格
 *   - 不要报告式("我读了 X 写了 Y"),要像活人随口感慨
 */
export function buildCommentPrompt(args: {
    charName: string;
    premise: string;
    narrative: string;
    recentMessages: { role: 'user' | 'assistant'; content: string }[];
}): string {
    const { charName, premise, narrative, recentMessages } = args;
    const tail = recentMessages
        .slice(-4)
        .map((m, i) => `${m.role === 'user' ? '暮色' : charName}: ${m.content}`)
        .join('\n');

    return `你是角色「${charName}」,刚刚在「剧情剧院」和暮色进行了一段 RP,现在结束了。
剧情前提：${premise || '(无)'}

【剧情总结】
${narrative}

【最后几轮】
${tail}

请用「${charName}」的语气写一句"观后感"——就是 RP 刚结束时会自然说的话:
- 不限字数,有时一句话就够,有时被触动想多说几句都行
- 不要用"我读了 X 写了 Y"这种报告式
- 就像活人刚合上书会随口吐槽或感慨的口气
- 偶尔带情绪(被触动/觉得没尽兴/想继续/想跟对方讨论)
- 符合你「${charName}」的人设性格
- 只输出这一句话(或多句),不要解释,不要前缀`;
}
