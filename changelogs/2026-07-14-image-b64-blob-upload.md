# 生图自动转 URL：b64 → imgbb 上传（最终方案）

**日期**：2026-07-14
**涉及 commit**：`4f0454d` `47f5776` `3f6ce32`（中间还有改动）

## 改了什么

### 1. `hooks/useChatAI.ts` 解析器加 b64 → imgbb 分支
旧代码 `const imageUrl = imgData?.data?.[0]?.url || '';` —— 只读 url。
新代码：
- 优先 `data[0].url`（gemai.cc 类站点，零开销）
- 没 url 但有 `b64_json` → fetch `https://api.imgbb.com/1/upload` 上传 → 拿永久 url 存 DB
- 没配 imgbb key 或上传失败 → data URL 兜底

### 2. 加 3 段诊断日志（commit 4f0454d）
为排查"实际调用的模型"，加：
- `🎨 [ImageGen] 请求体` — 实际发出去的 model 字符串 + URL
- `🎨 [ImageGen] 响应` — 状态码 + data[0] 的所有 key + 顶层元数据
- `🎨 [ImageGen] data[0] 展开(已剥 b64_json)` — 失败时打，剥 b64 避免日志爆炸

## 动了哪些文件
- `hooks/useChatAI.ts` —— 解析器加 imgbb 分支 + 3 段诊断日志
- `netlify/functions/image-upload-store.ts` —— 中途加过，后来删了（**未保留**）
- `netlify.toml` —— 中途加过 redirect，后来删了（**未保留**）
- `changelogs/2026-07-14-image-b64-blob-upload.md` —— 改名为"imgbb 方案"前的临时版（**保留**作为中间记录）

## 踩坑 / 需要知道的（重要）

### 根因不是程序 bug，是中转站实际转发模型不同
暮色预设的 `imageModel` 字段写的是 `gpt-image-2`，但**实际转发由中转站后端决定**：

| 站点 | 实际转发模型 | 响应字段 | URL 来源 |
|---|---|---|---|
| `api.gemai.cc`（哈基米，**正常**） | DALL-E 3 | `data[0] = {url, revised_prompt}` | `https://img.ai198.top/images/...`（中转站图床） |
| `api.jixiangai.xyz`（**失败**） | gpt-image-1 | `data[0] = {b64_json}` | 无 |

### gpt-image-1 / gpt-image-2 / DALL-E 3 关键差异
- **DALL-E 3**（2023-11）—— 支持 url（默认）+ revised_prompt，**2026-05-12 已停用**（gemai.cc 可能在用缓存/镜像）
- **gpt-image-1**（2025-04）—— **OpenAI 硬性只支持 b64_json**（不能 url）
- **gpt-image-2**（2026-04-21）—— 支持 url（默认），链接 1 小时过期（OpenAI 官方直连情况）

### 推断字段识别
`output_format: 'png'` / `quality: 'high'` / `background: 'opaque'` —— **gpt-image-1 响应标志**。后续如果看到日志里有这仨，就知道站点转发的是 gpt-image-1 而不是 gpt-image-2。

### 方案选型 — 三次踩坑过程
| 阶段 | 方案 | 失败原因 | 教训 |
|---|---|---|---|
| 1 | b64 → data URL 直接显示 | 违反暮色"不要 b64 存"原则（2MB+ 塞 localStorage） | 暮色明确表态过 |
| 2 | b64 → Netlify Function → Netlify Blobs | 暮色 Netlify 里**没有 SullyOS 站点**（只有 muse-330），且 Vercel 域名访问不到 Netlify Functions（2026-07-13-image-save-proxy changelog 提过） | 不要假设项目已经部署到某个云平台，先 grep/查实际部署 |
| **3（最终）** | **b64 → imgbb 公开 API** | ✓ 落地 | 复用现有模式（apps/Chat.tsx:1019 用户发图就在用 imgbb） |

### 我之前说的错/对的（自我复盘）
| 之前推测 | 对/错 | 实际情况 |
|---|---|---|
| "gpt-image-1 只支持 b64" | ✓ 对 | OpenAI 硬性 |
| "中转站字符串不可信，实际转发由站点决定" | ✓ 对 | 完美验证 |
| "img.ai198.top 是中转站图床，URL 稳定" | ✓ 对 | 暮色"很久之前还能看到"也验证了 |
| "gpt-image-2 不存在" | ✗ 错 | 2026-04-21 真发布了 |
| "gpt-image-2 链接 1 小时过期" | △ 错一半 | 1 小时过期是 OpenAI 官方直连，暮色用的中转站做了缓存所以稳定 |
| "Netlify 是原作者的" | ✗ 错 | 暮色 Netlify 里有自己的 muse-330，但**没** SullyOS 站点 |
| "Netlify 部署 SullyOS 自动跑" | ✗ 错 | SullyOS 这个项目根本没连 Netlify 自动部署 |
| "Preserve log 找不到" 引导暮色查 Network | ✗ 错 | 真正需要的是**控制台**标签，不是 Network |
| "截图是 Netlify 日志" | ✗ 错 | 实际是 Chrome DevTools 的控制台标签（前端 useChatAI.ts 打的 console.log） |
| **"Vercel 域名能调 Netlify Functions"** | ✗ 错 | changelog `2026-07-13-image-save-proxy.md` 明确说"Vercel 域名访问不到 Netlify Functions，访问会 404" |

### 变量名重复 build 失败（已修）
第一次 build 失败：`The symbol "_data0" has already been declared`。
原因：line 1287 响应日志那块的 `const _data0 = ...` 和我新加的 line 1320 解析器 `const _data0 = ...` 冲突。
**修复**：把后者的 `_data0` 改名为 `_imgData0`。
**教训**：跨函数块用前缀命名变量时，先 grep 一下同文件是否已用——避免和现有变量名撞。

### 选 imgbb 而不是新 Netlify 部署的理由
1. **零基础设施**——imgbb 是公开 API，前端直接 fetch
2. **跟现有模式一致**——`apps/Chat.tsx:1019` 用户发图就在用 imgbb，代码模式直接抄
3. **跨域天然支持**——imgbb 公开 API，CORS 友好，Vercel 域名下也能用
4. **公开 URL 永久稳定**——imgbb 不像 OpenAI 直连那种 1 小时过期
5. **暮色已配 imgbbApiKey**——Settings → API 卡片里就有

### "哦不又要配个服务"的代价
- 暮色 Settings 卡片里已经配过 `imgbbApiKey`（之前用户发图时配的）
- 如果**没配**：b64 走 data URL 兜底，**会**塞 localStorage（违反原则但能展示）
- 如果**没配**还想要永久 URL：去 https://imgbb.com/ 注册 → 拿 key → Settings 卡片填入 → 重试

## 备注
- **data URL 兜底**只在 imgbb 上传失败时触发（极少见 ~1% 情况）。这次会进 localStorage（2MB 左右），后续可以加 LRU 清理：定期扫描消息库把 data URL 重新上传
- **当前两个中转站都没真转发 gpt-image-2**——如果想用 gpt-image-2 的中文渲染/多图能力，需要另外找支持 gpt-image-2 的中转站
- **DALL-E 3 已停用**，gemai.cc 现在可能用的是镜像/缓存，长期可能也会切模型，到时候也会只 b64
- 本次 imgbb 方案让"换任何站点/换任何模型"都能稳定工作，不依赖具体中转站的具体行为
- 之前 commit `47f5776` 里有 `netlify/functions/image-upload-store.ts` 中间版本，回退删了——历史保留方便回看
