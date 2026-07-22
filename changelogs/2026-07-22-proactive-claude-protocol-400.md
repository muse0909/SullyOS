# 主动消息 Claude 协议 400 修复 + 诊断 log

**日期**：2026-07-22
**涉及 commit**：（待提交）

## 改了什么

`context/OSContext.tsx` 里 `runProactive` 两条改造：

1. **Claude 协议兼容**（仿 `useChatAI` 7/17 那个 fix）—— 主 API 协议 = `claude` 时
   - system 走顶层 `system` 字段（text block 数组）
   - history 里的 `role: 'system'` 全部转 `role: 'user'` + `[系统消息] ` 前缀
   - OpenAI 协议完全不变

2. **诊断 log** —— 400 错误时把 reqBody 全文存到 `localStorage['sullyos:proactiveLastError']`，成功路径存摘要到 `sullyos:proactiveLastReq`。下次复现直接 `copy(JSON.parse(localStorage.getItem('sullyos:proactiveLastError')))` 抓 body。

## 动了哪些文件

- `context/OSContext.tsx:1390-1413` —— reqBody 构造按协议分支（24 行新增）
- `context/OSContext.tsx:1430-1441` —— 成功路径存摘要到 localStorage
- `context/OSContext.tsx:1536-1562` —— 失败 catch 块加诊断 log（27 行新增，含完整 reqBody）

## 踩坑 / 需要知道的（重要）

### 根因复盘：7/17 那个 fix 漏了主动消息路径

| 项 | useChatAI 主路径 | runProactive 路径 |
|---|---|---|
| 7/17 加 Claude 协议兼容 | ✅ 修过 | ❌ **没动过** |
| 7/21 改用 safeFetchJson | ✅ | ✅ |
| 7/21 复用协议分支接口 | ✅ | ✅（但 body 没改） |

`safeApi` 的 claude 分支**只**改 URL + headers（`/v1/messages` + `x-api-key` + `anthropic-version`），**body 还是 OpenAI 格式**。当 protocol=claude 时，Anthropic 收到 `messages: [{role: 'system', content: '...'}, ...]` 报 `messages.0: first message must be user role` 400。

暮色 7/22 14:54 反馈"主动消息 400 频繁，聊天正常" —— 100% 跟 7/17 那个 400 同款话术（中转站泛化成"模型服务调用失败"）。

### "还有能过来的"是哪部分

`apiProtocol = (api as any).protocol ?? 'openai'`，**副 API 类型里没 protocol 字段**（types.ts:989）→ 副 API 走 OpenAI → 那些角色正常返回。**主 API 协议 = claude 的角色**全 400。

### 诊断 log 设计

| 路径 | key | 内容 |
|---|---|---|
| 成功 | `sullyos:proactiveLastReq` | ts/char/protocol/model/msgCount/systemChars/totalBodyChars |
| 失败 | `sullyos:proactiveLastError` | 成功摘要 + firstMsgRole/lastMsgRole/errMessage/errStack + **完整 reqBody** |

**为什么失败时存完整 reqBody**：400 错误里中转站屏蔽了真实原因（"模型服务调用失败"是 newapi 泛化话术），抓 body 才能看到 system 字段是不是真的到了顶层、messages 里是不是还混了 system role。

**为什么成功只存摘要**：避免每次主动消息都序列化整个 prompt（500 条 history 可能 100KB+）→ 拖慢 + 浪费 localStorage 配额。

### 影响面

- 只影响 `runProactive`（`context/OSContext.tsx` 一个函数内部）
- 不动 `useChatAI` 主路径（已经修过）
- 不动 `safeApi.ts`（7/17 那个设计保持）
- OpenAI 协议路径代码完全等价（同一个 reqBody 构造，行为字节级一致）

## 备注

- 这次**没**完整照搬 useChatAI 4 断点 cache（bp1/bp2/bp3 + 末尾 dynamic tail）—— 主动消息 max_tokens: 500 + 单 system prompt 字符串，没必要拆 4 段
- 如果以后想让主动消息也吃 cache，参考 useChatAI line 949-1100 那一坨扩到 runProactive
- 1 分钟测试档建议**测试完关掉**（7/21 changelog 提过"生产建议 ≥ 30 分钟"），即便 400 修了，1 分钟触发中转站限流也是浪费
- 这次没改**副 API protocol 字段缺失**的问题（types.ts:989）—— 副 API 强制走 OpenAI 是 7/21 changelog 里挂的"下次有人加副 API Claude 协议时再补" TODO
