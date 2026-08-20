# 图床配置 3 tab 重构（imgbb / Cloudinary / R2）

## 背景

暮色 2026-08-20 反馈图床配置原来 3 个图床（imgbb / Cloudinary / R2）全堆在一个页面，配置混在一起，预设也共享一个池子 — 想要每个图床独立 tab 切换 + 独立预设 + 一键清空。

## 改动

4 处：

1. **`types.ts`**：
   - `APIConfig` 加 `cloudinaryCloudName` / `cloudinaryUploadPreset` 字段（之前漏了）
   - `APIConfig` 加 `bedKind?: 'imgbb' | 'cloudinary' | 'r2'` 字段（预设 tab 标记）

2. **`apps/Settings.tsx`**：
   - 加 `localImageBed: 'imgbb' | 'cloudinary' | 'r2'` state（默认 `imgbb`）
   - 加 3 tab chip 切换（参考 OpenAI / Gemini 协议切换的样式，圆点 + 文字 + 选中态）
   - 重写图床配置区域：按 `localImageBed` 渲染对应页面（每页独立输入框 + 介绍框 + 保存按钮 + **一键清空按钮**）
   - `presetsByKind` 加 `imagebedByTab(tab)` 方法 — 按 `bedKind` 过滤预设（互不打扰）
     - 老预设（没 `bedKind` 字段）默认归 `imgbb`（向后兼容）
   - `handleSavePreset` 的 `imagebed` case 加 `bedKind: localImageBed`
   - `loadPreset` 加载图床预设时根据 `bedKind` 自动 `setLocalImageBed(...)` 切到对应 tab
   - `handleSaveImagebed` 加 cloudinary 字段 + status msg 显示当前 tab

3. **预设独立逻辑**：
   - 3 个 tab 各有自己的预设池（按 `bedKind` 过滤）
   - 切 tab 自动显示对应 tab 的预设
   - 加载预设时自动切到对应 tab
   - 保存预设时自动带 `bedKind` 标记

4. **一键清空**：
   - imgbb 页：清 imgbbApiKey
   - Cloudinary 页：清 cloudinaryCloudName + cloudinaryUploadPreset
   - R2 页：清 5 个 R2 字段
   - 每页都有 confirm 弹窗确认

## 验证

preview URL 测：
- 切 tab 切换流畅
- 每页有独立的预设（imgbb 预设只在 imgbb tab 显示，Cloudinary 预设只在 Cloudinary tab 显示）
- 一键清空按钮只清当前 tab 的字段（不影响其他 tab）
- 加载预设时自动切到预设对应的 tab
- 三个图床配置都正确保存到 `apiConfig`

## 兼容性

- 老图床预设（没 `bedKind` 字段）默认归 `imgbb` tab — 不破坏现有数据
- 老 `apiConfig` 没 `cloudinaryCloudName` / `cloudinaryUploadPreset` 字段 — 留空不报错
