# Sully 专属分类长按支持删除

**日期**：2026-07-18
**涉及 commit**：`3bea505`（preview）/ `817f179`（master，cherry-pick）

## 改了什么

- 表情包分类长按弹出的"分类操作"里，"删除分类"按钮之前因为 `selectedCategory.isSystem === true` 被卡掉，导致默认的「Sully 专属」分类长按看不到删除选项
- 改判断条件：只过滤 `id === 'default'`（默认分类本来就是空的，没必要删），`Sully 专属` 和用户自建分类都允许删除

## 动了哪些文件

- `components/chat/ChatModals.tsx:557` — 删除分类按钮判断条件 `!isSystem && id !== 'default'` → `id !== 'default'`

## 行为说明

- 删 Sully 专属分类会触发 `DB.deleteEmojiCategory('cat_sully_exclusive')`，分类下所有 Sully 预置表情也会被一起删
- 下次进聊天时 `DB.initializeEmojiData()` 检查到 `SULLY_CATEGORY_ID` 不存在会**自动重建** Sully 专属分类 + 预置表情（`utils/db.ts:755-762`），所以误删也能恢复
- `default` 分类依然不能删（永远为空，删了没意义）

## 备注

- 暮色 2026-07-18 反馈"表情包里有个默认的 sully 专属长按没有删除分类显示，需要加一下"
- 因为 Sully 预置表情可能在用，删前 `delete-category` modal 已有"分类下的所有表情也将被删除！"的红字提示，足够醒目
