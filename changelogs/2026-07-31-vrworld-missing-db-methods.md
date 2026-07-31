# 彼方（VRWorldApp）修复：补 9 个缺失的 DB 方法 + reloadAll try/finally 兜底

**日期**：2026-07-31
**涉及 commit**：`276e533`

## 改了什么

暮色反馈"彼方 app 一进就卡'载入彼方…'，API 配置和接入都提示载入彼方"。

### 根因（双重）

**1. `utils/db.ts` 缺 9 个方法**（schema 创了但方法没写）

| Store | 缺失方法 | 调用方 |
|---|---|---|
| `vr_novels` | `getVRNovels()` / `deleteVRNovel()` | `VRWorldApp.tsx:152`, `:366` |
| `messages` | `getVRCardsByCharId(charId)` | `VRWorldApp.tsx:164` |
| `vr_settings` | `getVRApiConfig()` / `saveVRApiConfig()` | `utils/vrWorld/vrApi.ts` |
| `api_call_log` | `getVRApiLog()` / `setVRApiLog()` / `appendVRApiLog()` / `clearVRApiLog()` | `utils/vrWorld/vrApi.ts` |

调它们直接 `TypeError: DB.xxx is not a function`。

**2. `reloadAll` 没 try/finally 兜底**（`VRWorldApp.tsx:184`）

```ts
// 改前
const reloadAll = async () => {
    setLoading(true);
    await Promise.all([loadNovels(), loadFeed()]);
    setLoading(false);
};
```

`loadNovels` / `loadFeed` 调 `DB.getVRNovels()` / `DB.getVRCardsByCharId()` 抛错 → `Promise.all` reject → 异常向上冒泡 → **`setLoading(false)` 永远不被执行** → 永远卡"载入彼方…"。

### 这次的修法

**A. db.ts 加 9 个方法**（pattern 照搬现有 `getMessagesByCharId` / `saveWorldbook` 等）

关键设计点：
- `vr_api_config` 用**固定 id `'vr_api_config'`** 存整条 `APIConfig`（keyPath 是 'id'，得包 id）
- `api_call_log` 每条 `VRApiCall` 没 id，append 时随机生成 `id: vrapi-${ts}-${rand}`
- `getVRCardsByCharId` 用 charId 索引拿全消息后内存 filter `type='vr_card'`（不用 charId_type 复合索引——getAll(keyRange) 配合复合索引范围查询比内存 filter 复杂，先简单可工作）
- 所有方法都做 **`if (!db.objectStoreNames.contains(...))` 防御**——老用户 DB 还没升 v62 schema 时不会崩

**B. `reloadAll` 加 try/finally**

```ts
try {
    await Promise.all([loadNovels(), loadFeed()]);
} catch (err) {
    console.error('[VRWorldApp] reloadAll failed:', err);
} finally {
    setLoading(false);
}
```

**即使将来又有别的 store 缺方法，loading 也不会卡死**——只是数据可能空白，UI 不会冻在"载入彼方…"。

## 动了哪些文件

- `utils/db.ts` — `getRawStoreData` 后面插入 9 个 VR 相关方法（line ~1677）
- `apps/VRWorldApp.tsx` — `reloadAll` 加 try/catch/finally

## 踩坑 / 需要知道的（重要）

- **schema 和 method 是两件事**：v62 migration 加 store 容易（schema），加 method 容易忘。这次 9 个全忘，是个典型 case
- **`vr_settings` 用 keyPath 'id'**：存 `APIConfig` 必须包 id，所以固定 `id: 'vr_api_config'` 单条记录——v3 改多 key 时再调整
- **`api_call_log` 用 keyPath 'id'**：VRApiCall 没 id，每次写入生成随机 id。**幂等性差**——同一条调用不能重试（会变两条）。但 runSession 一次性写，不重试，OK
- **API 配置页的"载入彼方"**：暮色说的"API 配置一直提示载入彼方"其实是 `getVRApi()` 抛错 → `vrApi` 永远 null → UI 显示"未配置"——本质跟 loading 卡住是同一个 bug。**这次一起修好**
- **没动 `VRApiSettings` 的 useEffect**：它已经做了 `.then(setVr)`，方法不抛错就能正常赋值，不用改 UI 层
- **没改 vrApi.ts**：它是 wrapper 层，签名 `as APIConfig | null` 保持不变，DB 内部自己拆包

## 备注

- 老彼方数据：如果用户之前在 localStorage 存过 `vr_world_api`（v1 的旧 key），`migrateOnce()` 会自动迁到 vr_settings（vrApi.ts:25-37 已实现）
- 如果 `vr_world_api_log`（旧 key）有数据，migrateOnce 调 `DB.setVRApiLog`——之前也抛错，现在能跑了
- 这次没加"VR Methods 单元测试"——SullyOS 一直没单元测试流程，等暮色要再上
- 暮色问的"检查一下彼方 app"是连续任务的一部分：上次 7/27 修了主动消息 prompt，这次 7/31 修彼方 app——两天连着两个 app 出问题
