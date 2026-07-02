# API 弹窗尺寸统一 + 聊天页返回路径修复

**日期**：2026-07-02  
**涉及 commit**：`8fc676b` `9940479`

## 改了什么

### 1. 聊天页返回路径（commit `8fc676b`）
- **widget 直跳**进入聊天 → 按一次返回 → **直接回桌面**（不再路过联系人列表）
- **联系人列表**点角色进入聊天 → 返回回联系人列表（保留原行为，符合微信式结构）

技术上给 OSContext 加了 `directEntryRef` + `consumeDirectEntry()`，WeChat mount 时一起消费，
back handler 优先判断 `cameFromDirectEntry` state：true → return false 让 OSContext 走 closeApp，
false → 走原来的 setOpenedCharId(null) 路径。

### 2. API 弹窗尺寸统一（commit `9940479`）
暮色反馈三个弹窗（日程 / API 折叠 / API 展开）尺寸不统一，看着像"又弹了个新窗"。
- 卡片 `max-h` 80vh → **60vh**，跟 `Modal` / 日程弹窗统一
- `openSection` 默认值 `null` → **`'main'`**（默认打开 API 设置 section），减少"折叠→展开"的视觉跳变
- 球点击时不再 `setOpenSection(null)`，**保留用户上次选择**（关掉再开还是同一个 section 展开）
- AGENTS.md §5.5 加"核心原则"段，强调：
  - 所有弹窗尺寸统一到 max-w-sm + 圆角 40px + max-h 60vh
  - **折叠/展开一律在卡片内部完成**——不创建新弹窗
  - 内容多的弹窗默认打开第一个 section，避免"折叠→展开"跳变

## 动了哪些文件
- `context/OSContext.tsx` —— interface 加 `consumeDirectEntry` + 新增 `directEntryRef` + `consumeDirectEntry()` 实现 + value 导出
- `apps/WeChat.tsx` —— 解构加 `consumeDirectEntry` + 新增 `cameFromDirectEntry` state + mount 时一起消费 + back handler 优先判断
- `components/os/ApiQuickFloat.tsx` —— `openSection` 默认值改 `'main'` + 卡片 `max-h-[80vh]` → `max-h-[60vh]` + 球点击删 `setOpenSection(null)` 保留状态
- `AGENTS.md` —— §5.5 加"核心原则"段，注释清楚折叠行为 / 高度个别允许 / 默认打开第一个

## 踩坑 / 需要知道的（重要）
- **AGENTS.md §5.5 上一版"项目级 Modal 标准"是写对的吗？**——是的，标准本身没错（max-w-sm + 圆角 40px + 阴影 2xl + 白描边）。
  错的是 **API 弹窗的实际 max-h（80vh）跟标准（60vh）不一致**——上一轮 commit 1cb0e20 改 API 弹窗时只盯着宽度对齐，**漏了高度**。
  暮色"三个弹窗尺寸不一样"就是指这个高度差异（加上初始折叠造成的视觉跳变放大）。

- **暮色"弹新窗"的真实痛点**：不是 API 弹窗真的开了第二个弹窗（实际上一直是就地展开），
  而是"折叠状态卡片小 → 点开 section 卡片撑满"这个**视觉跳变**让他觉得"又弹了个"。
  修复核心是：默认打开第一个 section + 高度统一 60vh + 卡片内部滚动。
  球点击保留 `openSection` 状态也重要：之前 `setOpenSection(null)` 会强制全部折叠，
  现在关掉再开还是上次看的那个 section，UX 更连贯。

- **API 弹窗的"三档 section"是合理的**——`API 设置` / `生图` / `识图` 三个独立通道配置。
  折叠展开是必要功能（不让弹窗初始堆 600px 内容），但**默认全折叠是糟糕的初始体验**——改成默认打开 main 后视觉上"打开就是主要内容"，跳变消失。

- **AGENTS.md §5.5 的"核心原则"段是这次的关键沉淀**——以后新弹窗写之前先读这条，
  不会再出现"漏改 max-h" / "默认全折叠 → 点开跳变"这种问题。

## 备注
- API 弹窗 max-h 60vh 跟 Modal 一致，但三个 section 全展开后内容**可能超过 60vh**——靠 `flex-1 overflow-y-auto` 内部滚动。
  这跟日程弹窗行为一致，暮色接受这种视觉。
- 通知中心（OSContext line 1064/1134/1190）的 `setActiveApp(AppID.Chat)` 没改——点通知仍走 WeChat 联系人列表。
  暮色没提这个行为，保留原状。如果以后想"点通知也直跳聊天"，可以复用 `jumpToChat` + 通知 ID 携带 charId，逻辑跟 widget 一样。
- 报告：changelogs/2026-07-02-wechat-once-back-and-api-centered.md（昨天的）+ 本篇（共 2 份）
