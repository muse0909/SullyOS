# Cloudinary 图床 fallback（imgbb 网络不稳时备用）

## 背景

暮色 2026-08-20 反馈 imgbb 在香港 / 新加坡代理节点下间歇性挂（`Failed to fetch`）—— imgbb 同一 IP 多次上传会被 CloudFlare 风控限速。节点赌运气不稳定。

## 改动

3 块：

1. **`types.ts`**：`APIConfig` 加 `cloudinaryCloudName` + `cloudinaryUploadPreset` 两个字段
2. **`hooks/useChatAI.ts`**（`useChatAI.ts:2278-2330` 那段）：
   - imgbb 上传失败（fetch 抛错 / 5xx）→ 自动 fallback 切 Cloudinary
   - Cloudinary 用 **unsigned upload preset**（控制台创建，无需签名）—— POST `https://api.cloudinary.com/v1_1/{cloudName}/image/upload`
   - Cloudinary 也失败 → 才退 data URL 兜底 + 弹"图床失败占内存"toast
3. **`apps/Settings.tsx`**：
   - 加 `localCloudinaryCloudName` / `localCloudinaryUploadPreset` 两个 state
   - 加"图床预设加载"分支同步（`if (kind === 'imagebed')` 那段）
   - UI 加 Cloudinary 区块（两个 input + 提示）：imgbb 输入框**下面**

## Cloudinary 配置

暮色 Cloudinary 服务恢复后：
1. 登录 cloudinary.com
2. Settings → Upload → Add upload preset
3. Signing Mode 选 **Unsigned**，记下 preset 名
4. 在 SullyOS"图床"卡片填：
   - **Cloud Name** = 控制台首页那个 cloud name
   - **Upload Preset** = 上面创建的 preset 名
5. 保存即可。imgbb 失败时会自动用 Cloudinary 顶上。

## 验证

- preview URL 测：
  - imgbb 通 → 走 imgbb（不变）
  - imgbb 失败 + Cloudinary 配好 → 切 Cloudinary，控制台看到 `🎨 [ImageGen] imgbb 失败，fallback 到 Cloudinary...` + `b64 已上传到 Cloudinary, url = ...`
  - imgbb + Cloudinary 都失败 → data URL 兜底（不变）

## 影响

| 状态 | 改动前 | 改动后 |
|---|---|---|
| imgbb 通 | ✅ 走 imgbb | ✅ 走 imgbb（不变） |
| imgbb 挂 + Cloudinary 配好 | ❌ data URL 兜底 | ✅ 自动切 Cloudinary |
| imgbb 挂 + Cloudinary 没配 | ❌ data URL 兜底 | ❌ data URL 兜底（不变） |
| 都没配 | ❌ data URL 兜底 | ❌ data URL 兜底（不变） |
