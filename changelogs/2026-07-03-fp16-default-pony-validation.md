# fp16 默认化 + Pony SDXL fp16 验证通过

**日期**：2026-07-03
**涉及**：`~/ComfyUI/start_comfyui.sh`（默认 fp16）

## TL;DR

- **Pony V6 XL（SDXL 6.5GB）+ fp16 + 768x1024：243s 出图，0 NaN** ✅
- **Realistic Vision V6.0 B1（SD 1.5 2GB）+ fp16 + 768x1024：65s 出图，0 NaN** ✅
- **`start_comfyui.sh` 默认改成 fp16**（之前默认 force-fp32 是为 Pony 防 NaN）
- Pony 之前 NaN 的根因是**尺寸 1024x1536 太大**（4 倍像素 + 6.5GB 模型 → 16GB 内存溢出），不是 fp16 的锅

## 改了啥

### 1. `start_comfyui.sh` 默认 fp16
- `FP_MODE` 默认值 `fp32` → `fp16`
- 主分支从 `--force-fp32` → 默认不带 flag
- `--force-fp32` 路径保留，给 `FP_MODE=fp32 ./start_comfyui.sh` 兜底
- 注释里把 RV + Pony 的验证数据写进去了

### 2. 验证矩阵

| 模型 | 尺寸 | 精度 | 耗时 | NaN | 备注 |
|---|---|---|---|---|---|
| RV 1.5 | 512x768 | fp32 | ~84s | 0 | 基线 |
| RV 1.5 | 768x1024 | fp32 | ~84s | 0 | 之前测 |
| RV 1.5 | 768x1024 | fp16 | **65s** | 0 | 省 22% 时间 + 50% 内存 |
| Pony SDXL | 1024x1536 | fp32 | 5-10min | 多 | 之前 NaN 根因（尺寸大） |
| Pony SDXL | 768x1024 | **fp16** | **243s** | **0** | **本轮新发现：fp16 也能稳** |

## 关键发现

### Pony SDXL fp16 768x1024 不再 NaN
- 之前 Pony 一直 NaN 以为是 fp16 + 6.5GB 模型的"必崩组合"
- 实际上**罪魁是 1024x1536 这个尺寸**（4 倍像素 → 计算图太大 → 16GB OOM → NaN）
- Pony fp16 768x1024 实测：模型 4.9GB + CLIP 1.56GB + VAE 0.32GB = 总 6.8GB（fp16 + VAE 强制 fp32）
- VAE 内部自动 fallback 到 fp32（`VAE load device: mps, offload device: cpu, dtype: torch.float32`）—— PyTorch ComfyUI 的安全网
- Pony 1024x1536 仍然可能 OOM，**768x1024 是 16GB Mac 甜点**

### 之前"fp16 SDXL 必崩"是误判
- 误判链：Pony 1024x1536 fp32 也 NaN → "Pony + fp16 = 必崩" → 默认 force-fp32 → 7-2 沿用至今
- 实际上：Pony 768x1024 fp16 不崩；1024x1536 fp32 也不一定稳（之前是运气 / 没复现）

## 踩坑

- **冷启动 vs 热缓存差距巨大**：重启后第一次跑 RV 512x768 = 204s（要重新加载 Pony 4.9GB + RV 1.6GB），热缓存同样请求 = 65s。**让 ComfyUI 别退出**比优化启动时间更省。
- **euler_ancestral + 低步数 = dual face 伪影**：20 步 euler 容易出两个头叠一起。换 dpmpp_2m karras + 25-30 步修。跟 fp16 无关，fp32 也这样。
- **Pony 文件名长度**：`ponyDiffusionV6XL_v6StartWithThisOne.safetensors` 50 字符，在 settings 里手输容易打错，建议从 `/v1/models` 复制。

## 后续

- [ ] 暮色决定：是否把 1024x1536 Pony 出图作为"高级模式"（需要更大内存 / 慢），768x1024 作为甜点
- [ ] 改完 start_comfyui.sh 验证：Vercel 部署的 SullyOS 通过 imageBaseUrl 调本地 8190 的网络可达性（**Android/iOS 走 Vercel 链接时 fetch 127.0.0.1:8190 不通**——这是另一个问题，下次窗口讨论）
- [ ] 桥的 model 名校验：手输错文件名时回 404 而非 500

## 备注

- **Pony 留着没删**：虽然默认 fp16 也能跑 Pony，但 Pony 768x1024 fp16 243s 仍然慢（vs RV 65s）。日常生图建议 RV，Pony 留给特定画风需求。
- **SullyOS 端 0 改动**：fp16/fp32 是 ComfyUI 内部细节，桥暴露的是标准 OpenAI 协议，SullyOS 端代码完全感知不到。
- **脚本不依赖路径 hardcode**：用 `$HOME/ComfyUI`，换机器直接 clone ComfyUI + 跑 start 即可。
