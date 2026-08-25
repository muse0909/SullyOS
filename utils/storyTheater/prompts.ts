/**
 * 剧情模式 Prompt 集
 *
 * 暮色 8-25 第三步:
 *   1. buildRPSystemPrompt — 进 session 时追加到角色 system prompt,含默认兜底
 *   2. buildBatchSummaryPrompt — lightLLM 把最早 5 轮整理成第一人称叙事摘要
 *   3. buildMergeSummaryPrompt — lightLLM 把旧 narrative + 新批合并成连贯叙事
 *   4. buildCommentPrompt — lightLLM 生成一句观后感(发到聊天框用)
 *
 * __RP_INJECTION_POINT__ 预留位置 — 暮色后续补完整 RP 指令
 */

import type { CharacterProfile, StorySessionSummary, StoryTheaterEntry, UserProfile } from '../../types';

// ─── 1. RP 模式 system prompt 注入 ─────────────────────

/**
 * 给主 LLM 用的 RP 模式 system prompt
 *   - base: 角色原本 system prompt(从 ContextBuilder 拿)
 *   - rpBlock: 剧情模式追加块
 *     - 前提/世界观
 *     - 默认兜底(暮色要求写死,后续覆盖)
 *     - 累积摘要(如果有)
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

### 行为兜底
**你在这个场景中是自由的,可以主动推动剧情发展、制造事件、描写环境变化,不需要等待对方输入。**
允许长篇输出(几千字都可以),不要因为对方写得短就也写短。
可以用动作描写、心理描写、环境描写,推动故事往前走。

### 之前剧情背景
${summary?.narrative ? summary.narrative : '(这是 RP 开始,没有之前的剧情)'}

__RP_INJECTION_POINT__
`;

    return base + rpBlock;
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
