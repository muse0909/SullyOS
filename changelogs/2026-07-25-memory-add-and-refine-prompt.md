# 记忆宫殿：手动添加 + 精炼 prompt 改"思考"

**日期**：2026-07-25
**涉及 commit**：`463f42c` `7f87254` `d988512` `6037a1e`

## 改了什么

1. **记忆宫殿"Time Logs"加手动添加按钮**（commit `463f42c`）
   - `MemoryArchivist.tsx`：TIME LOGS 区域右上角加 "+ 添加" 按钮（在"管理"左边）
   - 点开是 Modal：日期（默认今天，type=date 可选过去）+ 心情（可选）+ 记忆内容
   - 保存写入当前角色的 `memories` 数组头部
   - `Character.tsx`：加 `handleAddMemory(date, summary, mood?)` 函数，push 一条新 `MemoryFragment`

2. **保存按钮修"按了没反应"**（commit `7f87254`）
   - 之前用 `disabled={!date || !summary}` 把按钮锁灰，点了无视觉/语义反馈，暮色以为按钮坏了
   - 去掉 disabled + 加 toast 错误提示（"请填日期" / "请填记忆内容"）
   - 加 `addToast` prop 给 MemoryArchivist

3. **加合并版精炼 prompt**（commit `d988512`）
   - 新加 preset `preset_combined`（"合并版（事件+日记）"）
   - 一次 LLM 调用输出两部分：`### 事件清单`（理性精炼重点事件）+ `### 内心独白`（第一人称日记）
   - 暮色可在 SullyOS 设置里选这个新 preset

4. **内心独白改"思考"写法**（commit `6037a1e`）
   - 暮色反馈：原内心独白写出来像流水账（"她做了 X → 我反应是 Y"），缺的是【思考】
   - 真人写日记不按时间顺序：思维会跳、矛盾、重复、没结论
   - 加新章节"不是叙述，是思考"，包含好/坏对比示例
   - 加 4 个新规则：思维密度 > 事件覆盖、允许跳跃/矛盾/重复、可以"算了我也不知道"收尾、不写"今天我..."这种开头

## 动了哪些文件
- `components/character/MemoryArchivist.tsx` — 加 onAddMemory prop、+ 添加按钮、Modal、addToast 提示
- `apps/Character.tsx` — 加 handleAddMemory、传 addToast/onAddMemory 给 MemoryArchivist
- `components/chat/ChatConstants.ts` — 新加 `preset_combined`、改第二部分内心独白规则

## 踩坑 / 需要知道的（重要）

- **暮色今天反馈两个事都是我之前判断错的**：
  - "1749 条 memoryNodes" — 我之前记成 7/24 备份有 1749 条，**错的**。实际 7/2 是 1505 条、7/24 是 0 条
  - "自动总结 7/17 后停了" — 我说"是你没点手动"，**错的**。是 SullyOS 的"自动总结"在 7/18 真的被关掉了（待查 commit）
- **保存按钮 disabled 是 UX 反模式** — 锁灰按钮点了没反馈，用户以为坏了。改成"始终可点 + toast 提示空字段"更直观
- **"思考"vs"叙述"的区别** — 暮色要的是"我意识到..."、"我没想通..."、"算了"这种思维痕迹，不是"她做了 X，我的反应是 Y"的反应式记录
- **changelog commit message 我之前写错过** — 第一次写"feat(记忆宫殿): Time Logs 加手动添加"，但其实改的是 MemoryArchivist（角色编辑页面），不是 MemoryPalace 独立 app。下次措辞要准

## 备注
- `preset_combined` 暮色可在 SullyOS 设置里选；之前两个 preset（rational / diary）保留不动
- 内心独白新规则写得很长——可以实测一次看效果，再调整
- 验证：`npm run build` 通过（4.51s）
- 今天还有合并版 7/24 备份恢复 memoryPalace 的事（在 18:00 左右）——没 commit 到 SullyOS 仓库（只动了 7/25 备份的 data.json），算恢复数据，不算 feature
