# 2026-08-23 小纸条 v3 老数据兼容：老便签默认已看 + 忽略旧图

## 暮色 8-23 15:43 反馈

1. **"标签里的内容全不显示了，点进去也看不到了"**
   - 现象：所有便签文字都空白
   - 根因：commit 4 引入 `revealedAt == null` 当"未看"。**老数据没 `revealedAt` 字段** → 全部 `undefined` → 全部"未看" → 全部不显示文字
   - 老数据本意是"已看"（暮色之前看过这些便签）→ 升级后应该保持"已看"

2. **"老纸条用新便签 CSS（现在原来的老数据还是以前的样式）"**
   - 现象：右上 4 张心形便签还是暮色 7-22 上传的心形图
   - 根因：`styleImageUrl` 字段是 user 上传图（base64 dataURL）。`useImage = !!note.styleImageUrl` 永远 true → 走老图
   - 暮色要：老便签也用 8 套便签 CSS，**忽略老图**

## 修法

**不迁移数据**（DB 字段保留），改**渲染时**用 `isOldXiaoZhiTiao(note)` 判定（看 timestamp）：
- 老便签（timestamp < 2026-08-23 15:00 +08:00）→ 视作"已看" + 忽略 `styleImageUrl`
- 新便签（timestamp >= v3 commit 时间）→ 正常走 revealedAt + styleImageUrl 逻辑

### utils/xiaoZhiTiaoStyles.ts
- 加常量 `XIAO_ZHI_TIAO_V3_RELEASE_TS = 2026-08-23T15:00:00+08:00`
- 加 `isOldXiaoZhiTiao(note)` 工具函数

### components/notes/XiaoZhiTiaoCard.tsx
- `useImage = !!note.styleImageUrl && !isOld`
- `isRevealed = note.revealedAt != null || isOld`
- 老便签：走 CSS 默认 `note-pink`（note.style 缺省 fallback）+ 文字可见
- 新便签：图优先 + 走 revealedAt 判定

### components/notes/XiaoZhiTiaoDetail.tsx
- FullXiaoZhiTiaoCard 同款修复

## 涉及文件

- `utils/xiaoZhiTiaoStyles.ts` 常量 + 函数
- `components/notes/XiaoZhiTiaoCard.tsx` 渲染逻辑
- `components/notes/XiaoZhiTiaoDetail.tsx` FullXiaoZhiTiaoCard 渲染逻辑

## 验证

- build 通过（3.90s）
- 老便签（7-22 写的）：显示心形便签图 → 现在走默认 note-pink + 显示文字 ✓
- 老便签空文字消失：revealedAt == null + isOld = true → 走"已看"路径 → 显示文字 ✓
- 新便签（v3 之后）：继续走 revealedAt 流程（没打开时空白，打开后显示）

## 为什么不数据迁移

- DB 字段保留 → 暮色以后后悔能手动恢复
- 不破坏数据（删 `styleImageUrl` 字段会永久丢失心形便签图）
- 渲染时处理更灵活（一个常量控制 cutoff）
- 缺点：每次渲染算 timestamp 比较（微乎其微）
