# 朋友圈 AI 主动发工具（仿 330 qzone.js）

**日期**：2026-07-12
**涉及 commit**：`59845ec`

## 改了什么
暮色 2026-07-12 反馈："朋友圈的底层还有些问题，我发的他能看到，但是他发不了。"

AI 自己的工具（不是系统自动），跟现有 `<emotion>` / `[[RECALL:...]]` / `[[DIARY:...]]` 同模式——**AI 在 chat reply 里输出 action 标记 → 解析器扫到 → 调用对应 API**。

**对比 330（muse-330-ui）：**
- 330 的 `qzone.js` 用 `[{"type": "qzone_post", "postType": "shuoshuo", "content": "..."}]` JSON 模式（ai-response.js:2944-2953）
- 330 的解析器在 `ai-response.js:4704+` 扫 action，case 'qzone_post' / 'qzone_comment' / 'qzone_like' 三个分支
- 搬过来：仿 330 模式，但用 SullyOS 现有的 `[[XXX: ...]]` 风格（跟 `<emotion>` `[[RECALL:...]]` 一致），不引入新格式

## 3 个新 action（AI 工具）

| Action | 格式 | 功能 |
|---|---|---|
| 发朋友圈 | `[[MOMENT_POST: 内容]]` | 调用 `publishPostAsChar`，限 maxPerDay（默认 2/天） |
| 评论朋友圈 | `[[MOMENT_COMMENT: postId \| 评论内容]]` | 调用 `commentPostAsChar` |
| 点赞朋友圈 | `[[MOMENT_LIKE: postId]]` | 调用 `likePostAsChar` |

## 动了哪些文件
- `utils/chatPrompts.ts` —— 新增 chapter `📱 朋友圈（你的社交生活圈）`，约 30 行 prompt 注入。含触发时机、心态提醒、格式示例。编号 `8+enabledCount` 动态算（跟 xhs 同模式）。
- `hooks/useChatAI.ts` —— 加 import 朋友圈 API；新增 `// 5.9c Handle Moments Actions` 段，~70 行。复用现有 `publishPostAsChar` / `commentPostAsChar` / `likePostAsChar`（之前只 fire-and-forget 调）。

## 踩坑 / 需要知道的（重要）

### 1. chatPrompts.ts template literal 嵌套
chatPrompts.ts 整个大字符串是一个外层 template literal，里面用 `${xxxEnabled ? \`...\` : ''}` 嵌套多个内部 ternary + template literal。
我第一次加的时候把反引号加错位置——`Expected ";" but found "$"` 报 line 675。
**修法**：照搬 xhs 段（line 591）的 `${xhsEnabled ? \`...\` : ''}` 模式，外层用 `${true ? \`...\` : ''}` 保持格式一致。

### 2. `getMomentsSettings` 是 alias，源名是 `getSettings`
- 实际 export 在 `utils/momentsStorage.ts:200 export function getSettings()`
- MomentsPage.tsx 用 `getSettings as getMomentsSettings` import alias
- 我第一次直接 import `getMomentsSettings` 报 "not exported"
- 修法：`import { getSettings as getMomentsSettings } from '../utils/momentsStorage'`

### 3. addToast 第三参数 duration（暮色之前就有的 latent issue）
- OSContext type 定义：`addToast: (message: string, type?: Toast['type']) => void`（只 2 参数）
- 实际实现：`const addToast = (message, type = 'info', duration = 3000) => {...}`（3 参数）
- 已有代码（Chat.tsx:463）就传 3 个参数（`addToast('xxx', 'info', 3000)`）
- 我用 `'success', 2500` 跟现有用法对齐——运行没问题，TS 也不报（Vite/esbuild 不做类型检查）
- 未来可优化：把 type 定义加 `duration?: number`

## 跟 330 的优势对比
**330 优势**：
- action 语法是 JSON 数组（`[{"type":"qzone_post",...}]`），结构化更强
- 一次可以发多个 action（`[]` 数组）
- 配图支持 NovelAI / Google Imagen 真实图片动态

**SullyOS 现在搬过来的实现**：
- action 语法用 `[[XXX: ...]]` 风格，跟现有 `<emotion>` `[[RECALL:...]]` `[[DIARY:...]]` 一致——**复用 AI 已学会的格式，prompt 注入阻力小**
- 单个 action 一次发一个，可以在一轮 reply 里多次（每个标记独立）
- 配图这次没做（AI 主动发的动态纯文字）—— 配图还是要走 imageGenProvider 流（参考 330 配 NAI/Imagen 的实现，下次搬）

## 备注
- **暮色之前的设计已经到位**：`publishPostAsChar` / `commentPostAsChar` / `likePostAsChar` 三个工具函数在 `utils/momentsAI.ts` 早就有了（暮色 2026-07-03 设计），只是没有 AI 主动调用的入口（只 fire-and-forget 自动调）。这次把入口接上就完事。
- **Setting 复用**：maxPerDay 上限用了现有的 `MomentSettings.maxPerDay`（用户设置页可调），不需要新 setting
- **测试方式**：等 Vercel 部署完后，暮色在 chat 里让 AI 发条朋友圈试——AI 应该在 reply 里输出 `[[MOMENT_POST: 内容]]` 单行标记，UI 上看到 "📱 江澈 发了一条新朋友圈" toast + 朋友圈主页看到新动态
- **跟现有自动发的关系**：Chat.tsx:442-469 的 useEffect 钩子（autoPostByChar=true 时 AI 完成一轮后自动发朋友圈）**保留**——这是"系统判断 AI 应该发"；新加的是"AI 自己在 reply 里决定发"，两者并行不冲突
- 待办未变
