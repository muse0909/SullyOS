# 2026-09-06 备忘录 IDB 旧数据兼容（修"Cannot read properties of undefined (reading 'push')"）

## 暮色原话（9-6 12:24）
"TypeError: Cannot read properties of undefined (reading 'push')
at fP (https://sully-os-git-preview-muse0909s-projects.vercel.app/assets/index.DNqcubWw.js:1909:11575)
...
备忘录报错了。网页端，apk端正常"

**等等，APK 端没报错** — 这是关键诊断线索。

## 根因

5d71187 把 `CharacterMemoRegion` type 从 `'status' | 'event' | 'private'` 改成 `'event' | 'private'`（"结构独立分离"，状态面板拆出）。

但 **`CharacterMemoPage.tsx` 里的 byRegion 初始化只包含 'event' / 'private' 两个 key**：
```ts
const byRegion: Record<CharacterMemoRegion, CharacterMemoEntry[]> = {
    event: [],
    private: [],
};
for (const e of sorted) byRegion[e.region].push(e);
```

**用户 IDB 里有 5d71187 之前写入的旧 memo entries**（region = 'status' / 'event' / 'private'）。当遍历到 `region: 'status'` 的旧 entry 时，`byRegion['status']` 是 **undefined** → `.push()` 崩。

**为什么 APK 端不报错**：
- 网页端：每次 fetch 拿新代码（Vercel 部署）→ 跑 5d71187 之后的代码 → byRegion 没 'status' → **崩**
- APK 端：WebView 缓存 + 4f21ac9 hash 检测 bug → **还跑 5d71187 之前的老代码**（a5f7e653）→ byRegion 含 'status' → **不崩**

**等这轮的 meta build id 兜底 reload 一推，APK 端会刷到新代码 → 立刻也崩**。所以必须修。

## 改了什么

### 1. 防御性写 — `apps/CharacterMemoPage.tsx`

```ts
for (const e of sorted) {
    const bucket = byRegion[e.region];
    if (bucket) bucket.push(e);
    // else: 未知 region（5d71187 之前的 'status' 残留），跳过 — 不崩
}
```

即使 v72 升级前还有残留旧数据，UI 也不会崩。

### 2. IDB v71 → v72 升级清旧数据 — `utils/db.ts`

DB_VERSION 升到 72，onupgradeneeded 里（旧 store 创建之后、跟 v48 清理一起）加：

```ts
if (oldVersion > 0 && oldVersion < 72) {
    // 遍历 character_memos store，每个 memo 的 entries 数组
    // 过滤掉 region === 'status' 的 entry，写回 IDB
    // cursor 完成后 log 清理条数
}
```

触发时机：浏览器打开网页 → 发现 IDB 版本 < 72 → 走 onupgradeneeded → 自动清。

**对用户的影响**：第一次刷新页面时会自动清掉所有旧 'status' memo entries，UI 不变（因为这些 region 5d71187 之后本来就不显示了）。

## 验证
- `npx tsc --noEmit` — 0 新错（之前 oldVersion TDZ bug 已修）
- `npm run build` — ✓ 4.21s 通过
- 防御代码 + v72 清理双重保险

## 暮色下次测试预期

刷新页面（网页端）→ 自动触发 v71→v72 升级 → 后台清理 region='status' 旧 entries（控制台 log `🧹 [DB v72] 清理 N 条旧 region='status' memo entries`）→ 备忘录页正常显示，不崩。

APK 端 meta build id 兜底 reload 也会触发 → 刷到新代码 → 同样清理旧数据 → 正常显示。

## 顺带说明
9-5 那条 memory 写"旧数据躺在 localStorage 不迁移" — 我之前一直以为是 localStorage。**实际** 5d71187 之前的 memo 存在 **IndexedDB**（STORE_CHARACTER_MEMOS），不是 localStorage。所以"不迁移"是错的，**IDB 数据必须清**。这次升级 v72 一次性清掉。

## 没动什么
- 9-5 那条 memory 的"localStorage 不迁移"语义不动（statusPanel.ts 旧数据确实是 localStorage `user_status_panel`，已随 statusPanel.ts 删了）
- type.ts / 其他 store / 其他业务代码 都不动
- CharacterMemoPage 其他逻辑不动
