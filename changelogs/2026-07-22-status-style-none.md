# 在线状态样式新增「不显示」选项

**日期**：2026-07-22
**涉及 commit**：`aabdee7`

## 改了什么
- 在线状态样式从 3 个选项（弱提示 / 状态胶囊 / 圆点在线）扩展到 4 个，新增「不显示」
- 选「不显示」时，聊天 header 不再渲染任何 online 状态元素（跟 telegram header 风格一致 — 整段 null）

## 动了哪些文件
- `types.ts` — `OSTheme['chatStatusStyle']` union 加 `'none'`
- `components/appearance/ChatAppearanceEditor.tsx` — `choices.status` 数组加第 4 项
- `components/chat/ChatHeaderShell.tsx` — props 类型同步 + 渲染逻辑加 `(headerStyle === 'telegram' || statusStyle === 'none') → null` 短路
- 预览（line 400-402）三个独立条件分支不动 — 「不显示」时三个条件都假，预览自然空，暮色能直观看到效果

## 踩坑 / 需要知道的（重要）
- **类型必须 union 同步**：三处类型签名（`types.ts` OSTheme + `ChatHeaderShell` props + 隐含的 `as OSTheme['chatStatusStyle']` 断言）必须同时加 `'none'`，否则 TS 在 `onPick` 处会报"不能 assign 'none' 给类型"
- **预览区不需要单独画"不显示"提示**：保持三个独立 `{statusStyle === 'pill' && ...}` 写法，'none' 三个条件都假 → 自然空白 → 用户选完一眼看到效果
- **预设值不动**：line 19/39/59/79/99/119/145 的预设 statusStyle 都是用户已选值，老用户行为不变；新用户走 `defaults.chatStatusStyle = 'subtle'`

## 备注
- 已合并到 master（commit `3da5f54`），preview HEAD = `aabdee7`
