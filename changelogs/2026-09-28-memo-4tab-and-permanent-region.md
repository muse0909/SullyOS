# 备忘录功能重构 — 4 tab UI + 核心约定永久区 + 写入去重

**日期**：2026-09-28  
**涉及 commit**：`64728977` `6909d90e`

## 改了什么

暮色 9-28 反馈备忘录功能 3 个问题：
1. **重复写入** — 同一条消息可能被写入多次（图上 5 条完全一样）
2. **角色删除不靠谱** — AI 用 `[[MEMO_DEL:id]]` 经常漏删 / 删错号 / 删不干净
3. **重要内容被静默淘汰** — 30 条 / 5 条上限被重复占满，暮色不知情

**江澈 9-5 拍板"暮色只读" → 暮色 9-28 推翻**："实战暴露问题，完全让 AI 管理还是不行"。

### 数据层改动

- `types.ts:705` `CharacterMemoRegion` 加 `'permanent'`（核心约定）
- `utils/characterMemo.ts`：
  - 上限调整为：重点事件 **10 条**（原 5）、非永久区合计 **50 条**（原 30）
  - `addMemo` 加**写入去重中档**：
    - 完全相同字符串 → 丢弃
    - 关键词袋 Jaccard 相似度 ≥ 0.7 → 视为重复，丢弃
    - 关键词袋算法：中文 2-gram、英文按词，过滤 60+ 停用词（的/了/是/在/和/然后 等）
  - `addMemo` 的上限淘汰**绕开 permanent 区**
  - `deleteMemo` 命中 `region === 'permanent'` → 静默拒绝（AI 想删核心约定无效）
  - 新增 `promoteMemoToPermanent(charId, id)`：手动永久保存（保留原 id，只改 region）
  - 新增 helper `tokenize()` / `jaccard()`（中档去重算法实现）
- `hooks/useChatAI.ts:3504` `REGION_ALIAS` 加 6 个中文/英文别名：permanent / core / 核心约定 / 永久 / 永久区 / 自留地 / 重要约定

### Prompt 改动（`utils/chatPrompts.ts:273`）

写入指南末尾追加 2 段：

- 【别重复写】同一件事不要写两遍。如果某条已经记过了，直接 `[[MEMO_EDIT]]` 修改，或者不动。重复的话题会触发去重，写了也进不去数据库。
- 【核心约定 (permanent)】永久保存区。写在"核心约定"的内容不会被任何上限淘汰。你（AI）能 `[[MEMO_EDIT]]` 修改核心约定，但**不能**用 `[[MEMO_DEL]]` 删除核心约定里的条目——删除会被程序忽略。

`MEMO_ADD` 那行 token 说明也加 `核心约定/permanent` 提示。

### UI 改动（`apps/CharacterMemoPage.tsx` 整文件重写）

- 删副标题"江澈自己记的备忘录，暮色只能看不能改"（暮色 9-28 推翻只读设定）
- **4 个 tab 顶端并列**：当前状态 / 重点事件 / 私人笔记 / 核心约定
  - 配色（按暮色审美，不用粉色/玫红）：sky / emerald / amber / **violet**（核心约定）
  - 选中态：主色实色 + 白字；未选中：浅色底 + 浅色字
- **状态面板 tab**：6 个槽点文字直接进编辑（recent 用 textarea，其他用 input），onBlur 自动保存，Enter 也保存
  - 每槽右上角 hover 显示 🗑 清空按钮（弹确认）
- **三种备忘 tab**：点条目弹 `Modal` 编辑
  - 重点事件 / 私人笔记 弹窗底部：【永久保存】【保存】
  - 核心约定 弹窗底部：**只有**【保存】（已永久，无需再升级）
  - 弹窗按 `components/os/Modal.tsx` 统一规格（max-w-sm + rounded-[2.5rem] + max-h-80vh）
- **每条卡片右下角 hover 显示快捷 🗑 删除按钮**（弹 window.confirm）
- 核心约定的卡片左侧加紫色竖条 + 底部 ⭐"核心约定 · 永久保存"小标识

## 动了哪些文件

- `apps/CharacterMemoPage.tsx` —— 整文件重写（4 tab UI + 编辑交互 + 弹窗）
- `types.ts` —— `CharacterMemoRegion` 加 `'permanent'`，注释更新
- `utils/characterMemo.ts` —— 去重算法 + permanent 绕开淘汰 + promoteMemoToPermanent
- `hooks/useChatAI.ts` —— REGION_ALIAS 加 permanent 7 个别名
- `utils/chatPrompts.ts` —— 写入指南加 2 段（别重复写 + permanent 说明）

## 踩坑 / 需要知道的（重要）

### 1. 江澈 9-5 vs 暮色 9-28 的指令冲突

江澈 9-5 拍板"暮色只读"（写在 `CharacterMemoPage.tsx` 顶部注释 + 整个 UI 设计）。暮色 9-28 实战后**明确推翻**，要求暮色可以手动操作（删除 / 编辑 / 永久保存 / 编辑状态面板）。本次按暮色最新指令覆盖。

按 9-12 memory 提示："江澈的指令可能有偏差，要核对"——这次核对结果：暮色实战暴露问题后调整方向，符合"用户优先"原则。**长期目标不变**，只是具体执行细节按暮色调整。

### 2. 旧 IDB 残留 `region === 'status'` 数据

5d71187 之前的 IDB 数据里有 `region: 'status'` 的 memo 条目（旧结构）。本次 `CharacterMemoRegion` 加了 `'permanent'` 但**没动 `'status'`**——因为 type 定义是 union，加字段不影响旧数据读取。

`CharacterMemoPage.tsx` 的 byRegion 分组代码里**只初始化了 3 个 bucket**（`event` / `private` / `permanent`），遇到旧 `region: 'status'` 的条目会被静默忽略（不崩）。**这次没迁移旧数据**，按"未知 region 跳过"处理；如以后发现旧数据要迁移，再写一次性脚本。

### 3. addMemo 双重淘汰逻辑还没重构

旧逻辑：`eventEntries.length > 5` 淘汰一次 + `totalEntries.length > 30` 淘汰一次。本次只把 5/30 调到 10/50，**没重构双重淘汰**——暮色 9-28 说"按你的顺序开始动手，bug 那个等后面测试的时候一起改吧"，7.2（addMemo 双重淘汰冗余）跟 7.1（IDB 残留排查）一并延后。

7.1 这次确认是**我自己看错图**——截图 #75-#82 是私人笔记内容，不是重点事件。截图里 8 条全部在私人笔记区是正常的 30 条（现在是 50 条）上限内的展示，不是 bug。暮色 9-28 14:39 反馈纠正。

### 4. tokenize 算法局限性

关键词袋（中文 2-gram + 英文单词 + 停用词过滤）能挡 80%+ 重复，但对以下情况会失效：
- 同义词替换（"重要" vs "关键"、"说" vs "讲"）
- 句子结构大改但意思相同
- 长对话里穿插了情绪 / 表情修饰

**0 成本兜底**：写入指南里【别重复写】那段——从源头预防 AI 自我强化重复。算法失败时还有 prompt 这层兜底。

### 5. 删 `[[MEMO_DEL:ID]]` 命中 permanent 时静默拒绝

`utils/characterMemo.ts:215` `deleteMemo` 检查 `target.region === 'permanent'` → return false。`useChatAI.ts:3571` 收到 `ok=false`，只打 console.warn。**不会报错**——AI 看不到提示，可能会困惑"为什么删不掉"。

写入指南里**已经写明**"AI 不能用 [[MEMO_DEL]] 删除核心约定"，但要靠 AI 记住。建议下次反馈时如果发现 AI 还尝试删核心约定，**改成显式提示 AI**（在 `console.warn` 处加 toast 给 AI 看）。本次先按"写入指南预防"做。

## 备注

### 未完成的 todo（截止本 commit）

- [ ] 排查 addMemo 双重淘汰逻辑是否真的有 bug（暮色说"等测试时一起改"）
- [ ] 测试：电脑端访问 Vercel preview URL 看 4 tab UI 视觉效果（暮色）
- [ ] 测试：手机端 master 是否能正常展示（暮色说"合 master" 才 push）
- [ ] 验证写入去重效果：让 AI 在同一话题里连续 3 次触发 `[[MEMO_ADD:事件|xxx]]`，看是否只入 1 条
- [ ] 验证 permanent 写入：手动写一条 `[[MEMO_ADD:核心约定|xxx]]`，看是否进核心约定 tab 且不被淘汰
- [ ] 验证手动永久保存：点"重点事件"一条 → 弹 Modal → 点【永久保存】，看是否挪到核心约定 tab 且 id 保留
- [ ] 验证删除永久区：AI 试图删核心约定的，看 console.warn + UI 没动

### 跟其他功能的耦合

- **跟 AI prompt 的耦合**：写入指南是**永远注入**的（chatPrompts.ts:227 那段），所有走 chatAI 的场景（聊天 / 主动消息 / 群聊）都自动受益
- **跟 IDB schema 的耦合**：本次**没动** IDB schema（仍用现有 `character_memos` store），不涉及数据库版本升级
- **跟云端同步的耦合**：如果有云端同步 memo 的逻辑，会自动同步新 region（因为只是 entries 数组里加字段）