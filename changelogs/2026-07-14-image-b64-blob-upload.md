# 图床升级：imgbb → Cloudflare R2（不压缩，截图字清楚）

**日期**：2026-07-14
**涉及 commit**：`4f0454d` `47f5776` `eebd1e2` `19a4848`（前几个是 Netlify / imgbb 中间版，最终定 R2）

## 改了什么

### 1. 新增 Vercel function `api/r2-upload.ts`
- 接收 POST `{ b64, mime, prefix, accountId, accessKeyId, secretAccessKey, bucket, publicUrl }`
- 用 `@aws-sdk/client-s3` 调 Cloudflare R2（S3 兼容）putObject
- 返回 `{ success, key, url, bytes }`
- 4MB base64 限制
- CORS 头配齐

### 2. `types.ts` 加 5 个 R2 字段
```ts
r2AccountId?: string;        // Cloudflare Account ID（32 位 hex）
r2AccessKeyId?: string;      // R2 API Token 的 Access Key ID
r2SecretAccessKey?: string;  // R2 API Token 的 Secret（**只显示一次**）
r2Bucket?: string;           // bucket 名（例 sullyos-images）
r2PublicUrl?: string;        // 公网 URL（例 https://pub-xxxxx.r2.dev）
```

### 3. `apps/Settings.tsx` 加 5 个 R2 UI 字段
- 加在"独立识图配置"卡片里（imgbb 字段下方）
- 加 5 个 useState
- 改 `handleSaveVisionApi` / `handleSaveImageApi` / 默认配置 case 都写 R2 字段
- UI 用 VisibleKeyInput 组件（跟 imgbb 一致）

### 4. `hooks/useChatAI.ts` 解析器改 R2 优先
- b64 → R2 上传（优先）→ 拿永久 url 存 DB
- R2 没配 → 回退 imgbb
- 都未配 → data URL 兜底
- `🎨 [ImageGen]` 3 段诊断日志保留

### 5. `apps/Chat.tsx` 用户发图也用 R2
- `processImage` 压缩参数调高：`maxWidth: 600/quality: 0.6` → `maxWidth: 1600/quality: 0.85`（之前双重压缩导致字看不清）
- 优先 R2 上传（不压缩）
- R2 失败 → 回退 imgbb
- 都没配 → 走原来的 base64 占位图逻辑

### 6. 加依赖 `@aws-sdk/client-s3`
- Vercel 友好，R2 官方推荐
- 体积 ~1MB（Vercel function 50MB 限制内）

## 动了哪些文件
- `api/r2-upload.ts` —— 新建
- `types.ts` —— 加 5 个 R2 字段
- `apps/Settings.tsx` —— 加 5 个 R2 状态 + UI + 保存逻辑
- `hooks/useChatAI.ts` —— 解析器改 R2 优先
- `apps/Chat.tsx` —— 用户发图改 R2 优先 + 调高 processImage 参数
- `package.json` + `package-lock.json` —— 加 @aws-sdk/client-s3

## 用户操作

暮色需要在 Cloudflare 注册 + 填 5 个字段：

| 字段 | 来自 Cloudflare 哪里 |
|---|---|
| `r2AccountId` | R2 概览页右上角（32 位 hex）|
| `r2AccessKeyId` | Manage R2 API Tokens → 创建 token → Access Key ID |
| `r2SecretAccessKey` | 同上（**只显示一次**，要立即复制**）|
| `r2Bucket` | 创建 bucket 时填的名字（例 sullyos-images）|
| `r2PublicUrl` | bucket Settings → 启用 R2.dev subdomain → 拿 `https://pub-xxxxx.r2.dev` |

5 个值填到 Settings → "独立识图配置"卡片 → "图床 Cloudflare R2"区域 → 点保存。

## 踩坑 / 需要知道的（重要）

### 为什么不用 GitHub release assets / GitHub 当图床
- **不压缩**（✓）
- **但**：raw.githubusercontent.com 在国内**被墙**或极慢，聊天场景下用户点开图等半天加载不出来
- 只适合"存一次长期用"的场景（截图存档），不适合"实时生成实时展示"

### 为什么用 Vercel function 中转（不直接浏览器调 R2）
- R2 的 `secretAccessKey` **绝对不能**暴露给浏览器（任何人拿到就能删你 bucket 全部文件 + 烧你钱）
- 浏览器 fetch R2 SDK 需要 secret → 不安全
- 走 Vercel function 中转：浏览器传 b64 + 凭证到 `/api/r2-upload`，function 在服务端调 R2 SDK，**secret 永远不出 function**

### 10 秒超时注意
- Vercel Hobby 函数 10 秒硬限制
- R2 上传单图预计 1-3 秒，**安全**（不会触发）
- 但如果一次上传多张大图（比如朋友圈批量发）可能**接近** 10 秒
- 后续朋友圈 / 相册批量场景需要写 streaming

### imgbb 字段保留（fallback）
- **没删除** imgbb 相关代码（types.ts / Settings.tsx / 解析器）
- 配 R2 → 用 R2
- 没配 R2 但配了 imgbb → 回退 imgbb
- 都未配 → data URL 兜底
- 这样**老用户升级不会突然挂**（默认行为不变）

### processImage 调高的副作用
- `maxWidth: 1600, quality: 0.85` 比之前 600/0.6 文件大 **3-4 倍**
- 一次发 3 张图 ≈ 5MB base64（仍 ≤ 4MB 单张限制）
- 单图 > 4MB 会**触发 413 TOO_LARGE** —— R2 function 里限制了 4MB base64
- 后续如果用户发大图（手机原图 5MB+）需要再调高 R2 function 限制

## 备注
- **Vercel 10 秒函数超时是平台硬限制**——R2 上传单图不会触发，但批量场景要小心
- **R2 free tier**：10GB 存储 + 1000 万次读 + 1000 万次写免费（操作本身 0 费用，只有 egress 流量免费）—— 个人项目**绝对够用**
- 如果 R2 配额超了：Cloudflare 会**自动按用量收费**（绑的信用卡）—— 但**只有超量才扣**（默认不会扣）
- **之前 Netlify / imgbb 方案的所有 commit 都保留**在 git history，方便回看决策过程
