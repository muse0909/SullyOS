# ComfyUI 卡片加 checkpoint 选择（暮色 2026-07-04 反馈修正）

**日期**：2026-07-04
**涉及 commit**：`c48384a`

## TL;DR

暮色 2026-07-04 00:10 反馈上一版（`abdd1ea`）"模型开关"漏了：
- 之前我把 `COMFYUI_FIXED_MODEL = 'realisticVisionV60B1_v60B1VAE.safetensors'` 写死成默认
- 暮色要的是：RV + Pony 两种**都保留 + 手动切换**
- 草图里其实画了"Realistic Vision V6.0 B1 [● 启用] / Pony V6 XL [○ 关闭]"——**我没看进去**

## 改了什么

### 1. **删写死常量**
- 删 `COMFYUI_FIXED_MODEL` 常量（Settings.tsx + ApiQuickFloat.tsx 都有）
- model 不再是代码常量，**完全由用户在 UI 上选**

### 2. **加 useState `localComfyuiSelectedModel`**
- 初始值从 `apiConfig.imageModel` 同步（如果之前保存过 ComfyUI 配置，会自动选中上次的）
- 切回 Settings 页面时 useEffect 会重置
- testComfyuiConnection 拉到的 checkpoint 列表会触发 UI 重新渲染，但**不自动改 local 选中**（保留用户上次选择）

### 3. **ComfyUI 卡片下加 checkpoint 选择器**
- 之前是 span（只显示）
- 现在是 button 列表（**可点击**），每个一行 + 单选圆点 + 风格标签
- 选中样式：绿色背景 + 绿点 + 粗体（暮色审美偏好）
- 自动识别风格：
  - 包含 `pony` → `🎨 动漫`
  - 包含 `realistic` → `📷 写实`
  - 其他 → 无标签

### 4. **handleSaveComfyuiImageApi 用选中的 checkpoint**
- 之前：写死 RV
- 现在：`localComfyuiSelectedModel || comfyuiModelList[0] || ''`（三层 fallback）
- 如果都没选过 → 报错"请先点 [测试连接] 拉取 checkpoint 列表"
- 保存时 toast 显示选中的模型名（不是笼统的"已启用"）

### 5. **ApiQuickFloat 浮动弹窗同步**
- 同样加 `localComfyuiSelectedModel` useState
- ComfyUI 卡片下加可点击 checkpoint 列表（紧凑版）
- handleSaveAndClose 用选中的 model
- 提示文字："当前选：xxx"

## 动了哪些文件

| 文件 | 改动 |
|---|---|
| `apps/Settings.tsx` | 删 COMFYUI_FIXED_MODEL / 加 useState / useEffect 同步 / handleSaveComfyuiImageApi 用选中值 / ComfyUI 卡片 UI 改成 radio 风格 button 列表 |
| `components/os/ApiQuickFloat.tsx` | 同样改 3 处 |

## 踩坑 / 需要知道的

### 1. **checkpoint 列表来源仍然是 testComfyuiConnection**
- UI 不会**自动**拉 checkpoint
- 暮色第一次进 ComfyUI 卡片需要先点 [测试连接]
- 这是有意设计：避免用户进入页面就触发网络请求

### 2. **localComfyuiSelectedModel 默认值从 apiConfig 同步**
- 但 apiConfig.imageModel 可能是"上次保存的 model 名"——如果用户的 Mac 上 ComfyUI 删了那个模型，下次 test 出来列表里没有 → 默认值是空
- 用 `localComfyuiSelectedModel || comfyuiModelList[0]` 兜底：用户没主动选时自动选第一个

### 3. **风格标签是字符串匹配**
- 现在只匹配 `pony` 和 `realistic` 两种关键字
- 暮色以后下别的模型（比如 `sdxl`、`dreamshaper`）不会显示风格标签
- 不会报错，只是没标签（影响很小）

### 4. **没改的是：isPresetActive**
- 浮窗的"当前预设高亮"逻辑只比对 URL/Key/Model
- 加 imageGenProvider 后应该比 4 个字段
- 这次又没改（影响小，留作下次）

## 跟前两版对比

```
v1 (230fe0b):
  [OpenAI 兼容 | ComfyUI 本地 | NAI | MCD]   ← 切换字段
  ComfyUI 时显示：URL/Key/Model（手输）

v2 (abdd1ea):
  [当前使用: ComfyUI 本地]
  3 独立卡片
  ComfyUI 卡片：写死默认 RV + 状态条 + 测试连接

v3 (c48384a, 现在):
  [当前使用: ComfyUI 本地]
  3 独立卡片
  ComfyUI 卡片：状态条 + checkpoint 列表（可点击选 RV/Pony） + 测试连接
              → 用户手动选哪个就保存哪个
```

## 备注

- 这次**1.5 小时内 3 版迭代**——属于"探索 → 用户反馈 → 重构 → 再反馈 → 再修正"的正常节奏
- 暮色的反馈其实很清晰（草图画了），**我应该一开始就认真读草图**——这是教训
- 模型切换 UI 现在是**单选**（只能选一个 checkpoint），如果以后想"多 checkpoint 投票生成"需要新设计（暂不需要）
- 默认 model 选定逻辑：`localComfyuiSelectedModel || comfyuiModelList[0]`——这意味着用户**第一次**用时一定用列表第一个，**第二次**起尊重上次选择

## 后续

- [ ] isPresetActive 加 imageGenProvider 比对（修遗留的尾巴）
- [ ] checkpoint 列表加缩略图（如果有时间）
- [ ] 风格标签扩展（pony/realistic 之外的其他模型）
- [ ] 模型列表支持搜索/过滤（如果用户下载 10+ checkpoint）
