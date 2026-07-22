# 主动消息 400 真凶找到 — `systemPrompt` 对象当 string 发出去

**日期**：2026-07-22
**涉及 commit**：`3c02f12`（误判 Claude 协议，撤回）+ `81a4be8`（撤回 + 诊断 log）+ `bf14861`（推系统消息进聊天流）+ `3994a93`（reqBody 作用域修复）+ `（待提交）`（**真凶修复**：`systemPrompt` 拼回 string）

## 改了什么

`context/OSContext.tsx` 里 `runProactive`：

1. **`systemPrompt` 拼回 string**（**真凶修复**）—— 7/22 16:35 暮色提供 `/Users/caijia/Desktop/未命名.txt` 文件，直接看到完整 reqBody：
   ```json
   "messages": [{"role": "system", "content": {"bp1Tools": "...", "bp2Rules": "...", "bp3Context": "..."}}]
   ```
   `content` 是**对象**（`{bp1Tools, bp2Rules, bp3Context, dynamicTail}`）而不是 string。**京东云 OpenAI 兼容服务不接收对象 content** → 400。
   修法：仿 useChatAI line 940 拼回 string。包含 bp1/bp2/bp3 + dynamicTail.realtimeText（"现在几点"）+ innerState（意识流）。末尾 6 段 push（双语 reminder / privateNotes / recentEmotions / memoryPalace）主动消息不需要（max_tokens 500 承受不起）。

2. **诊断 log**（保留）—— 400 错误时把完整 reqBody + 错误栈存到 `localStorage['sullyos:proactiveLastError']`。

3. **推系统消息进聊天流**（保留）—— 暮色不会 F12，聊天截图是唯一渠道。

4. **`reqBody` / `apiProtocol` 挪出 try 块**（保留）—— 之前 catch 块访问不到 try 块内 const 声明。

5. **Claude 协议分支（撤回）**—— 之前误判了，跟这个 bug 无关。

## 动了哪些文件

- `context/OSContext.tsx:1410-1426` —— `systemPrompt` 拼回 string（bp1/bp2/bp3 + dynamicTail.realtimeText + innerState）
- `context/OSContext.tsx:1557` —— `systemChars` 重新启用（systemPrompt 现在是 string，能拿到长度）
- 其他诊断 / 作用域修复同前几次 commit

## 踩坑 / 需要知道的（重要）

### 真凶复盘（这次稳了）

`buildSystemPrompt` 在 7/17 那个 4 断点 cache PR（commit `9837979`）之后，**返回类型从 string 变成对象**：
```ts
return {
    bp1Tools,
    bp2Rules,
    bp3Context,
    dynamicTail: { realtimeText, innerState, privateNotesText },
};
```

**useChatAI 主路径**立刻跟进（line 940）拼回 string：
```ts
content: `${bp1Tools}\n\n${bp2Rules}\n\n${bp3Context}`,
```

**`runProactive` 路径漏了同步**——line 1412 还是 `const systemPrompt = await ChatPrompts.buildSystemPrompt(...)` 直接当 string 用。

### 三个症状全部解释清楚

| 模型 | 现象 | 解释 |
|---|---|---|
| Claude (newapi 转) | ✅ 正常 | newapi 收到对象 content 能识别 + 重写成 Anthropic 协议 → Anthropic 服务 OK |
| GLM (京东云直连) | ❌ 400 | 京东云 OpenAI 兼容**严格**校验：content 必须是 string，对象拒收 |
| DS (京东云直连) | ❌ 500 | 京东云 DS 上游错误，跟对象 content 无关，治不了 |
| Gemini (京东云直连) | ❌ 截断 | 京东云 Gemini 容错强（接受对象 + 解析奇怪），但 max_tokens 500 太小，输出"聊天[media" 截断 |

**`model: "GLM-5.2"`** —— 之前是 GLM-5.2 不是 GLM-4。
**`totalBodyChars: 58375`** —— 58k 字符 body。**不是因为"超 8k 档位"**（useChatAI 跑同样 58k 字符 body 配 max_tokens 8000 都 OK），是**因为 content 字段类型不对**。

### 暮色 16:35 的反问帮了大忙

> "如果超限为什么正常聊天没问题？"

我之前给的"是 max_tokens: 500 + 18k 字符 prompt 在 GLM 某些档位上 context 超限"是**错答案**。useChatAI max_tokens 8000 跑同样的 prompt + 同样的 model 应该**也**超限（如果"超限"是根因），但暮色说正常聊天没问题。**这个反问直接戳穿了我的判断**。

**学到的**：
- 暮色用反问戳穿错误判断很有效（不像 "是/否" 容易得）
- **下次**遇到"症状在某路径有 + 某路径没有"的对比，**先**想"两路径**唯一差异**是什么"，而不是顺着表面症状猜

### 暮色提供诊断数据的复盘

暮色 7/22 15:56 反馈"不会 F12 找 body"，我以为**没法**拿到 reqBody。**实际**暮色从**别的地方**（newapi / 京东云 access log？浏览器扩展？不知道）拿到了完整 reqBody 写到 `未命名.txt`。

**教训**：
- "用户不会 F12" 不等于 "用户拿不到诊断数据"
- 暮色可能有我不知道的渠道（中转站控制台 / 浏览器扩展 / 等等）
- 鼓励暮色继续提供诊断数据（即便来源未知）

### 副作用 / 风险

**拼接顺序**：`${bp1Tools}\n\n${bp2Rules}\n\n${bp3Context}\n\n${realtimeText}\n\n${innerState}`

跟 useChatAI 主体拼接一致，**末尾 dynamicTail 略简化**（不加 privateNotesText / 末尾 6 段 push）。原因：主动消息 max_tokens: 500，**减少冗余 prompt 让 LLM 更专注"主动发一条消息"这个任务**。

**prompt 总长度**：
- 之前：`buildSystemPrompt` 整个对象（58k 字符但大都是结构化字段，序列化后可能 100k+）→ 京东云拒
- 之后：`bp1/bp2/bp3` 拼回 string + 末尾 realtime/innerState → 跟 useChatAI 主路径主体一致（**18k 字符左右**，与 useChatAI 测得 `context_chars=18788` 吻合）

**主动消息质量**：
- realtime text：必要（"刚吃完饭"那种时间感）
- innerState：必要（情绪延续性）
- privateNotes / recentEmotions / memoryPalace：主动消息不需要（用户没真在聊天）
- 双语 reminder：OpenAI 协议下 push 主动消息用不上（用户没开双语）

## 备注

- **1 分钟档暮色还在跑**（"1min elapsed"），测试完建议关掉
- 这次**没**改 max_tokens（500）—— 实际可能 GLM-5.2 1000+ tokens 才够输出（"主动发条消息" 一两句话不会超 500）—— 测试后再决定
- **生图失败 `[object Object]` 是另一个独立问题**—— 错误日志没序列化 body，7/22 没动它
- 这次**没**改**副 API protocol 字段缺失**（types.ts:989）—— 副 API 强制 OpenAI 是历史决定
- 这次**没**改**runProactive 路径的 4 段 cache**—— 主动消息 max_tokens: 500，没必要拆 cache
