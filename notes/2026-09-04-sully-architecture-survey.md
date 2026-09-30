# Sully 当前架构分析（现状盘点）

**日期**：2026-09-04
**目标读者**：GPT（用于设计"关系记忆 + 主动人格 + 冲突修复机制"）
**原则**：只描述**实际存在**的代码与数据结构，**不假设**未实现的功能

---

## 1. 角色系统（CharacterProfile）

角色数据定义在 `types.ts:1093-1342`。`CharacterProfile` 是单个角色的根对象。

### 1.1 角色可配置项

| 字段 | 类型 | 用途 |
|---|---|---|
| `id`, `name`, `avatar`, `description` | 基础信息 | 标识与展示 |
| `systemPrompt` | string | **角色人格核心定义**（用户写的"性格描述"） |
| `worldview` | string? | 世界观补充 |
| `memories` | `MemoryFragment[]` | **长期记忆片段列表**（按月聚合的 YAML 文本块） |
| `refinedMemories` | `Record<string,string>`? | 精炼后的记忆分类 |
| `activeMemoryMonths` | string[]? | 启用的记忆月份 |
| `writerPersona` | string? | 写日记 / 写作角色 |
| `mountedWorldbooks` | 数组 | 挂载的世界书（设定片段） |
| `impression` | `UserImpression`? | **角色对用户的印象**（运行时累积） |
| `proactiveConfig` | 主动消息设置 | 间隔 / 副 API / 安静时段 |
| `quietHours` | 睡眠时段 | startHour / endHour，默认 23-08 |
| `activeMsg2Config` | 主动消息 2.0 配置 | 多任务模式 |
| `activeBuffs`, `emotionHistory` | 情绪 Buff 数组 | 短时 / 长期情绪状态 |
| `buffInjection` | string? | **注入到 systemPrompt 的叙事型情绪底色** |
| `emotionConfig` | 情绪 API 设置 | 单独情绪判断模型 |
| `emotionEnabled` | bool? | 心声独立开关 |
| `memoryPalaceEnabled` | bool? | 记忆宫殿总开关 |
| `digestionEnabled` | bool? | 认知消化开关（生成 selfInsights） |
| `personalityStyle` | enum | `'emotional' \| 'narrative' \| 'imagery' \| 'analytical'`（影响关联扩散权重） |
| `ruminationTendency` | 0-1 | 反刍倾向（默认 0.3） |
| `selfInsights` | string[]? | **消化过程中生成的常驻自我认知**（类似 buff 注入到 prompt） |
| `scheduleStyle` | enum | `'lifestyle' \| 'mindful'`（生活系 / 意识系） |
| `scheduleFeatureEnabled` | bool? | 日程 + 意识流 + 情绪 buff 总开关 |
| `autoDiaryEnabled` | bool? | 每天 22:00 自动写日记 |
| `chatMode` | enum | `'full' \| 'pure'`（注入 awareness 段多少） |
| `apiConfig` | 角色级 API | baseUrl/apiKey/model 覆盖 |
| `voiceProfile` | TTS 声音 | 角色声音配置 |
| `chatVoiceEnabled` | bool | 聊天 TTS 开关 |
| `customTimezone`, `customTimezoneEnabled` | 时区 | 异国恋场景，角色活在自己的时区 |
| `htmlModeEnabled` | bool | 富 HTML 卡片模式 |
| `imageGenEnabled` / `playSongEnabled` / `phoneUsageEnabled` | bool | 工具开关 |

### 1.2 人格如何定义

**两个来源**：

1. **`systemPrompt` 字段** —— 用户直接写的人格描述（核心，运行时直接注入到 system prompt）
2. **`mountedWorldbooks` 数组** —— 挂载的世界书片段（设定补充，也会注入 prompt）

**没有结构化的"人格参数化配置"**（没有"傲娇度 0.7 / 攻击性 0.3"这种字段）。所有人格都是**自然语言**。

**运行时人格"调整"机制**：
- **`buffInjection` 字段** —— 一段叙事文本，描述角色当前情绪底色，会被注入到角色设定紧下方（`utils/context.ts:254`）
- **`selfInsights` 字段** —— 自我领悟词条列表，也是注入到角色设定下方（`utils/context.ts:31, 122`）
- **`activeBuffs` 数组** —— 短期情绪 Buff（来源是情绪评估 LLM 调用的结果）

### 1.3 长期记忆

**有**。但分两套系统并存：

#### A. 老的"记忆片段"系统（`char.memories`）
- 字段：`memories: MemoryFragment[]`（按月聚合的 YAML 文本块）
- 来源：早期版本的"自动按月归档"系统
- 当前状态：**仍在 type 定义里**，但被新系统替代
- 7-31 之前的产物

#### B. 记忆宫殿系统（`utils/memoryPalace/`，~12800 行）
**新系统，6 大模块**：

1. **七个房间**（`types.ts:10-18`）：
   - `living_room` 客厅 — 日常闲聊（200 条上限，0.9972/h 衰减）
   - `bedroom` 卧室 — 亲密情感（无上限，0.9995/h 衰减）
   - `study` 书房 — 工作学习（无上限，0.9995/h 衰减）
   - `user_room` 用户房间 — 用户个人信息 / 习惯（无上限，0.9995/h 衰减）
   - `self_room` 自我房间 — 角色自我认同（无上限，**永不衰减**）
   - `attic` 阁楼 — 未消化的困惑（无上限，**永不衰减**）
   - `windowsill` 窗台 — 期盼 / 目标（**Anticipation 单独结构**）

2. **记忆节点**（`types.ts:58-93 MemoryNode`）：
   - 字段：`content`, `room`, `tags`, `importance` (1-10), `mood`, `valence`/`arousal` (Russell 二维情绪)
   - `embedded: boolean` 是否已向量化
   - `eventBoxId` 所属事件盒
   - `origin: 'extraction' | 'digestion' | 'system'`

3. **关联网络**（`MemoryLink`）：5 种 link type
   - `temporal` 时间 / `emotional` 情感 / `causal` 因果 / `person` 人物 / `metaphor` 隐喻
   - 不同 `personalityStyle` 权重不同（`types.ts:232` `PERSONALITY_WEIGHTS`）

4. **EventBox 事件盒**（`types.ts:143-159`）：把同一事件的多条记忆绑在一起
   - 活节点数 ≥ 4 触发 LLM 压缩成 summary
   - 总节点数 ≥ 12 自动封盒

5. **期盼系统 Anticipation**（`types.ts:204-212`）：
   - `status: 'active' | 'anchor' | 'fulfilled' | 'disappointed'`
   - "窗台"房间的"心理期盼"模型

6. **认知消化**（`utils/memoryPalace/digestion.ts`）：
   - `runCognitiveDigestion` 周期跑
   - 生成"衍生记忆"（第一人称内心独白）
   - 生成 `selfInsights` 注入到 self_room

### 1.4 记忆存储什么

| 系统 | 字段 | 存储内容 |
|---|---|---|
| 记忆节点 | `content` | **第三人称叙事**（提取时）/ **第一人称内心独白**（消化时衍生） |
| 记忆节点 | `tags`, `mood`, `importance` | 标签 / 情绪标签 / 重要性 1-10 |
| 记忆节点 | `valence`/`arousal` | Russell 环形情感坐标 |
| 关联 | `strength` | 0-1，共同激活时 +0.05 |
| EventBox | `summary` | LLM 压缩生成的总结节点 |
| Anticipation | `content` | 期盼内容（"下周考试" / "汤炖上两小时后叫你"） |
| selfInsights | string[] | 自我认知（"我已经习惯他晚上不回消息"） |

### 1.5 是否区分事实 / 关系 / 情绪记忆

**没有显式区分**。但有近似对应：

| 概念 | 在 Sully 里的近似实现 |
|---|---|
| 事实记忆 | `user_room` 房间（用户个人信息、习惯） |
| 关系记忆 | **没有独立结构**。最近的对应是 `bedroom` 房间（亲密情感、深层羁绊）+ `user_room` 标签。但这两者都是**碎片化的节点**，没有"关系实体"概念——比如"我和用户的关系现状"没有专门字段 |
| 情绪记忆 | `valence`/`arousal` 情绪坐标 + 关联中的 `emotional` link type + `attic`（未消化的困惑） |
| 自我认知 | `self_room` 房间 + `selfInsights` 数组 |
| 期盼 | `Anticipation` 独立结构 + `windowsill` 房间 |

**关系记忆的关键缺口**：
- 关系**状态**（"最近有点疏远" / "刚吵完架" / "在暧昧期"）没有结构化字段
- 关系**事件**（第一次见面 / 第一次吵架 / 重要承诺）可能被 EventBox 覆盖，但没有专门的"关系里程碑"概念
- 关系**变化曲线**（亲密度的时序变化）没有——只有 0-1 的 link strength

---

## 2. AI 对话流程

主流程在 `hooks/useChatAI.ts`（5038 行）。`OSContext.tsx:1512+` 是主动消息版本的 `runProactive`。

### 2.1 用户消息进入后经过哪些模块

**主聊天路径**（用户在前台发消息）：

```
用户输入
  ↓
useChatAI.ts (主入口，~30+ effect)
  ↓
ChatPrompts.buildSystemPrompt (utils/chatPrompts.ts:158-)
  │   ├─ BP1 Tools（工具声明）
  │   ├─ BP2 Rules（角色设定 / 世界书 / selfInsights / buffInjection）
  │   ├─ BP3 Context（最近聊天 / 朋友圈 awareness / 群聊 / 日记 / 音乐 / 小纸条）
  │   └─ dynamicTail
  │       ├─ realtimeText（isProactive=true 时才有，真实世界感知）
  │       └─ hotNewsText（热搜 + 天气，仅主动消息 / 早晚推）
  ↓
ChatPrompts.buildMessageHistory（最近 N 条消息 + 时间差提示）
  ↓
LLM 调用（OpenAI / Gemini 协议，key 池轮询）
  ↓
ChatParser.sanitize（清理 AI 输出）
  ↓
parseMomentsActions / parseXiaoZhiTiao / parseMusicAction（解析 [[TAG: ...]] 内嵌指令）
  ↓
保存到 IDB + 触发 UI 更新
```

**主动消息路径**（OSContext.runProactive，~500 行）：

```
ProactiveChat.onTrigger 触发 (定时器到点 / Worker 推送)
  ↓
OSContext.runProactive(charId)
  ↓
[前置闸]
  ├─ AMSG2_ENABLED?（feature flag 暂停开关，8-9 启用 2.0 时短暂关过）
  ├─ config.enabled?（角色级开关）
  ├─ quietHours?（睡眠时段）
  ├─ hasReachedDailyLimit?（每角色每天 10 条硬上限，utils/proactiveCount.ts）
  ├─ isUserCurrentlyChatting?（45 秒内用户跟该角色发过消息则跳过，防撞车）
  ├─ shouldTriggerAiCheckin?（情侣空间 AI 主动打卡，30% 概率 / 一天 3 条 / 距上次 6h+）
  └─ markUserContact + 计时器重置
  ↓
buildProactiveHint（hintLines，注入 system hint）
  ↓
ChatPrompts.buildSystemPrompt(..., isProactive=true)
  ↓
LLM 调用（温度 0.8, max_tokens 2000）
  ↓
ChatParser.sanitize + 解析 [[MOMENT_POST]] / [[XIAO_ZHI_TIAO]] / [[MUSIC_ACTION]] 等内嵌指令
  ↓
保存为消息（type='proactive' 或 'couple_space_event'）
  ↓
触发 proactive-message-sent CustomEvent → 通知 / badge 计数
```

### 2.2 system prompt / character prompt / memory / context 如何组合

**ChatPrompts.buildSystemPrompt**（`chatPrompts.ts:158-`）组装四段（BP1-BP3 + dynamicTail）：

**BP1 Tools**（~30+ 工具声明）：
- 通用：生图、识图、放歌、查手机、搜资料、写日记、设置闹钟、小纸条
- 主动消息专用：`schedule_active_message`（**角色能给自己排下一次的主动消息**）
- 社交：发朋友圈、点赞、评论、写信、回信
- 实时：天气、热搜、提醒事项
- 工具开关：`imageGenEnabled` / `playSongEnabled` / `phoneUsageEnabled` 控制是否注册

**BP2 Rules**：
1. 角色身份卡（`char.systemPrompt`）
2. 世界观（`char.worldview`）
3. 挂载的世界书
4. **自我领悟**（`char.selfInsights`）— 消化过程生成的常驻认知
5. **情绪 Buff 注入**（`char.buffInjection`）— 叙事型情绪底色
6. IM 规范（气泡格式、表情包使用规范、戳、引用）
7. 工具使用规则（每个工具有独立 prompt 段）
8. 自定义 HTML 模式 prompt

**BP3 Context**：
1. 时间（当前时间 + 角色时区）
2. 表情包库（分组）
3. 最近聊天（最近 N 条 + 深夜判断）
4. 朋友圈 awareness（最近 5 条 + 评论 / 点赞）
5. 群聊（私聊里注入的"近期群活动"）
6. 音乐（一起听 / char 此刻在听 / 歌词片段）
7. 日记列表 / 小纸条列表
8. 小小窝（情侣空间上下文）
9. 实时世界感知（仅 isProactive=true）
10. 热搜 + 天气（仅主动消息 / 早晚推）
11. 当前意识流（最近一次演化的 innerState）

### 2.3 是否有用户状态判断

**有，但很弱**。当前用户状态相关的只有：

1. **`isUserCurrentlyChatting(charId)`**（`utils/chatPresenceStorage.ts`）—— 45 秒内是否跟该角色发过消息
2. **`markUserChatPresence(charId, ts)`** —— 用户发了消息时打点（ProactiveChat.markUserContact 调）
3. **`hasReachedDailyLimit(charId)`** —— 每天主动消息条数计数
4. **`quietHours`** —— 按小时硬切，不感知用户当前是否睡觉

**没有**：
- 用户当前在哪个 App / 场景判断
- 用户当前是否在跟其他角色聊（ProactiveChat 只防"跟同一个角色撞车"）
- 用户最近 N 次回复的内容 / 时长 / 情绪倾向
- 用户疲劳度 / 接受度判断
- 用户当前 App 使用强度

### 2.4 是否有情绪识别

**用户侧情绪识别**：**基本没有**。代码里搜不到"用户情绪"或"userMood"识别路径。

**角色侧情绪识别**：
- `emotionConfig` 配独立 API（baseUrl/apiKey/model）
- `runCognitiveDigestion` 周期消化，可能生成 `selfInsights`
- `activeBuffs` / `buffInjection` 字段累积情绪
- `char.emotionEnabled` 总开关

**情绪评估的实际触发**：
- 在前台聊天走 useChatAI 主流程时（每个用户消息回合跑一次）
- 消化过程（定时或触发）
- 主动消息里**不再走旧情绪评估**（OSContext.runProactive:1816 注释明确："主动消息路径不再走旧情绪评估，避免旧格式的多 buff 异步覆盖头像心声"）

**情绪数据流**：
- 评估结果 → `char.activeBuffs`（数组）
- 累积一段时间后 `char.emotionHistory`（历史）
- 叙事化后写入 `char.buffInjection`（字符串）
- 通过 `isEmotionOn(char) && char.buffInjection` 注入到 BP2 prompt

---

## 3. 当前主动消息系统

### 3.1 触发机制是什么

**多通道并存**：

| 通道 | 代码位置 | 机制 |
|---|---|---|
| **浏览器内 Service Worker 定时器** | `public/sw-keep-alive.js` | SW setInterval 30s 检查，到点 postMessage('proactive-trigger') |
| **浏览器内主线程精确 timer** | `utils/proactiveChat.ts:211` | `setTimeout(checkOverdueSchedules, delay)` 单次精确 timer，下次到点之前 |
| **浏览器内主线程 20s 兜底轮询** | `utils/proactiveChat.ts:144, 252` | `setInterval(checkOverdueSchedules, 20_000)` 后台被节流时的兜底 |
| **Cloudflare Worker cron + WebSocket** | `worker/proactive-push/src/index.ts` | cron 扫描到点 schedule → WsHub.broadcast → 客户端 OkHttp WS onMessage → runProactive |
| **Cloudflare Worker cron + VAPID Web Push** | `worker/proactive-push/src/index.ts:241` | WS 没送达时回退到 VAPID Web Push → SW onmessage → main thread 触发 |

**触发去重**（`proactiveChat.ts:170-178`）：60 秒窗口内同角色不重复触发。

**离线补发**：当用户重新打开 App，`checkOverdueSchedules` 立刻跑（visibility / focus 监听 + 启动时），把期间到点的发出来（通过 Worker WS 推送 / 浏览器内 timer）。

### 3.2 是定时器直接触发还是有决策层

**当前是定时器到点直接触发**。决策层非常薄：

```js
// OSContext.runProactive 触发前的前置闸
1. enabled? 角色级开关
2. quietHours? 睡眠时段
3. dailyLimit? 每角色 10 条/天
4. isUserCurrentlyChatting? 45 秒撞车
5. shouldTriggerAiCheckin? 情侣空间 30% 独立分支
```

**所有闸都是基于"时间"和"最近状态"的规则判断**，**没有调用 LLM 决策**"现在该不该发"。

### 3.3 调模型前有哪些判断

| 闸 | 阈值 | 文件 |
|---|---|---|
| 角色开关 | `proactiveConfig.enabled` | types.ts:1195 |
| 安静时段 | `quietHours.startHour` / `endHour` | types.ts:1212 |
| 每日上限 | 10 条/天 | `utils/proactiveCount.ts` |
| 撞车 | 45 秒内 user → char 消息 | `utils/chatPresenceStorage.ts` |
| 情侣空间独立 | 30% 概率 / 3 条/天 / 6h 间隔 | `utils/coupleSpaceStorage.ts` |
| 重复触发 | 60 秒内同角色不重 | `proactiveChat.ts:170` |
| 早 8 晚 10 真实世界感知窗 | 早 8 / 晚 10 注入 hotNews | `realtimeNotified.ts` |

### 3.4 是否考虑以下因素

| 因素 | 现状 |
|---|---|
| 用户是否忙 | ❌ 仅 45 秒"是否在聊"二元判断，不感知"忙" |
| 最近是否冲突 | ❌ **没有冲突状态字段**，无法感知 |
| 最近聊天质量 | ❌ 没有聊天质量评估 |
| 情绪状态 | ⚠️ 角色有情绪（buffInjection），但**主动消息路径不再走情绪评估**（注释明确），用户情绪识别基本没有 |
| 关系状态 | ❌ **没有"关系阶段"字段**——只能在历史聊天里推 |
| 时区差异 | ✅ `customTimezone` + `nowInTimeZone` 折算 |
| 安静时段 | ✅ 硬切（quietHours） |
| 上次主动消息内容 | ⚠️ 部分有：`amsg2` 多任务系统里"你排了哪些任务"会注入 prompt（`buildFireTaskListBlock`），但**对话历史回顾只在 chars 自己的回复里出现**，没有跨任务的"上次我跟他聊了什么" |

---

## 4. 当前主动消息生成

### 4.1 prompt 内容

**主入口**：`OSContext.runProactive`（`context/OSContext.tsx:1512-2050`）

**prompt 组装流程**：

1. **`buildProactiveHint`**（hintLines，注入 messages 末尾）—— 关键内容：
   ```
   【1.0 风格主动消息提示】（activeMsgClient.ts:222-241）
   现在是 {currentTime}。
   {awayHint}（如"已经 30 分钟没聊"）
   这不是 {targetName} 正在和你聊天，而是你突然想起了 {targetName}，想主动发条消息给他/她。
   像真人随手发消息一样自然：分享 / 吐槽 / 问近况 / 突然想念 / 单纯想找对方聊两句。
   不要写成汇报近况，不要像在完成任务，也不要解释自己为什么会发这条消息。
   正文尽量短，1-2 句就够；很久没聊可以带一点想念、好奇、小小抱怨。
   ```

2. **`ChatPrompts.buildSystemPrompt(..., isProactive=true)`** —— 完整 BP1-BP3 + dynamicTail（见 §2.2）

3. **任务列表注入**（`buildFireTaskListBlock`，仅 amsg2 多任务场景）—— 角色能"看到"自己还挂着哪些排程

4. **日程 + 此刻在听**（`renderFireSceneBlock`，仅 amsg2）—— 角色扮演"当前在做什么"

5. **历史聊天**（最近 30 条，格式化为 `【用户】\n ...\n\n【角色】\n ...`）

### 4.2 输入给模型的信息

| 类别 | 具体字段 |
|---|---|
| 角色身份 | systemPrompt / worldview / worldbooks / selfInsights / buffInjection |
| 上下文 | 最近 30 条对话 / 朋友圈 awareness / 群聊 / 日记列表 / 音乐 / 小纸条 |
| 时间 | 当前时间 + 角色时区 + 用户时区（双向） |
| 用户状态 | 距离上次聊天多久 |
| 真实世界 | 天气 / 热搜 5 条（仅主动消息 / 早晚推） |
| 工具声明 | schedule_active_message / 发朋友圈 / 写日记 / 小纸条 / 写信 / 设置提醒等 |
| 排程现状 | 这个角色当前还挂着哪些主动消息任务（仅 amsg2） |
| 场景 | "你正在发主动消息"这个上下文 |

### 4.3 输出格式

```ts
{
  role: 'assistant',
  content: string,  // 主要消息文本
  metadata: {
    proactive: true,  // 标记为主动消息
    source: 'proactive' | 'proactive_wake',  // 触发来源
    proactiveHint: string,  // 注入的 hint
  }
}
```

**`ChatParser.sanitize` 后处理**：
- 清理多余换行
- 限制 emoji 数量
- 解析 `[[MOMENT_POST: ...]]` / `[[MOMENT_COMMENT: ...]]` / `[[MOMENT_LIKE: ...]]` / `[[XIAO_ZHI_TIAO: ...]]` / `[[MUSIC_ACTION: ...]]` / `[[SCHEDULE_TASK: ...]]` 等内嵌指令
- 每个指令产生副作用（发朋友圈 / 写小纸条 / 排程等）

**`normalizeProactiveAiContent`**：剥离开头的"（角色名）："格式。

**长度限制**：max_tokens=2000（但 prompt 鼓励 1-2 句）。

### 4.4 是否允许模型决定

| 决定权 | 现状 |
|---|---|
| 发不发 | ❌ **不告诉模型"你可以不发"**。模型必须生成内容（除非触发了"用户正在聊天"撞车闸，但那在调模型前就拦截了） |
| 延迟 | ⚠️ **部分允许**。amsg2 多任务里模型可以调 `schedule_active_message` 工具"再排一条"。但当前 ProactiveChat 主流程没有这个工具入口 |
| 改变策略 | ⚠️ 部分：模型可以决定**消息内容**（"突然想起他"还是"分享刚看到的东西"），但**触发本身**由系统决定 |
| 内容方向 | ✅ 完全自由（hint 只是建议） |
| 触发后续动作 | ✅ 可以：发朋友圈、点赞、评论、写小纸条、写信、回信、排下一条主动消息、写日记、设置闹钟提醒等 |

**关键缺口**：模型**没有"不发"选项**。一旦定时器到点，模型必须生成内容（即使没有话可说）——这是"主动消息容易变成普通关心"的根本原因。

---

## 5. 记忆系统全景

### 5.1 现有 memory 类型和用途

| 类型 | 位置 | 用途 | 主动消息用吗 |
|---|---|---|---|
| `MemoryNode` | memoryPalace/types.ts:58 | 记忆节点（房间 + 内容 + 情绪 + 关联） | ✅ retrieval 时注入（pipeline.ts） |
| `MemoryVector` | types.ts:97 | 1024 维 embedding | ✅ 向量检索 |
| `MemoryLink` | types.ts:120 | 5 种关联 | ✅ 扩散激活 |
| `EventBox` | types.ts:143 | 事件盒（多节点绑定 + 压缩） | ✅ 召回时整盒出 |
| `Anticipation` | types.ts:204 | 期盼（active/anchor/fulfilled/disappointed） | ⚠️ 部分（`buildFireTaskListBlock` 注入，但没充分用） |
| `selfInsights` | CharacterProfile | 自我领悟（消化过程生成） | ✅ 注入到 BP2 |
| `activeBuffs` | CharacterProfile | 短期情绪 Buff 数组 | ✅ 注入到 BP2 |
| `buffInjection` | CharacterProfile | 情绪底色叙事文本 | ✅ 注入到 BP2 |
| `emotionHistory` | CharacterProfile | 长期情绪历史 | ❌ 暂未在主动消息 prompt 注入 |
| `impression` | CharacterProfile | 角色对用户的印象（运行时累积） | ⚠️ 字段存在但没看到主动注入到主动消息 prompt |
| `char.memories` (YAML) | types.ts:1100 | 老系统的按月聚合记忆 | ❌ 已被记忆宫殿替代 |
| `chatPresenceStorage` | utils/chatPresenceStorage.ts | 撞车判断用"用户在聊"标记 | ✅ runProactive 撞车闸 |

### 5.2 记忆系统在主动消息里的作用

**记忆检索流程**（`utils/memoryPalace/pipeline.ts`）：
```
processNewMessages (新消息 → 提取记忆)
  ↓
extractMemoriesFromBuffer (LLM 提取 → MemoryNode[])
  ↓
vectorizeAndStore (embedding)
  ↓
bindMemoriesIntoEventBox (绑定到 EventBox)
  ↓
runConsolidation (关联建立)
```

**主动消息路径调用**（`utils/memoryPalace/pipeline.ts:retrieveMemories`）：
- **关键词触发**：`retrieveMemories(charId, query)` 显式调用（用 query 关键词找相关记忆）
- **自动注入**：`memoryPalaceInjection` 字段会注入到 prompt（`utils/context.ts:202`）

**关键缺口**：
- **关系记忆没有专门结构**（亲密关系变化、当前关系阶段、关系事件）
- **冲突状态没有专门结构**（上次吵架是什么时候 / 什么话题 / 有没有修复 / 用户当下情绪）
- **最近互动质量评估**没有（最近一次聊天是 5 分钟还是 5 天？质量如何？有没有未回复的"开放话题"？）
- **跨任务的"上次我跟他聊了什么"**没有持久化（只在 amsg2 排程里"你排了哪些任务"可见）

---

## 6. 当前限制

### 6.1 为什么现在角色容易模板化

**根因**：

1. **prompt 模板化** —— BP1-BP3 + dynamicTail 是**所有角色共用同一套结构**，只有 BP2 的 systemPrompt / worldview 是角色特异的。LLM 在重复模式里容易"凑模板"。

2. **没有"角色当下状态"的概念** —— 角色不知道"我最近 3 天跟他聊了什么"（除了最近 30 条原文），不知道"我跟他现在什么阶段"（暧昧 / 刚吵 / 平淡），没有"角色自己的未完成事项"（除了 Anticipation）。

3. **没有"个性化输出规则"** —— 同一个 hint 给 10 个角色用，10 个角色都会"想找他聊两句 / 突然想起 / 轻轻吐槽"。因为 hint 是"行为模式建议"而不是"这个角色这个时刻的内在状态"。

4. **`buffInjection` 是单一字符串** —— 一次只能表达一种情绪底色，没有"我现在又期待又有点担心"的复合状态。

5. **没有"角色当下的中心议题"** —— 跟用户当前关系最相关的"那件事"是什么？没有。

### 6.2 为什么容易回避冲突

**根因**：

1. **没有冲突状态字段** —— 没法判断"我们刚吵过" / "我们对某个话题有分歧"。

2. **hint 鼓励"温和关心"** —— "可以轻轻带一点想念、好奇或者小小抱怨"——但**没有鼓励"对质" / "澄清" / "不一致提醒"**。

3. **撞车闸只防"撞车"不防"打扰"** —— 45 秒判断不感知"用户明显不想聊"。

4. **没有"用户真实反应"追踪** —— 用户上次回消息的语气 / 时长 / 表情 / 是否追问，**没有结构化记录**。模型只看到原文。

5. **没有"开放式话题"清单** —— 用户说"我最近在思考 X"之后没有后续跟踪，角色不会主动回来问"你想明白了吗"。

6. **`Anticipation` 系统** —— 字段存在但**没有充分用于"我记得我答应过你什么"**。窗户上的期盼可以变成"主动消息的核"，但当前是独立的。

### 6.3 为什么主动消息容易变成普通关心

**根因**：

1. **没有"不发"选项** —— 定时器到点必发。即使没话说也发"早安"。

2. **没有"针对这件事发"** —— 没有关系事件 / 冲突状态 / 用户当下情绪来驱动"此刻就该聊这个"。

3. **hint 模板化** —— "突然想起 / 轻轻吐槽 / 问一句近况" 三个模式，所有角色都会用。

4. **没有"角色自身议程"** —— 角色没有"我最近想跟你聊 X / 我有个问题想问你 / 我注意到你最近有点不对"。只有 systemPrompt 里写的静态人格。

5. **`scheduleStyle: 'lifestyle' | 'mindful'`** —— 是**有**这个区分！但"意识系"角色的"内心活动"也只到"回忆对话 / 整理想法 / 等待用户"——**没有结构化的"我跟他现在的核心议题"**。

6. **日程系统**（`buildScheduleInjection`）—— 角色知道自己**日程**（"我今天去了健身房"），但不知道**关系议程**（"我们该聊聊上次那个事"）。

---

## 7. 架构图（文字版）

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Cloudflare Worker                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  proactive-push (cron + WS + VAPID)                       │       │
│  │  ├─ cron 扫描到点 schedules                                │       │
│  │  ├─ 优先 WsHub.broadcast (在线客户端)                       │       │
│  │  └─ fallback VAPID Web Push (无客户端时)                    │       │
│  └──────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ WSS / Web Push
┌─────────────────────────────────────────────────────────────────────┐
│                       Android (Capacitor)                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  KeepAliveService (Kotlin, FGS)                            │       │
│  │  ├─ WS 连接到 Worker /ws/push                              │       │
│  │  ├─ onMessage → showProactiveNotification                  │       │
│  │  └─ PARTIAL_WAKE_LOCK 临时 10s 弹通知时                    │       │
│  └──────────────────────────────────────────────────────────┘       │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  WebView (SullyOS 前端)                                    │       │
│  │  ├─ Service Worker (sw-keep-alive.js)                       │       │
│  │  │   ├─ setInterval 30s 检查 (ProactiveChat 同步)            │       │
│  │  │   └─ Push → main thread 触发                              │       │
│  │  ├─ 主线程 ProactiveChat.ts                                  │       │
│  │  │   ├─ setTimeout 精确 timer                                │       │
│  │  │   ├─ setInterval 20s 兜底                                  │       │
│  │  │   └─ visibilitychange / focus 触发 catch-up              │       │
│  │  └─ OSContext.runProactive                                   │       │
│  │      ├─ 前置闸 (quietHours / dailyLimit / 撞车)              │       │
│  │      ├─ buildProactiveHint (短自然风格)                       │       │
│  │      ├─ ChatPrompts.buildSystemPrompt(isProactive=true)      │       │
│  │      ├─ LLM 调用 (OpenAI / Gemini 协议, key 池轮询)         │       │
│  │      └─ 解析 [[TAG: ...]] 内嵌指令                            │       │
│  └──────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────────┐
│                      浏览器内 (IndexedDB)                              │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │  Database (Dexie)                                           │       │
│  │  ├─ messages (聊天历史)                                      │       │
│  │  ├─ characters (CharacterProfile)                            │       │
│  │  ├─ memoryPalace (MemoryNode / Vector / Link / EventBox)   │       │
│  │  ├─ anticipation (期盼)                                      │       │
│  │  ├─ chatPresence (撞车判断)                                   │       │
│  │  ├─ proactive_schedules (定时器配置)                          │       │
│  │  └─ ... 50+ stores                                            │       │
│  └──────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

**Sully 主聊天 / 主动消息共用的核心链路**：

```
┌─────────────────────────────────────────────────────────────────┐
│  ChatPrompts.buildSystemPrompt(char, user, ctx, ..., isProactive) │
│  ├─ BP1 Tools  ─┐                                                 │
│  ├─ BP2 Rules  │  共用同一套分段                                   │
│  ├─ BP3 Context│                                                  │
│  └─ dynamicTail┘                                                  │
│       ↓                                                            │
│  LLM  ←──┬── char.memories (老)                                   │
│          ├── memoryPalace (新, 7 rooms + EventBox + Anticipation)  │
│          ├── char.activeBuffs / buffInjection                      │
│          ├── char.selfInsights                                     │
│          ├── char.impression (用户对角色的印象)                     │
│          ├── char.customTimezone (角色时区)                         │
│          └── ...                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 给 GPT 的下一步设计请求

暮色 9-4 明确想做的下一阶段是 **"关系记忆 + 主动人格 + 冲突修复机制"**。

基于上面的现状盘点，**目前明确缺失的**：

1. **关系状态结构**
   - 当前关系阶段（暧昧 / 亲密 / 平淡 / 疏远 / 冲突中 / 修复中）
   - 关系事件里程碑（第一次见面 / 第一次约会 / 第一次吵架 / 重要承诺）
   - 亲密度的时序变化曲线
   - "上次冲突距今 X 天 / 修复状态如何"

2. **冲突状态结构**
   - 未解决冲突（话题 / 双方立场 / 上次沟通时间 / 现状）
   - 触发的敏感话题（哪些话题让用户难受过）
   - 用户当下的开放情绪（"他最近回消息短了" / "他最近发消息多" / "他最近提了某个词"）

3. **主动消息决策层（从规则→LLM 决策）**
   - 模型可以决定"这次不发"（明确不发 / 推迟 / 换话题 / 等用户先来）
   - 模型可以决定"换个时间发"（避开用户忙时 / 避开冲突后太快时间）
   - 模型可以决定"应该主动打开某个话题"（基于关系议程 / 未完成对话）

4. **角色当下状态**（不是人格，是"此刻状态"）
   - 角色当下最想跟用户聊的事（中心议题）
   - 角色当下对用户的感觉（不只是情绪，是"我对他的感觉"）
   - 角色对上次对话的回顾

5. **冲突修复机制**
   - 检测到冲突后的处理（推迟主动消息 / 主动关心 / 道歉 / 重启话题）
   - 修复路径（"我之前 X 话说重了" / "我想收回 Y"）
   - 避免重复冲突（同话题不再戳）

**请 GPT**：
1. 基于上面盘点，**哪些结构应该新建、哪些可以扩展现有结构**？
2. 给出一份**最小可行版本**（不是大而全，能在 1-2 周内落地的那种）
3. 列出**优先级**：先做哪个、依赖什么？
4. 给出**"不破坏现有架构"**的集成方案——不要推翻 BP1-BP3 prompt 体系，而是在它上面加层。

---

**字数**：~7000 字
**代码引用**：`types.ts:1093-1342`, `memoryPalace/types.ts`, `chatPrompts.ts:158-`, `proactiveChat.ts`, `OSContext.tsx:1512-2050`, `amsgFireScene.ts`, `amsgFireSchedule.ts`, `amsg2Tasks.ts`, `activeMsgClient.ts:222-323`
