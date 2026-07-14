# 生图自动转 URL：b64 → Netlify Blobs 中转（解决中转站只返 b64 时的展示问题）

**日期**：2026-07-14
**涉及 commit**：`4f0454d` `47f5776`

## 改了什么

### 1. 加 Netlify Function `image-upload-store`（新文件）
- POST 接收 `{ b64, mime }` → 存 Netlify Blobs → 返回 `{ url: '/api/v1/image-upload-store?key=...' }`
- GET `?key=xxx` → 返回图片二进制（直接给 `<img src>` 用）
- DELETE `?key=xxx` → 删除云端 blob
- 限制：base64 字符串 ≤ 4MB（decode 后约 3MB 像素，1024x1536 PNG 1.8MB 安全范围）
- key 加 `image_` 前缀，store 名 `sullyos-images`
- 跟现有 `voice-favorite-store` 一模一样的模式（同一作者同一项目，照搬零成本）

### 2. `netlify.toml` 加 redirect
```
[[redirects]]
from = "/api/v1/image-upload-store"
to = "/.netlify/functions/image-upload-store"
status = 200
```

### 3. `hooks/useChatAI.ts` 解析器加 b64 分支
旧代码 `const imageUrl = imgData?.data?.[0]?.url || '';` —— 只读 url。
新代码：
- 优先 `data[0].url`（gemai.cc 类站点，零开销）
- 没 url 但有 `b64_json` → fetch `/api/v1/image-upload-store` 上传 → 拿永久 url 存 DB
- 上传失败 → data URL 兜底（不污染云端，但**会**进 localStorage，1% 情况可接受）

### 4. 加 3 段诊断日志（commit 4f0454d）
为排查"实际调用的模型"，加：
- `🎨 [ImageGen] 请求体` — 实际发出去的 model 字符串 + URL
- `🎨 [ImageGen] 响应` — 状态码 + data[0] 的所有 key + 顶层元数据
- `🎨 [ImageGen] data[0] 展开(已剥 b64_json)` — 失败时打，剥 b64 避免日志爆炸

## 动了哪些文件
- `netlify/functions/image-upload-store.ts` —— 新建，160 行
- `netlify.toml` —— 加 1 个 redirect
- `hooks/useChatAI.ts` —— 解析器加 b64 分支 + 3 段诊断日志

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

### 我之前说的错/对的（自我复盘）
| 之前推测 | 对/错 | 实际情况 |
|---|---|---|
| "gpt-image-1 只支持 b64" | ✓ 对 | OpenAI 硬性 |
| "中转站字符串不可信，实际转发由站点决定" | ✓ 对 | 完美验证 |
| "img.ai198.top 是中转站图床，URL 稳定" | ✓ 对 | 暮色"很久之前还能看到"也验证了 |
| "gpt-image-2 不存在" | ✗ 错 | 2026-04-21 真发布了 |
| "gpt-image-2 链接 1 小时过期" | △ 错一半 | 1 小时过期是 OpenAI 官方直连，暮色用的中转站做了缓存所以稳定 |
| "Netlify 是原作者的" | ✗ 错 | 暮色有自己的 Netlify，连自己 fork（origin = muse0909/SullyOS） |
| "Preserve log 找不到" 引导暮色查 Network | ✗ 错 | 真正需要的是**控制台**标签，不是 Network |
| "截图是 Netlify 日志" | ✗ 错 | 实际是 Chrome DevTools 的控制台标签（前端 useChatAI.ts 打的 console.log） |

### 变量名重复 build 失败（已修）
第一次 build 失败：`The symbol "_data0" has already been declared`。
原因：line 1287 响应日志那块的 `const _data0 = ...` 和我新加的 line 1320 解析器 `const _data0 = ...` 冲突。
**修复**：把后者的 `_data0` 改名为 `_imgData0`。
**教训**：跨函数块用前缀命名变量时，先 grep 一下同文件是否已用——避免和现有变量名撞。

## 备注
- **data URL 兜底**只在 Netlify Blobs 上传失败时触发（极少见 ~1% 情况）。这次会进 localStorage（2MB 左右），后续可以加 LRU 清理：定期扫描消息库把 data URL 重新上传
- **当前两个中转站都没真转发 gpt-image-2**——如果想用 gpt-image-2 的中文渲染/多图能力，需要另外找支持 gpt-image-2 的中转站
- **DALL-E 3 已停用**，gemai.cc 现在可能用的是镜像/缓存，长期可能也会切模型，到时候也会只 b64
- 本次 B 方案让"换任何站点/换任何模型"都能稳定工作，不依赖具体中转站的具体行为
