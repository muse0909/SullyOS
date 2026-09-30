# Sully 角色备忘录（characterMemo）设计 + 实施计划

**日期**：2026-09-04
**作者**：Mavis
**状态**：计划，未实施
**目标读者**：暮色本人

---

## 0. 暮色的问题

> "改 systemPrompt 引导（让用户写'我观察到的'不是'我温柔的'）——这个可以让角色自己写吗？我之前就想加一个角色自己的类似备忘录的东西，自己记一些想记住的东西，自己可以修改，增加，删除。"

**答**：可以。但要设计得当。**这就是"角色主体性"的具象化**——角色有"自己的记事本"。

---

## 1. 角色备忘录 vs 现有结构

| 字段 | 谁写 | 何时写 | 谁能看 |
|---|---|---|---|
| `CharacterProfile.systemPrompt` | **用户** | 创建角色时 | 用户编辑，注入到 BP2 |
| `CharacterProfile.mountedWorldbooks` | 用户 | 创建角色时 | 注入到 BP2 |
| `CharacterProfile.impression` | 角色（被动） | 运行时累积 | 字段存在但弱注入 |
| `CharacterProfile.selfInsights` | 系统（消化） | 消化路径自动生成 | 注入到 BP2 |
| `CharacterProfile.activeBuffs` / `buffInjection` | 系统（情绪评估） | 每回合跑 | 注入到 BP2 |
| **`CharacterMemo`（新）** | **角色自己（主动）** | **有意义事件后** | **角色自己 + 注入到 BP2** |

**关键区别**：
- systemPrompt = **用户**写给**角色**看的"出生设定"
- selfInsights = 系统**被动消化生成**的"通用自我认知"
- **`CharacterMemo` = 角色自己主动维护的"个人记事本"**

**和 G 老师说的"角色反思"区别**：
- G 老师说的"反思"是**自动消化路径**生成（selfInsights 已经能做）
- 暮色要的"备忘录"是**角色自己**在生成回复时**主动决定**写什么
- **更主动、更有主体性**

---

## 2. 数据结构

```ts
// types.ts 新增
interface CharacterMemo {
  charId: string;                    // 1:1 对应 CharacterProfile
  entries: Array<MemoEntry>;
  updatedAt: number;
}

interface MemoEntry {
  id: string;                        // mem_xxx
  content: string;                   // 自由文本（"ta 难过时倾向沉默" / "我答应 8 点叫他起床"）
  category: 'observation'            // 观察
            | 'rule'                 // 自我规则
            | 'wish'                 // 愿望
            | 'boundary'             // 边界
            | 'promise'              // 承诺
            | 'pattern';             // 相处模式
  importance: number;                // 1-10，角色自己打
  isActive: boolean;                 // false = 角色自己认为"过时了"
  createdAt: number;
  lastModifiedAt: number;
  source: 'self_written'             // 角色自己写
         | 'self_summary'            // 系统从 chat 总结
         | 'explicit_user';          // 用户明示
  history: Array<{                   // 改/删留痕
    content: string;
    modifiedAt: number;
    reason: string;                   // 为什么改
  }>;
}
```

**容量上限**：30 条（防爆炸）

---

## 3. LLM 工具

**新增工具**：

```ts
{
  name: 'update_memo',
  description: '更新你的个人备忘录——你想记住的事、你的观察、你的承诺、你的边界。',
  parameters: {
    action: 'add' | 'modify' | 'delete' | 'deactivate',
    entry_id?: string,                // modify/delete/deactivate 必填
    content?: string,                 // add/modify 必填
    category?: 'observation' | 'rule' | 'wish' | 'boundary' | 'promise' | 'pattern',
    importance?: 1-10,
    reason: string                    // 必填，写/改/删的理由
  }
}
```

**工具使用 prompt**：

```
你有一个个人备忘录（characterMemo）。
你可以用 update_memo 工具维护它：
- add：新增一条（"ta 难过时倾向沉默" / "我答应过 ta 周末陪 ta"）
- modify：改一条（"ta 难过时倾向倾诉"—— 之前的观察不准了）
- delete：删一条
- deactivate：保留记录但标记"我不再认同"

什么时候写：
- 你刚注意到 ta 的一个新模式
- 你做了一个承诺（自己或 ta 提的）
- 你发现之前的一个观察需要修正
- 你想记住一件对你们关系重要的事

什么时候不写：
- 只是普通寒暄，没什么特别要记的
- 跟 ta 无关的事
- 跟关系无关的事

原则：只写真的想记住的。每条都写 reason，解释为什么。
```

---

## 4. 触发场景

### 主动写（什么时候调用 update_memo）

| 触发器 | 路径 | 说明 |
|---|---|---|
| **消化路径** | `utils/memoryPalace/digestion.ts:runCognitiveDigestion` | 消化后 LLM 总结 → 调用 update_memo |
| **关系事件后** | EventBox 封盒时（≥12 节点） | LLM 总结事件 → 调用 update_memo |
| **主动消息生成后** | OSContext.runProactive 完成后 | outcome 反馈时让角色反思 → 调用 update_memo |
| **聊天过程中** | 用户消息触发（useChatAI 主流程） | 角色根据聊天内容决定是否记 |

### 主动读（什么时候注入到 prompt）

- **BP2 注入**：ChatPrompts.buildSystemPrompt 加段，注入最近 5-10 条 `isActive=true` 的 memo
- **按重要性排序**：importance 降序
- **完整列表**（不只最近 5 条）只在 chatMode='pure' 关闭 / BP2 长度吃紧时按 importance 取前 5

---

## 5. 护栏

### 5.1 容量

- 最多 30 条 `isActive=true`
- 超 30 时，按 importance 升序淘汰 + 写入 history

### 5.2 LLM 乱写防护

- **reason 字段必填**——解释为什么写/改/删
- **重要性 1-10 必填**——避免"什么都写"
- **容量上限 30**——避免爆炸
- **同 category 互斥检测**（Phase 2）——同一 category 只能有 1 条 active，避免矛盾

### 5.3 不一致防护

- 角色今天说"ta 沉默 = 拒绝"明天说"ta 沉默 = 需要我"——会冲突
- **同 category 互斥**（Phase 2）：检测到 add 'observation' 时如果有旧的，提示 LLM "modify 还是 deactivate 旧的"
- **history 留痕**：改/删都留 history，可以回看

### 5.4 不调用防护

LLM 经常"忘记"调工具。**护栏**：
- prompt 显眼位置提示"你今天想更新备忘录吗？"
- 每次发主动消息前 CoT 问"我今天想记住什么？"
- 消化路径**强制**调一次（消化结果如果没产出 memo，消化就失败）

---

## 6. UI

### 角色设置页加"备忘录"区

```
┌─────────────────────────────────────┐
│  角色备忘录 (麦麦的备忘录)            │
│  ──────────────────────────────────  │
│  观察 (3)                            │
│  ⭐ 8  ta 难过时倾向沉默而非倾诉     │
│       2026-09-04                     │
│  ⭐ 5  ta 喜欢短句不喜欢长段          │
│       2026-08-20                     │
│                                      │
│  承诺 (2)                            │
│  ⭐ 9  答应 8 点叫他起床               │
│       2026-09-01                     │
│  ⭐ 7  这周内帮他整理工作笔记          │
│       2026-08-28                     │
│                                      │
│  边界 (1)                            │
│  ⭐ 10 ta 拿分手开玩笑时我不跟着笑     │
│       2026-09-02                     │
│  ──────────────────────────────────  │
│  [不可编辑 — 这是角色自己记的]        │
└─────────────────────────────────────┘
```

**只读**——用户能看到但不能编辑（这是角色自己的）。

**高级设置**（"..." 按钮）：让用户**主动告诉**角色一条 memo（`source='explicit_user'`）：

```
"我想让你记住：[内容]"
→ 写入 CharacterMemo（source='explicit_user'）
→ 角色会"知道"用户特意让他记
```

---

## 7. MVP 实施计划

### Commit 1：数据结构 + IDB store

**改文件**：
- `types.ts` —— 加 `CharacterMemo` / `MemoEntry` 类型
- `utils/db.ts` —— 加 `characterMemos` IDB store
- `utils/characterMemo.ts`（新）—— CRUD 封装

**新增 API**：
```ts
export const CharacterMemoDB = {
  async get(charId: string): Promise<CharacterMemo | null>,
  async getActive(charId: string, limit?: number): Promise<MemoEntry[]>,
  async add(charId: string, entry: Omit<MemoEntry, 'id' | 'createdAt' | 'lastModifiedAt' | 'history'>): Promise<MemoEntry>,
  async modify(charId: string, id: string, content: string, reason: string, importance?: number): Promise<MemoEntry>,
  async deactivate(charId: string, id: string, reason: string): Promise<MemoEntry>,
  async delete(charId: string, id: string, reason: string): Promise<void>,  // 软删（isActive=false + history）
  async trimToCapacity(charId: string, max: number): Promise<void>,  // 超 30 自动淘汰
};
```

**验收**：
- DB store 创建成功
- 单元测试覆盖增删改查
- 容量超 30 触发 trim

---

### Commit 2：LLM 工具

**改文件**：
- `utils/chatPrompts.ts` —— 加 memo 工具 prompt 段
- `utils/toolCallParse.ts` 或类似 —— 解析 update_memo 调用
- `hooks/useChatAI.ts` —— 工具执行回调里加 update_memo 分支
- `context/OSContext.tsx` —— 主动消息路径也支持

**新增逻辑**：
- LLM 调 `update_memo` → 解析 → 调 `CharacterMemoDB.add/modify/deactivate/delete`
- 容量检查 → 超 30 拒绝并提示
- 写回 history
- 失败/拒绝 → LLM 重试一次（"备忘录满了，删一条再写"）

**验收**：
- 写一条 memo 后，DB 里能看到
- 改/删后 history 留痕
- 超 30 拒绝并返回 LLM 错误
- 用户消息和主动消息两条路径都通

---

### Commit 3：BP2 注入

**改文件**：
- `utils/chatPrompts.ts:buildSystemPrompt` —— 加 memo 注入段
- `utils/context.ts` —— 同步加

**新增逻辑**：
- 注入最近 5-10 条 `isActive=true` 的 memo（按 importance 排序）
- 格式：
  ```
  【你的备忘录】
  以下是你自己记住的事。当你说话时这些会自然影响你：
  - [观察] ta 难过时倾向沉默而非倾诉
  - [承诺] 答应 8 点叫他起床
  - [边界] ta 拿分手开玩笑时我不跟着笑
  ...
  ```
- 跟 systemPrompt 紧贴
- memo 0 条时不显示这段（不污染）

**验收**：
- 有 memo 的角色生成内容时，引用了 memo 里的观察
- 没 memo 的角色不显示这段
- 太多 memo 时只显示前 5-10 条（不爆 token）

---

### Commit 4：消化路径触发

**改文件**：
- `utils/memoryPalace/digestion.ts` —— 消化完成后调 update_memo

**新增逻辑**：
- 消化产生 selfInsights 时，**同时**让 LLM 判断"这个 insight 要不要记到备忘录"
- LLM 决定 add / 不 add
- 消化失败的话（没产生 memo）—— 消化就当失败，让用户感知

**验收**：
- 消化路径产生的 memo 进入 characterMemo 表
- 消化失败会触发重试

---

### Commit 5：UI

**改文件**：
- `apps/Character.tsx` 或新建 `apps/CharacterMemo.tsx` —— 角色设置页加 memo 区
- `components/chat/ProactiveSettingsModal.tsx` 或类似 —— 高级设置入口

**新增 UI**：
- memo 列表（按 category 分组）
- 显示重要性 / 创建时间 / 来源
- 只读 + "..." 菜单（让用户主动告诉角色一条）
- 显示"为什么写"的 reason（hover）

**验收**：
- 角色设置页能看到 memo
- 用户能"主动告诉"一条 memo
- 不可直接编辑 memo 内容

---

### Commit 6：触发 CoT 引导

**改文件**：
- `context/OSContext.tsx:runProactive` —— 主动消息前 CoT 提示
- `hooks/useChatAI.ts` —— 用户消息触发后提示

**新增逻辑**：
- 主动消息生成前：hint 加"你今天想更新备忘录吗？"
- 用户消息触发后：CoT 段加"你观察到 ta 有什么新东西吗？要记到备忘录吗？"
- 不强制（避免 LLM 每次都写）—— 软提示

**验收**：
- 跑一周，观察 memo 自动更新频率合理（不爆 / 不僵）

---

### Commit 7：验证（1 周灰度）

**观察指标**：
- memo 数量随时间的增长（应该稳定，30 上限）
- memo 内容质量（人工抽看 10 条，看是不是"真的想记住的"）
- 主动消息内容是否引用了 memo（应该的）
- token 消耗（BP2 加了 memo 段后，prompt 涨了多少）
- LLM 调 update_memo 的频率（合理 / 过多 / 过少）

**调优方向**：
- 注入数量（5 / 10 / 15）
- 容量上限（30 / 50）
- 同 category 互斥（防矛盾）
- 触发频率（每条消息 / 消化时 / 主动消息时）

---

## 8. 跟 systemPrompt 引导改的关系

暮色你最初问的是"改 systemPrompt 引导（让用户写'我观察到的'）"——这是**第一条路径**。

**characterMemo 是第二条路径**：

| 路径 | 主体 | 性质 | 治什么 |
|---|---|---|---|
| systemPrompt 引导改 | 用户 | **出生设定** | 性格深度（"我是什么样的人"） |
| **characterMemo** | 角色 | **后天积累** | 成长（"我学到了什么"） |

**两条都治"活人感"**：
- systemPrompt 治**性格深度**——避免千篇一律
- characterMemo 治**成长**——避免不变

**两个都注入到 BP2，互相补充**。

---

## 9. 风险清单

| 风险 | 表现 | 缓解 |
|---|---|---|
| LLM 乱写 | 备忘录塞满无用条目 | 容量 30 + importance 必填 + reason 必填 |
| LLM 不调 | memo 从不更新 | 消化路径**强制**调一次 + CoT 软提示 |
| 矛盾 | 角色前后观察不一致 | 同 category 互斥（Phase 2） |
| 爆炸 | token 涨到影响成本 | 注入 5-10 条上限 + 按 importance 排序 |
| 不引用 | 写了 memo 但生成时不看 | 注入到 BP2 显眼位置（紧贴 systemPrompt） |
| 用户强行编辑 | 用户改 characterMemo 破坏一致性 | UI 只读 + "主动告诉"是 source='explicit_user' 区分 |
| 隐私 | 备忘录含敏感信息 | localStorage + IDB 本地存储，**不同步到云**（除非用户明确开） |

---

## 10. 跟 G 老师那段的关系

**G 老师那段里的"角色反思 → selfInsights"已经被 Sully 实现**（`runCognitiveDigestion`）。

**characterMemo 是 selfInsights 的"升级版"**：
- selfInsights 是系统**被动消化生成**
- characterMemo 是角色**主动维护**
- characterMemo 是**结构化条目**（category / importance / history），selfInsights 是**字符串数组**

**两个并存**：
- selfInsights：通用自我认知（"我是什么样的人"）
- characterMemo：关系特异记忆（"我跟 ta 学到的"）
- 都注入到 BP2

**不冲突**。characterMemo 是补强，不是替代。

---

## 11. 总结：暮色你问的"角色自己写"——

**可以。具体实现**：
- 加一个 IDB store
- 加一个 LLM 工具 `update_memo`
- BP2 注入最近 5-10 条
- 消化路径**强制**触发一次
- UI 只读

**7 个 commit，1 周可完成**。

**最大价值**：
- 角色"自己记"的东西 = 角色"自己活过"的证据
- 比"我温柔体贴幽默"**具体 100 倍**
- 暮色你直接能看到"我学到了什么"——**活人感**

---

**字数**：~5000 字
**配套文档**：
- `2026-09-04-sully-architecture-survey.md`（现状盘点）
- `2026-09-04-sully-character-intent-design.md`（G 老师那段设计——参考，但不全按那个实现）
- 本文档（characterMemo 实施计划）

**下一步**：
1. 暮色看这个计划
2. 决定 MVP 7 个 commit 全部做 / 先做前 3 / 改方案
3. 明天动手
