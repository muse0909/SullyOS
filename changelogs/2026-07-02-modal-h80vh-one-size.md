# 弹窗卡片 h-[80vh] 写死一刀切 — 暮色吐槽"4 个尺寸"

**日期**：2026-07-02  
**涉及 commit**：`5a64bb7`

## 改了什么

### 弹窗卡片固定 80vh
暮色发 4 张图（13:57 旧 API 折叠 / 13:59 旧 API 展开 / 14:20 日程弹窗 / 14:20 我刚改的 API 折叠），
明确说"4 张图 4 个尺寸"——他要的是**所有弹窗绝对统一**。

**根因分析**：
- 上一轮（commit `9940479`）我把 API 弹窗 `max-h` 改成 60vh，**想跟 Modal/日程弹窗"统一"**——但 Modal 实际是
  标题 + 60vh 内容 + footer ≈ 80vh（无显式 max-h，flex 自然算），**改成 60vh 反而更矮**
- 加上默认开 main section + 圆角变大，**视觉上"宽矮"**（跟 360/24px 圆角/80vh 的旧版"窄高"对比）

**正确一刀切 spec**（写进 AGENTS.md §5.5）：
- 卡片：**`h-[80vh]`**（**固定 80vh**，不是 max-h）+ `max-w-sm` 384px + `rounded-[2.5rem]` 40px + `flex flex-col`
- 标题：`shrink-0` + `px-6 pt-6 pb-2` + `text-center text-lg font-bold`
- 内容：`flex-1 min-h-0 overflow-y-auto no-scrollbar`（**没有 max-h**，flex 自然撑到 80vh - 标题 - footer）
- footer：`shrink-0` + `px-6 pb-6 flex gap-3`

**为什么是 `h-[80vh]` 不是 `max-h-[80vh]`**：
- `max-h` + `flex-1`：内容少时卡片**自适应小**（不到 80vh），跟 80vh 卡片视觉不一致
- `h` 固定 80vh + `flex-1`：卡片**永远 80vh**，底部留白是"统一规格的一部分"
- `min-h-0`：flex item 常见 fix，避免内容超过容器时无法缩小

### 动了哪些文件
- `components/os/Modal.tsx` —— 卡片 `max-h-[80vh]` → `h-[80vh] flex flex-col`，标题/footer `shrink-0`，内容 `flex-1 min-h-0 overflow-y-auto`（去掉 `max-h-[60vh]`）
- `components/os/ApiQuickFloat.tsx` —— 卡片 `max-h-[60vh]` → `h-[80vh]`，body `flex-1 overflow-y-auto` → `flex-1 min-h-0 overflow-y-auto`
- `AGENTS.md` —— §5.5 改名为"写死 spec,以后别再改"，完整 spec 列出来 + 加"为什么是 h 不是 max-h"段

## 踩坑 / 需要知道的（重要）

### 上一轮（`9940479`）的反思
我之前**把 max-h 改成 60vh 反而是错的**：
- Modal 组件**没有显式 max-h**——内容 `max-h-[60vh] overflow-y-auto` + 标题/footer 固定，**卡片总高 = 标题 + 60vh + footer ≈ 80vh**
- API 弹窗把卡片总高 `max-h-[80vh]` 改成 `max-h-[60vh]` 是**矮了 20vh**
- 暮色"4 个尺寸"的根因就是这个——我**以为"统一"是改 60vh**，实际**Modal/日程就是 80vh 量级**

教训：
- 改"统一规格"前**先量实际渲染高度**，不要凭"感觉统一"
- `max-h` 和 `h` 是**两种语义**：max-h 是"不超过"（内容少时卡片小），h 是"固定"（永远这个高度）
- 暮色要"绝对统一" → 用 `h` 不用 `max-h`（接受"内容少时底部留白"换"永远 80vh"）

### "4 个尺寸"问题的两个根因
1. **宽度**：旧版 360px（`w-[min(88vw,360px)]`）vs Modal 384px（`max-w-sm`）—— commit `b31b0bb` 已经统一
2. **圆角**：旧版 24px（`rounded-3xl`）vs Modal 40px（`rounded-[2.5rem]`）—— commit `1cb0e20` 已经统一
3. **高度**：旧版 80vh vs Modal ~80vh vs 我改的 60vh —— **本 commit 统一到 h-[80vh]**

所以"4 个尺寸"是**三轮改动累积的混乱**，这次终于一刀切。

### 后续新弹窗
直接照 AGENTS.md §5.5 spec 写——卡片 `h-[80vh] flex flex-col`、标题/footer `shrink-0`、内容 `flex-1 min-h-0 overflow-y-auto`。
不要再各弹各的，**避免重蹈覆辙**。

### 心声弹窗没动
`ChatHeaderShell.tsx:406` 的心声弹窗还是 `w-[min(88vw,360px)]` + `rounded-[2rem]` + `max-h-[68vh]`——
暮色没明确说改心声弹窗（AGENTS.md §5.5 例外里写"微信式心声弹窗可以用 rounded-3xl + w-[min(88vw,360px)]"是他认可的）。
如果他以后要心声弹窗也统一，单独提出来再改，**不要顺手改**。

## 备注
- 这次"改对"的关键是**接受"内容少时底部留白"换"卡片绝对 80vh"**——之前我一直在"内容自适应"和"卡片固定"之间摇摆
- AGENTS.md §5.5 现在写得很死（"写死 spec，以后别再改"），下次新会话开工看到这个 spec 就知道照搬
- 报告：本篇（2026-07-02 弹窗规格写死）
- 跟 commit `8fc676b`（聊天页返回路径）、`9940479`（API 弹窗初始修复）合计 3 个 commit 解决暮色早上的两个问题
