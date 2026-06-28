# 心声 buff 配色改回"什么颜色都有"+马卡龙色盘兜底

**日期**：2026-06-28
**涉及 commit**：`18373ea`（第一版 LLM+兜底）、`（待提交）`（第二版纯前端 + djb2 哈希）

## 改了什么（最终版）
- 心声（`<emotion>` 块）从硬编码 3 个豆沙色，改成**纯前端 label 哈希到 12 色马卡龙色盘**
- 12 色色盘按 djb2 哈希分布到 label，**同 label 同色、不同 label 不同色**
- 3 处展示组件统一调用 `getBuffColor(buff)`

## 改动经过（3 个版本）
1. **第一版（被否决）**：`getBuffColor` 优先读 LLM 给的 `color` 字段，色盘哈希兜底
2. **暮色实机反馈**："还全是红的"——LLM 偷懒照搬 prompt 里的示例色 `#FFB5C5`，3 条不同 label 全撞同色
3. **最终版**：
   - prompt **删掉** color 字段要求（不再让 LLM 选色）
   - `getBuffColor` 永远走 label 哈希，**不读** `buff.color`
   - 哈希算法从 31 乘子改成 **djb2 (33 乘子)**——31 乘子对中文 label 分散性差，"掩饰性忙碌/有点心虚/CPU过载中" 三个 label 全撞到 `#D4F0F0`；djb2 下 12 个常见 label 零碰撞

## 现状回顾（对比 restore-mycode 老版本）
- **老版本**：副 API 异步生成多 buff，prompt 要求 LLM 给每个 buff 一个 color 字段 → 什么颜色都有
- **现状（这次之前）**：主 API 同步内联 `<emotion>` 块，前端硬编码 `intensity → 豆沙色` → 退化成 3 个深浅豆沙
- **这次改后**：保留现状架构（单心声同步），前端永远色盘哈希——稳定、多样化、可预期

## 动了哪些文件
- `utils/buffColor.ts` —— **新建**
  - `MACARON_COLORS` 12 色色盘
  - `isValidHexColor` 工具（保留备用）
  - `pickColorByLabel(label)` djb2 哈希
  - `getBuffColor(buff)` 主入口（**忽略 buff.color，永远走哈希**）
- `hooks/useChatAI.ts`
  - line 13：加 `getBuffColor` import
  - line 802 附近：prompt `<emotion>` 块去掉 `color` 字段和相关说明
  - line 1372：`newBuff.color` 用 `getBuffColor({ label })`
- `components/chat/EmotionSettingsPanel.tsx`
  - line 5：加 import
  - line 237-239：3 处 `buff.color || '#db2777'` 兜底改为 `getBuffColor(buff)`
- `components/chat/ChatHeader.tsx`
  - line 6：加 import
  - line 230、311：6 处 `buff.color || '#db2777'` 兜底改为 `getBuffColor(buff)`

## 踩坑 / 需要知道的（重要）
- **LLM 选色不要赌**：prompt 里给示例色，LLM 会直接照搬——这次三条不同 label 心声全是 `#FFB5C5` 就是这么来的
- **中文 label 哈希要 djb2**：31 乘子的经典字符串哈希对 ASCII 字符足够，对中文 UTF-16 charCode（跨度大）分散性差。**以后新代码做中文 label 哈希用 djb2 或 fnv1a，别用 31**
- **edit 工具换行 vs 字面 `\n` 坑**：源文件长模板字符串行是单行，read 工具 wrap 显示成多行。用真实换行匹配会失败，要用字面 `\n`（反斜杠+n 字符）。**记下来**
- **历史 buff 不动**：现存的 `char.activeBuffs` / `emotionHistory` 里的 buff 是旧硬编码的豆沙色，**这次改也不会迁移**——下次新心声用新逻辑。要立刻看全效果的话，在心声历史那里清一下再发消息

## 备注
- 纯前端色盘 + djb2 的好处：稳定、可预期（同一 label 永远同色，不会让用户觉得颜色"乱跳"），省 prompt token
- 没了"LLM 自由选色"的感觉——这是 LLM 不靠谱的代价。**没后悔余地**，等 LLM 哪天听话了再考虑放开
- 没改 `hooks/useChatAI.ts:369` 那处（`color: typeof buff?.color === 'string' ? buff.color : undefined`）——给老 evaluateEmotionBackground 路径用，master 现在不调用，留着不影响
