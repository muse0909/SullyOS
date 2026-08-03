# Gemini 直连 key 池 — 多 key 轮询 + 健康状态自动切换

**日期**：2026-08-04
**涉及 commit**：`e6ca29e`

## 改了什么

- **核心模块** `utils/geminiKeyPool.ts`（新建）：
  - 3 个 channel 独立维护：`'main'`（主 API）/ `'vision'`（识图）/ `'light'`（记忆宫殿副 API 预留）
  - key 池配置存 `apiConfig`（持久化），运行时状态（cursor / cooldown）module-level（不持久化）
  - `pickGeminiKey(channel, keys)`：round-robin + 跳过限流/失效的 key
  - `reportGeminiFailure(channel, keyIndex, status, errText)`：返回 `'retry' / 'fail-permanent' / 'fail-recoverable'`
  - `reportGeminiSuccess` / `getGeminiKeyStatuses` / `resetGeminiKeyStatus` / `shortKey` / `statusColor`
- **失败策略**（按暮色拍板）：
  - 429 配额耗尽 → 切下一个 + 标 60 秒不重用 + 重试
  - 401/403 key 永久失效 → 标 dead（不重用） + 弹 toast「key 失效」+ **不**重试
  - 其他（网络错误/5xx）→ 切下一个 + 标 5 秒不重用 + 重试
  - 最多重试 1 次（避免无限循环）
- **调用层改造** `hooks/useChatAI.ts`：
  - Gemini 主 API 协议分支（line 1719-1850）：fetch 改循环 + 上报
  - 识图 Gemini 协议分支（line 1548-1620）：同上
  - 失败 toast：`🔑 Gemini key 失效（AIza...xyz）— 请去 API 浮窗更新`
- **类型** `types.ts`：加 `geminiApiKeys?: string[]` / `visionGeminiApiKeys?: string[]`
- **UI** `components/os/GeminiKeyPoolModal.tsx`（新建）：
  - 复用 `components/os/Modal.tsx`（暮色 2026-07-02 拍板的弹窗规范）
  - 列表：每行 序号 + 状态灯 + key 短码（AIza...xyz）+ 状态标签 + 删除/重置按钮
  - 状态灯颜色：active=绿（emerald）/ rate-limited=黄（amber）/ dead=红（rose）
  - 限流冷却倒计时（`Xs 后恢复`）
  - 顶部 "+" 行内添加（回车提交）
  - 底部：保存（写回 `apiConfig`）+ 取消
- **API 浮窗集成** `components/os/ApiQuickFloat.tsx`：
  - 主 API / 识图 Key 输入框下方：仅 `protocol === 'gemini'` 时显示「🔑 密钥池（N）」按钮
  - 弹窗保存：`apiConfig.geminiApiKeys` 数组 + 兼容老字段 `geminiApiKey = keys[0]`
  - 同步 `localKey` 为 `keys[0]`（输入框显示主 key）

## 动了哪些文件

- `utils/geminiKeyPool.ts` —— 新建（核心模块）
- `types.ts` —— APIConfig 加 2 个数组字段
- `hooks/useChatAI.ts` —— Gemini 主 API + 识图 fetch 加轮询+重试
- `components/os/GeminiKeyPoolModal.tsx` —— 新建（弹窗组件）
- `components/os/ApiQuickFloat.tsx` —— 加"密钥池"按钮 + 弹窗渲染

## 踩坑 / 需要知道的（重要）

- **TS 类型**：旧字段 `geminiApiKey`（单字符串）保留，新字段 `geminiApiKeys`（数组）共存。`extractGeminiKeys(config, 'geminiApiKey', 'geminiApiKeys')` 优先读数组，没有就用单字符串包成 1 元素数组 → **老用户不丢配置**
- **运行时状态不持久化**：刷新后 cursor 从 0 开始（健康状态也清空）—— 暮色确认这是合理行为（避免脏状态）
- **Channel 解耦**：3 个 channel 独立 cursor + 状态。比如主 API 的 key 死了不影响识图。`utils/geminiKeyPool.ts` 的 `channelState` Map 用 `GeminiChannel` 做 key
- **重试上限 1 次**：避免 401 死循环 / 429 反复打
- **Toast 触发**：仅 401/403 弹「key 失效」toast（给用户看的），429/网络错误不弹（静默切下一个，避免噪音）
- **`useChatAI.ts` 重构**：原来 Gemini 主 API fetch 是单次 `await fetch(geminiUrl, ...)`，现在改成 `for (let attempt = 0; attempt < 2; attempt++)` 循环——`geminiUrl` 变量在循环外声明但第 1 次会被 tryUrl 覆盖（line 1853 那段 `tryUrl` 计算）
- **类型兼容**：`extractGeminiKeys` 第三个参数是 array 字段名（用 `as const` 联合类型管），强制调用方传对应字段名避免错位
- **记忆宫殿副 API Gemini 没动**：lightLLM 走 Gemini 时共用主 API 协议分支（`useChatAI.ts:1288` 把 lightLLM 字段塞进 `effectiveApi`），但 **lightLLM 配的 Gemini key 池 UI 没做**。调用量比主 API 少很多，暮色没要求 → 留作后续

## 暮色审美

- 弹窗严格按 `components/os/Modal.tsx` 规范：`max-w-sm` + `rounded-[2.5rem]` + `max-h-[80vh]` + 居中卡片
- 状态灯用马卡龙色：emerald（绿）/ amber（黄）/ rose（红）—— 不刺眼
- 列表项 `bg-slate-50/60 rounded-2xl` 胶囊感 + `border border-slate-200/40` 浅边
- "🗝️ 池（N）" 按钮用 `text-sky-500`（跟 Gemini tab 蓝色调一致）
- 底部按钮居中：取消（slate）+ 保存（sky 主操作）
- key 短码用 `font-mono`（`AIza...xyz`），跟项目其他 key 显示风格统一

## 备注

- 没做：自动检测 key 有效性（用户填进去时不会测）；跨页签同步状态（每个 tab 独立 module-level state，刷新才重置）
- 后续可加：键盘快捷键（弹窗里 Esc 关闭）；批量粘贴（一次贴多行自动拆 key）
- 暮色可在 API 浮窗 → Gemini tab → 看到「🗝️ 密钥池（1）」按钮 → 点开加多个 key → 每次请求自动轮询

**未完成 / 下次再说**：
- 记忆宫殿副 API Gemini key 池 UI（需要时再做）
- 全局"所有 key 都死了"的中心化报警 toast（现在只在最后失败时打 console）
