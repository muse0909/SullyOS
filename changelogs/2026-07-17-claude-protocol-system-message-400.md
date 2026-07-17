# Claude 协议 400 修复 — messages 数组里去掉 system 角色

**日期**：2026-07-17  
**涉及 commit**：`9aaf3ab`

## 改了什么
走 Anthropic 协议（即享 ccmax2 / 任何接 /v1/messages 端点的服务）一直报 400，错误：

```
messages.164: role 'system' must precede an 'assistant' message or end the array;
the directive-only form (content: [] with output_config) is accepted at any position
```

根因是 **Anthropic 协议要求 messages 数组里只有 user/assistant 两种角色**，system 必须放在顶层 system 字段（`baseReqBody.system = [...]`），不能穿插在 messages 中间。代码里两处违反了这个规则：

1. **history 里的 system 消息**——`hooks/useChatAI.ts` 多处 `DB.saveMessage({...role: 'system'...})`（日记 / 飞书日记 / 记事本 / 小红书搜索/发布/评论 / 连接中断），下轮对话 `buildMessageHistory` 时原样进 `apiMessages`，**role 还是 'system'**，穿插在 user/assistant 序列里。截图里 messages.164 大概率就是某条。

2. **末尾 push 的 6 条 system 消息**——`useChatAI.ts:1022-1060`：
   - bilingual reminder
   - realtimeText（实时时间）
   - innerState（意识流）
   - privateNotesText（私密记事）
   - recentEmotions（最近心声）
   - memoryPalace（记忆宫殿）
   
   末尾 system 消息按 Anthropic 新版协议可以用，但 **content 必须是空 array `[]`（directive-only form）**，我们用的是 string content，所以也不算合规。

### 修法

**修 1（history 里的 system 消息）**——Claude 协议下把它们**转成 user 角色**（前面加 `[系统消息]` 前缀）：
- 信息不丢（LLM 仍能看到）
- 协议合规（messages 里没 system 了）
- OpenAI 协议不受影响（OpenAI 协议本来就允许 system 在 messages 任意位置）

**修 2（末尾 6 条 system 消息 push）**——Claude 协议下把它们**合并到顶层 `system` 字段的最后一个 text block**（不带 cache_control，纯动态尾巴）：
- Anthropic 协议合规（messages 里没 system）
- 4 段 cache 命中结构不变：bp1/bp2/bp3 哈希不变（不依赖 dynamic tail），bp4 在改动首轮重建一次后下轮又稳定
- 动态信息照样能传达给 LLM
- OpenAI 协议保留原样（OpenAI 协议允许 system 在 messages 任意位置，保留原 push 行为）

## 动了哪些文件
- `hooks/useChatAI.ts` —— 单文件修改
  - line 808：`cleanedApiMessages` 从 `const` 改 `let`（为 Claude 协议下二次清洗铺路）
  - line 911 后：Claude 协议下把 history 里 `role: 'system'` 全部转成 `role: 'user'`（前面加 `[系统消息]` 前缀）
  - line 1038-1100：把原来末尾 6 条 `fullMessages.push({ role: 'system', content: ... })` 改成
    - Claude 协议：合并到 `claudeSystemField` 第 4 个 text block（不带 cache_control）
    - OpenAI 协议：保留 push 行为

## 踩坑 / 需要知道的（重要）

### 1. 这个修复只影响 Claude 协议分支
OpenAI 协议分支（默认）的 fullMessages 构造、push 行为、cleanedApiMessages 全部**完全不变**。已切 OpenAI 协议的用户没有任何影响。

### 2. 4 段 cache 命中结构
- **bp1（bp1Tools）**：挂 cache_control，纯静态 → 不变
- **bp2（bp2Rules）**：挂 cache_control，纯静态 → 不变
- **bp3（bp3Context）**：挂 cache_control，含角色卡/世界书/朋友圈/日记/笔记 → 不变（**这次没动 bp3 内容**）
- **bpDynamic（新加）**：不带 cache_control，6 段动态尾巴拼一起 → 跟之前的 6 条 push 行为等价
- **bp4（history 最后一条）**：挂 cache_control → 改动首轮 history 内容变成 user 角色了，bp4 cache 重建一次，下轮又稳定

实际预期：
- 改动前 4 段（bp1+bp2+bp3+bp4）命中
- 改动后 4 段（bp1+bp2+bp3+bpDynamic）命中 + bp4（history）首轮重建
- 第二轮起：4 段都稳定（bp4 跟历史稳定） + bpDynamic 每轮必变（本来就不命中）

### 3. 历史 system 消息的"信息损失"风险
我们的 system 消息有这些来源：

| 来源 | 内容 | 损失影响 |
|---|---|---|
| `DB.saveMessage({role:'system',...,'日记...')}` | `📔 江澈写了一篇日记「xxx」` | 转 `[系统消息] ...`，前缀提示这是系统事件 |
| `DB.saveMessage({role:'system',...,'小红书...')}` | `📕 江澈发了一条小红书...` | 同上 |
| `DB.saveMessage({role:'system',...,'记事本...')}` | `[系统: 江澈在记事本上写道: ...]` | 同上 |
| `DB.saveMessage({role:'system',...,'[连接中断: ...]'})` | 错误提示 | LLM 不需要感知错误本身，转 user 也无影响 |

转 user 角色后 LLM 仍能看到内容，前缀 `[系统消息]` 让模型知道这是事件而不是用户说话。OpenAI 协议分支完全不变。

### 4. 即享 ccmax2 + Anthropic 协议是否完全可用
- ✅ 这次修了 system 消息的 400 错误
- ⚠️ 之前还提到 Anthropic 限制每条消息最多 4 个 cache_control 标记——我们用满了（system 3 个 + history 1 个），后续想加第 5 段 cache_control 必须合并或砍段
- ⚠️ 4 断点 cache 是否真的在即享 ccmax2 上命中（hash 前缀匹配），还要等实际跑几轮看 cacheControlCount 和响应时间

### 5. OpenAI 协议分支完全没动
之前 6 条 system 消息在 OpenAI 协议下继续 push 到 messages 末尾，行为完全不变。

## 备注
- 即享 ccmax2 站长诊断："走 openai 接口不能加 claude 字段，会被 newapi 丢弃"——这次把 Claude 协议下 cache_control + system 字段挪到顶层的实现也走的是 `baseReqBody.system` 顶层字段，没在 messages 数组里塞
- 暮色接下来可以在 Vercel 部署链接上验证：先在 Settings 把 API 协议切到 Claude，发几条消息，看是否还报 400；同时观察 console 里 `cache_control 标记数` 是否稳定为 4
- 后续如果想继续优化：4 断点 cache 实测命中率（青屿 95%+ 是参考值）、cache_control 标记数是否需要减少以防 Anthropic 限制
