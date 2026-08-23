# 2026-08-23 小纸条设置：上传+保存双按钮，去掉底部保存

## 改了什么

### components/notes/NotebookBackground.tsx
- BgStylePicker 加 `onSave?: () => void` prop
- "上传自己的图" 改 "上传背景图"
- 加"保存"按钮（绿色 `bg-emerald-500 to-teal-600`），跟"上传"并排

### apps/XiaoZhiTiaoPage.tsx
- SettingsDrawer 拿 `addToast`（useOS）
- 加 `handleSaveBg` 回调：调 onBgChange（重写一次持久化）+ 弹 toast "背景已保存"
- BgStylePicker 调用点传 `onSave={handleSaveBg}`
- "小纸条样式"section：原单个"上传图片到当前组"按钮 → 拆成两个按钮"上传图片" + "保存"并排
  - 保存按钮：调 `persistStyles({...styles, activeGroup})` + 弹 toast "样式已保存"
- "AI 写小纸条的指导"section：
  - **删掉底部"保存"按钮**
  - textarea 加 `onBlur={handleSave}` → 失焦自动存
  - 提示文案改"改完失焦自动保存，不需要点保存"
  - handleSave 改用 addToast（之前是 setStatusMsg 嵌在按钮文字里）
  - 改完 addToast 比嵌入文字更醒目

## 为什么

暮色 8-23 反馈"之前换背景了老是保存不下来"——希望显式"保存"按钮，让他知道"我保存了"。
"AI 写小纸条的指导"section 的"保存"按钮重复且多余（失焦自动存更自然）。

## 行为

| 之前 | 现在 |
|---|---|
| 背景：onChange 立即持久化 | 背景：onChange 立即持久化 + "保存"按钮显式再触发一次 + toast |
| 小纸条样式：上传/激活组/新建立即持久化 | 小纸条样式：照旧 + "保存"按钮显式再触发 + toast |
| AI 指导：点"保存"按钮 | AI 指导：失焦自动保存 + 弹 toast |

"保存"按钮是双保险 + 显式反馈，不改 onChange 行为（降低回归风险）。

## 涉及文件

- `components/notes/NotebookBackground.tsx:96-191` BgStylePicker UI
- `apps/XiaoZhiTiaoPage.tsx:241-260, 421-428, 491-523, 539-563` SettingsDrawer 各 section

## 验证

- build 通过
- 改背景风格 / 上传图：点"保存"按钮 → toast "背景已保存"
- 选激活组：点"保存"按钮 → toast "样式已保存"
- 改 AI 指导文本框：失焦 → toast "AI 指导已保存"（不再需要点"保存"按钮）
- 删掉的"保存"按钮不再显示

## 后续（可选）

如果暮色测试时还是觉得"保存不下来"，那是 storage 本身有静默错误（如 QuotaExceeded）。可以加 read-back 校验 + 失败时弹 error toast。这次没动 storage 工具，等暮色反馈再修。
