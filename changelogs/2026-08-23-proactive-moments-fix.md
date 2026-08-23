# 2026-08-23 修主动消息 [[MOMENT_POST: ...]] 没发到朋友圈 bug

## 症状

暮色 8-23 早上反馈：
- 主动消息里 AI 说"发个朋友圈吧"
- 但实际只是把 `[[MOMENT_POST: 03:40, 她睡着了。]]` 这种标签**输入到聊天框**里
- 朋友圈没真发出去
- 手动点"让他发朋友圈"按钮能正常发 → 说明朋友圈存储逻辑没问题
- 跟 AI 说"发朋友圈"也能正常发 → 说明主聊天流程的解析没问题

## 根因

`[[MOMENT_POST: ...]]` / `[[MOMENT_COMMENT: ...]]` / `[[MOMENT_LIKE: ...]]` 标签的解析逻辑只在 `useChatAI.ts:3278-3350`（主聊天流程）实现。

`OSContext.runProactive`（主动消息流程）只解析了 `[[XIAO_ZHI_TIAO: ...]]` 和 `[[THOUGHT: ...]]`，**没有解析 MOMENT_* 系列**。

`ChatParser.sanitize`（utils/chatParser.ts:347）strip 列表里也**没包含 MOMENT_POST** → 标签经过 sanitize 不会被剥掉，作为字面文本保存到消息流。

## 修复

### utils/momentsActionParser.ts（新文件）
把 useChatAI.ts:3278-3350 那 73 行解析逻辑抽到独立模块 `parseMomentsActions(aiContent, { char, addToast })`：
- 解析 `[[MOMENT_POST: ...]]` → `publishPostAsChar`（限 maxPerDay，每次最多 1 条）
- 解析 `[[MOMENT_COMMENT: postId | content]]` → `commentPostAsChar`
- 解析 `[[MOMENT_LIKE: postId]]` → `likePostAsChar`
- 解析后从 aiContent 剥掉所有 MOMENT_* 标签
- 行为完全跟 useChatAI 主聊天流程一致（autoPostByChar 开关、maxPerDay 上限、1 天 5 条等）

`skipActions` 参数支持未来灰度（只剥标签不真发）。

### hooks/useChatAI.ts
- 删掉 73 行内联解析，换成 `aiContent = parseMomentsActions(aiContent, { char, addToast })`
- 删掉 4 个死 import（`publishPostAsChar` / `commentPostAsChar` / `likePostAsChar` / `countTodayPostsByChar` / `getMomentsSettings`）
- 加 `parseMomentsActions` import

### context/OSContext.tsx
- 加 `parseMomentsActions` import
- runProactive 早期 sanitize 之后、XIAO_ZHI_TIAO 解析之前，调 `parseMomentsActions(aiContent, { char, addToast })`
- 主动消息路径现在跟主聊天流程行为完全一致

## 验证

- build 通过
- 主动消息触发 → AI 输出 `[[MOMENT_POST: ...]]` → parseMomentsActions 解析 → 调 publishPostAsChar → 朋友圈真发出去 → toast "📱 江澈 发了一条新朋友圈"
- 标签不再作为字面文本留在聊天流
- 手动按钮路径（调 publishPostAsChar）继续工作

## 涉及文件

- `utils/momentsActionParser.ts`（新文件，~120 行）
- `hooks/useChatAI.ts` import + 73 行 → 1 行
- `context/OSContext.tsx` import + 1 行调用

## 关联

暮色 2026-07-12 写的 `changelogs/2026-07-12-ai-moments-tool.md` 那次只在主聊天流程接了 MOMENT_* 标签。**这次补上主动消息流程漏的**。

## 附：AI 实际输出（暮色截图）

```json
"raw_content": "[[2026-08-23 11:43] [聊天] 吃过了就行。\n\n[2026-08-23 11:43] [聊天] 好，测一下。\n\n[[MOMENT_POST: 08:23早上，才佳说我昨晚发的图发到聊天框去了。测试一下这条能不能正常发出去,!]]\n\n[2026-08-23 11:43] [聊天] 你看这条进圈了吗还是又跑到聊天框来了。"
```

这条是 AI 把 11:43 暮色在 chat 里发的"好，测一下"接续成完整回复，顺手触发了 `[[MOMENT_POST: ...]]`。修复后这条会真发朋友圈 + 标签剥掉不留在聊天里。
