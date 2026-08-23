# 2026-08-23 小纸条 v3 cjjc 风格：随机性 + 字号 + 手写体

## 暮色 8-23 15:55 反馈

1. **"全是一个方向，全是一个样式。需要随机性"**
   - 现象：老便签渲染都 fallback `note-pink`（默认粉便签），看起来都一样
2. **"便签可以小一点，留白大一点。现在看着太挤了"**
3. **"详情页也是太大了，已经挤出边框了"**
4. **"这个设置你查一下cjjc里怎么设置的，按照那个来。我挺喜欢它那个的"**
5. **"字体，小纸条我想设置成手写体，你能找到手写体资源吗？"**

## 改了什么

### 随机性（反馈 1）
- `utils/xiaoZhiTiaoStyles.ts` 加 `pickFallbackBuiltinStyle(seed)` — 按 note.id hash 从 8 套便签里选一套
- 老便签（没 `style` 字段）渲染时按 id 选 → 不同便签看起不同
- 之前是固定 `note-pink`（看起来一样）

### 字号 + 留白（反馈 2/3/4）
参考 cjjc .note-paper：
- **font-family**：`'Ma Shan Zheng', cursive`（Google Fonts 中文手写体 — index.html 早就在列表里）
- **font-size**：列表 10px → 14px，详情 12px → 16px
- **padding**：列表 p-5 不变，详情 p-6 → p-8
- **min-h**：详情 70vh → 60vh（不撑满屏幕）
- **line-clamp**：详情 line-clamp-6 → 无限制（字撑满便签中央）
- **box-shadow**：便签 2px 3px 10px rgba(0,0,0,0.15)
- **列表 grid gap**：4 → 5；容器 padding-x 4 → 5

### 字体（反馈 5）
- Google Fonts `Ma Shan Zheng` 已经在 index.html 引入（行 27）
- builtinNoteStyles.css 加全局字体规则：
  ```css
  .note-lined, .note-pink, .note-grid, ... {
    font-family: 'Ma Shan Zheng', 'ZCOOL KuaiLe', cursive, sans-serif;
    box-shadow: 2px 3px 10px rgba(0, 0, 0, 0.15);
  }
  ```
- ZCOOL KuaiLe 是中文可爱风兜底（Ma Shan Zheng 加载失败时）

## 涉及文件

- `utils/xiaoZhiTiaoStyles.ts` `pickFallbackBuiltinStyle` 函数
- `components/notes/builtinNoteStyles.css` 全局字体 / 阴影
- `components/notes/XiaoZhiTiaoCard.tsx` 字号 10px → 14px + h-48 → h-44
- `components/notes/XiaoZhiTiaoDetail.tsx` 字号 12px → 16px + min-h 70vh → 60vh + line-clamp 取消 + padding 6 → 8
- `apps/XiaoZhiTiaoPage.tsx` 列表容器 padding + grid gap

## 验证

- build 通过（4.22s）
- 老便签：每张按 id hash 选 8 套之一（看起不同）
- 新便签：写时 `pickNoteStyle` Math.random 选（真正随机）
- 字体：手写体 Ma Shan Zheng（如 Google Fonts 加载失败，cursive / sans-serif 兜底）
- 字号：列表 14px（便签比例适中），详情 16px（不溢出便签）
- 阴影：便签周围 2px 3px 10px

## 字体资源（暮色问了）

**Ma Shan Zheng**（中文手写体，Google Fonts）
- 备选：**ZCOOL KuaiLe**（中文可爱，cursive 兜底）
- 备选：**Long Cang**（中文手写）
- 备选：**Caveat**（英文手写）
- 备选：**ZCOOL XiaoWei**（中文小清新）

**全部已经在 index.html Google Fonts 链接里**（行 27），本次直接复用，不需要加新 link。
