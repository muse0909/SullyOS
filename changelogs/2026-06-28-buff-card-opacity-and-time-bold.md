# 心声卡片背景不透明 + 时间字加深

**日期**：2026-06-28  
**涉及 commit**：`d2054b1`

## 改了什么
- 心声历史大卡片 + Sully 头像旁小 chip 的 `background` 从 14-30% 透明度改为满色（intensity 1=60% / 2=80% / 3=100% 透明度叠加白底）—— 解决后面聊天气泡穿过来跟心声文字打架的问题
- 时间戳去掉 `opacity-70`，改 `text-[11px] font-bold text-slate-600`（深灰满色）—— 之前时间字用了 buff 自己的淡色 + opacity-70，几乎看不清
- 心声文本 `text-slate-700/90` → `text-slate-800`（满色不透明）
- "删除"按钮去掉 `color: style.text`（buff 淡色），改固定 `text-slate-700`
- 文字色统一用 `slate-800` 深灰，不再跟随 buff color——对比清晰

## 动了哪些文件
- `components/chat/ChatHeaderShell.tsx` —— `getBuffStyle` 函数 + 时间戳 / 心声文本 / 删除按钮三处

## 踩坑 / 需要知道的（重要）
- 上一版 `bd7f237` 把 `getBuffStyle` 改成走 label 哈希，但**还保留了 alpha 透明度**——用户看着仍像旧版（穿透气泡 + 时间字看不清），实际颜色已经对了但视觉问题没解决
- 这次才彻底把透明度提到能挡住底层气泡的水平
- **下次改样式前先 grep**：上次踩的坑（ChatHeaderShell 没用 getBuffColor）这次没犯，但**改 background 时还是没注意 alpha**——以后改样式时一次想清楚所有视觉维度（颜色 + 透明度 + 字号 + 边距）

## 备注
- 这次没建单独 changelog 是因为和下一个任务（弹窗卡片化）连着做——下个 changelog 会涵盖