# 主动消息 400 诊断 log（Claude 协议分支误判撤回 + 推系统消息进聊天流）

**日期**：2026-07-22
**涉及 commit**：`3c02f12`（误判 Claude 协议，撤回）+ `81a4be8`（撤回，恢复 + 保留诊断 log）+ `（待提交）`（推系统消息进聊天流）

## 改了什么

`context/OSContext.tsx` 里 `runProactive`：

1. **诊断 log**（保留）—— 400 错误时把完整 reqBody + 错误栈存到 `localStorage['sullyos:proactiveLastError']`，成功路径存摘要到 `sullyos:proactiveLastReq`。

2. **推系统消息进聊天流**（新增）—— 暮色 7/22 15:56 反馈"不会 F12 找 body"，把诊断信息**也**推一条 `[主动消息失败: model=... | body=...字符 | 错误: ...]` 系统消息进聊天流。暮色截图聊天就能直接看到 400 详情。

3. **Claude 协议分支（撤回）**—— 之前 commit `3c02f12` 加了 Claude 协议兼容分支，暮色 7/22 15:35 反馈"一直用 OpenAI 协议"，撤回恢复原状。

## 动了哪些文件

- `context/OSContext.tsx:1430-1441` —— 成功路径存摘要到 localStorage
- `context/OSContext.tsx:1480-1530` —— 失败 catch 块加诊断 log（localStorage）+ 推系统消息进聊天流
- （之前 commit `3c02f12` 撤回）Claude 协议 if 分支已删

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
- 暮色 7/22 14:52 日志：`context_chars=17536` —— system prompt 17536 字符
- 主动消息 body 总字符估算 25k+（system 17k + 500 条 history + memory palace 5341 字 + dynamic）

### 最可能根因（没看 body 仍是猜测）

**`max_tokens: 500` 太小 + 25k 字符 prompt 触底**：
- GLM-4-air 档位 context 8k，25k 字符 + 500 output 直接超 → 400
- GLM-4-plus / glm-4-flash 档位 128k，max_tokens 500 太小，输出截断
- Gemini 默认输出格式 > 500 tokens → 截断
- DS 500 是上游问题，治不了

**新 hash 部署后还 400**——印证了"7/17 Claude 分支没影响 runProactive"。

### 推系统消息进聊天流（解决"暮色不会 F12"）

**为什么用这个 pattern**：7/15 lesson 说"系统状态/事件警告应该推系统消息进聊天流"——400 也是系统事件，走同样 pattern。

**消息内容**：
```
[主动消息失败: model=glm-4 | body=25432字符 | msgs=502条 | firstMsgRole=system | 错误: API Error 400: 模型服务调用失败]
```

**诊断流程**（暮色只需做一件事）：
1. 部署完等下一次 400
2. 截图聊天（包含那条系统消息）
3. 粘给我

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
