# ComfyUI 本地部署 + Pony V6 XL + MPS NaN 坑

**日期**：2026-07-02 → 2026-07-03（跨午夜）
**任务**：本地部署 ComfyUI + 接到小手机 + 下 Pony V6 XL 模型 + 端到端验证

## TL;DR

- ✅ ComfyUI 跑通（`http://127.0.0.1:8188`）
- ✅ OpenAI 兼容桥跑通（`http://127.0.0.1:8190`）— **SullyOS 零改动直接接**
- ✅ Pony Diffusion V6 XL 模型到位（`~/ComfyUI/models/checkpoints/ponyDiffusionV6XL_v6StartWithThisOne.safetensors`，6.46GB）
- ⚠️ **Apple Silicon 16GB + SDXL 有 known 坑**：fp16 MPS 采样 → NaN → 空白图。**必须 `--force-fp32` 启动**，但慢 23 倍（384x384 20 步 ~5-8 分钟，1024x1536 ~30-60 分钟）

## 改动 / 创建的文件

| 文件 | 说明 |
|---|---|
| `~/ComfyUI/openai_bridge.py` | FastAPI OpenAI 兼容桥（~270 行） |
| `~/ComfyUI/start_comfyui.sh` | 一键启动，**默认 `--force-fp32`**（MPS 必需） |
| `~/ComfyUI/stop_comfyui.sh` | 一键停止 |
| `~/ComfyUI/venv/` | Python 3.11.15 + torch 2.5.1 (MPS) + ComfyUI 全部依赖 + FastAPI/uvicorn/hf-transfer/huggingface_hub |
| `~/ComfyUI/models/checkpoints/ponyDiffusionV6XL_v6StartWithThisOne.safetensors` | 6.46GB SDXL 动漫风格（暮色从夸克网盘下载） |
| `~/ComfyUI/logs/` | ComfyUI / bridge / e2e test 日志 |

## SullyOS 端怎么配（不变）

设置 → API 弹窗 → 生图：
- **URL**：`http://127.0.0.1:8190/v1`
- **Key**：随便填（桥不验）
- **Model**：`ponyDiffusionV6XL_v6StartWithThisOne.safetensors`

## 端到端验证（已跑通链路，但出图需 force-fp32）

```
SullyOS 生成请求
  → http://127.0.0.1:8190/v1/images/generations  (OpenAI 桥)
  → http://127.0.0.1:8188/prompt  (ComfyUI 原生 API)
  → 加载 Pony V6 XL → 采样 → VAE decode → 返回 image URL
  → 桥把 image URL 包成 OpenAI 格式 { data: [{ url }] } 返回 SullyOS
```

测试记录：
- fp16 + euler + normal：50s 出图，**图是空的**（NaN）
- fp16 + dpmpp_2m + karras：43s 出图，**图还是空的**（NaN）— sampler 不是问题
- fp32 + dpmpp_2m + karras：~5-8 分钟出图（后台跑了 5 分钟还没出，决定收工明早继续）

**根因**：`RuntimeWarning: invalid value encountered in cast` in VAE decode。Apple Silicon MPS fp16 + SDXL 浮点溢出。

## 踩坑（重要，全是 hard lesson）

### 1. Python 3.9 不够，brew 装 3.11（5 分钟）
ComfyUI requirements 写明要 3.10+。`brew install python@3.11`。

### 2. **PyTorch 2.11 在 macOS 13 上 MPS 不工作**
默认装的 2.11，`is_available() = False`（built=True）。**降级到 2.5.1** 才行。

### 3. **av 包要 ffmpeg 系统库**
`brew install ffmpeg`（1 分钟）。

### 4. ComfyUI 自己的 pip 包要单独装
`comfy-aimdo` / `comfy-kitchen` / `comfyui-frontend-package` / `comfyui-workflow-templates` / `comfyui-embedded-docs` 等。
`pip install -r requirements.txt` 一次性跑会**超时**。按报错一个一个装。

### 5. **HF Xet 协议走梯子 0 字节**
Bakanayatsu/Pony-Diffusion-V6-XL-for-Anime 用了 Xet 存储，`hf_hub_download` + `HF_HUB_ENABLE_HF_TRANSFER=1` + 走梯子下载 = 1 分钟 0 字节。Xet 协议需要 `HF_XET_HIGH_PERFORMANCE=1` + 走 AWS CDN，国内不通。
**解决**：用网盘（夸克 / 123pan）下，macOS 直接复制到 `~/ComfyUI/models/checkpoints/`。

### 6. **Pony Diffusion 是 SDXL 架构**
不是 1.5。SDXL 模型加载 ~5GB（fp16），加 VAE + UNet + 系统 ≈ 12-14GB 内存压力。
Pony V6 XL 原作者 Bakanayatsu 团队（Pony 系官方）。`ponyDiffusionV6XL_v6StartWithThisOne.safetensors` 7.11GB（含 fp16 + 元数据，磁盘），实际加载 4.9GB。

### 7. **MPS fp16 + SDXL → NaN → 空白图**（最关键）
`RuntimeWarning: invalid value encountered in cast` in ComfyUI nodes.py:1682（VAE decode）。
试了 euler+normal 和 dpmpp_2m+karras 两个 sampler，都 NaN——**不是 sampler 问题，是 fp16 精度问题**。
**唯一稳定方案**：`--force-fp32` 启动 ComfyUI。代价：30s/it（vs 1.3s/it fp16），即 23 倍慢。模型加载从 4.9GB → 9.8GB（接近 16GB 内存上限，**32GB 才会宽松**）。

### 8. OpenAI 桥 sampler 默认改 dpmpp_2m + karras
euler+normal 在某些模型上稳，但 dpmpp_2m+karras 是 SDXL 社区共识（MPS 友好 + 收敛快）。已写进 `openai_bridge.py`。

## 后续选项（明早决定）

A. **加 Mac 内存到 32GB+** —— 唯一根治 NaN，**几千元**，但**最值得**（ComfyUI / 任何 AI 跑本地都受益）
B. **换 SD 1.5 模型**（4GB）—— 内存压力小，**可能 fp16 就稳**，但画风不是动漫，需要找动漫风 SD1.5（Counterfeit / Anything）
C. **跑云 GPU**（RunPod / Vast.ai）—— 几毛/小时 RTX 4090，需要：本地写 prompt → 上传云端 → 云端出图 → 传回本地 → 喂给小手机。比本地复杂，但便宜+能跑 Flux

**明天先验证 force-fp32 真能出图**（昨晚后台跑没等完），然后再决定。

## 备注

- 启动后服务在 8188 (ComfyUI Web UI) + 8190 (OpenAI 桥)
- 启动脚本 `~/ComfyUI/start_comfyui.sh` 已默认 force-fp32，明早起来直接 `./start_comfyui.sh` 就行
- 模型文件已落盘，下次启动自动扫描
- 全部进展已落盘到 `changelogs/2026-07-02-comfyui-local-deploy-and-openai-bridge.md`（昨天的初版）+ `changelogs/2026-07-02-pony-v6xl-deploy-and-mps-nan.md`（今天续）