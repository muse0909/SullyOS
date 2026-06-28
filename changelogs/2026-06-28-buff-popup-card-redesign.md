# 心声弹窗卡片化

**日期**：2026-06-28  
**涉及 commit**：`0bce4e6`

## 改了什么
- 心声历史弹窗从「贴顶下拉列表」（`absolute top-full left-4 right-4`）改成「居中弹出卡片」（`fixed inset-0` + flex 居中）—— 参考「聊天设置」弹窗样式
- 顶部居中标题：「{角色名}·心声」（`{activeCharacter.name}·心声`，例：`Sully·心声`）
- 卡片宽度 `w-[min(94vw,460px)]`，max-h 80vh 内部滚动
- 每条心声卡片整体缩小：rounded-2xl p-3 → rounded-xl p-2.5；字号统一缩：text-[11px]→text-[10px]（日期/按钮）, text-[12px]→text-[11px]（正文）
- 卡片间距加大：space-y-3 → space-y-4
- 日期下方加分割线：`h-px bg-slate-300/50`
- 背景遮罩点击关闭：`onClick={() => setIsBuffListExpanded(false)}`
- 卡片内部 `e.stopPropagation()` 防止冒泡触发关闭

## 动了哪些文件
- `components/chat/ChatHeaderShell.tsx` —— isBuffListExpanded 渲染块（line 366 起的整段重写）

## 踩坑 / 需要知道的（重要）
- 参考样式是同文件 line 414 的 `confirmDeleteBuff` 删除确认弹窗（暮色直接拿这个做样版）
- 暮色明确说"图里右边"指的就是聊天设置弹窗风格——所以今后所有弹窗都按这个模板来
- 用户审美：居中卡片 + 标题居中 + 间距大 + 分割线 + 居中按钮——记入 user memory，下次直接做对

## 备注
- CSS 自定义功能（让用户像气泡工坊一样给心声卡片写 CSS）暮色问了但没确定做——暂放，等他确认再开