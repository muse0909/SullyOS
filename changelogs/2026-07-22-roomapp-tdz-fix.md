# RoomApp TDZ 崩溃修复 — 进小小窝「Cannot access 'S' before initialization」

**日期**：2026-07-22
**涉及 commit**：pending

## 问题
暮色点「小小窝」图标进 RoomApp 时 Vercel 部署白屏，console 报：

```
ReferenceError: Cannot access 'S' before initialization
    at lS (https://sully-os-git-preview-muse0909s-projects.vercel.app/assets/index-CXDgjRRJ.js:2213:1984)
```

## 根因（不是循环 import，是真 TDZ）
`apps/RoomApp.tsx` 函数体里：

```ts
// line 252（在 char 定义之前）
const { notes: notebookEntries, deleteNote: deleteNoteBase } = useRoomNotes(char?.id);
...
// line 293
const char = characters.find(c => c.id === activeCharacterId);
```

`useRoomNotes(char?.id)` 在 `const char` 之前**就执行了**——`char?.id` 表达式要读 `char`，但 `char` 处于 TDZ（const 还没声明），**整段立即抛 ReferenceError**。

### 为什么之前 preview 部署能进？
- Vite/esbuild minify 时**不重排 JS 执行顺序**（保持语义），所以这 bug 一直在产物里
- 之前 preview 部署的 hash `CXDgjRRJ` 跟当前 build hash 不同，**说明用户之前没真的进过 RoomApp**，或命中了不同 cache 路径
- 这次点进去才首次触发

### 为什么 Vite/esbuild build 不报？
- TDZ 是**运行时**错误，build 阶段只 transform + bundle 不执行
- Vite dev 启动也是按需 module init，curl 触发不到 React render path，所以也不报

## 修法
**不能动 hook 调用位置**——React 规则要求 hook 顺序每次 render 一致（useRoomNotes 跟周围 useState 必须按固定顺序调）。所以**只能把 `const char` 提前**：

```ts
// Extended State
const [todaysTodo, setTodaysTodo] = useState<RoomTodo | null>(null);
// 2026-07-22 fix：原代码在 char 定义之前调 useRoomNotes(char?.id) → TDZ
//   修法：把 const char 提到 useRoomNotes 之前（hook 顺序不能改）
const char = characters.find(c => c.id === activeCharacterId);
const { notes: notebookEntries, deleteNote: deleteNoteBase } = useRoomNotes(char?.id);
```

line 293 原来的 `const char = ...` 删除（已搬上来）。

## 验证
新 build (`index-Cu5Kaobs.js`) minified 顺序里：
- offset 319: `w = s.find(E => E.id === a)` ← const char
- offset 362: `{notes:k, deleteNote:v} = Zb(w?.id)` ← useRoomNotes

`useRoomNotes` **在 `const char` 之后调用** → TDZ 修复。

## 动了哪些文件
- `apps/RoomApp.tsx` — `const char` 从 line 293 移到 useRoomNotes 之前
- 不动其他任何文件

## 备注
- 暮色 2026-07-14 提过「进不了小小窝」但没复现；今天才稳定触发
- 之前 preview 部署能进大概率是用户**没真的进过 RoomApp**，或者命中过老 cache
- 这个 bug 自 c232ada 之前就在（4d8135a/548b5f0 时代就是这顺序），隐藏至今
