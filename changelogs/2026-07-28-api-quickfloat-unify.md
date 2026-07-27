# API 浮窗 4 张配置卡片统一

**日期**：2026-07-28  
**涉及 commit**：`cf01082`

## 改了什么
- 悬浮球 API 浮窗里的主 API / 生图 / 副 API / 识图，都统一成同一套结构：协议切换 → 从预设导入 + 保存为预设 → URL / Key / Model。
- 底部删掉横向挤在一起的 3 个“保存为预设”按钮，只保留一个“保存并关闭”。
- 预设加载时会同步切到预设自己的 OpenAI / Claude / Gemini tab，并立刻把当前输入框换成对应 URL / Key / Model。

## 动了哪些文件
- `components/os/ApiQuickFloat.tsx` —— 统一 4 张卡片 UI、预设保存/加载、协议切换和底部按钮。
- `types.ts` —— 给生图配置补上 3 tab 对应字段，避免预设字段没有类型位置。

## 踩坑 / 需要知道的（重要）
- 生图卡片这次按界面要求补了 OpenAI / Claude / Gemini 三个 tab，但底层生图调用仍保持当前的 OpenAI 兼容路径，没有改生成图片的真实调用链。
- 之前加载 Claude/Gemini 预设时，部分字段只进了后台缓存，当前输入框可能还停在旧值；这次一起修掉。
- `scripts/inspect-idb.html` 是已有未跟踪文件，这次没碰。

## 备注
- 已跑 `npm run build`，构建通过；只剩 Vite 原有的大包提醒。
