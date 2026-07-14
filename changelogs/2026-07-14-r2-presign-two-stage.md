# R2 上传改两阶段 presign+直传（绕开 Vercel 10 秒超时）

**日期**：2026-07-14
**涉及 commit**：`4effb08`

## 改了什么

把"浏览器 → Vercel function → R2"三步走改成"浏览器 → Vercel 签名 → 浏览器 PUT → R2"两阶段。

### 1. `api/r2-upload.ts` → `api/r2-presign.ts`（重写）

| 之前 | 现在 |
|---|---|
| POST `{b64, mime, ...凭证}` | POST `{mime, prefix, ...凭证}` |
| function 解析 b64 + PutObject 到 R2 | function 只签 presigned URL |
| 整坨 b64 走 Vercel 管道 | 不传 b64，只签名 |
| 5-15 秒（5MB b64 解析+上传）| ~100ms（只签 URL）|

签名用 `@aws-sdk/s3-request-presigner.getSignedUrl`，URL 默认 10 分钟有效。

### 2. `hooks/useChatAI.ts:1331-1376` 解析器改两阶段

**生图 b64 处理流程**：
```
[旧]
POST /api/r2-upload (整坨 b64) → 等 5-15 秒 → 200 + url
                                 ↓ 超时
                              504 → data URL 兜底

[新]
POST /api/r2-presign (只传 mime+prefix) → 100ms 拿到 presignedUrl
PUT <presignedUrl> (binary, 浏览器 atob + Uint8Array) → R2
                                                            ↓
                                                     200 OK → 拼 publicUrl
```

### 3. `apps/Chat.tsx:1025-1066` 用户发图同样两阶段

跟生图走同一个 R2 上传函数（共享 `uploadB64ToR2` helper）。

### 4. 失败兜底链（按优先级降级）

```
1. 拿 presignedUrl 失败 → 直接走 imgbb
2. PUT R2 失败（CORS/网络）→ 走 imgbb
3. imgbb 未配/失败 → 走 data URL
```

跟之前 R2 报告的降级链一致，只是**触发降级的时机更晚**（之前是整个 504 才降级，现在只在 100ms 签 URL 失败 / PUT 失败才降级）。

## 动了哪些文件

- `api/r2-upload.ts` → `api/r2-presign.ts` —— git rename 识别为重命名
- `apps/Chat.tsx` —— 用户发图流程改成两阶段
- `hooks/useChatAI.ts` —— 生图 b64 流程改成两阶段
- `package.json` + `package-lock.json` —— 加 `@aws-sdk/s3-request-presigner`（@aws-sdk/client-s3 已在 R2 报告里装过）

## 踩坑 / 需要知道的（重要）

### 为什么是"两阶段"不是"直接浏览器 PUT"
- R2 `secretAccessKey` 绝对不能给浏览器（拿到就能删你 bucket + 烧钱）
- presigned URL 是 R2 SDK 给的"限时签名"，浏览器拿到这个 URL **不用** secret 就能直接 PUT
- 签名过程（~100ms）必须在服务端做，URL 拿到后浏览器再直传
- 10 分钟有效期足够一个用户上传一张图

### 为什么 Vercel 会超时
- Vercel Hobby 套餐函数 10 秒硬限制
- 之前 5MB base64 + 解析 + PutObject = 5-15 秒 → 经常 504
- 用户现象：生图/发图卡 5 分钟看不到图，console 有 504 + FUNCTION_INVOCATION_TIMEOUT
- 改两阶段后 Vercel function 永远 ~100ms 完成，**0 超时风险**

### b64 → binary 在浏览器做（不在 function 做）
- `atob(b64)` → string
- `for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i)` → Uint8Array
- 这样 PUT 的 body 是 binary，进 R2 不会被当 base64 文本存

### CORS 风险（部署后要测）
- 默认 R2 bucket 不允许任何 origin CORS PUT
- 第一次跑如果浏览器 console 报 "CORS policy" 错 → 暮色告诉我
- 修法：去 R2 bucket Settings → CORS Policy 加：
  ```
  Allowed Origins: https://sully-os-git-preview-muse0909s-projects.vercel.app
  Allowed Methods: GET, PUT, HEAD
  Allowed Headers: *
  ```
- 加完即可，不需要重新部署 Vercel

### 之前 R2 报告里的"10 秒超时注意"已经过时
- 之前担心批量发图会接近 10 秒
- 现在 function 永远 ~100ms，**根本进不去 timeout 区间**
- 即使一次发 10 张大图，瓶颈也在浏览器（atob + 循环拼 Uint8Array），不卡 Vercel

### 4MB 限制还是 4MB
- `api/r2-presign.ts` 不限制 body 大小（它根本不接 body）
- `processImage` 还是 `maxWidth: 1600, quality: 0.85`，单图 ~1.5MB base64
- 一次发 3 张 ≈ 4.5MB base64，仍在浏览器内存承受范围

## 验证方法（暮色测）

部署后看 Vercel deployment 完成（看 commit hash `4effb08`）→ 打开 preview 链接：

1. **生图测试**：触发一次生图，console 应有 `🎨 [ImageGen] b64 已上传到 R2, url = https://pub-xxx.r2.dev/...`
2. **发图测试**：用户发一张图，toast 不再"5 分钟"，秒到
3. **CORS 监控**：第一次发/生图如果失败，**第一时间**看 console 是否有 `Access to fetch ... has been blocked by CORS policy` → 给我

## 备注
- **没改** Settings.tsx（5 个 R2 字段还在原位，UI 不动）
- **没改** types.ts（字段名不变）
- **没改** imgbb 兜底链（降级链完整保留）
- **没动** R2 free tier 用量（这俩功能一图一次 PUT，跟之前一样）
- git rename 是 git 自动识别的（内容改写超过 50%），UI 上看着像删了重建，实际是同文件演进
