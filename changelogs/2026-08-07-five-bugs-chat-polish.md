# 5 个聊天 bug 一次性修（小纸条 / 戳一戳 / 思维链 / 主动消息）

**日期**：2026-08-07
**涉及 commit**：（待提交）

## 改了什么

### Bug 1：小纸条连续 4 条相同
- **触发路径收窄**：只保留「主动消息」+「正常聊天回复」2 条路径。其余 5 个递归路径（read-note / search / diary / read-diary / fs-diary / fs-read-diary）+ 3 个工具 followup（image_gen fail / image_gen success / play_song fail）的 LLM 输出**不再解析** `[[XIAO_ZHI_TIAO: ...]]`
- 实现：`useChatAI.ts` triggerAI 入口加 `allowXiaoZhiTiaoParse` 闭包 flag，10 个非主路径 fetch 前设 false
- **prompt 改写**（暮色原文）：
  - 旧版：随时想写就写、自由发挥
  - 新版：两种时候才会写——想她但她在忙；聊天时有些话到嘴边又咽回去了
  - 强调"不是日记/不是复盘/不是任务"，是"没说出口的那句话的容器"
- **1 小时查重兜底**：今天已有相同 content → 跳过（虽然主路径收窄已经基本解决，这是兜底）
- **提醒改顶部弹窗**：去掉 system 消息进聊天流（之前是 `[系统: ${char.name} 给你塞了张小纸条: "..."]`），改成 `addToast(\`${char.name} 给你塞了张小纸条\`, 'bell', 3000)`，不显示内容
- **OSContext 主动消息路径补解析**：之前 runProactive 完全没解析 XIAO_ZHI_TIAO（即使 prompt 注入），现在补上同样的解析逻辑

### Bug 2：戳一戳触发时角色头像消失
- 根因：`apps/Chat.tsx calcBreaks` 只看 `role` 不同算 break，没看 `type`
- 戳一戳（type='interaction'）role='assistant'，下一条 AI 回复 role 也='assistant' → 30 分钟内 `breaksWithPrevious=false` → `isFirstInGroup=false` → 头像消失
- 修法：calcBreaks 加 `if (neighbor.type !== cur.type) return true;`

### Bug 3：思维链收不住格式（`THOUGHT: ...]]` 直接显示）
- 根因：AI streaming 切片时 `[[` 落在上一个 chunk 被 sanitize 删，剩 `THOUGHT: ...]]`
- 修法 3 层兜底：
  1. `useChatAI.ts` + `OSContext.tsx` 提取 thought 的 regex 改为 3 段式（标准 + 缺 `[[` + 缺 `]]`），覆盖所有残留格式
  2. `chatParser.ts sanitize` 加 2 条 strip 兜底
  3. （streaming 切分保护改起来风险大，暂不做，先靠 1+2 兜住）

### Bug 4：一条消息显示两个思维链
- 根因：`useChatAI.ts` emoji chunk 也调 `buildChunkMeta()`，当时 `globalMsgIndex === 0` → emoji 也挂上 thought
- 修法双重保险：
  1. **源头修**（useChatAI 2 处 + OSContext 1 处）：emoji chunk 不挂 thought metadata
  2. **渲染层兜底**（MessageItem commonLayout）：emoji / image 类型不显示 ThoughtFold（语义上也不该有）

### Bug 5：主动消息系统提示没发给角色
- 根因：之前 fix（8-6）矫枉过正——`runProactive` 把 hint 以 `role:user, metadata:proactiveHint` 存 IDB，但拉 history 时**过滤**掉，AI 看到 messages 末尾是空的 user role
- 修法：`OSContext.systemPromptParts` 数组末尾加 `hintLines`——hint 仍存 IDB（保持时间戳计算），但同时作为 system 字段发给 AI
- 主动消息本来就是动态内容，5 分钟 cache 没关系，暮色已确认 cache 命中不需考虑

## 动了哪些文件
- `utils/chatPrompts.ts` — 小纸条 prompt 改写
- `hooks/useChatAI.ts` — XIAO_ZHI_TIAO 解析加 allowXiaoZhiTiaoParse flag + 10 处 fetch 设 false + 1h 查重 + system 改 addToast + thought 提取 3 段式 + emoji 不挂 thought
- `context/OSContext.tsx` — runProactive 加 XIAO_ZHI_TIAO 解析 + systemPromptParts 加 hintLines + thought 提取 3 段式 + emoji 不挂 thought
- `apps/Chat.tsx` — calcBreaks 加 type 不同 break
- `components/chat/MessageItem.tsx` — commonLayout ThoughtFold 加 type 排除
- `utils/chatParser.ts` — sanitize 加 2 条 THOUGHT 残留 strip 兜底

## 踩坑 / 需要知道的（重要）

### 1. triggerAI 内 5 个递归路径不是真函数递归
- search / diary / read-diary / fs-diary / read-note 都是 triggerAI 内部**串行代码**，不是函数递归调用
- 所以 `allowXiaoZhiTiaoParse` 闭包 flag 在 triggerAI 入口定义后，所有 fetch 共享
- 5 个递归路径 fetch 入口设 false 后**不需要恢复**——保持 false 到 line 3220 XZT 解析，主路径下 flag 仍是 true（没触发任何递归），分支判断正确

### 2. diaryFallbackCall 是 4 个递归路径共用的 helper
- read-diary / fs-read-diary / read-note 失败时都调 diaryFallbackCall 二次 fetch
- helper 内部设 false 一次就够了（line 2784），不用每个调用方单独设

### 3. OSContext 完全没解析 XIAO_ZHI_TIAO（之前！）
- 暮色 8-7 反馈"主动消息也能写小纸条"，但实际上 runProactive 拿到 AI 响应后**没解析 XIAO_ZHI_TIAO token**——只走 sanitize → splitResponse → 保存正文
- XIAO_ZHI_TIAO token 不在 chatParser.sanitize 的 strip 列表里（line 316），所以会**作为正文显示**
- 这次顺手补上 OSContext 的 XIAO_ZHI_TIAO 解析（1 天 5 条 + 1h 查重 + addToast）

### 4. 思维链残留 regex 3 段式的边界
- 标准 `\[\[THOUGHT: ...\]\]` 大部分 case 命中第一段
- `THOUGHT: ...]]`（缺 [[）命中第二段 `/(?:^|\n)\s*THOUGHT\s*:\s*([\s\S]*?)\]\]/`
- `[[THOUGHT: ...`（缺 ]]）命中第三段 `/\[\[\s*THOUGHT\s*:\s*([\s\S]+?)$/m`（多行模式，行尾结束）
- 抽到 m[1] 后统一 `.replace(/\]\s*$/, '').trim()` 去掉末尾残留的 `]`

### 5. emoji chunk 重复思维链是"源头 + 渲染"双重 bug
- 源头：`buildChunkMeta()` 在 `globalMsgIndex === 0` 时挂 thought，但 emoji chunk 不递增 globalMsgIndex
- 渲染：commonLayout 不管 type 只要 metadata.thought 存在就显示
- 只修源头：未来加 image chunk 时还会踩
- 只修渲染：DB 里 emoji 也带着 thought，浪费存储 + 数据不一致
- 双重保险最稳

### 6. addToast 'bell' 类型
- PhoneShell.tsx line 505 toasts 是顶部弹窗（`absolute top-12 left-0 w-full flex flex-col items-center`）
- 'bell' 类型是暮色 7-15 加的"重要但不阻塞"提示样式（浅马卡龙 + 居中大圆角 + 铃铛图标）
- 小纸条提醒用 'bell' + 3000ms 持续时间合适

## 备注
- 主动消息的小纸条 prompt 跟正常聊天共用同一段，**没有**专门区分——暮色确认这个 OK
- 这次改完小纸条功能**整体行为变了**：之前是"AI 任何时候都可能写"，现在是"AI 想她 / 有话没说出口时才写"——语义上更贴"小纸条"这个名字
- 之前存的 system 消息 `[系统: ${char.name} 给你塞了张小纸条: ...]` 历史数据**不会自动清理**——新规则生效后新写的不再进聊天流，老的还在。要清理的话得跑一次 migration（暂不做）
- 主动消息现在每次触发都会把 hintLines 拼到 system prompt 末尾——prompt 会略长（hint 段 ~700 chars），但 cache 命中不受影响（5 分钟 TTL，hint 内容每次不同本来就不缓存）
