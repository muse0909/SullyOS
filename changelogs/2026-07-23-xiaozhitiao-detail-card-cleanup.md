# 小纸条 — 详情/列表卡新一轮清理

**日期**：2026-07-23
**涉及 commit**：`1d216c2`（previews HEAD 推到 `1d216c2`）

## 改了什么

### 列表卡 `XiaoZhiTiaoCard.tsx`
- 删右上角日期（`07/23`）
- 删左下角作者名（`— 江澈的...`）
- 删右下角回复数（`💬 1`）
- 字从 3 行增加到 5 行（`line-clamp-3` → `line-clamp-5`）
- 暮色原话：「列表卡日期和名字都去掉。现在只显示 3 行字，上下空白还很大，增加到 5 行吧」

### 详情页 `XiaoZhiTiaoDetail.tsx`
- **回复按钮改成胶囊**：底部居中，`<ChatCircleText />` 图标 + "回复" 文字，黑色 `bg-slate-900/80` 胶囊包住
- 删卡片内作者名（"— 江澈的..."）
- 卡片顶部只显示日期+时间（"7/23 23:57" 格式），居中
- 卡片 `min-h` 从 320px 改 70vh — 撑满屏幕
- 字大小 13px → 12px（保持 max-w-[60%] 不压便签边框）
- 左右 padding 5 → 3（卡片占满）

### 顺带修的 bug
- **时间显示 33:57 错位 bug**：`new Date(ts).toLocaleString('zh-CN')` 在 Vercel 节点上偶尔会输出 `2026/7/23 33:57`（小时位 24 → 33 错位）
- 改用手动 format：`${month}/${day} ${HH}:${mm}` 100% 稳定
- 抽到 `formatStamp(ts)` 函数复用

## 动了哪些文件
- `components/notes/XiaoZhiTiaoCard.tsx` —— 列表卡清理（去日期/作者/回复数，加 5 行）
- `components/notes/XiaoZhiTiaoDetail.tsx` —— 详情页大改（去作者名、回复胶囊底部居中、时间 format bug fix、撑满屏幕）

## 踩坑 / 需要知道的

1. **暮色审美洁癖（反复强调）**：
   - 列表卡 = 纯字（去一切装饰：日期、作者、回复数）
   - 详情页 = 顶部时间 + 内容 + 底部"回复"胶囊（就这三块）
   - 不要给字加任何底/框/阴影
   - 不要给图加任何白底（暮色抠透明底 PNG 是有理由的）

2. **时间 format 不能用 toLocaleString**：
   - 之前 `toLocaleString('zh-CN')` 偶发 33:57 错位
   - 改手动 `${d.getMonth()+1}/${d.getDate()} ${HH}:${mm}` 永远稳
   - 后续所有时间显示都该考虑手写 format

3. **回复按钮位置迁移**：
   - 之前 `bottom-2 right-3`（右下角）
   - 改 `bottom-3 left-0 right-0 flex justify-center`（底部居中）
   - 胶囊 `rounded-full bg-slate-900/80 text-white px-4 py-1.5`
   - 跟之前 "💬 灰白小圆按钮" 比 → 视觉权重更强（暮色要的就是"能注意到但不抢眼"）

4. **小图标保留 + 加文字**：
   - 暮色说"现在这个小图标保留后面写上回复" —— 意思是图标 💬 不动，加"回复"两字
   - 用 `ChatCircleText`（气泡 + 三点）代替纯 💬 emoji，质感更统一

5. **Vercel 部署**：push 后等 1-2 分钟，刷新页面看效果

## 备注

- `charName` 参数在 `XiaoZhiTiaoCard` 和 `FullXiaoZhiTiaoCard` 都改成 `_charName`（不删保留以备将来还要用到，但当前不显示）
- 暮色没要求改 token `[[XIAO_ZHI_TIAO:...|type]]` 的 type 字段，pending
- 如果暮色再要求 "回复胶囊颜色改浅" / "改位置" / "加评论列表" 等，先问清楚再动
- 暮色反复说要"纯净"——以后加任何元素前先问"这个元素会破坏纯净感吗"
