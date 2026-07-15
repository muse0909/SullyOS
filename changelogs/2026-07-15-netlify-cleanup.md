# 删未使用的 Netlify fork 残留

**日期**：2026-07-15
**涉及 commit**：（待 git commit 后填）

## 改了什么

清理 SullyOS 仓库里 Netlify 相关的死代码 + 文档纠错。本地部署 / Vercel 部署**全程没影响**——这些代码本来就没在生产路径上跑过。

清理前核实结果（grep 全部命中）：

| 类别 | 命中 | 结论 |
|---|---|---|
| `netlify.toml` | 在 | 没人读、没 CI/CD 用 |
| `netlify/functions/*.ts`（12 个） | 在 | 前端 **0 引用**（唯一一处 `/.netlify/functions/...` 是 netlify 内部 function-to-function 调） |
| `netlify/functions/_shared/rei.ts` | 在 | 只给 functions 共享，functions 删了它也没意义 |
| `@netlify/blobs@^10.7.4` | package.json | 只 netlify/functions 内部 import |
| `@netlify/functions@^5.1.5` | package.json | 同上 |
| AGENTS.md / README.md 描述 | 在 | 文档撒谎（说后端 = Netlify，实际是 Vercel） |

## 动了哪些文件

### 删除（13 个）

- `netlify.toml`
- `netlify/functions/cancel-message.ts`
- `netlify/functions/get-user-key.ts`
- `netlify/functions/init-tenant.ts`
- `netlify/functions/messages.ts`
- `netlify/functions/schedule-message.ts`
- `netlify/functions/send-notifications-background.ts`
- `netlify/functions/send-notifications-scheduled.ts`
- `netlify/functions/send-notifications.ts`
- `netlify/functions/update-message.ts`
- `netlify/functions/voice-favorite-store.ts`
- `netlify/functions/webdav-proxy.ts`
- `netlify/functions/_shared/rei.ts`

（整个 `netlify/` 目录树都删了）

### 修改（3 个）

- `package.json` —— 去掉 `@netlify/blobs` + `@netlify/functions` 两个依赖
- `AGENTS.md` —— 5 处 Netlify 提及全部改写：
  - L26: "走 Netlify Blobs / Neon DB" → "走 Cloudflare R2 / Neon DB"
  - L45: "后端 | Netlify Functions..." → "后端 | Vercel Functions... + Cloudflare R2"
  - L79: "api/ # Netlify Functions" → "api/ # Vercel Functions"（**注释本来就是错的**，api/ 一直是 Vercel Functions）
  - L81: 删掉 `├── netlify/` 整行
  - L224: "云函数日志看 Netlify dashboard" → "云函数日志看 Vercel dashboard"
- `README.md` L78: "Netlify Functions + Blobs" → "Vercel Functions + Cloudflare R2"

### 故意不改的（历史记录）

- `AGENTS.md` L283/L288：changelog 索引行里"7-13 / 7-14 上 Netlify Blobs"的描述 —— 历史事实，保留
- `changelogs/2026-07-13-voice-favorites-cloud.md`：整篇描述"上 Netlify Blobs"——历史 commit 记录，保留（**实际 Netlify 从来没部署过 SullyOS，commit `b31110b` 写了 netlify functions 代码但根本没跑过**，但这属于当时决策记录，不回溯改）
- `changelogs/2026-07-14-image-b64-blob-upload.md`：描述"前几个是 Netlify / imgbb 中间版，最终定 R2"——历史决策过程记录，保留
- `changelogs/2026-07-13-image-save-proxy.md` L30：提到 `netlify/functions/webdav-proxy.ts` —— 顺手改一下说"曾经有这个文件作为对比"
  - ❌ 决定不改，避免历史报告被回溯修改
- `changelogs/2026-07-02-orangechat-tool-calling-comparison.md` L266：调研对比，保留
- `changelogs/2026-07-03-voice-favorite-and-jump-fix.md` L41：未来工作建议，保留
- `notes/muse-330-ui-report.md` L18/L20：muse-330 vs SullyOS 部署对比 —— 历史调研报告，保留
- `notes/music-app.md` L68：讨论 Netlify 付费模式本身（不是 SullyOS 用 Netlify），保留
- `README.md` L147：FAQ 提"Vercel、Netlify、GitHub Pages"是泛指静态托管选项，保留

## 踩坑 / 需要知道的

1. **历史 changelog 跟实际部署不符**：7-13 / 7-14 那两份 changelog 措辞让人以为 SullyOS 当时"真的在用 Netlify Blobs"，**实际从来没有**。原因：fork 自 NMJ 的上游带了 netlify.toml + 一些 netlify functions 文件，暮色在 fork 基础上又加了一些新 function（commit `b31110b` 等），但暮色的 Netlify dashboard 里**没有 SullyOS 站点**（从未部署过），所以这些代码一直就是死代码。

2. **不要假设 `netlify.toml` 存在 = 项目跑在 Netlify**：可能是 fork 残留。检查部署平台要看 Vercel / Netlify / Cloudflare Pages dashboard 里**有没有这个项目**。

3. **删死代码不影响 Vercel 部署**：Vercel 部署走 `api/` 目录（Vercel Functions），跟 netlify 目录完全独立。本次清理 build 验证 3 次全过（删文件后 / 改 package.json 后 / 改文档后）。

4. **`backdrop-filter` 吃 `position: fixed` 那个 lesson 还在 memory 里**（参考 `components/chat/ChatHeaderShell.tsx` 心声弹窗 fe8eafa 的 fix 路径），跟本次清理无关，提一下免得忘。

## 备注

- **未完成 / 下次再说**：
  - 主动消息 2.0（Cloudflare Worker 推送）暮色反馈"在 Vercel 部署上完全不可用"——**这跟本次清理无关**。2.0 走 Cloudflare Worker（`noir2.cc.cd`），跟 Vercel 部署是两个独立部署，问题在 Worker 本身（挂了 / DNS / Web Push 授权过期 / URL 配错）
  - voice-favorite-store.ts 当时用了 `Access-Control-Allow-Origin: *` 加 redirect 模式，但**前端代码里没有 `/api/v1/voice-favorite-store` 的 fetch**（已 grep 确认），所以这个 function 当时写完就**从来没被前端调过**——但 commit `b31110b` 描述里没写"未联调"这个状态，算是个文档遗漏。新报告里说明了

- **后续 AI 接手建议**：看到 `api/` 目录 → Vercel Functions；看到 `worker/` 目录 → Cloudflare Worker（不是 Netlify Worker）；看到 `changelogs/` 里有"Netlify"提及 → 历史记录，不是当前状态
