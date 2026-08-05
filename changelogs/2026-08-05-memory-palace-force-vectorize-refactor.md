# 记忆宫殿一键向量化重构（callLLM 超时 / JSON 兜底 / 统一入口 / 5 轮 / 删立即追平 / 清空弹窗升级）

**日期**：2026-08-05
**涉及 commit**：`dbf7f93`

## 改了什么

暮色今天反馈"打补丁越来越乱，需要停下来梳理整个程序不合理的地方"。我跟他对齐了方案，做了**6 个改动**——**先不动代码**对齐了产品决策，再一次性重构，不是 6 个独立补丁。

### 产品决策（暮色 2026-08-05 16:56 拍板）

- 跑 5 轮 / callLLM 加 60s 硬超时 / JSON 解析加固 / 删"立即追平"按钮 / 路 1+3 分开
- **路 1** = 一键向量化按一次跑 5 轮（不是 17 轮）
- **路 3** = 清空安全确认升级成 Modal（保留"仅删已处理"逻辑）

### 1. callLLM 加 60s 硬超时（防 LLM stall 卡死处理锁）

`utils/memoryPalace/llmCall.ts`：
- 抽公共 helper `fetchWithTimeout(url, init, timeoutMs, protocolLabel)`
- 3 个协议 fetch（OpenAI / Claude / Gemini）全用它
- AbortController + 60s 硬超时
- 之前是裸 fetch，LLM 端 stall（502/524/网络黑洞）→ fetch 永远不返回 → processingLocks 永远不释放 → 下次同角色再点立刻拿到 'lock' 跳过
- 用户表现"立即追平好像没反应"，其实是上一次自己卡死的请求挡了
- 60s 是经验值：单次 LLM 提取正常 5-15s，留 4x 余量

### 2. jsonUtils.ts 加固剥 markdown（防 LLM 返回 markdown 包裹导致 0 条记忆）

`utils/memoryPalace/jsonUtils.ts`：
- 之前只剥 ```json 和 ``` 两个 tag，但 LLM 经常输出独立 ``` 行（```json\n[...]\n``` 这种）
- 改成**按行扫**：所有 ```xxx 整行删 + 所有孤立 ``` 整行删
- 单向收紧：之前能解析的格式还能解析，之前解析失败的现在大概率能解析
- 不动 salvageObjects / fixBrokenJson 等其他逻辑

### 3. 新建 forceVectorize.ts 统一入口（合并入口 1 + 入口 2）

`utils/memoryPalace/forceVectorize.ts`（新文件，225 行）：
- 之前两个独立实现：
  - `apps/Chat.tsx::handleForceVectorize`（聊天设置抽屉里"一键向量化所有"）
  - `apps/MemoryPalaceApp.tsx::runAutoArchiveCatchUp`（记忆宫殿"立即追平历史"）
- 两个逻辑几乎一样（BATCH_SIZE 170、MAX_ROUNDS 50、force=true、isMessageSemanticallyRelevant）但累计方式 / 错误提示 / 进度显示不同步
- 典型的"抄两遍"导致的不一致
- 统一成一个函数 `runForceVectorizeForChar(params)`：
  - 5 轮限制（暮色拍板，1-2 分钟内可跑完）
  - 真处理条数累计（autoArchive.hideBeforeMessageId - hwm）
  - 不依赖 OSContext（纯函数式，UI 层负责写回 char.memories）
  - onProgress 回调给 UI 自己决定怎么显示

### 4. Chat.tsx handleForceVectorize 用统一函数 + 5 轮

`apps/Chat.tsx`：
- 90 行手写循环（之前是 3 个独立循环 + 累计 + 写回）
- 改成调 `runForceVectorizeForChar({ maxRounds: 5, ... })`
- 写回 char.memories 仍在 UI 层做（仅在 char.autoArchiveEnabled 时）
- toast 反馈清晰化：✅ 全部搞定 / ⚠️ 还剩 N 条再点 / ❌ 失败原因

### 5. 删入口 2 按钮（记忆宫殿"立即追平历史"）

`apps/MemoryPalaceApp.tsx`：
- 删 `runAutoArchiveCatchUp` 函数（68 行）
- 删 `autoArchiveConfirm` / `autoArchiveSyncingId` / `autoArchiveSyncProgress` state
- 删 autoArchiveConfirm 弹窗 UI（约 130 行）
- 改 `handleToggleAutoArchiveFromPicker`：不再弹窗，**toast 提示"去聊天设置 → 一键向量化"**
- 角色卡片"全自动记忆"开关里"syncing"状态文案简化为静态"自动归档 · 推水位线 · 隐藏已总结"
- grep 验证：所有引用（state / 函数 / 弹窗）全删干净（剩下的都是注释）

### 6. 清空逻辑（路 3 弹窗）升级成 Modal

`apps/Chat.tsx`：
- 之前用浏览器原生 `confirm()` 弹窗（丑）
- 现在用项目级 `Modal` 组件（zIndex=210 盖过 ChatSettingsDrawer 的 z-[200]）
- 2 按钮：「仅删已处理」+「取消」
- 弹窗内容清晰：未向量化条数 + 解释 + 3 个选项说明
- 抽 `handleConfirmClearPartial` 函数（Modal "确定" 调它）
- filter 改 `isMessageSemanticallyRelevant`（跟新统一入口一致，"还有 N 条"两个数对得上）

## 动了哪些文件

| 文件 | 改动 |
|---|---|
| `utils/memoryPalace/llmCall.ts` | 抽 fetchWithTimeout + 3 协议 60s 硬超时 |
| `utils/memoryPalace/jsonUtils.ts` | 加固剥 markdown（按行扫 ```xxx 行） |
| `utils/memoryPalace/forceVectorize.ts` | **新建** — 统一入口 |
| `apps/Chat.tsx` | handleForceVectorize 用统一函数 + 5 轮 + 清空 Modal 升级 |
| `apps/MemoryPalaceApp.tsx` | 删 runAutoArchiveCatchUp + 弹窗 + state |

## 踩坑 / 需要知道的

- **callLLM timeout 是 60s 单次**，不是整个 pipeline 的总超时。如果 LLM 端正常但 maxTokens 触发输出截断，callLLM 会等 60s 才超时。
- **forceVectorize.ts 不依赖 OSContext**（纯函数式），写回 char 由 UI 层（Chat.tsx）负责。**好处**：未来记忆宫殿 + 见面 app 都可以共用这个函数。
- **入口 2 删得干净**：grep 验证没有死引用。如果之后看到 "autoArchiveConfirm" 还在运行时报错，那是我漏删了。
- **清空 Modal zIndex=210**：必须比 ChatSettingsDrawer 的 z-[200] 大才能盖过。`Modal` 组件支持 zIndex prop。
- **5 轮是按"按钮点击一次"算**，不是"5 分钟"。如果中间有 stall（被 60s timeout 拦下），实际跑的时间可能接近 5 分钟。但用户能接受——比之前"按 17 次"强。

## 暮色强调的"改 A 不要退 B"我做了

- 改之前 grep 验证所有引用点（删 runAutoArchiveCatchUp 前 grep 全仓）
- 改之后 build 通过 + grep 验证没有死引用
- 不引入新概念（不抽"事件总线" / 不加 "useRunForceVectorize" hook 这种"假抽象"）
- 6 个改动一次性 commit（一个 refactor，不分散成 6 个 commit）

## 备注

- **部署后**暮色需要测：
  1. 聊天设置 → 一键向量化所有 → 看 toast 是不是 5 轮 + 真实条数（不是 170 这种假的）
  2. JSON 解析加固是否生效（之前 0 条记忆的情况应该变成 4+ 条）
  3. 记忆宫殿开全自动记忆时弹的 toast（不是弹窗）是不是说"去聊天设置 → 一键向量化"
  4. 清空时如果有未向量化的，弹窗是 Modal（不是浏览器原生 confirm）
  5. LLM stall 60s 后是否正确释放锁（看下次点立即追平能不能立刻跑，不卡在"已有任务在运行"）
- **未完成**：暮色 8-5 14:11 提的"主动消息 history 瘦身"先暂放（架构层面再议，不打补丁）
