# 2026-08-23 小纸条 v3 数据层 + 8 套便签 CSS

## 改了什么

### types.ts:XiaoZhiTiao 加 5 字段
- `visibility?: 'visible' | 'hidden'` — 立即可见 / 藏起来
- `hiddenUntil?: number` — 定时投递解锁时间戳
- `isTimed?: boolean` — 定时 vs 等翻
- `revealedAt?: number` — 暮色查看时间戳
- `style?: string` — 8 套便签 CSS className

老数据兼容（缺省 = 默认值，不需迁移脚本）。

### utils/xiaoZhiTiaoDefaults.ts
- 新增 `BUILTIN_NOTE_GROUP_NAME = '系统便签'`
- `DEFAULT_XIAO_ZHI_TIAO_GROUP_NAME = '暮色手绘便签'` 保留为图组

### utils/xiaoZhiTiaoStyles.ts
- 新增 `BUILTIN_NOTE_STYLES`（8 套：note-lined / note-pink / note-grid / note-kraft / note-blue / note-polka / note-white / note-bread）
- 新增 `pickNoteStyle(styles)` 轮换函数
  - 激活组 = `'系统便签'` → 8 套 CSS 随机
  - 激活组 = 其他 → 走 `pickRandomXiaoZhiTiaoImage` 图组轮换
- 新增 `sanitizeNoteHtml(text)` — 只放行 `<s>` / `</s>` 标签，其他 `<>` 全 escape（XSS 安全 + 支持 AI 划线）
- 保留旧 `pickRandomXiaoZhiTiaoImage`（向后兼容）
- `getStoredXiaoZhiTiaoStyles` 默认激活组从 `'暮色手绘便签'` 改成 `'系统便签'`
  - 两个默认组都预置（'系统便签' 空数组 + '暮色手绘便签' 几张图）
  - 老 user 已有 localStorage：保留 activeGroup，不强制改

### components/notes/builtinNoteStyles.css（新文件）
8 套便签 CSS（直接照搬 cjjc 的 WHISPER_NOTE_STYLES）— 每套 background + transform rotate + ::before/::after 装饰。

### components/notes/XiaoZhiTiaoCard.tsx
- import builtinNoteStyles.css
- 便签样式优先级：
  1. `styleImageUrl` 存在 → 走图（用户上传图）
  2. `style` 存在 → 走 CSS（cjjc 8 套）
  3. 都没 → 纯白兜底
- 给便签 div 加 `noteClassName` className 切换

### components/notes/XiaoZhiTiaoDetail.tsx
- 同上（详情页 FullXiaoZhiTiaoCard 走同款优先级）

## 暮色原话"暂时先搬过去，但是这里有些我是不太喜欢的，等后面再细调"

8 套 CSS 是从 cjjc 直接照搬的，暮色说有些不喜欢（比如 transform rotate 各套都不同）。后续可以单独调样式（不改 token、不改逻辑）。

## 涉及文件

- `types.ts:497-516` XiaoZhiTiao 字段
- `utils/xiaoZhiTiaoDefaults.ts` BUILTIN_NOTE_GROUP_NAME
- `utils/xiaoZhiTiaoStyles.ts` BUILTIN_NOTE_STYLES + pickNoteStyle + sanitizeNoteHtml + 默认激活组切换
- `components/notes/builtinNoteStyles.css` 8 套 CSS（新文件）
- `components/notes/XiaoZhiTiaoCard.tsx` import + className 切换
- `components/notes/XiaoZhiTiaoDetail.tsx` import + className 切换

## 验证

- build 通过（3.88s）
- 老数据兼容（`visibility` 缺省 `'visible'`，`revealedAt` 缺省 undefined）
- 老 user 升级后：
  - 默认激活组从 `'暮色手绘便签'` → `'系统便签'`（**新体验**）
  - 老的 `'暮色手绘便签'` 图组还在，可手动切回
  - 新写纸条走 8 套 CSS 轮换
  - 老纸条没 `style` 字段，走图兜底（如果 `styleImageUrl` 有）或纯白（没有图）
- commit 2 加 token 解析后，AI 输出 `[[XIAO_ZHI_TIAO: ...]]` 会调 `pickNoteStyle` 拿 className 存到 note.style
