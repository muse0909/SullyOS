# 主动消息诊断 log ReferenceError — systemPrompt 挪到 try 块外

**日期**：2026-08-03
**涉及 commit**：`8a26be3`

## 改了什么

- `context/OSContext.tsx:1447` 新增 `let systemPrompt: string = ''`（try 块外声明）
- `context/OSContext.tsx:1557` 改 `const systemPrompt = ...` 为 `systemPrompt = ...`（写回外层 let）
- `context/OSContext.tsx:1599` 简化 `typeof systemPrompt === 'string' ? systemPrompt.length : 0` 为 `systemPrompt.length`
- `context/OSContext.tsx:1732` 注释更新（"挪到 try 块外声明的 let"）

## 动了哪些文件

- `context/OSContext.tsx` —— `runProactive` 函数内 try/catch 作用域修复

## 踩坑 / 需要知道的（重要）

**根因**：try 块作用域隔离。`systemPrompt` 在 try 块内 `const` 声明，catch 块访问不到 → ReferenceError: systemPrompt is not defined。

**症状**（暮色反馈）：
- 主动消息失败时，console 报两个错叠加：
  1. `ReferenceError: systemPrompt is not defined`（诊断 log 写入炸了）
  2. `API Error 401: 无效的令牌`（真正的根因）
- 用户看到一片红但 UI 啥都没说（系统消息推不到聊天流）

**为什么 TS 不报**：
- catch 块的标识符 TS 不做作用域分析
- 只看"标识符在某处声明过"——`systemPrompt` 在同文件其他地方（line 2092）声明过
- 编译过，runtime 必然崩

**为什么 401 也跟着炸出来**：
- 401 是 `API Error 401: 无效的令牌`——是 **Gemini 协议那条 key 失效了**，不是代码 bug
- 401 本身是预期的失败路径，但 catch 块里诊断 log 抛 ReferenceError → 推系统消息也走不到 → 暮色看到的是混乱的报错

**和之前 ReferenceError 家族同源**（同一天栽第 5 次）：
- 8-01: Chat.tsx useOS() 漏 `updateUserProfile`
- 8-01: useChatAI.ts 顶部 import 漏 `musicApi`
- 8-02: MusicApp.tsx useMusic() 漏 `queue`
- 8-02: MessageItem.tsx console.log 块内用未声明 `isProactive`
- 8-03: OSContext.tsx catch 块引用 try 块内 const `systemPrompt`

**下次防御**：
- 任何 catch 块要访问的变量，必须在 try 块**外**声明（`let varName: type = defaultValue`）
- 注释里写"现在 X 是 string 了，能拿到长度"——这种是**误导性注释**，根本没意识到作用域问题
- 加新引用前先 grep 现有 destructure / 块作用域，确认引用目标的声明位置

## 备注

**给暮色的下一步**：
- 这个 commit 修的是"诊断 log 写入炸"——下次主动消息失败时，console 能看到完整错误（localStorage `sullyos:proactiveLastError` 也有完整 reqBody）
- 真正的 Gemini 401（key 失效）需要暮色去 **API 浮窗 → 选 Gemini 协议** 重新填 key
- key 失效的常见原因：Google AI Studio 的 key 过期 / 配额用尽 / key 被删除

**未完成**：
- 暮色如果确认 Gemini key 没问题，可能要看 `safeFetchJson` 里 Gemini 协议分支是不是把 key 放错位置（参考 `useChatAI.ts` 7-17 / 7-22 那两套协议分支）
