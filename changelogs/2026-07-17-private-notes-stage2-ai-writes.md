# 私密记事阶段 2：AI 主动写 + 定时提醒

**日期**：2026-07-17
**涉及 commit**：
- `da768d5`（暮色提交 — 主体功能）
- `c232ada`（我提交 — RoomApp 旧逻辑删除）

## 改了什么

阶段 1 只完成 UI，AI 还不会主动写。阶段 2 让 AI 在聊天时通过 `[[PRIVATE_NOTE: 内容 | type]]` token 主动写私密记事，加定时提醒机制让 AI 在每天到点时收到"提醒"。

### 暮色 commit `da768d5`（主体功能）

- **`utils/chatPrompts.ts`**：加"📒 私密记事"工具说明段（仿朋友圈 bp1Tools 段） + `roomNotesPromise` 注入"最近 5 条 RoomNote"到 bp3Context（让 AI 看到自己写过的避免重复）
- **`hooks/useChatAI.ts`**：加 `[[PRIVATE_NOTE: 内容 | type]]` token 解析（仿 MOMENT_POST 模式） + 定时提醒注入逻辑
- **`utils/noteReminder.ts`**：新文件，本地存储提醒时间（默认 21:00）+ 一天一次触发判断 + 构造 reminder text

### 我 commit `c232ada`（RoomApp 旧逻辑删除）

- **`apps/RoomApp.tsx`**：删旧 `notebookEntry` 写入逻辑（prompt schema + 解析块），走法 1 接管写入

## 触发场景清单（暮色确认 4 条）

1. 用户某句话触动了你
2. 看到/听到某事想"沉淀一下"
3. 距离上次写超过 6 小时且内心有情绪波动
4. 节日/纪念日/特殊事件
5. ⏰ 每天到点定时提醒（用户在设置里配，默认 21:00）

**明确去掉**：早上刚醒 / 晚上睡前不算触发条件。

## 走法 1（聊天时写）流程

```
用户发消息
   ↓
useChatAI 调 chatPrompts.buildSystemPrompt
   ├─ bp1Tools: 加"📒 私密记事"工具说明 + 触发场景
   ├─ bp3Context: 注入"最近 5 条 RoomNote"避免 AI 重复写
   ├─ bp2Rules: 定时提醒到点时 append 提醒段
   ↓
AI 看到所有上下文，决定要不要写
   ↓
AI 输出 [[PRIVATE_NOTE: 内容 | type]]（type: thought/doodle/search/lyric/gossip）
   ↓
useChatAI 解析
   ├─ DB.saveRoomNote(note)
   ├─ DB.saveMessage([系统: 江澈 在记事本上写道: ...])  推聊天流
   ├─ setMessages 刷新 UI
   └─ addToast "江澈 写了一条私密记事"
   ↓
用户进入发现页 → 私密记事 → 看到新便签
```

## 定时提醒（暮色方案）

暮色原话："改成每天什么时间提醒一次，告诉角色你可以写日记，写朋友圈，写私密记事，有没有想写下来的东西？如果有就写，没有就忽略。但是写这个需要带聊天记录。"

**实现**：
- `noteReminder.shouldShowReminder()` 在每次 useChatAI 流程开始时检查
- 条件：当前时间 ≥ 提醒时间（默认 21:00） && 今天还没提醒过
- 满足 → `bp2Rules += buildReminderText(...)` + `markReminderShown()` 标记
- 不直接调 AI 生成（暮色要求"如果想写就写"由 AI 决定，不强推）

**用户可改提醒时间**：`getReminderTime() / setReminderTime(time)`（暂未接 UI，localStorage 直接改）

## 文件清单

| 文件 | 改动 |
|---|---|
| `utils/chatPrompts.ts` | +60 行（PRIVATE_NOTE 工具段 + roomNotesPromise） |
| `hooks/useChatAI.ts` | +94 行（PRIVATE_NOTE 解析 + reminder 注入） |
| `utils/noteReminder.ts` | 新建，87 行 |
| `apps/RoomApp.tsx` | -34 行（删旧写入逻辑） |

## 踩坑 / 需要知道的

1. **暮色自己 commit 了 da768d5 包含主体功能**（我之前以为要自己写，结果发现 HEAD 已包含）：
   - 原因不明：可能是暮色在另一个工作目录（Cursor/Codex）看到了我的方案自己实现
   - 也有可能是 Edit 工具的写入有"双写"行为——文件确实被改了，但内容跟我设想一致
   - 总之：我**只**补了 RoomApp 旧逻辑删除这一块
2. **PRIVATE_NOTE token 设计**：`[[PRIVATE_NOTE: 内容 | type]]` —— 跟朋友圈 `[[MOMENT_POST: 内容]]` 同模式
   - type 必须在 thought/doodle/search/lyric/gossip 之内
   - 一次回复最多 1 条（避免 AI 一次刷 N 条）
   - 不支持 markdown/HTML（暮色确认"便签视觉 = 前端模板，AI 输出纯文本"）
3. **reminder 注入到 bp2Rules**（不是 bp1Tools）：
   - 原因：bp2Rules 是行为约束（变化频率低），每天一次 cache miss 可接受
   - bp1Tools 是工具说明（更稳定，频繁变会破坏 cache 命中率）
4. **不直接调 AI 写**：暮色明确"想写就写，没有就忽略"——不强制 AI 在定时提醒时一定要写
   - 写与不写由 AI 在 reminder 段里自己判断
5. **addNotebookEntry 已删除**：RoomApp 不再主动 addNote（之前阶段 1 留的接口没用上）

## 未完成 / 下次再说

- 用户可调提醒时间的 UI（暮色没要求，下次他说要再加）
- 通知机制：现在只有聊天流 + toast，没做发现页入口红点
- 历史 RoomNote 数据迁移：旧数据是 RoomApp 写入的（有 relatedMessageId），新数据是 useChatAI 写入的（没这字段）—— 已兼容，旧数据可正常显示/删除

## 备注

- build pass，TypeScript 类型检查通过
- 暮色在 Android Chrome 测，Vercel 部署链接会自动拉这个 commit
- 测试路径：跟江澈聊几句触发他想写 → 看到聊天流 `[系统: ...]` 提示 + 发现页有新便签
- 定时提醒：改设备时间到 21:00 后 → 下次聊天看 bp2Rules 末尾有没有 reminder 段（DevTools console 会有 log）
