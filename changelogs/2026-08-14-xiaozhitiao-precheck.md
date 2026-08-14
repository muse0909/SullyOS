# 小纸条检测加前置判断

**日期**：2026-08-14

## 改了什么

小纸条检测入口加 `aiContent.includes('[[XIAO_ZHI_TIAO:')` 前置判断：AI 没输出小纸条标记时静默跳过整个解析段，**不查 IDB / 不计数 / 不打"今天已写 X 条"日志**。

两处入口都改（暮色 8-7 收窄后的两条路径）：
- `hooks/useChatAI.ts:3155` — 正常聊天主路径（try 块开头）
- `context/OSContext.tsx:1909` — 主动消息路径（try 块开头）

## 怎么改的

正向 `if (aiContent.includes(...))` 把后续逻辑（计数 / 查重 / 保存 / 剥 token）整段包起来。无标记时直接走出 try 块。

**为什么不用 `if (!includes) return`**：try 块里 return 会跳出整个 triggerAI，XHS / 朋友圈 / 戳一戳 等后续处理都不跑了。if 包裹等价于"早退出但不中断 triggerAI"。

## 涉及 commit

(本任务，1 个 commit)
