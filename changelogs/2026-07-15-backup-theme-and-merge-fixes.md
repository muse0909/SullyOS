# 备份回归 bug 修复 — theme 丢失 + 头像被覆盖

**日期**：2026-07-15（晚间追加）
**涉及 commit**：`629bd35`

## 改了什么

### Bug 1：完整/媒体模式也不带 theme 了

**暮色反馈**："完整备份怎么美化也不带过来了？壁纸和聊天界面的聊天壳不对了。"

**根因**：上一版我误把 `theme: theme`（所有 mode 都带）改成了 `theme: undefined`（所有 mode 都不带）。`context/OSContext.tsx:2176` 的一行改动同时影响了完整/媒体模式 —— 之前根本没意识到。

**修复**：
```ts
theme: (mode === 'media_only' || mode === 'full') ? theme : undefined,
```

- text_only 仍不带（轻量同步不带美化，预期）
- 完整/媒体模式恢复带 theme（整机恢复的一部分）

**导入端**：line 2663 `if (data.theme) { await updateTheme(data.theme); }` 现在能正常触发了。

### Bug 2：轻量同步覆盖头像/图片字段

**暮色反馈**："轻量同步还是会覆盖掉原来的头像那些，头像图会变成图片损坏的那个图标。"

**根因**：merge 模式只列了 10 个图片字段白名单强制保留本机：
```ts
charStore.put({
    ...bc,                          // bc 里图片字段是 stripBase64 清成的 ''
    avatar: ec.avatar,              // 强制 10 个图片字段用本机
    chatBackground: ec.chatBackground,
    // ...
});
```

但 `CharacterProfile` 实际有**更多含图片的字段**，白名单会漏：
- `sprites` 内部某些情绪的 base64（被 stripBase64 清成 `''`，但其他键还有效，**白名单的 `sprites: ec.sprites` 应该 OK** — 实际看代码是 OK 的）
- `roomConfig.items[].image`（被 stripBase64 清成 `''`，**白名单的 `roomConfig: ec.roomConfig` 整体保留本机 OK**）
- **`phoneState.records[*].image` 之类**（CharacterProfile.phoneState 字段不在白名单里 → 走 `...bc` → 覆盖）
- **`savedDateState` / `savedRoomState` 里的图**（同上）
- **`activeMsg2Config` / `emotionHistory` 里可能有图**（同上）

最致命的可能是：白名单**字段类型不匹配**导致的覆盖：
- `ec.avatar` 是 `string`（base64 / URL）
- `ec.avatar` 如果**是 `undefined`**（本机没设），`avatar: undefined` 会**显式覆盖** `bc.avatar` 为 undefined → 损坏

实际上最常见的损坏场景是 **`ec.avatar` 本来是 R2 URL**（不是 base64），`bc.avatar` 被 stripBase64 清成 `''`，`avatar: ec.avatar` 写入 URL → phone B 上 R2 URL 加载失败 → 显示损坏图标。

**修复**（`utils/db.ts:1749-1795`）：换成"以本机 ec 为底，bc 里非空字段覆盖"的通用逻辑：

```ts
const merged: any = { ...ec };  // 本机为底
for (const key in bc) {
    const bv = (bc as any)[key];
    // 空字符串/null/undefined 跳过（stripBase64 清的图、不存在的字段）
    if (bv === '' || bv === null || bv === undefined) continue;
    // 对象递归清空字符串元素（sprites/roomConfig 内部残留的 base64）
    if (typeof bv === 'object' && !Array.isArray(bv) && bv !== null) {
        const cleaned: any = {};
        let hasValue = false;
        for (const k in bv) {
            if (bv[k] !== '' && bv[k] !== null && bv[k] !== undefined) {
                cleaned[k] = bv[k];
                hasValue = true;
            }
        }
        if (hasValue) merged[key] = cleaned;
    } else if (Array.isArray(bv)) {
        const cleaned = bv.filter((item: any) => item !== '' && item !== null && item !== undefined);
        if (cleaned.length > 0) merged[key] = cleaned;
    } else {
        merged[key] = bv;
    }
}
charStore.put(merged);
```

**效果**：
- 本机所有字段保留（ec 为底）
- bc 里**非空字段**覆盖（文字描述/systemPrompt/memories 同步过来）
- bc 里**空字符串字段**跳过（stripBase64 清的图片 base64）
- bc 里**对象/数组**递归清空字符串元素（sprites 内的 `''` 也会跳过）

**这样不用列图片字段白名单**——bc 里凡是空字符串（包括 base64 被清的）都不会覆盖本机的图。

## 动了哪些文件

- `context/OSContext.tsx` —— `theme` 字段：改成按 mode 条件带
- `utils/db.ts` —— importFullData 字符集合并逻辑：从白名单改成通用"非空覆盖"

## 踩坑 / 需要知道的（重要）

### 1. theme 字段 bug 是"看起来无害的一行改动"

```ts
- theme: theme,            // 所有 mode 都带
+ theme: undefined,        // 所有 mode 都不带
```

这一行改动**只改了一个字面值**（`theme` → `undefined`），但影响所有 mode。`customIcons` / `appearancePresets` 我用条件式 `mode === 'media_only' || mode === 'full'` 是正确的，**唯独 theme 字段被改成无条件 undefined**。这是 code review 应该抓的，但因为只改了一行没专门 review 流程。

**教训**：以后改字段默认值时，先想"这个值原来有没有条件？无条件就全不设？"——**不是**"无条件就该全不设"。

### 2. merge 模式"字段白名单"是脆弱的

我原版 10 个字段白名单思路是对的，但**漏字段**很难发现。换成"以本机为底 + bc 非空覆盖"是更稳的通用解法。

**核心洞察**：text_only 模式 stripBase64 的"副作用"是把所有 data:image 转成 `''`，所以**bc 里空字符串字段**=**bc 里图片字段**。**检查空字符串 = 检查是否是图片**，免维护字段白名单。

### 3. restoreAssetsInPlace 不处理 R2 URL

完整模式导出时 `processObject` 只抽 `data:image/...` 前缀的字符串到 `assets/`，**R2 URL（`https://r2.xxx/yyy.png`）不会被抽**，所以 character.avatar 在 zip 里**仍然是 R2 URL 字符串**。导入时 `restoreAssetsInPlace` 只把 `assets/` 开头的字符串转 base64，**R2 URL 不会动**。

phone A 上 avatar 是 R2 URL → 完整导出后 zip 里 avatar 是 R2 URL → 完整导入到 phone A 后 character.avatar 仍是 R2 URL → UI 加载 R2 URL ✓ → **R2 域名在 phone A 上能访问**。

跨设备时：phone A 上 avatar = R2 URL → 完整导入到 phone B → character.avatar = R2 URL → phone B 上 R2 域名访问不到（代理拦截 / 网络隔离）→ 损坏图标。

**这不是 merge 模式的问题**，是跨设备 + R2 URL 的固有问题。**修法不在本 changelog 范围**，未来考虑：完整导出时把 R2 URL 也下载下来打包成 base64。

## 备注

- 修复后保留之前的所有功能（text_only 模式去美化、合并策略、聊天记录 txt 导出等）
- 没有改 types.ts
- 回归测试路径见 commit message
- 这个 fix 是在 `366fd31` / `5a19348` / `0662343` 之后的连续修复 — 反映了我对 text_only 模式行为改造时**没充分意识到"同一个 mode 在不同入口"（ZIP / 云端）的语义**
- 跟之前 "memory_vectors 没压缩到 1-3MB" 的对话相关：用户实际 16.6MB（不是 1-3MB），待办里还有 A 方案没做（按 hideBeforeMessageId 过滤 messages + base64 压缩 vectors）
