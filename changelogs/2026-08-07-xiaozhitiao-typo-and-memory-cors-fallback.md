# 小纸条拼写 bug + 记忆宫殿副 LLM 加 CORS fallback

**日期**：2026-08-07
**涉及提交**：`16b2826`

## 改了什么

### 1. 小纸条拼写 bug（手误）
- `hooks/useChatAI.ts:3227` 调用 `DB.getXiaoZhiTiao(char.id)` 报 "is not a function"
- 根因：`utils/db.ts:1226` 定义的方法是 `getXiaoZhiTiaos`（get 加复数取多条，save/delete 仍是单数）—— useChatAI 漏写 s
- 修：调用名加 s

### 2. 记忆宫殿副 LLM 加 CORS fallback
- 现象：暮色在 API 设置里 baseUrl 填了青屿（`https://qingyuapi.com`），点记忆宫殿的"立即追平 / 精炼 / 添加 Time Log"等触发副 LLM 调用时，前端控制台报
  ```
  Access to fetch at 'https://qingyuapi.com/v1/chat/completions' from origin
  'https://sully-os-git-preview-...vercel.app' has been blocked by CORS policy:
  No 'Access-Control-Allow-Origin' header is present on the requested resource.
  POST https://qingyuapi.com/v1/chat/completions net::ERR_FAILED 200 (OK)
  ```
  UI 表现"没收到回复"（不是真的没回，是浏览器把响应吃掉了；调用方没 fallback 就直接挂）

- 根因：`utils/memoryPalace/llmCall.ts:93` 的 `fetchWithTimeout` 直接 fetch，**完全绕过** `utils/safeApi.ts` 的 CORS fallback 机制
  - 主 API 没事（走 safeFetchJson → 有 CORS fallback）
  - 副 API 出事（独立漏的洞）
  - 三个协议函数（callOpenAI / callClaude / callGemini）都从 `fetchWithTimeout` 走，全受影响

- 修：在 `fetchWithTimeout` 里加 CORS fallback，命中 `TypeError + /load failed|failed to fetch|network/i` 时改走 `/api/proxy` 服务端转发
  - `/api/proxy` 内部 fetch 不受浏览器 CORS 限制
  - 原样回传上游 status / body，调用方 `.ok` / `.json()` 一行不用改
  - 跟主 API `safeApi.ts:281` 的同款模式

## 动了哪些文件

- `hooks/useChatAI.ts` —— 第 3227 行 `getXiaoZhiTiao` → `getXiaoZhiTiaos`（1 行）
- `utils/memoryPalace/llmCall.ts` —— `fetchWithTimeout` 加 CORS fallback 分支 + 新增 `proxyFetch` helper（约 35 行）

## 踩坑 / 需要知道的（重要）

- **Vercel Serverless Function 超时**：`/api/proxy` 默认 10s（hobby 计划）。记忆宫殿副 LLM 单次提取正常 5-15s，10s 边界紧张。如果 fallback 后看到 504 / 函数超时，**单独**加 `maxDuration` 配置或升 Vercel plan。这次没改。
- **CORS fallback 只在副 LLM 入口**——**主 API 走的是另一套**（safeApi.ts），早已支持 CORS fallback。**不要**"统一"到一处：主 API 还要支持流式 / 协议分支 / 缓存命中检测等，llmCall 这边是简化版。
- **fetchWithTimeout 的 60s 超时不再覆盖 fallback 路径**——proxy 走 Vercel 自己的超时控制（10s/60s 看 plan）。这是合理的：proxy 路径就算 stall 也不会让本地的处理锁（`pipeline.processingLocks`）永远卡住，因为 fallback 抛错后调用方会释放锁。
- **根因不是域名**——暮色问的"qingyuapi.com"是他在 API 配置里填的运行时 baseUrl，源码里搜不到。错的是调用方缺 CORS fallback，**不是**域名本身有 CORS 配置问题（青屿没给 sully-os 部署域名加 CORS 头是预期行为——他们只给自己网页端加）。

## 备注

- 暮色 8-7 反馈"qingyuapi.com CORS 拦截"→ 我之前 grep 源码没搜到域名（运行时配置），报错堆栈定位到 `memory-palace-DV5Ipl5t.js` chunk 才确认是副 LLM helper 的洞
- 本地 build 验证通过：bundle 体积 memory-palace chunk 仍是 192 KB（CORS fallback 代码可忽略）
- 推送 preview 后 Vercel 自动部署，暮色在 Android Chrome 测：记忆宫殿"立即追平 / 精炼"应该不再撞 CORS
