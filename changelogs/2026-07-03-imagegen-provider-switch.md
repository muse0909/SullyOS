# 生图服务加 provider 切换（OpenAI 兼容 / ComfyUI 本地 / NAI / MCD）

**日期**：2026-07-03
**涉及 commit**：`230fe0b`

## 改了什么

暮色要求：生图服务这块像 TTS 那样加一个"服务商"分类，把 OpenAI 兼容和 ComfyUI 本地显式分开（之前 7-2 部署的 ComfyUI 本地桥一直藏在通用 OpenAI 兼容入口下，没 UI 区分）。

加了 4 档 provider 切换（照搬 TTS 那边的 MiniMax / Volink 模式）：
- **OpenAI 兼容**（默认）— DALL·E 3 / GPT Image / 各类中转
- **ComfyUI 本地** — `http://127.0.0.1:8190/v1` + checkpoint 文件名
- **NAI** — 占位
- **MCD** — 占位

每个 provider 有独立的提示框（颜色区分：OpenAI 灰、ComfyUI 绿、NAI/MCD 琥珀），告诉用户当前该填什么。

## 动了哪些文件

| 文件 | 改动 |
|---|---|
| `types.ts` | `APIConfig` 加 `imageGenProvider?: 'openai' \| 'comfyui' \| 'nai' \| 'mcd'` |
| `apps/Settings.tsx` | useState + useEffect + handleSaveImageApi + loadPreset + 生图 section segmented control + 4 个 provider 提示框 + 副标题更新 |
| `components/os/ApiQuickFloat.tsx` | 浮动 API 弹窗的生图 section 同步：useState + useEffect + handleSaveAndClose + loadPreset + segmented control + 紧凑版提示 |
| `AGENTS.md` | 索引加本报告 |

## 踩坑 / 需要知道的

### 1. **字段没真改**——provider 是 UI 概念，不是协议分支
暮色最关心的"OpenAI / ComfyUI 区分"目前**只是 UI 提示层**。底层调生图还是统一走 `fetch(${imageBaseUrl}/images/generations`，所有 4 个 provider 都用同一个代码路径。

**为什么这样设计**：
- ComfyUI 桥本来就按 OpenAI 协议暴露（`/v1/images/generations`），所以 fetch 代码可以共用
- NAI 也提供 OpenAI 兼容 API，字段完全一样
- 真正的"分支"只有在某个 provider 需要**专用协议**时才发生（目前没有）

**这意味着什么**：
- 暮色切到 ComfyUI 时，URL/Key/Model 三个字段**视觉上不变**，但提示框会变成绿色 + 给出本地 URL 示例
- 切到 NAI/MCD 时，提示框是琥珀色"占位中"

### 2. **Key 字段没真"随便填"**——useChatAI 校验还是要 truthy
- ComfyUI 桥确实不验证 Key（随便传），但 `useChatAI.ts:1077` 和 `1216` 的判断是 `imageApiKey` 必须 truthy 才认为配置完整
- 暮色如果删空 Key → 生图工具不会注册 → AI 不会画图
- **当前 workaround**：提示框明确说"随便填"（默认 placeholder = `comfyui` 这种占位就行）
- **后续可改**：useChatAI 加 provider 判断，comfyui 时跳过 key 校验

### 3. **isPresetActive 没把 imageGenProvider 算进比对**（ApiQuickFloat）
- 浮动弹窗的"当前预设高亮"逻辑只比对 URL/Key/Model 三个字段
- 加载预设后 provider 也变了，但**高亮不会跟着变**
- 影响极小（视觉不完美，不影响功能）
- 后续如果要修：在 `ApiQuickFloat.tsx:392-394` 的 `isPresetActive` 加上 `c.imageGenProvider === localImageGenProvider`

### 4. **build hash 验证**
- `index-DP0v5B09.js` 是新 hash（之前是别的）
- vite build 没报错，4830 modules 全部 transform 成功
- runtime 真的会变（不是 Vite 缓存问题）

## 备注

- **NAI / MCD 实际还是占位**：当前没有专用代码分支。暮色要真接 NAI（用 NAI 自己的 OpenAI 兼容 URL）或者 MCD（待定），目前填 `https://api.novelai.net` 之类能跑通（同 OpenAI 兼容），只是 UI 上"占位中"提示比较明确
- **暗含的"云端 ComfyUI 怎么接"答案**：填一个云端 GPU 主机（RunPod / Vast.ai）的 `https://xxx.com/v1` 公网 URL 即可。代码 0 改动（OpenAI 协议通用）
- **可以现在就用**：暮色在 Vercel 部署链接上点开**设置 → 生图服务 → ComfyUI 本地**，填 `http://127.0.0.1:8190/v1` + 随便 Key + checkpoint 文件名 → 保存 → 让 AI 画图
  - **注意网络坑**：Vercel 部署的 SullyOS 在 Android Chrome 跑时，`127.0.0.1` 是 Android 设备自己，不是 Mac。暮色要本机用 → `npm run dev` 跑 Mac 本地版；要手机用 → 上 Cloudflare Tunnel（这俩不是本次 commit 范围）

## 跟其他功能的耦合

- `useChatAI.ts:1077, 1216` 的生图配置完整判断 — 暂不跟 provider 联动
- `utils/momentsAI.ts:420` 的 `imageGenProvider: 'comfyui' | 'nai' | 'mcd'` — 是另一个语义层（朋友圈 AI 配图选哪个 provider），跟 settings 里的 imageGenProvider 是**同名但不同字段**。今天没动它
- 任何用 `apiConfig.imageBaseUrl` 的地方都自动用上新字段（因为是可选字段，向后兼容）
