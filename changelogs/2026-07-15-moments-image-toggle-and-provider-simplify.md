# 朋友圈配图简化为单 toggle + API 浮窗删 ComfyUI/NAI

**日期**：2026-07-15
**涉及 commit**：`c3c7250`

## 改了什么

### 1. 朋友圈配图 section（彻底简化）

- **删** 4 选 1 radio group（不配图 / ComfyUI / NAI / MCD）
- **加** 一个 `SettingToggle`：「AI 自主配图」
  - 开（默认）：LLM 自己决定这次发朋友圈要不要加图（写 imagePrompt 或不写）
  - 关：LLM 强制不配图（prompt 里不输出 imagePrompt 字段）
- 副标题改："AI 发朋友圈时是否配图"（保持不变）
- 删了 `PROVIDERS` 数组和 `ImageGenProviderSelect` 组件（-30 行）

### 2. 独立生图 API 配置浮窗（删 ComfyUI/NAI）

暮色截图里红线圈的两个 tab 和 ComfyUI 卡片全删了：

- 顶部「当前使用」状态条：只显示「OpenAI 兼容 + model 名」（删 ComfyUI/NAI 分支）
- 服务商 3 档切换 → **整段删除**（OpenAI / ComfyUI / NAI）
- ComfyUI 卡片（在线状态条 + checkpoint 列表 + 测试连接按钮）→ **整段删除**
- NAI 卡片（占位说明）→ **整段删除**
- 删了 4 个 ComfyUI 专用 state：`comfyuiTestState` / `comfyuiTestMsg` / `comfyuiModelList` / `localComfyuiSelectedModel`
- 删了 `localImageGenProvider` state
- 删了 `testComfyuiConnection` 函数 + `COMFYUI_FIXED_URL` / `COMFYUI_FIXED_KEY` 常量
- 删了 `checkpointLabel` helper
- 删了 `comfyuiCanSave` 防御检查 + 底部"未选 checkpoint"提示
- `handleSaveAndClose` 简化：imageGenProvider 写死 `'openai'`
- 底部 "保存并关闭" 按钮去 disabled（comfyuiCanSave 已删）
- section subtitle: "OpenAI / ComfyUI 本地" → "OpenAI 兼容"

### 3. 朋友圈 AI 配图 prompt 改写

`utils/momentsAI.ts:117` JSON schema 字段注释：`(不需要配图就写 null 或省略此字段)`
`utils/momentsAI.ts:124-127` 要求行：`- imagePrompt 用英文写，描述具体画面... —— 但**你自己决定**这次要不要配图，不需要配图就写 null 或省略这个字段`

## 动了哪些文件

- `utils/momentsStorage.ts` —— `MomentSettings` 删 `imageGenProvider: 'none'|'comfyui'|'nai'|'mcd'`，加 `aiCanUseImage: boolean`（默认 `true`）
- `utils/momentsAI.ts` —— `useImageGen = settings.aiCanUseImage`；`publishPostAsChar` 删第 4 个 `imageGenProvider` 参数；LLM prompt 改成 AI 自主决策
- `apps/MomentsSettingsPage.tsx` —— 配图 section 改成 `SettingToggle`；删 `PROVIDERS` 数组 + `ImageGenProviderSelect` 组件
- `components/os/ApiQuickFloat.tsx` —— 删 4 个 ComfyUI state + `localImageGenProvider` state；删 3 档切换 + ComfyUI 卡片 + NAI 卡片 + ComfyUI helpers；`handleSaveAndClose` 简化

## 踩坑 / 需要知道的（重要）

### 1. `apiConfig.imageGenProvider` 类型没动

`types.ts:171` 仍然有 `imageGenProvider?: 'openai' | 'comfyui' | 'nai'`。**故意保留** — 暮色可能哪天加回 ComfyUI/NAI，保留 type 不用改全局。

但实际**写死 `'openai'`** 在 `ApiQuickFloat` 的 `handleSaveAndClose`（line 347）。其他位置（`Settings.tsx:728` `imageGenProvider: 'comfyui'`）我没动 — 死代码但不影响运行（详见 #3）。

### 2. 老用户 localStorage 兼容

`getSettings()` 用 `{ ...DEFAULT_SETTINGS, ...parsed }` 合并。新字段 `aiCanUseImage` 老用户没存 → 自动 fallback 到 `true`（默认开）。老字段 `imageGenProvider: 'none'` 留在 localStorage 里没人读，**无害 dead data**。

### 3. `Settings.tsx` 也有 ComfyUI/NAI 配置 — 没动

暮色截图指的是「独立生图配置」浮窗（`ApiQuickFloat.tsx`），但 `apps/Settings.tsx:1700+` 的「完整设置页 → 生图服务」section 也有同样的 3 档切换 + ComfyUI 卡片 + NAI 卡片。

**这次没改 Settings.tsx** — 等暮色确认是否也改（可能他忘了这里也有）。

如果删了 `ApiQuickFloat` 的 ComfyUI/NAI 但保留 `Settings.tsx`，会有「不一致」问题：用户进 Settings 还能看到 ComfyUI/NAI，但那个路径下保存会写 `imageGenProvider: 'comfyui'`，**整个项目等于没清理干净**。

### 4. 朋友圈「AI 配图」实际接通状态

暮色说"现在生图只有 OpenAI 接口能用"——**朋友圈 AI 配图实际有没有接通生图 API 是个未知点**。

`utils/momentsAI.ts:507` 的 `publishPostAsChar` 把 `imageGenPrompt` 存到 post 里，但**没调生图 API**。`hooks/useChatAI.ts:2172` 注释明确说"AI 主动发的动态都是纯文字，图片要走 imageGenProvider 这里不做"。

这次的 toggle 改动只影响 LLM 是否输出 imagePrompt 字段，**不直接影响朋友圈显示图片**。要真接通生图还需要：
- 在 `useChatAI` 或朋友圈 UI 层读 `imageGenPrompt` → 调 `apiConfig.imageBaseUrl/apiKey/imageModel` 生图 → 把图存到 post.images
- 单独一个 task

暮色没要求做，**先放一放**。

### 5. `Settings.tsx:728` 硬编码 `imageGenProvider: 'comfyui'`

这是个未触发的分支（暮色没用 Settings.tsx 的 ComfyUI 路径）。我没动 — 等暮色决定 Settings.tsx 是否一起改时一起处理。

## 备注

- commit `c3c7250` 已 push 到 `origin/preview`，Vercel 自动部署
- **测试场景**：
  - 朋友圈设置 → 配图 section 现在只有一个 toggle「AI 自主配图」
  - 打开 AI 浮窗（右上角 WiFi）→ 生图 section 只剩 OpenAI 兼容
- **未做**：
  - Settings.tsx 的 ComfyUI/NAI 等暮色确认
  - 朋友圈 AI 配图真接通生图 API（独立 task）
  - types.ts:171 的 imageGenProvider 简化（保留防御性 type）
- 跳转 bug 按暮色要求**先放一放**（changelog 2026-07-15-chat-search-jump-to-message 里有讨论）
