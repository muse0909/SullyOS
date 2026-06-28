# 心声 buff 配色改回"什么颜色都有"+马卡龙色盘兜底

**日期**：2026-06-28
**涉及 commit**：（待提交）

## 改了什么
- 心声（`<emotion>` 块）从硬编码 3 个豆沙色，改回 LLM 自由选色 + 马卡龙色盘兜底
- 改 prompt：要求 LLM 在 `<emotion>` 块里给 `color` 字段（hex），并给颜色搭配情绪气质的指引
- 前端：LLM 给的有效 color → 用 LLM 的；LLM 没给/无效 → 按 label 哈希到马卡龙色盘
- 把色盘 + 哈希 + 兜底抽到 `utils/buffColor.ts`，3 处展示组件统一调用

## 现状回顾（对比 restore-mycode 老版本）
- **老版本**：副 API 异步生成多 buff，prompt 要求 LLM 给每个 buff 一个 color 字段 → 什么颜色都有
- **现状（这次之前）**：主 API 同步内联 `<emotion>` 块，前端硬编码 `intensity → 豆沙色` → 退化成 3 个深浅豆沙
- **这次改后**：保留现状架构（主 API 内联 + 单心声），但让 LLM 给 color；前端马卡龙色盘兜底

## 动了哪些文件
- `utils/buffColor.ts` —— **新建**。`MACARON_COLORS` 12 色色盘 + `isValidHexColor` 校验 + `pickColorByLabel` label 哈希 + `getBuffColor` 主入口
- `hooks/useChatAI.ts`
  - line 13：加 `getBuffColor` import
  - line 802 附近：prompt 字段加 `color: "#FFB5C5"`，字段说明加"选马卡龙色 hex 表达情绪"
  - line 1372：`newBuff.color` 从硬编码 3 选 1 改为 `getBuffColor({ color: emotionData.color, label })`
- `components/chat/EmotionSettingsPanel.tsx`
  - line 5：加 import
  - line 237-239：3 处 `buff.color || '#db2777'` 兜底改为 `getBuffColor(buff)`
- `components/chat/ChatHeader.tsx`
  - line 6：加 import
  - line 230、311：6 处 `buff.color || '#db2777'` 兜底改为 `getBuffColor(buff)`

## 踩坑 / 需要知道的
- **架构没回退**：暮色说"把原来的扒过来"——但老版本的"多 buff 异步评估"架构跟现在不一样，单纯扒会冲突。这次折中：保留现状架构（单心声同步），但在 prompt 层面把"LLM 选色"恢复，配合前端马卡龙色盘兜底，效果接近"什么颜色都有"
- **edit 工具踩坑**：源文件第 802 行是模板字符串单行（read 工具把它 wrap 显示成多行），我一开始用真实换行匹配失败，浪费一次往返。**记下来**：以后改长模板字符串行，先用 `awk` + `xxd` 看真实字节
- **马卡龙色盘 12 色**：粉红/薄荷/淡蓝紫/奶油橘/奶油黄/淡紫/淡绿/蜜桃/淡蓝/暖黄/浅珊瑚/浅青——暖冷中间都有，覆盖大多数情绪气质
- **label 哈希算法**：`(hash * 31 + charCode) >>> 0` 然后 mod 色盘长度。31 是常见字符串哈希乘子，碰撞概率可接受
- **历史 buff 不动**：现存的 `char.activeBuffs` / `emotionHistory` 里的 buff 可能还是旧豆沙色（intensity → 3 选 1），但下次新心声会用新逻辑。**不会**主动迁移老数据——你嫌丑可以清一下"情绪历史"

## 备注
- LLM 选色不稳定：可能忘给 color、可能给奇怪颜色（饱和红/纯黑）。马卡龙色盘兜底就是为了应对这些
- 没改 `apps/../hooks/useChatAI.ts:369` 那处（`color: typeof buff?.color === 'string' ? buff.color : undefined`）——那是给老 evaluateEmotionBackground 路径用的，master 现在不调用，留着不影响
