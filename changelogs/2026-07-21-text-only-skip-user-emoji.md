# 轻量同步 2 个覆盖 bug 修复 — text_only 模式跳过 user profile / emoji

**日期**：2026-07-21（凌晨追加）  
**涉及 commit**：`dc4e80a`

## 改了什么

暮色 2026-07-21 02:00 反馈两个反复出现的问题：
- **用户头像还是会被覆盖**（轻量同步恢复后）
- **角色表情包图标变成损坏图标**（但能正常发）

根因都在 `utils/db.ts:importFullData` —— **7-15 那个 character store 修复漏了**两个 store：
1. `STORE_USER`（用户 profile）
2. `STORE_EMOJIS` + `STORE_EMOJI_CATEGORIES`（表情包）

### Bug 1：user profile 被覆盖

**原代码**（line 1902）：
```ts
if (data.userProfile) {
    if (availableStores.includes(STORE_USER)) {
        const store = tx.objectStore(STORE_USER);
        store.clear();           // ⚠️ 清空
        store.put({ ...data.userProfile, id: 'me' });  // ⚠️ 不分 mode 一律覆盖
    }
}
```

**根因**：`store.clear() + put` 不分 mode —— text_only 模式也直接覆盖本机 user profile。

**场景复现**：
- phone A 用户头像 = R2 URL（暮色美化过的）
- phone B 用户头像 = 默认头像
- phone A 导出 text_only 备份 → 备份里 `userProfile.avatar = R2 URL`
- phone B 导入 → `clear + put` → phone B 头像被覆盖成 R2 URL
- **R2 域名在 phone B 访问不到** → 截图里那个**空方块**

**修法**（1 行代码）：
```ts
if (data.backupMode !== 'text_only' && availableStores.includes(STORE_USER)) {
    // text_only 模式跳过 — user profile 是个人数据，不该跨设备同步
    // full 模式保留 — 整机恢复场景需要覆盖
}
```

### Bug 2：表情包图标变损坏（但能正常发）

**原代码**（line 1835）：
```ts
if (data.savedEmojis) mergeStore(STORE_EMOJIS, data.savedEmojis);
if (data.emojiCategories) mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories);
```

**两个根因叠加**：
1. `mergeStore` 只 put 不 delete → phone A 删了的 emoji 在 phone B 备份里 → phone A 导入后**复活**
2. text_only 导出时 `stripBase64` 把 `data:image/...` 转成 `''` → 导入时 `put('')` 覆盖本机的 base64 → **图标显示空 / 损坏**（但 emoji.name 还在，所以输入 `[/emojiName]` 还能发）

**完美对得上暮色说的"图标变损坏但能正常发"**。

**修法**（B 方案，暮色之前在 02:00 选过）：
```ts
if (data.backupMode !== 'text_only') {
    if (data.savedEmojis) mergeStore(STORE_EMOJIS, data.savedEmojis);
    if (data.emojiCategories) mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories);
}
```

**代价**：跨设备 emoji 不同步（phone A 独有的 emoji 不会同步到 phone B）—— 暮色接受（手动加）。
**完整跨设备 emoji 同步**留待 V2，需要更智能的 sync（base64 vs URL 区分、避免覆盖本机、不复活已删）。

## 动了哪些文件

- `utils/db.ts` —— +13 / -3
  - line 1835-1841: emoji + emojiCategories 改 text_only 跳过
  - line 1902-1912: userProfile 改 text_only 跳过

## 踩坑 / 需要知道的（重要）

### 1. text_only 模式语义应该是"只加不减、不覆盖本机美化"

7-15 那个修复定下的 text_only 模式理念是：
- 共享数据（聊天记录、世界书）按 ID 合并
- 个人数据（美化、头像、表情包）**不动**

**实现**时只改了 character store（按 ID 跳过本机有的）。**STORE_USER + STORE_EMOJIS 漏了**——这次补上。

**未来 text_only 模式改 store 时，先问自己"这个 store 是个人数据还是共享数据？"**：
- 个人数据（user profile / emoji / theme）→ text_only 模式跳过
- 共享数据（character / messages / worldbook / memory palace）→ text_only 模式正常导入

### 2. stripBase64 的副作用

`text_only` 模式导出时跑 `stripBase64` —— 把 `data:image/...` 转成 `''`，避免大文件进备份。

**副作用**：base64 表情包被清成 `''` → 导入时 `put('')` 覆盖本机 → 表情包失效。

**为什么不直接保留 base64** —— 因为 text_only 模式的设计是"小文件"（1-3MB），保留 base64 会让备份膨胀到几十 MB。

**V2 emoji 同步方案**（暂缓）：
- text_only 模式 emoji **导出保留 base64**（不被 stripBase64）
- text_only 模式 emoji **导入时跳过空字符串**（避免 `''` 覆盖）
- 跨设备 emoji 真正能同步
- 代价：备份略大（每个 base64 emoji 几十 KB）

## 备注

- **未做**：数据增量恢复（暮色 02:00 提的"只导上次恢复时间点之后的数据"）—— 设计需要讨论，**留明天**
- **未做**：16M → 1-3M 减体积（A 方案：按 hideBeforeMessageId 过滤 memoryVectors + base64 压缩）—— 7-15 changelog 登记过，未做
- **未做**：完整 emoji 跨设备同步 V2 —— 需要设计
- ping abort 报错（暮色 02:00 提到）—— **暮色说不用管**，留观
- 7-15 那个 character 修复 (`629bd35`) + 这次 2 个 store 修复 (`dc4e80a`) 一起覆盖了 text_only 模式的所有 store
