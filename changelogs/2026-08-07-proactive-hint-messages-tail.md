# 主动消息 hint 位置调整：messages 数组最末（紧贴 history 末尾）

**日期**：2026-08-07 19:14
**暮色反馈**：15da1b1 改完后主动消息没识别成"主动发消息"——hint 在 system prompt 末尾被 20 条 history 淹没

## 改了什么

暮色原话：
> 主动消息的提示要放在上下文末尾（即 system prompt 最底部，或者紧贴着最新消息之前）：指令的权威性和存在感最强。AI刚读完这条提示，紧接着就要输出文字，它会非常明确"我现在是主动发消息"这个情境。

**位置对比**：
| 位置 | 优先级 | 暮色评分 |
|---|---|---|
| system prompt 开头 | 低 | ❌ 容易被忽略 |
| system prompt 末尾 | 中 | ⚠️ 暮色试过，hint 被 20 条 history 淹没 |
| **messages 数组最末（紧贴 history 末尾）** | **高** | ✅ 暮色拍板 |

**最终方案**：
- hint 从 `systemPromptParts` 数组**移除**（不再在 system prompt 末尾）
- hint 加到 `fullMessages` 数组**最后一条**（`{ role: 'system', content: hintLines }`）
- 角色读 messages 顺序：system prompt → 20 条 history → **hint** → 必须输出
- hint 仍然以 `proactiveHint: true, hidden: true` 存 IDB（保持时间戳计算 + UI 不显示）

## 动了哪些文件

- `context/OSContext.tsx:1633-1648` — `systemPromptParts` 移除 hintLines；`fullMessages` 末尾加 `{ role: 'system', content: hintLines }`
- `changelogs/2026-08-07-five-bugs-chat-polish.md` — 标注 Bug 5 这次是第二版（第一版在 system prompt 末尾被暮色否定）

## 踩坑 / 需要知道的（重要）

### 1. 第一版（system prompt 末尾）的失败教训
- 暮色 19:14 反馈："主动消息没识别成主动发消息"——因为 hint 在 system prompt 末尾，AI 读 system 后还要读 20 条 history（用户跟 AI 的对话），hint 早就被淹没了
- AI 把这次响应**当成普通聊天回复**（"接着用户上一句话回复"），不是"主动发消息"
- 第一版代码已撤掉（这次 commit 替换）

### 2. role='system' 而不是 role='user' 的原因
- 8-6 fix 矫枉过正：hint 之前以 `role: 'user', metadata: { proactiveHint: true, hidden: true }` 存 IDB
- AI 看到 `role: 'user'` 误以为是"用户最新说的话"，hint 内容被当成 user 发言
- 这次挪到 messages 数组末尾时**保留** role='system'——OpenAI / Claude / Gemini 三套协议都支持 messages 数组里多 system role
- hidden: true 让 UI 不显示这条 hint（Chat.tsx 拉 messages 时 filter 掉 metadata.proactiveHint）

### 3. 跟 8-6 fix 的关系
- 8-6 fix：hint 存 IDB + history filter 时跳过（避免 messages 末尾的 hint 污染 user 角色历史）
- 这次：hint 仍存 IDB（保留时间戳 + hidden 逻辑） + **多发一份** role='system' 副本到 messages 数组末尾
- 两份 hint 是**独立**的：IDB 那份只用于时间戳 / UI 隐藏；messages 末尾那份是给 LLM 看的"系统提示"

### 4. cache 命中影响
- OpenAI 协议 cache_control 通常打在 system prompt 字段上 → 挪到 messages 末尾不影响 cache（cache 在 system prompt 段）
- Claude 协议 cache 也按 system 字段分段 → 同上不影响
- Gemini 协议类似
- 暮色已确认 cache 不用考虑（5 分钟 TTL，主动消息本来就不缓存）

## 备注
- 这次是 8-7 那批 5 个 bug 修复的**第二版**——暮色 8-7 17:51 第一次 commit 后半小时反馈"提示位置不对"，这次按暮色要求挪到 messages 末尾
- 接下来等暮色 Vercel 部署验证"主动发消息"识别是否正确
