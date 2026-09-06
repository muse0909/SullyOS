# 2026-09-06 备忘录 token 解析：match → matchAll + 角色下拉框改到 header

## 暮色 9-6 16:25 反馈

1. **状态面板没写入** — 截图 console 显示 `📝 [Status] SET unknown slot="那几个slot"`，但 AI 原文里其实有第二个 `[[MEMO_SET_STATUS: mood | 被才佳怼了，活该]]`，**这个 mood 没被解析**
2. **切换角色想改到顶上** — header 区域，标题"角色备忘录"那行（截图箭头指的位置）

## 根因 1：token 解析用 `match()` 只取第一个

`hooks/useChatAI.ts:3631-3686` 5 个 MEMO token 解析（MEMO_ADD/EDIT/DEL/SET_STATUS/CLEAR_STATUS）都用 `aiContent.match(regex)` — match 默认只返回第一个匹配。

AI 一次回复里可能写多个同类型 token（比如同时记多条 memo + 多个状态槽），后面的全部被忽略。截图案例：AI 一次回复里写两个 SET_STATUS，第一个 slot="那几个slot"（AI 自己写错了），第二个 slot="mood"（正确的）— 第二个被丢。

**XIAO_ZHI_TIAO 那 3 个 token 保持 `match()`**（设计意图："prompt 限制了一次最多 1 条"，行 3719 注释说明），只改 MEMO_* 这 5 个。

## 修复 1：matchAll

5 个 MEMO token 改成 `aiContent.matchAll(regexWithGFlag)`，for...of 循环解析所有匹配。

## 根因 2：角色下拉框独立在 header 下面

`apps/CharacterMemoPage.tsx:163-184` 原本结构：
- Header：返回 + 标题"角色备忘录" + 占位
- 独立块：角色下拉框（白卡 + 图标）+ 副标题

暮色反馈"想改到顶上"。

## 修复 2：角色下拉框合并到 header

`apps/CharacterMemoPage.tsx:148-184` 改：
- Header 改为：返回 + 标题"角色备忘录" + 角色下拉框（inline 胶囊样式，rounded-full，带小图标）
- 删独立的角色切换卡（原本 header 下面那一块）
- 副标题"X 自己记的备忘录"挪到内容区上方一行小字

## 涉及文件

- `hooks/useChatAI.ts`：5 个 MEMO token 解析 match → matchAll
- `apps/CharacterMemoPage.tsx`：header 整合角色下拉框

## 验收步骤

1. 进聊天跟江澈说"帮我同时记两件事" → 江澈一次回复里输出 2 个 `[[MEMO_ADD:...]]` / 2 个 `[[MEMO_SET_STATUS:...]]` → console 应看到 2 条 `📝 [Memo] ADD ...` + 2 条 `📝 [Status] SET ...`
2. 切到发现页 → 角色备忘录 → 状态面板 5 槽全显示
3. header 一行：返回 + "角色备忘录" + 角色下拉框胶囊
