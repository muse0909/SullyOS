# 保存图片到相册：data URL base64 图片触发 proxy-image 超长 URL 失败

**日期**：2026-07-14（登记日，**未修复**）
**状态**：🟡 已知 bug，等后续修复

## Bug 现象

用户在 SullyOS 触发"保存图片到相册"功能时，console 出现：
```
GET https://sully-os-git-preview-.../api/proxy-image?url=data:image/png;base64,...(3.2 MB)
net::ERR_FAILED
```

图片保存失败（暮色反馈"保存图片卡了很久"）。

## 复现步骤

1. 用户发一张图（被压缩成 base64 data URL，~1.5-3 MB）
2. 触发"保存图片到相册"
3. 浏览器 console 出现 `net::ERR_FAILED`
4. 图片没存到相册

## 根因

`utils/file.ts:142-167` 在"保存图片"时**不分类型**地把图丢给 `/api/proxy-image`：

```ts
// utils/file.ts:152-153
// 跨域图床（img.ai198.top / imgbb 等）浏览器 CORS 拦截直接 fetch，
// 走后端 /api/proxy-image 绕开 CORS（暮色 2026-07-13 调研后定的方案）。
const proxiedUrl = '/api/proxy-image?url=' + encodeURIComponent(url);
```

`url` 可能是：
- ✅ `https://i.ibb.co/xxx.png`（图床 URL）→ proxy-image 正常转发
- ❌ `data:image/png;base64,...`（base64 图）→ **3MB+ 拼到 query string**，浏览器直接 ERR_FAILED

实际上 `proxy-image` 自己也不接受 `data:` protocol（`api/proxy-image.ts:54` 明确 `if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:'`）—— 即使浏览器放行也会被 400 拒。

## 修复方向（后续）

`utils/file.ts:152` 前**判断 url 协议**：
```ts
if (url.startsWith('data:')) {
    // base64 图：直接用 fetch(url).then(blob) 拿 blob，不需要 proxy
    const res = await fetch(url);
    const blob = await res.blob();
    // ... 走 saveBlob 路径
} else {
    // 网络图：走原 proxy-image 路径
    const proxiedUrl = '/api/proxy-image?url=' + encodeURIComponent(url);
    // ...
}
```

**改动影响面**：
- `utils/file.ts:142-167`（直接改）
- `utils/saveRemoteImage.ts:60-?`（同样模式，**两处都有 bug**，要一起修）
- 跟 R2 / toast / 签名 无关，独立 bug

## 备注

- 这个 bug **跟 R2 兜底 / toast 改 10 秒 / 自写签名**完全独立
- 暮色反馈时已经在调试 R2，看到的 ERR_FAILED 是触发保存图片时残留的旧日志
- 不影响 R2 兜底测试（生图链路根本不走 `utils/file.ts`）
