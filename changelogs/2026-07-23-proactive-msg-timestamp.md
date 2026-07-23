# 主动消息时间戳每条独立显示

**日期**：2026-07-23
**涉及 commit**：（待提交）

## 改了什么
- 主动消息（AI 自己发的）每条都显示自己的时间戳，不再被 30 分钟 group 边界合并/覆盖
- 正常聊天的视觉节奏完全不变（user/AI 对话仍然按 30 分钟 group，最后一条才显示）

## 动了哪些文件
- `context/OSContext.tsx` — 主动消息保存的 3 处 `DB.saveMessage` 调用（emoji / fallback text / text chunk）加 `metadata: { isProactive: true }` 标记
- `components/chat/MessageItem.tsx:559` — 时间戳渲染条件 `isLastInGroup` → `isLastInGroup || m.metadata?.isProactive`

## 踩坑 / 需要知道的
- 之前 group 边界 = `30 * 60 * 1000` ms（30 分钟）+ role 相同，命中就合并（`apps/Chat.tsx:2648`）
- 30 分钟内 AI 连发两条主动消息会被合并到同一 group，只有最后一条显示时间戳，前面的被压掉
- 主动消息的"系统提示"消息已经用了 `metadata.proactiveHint: true`，但那个标记是用于 hide 整条系统提示的，不能复用
- 所以另开一个 `isProactive: true` 标记专给"消息本体"用，不动系统提示逻辑

## 备注
- 老的历史主动消息（保存时还没加标记）不会自动补救——只对本次 push 后新触发的主动消息生效
- 如果想让历史也生效，得跑一次 migration 脚本（暂不做，等暮色测了再说）
