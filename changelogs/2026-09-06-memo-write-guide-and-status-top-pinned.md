# 2026-09-06 备忘录：AI 写入方法注入 + 状态面板置顶

## 暮色 9-6 16:14 反馈

1. "他根本不知道怎么写" — AI 角色不知道有 `[[MEMO_ADD:...]]` / `[[MEMO_SET_STATUS:...]]` token
2. "状态面板要一直在备忘录页面置顶显示" — 当前 `!hasStatus && !hasMemo` 时整个空态不带状态面板

## 根因 1：AI 不知道 token

- `utils/characterMemo.ts:104-126` `formatStatusPanelForPrompt` 在 `!hasAny` 时返回 `''`
- `utils/characterMemo.ts:227-249` `formatMemoForPrompt` 在 `entries.length === 0` 时返回 `''`
- `utils/chatPrompts.ts:235` 拼 `characterMemoBlock = [statusText, memoText].filter(Boolean).join('\n\n')` — 空状态时 `characterMemoBlock = ''`
- → AI 看不到任何 token 说明，自然不知道怎么写

## 修复 1：chatPrompts.ts 注入"写入方法说明"

`utils/chatPrompts.ts:227-260` 在拼 characterMemoBlock 时**追加固定段**（永远注入，不依赖有没有数据）：

```
【备忘录写入指南 (Memo Write Guide)】
暮色让你自己维护。聊天中你想记下重要的事时，用下面 5 种 token：
  [[MEMO_ADD: event|private | 内容]]           新增条目
  [[MEMO_EDIT: ID | 新内容]]                    修改条目
  [[MEMO_DEL: ID]]                              删除条目
  [[MEMO_SET_STATUS: location|health|schedule|mood|reminder | 内容]]  5 个状态槽整体覆盖
  [[MEMO_CLEAR_STATUS: slot]]                   清空某个状态槽
  region / slot 都接受中文（事件/私人/所在地/身体/在忙/情绪/约定）
```

这样 `characterMemoBlock` 即使是空也至少有写入指南段，AI 永远能看到怎么写。

## 根因 2：状态面板没置顶

- `apps/CharacterMemoPage.tsx:188-238` 旧实现：
  - `!hasStatus && !hasMemo ? <EmptyState>` — 都没就显示空态
  - `{hasStatus && ...}` — hasStatus=false 就不渲染状态面板
- 暮色 9-6 16:14 要求"状态面板要一直在备忘录页面置顶显示"

## 修复 2：状态面板永远置顶

`apps/CharacterMemoPage.tsx`：
- `statusEntries` 不再 `filter`，5 个固定槽永远返回
- 状态面板 block **永远渲染**（去掉 `hasStatus &&` 条件）
- 没值的槽显示 `<span className="text-slate-300 italic">未填</span>`
- EmptyState 改名为 EmptyMemoState，只在 `!hasMemo` 时显示（不影响状态面板置顶）

## 涉及文件

- `apps/CharacterMemoPage.tsx`：状态面板永远置顶 + 5 槽渲染 + EmptyMemoState
- `utils/chatPrompts.ts`：注入"写入方法说明"段（永远追加）

## 验收步骤

1. 进聊天跟江澈说"我在写一下今天的备忘"（或者江澈自然聊到想记的事） → 江澈回复里应出现 `[[MEMO_ADD:...]]` 或 `[[MEMO_SET_STATUS:...]]` token
2. console 应看到 `📝 [Memo] ADD region=...` 或 `📝 [Status] SET ...` 日志
3. 切到发现页 → 角色备忘录 → 状态面板应 5 槽全显示，没值的显示"未填"灰色
4. 江澈的旧 memo 条目（如果之前有写入过）应继续在状态面板下方显示
