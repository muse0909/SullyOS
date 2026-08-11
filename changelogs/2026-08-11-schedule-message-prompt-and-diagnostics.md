# schedule_message 提示词收紧 + 诊断日志

**日期**:2026-08-11
**涉及 commit**:(待 push 后回填)

## 改了什么

1. `utils/chatPrompts.ts:604` 改写"定时发送消息"提示:
   - 删"分行可以多输出很多该类消息"(诱导 LLM 重复输出)
   - 加 2 条规则:
     - 每个独立提醒事项只允许输出一条;不要为同一个提醒生成多个措辞版本
     - 一次回复包含多个不同事项时,每个事项可以各输出一条
2. `utils/chatParser.ts:266-316` 加诊断日志(不改保存逻辑、不截断、不合并):
   - 入口处收集 `parsedSchedules[]`(每条含 timeStr / dueTime / 脱敏 contentPreview / saved 标记)
   - 循环跑完后,console.log 报告 `parsed N reminder(s) for charId=X, aiContent.length=Y`
   - 每条 console.log 列出 dueAt(ISO)+ saved/skipped + contentPreview(前 40 字符 + …)
   - **N > 1 时**自动按 dueAt 分组,同 dueAt 多条 console.warn 列出(可能重复措辞或同时间多事项,需人工确认)

## 动了哪些文件

- `utils/chatPrompts.ts` —— 1 行删 + 2 行加(line 604)
- `utils/chatParser.ts` —— SCHEDULE 块**完全保留**,外加 parsedSchedules 收集 + 报告输出(+30 行)
- `changelogs/2026-08-11-schedule-message-prompt-and-diagnostics.md` —— 本文件

## 踩坑

- Edit 工具匹配 line 604 时反引号 `` ` `` 不被识别为相同字符,改用 Python 脚本精确替换
- chatParser 改时确保 `parsedSchedules.push` 在 while 循环**内**(`dueTime <= now` 时也收集,标 `saved: false`),这样诊断覆盖**所有**解析出的标签,不漏

## 静态验证

- `npm run build` 通过(3.89s,无 TS 错误)
- chatParser 原有 while 循环(save + LocalNotifications + addToast)**未动**
- `content.replace(scheduleRegex, '').trim()` sanitize 保留(标签从 aiContent 删除,用户看不到)

## 运行时验证(等 Preview 部署完,5 分钟后提醒喝水步骤)

1. 打开 Vercel Preview 链接
2. 进任一角色 Chat 页
3. 发:"5 分钟后提醒我喝水"
4. 打开 DevTools Console,看输出:
   - 应见 `📅 [schedule_message] parsed 1 reminder(s) for charId=..., aiContent.length=N`
   - 下 1 行 `dueAt=2026-08-11T20:00:00.000Z saved content="..."`(或当时时间 + 5min)
5. DevTools → Application → IndexedDB → `AetherOS_Data` → `scheduled_messages` store
   - 应见 **1 条** record,`dueAt` ≈ 当前 + 5min
6. 等 5 分钟(在另一个 tab 放着),应见:
   - Capacitor 通知(原生)或 Web Notification(浏览器) **1 条** `XXX sent a proactive message: 提醒你喝水` 之类
   - 聊天流 +1 条 assistant 消息(内容是 IDB 中存的 content)
7. **不应** 见:
   - 4 条系统通知(原 17:00 bug 重现)
   - `⚠️ [schedule_message] dueAt=... 同时间含 4 条` 警告
   - 聊天流一次性 +4 条消息

## 备注

- 上一版方案(reminderId + IDB keyPath + Jaccard 合并)被暮色**否决**,理由:
  1. reminderId 由模型生成不能保证同一事项同 ID
  2. 改 IDB keyPath 迁移风险过大
  3. Jaccard 容易误合并同时间不同事项
  4. LocalNotifications 行为未核实(已核实:同 id 是覆盖,id 类型是 32-bit int)
- 本次**只** 改 prompt + 加日志,**不动** DB schema / 1.0 主动消息 wakeupId / 上下文 / tools / chat-in-progress / Cloudflare cron / 2.0 amsg2 迁移
- 后续:看完 console 日志 + 5 分钟验证结果,**再**决定要不要做去重(可能改用模型输出固定 reminderId + 解析层 in-memory Set)
