# ComfyUI 本地部署 + OpenAI 桥接到 SullyOS

**日期**：2026-07-02
**任务**：本地部署 ComfyUI + 开启 API 模式 + 接到小手机生图通道

## TL;DR

- **机器**：Apple Silicon Mac（M1/M2），macOS 13.4.1，16GB RAM，601GB 磁盘可
- **ComfyUI** 跑在 `http://127.0.0.1:8188`（Web UI + 原生 API）
- **OpenAI 桥** 跑在 `http://127.0.0.1:8190`（暴露 `/v1/images/generations`，**SullyOS 零改动直接接**）
- **MPS 已验证**：`torch.backends.mps.is_available() = True`，2x2 tensor 跑通
- **没下模型** —— 用户后续根据偏好选 Pony/SDXL/SD 1.5，下完放 `~/ComfyUI/models/checkpoints/` 即生效

## 改动 / 创建的文件

| 文件 | 说明 |
|---|---|
| `~/ComfyUI/openai_bridge.py` | FastAPI 写的 OpenAI 兼容桥，~270 行。把 ComfyUI 原生 `/prompt` + `/history/{id}` + `/view` 包成 OpenAI `/v1/images/generations` |
| `~/ComfyUI/start_comfyui.sh` | 一键启动 ComfyUI + 桥（自动等 boot + health check） |
| `~/ComfyUI/stop_comfyui.sh` | 一键停止两个进程 |
| `~/ComfyUI/venv/` | Python 3.11.15 venv（包含 torch 2.5.1 MPS + ComfyUI 全套依赖 + FastAPI） |
| `~/ComfyUI/logs/comfyui.log` | ComfyUI 运行日志 |
| `~/ComfyUI/logs/bridge.log` | 桥运行日志 |

## SullyOS 端怎么配

进 **设置 → API 弹窗 → 生图**：

- **生图模型 URL**：`http://127.0.0.1:8190/v1`
- **生图模型 Key**：随便填（桥不验 key）
- **生图模型名字**：下完模型后填 checkpoint 文件名，例如 `ponyDiffusionV6XL_v6.safetensors`

> SullyOS 端代码**完全没改**——因为生图通道本来就是按 OpenAI 协议设计的。

## 踩坑（重要）

### 1. **Python 3.9 不够，ComfyUI 要 3.10+**
系统 Python 是 3.9.6，ComfyUI requirements 不支持。装了 `brew install python@3.11`（5 分钟，~210MB）。

### 2. **PyTorch 2.11 在 macOS 13 上 MPS 不工作**
默认装的 torch 2.11.0，`mps built: True` 但 `is_available: False`。降级到 **torch 2.5.1**（最后一个稳定支持 macOS 13 MPS 的版本）。

**验证**：`torch.ones(2,2,device='mps').sum()` = 4 ✅

### 3. **`av` 包需要 ffmpeg 系统库**
`av>=16.0.0` 是 ffmpeg 的 Python wrapper，要 build。`brew install ffmpeg`（1 分钟，54MB）。

### 4. **ComfyUI 自己的 pip 包要单独装**
`comfy-aimdo` / `comfy-kitchen` / `comfyui-workflow-templates` / `comfyui-embedded-docs` / `comfyui-frontend-package` 这些是 ComfyUI 自己的 Python 包，`pip install -r requirements.txt` 一次性跑会**超时**（其中 frontend 包 26MB）。后续启动 ComfyUI 时按报错一个一个装。

### 5. **ComfyUI 自带的 `api_server/` 不是 OpenAI 兼容**
看了下 `~/ComfyUI/api_server/` 是新模块化的内部 REST（不暴露 `/v1/images/generations`）。所以**桥必须自己写**，没法复用现成包。

### 6. **模型 Moody Krea Mix V2 是 Flux 系，Mac 16GB 跑不动**
暮色给的 `civitai.red/models/2731187/moody-krea-2-mix-uncensored`：`baseModel: "Krea 2"`（Flux 架构）+ 只有 fp8/nvfp4/int8 量化版 + 13.16GB 多分片。Apple Silicon MPS 不支持 fp8 量化，跑不动。
**暮色同意先用环境跑通，模型后续单独决策**。

## 后续 todo

- [ ] **挑模型下**：Pony V6（动漫，6.5GB）/ SDXL（写实，6.5GB）/ SD 1.5（最快，4GB）。下完放 `~/ComfyUI/models/checkpoints/`
- [ ] **Mac 端测一张图**：触发一次生图，确认 60-90 秒/张（MPS 速度预期）
- [ ] **可选：自动启动**：写个 launchd plist 让 ComfyUI 开机自启（Mavis 评估：暂时不必，暮色手动 `./start_comfyui.sh` 就行）

## 备注

- **API 模式本身就是开的**：ComfyUI 启动后 Web UI (8188) 和 API (`/prompt` `/history` `/view` `/ws`) 都自动监听，不需要"开启"什么。
- **不要碰默认 0.0.0.0**：现在 bridge 监听 `127.0.0.1`（只本机访问）。如果要让 iOS 琪琪远程访问，需要 Cloudflare Tunnel 或者改监听 `0.0.0.0` + 防火墙。
- **可以现在就用**：模型没下也能调通 `/v1/images/generations` —— 桥会把错误回传给 SullyOS（"Checkpoint 'X' not found"），小手机会显示 toast。等模型到位再真正出图。