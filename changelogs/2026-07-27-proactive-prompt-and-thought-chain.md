# 主动消息 prompt 重写 + thought_chain 思维链前置

**日期**：2026-07-27
**涉及 commit**：`5b68007`

## 改了什么

### ① 重写主动消息 hidden system hint（`OSContext.tsx` runProactive）

**问题**：原 prompt 把角色钉在"为用户服务"位置，举例全是"天气/食物/见闻"，还限制"一两句话就好"——结果 AI 全在"关心起居"。

**新版 5 个核心改动**（参考 330 Part 5 行为铁律）：

1. **角色定位**：从"你想主动找用户"改成"你今天有自己的事、自己的心情、自己的想法"——不是为用户而活
2. **删除硬限制**：去掉"一两句话就好"——长度看场景
3. **加"不发"选项**：明确说"如果没什么想说的就不发，不需要每次硬挤"
4. **内容范围扩大**：从"天气/食物/见闻"扩到"看到/想到/吐槽/问一句/突然想到你"
5. **注入最近 8 条对话原文**（user + assistant）——让 AI 有真实素材可参考，不靠编

### ④ 加 thought_chain 思维链前置

**机制**：AI 在消息开头用 `[[THOUGHT: 你在想什么、为什么想发、想表达什么]]` 写心里话，ChatParser 自动清洗不渲染给用户。

**为什么**：让 AI 在产出前先整理思路（"我今天在干嘛、为什么想找用户"），结果更连贯、更有"自己的事"感，不容易陷入"关心起居"模式。

**注意**：是软提示，**不强制** AI 用——简单一条消息可以跳过；想认真说点什么时再用。

## 动了哪些文件

- `context/OSContext.tsx` — runProactive 里的 hidden system hint 整段重写（line 1391 附近）
  - 新增变量：`recentChatContext`、`gapLongEnough`、`hintLines`
  - 删了原单行拼接的 content
- `utils/chatParser.ts` — sanitize 方法的 action tag 正则加 `THOUGHT`
  - hasDisplayContent 不用改——它的 `\[\[[\s\S]*?\]\]` 已经覆盖所有 `[[...]]`

## 踩坑 / 需要知道的（重要）

- **模板字符串要写对**：`'你是 ${char.name}，不是...' ` 是单引号字符串，**不会插值**——必须改成 `` ` ` `` 反引号。第一版踩了，立即修了
- **hidden hint 留 history 里**：每次触发都 push 一条新的 hidden hint 到 DB。`getRecentMessagesByCharId` 不过滤 hidden——是原本的设计，hidden 就是通过 user 角色注入 history 让 AI 看到的。contextLimit 500 之后会自然挤掉旧的
- **thought_chain 不强制**：AI 可能不用。**好处**：就算不用，sanitize 也不会误伤（空内容等于没写）。**坏处**：AI 不用的话内容质量没保证。下次跑要观察 AI 实际触发率
- **recentChatContext 包含 assistant 主动消息**：会用 `m.role === 'assistant'` 过滤，**包括** isProactive 的——AI 看到自己之前主动发的话可以承接上下文，是好事
- **空响应兜底**：`if (aiContent)` 在 OSContext:1476 已经处理，AI 返回空字符串就不发任何东西

## 备注

- 改完第一次跑观察 3 件事：
  1. AI 是不是真的产出"有自己的事"的内容（不再全关心起居）
  2. AI 触发率（用 thought_chain 的频率）——如果 0% 说明提示不够强
  3. 最近 8 条原文注入效果——是不是引用到了你们之前聊过的话题
- ② 7 个 tool（换头像/改状态/...）暮色说之后再说
- ③ 角色编辑设定/世界书 待定
- ⑤ 漏触发补偿 不要
- ⑥ 头像/状态 UI 改造 暂放
- C 架构调整（AI 自发想发）排在最后，看这版效果再决定
