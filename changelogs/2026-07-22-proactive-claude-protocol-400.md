# 主动消息 400 诊断 log（Claude 协议分支误判撤回）

**日期**：2026-07-22
**涉及 commit**：`3c02f12`（误判 Claude 协议，撤回）+ `3c02f12+`（撤回，恢复 + 保留诊断 log）

## 改了什么

`context/OSContext.tsx` 里 `runProactive`：

1. **诊断 log**（保留）—— 400 错误时把完整 reqBody + 错误栈存到 `localStorage['sullyos:proactiveLastError']`，成功路径存摘要到 `sullyos:proactiveLastReq`。下次复现直接 `copy(JSON.parse(localStorage.getItem('sullyos:proactiveLastError')))` 抓 body。

2. **Claude 协议分支（撤回）**—— 之前 commit `3c02f12` 加了 Claude 协议兼容分支，暮色 7/22 15:35 反馈"一直用 OpenAI 协议"，这段代码等于没跑过，撤回恢复原状。

## 动了哪些文件

- `context/OSContext.tsx:1390-1413` —— reqBody 构造恢复原状（删 Claude 协议 if 分支）
- `context/OSContext.tsx:1430-1441` —— 成功路径存摘要到 localStorage
- `context/OSContext.tsx:1536-1562` —— 失败 catch 块加诊断 log（含完整 reqBody）

## 踩坑 / 需要知道的（重要）

### 误判教训：客服/技术一句话 + 自己脑补 = 错答案

我 7/22 14:54 看错误体 `API Error 400: 模型服务调用失败`、7/17 那个 useChatAI Claude 400 fix、用户日志"聊天正常 / 主动消息 400 / 副 API 角色能过来"就脑补了"主 API = Claude 协议"。

实际暮色 15:35 确认：**一直 OpenAI 协议**。

**学到的**：之前 memory 里有这条 lesson（"客服/技术一句话 + 自己脑补 = 错答案"），但还是栽了。暮色没明确说"我用 Claude 协议"我就脑补了。**下次**应该先问 1 句"你主 API 协议是什么"再下结论。

### 真正的 400 根因（待查）

暮色 15:35 日志里 baseUrl 是 `modelservice.jdcloud.com/tokenPlan/openai/v1/chat/completions`（**京东云模型服务**），错误体"模型服务调用失败"是京东云/newapi 泛化话术。OpenAI 协议下还 400 真正的根因**没有抓到**——必须看 reqBody 才知道。

最可能的方向（没看 body 不能下结论）：
- **max_tokens: 500 触发了京东云的某个限制**（最可能——京东云某些档位对 max_tokens 有限制）
- prompt 超京东云档位 context 上限（看了 memory palace 召回 5341 字 + system + 500 条 history 可能超）
- 京东云 OpenAI 兼容接口对特定字段不识别（stream / temperature 范围 / top_p 等）
- memory palace 召回的 5341 字 system 注入触发了 prompt 长度限制

**关键**：下次复现抓 `sullyos:proactiveLastError` body，能直接看到 prompt 总长 + max_tokens + body 格式，定位真凶。

### 诊断 log 怎么用

**触发场景**：主动消息 400 错误时自动写。
**抓 body**：
```js
copy(JSON.parse(localStorage.getItem('sullyos:proactiveLastError')))
```
**关键字段**：
- `totalBodyChars` —— prompt 总长度（看是不是超限）
- `firstMsgRole` / `lastMsgRole` —— messages 数组头尾 role
- `reqBody` —— 完整请求体，能直接看出 system / messages / max_tokens / model 全长什么样
- `errMessage` / `errStack` —— 错误体（虽然 newapi 会泛化）

**新 bundle hash**：暮色 15:35 日志里还是 `index-DV1Fxyww.js`（我修的那次 build 的 hash），说明暮色**测的就是我修过的版本**。但因为我之前误判了 Claude 协议，OpenAI 协议路径行为**完全没变**——所以 400 还在。

## 备注

- 1 分钟档暮色还在跑（"1min elapsed"），测试完建议关掉（生产建议 ≥ 30 分钟，参考 2026-07-21-proactive-1min-test-option.md）
- 这次没改**副 API protocol 字段缺失**（types.ts:989）—— 副 API 强制 OpenAI 是历史决定，没影响
- 这次没改**runProactive 路径的 4 段 cache**——主动消息 max_tokens: 500，没必要拆 cache
- **生图失败 `[object Object]` 是另一个独立问题**——错误日志没序列化 body，7/22 没动它（暮色顺便提的，不在本次 scope）
