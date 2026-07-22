# 主动消息 400 诊断 log（Claude 协议分支误判撤回 + 推系统消息进聊天流 + reqBody 作用域 bug 修复）

**日期**：2026-07-22
**涉及 commit**：`3c02f12`（误判 Claude 协议，撤回）+ `81a4be8`（撤回 + 诊断 log）+ `bf14861`（推系统消息进聊天流）+ `（待提交）`（reqBody 作用域 bug 修复）

## 改了什么

`context/OSContext.tsx` 里 `runProactive`：

1. **诊断 log**（保留）—— 400 错误时把完整 reqBody + 错误栈存到 `localStorage['sullyos:proactiveLastError']`，成功路径存摘要到 `sullyos:proactiveLastReq`。

2. **推系统消息进聊天流**（新增）—— 暮色 7/22 15:56 反馈"不会 F12 找 body"，把诊断信息**也**推一条 `[主动消息失败: model=... | body=...字符 | 错误: ...]` 系统消息进聊天流。暮色截图聊天就能直接看到 400 详情。

3. **`reqBody` / `apiProtocol` 挪出 try 块**（bug 修复）—— 7/22 16:20 暮色截图发现"聊天里没出现系统消息"，console 报 `Unhandled Promise Rejection: ReferenceError: Can't find variable: reqBody`。`const reqBody` 之前在 try 块内部声明，catch 块访问不到 → JSON.stringify(reqBody) 炸 → 整个 catch 块的诊断 log 写入全没跑成。挪到 try 块外（`let reqBody: any = null`）+ 外层 try/catch 兜住整个诊断 log 写入。

4. **Claude 协议分支（撤回）**—— 之前 commit `3c02f12` 加了 Claude 协议兼容分支，暮色 7/22 15:35 反馈"一直用 OpenAI 协议"，撤回恢复原状。

## 动了哪些文件

- `context/OSContext.tsx:1364-1370` —— `reqBody` / `apiProtocol` 挪到 try 块外（`let reqBody: any = null`）
- `context/OSContext.tsx:1422` —— 内部 `const reqBody = ...` 改成赋值（不带 const）
- `context/OSContext.tsx:1441-1453` —— 成功路径存摘要到 localStorage
- `context/OSContext.tsx:1525-1570` —— 失败 catch 块加诊断 log（localStorage）+ 推系统消息进聊天流 + 外层 try/catch 兜住

## 踩坑 / 需要知道的（重要）

### 误判教训：客服/技术一句话 + 自己脑补 = 错答案（再次栽）

7/22 14:54 第一版判断"主 API 协议 = Claude"是错的。暮色 15:35 确认**一直 OpenAI 协议**。memory 里有这条 lesson 但还是没挡住自己。

**根因**："聊天正常 + 主动消息 400 + 副 API 角色能过来"这套症状让我脑补了"主 API = Claude"——但**没有**先看 7/17 那个 PR 是不是真的改了 runProactive 路径。事实是没改。**7/17 → 7/21 之间主动消息行为完全没变**。

### 暮色 15:53 的新发现（关键证据）

| 模型 | 现象 | 解读 |
|---|---|---|
| Claude (newapi 转) | 正常 | newapi 把 OpenAI 协议转 Anthropic 协议时 OK |
| GLM (京东云直连) | 400 | 京东云 GLM 拒收 |
| DS (京东云直连) | 500 | 京东云 DS 上游错误 |
| Gemini (京东云直连) | "聊天[media" 截断 | max_tokens: 500 太小，输出被砍 |

**关键信号**：
- baseUrl 是 `modelservice.jdcloud.com/tokenPlan/openai/v1/chat/completions`（**京东云模型服务**）
- 错误体"模型服务调用失败"是京东云/newapi 泛化话术（屏蔽了真实原因）
- 暮色 7/22 16:20 日志：`context_chars=18788` —— system prompt 18788 字符
- `buildSystemPrompt total=2119ms` —— 实时（realtime）查询 2113ms 占大头

**最可能根因**（等抓到 system 消息确认）：
- 京东云 GLM 某些档位（air 8k / flash 128k）context 不一致，18788 字符 + max_tokens 500 + history + memory palace
- DS 500 是上游服务问题，治不了
- Gemini 截断 = max_tokens 500 太小

### 推系统消息进聊天流 + reqBody 作用域 bug 教训

**暮色 7/22 16:20 截图反馈**："聊天里没出现一条系统消息"——以为我推系统消息的代码根本没跑。

**真凶**：`reqBody` 在 try 块**内部** `const` 声明，catch 块访问不到。`JSON.stringify(reqBody)` 直接报 `ReferenceError: Can't find variable: reqBody`，整个 catch 块诊断 log 写入逻辑全跳了。

**JS 作用域铁律**：`const` / `let` 声明的变量只在声明块**及其子块**可见。catch 块**不是** try 块的子块。

**暮色之前给的截图直接就显示了 `ReferenceError`**，但我没注意到——只看了第一个 `[Proactive/Global] Error` 那一行。

**教训**：
- 改代码前**先**想清楚"我加的代码会跑吗"——尤其是 catch 块里访问 try 块里的变量
- 用户给的 console error **要逐行看**，不要只看第一行
- 跨作用域共享变量要**声明在 try 外面**（`let` 形式），不要 `const` 死在 try 里

### 诊断 log 现在的状态

**新 bundle 部署后**（commit `（待提交）`）：
- 失败时**正确**写 localStorage + 推系统消息进聊天
- 成功时只写摘要到 localStorage（避免 prompt 太大刷爆 localStorage）
- 整段诊断 log 用外层 try/catch 兜住，再炸也只是 console.error 一下，不影响外层 finally

**暮色只需做一件事**：等下次 400 → **截图聊天** → 粘给我

我看到 model + 字符数 + 错误体后能：
- 判定是 max_tokens 太小 → 改大
- 判定是 prompt 超档位 → 减少 history / memory palace
- 判定是字段不识别 → 改字段
- 临时先删 catch 块推系统消息那段（不污染聊天流）

## 备注

- 这次**没**改 max_tokens（500）——等暮色截图确认 model 后**精准**改
- 这次**没**改 prompt 长度——减少 history/memory palace 是降级方案，最后才用
- 1 分钟档暮色还在跑（"1min elapsed"），测试完建议关掉（生产建议 ≥ 30 分钟，参考 2026-07-21-proactive-1min-test-option.md）
- **生图失败 `[object Object]` 是另一个独立问题**——错误日志没序列化 body，7/22 没动它（暮色顺便提的，不在本次 scope）
- 这次**没**改**副 API protocol 字段缺失**（types.ts:989）—— 副 API 强制 OpenAI 是历史决定，没影响
- 这次**没**改**runProactive 路径的 4 段 cache**——主动消息 max_tokens: 500，没必要拆 cache
