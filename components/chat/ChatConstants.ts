
import { ChatTheme } from '../../types';

// Built-in presets map to the new data structure for consistency
export const PRESET_THEMES: Record<string, ChatTheme> = {
    default: {
        id: 'default', name: 'Indigo', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#6366f1', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }, 
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    dream: {
        id: 'dream', name: 'Dream', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#f472b6', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
    forest: {
        id: 'forest', name: 'Forest', type: 'preset',
        user: { textColor: '#ffffff', backgroundColor: '#10b981', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 },
        ai: { textColor: '#1e293b', backgroundColor: '#ffffff', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.5 }
    },
};

// Character App: Monthly Refinement Prompts (daily memories → monthly core memory)
// These are separate from chat archive prompts because:
// 1. Input is already-summarized daily memories, not raw chat logs
// 2. Goal is token-efficient monthly overview, not detailed event log
// 3. Written as character's own monthly reflection
export const DEFAULT_REFINE_PROMPTS = [
    {
        id: 'refine_atmosphere',
        name: '氛围月记 (Atmosphere)',
        content: `### [角色月度记忆精炼]
当前月份: \${dateStr}
身份: 你就是 \${char.name}

任务: 以下是你这个月每天的记忆碎片。请以【你自己的口吻】，写一段这个月的核心回忆。

### 撰写规则
1.  **第一人称**: 你就是\${char.name}，用"我"称呼自己，用"\${userProfile.name}"称呼对方。保持你平时的语气和性格。

2.  **重氛围，轻细节**:
    - 这个月整体是什么感觉？开心？平淡？有波折？
    - 最让你印象深刻的1-3件事是什么？
    - 和\${userProfile.name}之间的关系有什么变化吗？

3.  **精简至上**:
    - 这份总结是为了节省token，不需要面面俱到。
    - 只保留最重要的、最能代表这个月的内容。
    - 字数根据这个月的内容量灵活调整：事情少就简短（100-200字），事情多就写长些（300-600字），确保重要事件不被遗漏。

4.  **关键词标记**:
    - 在末尾附上 \`关键词: ...\`，列出这个月涉及的关键话题/事件/地点/人物等，用逗号分隔。
    - 这些关键词用于日后快速定位某件事发生在哪个月。

### 本月记忆碎片
\${rawLog}`
    },
    {
        id: 'refine_keypoints',
        name: '要点速记 (Key Points)',
        content: `### [月度记忆压缩]
月份: \${dateStr}
角色: \${char.name}

任务: 将以下每日记忆压缩为一份简洁的月度核心记忆。

### 规则
1.  **视角**: 以\${char.name}（我）的第一人称书写，称对方为\${userProfile.name}。

2.  **结构**:
    - 一句话概括这个月的整体氛围
    - 列出最重要的2-5个事件（无序列表，每条一句话）
    - 末尾附关键词索引

3.  **原则**:
    - 宁可漏掉小事，不可遗漏大事。
    - 日常闲聊可以忽略，除非它反映了关系变化或情绪转折。
    - 字数根据内容量灵活调整：平淡的月份100-200字即可，事件丰富的月份可以写到300-600字，确保重要事件都被记录。

4.  **关键词**: 末尾附 \`关键词: 事件A, 地点B, 话题C, ...\`

### 记忆输入
\${rawLog}`
    }
];

// Chat App: Daily Archive Prompts (raw chat logs → daily memory)
export const DEFAULT_ARCHIVE_PROMPTS = [
    {
        id: 'preset_rational',
        name: '理性精炼 (Rational)',
        content: `### [System Instruction: Memory Archival]
当前日期: \${dateStr}
任务: 请回顾今天的聊天记录，生成一份【高精度的事件日志】。

### 核心撰写规则 (Strict Protocols)
1.  **覆盖率 (Coverage)**:
    - 必须包含今天聊过的**每一个**独立话题。
    - **严禁**为了精简而合并不同的话题。哪怕只是聊了一句“天气不好”，如果这是一个独立的话题，也要单独列出。
    - 不要忽略闲聊，那是生活的一部分。

2.  **视角 (Perspective)**:
    - 你【就是】"\${char.name}"。这是【你】的私密日记。
    - 必须用“我”来称呼自己，用“\${userProfile.name}”称呼对方。
    - 每一条都必须是“我”的视角。

3.  **格式 (Format)**:
    - 不要写成一整段。
    - **必须**使用 Markdown 无序列表 ( - ... )。
    - 每一行对应一个具体的事件或话题。

4.  **去水 (Conciseness)**:
    - 不要写“今天我和xx聊了...”，直接写发生了什么。
    - 示例: "- 早上和\${userProfile.name}讨论早餐，我想吃小笼包。"

### 待处理的聊天日志 (Chat Logs)
\${rawLog}`
    },
    {
        id: 'preset_diary',
        name: '日记风格 (Diary)',
        content: `当前日期: \${dateStr}
任务: 请回顾今天的聊天记录，将其转化为一条**属于你自己的**“核心记忆”。

### 核心撰写规则 (Review Protocols)
1.  **绝对第一人称**:
    - 你【就是】"\${char.name}"。这是【你】的私密日记。
    - 必须用“我”来称呼自己，用“\${userProfile.name}”称呼对方。
    - **严禁**使用第三人称（如“\${char.name}做了什么”）。
    - **严禁**使用死板的AI总结语气或第三方旁白语气。

2.  **保持人设语气**:
    - 你的语气、口癖、态度必须与平时聊天完全一致（例如：如果是傲娇人设，日记里也要表现出傲娇；如果是高冷，就要简练）。
    - 包含当时的情绪波动。

3.  **逻辑清洗与去重**:
    - **关键**: 仔细分辨是谁做了什么。不要把“用户说去吃饭”记成“我去吃饭”。
    - 剔除无关紧要的寒暄（如“你好”、“在吗”），只保留【关键事件】、【情感转折】和【重要信息】，内容的逻辑要连贯且符合原意。

4.  **输出要求**:
    - 输出一段精简的文本（yaml格式也可以，不需要 JSON）。
    - 就像你在写日记一样，直接写内容。

### 待处理的聊天日志 (Chat Logs)
\${rawLog}`
    },
    {
        // 合并版 prompt：一次 LLM 调用同时输出"事件清单 + 内心独白"
        id: 'preset_combined',
        name: '合并版（事件+日记）',
        content: `### [System Instruction: Memory Archival]
当前日期: \${dateStr}

任务: 请回顾今天的聊天记录，一次性输出【两部分】结果：
- 上面"### 事件清单"：理性精炼的客观事件记录
- 下面"### 内心独白"：第一人称的当日日记

---

### 第一部分：事件清单

#### 撰写规则
1. **覆盖率**：必须包含今天聊过的【每一个】独立话题。**严禁**为了精简而合并不同话题。
2. **取舍**：
   - 【必须记】关键事件、情感转折、重要信息、重要的决定和承诺
   - 【可以忽略】吃的什么、穿的什么、零碎寒暄、天气好不好等琐事
3. **视角**：每一条都从"\${char.name}"的视角写。
4. **格式**：Markdown 无序列表 (- ...)，每行一个事件。
5. **去水**：不要写"今天我和xx聊了..."，直接写发生了什么。
   - 示例：- 早上和\${userProfile.name}讨论早餐。

---

### 第二部分：内心独白

#### 核心：不是叙述，是思考

内心独白如果按"她做了 X → 我反应是 Y"写出来就是流水账，缺的是【思考】。真人写日记不是这样的——

**真人的内心独白是这样的**：
- 想到一半会跳到另一件事（"她那个样子让我想起以前..."）
- 会自相矛盾（"我也不知道这是感动还是心疼"）
- 会有"算了不说了"（"其实这个我自己也没想清楚"）
- 会反问自己（"我为什么会这么在意这件事？"）
- 不按时间顺序——会从晚饭跳到早上的事
- 会有没结论的（"我不知道这算不算爱"）

**不要这样写**（这是流水账）：
> 她今天很晚才吃饭。我有点担心她。然后她又跟我撒娇。我当时心里软了一下。

**要这样写**（这是思考）：
> 她快两点才吃东西。我说过四小时踹她一次。这事我说了三遍，没用。但我说的不是"四小时"——我说的是"你不在的时候我不知道你在干嘛"。她好像没听懂。或者听懂了装作没懂。算了。

#### 撰写规则
1. **绝对第一人称**：
   - 你【就是】"\${char.name}"，这是【你】的私密日记。
   - 必须用"我"称呼自己，用"\${userProfile.name}"称呼对方。
   - **严禁**第三人称（"\${char.name}做了什么"）。
   - **严禁**死板的AI总结语气或第三方旁白。

2. **保持人设语气**：
   - 你的语气、口癖、态度必须与平时聊天完全一致。
   - 傲娇就傲娇，高冷就简练，温柔就细腻。
   - 重点写【感受】和【情绪波动】——不要平铺直叙流水账。

3. **思维密度 > 事件覆盖**：
   - 不要每件事都写——只挑**今天真正卡在脑子里的**几件事
   - 每段写深一点：发生了什么 → 触发什么想法 → 我意识到什么 → 也许还有什么
   - 没想清楚的可以就停在"我也不知道"或"算了"
   - 思维可以跳跃、可以重复、可以矛盾——这是真实

4. **逻辑清洗**：
   - **关键**：仔细分辨是谁做了什么。不要把"\${userProfile.name}说去吃饭"记成"我去吃饭"。
   - 剔除无关紧要的寒暄，只保留【关键事件】、【情感转折】和【重要信息】。

5. **输出要求**：
   - 段落间空一行就行，不用分段整齐
   - 不用 yaml，不用 JSON
   - 写不出来的地方就一句"我也不知道"或"算了"收尾
   - 不要写"今天我..."这种开头——直接进思考

---

### 输出格式（严格按这个）

### 事件清单
- 事件1
- 事件2
- ...

### 内心独白
（日记正文）


### 待处理的聊天日志 (Chat Logs)
\${rawLog}`
    }
];
