# 生图 section 重构 — 删 MCD / 3 独立卡片 / 保存即用 / 测试连接

**日期**：2026-07-03
**涉及 commit**：`abdd1ea`

## TL;DR

暮色 2026-07-03 22:30 反馈上一版（commit `230fe0b`）"设计不直观"：
- 选 ComfyUI 时还要手输 URL 是反直觉的
- "两个 provider 都存怎么选"是真实问题
- 想要"在哪个页面点保存就用哪个"

## 改了什么

### 1. **删 MCD**
- `types.ts`: `imageGenProvider` 类型从 `'openai' | 'comfyui' | 'nai' | 'mcd'` 改成 `'openai' | 'comfyui' | 'nai'`
- `Settings.tsx` + `ApiQuickFloat.tsx`: 删 MCD 按钮 + 占位提示
- MCD 跟生图完全无关（是麦当劳小程序），是之前为了 4 档对称硬塞的占位

### 2. **3 个独立卡片**（不再是"切换字段"）
- **OpenAI 兼容卡片**：URL/Key/Model + 刷新列表 + [保存 OpenAI 配置]
- **ComfyUI 本地卡片**：状态条（在线/离线/未测试）+ checkpoint 列表 + [测试连接] [启用 ComfyUI 本地]
- **NAI 卡片**：纯占位说明（没有字段，没有保存按钮）

### 3. **ComfyUI 简化 — 字段全删**
- URL/Key/Model **写死到代码常量** `COMFYUI_FIXED_*`（Settings.tsx 跟 ApiQuickFloat.tsx 各一份）
- 用户不接触任何字段
- 卡片里只显示"已连接 / 默认模型 RV / 几个 checkpoint"

### 4. **"保存即用"逻辑**
- `imageGenProvider` 字段不再只是"UI 分类"——**就是当前生效的 provider**
- 切到 ComfyUI 卡片点 [启用 ComfyUI 本地] → `imageGenProvider = 'comfyui'` + 写死常量写入 imageBaseUrl/Key/Model
- 切到 OpenAI 卡片点 [保存 OpenAI 配置] → `imageGenProvider = 'openai'` + localImageUrl/Key/Model 写入
- 切到 NAI（占位）→ 没法保存（卡片里没有 [保存] 按钮）

### 5. **顶部"当前使用"状态条**
- 显示 `apiConfig.imageGenProvider` 决定的名字（"ComfyUI 本地" / "OpenAI 兼容" / "NAI（占位未生效）"）
- OpenAI 时显示当前 Model 名
- ComfyUI 时显示"默认模型：Realistic Vision V6.0 B1"

### 6. **测试连接功能**
- 新函数 `testComfyuiConnection()`：fetch `127.0.0.1:8190/v1/models`
- 显示状态：`✓ 在线 · N 个 checkpoint` / `✗ 离线 · 失败原因`
- 列出本地 checkpoint，默认 RV 用绿色高亮
- 只在 ComfyUI 卡片显示（OpenAI 用现有"刷新模型列表"已够用）

## 动了哪些文件

| 文件 | 改动 |
|---|---|
| `types.ts` | `imageGenProvider` 类型删 mcd |
| `apps/Settings.tsx` | useState 重构 / handleSaveImageApi 拆成 2 个 / 加 testComfyuiConnection / 3 个独立卡片 / 状态条 / COMFYUI_FIXED_* 常量 |
| `components/os/ApiQuickFloat.tsx` | useState 加 comfyuiTestState / handleSaveAndClose 改根据 provider 决定 / 3 卡片重构 / COMFYUI_FIXED_* 常量 |

## 踩坑 / 需要知道的

### 1. **"保存即用"在浮动弹窗的 [保存并关闭] 按钮怎么算？**
ApiQuickFloat 的 [保存并关闭] 是个**全局按钮**（在面板底部），不是卡片内独立的。我的实现：根据 `localImageGenProvider` 决定 image 字段写哪个 provider 的值。

**用户行为预期**：
- 切到 ComfyUI 卡片 → 点 [测试连接]（不点也行） → 点底部 [保存并关闭] → 启用 ComfyUI
- 切到 OpenAI 卡片 → 改字段 → 点底部 [保存并关闭] → 启用 OpenAI

如果用户没切 provider（比如一直停在 ComfyUI 但想存 OpenAI 配置），行为是"保存当前显示的 provider"——这个语义跟卡片内独立 [保存] 按钮一致。

### 2. **状态条一直显示的是 apiConfig 的值，不是 local 的**
- 顶部"当前使用：XXX" 永远反映 **已保存** 的 provider
- 如果用户切到 ComfyUI 页面但没点 [保存]，状态条**还是显示 OpenAI**（因为 apiConfig 还没变）
- 这是**有意的**——避免"切了就生效"的混淆
- 但可能导致"切了 provider 但状态条没变"的困惑，**用户要明确知道：状态条 = 已保存**

### 3. **NAI 是真占位**
- 没有 NAI 专用字段
- 想用 NAI 的实际姿势：选 OpenAI 卡片 → URL 填 `https://image.novelai.net` + NAI 自己的 Key
- NAI 卡片的存在只是为了**不让暮色忘了以后可能接**，UI 提示明确

### 4. **ComfyUI 写死后没"如果 Mac 端口变了"的退路**
- `COMFYUI_FIXED_URL = 'http://127.0.0.1:8190/v1'` 写死
- 如果暮色哪天换了 ComfyUI 桥的端口（8188→8191 之类），需要改代码常量
- 后续可改：让 ComfyUI 卡片也显示 URL 字段（但占位时是写死值）

### 5. **预设只在 OpenAI 卡片显示**
- 预设（哈基米生图 / 即享 / 柚子）只对 OpenAI 中转站有意义
- ComfyUI 写死后不需要预设
- 浮窗 + Settings 都只 OpenAI 卡片显示预设

### 6. **isPresetActive 还没修**
- 浮动弹窗的"当前预设高亮"仍只比对 URL/Key/Model
- 加了 imageGenProvider 后应该比 4 个字段
- 这次没改（影响小）

## 跟之前的设计对比

```
之前 (commit 230fe0b):
  [OpenAI 兼容 | ComfyUI 本地 | NAI | MCD]   ← 切换字段
  ↓ 选中
  [URL / Key / Model 字段]    ← 同一个输入口，切 provider = 改字段
  [保存生图配置]              ← 一次只能存一份

现在 (commit abdd1ea):
  [当前使用: ComfyUI 本地]    ← 状态条（基于已保存的）
  [OpenAI 兼容 | ComfyUI 本地 | NAI]  ← 3 档
  ↓ 选中
  OpenAI: [URL/Key/Model + 刷新 + 保存 OpenAI 配置]
  ComfyUI: [状态条 + checkpoint + 测试连接 + 启用 ComfyUI 本地]  ← 没字段，全自动
  NAI: [占位说明]              ← 没保存按钮

  "保存即用"：在哪页面点 [保存] 就用哪个
```

## 备注

- 这次改动**比上一版大很多**——生图 section 整个重写（但 UI 结构相似：保留 provider 切换 + 卡片化）
- 暮色最初想法"按 provider 页面存"被完全采纳
- 上一版 commit `230fe0b`（provider 切换 + 字段共用）实际只活了 1.5 小时，**属于"探索 → 用户反馈 → 重构"**的正常迭代
- 这次预计用户再提需求就是"测试连接按钮颜色不对"或"状态条想显示 checkpoint 缩略图"之类的细节

## 后续

- [ ] isPresetActive 加 imageGenProvider 比对（修上次留的尾巴）
- [ ] 移动端测试（Vercel 部署 → Android Chrome 打开）—— 等暮色真要用 ComfyUI 时再测
- [ ] ComfyUI 卡片加 [打开 ComfyUI Web UI] 链接（http://127.0.0.1:8188）方便调试
- [ ] "当前使用"状态条加点击直接切到对应 provider 卡片
