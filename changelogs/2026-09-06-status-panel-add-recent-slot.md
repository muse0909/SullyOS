# 2026-09-06 状态面板加一格"最近关系事件"

## 暮色 9-6 16:43 反馈

"在状态面板再增加一格，写最近发生的重要的事，比如吵架什么的。"

## 实现（最简 MVP）

加第 6 槽 `'recent'`，跟其他 5 槽同模式（AI 整体覆盖写入，跟所在地/身体/在忙/情绪/约定同款）。

**AI 写入 token**：
- `[[MEMO_SET_STATUS: recent | 跟暮色吵架了，还没和好]]`
- `[[MEMO_SET_STATUS: 最近 | ...]]`（中文别名）
- `[[MEMO_SET_STATUS: 最近关系事件 | ...]]`
- `[[MEMO_CLEAR_STATUS: recent]]`（清空）

## 涉及文件

1. `types.ts:581` — `CharacterStatusSlot` 加 `'recent'`
2. `utils/characterMemo.ts:39` — `DEFAULT_STATUS_LABELS` 加 `recent: '最近关系事件'`
3. `utils/characterMemo.ts:106` — `slotOrder` 末尾加 `'recent'`
4. `hooks/useChatAI.ts:3613` — `STATUS_SLOT_ALIAS` 加 recent + 中文别名（最近/最近关系事件/关系事件/事件）
5. `apps/CharacterMemoPage.tsx:137` — `STATUS_SLOT_ORDER` 末尾加 `'recent'`
6. `utils/chatPrompts.ts:246` — prompt 写入指南里加 recent 槽说明

## 跟现有 event memo 的关系

`recent` 槽 = "重大关系事件"（吵架/复合/约会等里程碑式）
`event memo` = "重点事件"（最多 5 条滚动，自由文本）

两个不重复：recent 是状态面板内的"关系状态概览"，event memo 是"事件流水账"。

## 已知限制

- **整体覆盖**：跟其他 5 槽一样，AI 写入会覆盖上一次。**只能记最近 1 条**。
- **没时间戳 UI**：面板整体更新时间不准确（写其他槽也会更新 panel.updatedAt），所以不显示时间戳。AI 想写时间就在 value 里加（比如"昨天跟暮色吵架了"）。

## 如果要"累积多条"版本

暮色后续要的话，5 分钟能改：
- types slots 值类型不变，新加 `slotUpdatedAt?: Partial<Record<CharacterStatusSlot, number>>` 字段存每槽时间
- setStatusSlot 写入时存 updatedAt
- DB 升级 fallback 处理老数据
- CharacterMemoPage 渲染 recent 槽时显示时间（年月日时分）

## 验收步骤

1. 江澈跟暮色聊到吵架 → 江澈回复里出现 `[[MEMO_SET_STATUS: recent | 跟暮色吵架了]]` token
2. console 应看到 `📝 [Status] SET slot=recent ...` 日志
3. 切到发现页 → 角色备忘录 → 状态面板 6 槽全显示，"最近关系事件"槽在最后
4. 江澈的 value 完整显示
