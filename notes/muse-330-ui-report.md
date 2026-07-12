# muse-330-ui 调研报告（暮色参考项目）

**日期**：2026-07-04
**位置**：`/Users/caijia/Desktop/muse-330-ui/`
**来源**：暮色 2026-07-04 提示 — "330"指的是他桌面的这个文件夹，**不是 SullyOS upstream（NMJ 的仓库）**。之前我误以为 330 是 upstream 的某个 commit 编号，这是错的，暮色后来提醒"我之前和你说过，你忘了"。本文档是给未来 Mavis 看的事实档案。

---

## 1. 这是啥

**E-phone / Online-chat 项目** — 另一个独立的小手机模拟器，作者不是暮色，是暮色 fork 的上游在维护。

跟 SullyOS 的核心差异：

| 项 | muse-330-ui | SullyOS-master |
|---|---|---|
| 架构 | **vanilla JS** + 多 js 模块（jQuery 风格） | React 18 + TypeScript + Vite |
| 数据 | **Dexie (IndexedDB)** + localStorage | localStorage + Netlify Blobs + Neon DB |
| 路由 | 多 `screen` show/hide（DOM 切换） | 状态机式 React 组件切换 |
| 部署 | 静态 HTML + WebSocket server（`package.json` 只一个 `ws` 依赖） | Vercel + Netlify Functions |
| 总规模 | `script.js` 一个文件 + `modules/` 60 个 + `js/` 2 个 | 30+ 个 `apps/*.tsx` 组件 |

**重要结论**：330 的代码不能直接复制到 SullyOS（架构不兼容），但**思路、prompt 模板、触发机制可以扒过来重写成 React**。

---

## 2. 顶层结构

```
muse-330-ui/
├── index.html              # 单页 HTML 入口
├── 330--main/index.html    # iframe 子页（情侣空间用）
├── package.json            # 只有 ws 依赖（WebSocket server）
├── script.js               # 主入口（很大，包含全局初始化）
├── modules/                # 60 个功能模块
│   ├── qzone.js            # ⭐ 朋友圈核心
│   ├── ai-response.js      # ⭐ AI 响应 + 朋友圈 awareness 注入
│   ├── chat-interface.js   # 聊天界面
│   ├── chat-input.js       # 聊天输入框
│   ├── chat-list.js        # 聊天列表
│   ├── couple-space.js     # ⭐ 情侣空间（"AI 自主决定" 事件驱动模式）
│   ├── ai-group.js         # 群聊 AI
│   ├── prompt-manager.js   # ⭐ 提示词模板（singleChat 等）
│   ├── character-generator.js
│   ├── persona-library.js
│   ├── moments...          # 没了，全在 qzone.js
│   └── ...
├── couple-space.js         # 独立大文件（不是模块）
├── online-chat-integration.js / online-chat-manager.js  # 真人联机
├── css/  manifest.json  focus-timer.js ...
```

---

## 3. 朋友圈（qzone.js）核心机制

文件：`modules/qzone.js`（1053 行）

### 3.1 数据模型（Dexie schema）

```javascript
db.qzonePosts = {
  id, type, timestamp, authorId,
  content, publicText, hiddenContent,
  imageUrl, imageDescription, imagePrompt, imageUrls,
  likes: [name],
  comments: [
    { commenterName, text, meaning, timestamp, replyTo? }
  ],
  visibleGroupIds, visibleTo,
  isDeleted, repostComment, originalPost
}
db.qzoneSettings = { nickname, avatar, banner }
```

### 3.2 ⭐ 朋友圈 ↔ 聊天 互通（暮色要的"AI 不知道给评论了"的答案）

**Layer 1：每次 Chat System Prompt 注入**（`modules/ai-response.js:2599-2673`）

```javascript
const allRecentPosts = await db.qzonePosts.orderBy('timestamp').reverse().limit(5).toArray();
const visiblePosts = filterVisiblePostsForAI(allRecentPosts, chat);

let postsContext = "";
if (visiblePosts.length > 0) {
  postsContext = "\n\n# 最近的动态列表 (供你参考和评论):\n";
  for (const post of visiblePosts) {
    let authorName = ...; // 'user' / chat 角色 / NPC
    if (post.authorId === chatId) authorName += " (这是你的帖子)";

    let contentSummary = ...; // 处理 repost / image_post / text_image / naiimag / googleimag

    postsContext += `- (ID: ${post.id}) 作者: ${authorName}, 内容: "${contentSummary}"\n`;

    if (post.comments?.length) {
      for (const comment of post.comments) {
        if (comment.commenterName === aiOriginalName) {
          postsContext += `  - 你评论说: ${commentText}\n`;
        } else {
          postsContext += `  - 评论: ${displayName} (本名: ${comment.commenterName}): ${commentText}\n`;
        }
      }
    }
  }
}
```

然后在 `prompt-manager.js:55` 的 `singleChat` 模板里用 `${postsContext}` 占位符注入。

**Layer 2：事件驱动 Push Hidden System Message**（`modules/qzone.js:528-541`）

用户在朋友圈表情评论时（仅表情评论，文字评论没看到对应代码）：

```javascript
async function sendQzoneStickerComment(postId, sticker) {
  // ... 保存评论到 db

  for (const chatId in state.chats) {
    const chat = state.chats[chatId];
    if (!chat.isGroup) {
      const intelligentPrompt = `[系统提示：'${nickname}' 在你的动态(ID: ${postId}, 内容摘要: "${postSummary}")下发送了一个表情评论，意思是："${sticker.name}"。请你对此作出回应。]`;

      const historyMessage = {
        role: 'system',
        content: intelligentPrompt,
        timestamp: Date.now(),
        isHidden: true            // ⭐ 关键 flag
      };
      chat.history.push(historyMessage);
      await db.chats.put(chat);
    }
  }
}
```

情侣空间解除绑定（`couple-space.js:303-307`）用同样模式：

```javascript
const unbindMsg = {
  role: 'system',
  type: 'system_notification',
  content: `[系统提示："${myNickname}"刚刚解除了与"${charName}"的情侣空间绑定。]`,
  isHidden: true,
  timestamp: Date.now()
};
chat.history.push(unbindMsg);
await db.chats.put(chat);
```

### 3.3 `isHidden` 的作用（`ai-response.js:1420/1554/2441/2093`）

读 chat history 时：
```javascript
.filter(m => !m.isHidden)   // 隐藏消息不作为对话 history 发给 LLM
.filter(m => !m.isExcluded && !m.isHidden && (m.role === 'user' || m.role === 'assistant'))
```

**但 hidden message 仍然在 system prompt 注入阶段会被读到**（`couple-space.js:716` 的 `chat.history.filter(m => !m.isHidden).slice(-memoryCount)` 是过滤后取，所以 hidden message 不会作为对话历史），不过——等等，**这是矛盾**。再确认：

- 上一段说"隐藏消息不作为对话 history 发给 LLM" — 是的
- 朋友圈 awareness 的 postsContext 是单独读 `db.qzonePosts`，不是从 `chat.history` 拿 — 所以跟 isHidden 无关
- push 到 chat.history 的 hidden system message 是给 LLM 看的（"用户在朋友圈做了 X"），下次 Chat 调 LLM 时如果系统拼 prompt **把 chat.history 也拼进去**，那 isHidden 会被 filter 掉，hidden message 就看不见了

**所以 330 的 Layer 2 push hidden message 在 SullyOS 移植时要看清楚**：SullyOS 的 chat prompt 拼装得是不是直接 map `chat.history`？如果是，hidden message 会被 filter，得改成 context.ts 加专门的 section 注入 hidden message。

### 3.4 AI 朋友圈行为的 prompt 模式（`modules/ai-response.js:2599-2656` 之后到 2943+）

暮色 2026-07-03 已经在 SullyOS 实现了 3 个核心 API（见 `utils/momentsAI.ts`）：
- `generatePost` — AI 发朋友圈
- `generateComment` — AI 评论用户朋友圈
- `generateTriggerDecision` — 决定是否主动发聊天消息

跟 330 的 `qzone.js` + `couple-space.js` 的 trigger 模式**完全对齐**。SullyOS 已经照搬过来了。

### 3.5 朋友圈"可见性"过滤（`qzone.js:851-892`）

```javascript
function filterVisiblePostsForAI(allPosts, viewerChat) {
  // 用户帖：检查 visibleGroupIds（如果设置了就按 groupId 过滤）
  // NPC 帖：检查 visibleTo（指定角色可见）
  // 角色帖：检查是否同 group 或都未分组
}
```

SullyOS 当前 MomentsPage **没有这个可见性机制**（所有角色都看所有 post）—— 移植时要确认是不是要补。

---

## 4. 情侣空间（couple-space.js）核心机制

文件：`couple-space.js`（5770 行）

### 4.1 "AI 自主决定" 事件驱动模式（`couple-space.js:65-110`）

```javascript
const featureConfigs = [
  { settingsKey: 'coupleDiarySettings_',  trigger: triggerAutoDiaryWrite },
  { settingsKey: 'coupleAlbumSettings_',  trigger: triggerAutoAlbumPost },
  { settingsKey: 'coupleChecklistSettings_', trigger: triggerAutoChecklistRecommend },
  { settingsKey: 'coupleMessageSettings_',  trigger: triggerAutoMessagePost },
  { settingsKey: 'coupleMoodSettings_',  trigger: triggerAutoMoodPost },
  { settingsKey: 'coupleTimelineSettings_', trigger: triggerAutoTimelinePost },
  { settingsKey: 'coupleLetterSettings_', trigger: triggerAutoLetterPost },
  { settingsKey: 'coupleGardenSettings_', trigger: triggerAutoGardenWater },
  { settingsKey: 'coupleLocSettings_',   trigger: triggerAutoLocationPost },
  { settingsKey: 'coupleFinanceSettings_', trigger: triggerAutoFinancePost },
];

function triggerCoupleSpaceAiDecide(charId, source) {
  // source: 'chat' (聊天后触发) / 'background' (后台活动触发)
  // 每个 feature 按概率（默认 chat 15% / bg 5%）独立决定要不要触发
}
```

### 4.2 概率配置（用户可调）

`aiDecideChatProb` / `aiDecideBgProb` — 默认 15% / 5%

### 4.3 离线保存 / iframe 推送

```javascript
function sendOrSaveCoupleSpaceData(charId, msgObj, storageKey, itemToSave) {
  const iframe = document.getElementById('couple-space-iframe');
  const isIframeOpen = iframe && iframe.src.includes('330--main/index.html') && localStorage.getItem('coupleSpaceLastId') === charId;

  if (isIframeOpen && iframe.contentWindow) {
    iframe.contentWindow.postMessage(msgObj, '*');  // iframe 开着就推
  } else if (storageKey && itemToSave) {
    // 没开就 localStorage 暂存，下次打开再读取
    const items = JSON.parse(localStorage.getItem(storageKey + charId) || '[]');
    items.push(itemToSave);
    localStorage.setItem(storageKey + charId, JSON.stringify(items));
  }
}
```

### 4.4 配套 API 配置（独立于主 API）

```javascript
function getCoupleSpaceApiConfig() {
  const useCoupleSpaceApi = state.apiConfig.couplespaceProxyUrl && 
                            state.apiConfig.couplespaceApiKey && 
                            state.apiConfig.couplespaceModel;
  if (useCoupleSpaceApi) {
    return { proxyUrl, apiKey, model: ... };  // 独立 API
  } else {
    return { ...主 API };  // 回退
  }
}
```

**SullyOS 是否要做？** — 暮色 2026-07-03 拍板的 `utils/momentsAI.ts` 已经做了独立 API 的路子（每个 AI 调用都显式传 `apiConfig`）。情侣空间这一套独立 API 模式可以**未来参考**，SullyOS 现在没情侣空间（wishlist 里）。

---

## 5. 提示词模板（prompt-manager.js）

文件：`prompt-manager.js`（470 行）

### 5.1 singleChat 模板核心结构

```
# 【最高指令：沉浸式角色扮演】
...

# 【Part 1: 你是谁 & 你的世界】
## 1. 你的核心设定 (Persona)
${chat.settings.aiPersona}
## 2. 世界观法则 (World Book)
${worldBookContent}
## 3. 你的长期记忆
${chat.longTermMemory}
${multiLayeredSummaryContext}
${todoListContext}
## 4. 关键关系
- **你的本名**: "${chat.originalName}"
- **我对你的备注**: "${chat.name}"
- **我的昵称**: "${myNickname}"
- **我的当前状态**: ...
${userProfileContext}
${nameHistoryContext}

# 【Part 2: 当前情景 (Context)】
${currentTime} (${timeOfDayGreeting})
${weatherContext}
${timeContext}
- **情景感知**:
${sceneContext}
- **社交圈与动态**:
${contactsList}
${postsContext}            ⭐ 朋友圈 awareness 注入点
```

### 5.2 占位符

所有占位符都是 `${xxx}` 形式，由 `ai-response.js` 提前算好再替换。

`postsContext` 在 line 55 — 这是暮色要的"朋友圈 awareness"的标准注入点。

---

## 6. AI 响应（ai-response.js）

文件：`modules/ai-response.js`（6787 行）

### 6.1 朋友圈相关代码位置

- **line 1420 / 1554 / 2441 / 2093** — `m.isHidden` filter（隐藏消息处理）
- **line 2151 / 2166** — repost 动态作者名解析
- **line 2599-2673** — ⭐ 朋友圈 awareness prompt 注入（核心）
- **line 2682-2706** — timeContext（lastUserMsg / lastAiMsg）
- **line 2708** — readingContext
- **line 2711-2728** — 多时段总结（3h / 6h / 9h / today / 3d / 7d）
- **line 2943+** — 动态指令 prompt

### 6.2 时间感知（line 2682-2706）

```javascript
if (lastUserMsg) {
  const lastUserMessageTime = formatTimestampForAI(lastUserMsg.timestamp);
  if (lastAiMsg) {
    const timeDiffHours = (lastUserMsg.timestamp - lastAiMsg.timestamp) / (1000 * 60 * 60);
    if (timeDiffHours > 3) {
      longTimeNoSee = true;
      // ... "好久不见" prompt
    }
  }
}
```

**SullyOS 已有同款逻辑**（`utils/chatPrompts.ts:14-25` 的 `getTimeGapHint`）。

---

## 7. 我们能用啥（暮色要的"能用的就扒过来"）

### 7.1 ✅ 已经在用（SullyOS 已实现）

| 330 的功能 | SullyOS 的实现 | 差异 |
|---|---|---|
| `qzone.js` 朋友圈 trigger 模式 | `utils/momentsAI.ts` (commit 2026-07-03) | React 重写，逻辑等价 |
| `couple-space.js` 事件驱动 trigger | `triggerAIReaction` 同样事件驱动 | 同上 |
| 独立 API 配置 | `momentsAI.ts` 的 `apiConfig` 参数 | SullyOS 没做"独立 API" |
| `isHidden` flag | `chat.history` 暂未使用 isHidden | 待补 |
| `filterVisiblePostsForAI` 可见性过滤 | **未实现** | 移植时考虑 |

### 7.2 ⭐ 重点要扒的（暮色 2026-07-04 当前需求）

**"chat ↔ 朋友圈 awareness 互通"**：

- **Layer 1 注入**（关键！）：照搬 `ai-response.js:2599-2673` 的 postsContext 拼装逻辑 → SullyOS 应该在 `utils/context.ts` 的 `ContextBuilder.buildCoreContext` 里加一个 `### 最近朋友圈动态` section，调用方（Chat.tsx / GroupChat.tsx / JournalApp.tsx / RoomApp.tsx / StudyApp.tsx）传最近的 posts 进来
- **Layer 2 事件 push**：照搬 `qzone.js:528-541` + `couple-space.js:303-307` 的 `chat.history.push({ role: 'system', isHidden: true, ... })` 模式 → SullyOS 在 `utils/momentsAI.ts` 的 `triggerAIReaction` 和 `publishPostAsChar` 加 hook

### 7.3 ❌ 用不上的

- Dexie / IndexedDB schema — SullyOS 用 localStorage / Blobs / Neon
- jQuery / vanilla DOM 操作 — SullyOS 用 React
- WebSocket 真人联机 — SullyOS 没这个 feature
- iframe 推送机制 — SullyOS 没这个架构
- 情侣空间全套功能 — SullyOS wishlist，未来再做

---

## 8. 给新 Mavis 窗口的 quick reference

**暮色要"对比 330 的，能用的就扒过来"时，按这个顺序看：**

1. **朋友圈 ↔ chat 互通**：先看本文 §3.2（最关键），再去看 `muse-330-ui/modules/qzone.js:496-544`（表情评论 push hidden message 原型）和 `muse-330-ui/modules/ai-response.js:2599-2673`（朋友圈 awareness 注入）
2. **情侣空间**："AI 自主决定"事件驱动模式 → `couple-space.js:65-110`（featureConfigs + 概率触发）
3. **提示词结构**：朋友圈 awareness 注入点在 `prompt-manager.js:55` 的 `${postsContext}` 占位符
4. **可见性过滤**：`qzone.js:851-892`（暮色要不要补，由他决定）

**踩坑提醒**：

- 330 的 chat prompt 拼装是**直接 map chat.history**，所以 `isHidden` 是 filter 掉的 flag
- SullyOS 的 `chatPrompts.ts` 没看到直接用 isHidden，**确认下 SullyOS 的 Chat 调 LLM 时 messages 是怎么拼的**（line 1712 的 fetch 调用是关键，要看 messages 怎么来）
- 暮色说"扒过来"不等于"复制粘贴" — SullyOS 是 React + IndexedDB/Blobs 架构，得**重写**，不能直接 import 330 的 js