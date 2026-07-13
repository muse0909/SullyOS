# SullyOS vs orangechat — 工具调用对比报告

**日期**：2026-07-02  
**涉及 commit**：N/A（纯调研）  
**调研对象**：[sue1231513/orangechat](https://github.com/sue1231513/orangechat) — 橘瓣 OrangeChat，37 stars，2,458 commits，Android 原生 AI 聊天客户端（fork 自 RikkaHub）

---

## 0. 一句话总结

> **SullyOS 是"给一个角色用的工具集"，orangechat 是"给通用 AI 助手用的可扩展平台"**。
> 工具调用的核心差异不在协议（都是 OpenAI 兼容 + tool_calls），而在**谁提供工具 / 怎么扩展 / 怎么审批**这三件事上。

---

## 1. 基本信息对比

| 维度 | SullyOS | orangechat |
|---|---|---|
| 平台 | Web（React 18 + Vite + Capacitor） | Android 原生（Kotlin + Jetpack Compose） |
| 代码量级 | ~250 个 .tsx，2-3 个核心工具 | ~2500 commits，18 个内置工具 + 插件系统 |
| LLM 协议 | OpenAI 兼容 chat/completions | OpenAI / Google / Anthropic 三家 Provider |
| MCP 协议 | ❌ 不支持 | ✅ 继承自 RikkaHub，完整 MCP client |
| 工具调用实现 | 手写循环（`useChatAI.ts`） | 统一框架（`GenerationHandler` maxSteps=256） |
| 工具扩展性 | ❌ 写死在代码里 | ✅ 插件系统（QuickJS 沙箱 + manifest） |
| 用户审批（HITL） | ❌ 无 | ✅ `needsApproval` 4 状态机 |
| 命名空间 | ❌ 工具名裸用 | ✅ `plg_xxxxxxxx_toolName` 8位 hex 哈希 |

---

## 2. 工具调用的核心机制

### 2.1 SullyOS — 手写循环 + 写死工具

**入口**：`hooks/useChatAI.ts:1059-1195`

```ts
const baseReqBody: any = {
    model, messages, temperature, max_tokens: 8000, stream,
};
// 组装 tools
const toolsList: any[] = [];
if (mcdMiniOpen) toolsList.push(MCD_PROPOSE_TOOL);   // 麦当劳推荐
if (hasImageApi) toolsList.push(IMAGE_GENERATION_TOOL); // 生图
if (toolsList.length) {
    baseReqBody.tools = toolsList;
    baseReqBody.tool_choice = 'auto';
}
const data = await safeFetchJson(`${baseUrl}/chat/completions`, ...);
if (data?.choices?.[0]?.finish_reason === 'tool_calls' && ...) { ... }
```

**核心工具**（代码里写死）：
| 工具名 | 用途 | 注册位置 |
|---|---|---|
| `mcd_tools`（动态集合）| 麦当劳 MCP（菜单/下单/算价/券）| `mcdMcpClient.ts` 拉取 + `mcdToolBridge.ts` 转 OpenAI schema |
| `propose_cart_items` | 麦当劳协同推荐（不真改购物车，推卡片）| `mcdToolBridge.ts:222` |
| `generate_image` | 调用图像 API 生图 | `useChatAI.ts:1198+` |

**流式解析**：`utils/safeApi.ts:98-132` 处理 `delta.tool_calls` 累加 + `message.tool_calls` 终态。

**反馈链**：
```ts
loopMessages.push({ role: 'tool', tool_call_id: tc.id, content: '...' });
// 下一轮调 LLM 时把 tool 消息塞回 messages
```

**关键设计 — propose_cart_items UI 钩子**：
- LLM 调 `propose_cart_items` → 不真改购物车，只把推荐作为 mcd_card 卡片存到 DB
- 用户在小程序里看到"char 想加这些"卡片，自己点"+"按钮决定
- 等于**让 LLM 跟用户共享同一个 UI 状态**——单角色场景下比直接让 LLM 操作购物车更安全
- 还有自动修 code（按菜单名字模糊匹配回去），避免 LLM 把商品名当 code 传

### 2.2 orangechat — 统一框架 + 插件系统

**Tool 接口**（`ai/src/main/java/me/rerere/ai/core/Tool.kt`，**全文件只有 29 行**）：

```kotlin
data class Tool(
    val name: String,
    val description: String,
    val parameters: () -> InputSchema? = { null },
    val systemPrompt: (model: Model, messages: List<UIMessage>) -> String = { _, _ -> "" },
    val needsApproval: Boolean = false,
    val execute: suspend (JsonElement) -> List<UIMessagePart>
)
```

注意 `systemPrompt` 是 **lambda**，可以**动态根据 model + messages 生成 prompt**——这是 SullyOS 没有的能力。

**统一执行循环**（`GenerationHandler.kt:69-334`，`maxSteps = 256`）：

```
for step in 0..256:
    tools = [memoryTools, writeFilesTool, ...passedTools]
    if last message 有 pending approvals:
        break  // 等用户
    generateInternal(...)  // 调 LLM
    collect tools from last message
    for each tool:
        switch approvalState:
            Denied → 输出拒绝原因
            Answered → 输出用户答案
            Auto/Approved → execute(args)
    把执行结果写回 message parts
    emit 更新后的 messages
```

**关键设计 — needsApproval 4 状态机**：
- `Auto`：默认自动执行
- `Pending`：等用户确认（在 UI 上弹按钮）
- `Approved` / `Denied`：用户已决定
- `Answered`：用于 `ask_user` 工具，用户填完问卷

**关键设计 — Tool 命名空间**（`ToolNaming.kt`）：

```kotlin
fun buildPluginToolName(pluginId: String, toolName: String): String {
    val shortKey = String.format("%08x", pluginId.hashCode())
    return "plg_${shortKey}_$toolName"
}
```

为什么用 8 位 hex 而不是完整 pluginId：
- Anthropic / OpenAI 兼容接口对 tool name 有 **64 字符上限**
- 完整 UUID（36 字符） + 分隔符 → 原始工具名只剩 21 字符，容易超
- 8 位 hex + 分隔符 = 13 字符，给原名留 51 字符，够用

**关键设计 — 插件系统**（`PluginToolProvider.kt` + `PluginLoader.kt` + `PluginSandbox.kt`）：

```kotlin
class PluginToolProvider(private val pluginLoader: PluginLoader) {
    fun getTools(): List<Tool> = 
        pluginLoader.getAllLoadedPlugins().flatMap { plugin ->
            plugin.info.manifest.tools.map { toolDef -> 
                createTool(plugin, toolDef) 
            }
        }
}
```

工作流：
1. `PluginLoader.loadPlugin()` → 解析 manifest.json → 创建 `PluginSandbox`（QuickJS） → 评估 main.js → 缓存 exported function names
2. `PluginToolProvider.getTools()` → 聚合所有插件的工具 → 转成 `List<Tool>` 喂给 LLM
3. LLM 调 `plg_xxxxxxxx_say_hello` → `executeTool()` → `pluginLoader.callTool()` → `sandbox.callFunction()` → QuickJS 跑 main.js 里的函数 → 返回结果
4. `getPluginPromptInjections()` 注入 `<available_plugins>` 概述到 system prompt，让 LLM "知道"有插件 + **主动**用工具

**沙箱内置 API**（QuickJS）：
- `fetch(url, options)` — 同步 HTTP，15s 超时
- `config` — 用户在设置页填的配置值
- `memoryBank.recall(query, count)` — 语义搜索记忆
- `memoryBank.save(content)` / `search(keyword, type, limit)` / `delete(id)`
- `TextEncoder/TextDecoder` polyfill、`btoa/atob`、`console.log/info/warn/error`

**沙箱约束**（main.js 规则）：
- `fetch` 是同步的，不需要 await
- 不要用 async/await（沙箱会自动移除）
- 用 var 不用 let/const
- 返回值建议包含 `success` 字段

**Hook 事件系统**（`PluginLoader.callEvent`）：
- `message_sent`：用户发消息后触发
- `message_received`：收到 AI 回复后触发
- `daily_cron`：每日定时触发
- 插件可在 manifest 声明 hooks → 宿主调用 `sandbox.callFunction(hook.handler, params)`

---

## 3. 18 个内置工具对比

| 工具 | orangechat 来源 | SullyOS 有没有 |
|---|---|---|
| `eval_javascript`（QuickJS 算 JS）| RikkaHub 原版 | ❌ |
| `get_time_info`（设备时间）| RikkaHub 原版 | ❌（写在 prompt 里） |
| `clipboard_tool`（读写剪贴板）| RikkaHub 原版 | ❌ |
| `text_to_speech`（设备 TTS）| RikkaHub 原版 | ❌（TTS 走云函数） |
| `ask_user`（HITL 多轮问答）| RikkaHub 原版 | ❌ |
| `create_*/read_*/update_*/delete_*` 记忆 CRUD | RikkaHub 原版 | ⚠️ 半有（神经链接 app，不算 LLM tool） |
| `AlarmTool`（闹钟）| orangechat 新增 | ❌ |
| `AppUsageTool`（App 使用统计）| orangechat 新增 | ❌ |
| `BatteryTool`（电池）| orangechat 新增 | ❌ |
| `CalendarTool`（系统日历读写）| orangechat 新增 | ⚠️ 半有（日程 app 是 SullyOS 业务，不是 OS 日历） |
| `CameraTool`（拍照）| orangechat 新增 | ❌ |
| `ExploreNearbyTool`（高德附近搜索）| orangechat 新增 | ❌ |
| `GadgetbridgeTool`（健康数据/手环）| orangechat 新增 | ❌ |
| `MusicTool`（系统音乐控制）| orangechat 新增 | ❌ |
| `SmsTool`（短信读取）| orangechat 新增 | ❌ |
| `SystemTools`（系统信息）| orangechat 新增 | ❌ |
| `ZipFilesTool`（文件打包）| orangechat 新增 | ❌ |
| `WorkspaceTools`（文件系统）| orangechat 新增 | ❌ |
| `SkillsTools`（技能系统）| orangechat 新增 | ❌ |
| 麦当劳 MCP 7 件套（菜单/下单/算价/券…）| ❌（不可能有） | ✅ SullyOS 独有 |
| `generate_image`（生图）| ❌ | ✅ SullyOS 独有 |
| `propose_cart_items`（UI 钩子推荐）| ❌ | ✅ SullyOS 独有 |
| 写歌/日记/心声/朋友圈 等业务工具 | ❌ | ✅ SullyOS 业务化 |

---

## 4. 关键设计差异（深度）

### 4.1 工具来源

- **SullyOS**：工具是 SullyOS 自己的"业务能力"。麦当劳 MCP 是**业务合作伙伴**，生图是**业务需求**。每个工具背后对应 SullyOS 一个产品决策。
- **orangechat**：工具是**通用 AI 助手的能力**。从系统层面（剪贴板/闹钟/短信）到外部 API（高德/Gadgetbridge）都能调。强调"AI 不止活在对话框里"。

### 4.2 工具扩展

- **SullyOS**：加新工具 = 改代码 + git push + Vercel 部署。所有用户都拿同一套工具集。
- **orangechat**：加新工具 = 写一个 `manifest.json` + `main.js` → 打包成 zip → 用户在 App 内导入。**用户/第三方开发者都能扩展**，主仓库不需要改动。

### 4.3 用户审批（HITL）

- **SullyOS**：所有工具自动执行。LLM 调 `propose_cart_items` → 卡片自动出现 → 用户被动看到。LLM 调 `create-order`（麦当劳）→ 系统自己下单，**没有"先确认再下单"流程**。
- **orangechat**：`needsApproval = true` 的工具（如 `ask_user`、危险操作）会在 LLM 决定调用的瞬间**暂停循环**，emit 当前 messages → UI 弹"是否允许"按钮 → 用户点完才继续。

### 4.4 工具的 systemPrompt 注入

- **SullyOS**：主系统提示词一次性拼好。麦当劳 MCP 的工作流、propose_cart_items 的规则全写死在一段大 prompt 里（`MCD_SYSTEM_PROMPT` 113 行 + `MCD_TAIL_REMINDER`）。
- **orangechat**：**每个 Tool 有自己的 `systemPrompt` lambda**，根据 model + 当前 messages 动态生成。这让"工具集"和"角色设定"解耦：用户换个角色不需要重写工具 prompt，工具自己注入合适的说明。

### 4.5 命名空间

- **SullyOS**：工具名裸用（`query-meals` / `propose_cart_items`）。当前只有一个工具集来源，**没有冲突**。
- **orangechat**：`plg_xxxxxxxx_toolName` / `mcp_xxxxxxxx_toolName` 双前缀。**预见到了多来源（MCP server + 插件 + 内置）的重名问题**，提前解决。

### 4.6 工具循环

- **SullyOS**：手写循环。`mcd propose` 最多 3 轮（`MAX_PROPOSE_LOOPS = 3`），生图工具单独处理，**每个工具有自己的循环逻辑**，散在 `useChatAI.ts` 200+ 行里。
- **orangechat**：`maxSteps = 256` 统一框架。所有工具走同一条 loop，新增工具 = 注册 Tool 对象即可，**不用改 GenerationHandler**。

### 4.7 沙箱

- **SullyOS**：浏览器天然沙箱。工具都在 React 代码里，**没有第三方扩展**。
- **orangechat**：QuickJS 沙箱。第三方插件代码用 ES2020 JS 跑，**API 受限（同步 fetch / 禁止 await/let/const）**，跑飞了也不会把宿主 App 搞崩。

### 4.8 持久化

- **SullyOS**：工具结果存自定义 `type: 'mcd_card'` 消息，渲染成业务卡片。卡片数据全在 IndexedDB（localStorage）。
- **orangechat**：工具输出是 `UIMessagePart.Tool` 一等公民，挂在 message parts 里，结构化（`output: List<UIMessagePart>`）。UI 渲染时按 part 类型分别处理。

### 4.9 事件 hook

- **SullyOS**：❌ 没有"插件订阅事件"的概念。
- **orangechat**：`message_sent` / `message_received` / `daily_cron` 三个事件。插件可以监听 → 自动做"晚安后写日记""收到消息后存档"这种事，**不依赖 LLM 主动调工具**。

### 4.10 propose_cart_items（协同 UI 模式）

这是 SullyOS 独有的漂亮设计：
- LLM 推 1~N 个商品 → 不真改购物车 → 渲染成"+ 加进购物车"卡片
- 用户在小程序里看卡片 + 点按钮决定
- 等于**让 LLM 跟用户共享购物车 UI 状态**——LLM 提建议、用户拍板
- 比"让 LLM 直接下单"安全，比"让 LLM 用文字念商品清单"直观
- 配合 `autoFixProposalCodesByName`（按菜单名字自动修 code）解决 LLM 幻觉 productCode 的问题

orangechat 没有这种"模型用 UI 钩子推建议"的模式。

---

## 5. 暮色最该关注的 5 个差异（实用主义）

### 5.1 插件系统（**最大借鉴价值**）

**为什么值得借**：SullyOS 的工具现在写死在 `useChatAI.ts` 里，每加一个工具 = 改代码 + push + 部署。暮色以后想加"白噪音" "星座占卜" "翻译"这种小工具，每次都要走完整开发流程，**用户拿不到任何第三方扩展**。

**怎么借**：
- Vercel/Netlify 函数已经能跑 JS（云函数），但**前端也需要插件加载机制**
- 可以做轻量版：用户在 SullyOS 设置里导入一个 JSON（工具名 + 描述 + 函数代码字符串）→ 存 localStorage → 工具循环时读出来跑
- 不需要 QuickJS（浏览器天然沙箱）
- 关键约束：插件代码只能用纯 JS，**不能访问 window / document / fetch 之外的全局 API**（或者接 SullyOS 提供的 `mcdTools.*` 桥）

### 5.2 命名空间

**为什么值得借**：SullyOS 未来如果接多个 MCP server（比如：麦当劳 + 必胜客 + 瑞幸），就会出现"两家都有 `query-menu` 怎么办"的问题。

**怎么借**：
- 提前给工具名加前缀：`mcd_xxxxxxxx_query_meals` / `pizza_xxxxxxxx_query_menu`
- 不需要 8 位 hex，**SullyOS 没那么多来源**，`mcd_` / `pizza_` 这种业务前缀就够
- 或者学 orangechat 走 `mcd_xxxxxxxx_toolName` 方案，留 51 字符给原名

### 5.3 HITL 审批

**为什么值得借**：SullyOS 的麦当劳工具里 `create-order` 是**真下单**——LLM 调一下，钱就出去了。这个风险暮色自己肯定知道，但**目前没有"让用户先确认"的机制**。

**怎么借**：
- 给 `useChatAI.ts` 的 Tool 定义加 `needsApproval: boolean` 字段
- LLM 返回 tool_calls 时，**如果是 needsApproval 的工具** → 不自动执行 → 在聊天面板弹"AI 想要下单：培根安格斯厚牛堡大套餐 ×1，合计 ¥39.9，是否允许？"卡片
- 用户点"允许"→ 执行 → 把结果塞回 messages
- 用户点"拒绝"→ 把拒绝原因当 tool result 塞回 → 让 LLM 自己处理

### 5.4 maxSteps 统一框架

**为什么值得借**：SullyOS 现在 `useChatAI.ts` 有 3 套独立的工具循环逻辑（`MAX_PROPOSE_LOOPS`、`generate_image` 单独处理、未来新工具各自一套），**每加一个工具都要改这个 3200 行的文件**。

**怎么借**：
- 抽个 `runToolLoop({ baseReqBody, tools, maxSteps })` 通用函数
- 每个工具只负责"执行 args → 返回 result"，不负责"调 LLM / 拼 messages / 反馈给 LLM"
- `useChatAI.ts` 简化成"组装 tools → 调 runToolLoop → 渲染结果"

### 5.5 工具的 systemPrompt lambda

**为什么值得借**：现在 SullyOS 麦当劳的 prompt 写在 `MCD_SYSTEM_PROMPT`（113 行常量），**所有上下文（人设 + 记忆 + 工具说明）都拼在一段大字符串里**。如果以后加新工具，要么塞到主 system prompt 里（污染角色人设），要么再开一个字段（拆得更碎）。

**怎么借**：
- 给 SullyOS 的 Tool 定义加 `systemPrompt: (ctx) => string` 字段
- `useChatAI.ts` 组装 system prompt 时**遍历 tools**，把每个 tool 的 systemPrompt 拼到末尾
- 工具说明和角色人设解耦——角色人设归角色，工具归工具

---

## 6. 暮色不该照搬的 3 件事

### 6.1 QuickJS 沙箱

SullyOS 在浏览器里跑，**天然沙箱**。不需要再叠一个 QuickJS——多此一举。

### 6.2 多 Provider 抽象（OpenAI / Google / Anthropic）

SullyOS 用户用的是中转 API（worker URL `sullymeow.ccwu.cc`），**统一一个 baseUrl 就够**。给 Provider 做抽象层是过度设计。

### 6.3 18 个系统级工具（闹钟/电池/短信/音乐…）

SullyOS 是 Web 端，**很多能力拿不到**（闹钟要 OS 权限、短信要 Android 系统权限）。强行做这些工具 = 给用户画饼。

---

## 7. 总结 — 给暮色的一句话

> **工具调用的"协议层"两边几乎一样（都是 OpenAI tool_calls），真正的差异在"扩展性"和"安全性"上。**
> SullyOS 现在是"角色专用工具集"（业务工具为主），orangechat 是"通用助手平台"（系统工具 + 插件生态）。
> **值得借的 5 件事**：插件系统 / 命名空间 / HITL 审批 / 统一 maxSteps 框架 / 工具 systemPrompt 注入。
> **不该照搬的 3 件事**：QuickJS 沙箱（多此一举）/ 多 Provider 抽象（过度设计）/ 18 个系统级工具（Web 端拿不到）。

---

## 8. 文件参考

**SullyOS 关键文件**：
- `hooks/useChatAI.ts:1050-1350` — 工具循环 + propose_cart_items + generate_image
- `utils/mcdToolBridge.ts:1-66` — 麦当劳 MCP 工具桥（MCD 命名、MCD_SYSTEM_PROMPT）
- `utils/safeApi.ts:98-132` — tool_calls 流式解析
- `utils/mcdMcpClient.ts` — listMcdTools 拉取

**orangechat 关键文件**：
- `ai/src/main/java/me/rerere/ai/core/Tool.kt` — Tool 接口定义（29 行）
- `app/.../data/ai/GenerationHandler.kt:69-334` — 统一 maxSteps 循环
- `app/.../data/ai/tools/LocalTools.kt` — RikkaHub 原版 4 个工具（eval_javascript / get_time_info / clipboard / text_to_speech / ask_user）
- `app/.../data/ai/tools/ToolNaming.kt` — 命名空间方案
- `app/.../plugin/provider/PluginToolProvider.kt` — 插件工具聚合
- `app/.../plugin/loader/PluginLoader.kt` — 插件加载 + callTool dispatch
- `app/.../plugin/loader/PluginSandbox.kt` — QuickJS 沙箱（734 行）

---

## 备注
- 调研 1.5 小时，未触碰代码
- 未深入 orangechat 的 Hook 事件系统和朋友圈 Supabase 集成（与工具调用关系不大）
- orangechat 还在活跃开发（2458 commits），可能还有改动
- 若想深入某个点（插件沙箱 / MCP client / 18 个工具实现细节），告诉我具体哪个
