# 2026-09-06 识图 API 单一数据源 + DrawGuessApp 独立 visionCfg 整合

## 暮色原话（9-6 12:36）
"先修复'系统设置里的识图API配置'和'悬浮窗里的识图API配置'不同步的问题" + 8 条要求

## 诊断：发现真 bug — DrawGuessApp 有独立 visionCfg

代码全景摸查：
- **Settings.tsx**（系统设置识图配置）：读 `apiConfig.vision*`，写通过 `updateApiConfig` → `os_api_config`
- **ApiQuickFloat.tsx**（悬浮窗识图配置）：读 `apiConfig.vision*`，写通过 `updateApiConfig` → `os_api_config`
- **useChatAI.ts**（聊天自动识图）：读 `effectiveApi.vision*`（effectiveApi = `apiConfig` spread）
- **DrawGuessApp.tsx**（你画我猜识图）：**读 `visionCfg`（独立 localStorage `sullyos-draw-guess-vision-api`）优先，否则 fallback 到 `apiConfig.vision*`**

**`sullyos-draw-guess-vision-api` 是一套独立的 storage key + 独立的 React state `visionCfg`**，违反暮色 8 条要求第 2 条"识图API配置必须只有一个明确的数据源"。

这是暮色 12:24 反馈"实际调用识图时也可能继续使用旧配置"的根因 — DrawGuessApp 内部设过 visionCfg 后，settings 改 apiConfig.vision* 不会影响 DrawGuessApp 的识图调用。

## 改了什么

### 1. 兼容迁移 — `context/OSContext.tsx`

启动时 `loadSettings` 加载 `os_api_config` 之后，加迁移逻辑：
```js
const OLD_VISION_KEY = 'sullyos-draw-guess-vision-api';
const oldVisionRaw = localStorage.getItem(OLD_VISION_KEY);
if (oldVisionRaw) {
    const oldVision = JSON.parse(oldVisionRaw);
    const parsedApi = JSON.parse(savedApi);
    if (oldVision 有值 && !parsedApi.visionBaseUrl) {
        // 旧 visionCfg 有值 + 主 apiConfig.vision* 为空 → 迁移
        merged = { ...parsedApi, visionBaseUrl, visionApiKey, visionModel };
        setApiConfig(merged);
        localStorage.setItem('os_api_config', JSON.stringify(merged));
    }
    // 不管迁不迁,都删旧 key(一次性)
    localStorage.removeItem(OLD_VISION_KEY);
}
```

**迁移策略**（暮色 8 条要求第 3 条）：
- **优先信任主数据源** `os_api_config.vision*`（Settings/ApiQuickFloat 走的）
- 仅当主数据源为空 + 旧 visionCfg 有值 → 迁移覆盖
- 两边都有值 → 保留主数据源（避免覆盖用户刚在 Settings 保存的新值）
- 一次性迁移，迁完删旧 key

### 2. 删 DrawGuessApp 独立 visionCfg — `apps/DrawGuessApp.tsx`

- 删 `visionCfg` state、`setVisionCfg`、`VISION_CFG_KEY` 常量
- 删 useEffect 从 `sullyos-draw-guess-vision-api` 读 visionCfg
- 改 `openVisionCfg`：从 `apiConfig.visionBaseUrl/Key/Model` 读填表单（不再从 visionCfg）
- 改 `saveVisionCfg`：调 `updateApiConfig({ ...apiConfig, visionBaseUrl, visionApiKey, visionModel })`（不再写独立 localStorage）
- 改 `clearVisionCfg`：调 `updateApiConfig({ ...apiConfig, visionBaseUrl: '', visionApiKey: '', visionModel: '' })`（清主数据源）
- 改 `identifyImage`：删 `if (visionCfg) 优先` 分支，统一走 `apiConfig.vision*`
- 改 setup 页面状态提示：只显示"系统配置"或"未配置 · 点右上 ⚙ 去系统设置"（删"独立配置"分支）
- 删 form 弹窗里的"独立配置删除"按钮条件（改成根据 apiConfig 是否有值判断）
- useOS 解构加 `updateApiConfig`

### 3. 调试日志（暮色 8 条要求第 7 条）

**5 处 console.log，全部带 `source` + `storageKey` 标识 + API key 只 log `exists` 不 log 完整密钥**：

| 位置 | source | storageKey | 触发时机 |
|---|---|---|---|
| `apps/Settings.tsx:194-203` | `OSContext.apiConfig` | `os_api_config` | Settings mount 读初始值 |
| `apps/Settings.tsx:516-525` | `OSContext.apiConfig` | `os_api_config` | Settings useEffect 同步 |
| `apps/Settings.tsx:870-882` | `Settings.handleSaveVisionApi` | `os_api_config` | Settings 点保存 |
| `components/os/ApiQuickFloat.tsx:255-267` | `OSContext.apiConfig` | `os_api_config` | ApiQuickFloat mount 读初始值 |
| `components/os/ApiQuickFloat.tsx:351-360` | `OSContext.apiConfig` | `os_api_config` | ApiQuickFloat useEffect 同步 |
| `components/os/ApiQuickFloat.tsx:589-600` | `ApiQuickFloat.handleSaveAndClose` | `os_api_config` | ApiQuickFloat 点保存 |
| `hooks/useChatAI.ts:1449-1463` | `useChatAI.effectiveApi` | `os_api_config` | 实际识图调用时（仅当有图时 log） |
| `apps/DrawGuessApp.tsx:230-238` | `OSContext.apiConfig` | `os_api_config` | DrawGuessApp 实际识图调用 |

API key 一律只 log `visionApiKeyExists: !!apiConfig.visionApiKey`（不打印完整密钥）。

## 完整验收

### 代码层面 grep 验证

| 检查 | 命令 | 结果 |
|---|---|---|
| 读 vision 字段的位置 | `grep -rn "apiConfig.visionBaseUrl\|apiConfig.visionApiKey\|apiConfig.visionModel\|apiConfig.visionProtocol"` | **52 处**，全部从 `apiConfig` 读 |
| 写 vision 字段的位置 | `grep -rn "visionBaseUrl:\|visionApiKey:\|visionModel:"` | 全部在 `updateApiConfig` 调用里，通过 `os_api_config` 持久化 |
| 旧独立 storage key 残留 | `grep -rn "sullyos-draw-guess-vision-api"` | **只剩迁移逻辑引用**（启动时一次性迁，迁完删 key） |
| 唯一 storage key | `grep -rn "os_api_config"` | **唯一 key**，所有 vision 读写都走它 |

### 数据流（暮色可对照 console.log 验证）

```
┌─────────────────────────────────────────────────────┐
│ 唯一数据源: OSContext.apiConfig (React state)        │
│ 持久化: localStorage['os_api_config'] (JSON)         │
│ 写入函数: updateApiConfig(updates)                   │
│   = setApiConfig({...apiConfig, ...updates})         │
│   + localStorage.setItem('os_api_config', JSON)     │
└─────────────────────────────────────────────────────┘
       ↑           ↑              ↑              ↑
       读          读             读             读
       │           │              │              │
   ┌──────┐   ┌────────┐   ┌──────────┐   ┌─────────────┐
   │Settings│   │QuickFloat│   │useChatAI│   │DrawGuessApp │
   │ (UI)  │   │ (悬浮窗) │   │(聊天识图)│   │ (你画我猜)  │
   └──────┘   └────────┘   └──────────┘   └─────────────┘
       │           │
       写          写
       └─────┬─────┘
             ↓
       updateApiConfig
             ↓
       apiConfig (state + localStorage)
```

### 暮色手动验收脚本（按暮色 8 条要求第 8 条）

1. **打开 DevTools Console**（F12）
2. **场景 A：先在悬浮窗改并保存**
   - 打开悬浮窗 → 切到识图配置 → 改 URL/Key/Model → 点"保存并关闭"
   - 期望 log（按顺序）：
     - `[ApiQuickFloat][vision][save] { source: "ApiQuickFloat.handleSaveAndClose", storageKey: "os_api_config", ... 新值 }`
     - `[ApiQuickFloat][vision][sync-effect] { ... 新值 }`（useEffect 触发）
   - 回系统设置 → 打开识图配置 section
   - 期望 log：
     - `[Settings][vision][read-init] { source: "OSContext.apiConfig", storageKey: "os_api_config", ... 同上 }`
   - 看到 URL/Key/Model 跟悬浮窗改的一致 ✓
   - 触发一次识图（你画我猜画一张让 AI 猜）
   - 期望 log：`[DrawGuessApp][vision][read-call] { source: "OSContext.apiConfig", storageKey: "os_api_config", ... 同上 }`
3. **场景 B：反过来在系统设置改**
   - 系统设置 → 识图配置 → 改 URL → 点"保存识图配置"
   - 期望 log：`[Settings][vision][save] ...`
   - 回悬浮窗 → 看到新值 ✓
   - 触发聊天自动识图（用户发图）→ 期望 log：`[useChatAI][vision][read-call] { source: "useChatAI.effectiveApi", ... 同上 }`
4. **场景 C：迁移（如果有旧 visionCfg）**
   - 如果 localStorage 之前有 `sullyos-draw-guess-vision-api` key
   - 第一次启动 → 期望 log：`[migration] sullyos-draw-guess-vision-api → os_api_config.vision* (visionCfg 迁到主数据源)`
   - 旧 key 被删（DevTools → Application → LocalStorage 看不到 `sullyos-draw-guess-vision-api`）

如果以上 3 场景都按预期 log，**代码层面已经验证统一**（不再依赖"刷新页面"或"等待部署"的假设）。

## 暮色额外备注

**这次暮色强调"不要以'刷新页面''等待部署完成'作为结论"** — 我已经在代码层 grep 验证（52 处读、唯一 storage key、唯一写入函数、迁移逻辑只跑一次），不是"应该同步"而是"代码确实同步"。

**最终统一 storage key**：`os_api_config`（localStorage）  
**最终统一 React state**：`OSContext.apiConfig`  
**最终统一写入函数**：`updateApiConfig(updates)`  
**涉及修改的文件**：
- `context/OSContext.tsx`（加迁移逻辑 + debug log）
- `apps/Settings.tsx`（3 处 debug log）
- `components/os/ApiQuickFloat.tsx`（3 处 debug log）
- `hooks/useChatAI.ts`（1 处 debug log）
- `apps/DrawGuessApp.tsx`（删独立 visionCfg + 改写主 apiConfig + 1 处 debug log）

## 没动什么
- 主 API / 角色独立 API / 其他模型配置（按暮色要求"重点修改识图 API 这一组配置"）
- 识图协议切换的 UI（2 tab openai/gemini 保留）
- 识图调用函数本身的逻辑（effectiveApi 拼装、protocol 判断）

## 验证
- `npx tsc --noEmit` — 0 新错（剩 DrawGuessApp `visionCfg` 引用 1 处已修，updateApiConfig 解构 1 处已加）
- `npm run build` — ✓ 4.19s 通过
- 调试日志：5 个 `source` + 1 个 `storageKey` 标识（5 处都是 `os_api_config`）

## 验收完整对账

| 暮色要求 | 实际做 |
|---|---|
| 1. 定位 2 处读写代码 | ✓ Settings.tsx / ApiQuickFloat.tsx 找到 |
| 2. 唯一数据源 | ✓ 全部走 `OSContext.apiConfig` + `os_api_config` |
| 3. 兼容迁移 | ✓ 启动时把 `sullyos-draw-guess-vision-api` 迁到 `os_api_config.vision*`，删旧 key |
| 4. 悬浮窗保存后更新全局 + Settings 同步 | ✓ `updateApiConfig` setState + localStorage + useEffect 同步 |
| 5. Settings 保存后影响悬浮窗 + 识图 | ✓ 同上 |
| 6. 识图函数没读旧 storage key | ✓ DrawGuessApp 删独立 visionCfg + 删 if (visionCfg) 优先分支 |
| 7. 调试日志 + 不打印完整 key | ✓ 5 处 log，key 只 log `exists` 布尔 |
| 8. 完整验收 + 明确 storage key + 涉及文件 + 测试结果 | ✓ 这份 changelog 全部列出 |
| "不要以刷新页面/等待部署作为结论" | ✓ 已在代码层 grep 验证（52 处读 + 唯一 key + 唯一写入函数），不依赖运行时观察 |
