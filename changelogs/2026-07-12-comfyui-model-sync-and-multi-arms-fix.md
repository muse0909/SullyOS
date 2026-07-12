# ComfyUI 选 model 同步 bug + 多胳膊防御 + 短标签

**日期**：2026-07-12
**涉及 commit**：
- SullyOS: `ab575dc` (fix sync) / `da0180e` (defensive fallback) / `ed3bcaa` (model_used console.log)
- ~/ComfyUI: `a17e6ec7` (bridge prompt 注入 + 诊断)

## 改了什么

### 1. ApiQuickFloat 同步 bug（你的核心痛点）
**根因**：聊天页右上角弹的 ApiQuickFloat.tsx useEffect 漏同步 `localComfyuiSelectedModel`，弹窗打开时该 state 永远为空 → 保存时被 fallback 到 `comfyuiModelList[0]`（字母序 Pony 在 RV 前面）→ **你以为选了 RV 实际存了 Pony**。Settings.tsx 走的是另一条 useEffect（line 429 正确），所以在 Settings 选 RV 保存是从 Settings 进的工作流；聊天页生图时是从 ApiQuickFloat 进，**两个弹窗是独立的保存入口**。

**修法**：
- ApiQuickFloat useEffect 加 `setLocalComfyuiSelectedModel(apiConfig.imageModel || '')`
- 顶部状态条硬编码 "默认 RV" → 动态显示真实选中（短标签）
- Settings.tsx 顶部硬编码 "默认模型：Realistic Vision V6.0 B1" → 同样改动态
- 新增 `checkpointLabel()` helper：realistic→📷 RV · 写实 / pony→🎨 Pony · 动漫 / 其他 fallback 截 16 字
- 列表渲染、状态条、toast、"当前选" 提示全部用短标签

### 2. 防御性 fallback（避免再次静默覆盖）
- 删 `comfyuiModelList[0]` fallback（list 自动高亮第一个 = 误导用户"我选过了"）
- ApiQuickFloat 保存按钮在 ComfyUI 模式下，未选 model 或没拿到列表时 disable
- Settings.tsx 启用按钮同款 disable
- `handleSave*` 内多一道 `if (!selectedModel || !comfyuiModelList.includes(selectedModel))` 守门

### 3. Bridge prompt 注入 + 诊断
- `build_txt2img_workflow` 硬注入正向后缀：`masterpiece, best quality, detailed hands, perfect anatomy, two hands, five fingers per hand, correct body proportions, two arms`
- 扩展负向 prompt：`extra arms, extra limbs, mutated, deformed, disfigured, malformed, cloned limbs, fused fingers, too many hands, three hands, four arms, bad body, oversaturated, overexposed, hazy, foggy, washed out`
- user 已传 negative_prompt 时拼到 base 后面，不覆盖
- `_meta` 加 `model_used` + `prompt_positive_injected` + `prompt_negative_injected`
- 前端 `useChatAI.ts` `console.log('🎨 [ImageGen] 实际使用模型:', model_used)` —— **下次出图打开 DevTools console 一眼确认是 RV 还是 Pony 出的**

## 动了哪些文件
- `components/os/ApiQuickFloat.tsx` —— useEffect 同步 + checkpointLabel helper + 短标签 + 顶部状态条动态 + toast 短标签 + 列表渲染 + 保存按钮 disable
- `apps/Settings.tsx` —— checkpointLabel helper + 顶部状态条动态 + 列表渲染 + 状态消息 + 启用按钮 disable + 删 fallback
- `hooks/useChatAI.ts` —— console.log `_meta.model_used`
- `~/ComfyUI/openai_bridge.py` —— prompt 注入 + `_meta` 诊断字段

## 踩坑 / 需要知道的（重要）

### 1. 必须重启 bridge 才生效
prompt 注入在 `build_txt2img_workflow` 里（每次生图调一次），修改后**必须重启**：
```bash
~/ComfyUI/stop_comfyui.sh && ~/ComfyUI/start_comfyui.sh
# 或者
pkill -f openai_bridge.py
cd ~/ComfyUI && nohup python3 openai_bridge.py --comfyui http://127.0.0.1:8188 --port 8190 > logs/bridge.log 2>&1 &
```

### 2. ApiQuickFloat 和 Settings.tsx 是两个独立保存入口
- 聊天页右上角 WiFi 球 → ApiQuickFloat 弹窗
- Launcher → 设置 → 找到生图 section → Settings.tsx
- **两个都能保存，状态独立同步，但保存到同一个 apiConfig**
- 之前 ApiQuickFloat 不读 apiConfig，所以保存会被 fallback 静默覆盖；现在 useEffect 同步了，两边行为一致
- 提醒：以后改 apiConfig 状态时，记得两边 useEffect 都要改

### 3. 防御 disable 的边界条件
- `localComfyuiSelectedModel === ''`（用户没点过）→ disable
- `comfyuiTestState !== 'ok'`（没测过 / 测失败）→ disable
- `!comfyuiModelList.includes(localComfyuiSelectedModel)`（之前存的 model 已不在当前 ComfyUI 列表里）→ disable
- 三条任一命中即 disable。**最常见踩坑**：ComfyUI 重启后模型列表变了，之前选的 RV 可能不在了 → disable 是预期的，让用户重选

### 4. 旧存档迁移
如果 apiConfig.imageModel 里是 "old_filename.safetensors" 但新 ComfyUI 列表里没有，**会显示在已存但点不到**的状态（因为没在列表里渲染）。等用户测了连接、新列表出来后点新 model 保存即可。
不要做"自动 fallback 到第一个"，那就是这次 bug 的根因。

### 5. prompt 注入是"无脑兜底"，不是 LLM 替代
- 不改 user/LLM 写的 prompt 内容
- 只在末尾追加稳定后缀
- 旧 prompt 比新 prompt 短，新 prompt 不带负向也能被 base 兜住
- **副作用**：可能让某些已有 prompt 效果变强/变弱，**不是 bug 是预期**（用户测完反馈）

## 备注

### 1. "Pony V6 XL 是否会有多胳膊问题" → 答案：**会**
Pony 训练集在"小尺寸身体"上偏多，胳膊数量容易混乱（你昨晚那张就是 4 胳膊）。
RV 写实风，SD 1.5 底座，**手指出问题但胳膊一般不会多**。
所以你下次测试可以分别试 RV 和 Pony，看 prompt 注入后两者效果：
- RV：手指问题应改善
- Pony：4 胳膊问题应大幅改善

### 2. 风扇狂转原因
不是 bug，是物理限制。
- 16GB 跑 SDXL 6.5GB（fp16）是真的烫
- 1024x1536 大尺寸 + 25 步采样，Apple Silicon 不主动降频 → 风扇狂转
- 之前测试只跑了 1-2 张（你只看到 1 张图的耗时）现在连出多张更明显
- 长期方案：要么降尺寸到 512x768，要么升级 M2/M3 Pro 24GB

### 3. 工作区里有别处改的文件
我 commit 时发现 `context/OSContext.tsx`、`apps/WeChat.tsx`、`components/chat/ChatHeaderShell.tsx` 有别的会话/工具的改动，**没把它们带进我的 commit**。等谁改的谁自己 commit。

### 4. ComfyUI 仓库单独 commit
bridge 改动 commit 在 ~/ComfyUI 的本地 master（`a17e6ec7`），**没 push**。要不要 push 看你，upstream 是 ComfyUI 官方仓库不会接受这个文件。
