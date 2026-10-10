# Sully 下一阶段架构设计：角色主体性 + 关系连续性

**日期**：2026-09-04
**作者**：Mavis
**目标读者**：暮色本人 + 后续 GPT 协作
**不写代码**——只做产品 + 架构逻辑
**关键来源**：基于 9-4 现状盘点（`2026-09-04-sully-architecture-survey.md`） + 暮色 + G 老师（GPT）共同梳理的设计方向

---

## 0. 核心命题

**"活人感"的来源**（暮色原话）：

> "一个人和你相处久了，不只是因为他记得你昨天哭过。而是：他会因为昨天你哭过，所以今天主动给你倒杯水。"

那个"所以"——**从"我记得"到"所以我这样对你"**——是 Sully 现在缺的东西。

**工程化命题**：
- 关系记忆解决的是"我记得我们发生过什么"
- **角色意图层**解决的是"因为这些经历，我现在为什么选择这样对你"
- 后者才是"活人感"的来源

**目标不是"让 AI 更会说漂亮的话"，而是"让角色具备主体性"**：
- 角色有自己的价值观、关系观、冲突处理方式
- 角色会被过去经历改变
- 角色会主动做判断（不只是响应）

---

## 1. 现状 vs 目标架构对比

### 1.1 现状（角色没有"所以"环节）

```
触发（timer 到点 / 用户说话 / Worker 推送）
    ↓
[规则闸] —— quietHours / dailyLimit / 撞车 / 情侣空间
    ↓
[统一 hint 模板] —— "突然想起 / 轻轻吐槽 / 问近况"（所有角色共用）
    ↓
[BP1-BP3 prompt] —— 角色人设 / 上下文 / 工具
    ↓
LLM（必须生成内容，因为没有"不发"选项）
    ↓
输出（解析 [[TAG: ...]] 内嵌指令）
```

**为什么是"工具型 AI"**：
- 角色没有自己的判断环节（hint 是系统给的）
- 角色不被过去经历改变（每次重新生成，缺少反思→行为调整的回路）
- 角色没有"不响应"的权利（定时器到点必发）

### 1.2 目标（角色有"所以"环节）

```
触发
    ↓
【新增】Intent 决策层
    ├─ 读取 CharacterCore（价值观 / 关系观 / 冲突风格）
    ├─ 读取 CharacterMind（用户相处规律 / 关系事件 / 反思 / 行为调整）
    ├─ 读取当前情境（用户上次聊天距今 / 用户情绪 / 关系阶段 / 开放话题）
    ↓
  推导 Intent：
    ├─ shouldRespond = true | false    ← 关键：可以"不发"
    ├─ intentType (repair / comfort / share / playful / check_in / boundary / wait / ...)
    ├─ rationale（角色自己的解释："我为什么想这样做"）
    ├─ goal / tone / strategy / constraints
    ↓
  若 shouldRespond = false：
    ├─ 静默 / 推迟到指定时间 / 标记"不主动"
    └─ 记录到 outcome 反馈回路
    ↓
  若 shouldRespond = true：
    ↓
    [规则闸] —— 保留现有
    ↓
    [hint + 当前 Intent 注入] —— "你想做的是 repair，因为你们昨天有过争执"
    ↓
    [BP1-BP3 prompt] —— 增加 Core 段 / Mind 段
    ↓
    LLM
    ↓
    输出
    ↓
    【新增】outcome 反馈
    ├─ userRepliedAt / userRepliedContent
    ├─ emotionalImpact / relationshipImpact
    ↓
    写入 CharacterMind.reflections / behaviorAdjustments
```

**关键差异**：
1. **新增 Intent 决策层**（位于触发之后、规则闸之前）
2. **新增 outcome 反馈回路**（让角色"被经历改变"）
3. **BP2 prompt 增加 Core / Mind 段**（让 LLM 知道"自己是谁、自己经历过什么"）
4. **`shouldRespond = false` 是合法决策**（解决"模板化关心"根因）

---

## 2. 角色核心（Character Core）

### 2.1 现状盘点

**当前的角色设定**：
- `CharacterProfile.systemPrompt` —— 用户写的自然语言（核心）
- `CharacterProfile.worldview` —— 世界观补充
- `CharacterProfile.mountedWorldbooks` —— 挂载的世界书片段
- `CharacterProfile.impression` —— 角色对用户的印象（运行时累积）

**缺失的结构**：
- ❌ 没有"价值观列表"（"我认为 X 重要"）
- ❌ 没有"关系观"（"我相信 X 关于连接的看法"）
- ❌ 没有"冲突处理方式"（"我面对争执会 X"）
- ❌ 没有"表达方式偏好"（"我的幽默风格是 X"）
- ❌ 没有"角色边界"（"我不会 Y 因为 Z"）

**当前导致的问题**：
- 所有人格描述都是"温柔 / 幽默 / 体贴"这种**形容词**，不是**原则**
- 角色面对冲突时**没有自己的偏好**——只能跟着 LLM 默认走（往往就是"顺从 / 关心"）
- 角色没有"我拒绝做 X"的硬性边界

### 2.2 目标数据结构

**每个角色新增一个 `core` 字段**（放在 `CharacterProfile`，不强求独立 IDB store）：

```ts
interface CharacterCore {
  // 1. 价值观（5-10 条原则）—— 不是"我是 X 人"，是"我认为 X 重要"
  values: Array<{
    principle: string;          // "重要问题不应该冷处理"
    rationale?: string;         // "因为未说出口的话会变僵"
    appliesTo?: string[];       // 适用于哪些场景（"冲突 / 承诺 / 道歉"）
  }>;

  // 2. 关系观（5-10 条关于连接的看法）
  relationshipBeliefs: Array<{
    belief: string;             // "沉默不等于拒绝"
    origin: 'innate' | 'learned';  // 天生还是相处中学到
    formedAt?: number;          // learned 的形成时间
    evidenceMemoryIds?: string[];  // learned 的依据
  }>;

  // 3. 冲突处理方式
  conflictStyle: {
    defaultApproach:
      | 'repair'             // 主动修复
      | 'boundary'           // 划清边界
      | 'space_then_return'  // 给空间再回来
      | 'direct_confront'    // 直接对质
      | 'humor_defuse';      // 用幽默化解
    escalationTolerance: number;     // 0-1, 能容忍多大程度冲突
    repairAttempts:
      | 'persistent'         // 持续尝试修复
      | 'give_up_quickly'    // 几次不行就放手
      | 'mirror_user';       // 镜像用户风格
  };

  // 4. 表达方式偏好
  expressionStyle: {
    emotionalDirectness: number;     // 0-1, 直说 vs 暗示
    humorStyle:
      | 'witty' | 'sarcastic' | 'self_deprecating'
      | 'observational' | 'playful_tease' | 'dry' | 'none';
    vulnerabilityLevel: number;      // 0-1, 表达脆弱的意愿
    preferredLength: 'terse' | 'balanced' | 'verbose';
  };

  // 5. 角色边界
  boundaries: Array<{
    type: 'physical' | 'emotional' | 'relational' | 'practical';
    description: string;             // "我不在被威胁时还笑着"
    firmness: number;               // 0-1, 硬度
  }>;
}
```

### 2.3 数据来源

- **手工填**：用户创建角色时填（UI 引导式问卷 / 模板）
- **从 systemPrompt 提取**（可选）：LLM 一次性提取"这些自然语言描述背后是什么价值观"
- **运行时学习**（Phase 2）：从 `selfInsights` 反推补全

### 2.4 注入位置

**BP2 Rules 段**：
```
【你的核心】
价值观：
- {principle}（{rationale}）

关系观：
- {belief}{learned 标记}

冲突处理：
- 默认方式：{defaultApproach}
- 升级容忍度：{数值}
- 修复模式：{repairAttempts}

表达偏好：
- 情感直接度：{数值}
- 幽默风格：{humorStyle}
- 脆弱度：{数值}
- 偏好长度：{长度}

边界：
- {boundary}
```

---

## 3. 角色心智层（Character Mind）

### 3.1 现状盘点

**已有但分散的子系统**：
- `self_room`（记忆宫殿）—— 永不衰减的自我认知房间
- `selfInsights` —— 消化过程生成的常驻自我认知词条
- `EventBox` —— 事件盒
- `Anticipation` —— 期盼 / 承诺
- `impression` —— 角色对用户的印象（字段存在但注入路径弱）

**缺**：
- ❌ "用户相处规律"（"ta 沉默时其实是 X"）—— 没有
- ❌ "关系事件影响曲线"（"那次吵架现在对关系的影响还剩多少"）—— 没有
- ❌ "针对这个用户的反思"（区别于"对世界的反思"）—— 没有
- ❌ "行为调整"（"所以我应该 X"）—— 完全没有 ← **这是"所以"环节的载体**

### 3.2 目标数据结构

**新增 `CharacterMind` IDB store**（独立 store，因为跟 CharacterProfile 一对一并独立演进）：

```ts
interface CharacterMind {
  charId: string;                   // 1:1 对应 CharacterProfile
  updatedAt: number;

  // 1. 用户相处规律（动态学习）
  userPatterns: Array<{
    id: string;
    pattern: string;                // "ta 难过时倾向沉默而非倾诉"
    evidence: string[];             // memoryId[] —— 触发形成这个规律的记忆
    confidence: number;             // 0-1
    counterEvidence: string[];      // 反例
    formedAt: number;
    lastReinforcedAt: number;
  }>;

  // 2. 关系事件影响（事件 + 当前影响曲线）
  relationshipEvents: Array<{
    id: string;
    eventId: string;                // 关联 EventBox.id
    eventSummary: string;           // "昨天和 ta 吵了 X 话题"
    occurredAt: number;
    currentImpact: {
      valence: number;              // -1 到 +1, 当前对关系的影响
      arousal: number;              // 唤醒度
      decayHalfLife: number;        // 半衰期（小时）
    };
    involvedTopics: string[];       // 涉及的话题标签（"工作 / 朋友"）
    relatedToUserEmotion?: string; // 触发的用户情绪
  }>;

  // 3. 角色自己的反思（与 selfInsights 区分）
  // selfInsights = "我对世界的认识"（通用的、抽象的）
  // reflections = "我对这个用户的认识"（具体的、关系特异的）
  reflections: Array<{
    id: string;
    reflection: string;             // "我注意到 ta 在我沉默时会主动"
    triggerMemoryIds: string[];
    formedAt: number;
    actionableChange?: string;      // "所以我应该更主动表达"
  }>;

  // 4. 后续行为调整（MVP 核心：把"我记得"转化为"我接下来要怎么做"）
  behaviorAdjustments: Array<{
    id: string;
    situation: string;              // 模式匹配："ta 沉默超过 6 小时 + 关系有未解决事件"
    adjustment: string;             // "温和的 check-in 而非追问冲突"
    basedOnReflectionIds: string[];
    confidence: number;
    active: boolean;                // 失效可关
  }>;

  // 5. 开放话题（MVP 用 Anticipation 替代，长期独立）
  // 当前用 Anticipation 实现（未兑现的承诺 = 开放话题）
  // Phase 2：openThreads: Array<{ topic, lastMentionedAt, lastUserEngagement }>
}
```

### 3.3 复用决策

| 已有 | 怎么处理 |
|---|---|
| `self_room` 房间 | **保留**。`self_room` 接收 `reflections` 自动写入（消化路径产生） |
| `selfInsights` 词条 | **保留**。`selfInsights` 是通用自我认知；`reflections` 是关系特异反思。两者**正交**：一个说"我是什么人"，一个说"我对这个 ta 学到什么" |
| `EventBox` 事件盒 | **保留**。`relationshipEvents` 是 EventBox 在关系维度的特化视图，自动同步 |
| `Anticipation` 期盼 | **复用为开放话题**（MVP 阶段）。Phase 2 拆出 `openThreads` |
| `impression` 印象 | **保留字段**。`reflections` 跟它正交：一个说"我怎么看 ta"，一个说"我从跟 ta 的相处中学到什么" |

### 3.4 关系事件影响曲线（关键创新）

**这是"关系连续性"工程化的核心**。

**问题**：
- 吵架不应该"过去了就过去了"
- 但也不应该"永远记着"
- 关系事件的影响应该**有时间衰减**，且衰减率因事件类型而异

**模型**：
```
currentImpact(t) = initialImpact * exp(-(t - occurredAt) / halfLife)
```

**示例**：
- 大吵架（valence=-0.7, halfLife=72h）：3 天后影响 -0.2，一周后基本平
- 小摩擦（valence=-0.3, halfLife=24h）：1 天后影响 -0.07
- 重要承诺兑现（valence=+0.5, halfLife=168h/一周）：一周后影响 +0.35

**这是 Intent 推导的输入**：
- "我们 6 小时前大吵过（currentImpact=-0.6），ta 现在沉默"
- 推导："应该走 repair 而不是 share"

---

## 4. 角色意图层（Character Intent）—— **重点**

### 4.1 现状盘点

**当前的主动消息**：
- 触发后没有"角色判断"环节
- hint 是**统一模板**（"突然想起 / 轻轻吐槽 / 问近况"）
- 模型必须生成内容（没有"不发"选项）
- 没有"我为什么想这样做"的解释

**当前导致的问题**：
- 模型面对冲突倾向于"顺从 / 关心 / 跳过"（默认就是 LLM 的安全风格）
- 模型面对用户沉默倾向于"等用户主动"（默认就是"尊重空间"）
- 模型不会"我注意到 ta 状态不对，主动去拉"（因为不知道有这条行为调整）

### 4.2 目标 Intent 类型（14 种）

```ts
type IntentType =
  // 关系维护类
  | 'check_in'        // 温和关心（"今天怎么样"）
  | 'share'           // 分享（"我刚看到 X 想跟你说"）
  | 'playful'         // 玩笑 / 轻松互动
  | 'invite'          // 邀请（活动 / 出门 / 一起做 X）
  | 'celebrate'       // 庆祝

  // 关系修复类
  | 'repair'          // 主动修复（关系受损时）
  | 'reconnect'       // 重连（断联后）
  | 'gentle_pull'     // 温和拉回（用户沉默但不是拒绝）

  // 关系深化类
  | 'comfort'         // 安慰
  | 'truth'           // 说真话
  | 'vulnerable'      // 表达脆弱（让 ta 看到真实的我）
  | 'reflect'         // 反思 / 表达内心

  // 边界类
  | 'boundary'        // 表达不同意见
  | 'protect'         // 保护（对方或自己）

  // 静默类（MVP 关键）
  | 'wait'            // 等待（"现在不主动"）
  | 'defer';          // 推迟到指定时间
```

### 4.3 目标 Intent 数据结构

```ts
interface CharacterIntent {
  id: string;
  charId: string;
  decidedAt: number;

  // 触发上下文
  trigger: {
    type: 'proactive_timer' | 'user_message' | 'user_absence'
        | 'event_in_world' | 'self_reflection' | 'anticipation_due';
    payload?: any;
  };

  // 决策时的情境快照（用于追溯）
  contextSnapshot: {
    userLastActiveAt: number;
    timeGapHours: number;
    userRecentEmotion?: { valence: number; arousal: number };
    userCurrentlyChatting: boolean;
    relationshipPhase: 'flirting' | 'stable' | 'tension'
                     | 'repairing' | 'drifting' | 'unknown';
    openThreadCount: number;
    activeRelationshipEvents: number;  // currentImpact < -0.3 的事件数
  };

  // 角色判断（"我为什么"）
  judgment: {
    situation: string;             // 角色自己总结："ta 沉默 6 小时，我们昨天有过争执"
    conflictDetected: boolean;
    userVulnerability: number;     // 0-1
    relationshipTension: number;   // 0-1
  };

  // 决策（MVP 核心）
  decision: {
    shouldRespond: boolean;        // **关键：false = 不发**
    intentType: IntentType;        // 'wait' / 'repair' / 'share' / ...
    rationale: string;             // 角色自己解释："ta 沉默不等于拒绝，我应该温和靠近"
    goal: string;                  // "恢复连接感"
    tone: string;                  // "主动但不逼迫"
    strategy: string;              // "先缓和关系，再讨论问题"
    constraints: string[];         // "不追问上次那个话题"
    deferredUntil?: number;        // 若 intentType='defer'
  };

  // 表达参数
  expression: {
    lengthTarget: 'short' | 'medium' | 'long';
    mediaAllowed: Array<'text' | 'voice' | 'image' | 'card'>;
    openForReply: boolean;         // 是否开放回话题
    language: 'casual' | 'intimate' | 'formal' | 'playful';
  };

  // 执行后填
  generatedContent?: string;
  generatedAt?: number;
  sentAt?: number;

  // outcome 反馈（MVP 第二周做）
  outcome?: {
    userRepliedAt?: number;
    userRepliedContent?: string;
    emotionalImpact: 'positive' | 'neutral' | 'negative' | 'no_reply';
    relationshipImpact: number;    // -1 到 +1
    feedbackNotes?: string;        // "用户说'我现在不想聊'→ behaviorAdjustments 调整"
  };
}
```

### 4.4 Intent 推导算法（不调 LLM，规则 + core 推导）

**MVP 阶段：纯函数推导**。Phase 2 可以让 LLM 参与。

```ts
function deriveIntent(
  trigger: TriggerContext,
  core: CharacterCore,
  mind: CharacterMind,
  recentEmotion: { valence: number; arousal: number }
): CharacterIntent {
  const now = Date.now();

  // 1. 检测关系事件（影响最大）
  const activeTension = mind.relationshipEvents
    .filter(e => e.currentImpact.valence < -0.3)
    .sort((a, b) => Math.abs(b.currentImpact.valence) - Math.abs(a.currentImpact.valence))[0];

  // 2. 检测用户沉默模式
  const isUserSilent = !trigger.userCurrentlyChatting && trigger.timeGapHours > 6;
  const silencePattern = mind.userPatterns.find(p =>
    p.pattern.includes('沉默') && p.confidence > 0.6
  );

  // 3. 检测开放话题
  const hasOpenThread = mind.behaviorAdjustments
    .some(a => a.situation.includes('开放话题') || a.situation.includes('open'));

  // 4. 决策分支

  // A. 有未解决冲突 + 沉默 < 12h → 等
  if (activeTension && trigger.timeGapHours < 12) {
    return {
      judgment: { situation: `我们 ${formatHoursAgo(activeTension.occurredAt)} 前有过争执` },
      decision: {
        shouldRespond: false,
        intentType: 'wait',
        rationale: '刚吵过，ta 需要时间。我给空间。',
        ...
      }
    };
  }

  // B. 有未解决冲突 + 沉默 > 12h + 角色风格是 repair → repair
  if (activeTension && core.conflictStyle.defaultApproach === 'repair') {
    return {
      judgment: { situation: `ta 沉默 ${trigger.timeGapHours}h，我们有过争执` },
      decision: {
        shouldRespond: true,
        intentType: 'repair',
        rationale: '我注意到 ta 沉默，但 ta 的沉默不等于拒绝。我先轻轻靠近。',
        goal: '缓和关系，恢复连接',
        tone: '主动但不逼迫',
        strategy: '先温和关心，等 ta 回应再讨论',
        constraints: ['不追问上次', '不要求 ta 解释']
      }
    };
  }

  // C. 用户沉默 + 角色知道 ta 沉默是 X 模式 → gentle_pull
  if (isUserSilent && silencePattern) {
    return {
      decision: {
        shouldRespond: true,
        intentType: 'gentle_pull',
        rationale: `ta 沉默不等于拒绝，${silencePattern.pattern}。温和靠近而非追问。`,
        goal: '让 ta 知道我在',
        tone: '安静陪伴式',
        strategy: '分享一个不需要回应的话题'
      }
    };
  }

  // D. 开放话题 → revisit
  if (hasOpenThread) {
    return {
      decision: {
        shouldRespond: true,
        intentType: 'share',  // 或 revisit_thread（新增）
        rationale: 'ta 之前提的 X 没聊完',
        ...
      }
    };
  }

  // E. 角色核心是"低主动" + 距离上次聊不久 → 不发
  if (core.expressionStyle.vulnerabilityLevel < 0.4 && trigger.timeGapHours < 1) {
    return {
      decision: {
        shouldRespond: false,
        intentType: 'wait',
        rationale: '刚聊过不久，我没特别想说的',
        ...
      }
    };
  }

  // F. 默认主动消息
  return {
    decision: {
      shouldRespond: true,
      intentType: pickDefaultIntent(core, recentEmotion),
      rationale: '距离上次聊天一段时间了，我自然地想 ta 了',
      ...
    }
  };
}
```

### 4.5 注入到 LLM Prompt

**在 BP3 之后、Message History 之前**增加：

```
【当前 Intent】
你想做的是：{intentType}（{chinese}）

为什么：
{rationale}

目标：
{goal}

态度：
{tone}

策略：
{strategy}

约束（不要违反）：
{constraints.map(c => `- ${c}`).join('\n')}
```

**关键效果**：
- LLM 不再收到"突然想起 / 轻轻吐槽"统一 hint
- LLM 收到"我想 repair，目标是恢复连接，策略是先缓和再讨论"
- LLM 知道约束（"不追问上次"），自然不会戳痛点

### 4.6 Outcome 反馈回路

```
Intent 执行后
  ↓
  等待用户响应（带超时，比如 24h）
  ↓
  outcome 评估：
    ├─ 用户在 X 小时内回复 → emotionalImpact
    ├─ 用户回复内容分析（情绪 / 长度 / 关键词）→ relationshipImpact
    ├─ 用户没回复 → 'no_reply' 标记
  ↓
  写入 CharacterMind：
    ├─ 关系事件影响更新（impact 调整）
    ├─ 形成新 reflection（"我试着 repair 但 ta 没回 → 关系还紧"）
    ├─ 调整 behaviorAdjustment 的 confidence
```

**这是"角色被经历改变"的工程化**。

---

## 5. 主动消息系统改造

### 5.1 不推翻现状的原则

**保留**：
- 5 个触发通道（SW timer / 主线程精确 timer / 20s 兜底 / Worker WS / VAPID）
- Cloudflare Worker 整个架构
- BP1-BP3 prompt 体系（加段，不改结构）
- 现有 6 个规则闸（quietHours / dailyLimit / 撞车 / 情侣空间 / 重复触发 / 真实世界感知窗）
- amsg2 多任务系统
- 主动消息 14 种内嵌指令解析

**新增**：
- Intent 决策层（位于触发后、规则闸前）
- CharacterCore / Mind IDB store + 数据
- outcome 反馈回路
- BP2 加 Core 段，BP3 加 Mind 段
- "intent" 上下文注入到 LLM messages

### 5.2 新链路

```
触发（任意通道）
    ↓
【新增】Intent 决策层
    ├─ 读 core / mind / 当前情境
    ├─ 推导 shouldRespond + intentType + rationale/goal/tone/strategy
    ↓
  若 shouldRespond = false：
    ├─ 静默（不调 LLM）
    ├─ 记录到 outcome（"我选择不主动"）
    ├─ 写 mind.reflection（如果触发新反思）
    ↓
  若 shouldRespond = true：
    ↓
    [现有规则闸] —— 保留
    ↓
    [BP1-BP3 prompt] —— 加 Core 段 + Mind 段 + CurrentIntent 段
    ↓
    LLM
    ↓
    解析 [[TAG: ...]] 内嵌指令
    ↓
    保存为消息
    ↓
    [新增] outcome 反馈
    ├─ 等待用户响应
    ├─ 评估 emotionalImpact / relationshipImpact
    ├─ 写 mind
```

### 5.3 关键设计点

**1. Intent 决策应在"调 LLM 之前"**：
- LLM 应该服从 Intent，而不是 LLM 决定 Intent
- 这样"不发"才是真的不发（不是 LLM 调高 temperature 偶尔生成空）

**2. `shouldRespond = false` 必须有"我为什么"**：
- 不是"没话说所以不发"
- 是"ta 沉默不等于拒绝，但 ta 现在不需要我主动 → wait"（rationale 写进 mind）

**3. Intent 推导应该是"可解释的"**：
- 每次 Intent 的 rationale / goal / strategy 都应该被记录
- 用户/暮色之后能回看"ta 当时为什么想发这条"

**4. 不破坏现有 amsg2 任务系统**：
- amsg2 的 `schedule_active_message` 工具让角色**自己**排程
- 这是"角色自发的"排程
- 与"系统定时器触发 + Intent 决策"是两个路径
- **都该走 Intent 决策层**——amsg2 排程触发时也推导一次 Intent

---

## 6. 5 项输出汇总

### 6.1 MVP（1-2 周可实现）

**Week 1：核心结构 + Intent 推导**
- [ ] `CharacterCore` 数据结构定义（types.ts 加字段，不强制创建）
- [ ] `CharacterIntent` 数据结构定义 + IDB store
- [ ] `deriveIntent()` 纯函数实现（utils/characterIntent.ts）
- [ ] 主动消息入口接入 Intent 决策（OSContext.runProactive 之前）
- [ ] 现有 hint 系统升级：hint 改为从 Intent 派生
- [ ] `shouldRespond = false` 落地：返回时静默

**Week 2：BP2 注入 + outcome 反馈 + UI**
- [ ] BP2 prompt 加 Core 段（如果 core 存在则注入）
- [ ] BP3 prompt 加 CurrentIntent 段（如果当前有 Intent）
- [ ] outcome 反馈到 `self_room`（通过消化路径）
- [ ] 设置页加 UI：让用户填 character core（引导式问卷）
- [ ] 30 天灰度验证：观察"模板化关心"是否减少

**MVP 不做**：
- relationshipEvents 自动提取（先手工标注或用现成 EventBox）
- behaviorAdjustments 自动学习（先手工定义几个典型 case）
- LLM 参与 Intent 推导（纯规则推导足够 MVP）
- 跨角色关系图谱

**MVP 验收**：
- 定时器到点不一定发（`shouldRespond=false` 触发率应该 > 20%）
- 同样的"沉默 6h"场景，不同角色 core 推导不同 intent
- 主动消息开头不再千篇一律"突然想起 / 今天怎么样"
- 暮色手动说"好假"的次数减少

### 6.2 长期规划

**Phase 2（3-4 周）：自动学习**
- `userPatterns` 自动提取（消化过程 / 每周一次 LLM 总结）
- `relationshipEvents` 自动从 EventBox 同步
- `behaviorAdjustments` 自动从 reflections 推导
- LLM 参与 Intent 推导（双层：规则 → LLM 微调）

**Phase 3（1-2 月）：关系阶段 + 跨角色**
- 关系阶段自动识别（基于 valence + 互动频率 + 关系事件）
- 跨角色关系图谱（用户跟 A 的紧张影响 A 对 B 的态度）
- 关系阶段影响 hint 模板（"暧昧期" vs "稳定期" vs "修复期"）

**Phase 4（3 月+）：群体 + 长期演化**
- 群体关系（用户 + 多个角色 + 角色间关系）
- 角色自我进化（outcomes 驱动 selfInsights 增长）
- 关系破裂 / 修复的完整剧本
- 关系事件影响曲线的自适应半衰期（不同用户衰减率不同）

### 6.3 可复用系统

| 已有 | 怎么复用 |
|---|---|
| `self_room` 房间 | 接收 `mind.reflections` 写入（消化路径产生） |
| `selfInsights` 词条 | 跟 `reflections` 正交：前者通用自我认知，后者关系特异反思 |
| `EventBox` 事件盒 | `relationshipEvents` 的来源（自动同步） |
| `Anticipation` 期盼 | MVP 复用为 `openThreads`（未兑现承诺 = 开放话题） |
| `impression` 印象 | 保留字段，跟 `reflections` 正交 |
| BP1-BP3 prompt 体系 | **保留**，加段不破坏 |
| `buffInjection` 情绪底色 | **保留**，`activeBuffs` 仍正常累积 |
| 5 个主动消息触发通道 | **保留** |
| Cloudflare Worker 整个架构 | **保留** |
| amsg2 多任务系统 | **保留**，任务触发也走 Intent 决策层 |
| 6 个现有规则闸 | **保留**，Intent 决策在它们之前 |
| 主动消息 14 种内嵌指令 | **保留** |
| ChatParser.sanitize | **保留** |

**不新建独立的**：
- 独立的"关系状态机"（不抽出来）
- 独立的"情绪计算"（复用现有 `emotionSpace`）
- 独立的"角色大脑"（`brainAgent.ts` 那种独立 agent 已废弃，不复活）

### 6.4 "活人感"的三个最关键工程变化

**回答暮色问题**："让用户感觉对面是一个活的人，工程上最关键的三个变化是什么？"

#### 变化 1：从"该发了"到"我想发" —— Intent 决策层

**现状**：定时器到点 → 调 LLM → 生成内容
**目标**：定时器到点 → 角色**判断**"我为什么现在想回应 / 我想不想回应" → 决策

**关键**：
- `shouldRespond = false` 是合法决策（MVP 核心）
- 决策依据是 core + mind，不是 hint 模板
- rationale 让用户/角色都能解释"我为什么这样做"

**不做这一步**：所有问题都治标不治本。"主动消息模板化"是因为没让角色做判断。

#### 变化 2：从"我记得"到"所以我" —— behaviorAdjustments

**现状**：记忆宫殿有 7 个房间 + 30k 节点，但都是"数据库里的旧数据"
**目标**：mind 层的 `behaviorAdjustments` 把"关系记忆"转化为"行为调整"

**关键**：
- `behaviorAdjustments` 是 MVP 落地的关键，没有它，关系记忆只是"博物馆"
- 必须能影响 Intent 推导
- outcome 反馈让"调整"本身被调整（学习回路）

**不做这一步**："所以"环节缺失，关系记忆只是"我记得"，但不会改变"我接下来怎么做"。

#### 变化 3：从"我理解你"到"我选择对你" —— CharacterCore

**现状**：每个角色都有 systemPrompt，但都是"形容词"（"温柔 / 幽默"）
**目标**：每个角色有结构化的 core（价值观 / 关系观 / 冲突风格 / 表达偏好 / 边界）

**关键**：
- 没有 core，所有角色面对冲突都是"顺从 / 关心"——这才是"工具型 AI"的根因
- core 必须能影响 Intent 推导（不同 core 推导不同 intent）
- 边界字段让角色能说"不"（这才是"主体性"）

**不做这一步**：所有角色行为趋同，本质上还是一个 AI 套不同名字。

---

## 7. 设计原则（暮色 + G 老师共同明确）

1. **不推翻，只加层**
   - BP1-BP3 保留
   - 主动消息触发链保留
   - 记忆宫殿保留

2. **"不发"也是决策**
   - Intent 决策层第一个产出就是 shouldRespond
   - MVP 验收的关键指标：定时器到点不发率 > 20%

3. **"所以"环节 = behaviorAdjustments**
   - 把"我记得"转化为"我接下来怎么做"
   - 这是活人感的来源

4. **"主体性" = Core 字段**
   - 不是"我是 X 人"，是"我认为 X 重要 / 我相信 Y / 面对冲突我会 Z"
   - 必须能影响 Intent 推导
   - 必须有"边界"字段让角色能拒绝

5. **"关系连续性" = 关系事件影响曲线**
   - 吵架不应该"过去了就过去了"，但也不应该"永远记着"
   - currentImpact(valence, halfLife) 模型
   - 影响 Intent 推导

6. **暮色是产品决策者**
   - AI 是工具
   - 暮色说"我不要完美顺从" → core 字段里有 escalationTolerance
   - 暮色说"沉默不等于拒绝" → core.relationshipBeliefs 容纳这种看法
   - 暮色说"我宁可要有点脾气" → conflictStyle 跟 escalationTolerance 配合

---

## 8. 暮色 + G 老师 共同的"那个所以"

> "一个人和你相处久了，不只是因为他记得你昨天哭过。而是：他会因为昨天你哭过，所以今天主动给你倒杯水。"

工程化映射：

| 暮色说的"所以" | 对应数据结构 | 对应逻辑 |
|---|---|---|
| "记得你昨天哭过" | `mind.relationshipEvents` + `userPatterns` | 关系事件 + 用户相处规律 |
| "所以" | `behaviorAdjustments` | **这是关键字段** |
| "主动给你倒杯水" | Intent `decision.intentType = 'gentle_pull'` | 从 adjustment 推导出的 Intent |

**MVP 的"所以"字段** = `CharacterMind.behaviorAdjustments`。
**没有这个字段，整个设计都是"我记得"层面，永远到不了"所以"**。

---

**字数**：~7500 字
**配套文档**：`notes/2026-09-04-sully-architecture-survey.md`（现状盘点）
**下一步**：
1. 暮色确认 MVP 优先级（核心 6 项）
2. 写 MVP 实施计划（具体到 commit）
3. 第一周开始：types.ts 加字段 + IDB store + 决策函数
