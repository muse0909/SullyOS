# 朋友圈配图简化为单 toggle + 生图 API 两处都删 ComfyUI/NAI

**日期**：2026-07-15
**涉及 commit**：`c3c7250` `9f00af1` `dfda21c`

## 改了什么

### 1. 朋友圈配图 section（彻底简化）

- **删** 4 选 1 radio group（不配图 / ComfyUI / NAI / MCD）
- **加** 一个 `SettingToggle`：「AI 自主配图」
  - 开（默认）：LLM 自己决定这次发朋友圈要不要加图（写 imagePrompt 或不写）
  - 关：LLM 强制不配图（prompt 里不输出 imagePrompt 字段）
- 副标题改："AI 发朋友圈时是否配图"（保持不变）
- 删了 `PROVIDERS` 数组和 `ImageGenProviderSelect` 组件（-30 行）

### 2. 独立生图 API 配置浮窗（`ApiQuickFloat.tsx`，删 ComfyUI/NAI）

暮色截图里红线圈的两个 tab 和 ComfyUI 卡片全删了：

- **顶部「当前使用」状态条 → 整段删除**（暮色 22:40 反馈冗余 — section 标题已经说"生图"+ subtitle "OpenAI 兼容"，完全多余；Model 名字在下面 Model 字段里也有）
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

### 3. 完整设置页「生图服务」section（`Settings.tsx`，暮色 22:39 拍板全删）

暮色 22:39 补刀："**ComfyUI/NAI tab 是都删掉，设置里和悬浮窗都删掉**"。`Settings.tsx:1700+` 的「生图服务」section 跟浮窗是**同一功能两处入口**，只改一处会留 bug。

- 删 5 个 state：`localImageGenProvider` / `comfyuiTestState` / `comfyuiTestMsg` / `comfyuiModelList` / `localComfyuiSelectedModel`
- 删 useEffect 同步里 `setLocalImageGenProvider` + `setLocalComfyuiSelectedModel`
- 删 preset load/save 里的 `imageGenProvider` 字段
- 删 `COMFYUI_FIXED_URL` / `COMFYUI_FIXED_KEY` 常量
- 删 `checkpointLabel` helper（与 ApiQuickFloat 同款）
- 删 `handleSaveComfyuiImageApi` 函数（独立 save 按钮已删）
- 删 `testComfyuiConnection` 函数
- 「当前使用」状态条 → **整段删除**（同 ApiQuickFloat，冗余）
- 删 3 档服务商切换
- 删 ComfyUI 本地卡片（在线/离线 + checkpoint 列表 + 测试连接 + 启用按钮）
- 删 NAI 卡片（占位说明）
- section subtitle: "OpenAI 兼容 / ComfyUI 本地" → "OpenAI 兼容"
- "保存为预设"按钮去掉 `localImageGenProvider` 条件渲染

### 4. 朋友圈 AI 配图 prompt 改写

`utils/momentsAI.ts:117` JSON schema 字段注释：`(不需要配图就写 null 或省略此字段)`
`utils/momentsAI.ts:124-127` 要求行：`- imagePrompt 用英文写，描述具体画面... —— 但**你自己决定**这次要不要配图，不需要配图就写 null 或省略这个字段`

## 动了哪些文件

- `utils/momentsStorage.ts` —— `MomentSettings` 删 `imageGenProvider: 'none'|'comfyui'|'nai'|'mcd'`，加 `aiCanUseImage: boolean`（默认 `true`）
- `utils/momentsAI.ts` —— `useImageGen = settings.aiCanUseImage`；`publishPostAsChar` 删第 4 个 `imageGenProvider` 参数；LLM prompt 改成 AI 自主决策
- `apps/MomentsSettingsPage.tsx` —— 配图 section 改成 `SettingToggle`；删 `PROVIDERS` 数组 + `ImageGenProviderSelect` 组件
- `components/os/ApiQuickFloat.tsx` —— 删 4 个 ComfyUI state + `localImageGenProvider` state；删 3 档切换 + ComfyUI 卡片 + NAI 卡片 + ComfyUI helpers；删顶部状态条；`handleSaveAndClose` 简化
- `apps/Settings.tsx` —— 删 5 个 ComfyUI/NAI state；删 4 个 helper（`COMFYUI_FIXED_*` 常量 / `checkpointLabel` / `handleSaveComfyuiImageApi` / `testComfyuiConnection`）；删 3 档切换 + ComfyUI 卡片 + NAI 卡片 + 顶部状态条；preset load/save 不再带 `imageGenProvider` 字段

## 踩坑 / 需要知道的（重要）

### 1. `apiConfig.imageGenProvider` 类型没动

`types.ts:171` 仍然有 `imageGenProvider?: 'openai' | 'comfyui' | 'nai'`。**故意保留** — 暮色可能哪天加回 ComfyUI/NAI，保留 type 不用改全局。

但实际**写死 `'openai'`** 在两处：
- `ApiQuickFloat.handleSaveAndClose`（`c3c7250`）
- `Settings.handleSaveOpenaiImageApi`（`dfda21c`）

### 2. 老用户 localStorage 兼容

`getSettings()` 用 `{ ...DEFAULT_SETTINGS, ...parsed }` 合并。新字段 `aiCanUseImage` 老用户没存 → 自动 fallback 到 `true`（默认开）。老字段 `imageGenProvider: 'none'` 留在 localStorage 里没人读，**无害 dead data**。

### 3. 朋友圈「AI 配图」实际接通状态

暮色说"现在生图只有 OpenAI 接口能用"——**朋友圈 AI 配图实际有没有接通生图 API 是个未知点**。

`utils/momentsAI.ts:507` 的 `publishPostAsChar` 把 `imageGenPrompt` 存到 post 里，但**没调生图 API**。`hooks/useChatAI.ts:2172` 注释明确说"AI 主动发的动态都是纯文字，图片要走 imageGenProvider 这里不做"。

这次的 toggle 改动只影响 LLM 是否输出 imagePrompt 字段，**不直接影响朋友圈显示图片**。要真接通生图还需要：
- 在 `useChatAI` 或朋友圈 UI 层读 `imageGenPrompt` → 调 `apiConfig.imageBaseUrl/apiKey/imageModel` 生图 → 把图存到 post.images
- 单独一个 task

暮色没要求做，**先放一放**。

### 4. 「当前使用」状态条删了 2 次 — 之前漏想

第一版改完（`c3c7250`）保留了 ApiQuickFloat 顶部的「当前使用：OpenAI 兼容 + gpt-image-2」状态条。暮色上线看后立刻反馈"这个当前使用也删掉"。

**教训**：单一 provider 时，"当前使用：xxx"这种状态条就是冗余信息。**section 标题 + subtitle 已经足够**，再加一条状态条重复一遍就 丑 了。**暮色审美里这种"信息重复"很敏感**，下次简化方案时主动想。

Settings.tsx 的同款状态条暮色没单独提，但同理由一并删了（22:39 全删拍板）。如果只删浮窗保留设置页会不一致。

## 备注

- 三个 commit `c3c7250` `9f00af1` `dfda21c` 都已 push 到 `origin/preview`，Vercel 自动部署
- **测试场景**：
  - 朋友圈设置 → 配图 section 现在只有一个 toggle「AI 自主配图」
  - 打开 AI 浮窗（右上角 WiFi）→ 生图 section 只剩 OpenAI 兼容 + 配置字段，**没有"当前使用"状态条**
  - 完整设置页 → 生图服务 section 同样只剩 OpenAI 兼容 + 配置字段
- **未做**：
  - 朋友圈 AI 配图真接通生图 API（独立 task）
  - types.ts:171 的 imageGenProvider 简化（保留防御性 type）
- 跳转 bug 按暮色要求**先放一放**（changelog 2026-07-15-chat-search-jump-to-message 里有讨论）
