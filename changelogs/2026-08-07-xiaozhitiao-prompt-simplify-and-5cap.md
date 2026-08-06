# 小纸条提示词简化 + 每天 5 条上限

**日期**：2026-08-07
**范围**：`utils/chatPrompts.ts` + `hooks/useChatAI.ts` + `types.ts`

## 改了什么

### 1. 提示词简化（chatPrompts.ts 第 9 段）

- 删 6 个 `**小标题**`（它是什么 / 核心精神 / 写一条 / 触发时机 / 写完 / 注意事项）
- 主体替换为"自由写"描述（你手边一直有纸和笔……不是日记，不是复盘，也不是定时任务）
- token 简化：`[[XIAO_ZHI_TIAO: 内容 | type]]` → `[[XIAO_ZHI_TIAO: 内容 ]]`（无 type 字段）
- 加 5 条/日约束写到 prompt 里

### 2. type 字段删除

- `types.ts` — `XiaoZhiTiao.type` 字段删掉（暮色原话"type 没用"）
- `useChatAI.ts` — 解析正则去掉 `\| (thought|doodle|...)` 部分
- `useChatAI.ts` — 写入时不写 type 字段

### 3. 每天 5 条硬限制（useChatAI.ts）

- 解析前先查 `DB.getXiaoZhiTiao(char.id)` 过滤今天 timestamp
- 已写 ≥ 5 条 → 跳过整个 token 解析，console 打 `今天已写 N 条，跳过`
- 已写 < 5 条 → 走原写入逻辑
- 标记从 `aiContent` 里移除（无论超没超）
- 静默丢弃（**无 toast 提示**——暮色原话"AI 看到不会一口气写完"，默认 prompt 软约束 + 系统硬限制）

## 动了哪些文件

- `utils/chatPrompts.ts` — 段 9 整段重写（35 行 → 11 行）
- `hooks/useChatAI.ts` — XIAO_ZHI_TIAO 解析段重写（30+ 行 → 40 行，加 5 条 check）
- `types.ts` — `XiaoZhiTiao.type` 字段删 1 行

## 踩坑 / 需要知道的

### 1. 旧数据兼容

删 `XiaoZhiTiao.type` 字段不影响运行时（IndexedDB schemaless，数据库里旧记录仍带 type 字段，运行时只是不读）。新数据不写这个字段。

### 2. AI 可能超 5 条但被静默丢弃

`[[XIAO_ZHI_TIAO: ...]]` token 会从 aiContent 移除，所以用户**看不到** AI 写了但被丢的痕迹。**这跟原版"toast 提示'已写一条'"行为不同**——超 5 条后 AI 写了但没反馈，AI 不知道自己被限制。

**风险**：如果用户不读控制台日志，AI 会困惑"为什么我写了没反应"。**未来如果要加 toast**，需要在解析段里加：`addToast(\`今天已写 5 条，明天再写\`, 'info')`。

### 3. 时区问题

`todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);` 走**浏览器本地时区**。如果用户跨时区用，凌晨 0 点的重置点跟用户预期可能不同。**原版的 6 小时间隔 / 21:00 提醒**也走同一时区，所以这是项目内统一行为，不算回归。

### 4. 段落号变更

段 9 之前是 `].length + 9`（因为段 8 之后是段 9），现在删了一段（段 9 之前的私密记事）后**段 9 现在是小纸条**，编号依然是 `+ 9`（没变）。这是为什么前面 `commit ddcdc04` 之后段号还是 9。

## 备注

- Build 通过（4.12s）
- 已和私事记恢复的 `ddcdc04` 分离，这次是独立 commit
- 暮色 8-7 00:52 原话："AI 看到不会一口气写完"——明确要 prompt 软约束 + 系统硬限制（两边都做）
- 未推送 preview，等暮色 review
