# 区间查找——扫描整轮所有图片并注入 base64

**日期**：2026-09-28
**涉及 commit**：（提交后填）

## 改了什么

### 1. 手动塞图改为区间查找（`hooks/useChatAI.ts` line 1084-1133）

**之前**：只找最新一条 user 消息，是图片才 inject 一张。

**现在**：扫描"最近一条 assistant 消息之后到最新 user 消息"区间内所有 user 图片，每张独立 inject。

**区间算法**：
- `lastUserIdx` = 最新 user 消息索引（终点）
- 从 `lastUserIdx` 往前翻，第一条 assistant 消息的下一条就是 `startIdx`
- 翻到头没找到 assistant（首次对话）→ `startIdx = 0`

**区间内遍历逻辑**：role=user && type=image 才处理
- c 是图床 URL → 查临时缓存，命中就把原 URL 记进 `_tempImageCleanupKeys` 数组
- c 是 data: 开头（图床全失败时存的）→ 直接用，不查缓存
- cache miss（5 分钟过期）→ 跳过 inject，靠 chatPrompts.ts:1247 的 imageDesc 文字描述兜底

### 2. 变量重命名

`_tempImageCleanupKey: string | null` → `_tempImageCleanupKeys: string[]`

原因：区间查找后本轮可能有 N 张图都要记录，单 key 装不下。

作用域约束沿用 9-27 修复（江澈反馈 ReferenceError）：声明必须在 try 块内且不被 `{ }` 块包住。

### 3. sanity check 改为检查区间内（`hooks/useChatAI.ts` line 1244-1258）

**之前**：检查"最新 user 消息"有没有 image_url block。

**现在**：扫描区间 [最近一条 assistant 之后, fullMessages 末尾] 内所有 user 消息，统计有多少条含 image_url 块，打印总数。

**为什么**：最新 user 消息可能是文字追问，但区间内前面有图。区间查找 inject 的是前面那张图，sanity check 必须检查区间内才能验证成功。

### 4. 缓存清理策略：不在 finally 主动清（沿用 9-27 修复）

`_tempImageCleanupKeys` 数组保留作为本轮扫描记录，但 finally 块不遍历清空。

**为什么不主动清**（跟 9-27 修复同款冲突）：
- 连发图场景：图1 main request 完成时如果主动清缓存，图2 trigger 拿不到图1 的 base64，区间查找扫到图1 时 cache miss → 跳过 inject → 角色看不到图1
- 5 分钟 TTL 自动过期兜底，足够覆盖"追问"和"连发图"两种场景

### 5. 后台异步识图（finally 块 line 5044+）不动

`_fTargetImageRawMsg` 仍然找"最新一条没识过图的图片"，只对最新一张调后台识图 API 写 DB。区间查找是给主模型看的，后台识图是给下一轮降级用的，两条独立链路。

## 动了哪些文件

- `hooks/useChatAI.ts` line 1073-1138（手动塞图改为区间查找）
- `hooks/useChatAI.ts` line 1244-1262（sanity check 改为检查区间内）
- `hooks/useChatAI.ts` line 1080-1083、2025-2032（历史注释更新旧名字）
- `hooks/useChatAI.ts` line 5044+（后台识图逻辑 — **不动**）

## 踩坑 / 需要知道的（重要）

### 区间是 [startIdx, lastUserIdx]，不是 [startIdx, lastUserIdx - 1]

终点包含 lastUserIdx（最新 user 消息），区间遍历用 `i <= lastUserIdx`。

### lastUserIdx = -1 时不注入

如果 historySlice 全是 assistant 消息（理论上不可能，但防御性判断），`lastUserIdx = -1` → 区间非法 → 跳过 inject。

### startIdx 找的是区间内第一条 assistant 之后的 user 消息

不是"区间内最后一条 assistant"。具体来说：
- 找的是 `lastUserIdx` 之前、**最近的**一条 assistant 消息
- 该消息的下一条就是 startIdx
- 没找到 assistant → startIdx = 0

### 区间内不限定"必须有图片"

区间里只有文字追问也合法 — 不进 inject 循环，直接走完区间扫描。区间查找是"扫图"的逻辑，没有图就不 inject，不是 bug。

### cache miss 单独打印，不影响主请求

cache miss 时跳过 inject，但区间内其他命中 cache 的图照样注入。一张图 cache miss 不影响其他图。

### 边界情况：cleanedApiMessages[i] 越界

防御性判断 `if (base64 && i < cleanedApiMessages.length)` — 理论上 historySlice 和 cleanedApiMessages 长度一一对应（chatPrompts.buildMessageHistory 返回值保证），但加这道防御避免越界崩聊天页。

## 测试场景（暮色 9-28 18:25 要求）

| 场景 | 期望 | 验证方式 |
|---|---|---|
| 连发两张图 | 图2 主请求能拿到图2（区间 [回复1, 图2] 只含图2） | 看图2 主请求 fullMessages 是否含 image_url block |
| 发图后追问文字 | 追问不进 inject（区间无图），靠图1 imageDesc 文字描述 | 角色能正确回答关于图1 的追问 |
| 发图夹文字再发图 | 图2 主请求能拿到图2（区间 [回复, 图2] 只含图2） | 看图2 主请求 fullMessages 是否含 image_url block |
| 图床缓存过期（>5 分钟） | 跳过 inject，靠 imageDesc 文字描述 | 看 console "cache miss" 日志 |
| 图床全失败存的纯 base64 | 直接用，不查缓存，注入主请求 | 角色能看到 base64 图 |

## 备注

- 未完成项：无
- 依赖：`_tempImageCleanupKeys` 数组是给未来扩展用的（debug / 内存统计），目前 finally 不遍历清空
- 跟其他功能耦合：chatPrompts.ts:1247 的 imageDesc 降级逻辑必须正常，否则 cache miss 后角色看不到任何图的信息