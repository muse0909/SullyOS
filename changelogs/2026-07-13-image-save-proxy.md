# 保存图片走 Vercel 代理，绕开跨域图床 CORS

**日期**：2026-07-13
**涉及 commit**：`55f5eba` `8ac146b`

## 改了什么

- 新增 `api/proxy-image.ts` —— Vercel Serverless Function，后端 fetch 绕开浏览器 CORS，把图床图片二进制流回前端
- 改 `utils/file.ts` + `utils/saveRemoteImage.ts` 的 `saveRemoteImage` web 路径：第 2 步 fetch 改成 `fetch('/api/proxy-image?url=' + encodeURIComponent(url))`，让 blob 下载路径走代理
- 不动：Capacitor 原生路径、anchor download 兜底、window.open 兜底

## 动了哪些文件

- `api/proxy-image.ts`（新增） —— Vercel Serverless Function，文件即 endpoint `/api/proxy-image`
  - GET 请求，参数 `url=<encoded>`
  - 校验：URL 必须 http/https、URL 长度 ≤ 2048、host 拒绝内网/loopback（127.x / 10.x / 172.16-31.x / 192.168.x / 169.254.x / fc00::/7 / fe80::/10，防 SSRF）
  - 上游 fetch：10s 超时、20MB size 上限
  - 响应：透传 content-type（仅 image/*）、设 `Cache-Control: public, max-age=86400, immutable`、`Access-Control-Allow-Origin: *`
  - 错误：400（参数错）/ 413（太大）/ 502（上游失败）/ 504（超时）
- `utils/file.ts` —— web-download 路径（line 151-163）和 web-share 路径（line 169）的 `fetch(url)` 改成 `fetch(proxiedUrl)`
- `utils/saveRemoteImage.ts` —— 同步改（两份代码实现要保持一致）

## 踩坑 / 需要知道的

- **为什么放 `api/` 不放 `netlify/functions/`**：项目是 Vercel 跑前端，暮色从 Vercel 域名测。Vercel 域名访问不到 Netlify Functions，访问会 404。`api/` 是 Vercel 同源，零 CORS 零额外配置
- **为什么不动 `api/proxy.ts`（已存在）**：那个是 **POST + JSON 转发**，给 LLM API 中转用的，**不能拿它转图片**（图片是 GET + 二进制流 + content-type 是 image/*）。所以新建 `api/proxy-image.ts`，跟现有 proxy.ts 不冲突
- **为什么不动 worker（Cloudflare Worker）**：Worker 是 AI 后端，独立域 `sullymeow.ccwu.cc`，加路由需要改前端 baseURL，得不偿失
- **为什么不动 Capacitor 原生路径**：`if (Capacitor.isNativePlatform())` 那个分支用的是 Capacitor 原生 fetch，**绕过浏览器 CORS**，不需要代理
- **为什么不动 anchor download 第一步**：跨域资源浏览器会忽略 `download` 属性改"新 tab 打开图片"是浏览器层行为，没法代码绕过。但 Chrome/Safari 等**有"长按图片保存"原生功能**，所以 anchor 这步对有原生支持的浏览器仍然管用——保留这个行为做兜底
- **DNS rebinding 没防**：只做了 host 字符串字面值检查，**没**做 fetch 时再解析 IP 二次校验。如果有人精心构造域名解析到 127.0.0.1 还是能绕过。**不防的理由**：项目里 `api/proxy.ts` / `netlify/functions/webdav-proxy.ts` 都没做这层防护，咱不引入新策略。如果以后想严防，加 Node `dns.lookup` 二次校验 + AbortController 取消即可
- **大小限制 20MB**：图床图一般几 MB，超过这个几乎都是错的。`Cache-Control: public, max-age=86400, immutable` 是赌图床图不会变

## 备注

- **测试方式**：等 Vercel 部署完，聊天页/群聊页长按一张生图（任何已加载的图片）→ 点"保存图片" → 应该能触发真实的"下载到相册"流程（不再走新 tab 兜底）
- **预期效果**：
  - Chrome（之前能下，长按图片保存）→ 现在应该能直接走 blob 下载，更稳
  - 永恒浏览器（之前不能下）→ **这次能下了**（agent 不会触发长按图片保存，靠代码层 blob 下载）
  - 控制台应该不再弹 CORS 错误，"系统调试终端" 不再有 `fetch_failed`
- **没动 AGENTS.md 项目结构那一节**（`api/` 已经有 minimax/volink/proxy 三个分类，新加的 proxy-image 应该归"代理"类，等暮色要不要我顺手补一节再问）
- 跟之前 `api/proxy.ts` 命名重复问题：暮色 2026-07-13 拍板用 `proxy-image` 后缀做区分，**没有混淆**
