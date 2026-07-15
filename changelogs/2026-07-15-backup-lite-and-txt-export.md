# 备份模式重构 — 轻量同步 + 聊天记录 .txt 导出

**日期**：2026-07-15
**涉及 commit**：`366fd31` + 后续修正

## 改了什么

### 1. text_only 模式改为「轻量同步」

**之前**：text_only 模式只排除 `assets` 资源池，但**所有美化字段都打包**，导入时整库覆盖导致本机美化被清空。

**之后**：text_only 模式只打包**文字+记忆+基础数据**，完全不碰美化和图片。

**导出不带的 store**：
- `themes`（聊天气泡背景图）、`emojis`/`emoji_categories`（表情包）、`assets`（资源池）
- `gallery`（相册）、`journal_stickers`（日记贴纸）、`social_posts`（Spark 社交）
- `xhs_stock`（小红书股票图）、`pixel_home_assets`/`pixel_home_layouts`（像素房间图）

**导出不带的字段**（backupData 顶层）：
- `theme` / `customIcons` / `appearancePresets`（美化数据）
- `socialAppData`（Spark 社交，包括 userProfile/userBg/userId）
- `roomCustomAssets`（自定义房间素材）

**characters 数组处理**：保留但 `stripBase64` 清空所有图片 base64 字段
- `avatar / chatBackground / dateBackground / sprites / spriteConfig / customDateSprites`
- `dateSkinSets / activeSkinSetId / roomConfig.* / bubbleStyle`

**保留的 store**（轻量核心数据）：
- characters, messages, user_profile, groups
- diaries, tasks, anniversaries, room_todos, room_notes
- courses, games, worldbooks, novels, songs
- bank_transactions, bank_data, xhs_activities
- quizzes, guidebook, scheduled_messages, life_sim
- memory_nodes/vectors/links/topic_boxes/anticipations/event_boxes/batches
- daily_schedule

**体积预估**：50MB 完整 → **1-3MB 轻量**，手机电脑互导秒传。

### 2. 导入端按 backupMode 分策略合并

**给 `FullBackupData` 加 `backupMode?: 'text_only' | 'media_only' | 'full'` 字段**（types.ts）。

**characters 导入逻辑**（`utils/db.ts` importFullData）：
- `backupMode === 'text_only'` → 按 charId 合并：本机有同 ID 角色 → 文字字段用 backup，**图片/美化字段强制保留本机**；本机没有 → 用 backup 新建（图片字段是空壳）
- 其他模式 → 维持 `clearAndAdd` 整库替换

**messages 导入逻辑**：
- `isPatchMode = !data.characters || data.backupMode === 'text_only'`
- text_only 模式 → 按 ID 合并不清空，**本机独有消息保留**
- 其他模式 → 整库替换

**老备份兼容**：老 zip 没有 `backupMode` 字段 → `undefined` → 走 `clearAndAdd` 旧逻辑，不破坏老行为。

### 3. 新增「聊天记录 (.txt)」导出按钮

**位置**：设置页 → ZIP 备份 → 「媒体与美化素材」下面新加一个 emerald 色按钮

**功能**：
- 点击弹角色多选器（`Modal` 组件，按 AGENTS.md 标准圆角 2.5rem）
- 单选 → 下载 1 个 .txt 文件
- 多选 → 打包 zip 下载（每个角色一个 txt）
- 顶部「全选」按钮
- 底部「取消 / 导出 (N)」胶囊按钮

**txt 格式**（按之前和暮色商量的样例）：
```
【Sully 的聊天记录】
导出时间：2026-07-15 12:50
共 156 条消息

—— 2026-07-14 ——
12:30
Sully: 你今天怎么样？
我: 还行，刚睡醒

—— 2026-07-15 ——
09:15
Sully: ...
```

**非文本消息标注**：[图片] [表情] [语音] [社交卡片] [小红书卡片] [账单卡片] [音乐卡片] [MCD 卡片] [转发] [卡片] [转账] [互动]

**群聊消息不导出**：`DB.getMessagesByCharId` 内部已 `filter(!m.groupId)`，单人聊天 txt 不混入群聊。

**Capacitor 兼容**：原生平台走 `Filesystem.writeFile` + `Share.share`；Web 走 `<a download>`。

### 4. UI 文案调整

- "纯文字备份" 按钮 label → "轻量同步"，副标 "聊天+记忆+API"
- 描述文案更新，强调"按 ID 合并不会覆盖本机美化"

## 动了哪些文件

- `types.ts` —— `FullBackupData` 加 `backupMode?` 字段
- `utils/db.ts` —— importFullData 的 characters 合并逻辑 + messages patch mode 条件
- `context/OSContext.tsx` —— exportSystem 的 text_only 模式白名单 + 排除美化字段 + 加 backupMode
- `apps/Settings.tsx` —— 按钮 label/描述 + 角色多选弹窗 + handleExportChatTxt handler + import DB/Message/CharacterProfile 类型

## 踩坑 / 需要知道的（重要）

### 1. `loadJSZip` 在 OSContext 里没 export

之前 exportSystem 内部用的 `loadJSZip` 是 OSContext 私有函数，Settings.tsx 没法 import。**新代码动态 import jszip 包**：

```ts
const JSZipMod = await import('jszip');
const JSZipCtor = (JSZipMod as any).default || JSZipMod;
```

只用于聊天记录 zip 打包（多角色场景），单角色直接下载 txt 不用 zip。

### 2. `DB.getMessagesByCharId` 是 async 的

第一版我同步调用了，build 通过但运行时拿到的是 `Promise<Message[]>`，filter/sort 会失败。修法：先 await 把所有角色的消息取出来，再同步构造 txt。

```ts
const charData: Array<{ char, messages }> = [];
for (const char of targets) {
    const all = await DB.getMessagesByCharId(char.id);
    charData.push({ char, messages: all.filter(...).sort(...) });
}
```

**未来优化**：多角色可以 `Promise.all` 并行取消息，但当前不是性能瓶颈，先简单做。

### 3. `Message.content` 总是 string

我第一版误以为 emoji/image 消息的 content 是 array。实际所有消息 content 都是 string：
- text 消息 → 直接是文字
- emoji 消息 → 是 emoji URL
- image 消息 → 是图片 URL

第二版简化：去掉 Array.isArray 分支，按 `m.type` 字段打中文标记 [图片] [表情] 等。

### 4. 弹窗双滚动条问题

第一版我在弹窗角色列表里加 `max-h-[40vh] overflow-y-auto no-scrollbar`，但 Modal 容器已经 `overflow-y-auto` — 两层滚动冲突。**最终方案**：去掉内层 max-h，让外层 Modal 自然滚。`max-h-[80vh]`（AGENTS.md 2026-07-03 拍板的）已经在 Modal 上限制了。

### 5. 记忆宫殿水位线要备份

`memoryPalaceHighWaterMarks` / `memoryPalaceFlags` 已经在 text_only 模式带（line 2187/2201 现状），不用动。但**导入时它们走 `cloudBackupConfig` 同款 localStorage 回写** —— 我没改 importFullData 里的水位线还原逻辑（保持现状）。如果用户在 phone A 备份水位线 1000，phone B 恢复后会**看到所有消息**（因为 phone B 水位线是 0，importFullData 不影响水位线写入）。这是跨设备同步的预期行为。

### 6. text_only 模式老备份怎么办

老 zip 没有 `backupMode` 字段 → `undefined` → importFullData 走旧逻辑（clearAndAdd + 整库替换）→ 维持老行为。**不破坏老数据**。

但老 text_only 模式备份的"导入会覆盖本机美化"问题**不会自动修复** —— 用户如果用老备份还原还是会清空美化。要让用户重新备份一次新版本的轻量同步。

### 7. 角色选择器没"反向选择"功能

弹窗只有「全选」按钮，没有「反选」「只选最近聊过的」之类的复杂筛选。暮色没要求，先这样。

## 备注

- 单设备测试路径：
  1. 设置 → ZIP 备份 → 轻量同步 → 导出，看 zip 大小
  2. 设置 → 导入 → 选刚导出的 zip → 验证本机美化（主题/图标/角色头像/房间图）不被覆盖
  3. 设置 → 聊天记录 (.txt) → 选 1 个角色 → 验证 txt 内容格式
  4. 设置 → 聊天记录 (.txt) → 选多个角色 → 验证 zip 内多个 txt
- 跨设备测试路径（需两台设备）：
  1. phone A 导出轻量同步 + phone A 改一个聊天消息
  2. phone B 导入轻量同步
  3. 验证 phone B 聊天记录合并成功 + phone B 的美化/角色头像保留
  4. 验证 phone A 改的那个消息也出现在 phone B 上
- 与 Vercel Hobby 10 秒超时的关系：轻量同步 1-3MB，systemPrompt 构建时间减少（messages 少，tokens 少），**应该能缓解 504 FUNCTION_INVOCATION_TIMEOUT 问题**（见 memory lesson）。这个收益是副作用，没主动验证。
- 后续如果要加「聊天记录导入」回 SullyOS，恢复路径要另外设计（DB.messages 已经是 put by id，理论上 txt 解析后 put 进去就行，但要做角色匹配/去重），暂不在本次范围。

---

## ⚠️ 第一版 UI 摆错位置 — 修正记录

暮色反馈："聊天记录导出这个放在上面，3个并排，顺序是轻量-媒体-聊天记录。还有个更大的问题，轻量我是要改云端备份里的，不是zip里的呀。"

**第一版做错了**：
- ❌ 把"纯文字备份" ZIP 按钮改成了"轻量同步"（这是云端概念）
- ❌ 聊天记录按钮放在了 ZIP 区下面（单独一行）
- ❌ 云端按钮 label 仍是"(纯文字)"没改

**修正后**：
- ✅ ZIP 区"纯文字备份"按钮 label 还原成"纯文字备份"（保持原语义）
- ✅ ZIP 区三个按钮 3 并排布局：`grid-cols-3` 纯文字 | 媒体 | 聊天记录
- ✅ 云端按钮"(纯文字)" → "(轻量同步)"
- ✅ 云端按钮下面加说明文字：「轻量同步：只上传文字+记忆+API，体积通常 1-3MB，导入时按 ID 合并，不会覆盖本机美化」

**底层行为不变**（commit `366fd31` 已经实现的）：
- `text_only` mode 行为保持（去美化 + 合并策略）
- ZIP 区域"纯文字备份"按钮虽然 label 回到"纯文字"，但**走的还是新行为**（不打包美化 + 合并策略）— 因为底层 mode 相同
- 也就是说：用户点 ZIP 区的"纯文字备份"导出的也是 1-3MB 轻量版本，导入时按 ID 合并不覆盖本机美化

**教训（写入 agent memory 待办）**：
- 暮色说"轻量同步"语义时，他主要指云端场景
- 我下意识把 UI label 和"轻量"挂钩到所有 text_only mode 的地方，没区分"ZIP 本地"和"云端"两个场景
- 实际同一 mode 在不同入口可以是不同 label：ZIP 叫"纯文字备份"（突出"只文字"），云端叫"轻量同步"（突出"快速同步"）
- 场景决定 label，mode 决定行为 —— 这是两件事

WHY：暮色 2026-07-15 14:36 反馈 ZIP 区显示"轻量同步"不对，聊天记录按钮位置不对。修正 commit 见 git log。
