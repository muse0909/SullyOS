# 2026-09-08 朋友圈背景恢复初始状态 — 根因修复

## 暮色 9-8 12:21 反馈
"朋友圈换的背景经常恢复初始状态,我不知道是没有加到云端备份里还是其他问题,查一下这个。"

## 根因(2 个,叠加效应)

### 根因 1:`DB.saveAsset` 没等 `transaction.oncomplete` 就 resolve

**位置**:`utils/db.ts:961-965` 原版

```ts
saveAsset: async (id: string, data: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_ASSETS, 'readwrite');
    transaction.objectStore(STORE_ASSETS).put({ id, data });  // ← put 发起后立刻返回
}
```

**症状链**:
1. 用户上传朋友圈背景图 → `handleUserBgUpload` (`apps/SocialApp.tsx:300-313`)
2. `setUserBgImage(base64)` 同步触发 React 重渲染
3. `await DB.saveAsset('spark_user_bg', base64)` 发起但**不等 put 完成**
4. React 重渲染 / 组件重 mount 时 IDB put 异步请求被中断
5. 刷新 / 重新进入朋友圈 → DB 没真写入 → 背景图恢复默认

**影响面**:`DB.saveAsset` 有 30 处调用(头像/外观预设/图标/字体/朋友圈背景/社交资料/room 资产/wallpaper 等),**全部中招**。

**修法**:saveAsset 加 `transaction.oncomplete / onerror / onabort` await,所有调用点统一受益。

### 根因 2:`socialAppData` 整个只在 `media_only` + `full` 模式带,`text_only` 模式朋友圈**所有数据**丢失

**位置**:`context/OSContext.tsx:3590-3595` 原版

```ts
socialAppData: (mode === 'media_only' || mode === 'full') ? {
    charHandles: ...,
    userProfile: ...,
    userId: ...,
    userBg: ...,
} : undefined,
```

云端备份 `text_only` 模式 → `socialAppData` 整个 undefined → 朋友圈配置全丢(charHandles / userId / userProfile / userBg)。

**问题**:`charHandles` / `userId` 是纯文字字段,text_only 模式也该带。`userProfile` / `userBg` 是图片,跟原设计走 media_only + full。

**修法**:
- `types.ts` 加 `socialAppTextData?: { charHandles, userId }` 字段
- export 端:拆出 socialAppTextData(text_only + full 都带),socialAppData 保留(media_only + full 带图片)
- import 端:分别恢复,新字段独立写 localStorage

## 改了什么

| 文件 | 改动 |
|---|---|
| `utils/db.ts` | `saveAsset` 等 transaction oncomplete(影响所有 30 处调用) |
| `types.ts` | `FullBackupData` 加 `socialAppTextData` 字段 |
| `context/OSContext.tsx` export 端 | 拆 socialAppTextData(text_only + full)与 socialAppData(media_only + full) |
| `context/OSContext.tsx` import 端 | 分别恢复 socialAppTextData + socialAppData |

## text_only 模式朋友圈行为(改后)

| 字段 | 改前 text_only | 改后 text_only |
|---|---|---|
| charHandles | ❌ 丢 | ✅ 恢复 |
| userId | ❌ 丢 | ✅ 恢复 |
| userProfile(头像) | ❌ 丢 | ❌ 仍丢(图片,需要 media_only + full) |
| userBg(背景图) | ❌ 丢 | ❌ 仍丢(图片,需要 media_only + full) |

**结论**:朋友圈文字配置(charHandles / userId)改后 text_only 模式可恢复;朋友圈图片(userBg 背景 / userProfile 头像)仍需 media_only 或 full 模式云端备份。

## 流程备注

- 9-8 12:08 暮色新流程: 所有改动先到 preview
- 9-8 12:21 暮色直接说"先合并主分支然后我去测试,现在都在手机上" → 特殊场景,直接 master
- 此 commit 在 master,phone 立刻能拿到
