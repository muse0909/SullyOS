# 日记数据层：DiaryEntry 加 source / mood，userPage 改 optional

## 背景

SullyOS 已有 JournalApp 的"交换日记"功能（用户写 + 角色回复），但缺"角色独白日记"——暮色 8-21 要加。

复用现有 `DiaryEntry` 类型和 `STORE_DIARIES` IndexedDB store，不新建表。用 `source: 'exchange' | 'char-only'` 区分两种日记。

## 改动文件

### 1. `types.ts:1363` — `DiaryEntry` 字段扩展

```ts
export interface DiaryEntry {
    id: string;
    charId: string;
    date: string;
    userPage?: DiaryPage;        // ← 改 optional
    charPage?: DiaryPage;
    timestamp: number;
    isArchived: boolean;
    source?: 'exchange' | 'char-only';   // ← 新增
    mood?: string;                        // ← 新增
}
```

**老数据兼容**：`source` 是 optional。读时按 `userPage` 兜底——有 userPage 就是 exchange，没就是 char-only。

### 2. `utils/db.ts:1119` — 加 `getCharOnlyDiariesByCharId`

```ts
getCharOnlyDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
    const all = await DB.getDiariesByCharId(charId);
    return all.filter(d => d.source === 'char-only');
},
```

复用 `charId` 索引查全量再 filter。数据量小（角色日均 0-1 篇），无需新建 source 索引。

## 不在本轮做的

- `utils/charDiary.ts`（核心逻辑）— 步骤 2
- `apps/JournalApp.tsx` UI 改造 — 步骤 3-4

## 验证

build 通过即可。功能验证在步骤 2 之后。
