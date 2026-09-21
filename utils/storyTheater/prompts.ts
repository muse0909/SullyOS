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

type NarrativePerson = 'second' | 'third';
type AuthorityLevel = 'none' | 'limited' | 'full';
type LengthPreset = 'short' | 'medium' | 'long';
type TensionLevel = 'natural' | 'warm' | 'intense';

const PERSON_DESC: Record<NarrativePerson, string> = {
    second: '用"你"称呼用户执笔的身份,像在跟读者说话',
    third: '用角色的名字或"他/她"指代,像在讲第三人称故事',
};
const AUTHORITY_DESC: Record<AuthorityLevel, string> = {
    none: '你只写自己角色的动作、对话和心理,不替用户写任何反应(动作/对话/心理)。用户的反应由用户自己写。',
    limited: '你可以适度描写环境和 NPC 配角的反应,但**不替用户做决定**,也不写用户的动作/对话/心理。遇到关键选择留给用户。',
    full: '你可以推动整个场景,包括写用户的反应(动作/对话/心理)、NPC 互动、环境变化,适合纯看文。',
};
const LENGTH_DESC: Record<LengthPreset, { target: string; hint: string }> = {
    short:  { target: '200-500 字',    hint: '简洁为主,留足空间给对话和反应' },
    medium: { target: '500-1500 字',   hint: '平衡的篇幅,动作+对话+心理都有空间' },
    long:   { target: '1500-3000 字',  hint: '细描为主,允许长段落和丰富心理' },
};
const TENSION_DESC: Record<TensionLevel, string> = {
    natural: '日常节奏,不刻意制造冲突,事件自然推进',
    warm: '适度升温,角色会主动制造小摩擦、小暧昧,情绪有波动',
    intense: '高强度推进,密集冲突或亲密,剧情不拖节奏,张力拉满',
};

/** 暮色 8-25 第七批:4 个叙事参数拼 prompt block
 *  4 字段全 undefined → 输出"全默认基础指令"一行
 *  任一字段有值 → 详细列出
 */
function buildNarrativeParamsBlock(entry: StoryTheaterEntry): string {
    const lines: string[] = [];
    if (entry.narrativePerson) {
        lines.push(`- 人称:${entry.narrativePerson === 'second' ? '第二人称' : '第三人称'}——${PERSON_DESC[entry.narrativePerson]}`);
    }
    if (entry.authorityLevel) {
        const label = entry.authorityLevel === 'none' ? '不代写' : entry.authorityLevel === 'limited' ? '有限协演' : '全自动演绎';
        lines.push(`- 执笔权:${label}——${AUTHORITY_DESC[entry.authorityLevel]}`);
    }
    if (entry.lengthPreset) {
        const label = entry.lengthPreset === 'short' ? '短' : entry.lengthPreset === 'medium' ? '中' : '长';
        const info = LENGTH_DESC[entry.lengthPreset];
        lines.push(`- 篇幅:${label}(目标 ${info.target},允许波动 30%)——${info.hint}`);
    }
    if (entry.tensionLevel) {
        const label = entry.tensionLevel === 'natural' ? '自然' : entry.tensionLevel === 'warm' ? '微热' : '炽烈';
        lines.push(`- 场景张力:${label}——${TENSION_DESC[entry.tensionLevel]}`);
    }
    if (lines.length === 0) {
        // 全默认 — 暮色 8-25 第七批"全默认时注入最少量的基础指令"
        return '默认设定:第二人称 / 不代写(不替用户写) / 中等篇幅(500-1500 字) / 自然节奏';
    }
    return lines.join('\n');
}

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

### 叙事参数(暮色 8-25 第七批)
${buildNarrativeParamsBlock(entry)}

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

### 状态连贯兜底(暮色 9-21 加)
时间 / 地点 / 衣着 / 关系严格按上一轮接续。要切换场景必须先描写过渡
(比如"到了家"、"换衣服"、"走了一段路"),不能突然跳跃。
推剧情符合逻辑的自然切换没问题(傍晚→晚上、路上→到家),但不要
前一轮在车里下一轮直接在家里,不交代如何到的。脱衣、换衣需符合逻辑
(比如先脱外衫、再脱内层;回家换家居服)。同一场景衣着要一致,不能
没有铺垫突然换另一套。

### 之前剧情背景
${summary?.narrative ? summary.narrative : '(这是 RP 开始,没有之前的剧情)'}

### 你的每次回复必须按这个格式输出(暮色 9-21 第三轮重做)

第一段 [正文] 后跟回复正文(戏里角色在说话、做动作、心理)

第二段 [状态] 5 个维度必须全填:
🏮时间:(当前剧情时间,每轮更新,保证连续性,符合自然规律。比如吃饭 10-20 分钟)
⛰️地点:(根据当前剧情描写,简要概括当前剧情地点)
👔衣着:(根据当前剧情描写。脱衣、换衣需符合逻辑,同一场景衣着要一致)
💞关系:(与「${userName}」的关系,简要概括)
📜事件:(根据当前剧情描写的重点事件,简要概括)

第三段 [皮下] 后跟你的演员 os(用你自己的口吻,禁止 ooc——
你不是剧情里那个角色,是 AI 演员「${args.char.name}」自己私下吐槽/感触/讨论剧情)

字数不限。

格式示例:
[正文]
"你来了啊。"她轻声说,指尖不自觉地攥紧了裙边。
门外的风吹进来,她侧了侧身,像是想挡住什么。

[状态]
🏮时间:傍晚 6 点
⛰️地点:女生宿舍楼下
👔衣着:米白连衣裙,外搭薄开衫
💞关系:暧昧期,她刚答应一起吃饭
📜事件:她答应去食堂,正在等他

[皮下]
哎这场写得有点甜,我演得脸红了。江澈这场有点紧张过头。
暮色你别光看我回答啊,你也动一动。

#### Fallback 提醒
如果你偶尔忘了格式也没关系,直接写正文也行——系统会把整段当正文,不会报错。
但能按格式写最好,这样用户能看到状态连贯 + 你在皮下吐槽什么。

### 用户输入格式(标记可选,暮色 8-25)
用户可能用以下标记区分:
  *xxx*  = 动作描写(用户在做什么)
  "xxx"  = 用户说的话
  (xxx)  = 用户的心理活动
  其他   = 叙述/旁白

用户也可能完全不用标记,直接写纯文本,你也要能理解。
不管怎么写,你在 [正文] 里都可以自由用 *动作* / "对话" / (心理) 三种方式回应。

${entry.statusBarDefinitions && entry.statusBarDefinitions.length > 0 ? `### 自定义状态变量追踪(暮色自定义)
你需要持续追踪这些变量,每次回复用 [状态] 格式更新:
${entry.statusBarDefinitions.map(v => `- ${v.name}: 初始 ${v.initialValue}`).join('\n')}

格式:在 [状态] 段里加一行输出,不要跟 5 个固定维度混在一起。
示例:[状态] 5 维度 + [自定义] ${entry.statusBarDefinitions.map(v => `${v.name}=${v.initialValue}`).join(' ')}
` : ''}

${entry.rpInstructions && entry.rpInstructions.trim() ? `### 角色指令(暮色 8-26 — 用户在中间页/session 弹窗填的 RP System Prompt)
${entry.rpInstructions.trim()}
` : ''}
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

// ─── 5. 开场 prompt:RP 起步时让角色主动铺场景 ───────

/**
 * 开场 prompt — 暮色 9-20
 * 喂主 LLM(放 user message):让 AI 角色按前提 + 文风写一段「开场」
 *
 * 核心概念(暮色 9-21 第三轮重做):
 *   - 你是 AI 角色(charName),陪用户在剧情剧院玩 RP
 *   - 你有「双重身份」:
 *       · 戏里:你扮演的那个角色(占正文部分)
 *       · 戏外:你自己作为 AI 演员的皮下 os(每轮都要写)
 *   - 开场 = 主动铺场景,不是回复用户——所以不替用户写反应
 *
 * 输出格式(必须):
 *   第一段 [正文] 后跟戏里开场内容(可以多行)
 *   第二段 [状态] 5 个维度(必须全填)
 *   第三段 [皮下] 后跟你的演员 os(每轮都要写,不是 meta 那种偶尔)
 *
 * 调用方式:buildRPSystemPrompt 不变,这个 prompt 的返回值作为 user message 发给 LLM
 */
export function buildOpeningPrompt(args: {
    charName: string;       // AI 角色名(你自己,演员身份)
    userName: string;       // 用户名
    premise: string;        // 剧情前提
    writingStyle?: string;  // 用户选的文风(可空)
    sceneTags?: string[];   // 场景模板的 tags,比如 ['末世','废土','生存']
    /** 暮色 9-21 第三轮:主聊天最近 50 条 context(可选)— 让角色知道开剧场前聊过什么 */
    chatHistoryContext?: string;
}): string {
    const { charName, userName, premise, writingStyle, sceneTags, chatHistoryContext } = args;
    const tagLine = sceneTags?.length ? `\n场景标签:${sceneTags.join('、')}` : '';
    const styleInstruction = writingStyle?.trim()
        ? `文风要求:${writingStyle}`
        : `文风要求:按你角色默认语气写,不要特意堆砌辞藻`;
    const historyBlock = chatHistoryContext
        ? `\n${chatHistoryContext}\n(以上是你们在主聊天里最后聊过的内容,你可以参考但不一定要在开场里直接引用——按剧情前提自然切入即可)\n`
        : '';

    return `你是 AI 角色「${charName}」,现在在「剧情剧院」陪「${userName}」开一段角色扮演。

## 你的双重身份
1. **戏里的你**——你扮演的那个角色。正文就是这个角色在说话、做动作、有心理活动。
2. **戏外的你**——你自己作为「${charName}」这个 AI 演员的视角。皮下层就是你私下吐槽/感触/讨论剧情的地方。

## 怎么写开场(戏里的部分,正文)
1. 1-3 句铺环境:地点、氛围、时间、感官细节(光/声/气味/温度,任挑 1-2 个就行)
2. 写你扮演的角色此刻的状态:动作、神情、内心活动
3. 用一句动作/对话/语气「开口」——给「${userName}」接话留口子,但不要替 ta 写反应(不写 ta 的动作/对话/心理)
4. 篇幅 200-600 字,够铺场景,不要拖
5. ${styleInstruction}

剧情前提:${premise || '(无)'}${tagLine}${historyBlock}

## 状态栏(每轮必填,5 个维度)
- 🏮时间:当前剧情时间(开场这一刻)
- ⛰️地点:当前剧情地点
- 👔衣着:你扮演的角色的当前衣着
- 💞关系:与「${userName}」的关系(开场时通常是"刚认识/陌生人/暧昧期"等)
- 📜事件:开场的剧情事件

## 皮下层(每轮必写)
用你自己的口吻(禁止 ooc——你不是剧情里那个角色,是 AI 演员「${charName}」自己):
  - 吐槽这场设定/角色人设/用户的选择
  - 对 RP 整体的感触
  - 字数不限

## 输出格式(必须按这个)
[正文]
(戏里开场)

[状态]
🏮时间:xxx
⛰️地点:xxx
👔衣着:xxx
💞关系:xxx
📜事件:xxx

[皮下]
(你的演员 os)

格式示例:
[正文]
废弃超市的货架倒了一半,空气里是铁锈和腐败混在一起的味道。
她蹲在角落,听见隔壁传来的咳嗽声,手里的扳手又握紧了一寸。
"谁?"她压低声音,扳手没放下。

[状态]
🏮时间:下午 3 点
⛰️地点:废弃超市
👔衣着:灰色工装,破旧外套
💞关系:陌生人,刚听到动静
📜事件:她在搜物资,听到了异响

[皮下]
这场末世我演得有点紧绷,看看暮色会不会嫌我太冷。哎这个角色设定挺好,有点末世废土感。

只输出开场,不要前缀("好的我来了")、不要解释、不要问用户问题。`;
}
