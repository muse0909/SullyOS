# 2026-08-26 修小纸条详情 IDB 报错导致不显示字

## 暮色反馈

> "麦麦查一下小纸条这个，点进详情不显示字。得大退一下再打开才能显示出来"

## 根因

`XiaoZhiTiaoPage.tsx` 在 `onMarkRevealed` 回调里调了：

```ts
const all = await DB.getXiaoZhiTiaos(undefined);  // ❌ 传 undefined
setNotes(all.sort((a, b) => b.timestamp - a.timestamp));
```

`utils/db.ts:1281` 实现是：

```ts
const request = index.getAll(IDBKeyRange.only(charId));
```

`IDBKeyRange.only(undefined)` 直接抛 `DataError: Failed to execute 'only' on 'IDBKeyRange': The parameter is not a valid key`（**IDB 规范要求 key 必须有效**）。

## 时序

1. 点详情 → `XiaoZhiTiaoDetail` 挂载，useEffect 触发 `onMarkRevealed`
2. `DB.saveXiaoZhiTiao({ ...selectedNote, revealedAt: Date.now() })` — **写入成功**（put 不用 IDBKeyRange）
3. `DB.getXiaoZhiTiaos(undefined)` — **抛 DataError**
4. `setNotes` 没跑 → `notes` 状态里这条的 `revealedAt` 仍为 `null`
5. `selectedNote = notes.find(...)` 拿旧对象 → `isRevealed = false`（XiaoZhiTiaoDetail.tsx:197）
6. 详情页**不显示字**（XiaoZhiTiaoDetail.tsx:223 `isRevealed && (...)` 整段不渲染）
7. 大退重启时 `saveXiaoZhiTiao` 已落盘，重新加载 `revealedAt` 有效 → 正常显示

## 修法（最小改动）

`apps/XiaoZhiTiaoPage.tsx:100-108`：

```diff
 onMarkRevealed={async () => {
     if (selectedNote.revealedAt != null) return;
     await DB.saveXiaoZhiTiao({ ...selectedNote, revealedAt: Date.now() });
-    // 重新加载 notes 让列表卡片同步显示内容
-    const all = await DB.getXiaoZhiTiaos(undefined);
-    setNotes(all.sort((a, b) => b.timestamp - a.timestamp));
+    // 重新加载 notes 让列表卡片 + 详情 selectedNote 同步显示内容
+    // 暮色 8-26 反馈：之前调 getXiaoZhiTiaos(undefined) → IDBKeyRange.only(undefined) 抛 DataError
+    // 改用 hook 的 refresh()（内部用 targetCharId 查，不会报错）
+    await refresh();
 }}
```

## 顺便修

`components/notes/XiaoZhiTiaoDetail.tsx:21-27` `XiaoZhiTiaoDetailProps` interface **漏写** `onMarkRevealed`（8-23 漏的，TS 错一直在但运行时没炸因为 Vite 不严格检查 props）。补上：

```diff
 interface XiaoZhiTiaoDetailProps {
     note: XiaoZhiTiao;
     charName?: string;
     onBack: () => void;
     onDelete: () => void;
     onAddReply: (content: string) => Promise<void>;
+    // 暮色 2026-08-23 v3：打开即已读
+    onMarkRevealed?: () => void;
 }
```

## 关联

- 跨项目适用：**React 组件加 prop 必须 4 处同改**（interface / destructure / UI / 调用点）。8-23 那次栽了 1 个（interface 漏写），8-26 这次又踩到 TS 错。
- 跨项目适用：**minify / IDB 类项目，函数传参时先确认参数类型**。`getXiaoZhiTiaos` 形参是 `string`，传 `undefined` 编译期会拦下（`Argument of type 'undefined' is not assignable to parameter of type 'string'`），但那个 TS 错跟 IDB 运行时错是两回事——TS 看到 `string` 直接拒了 `undefined`，IDB 是真的传下去才炸。
