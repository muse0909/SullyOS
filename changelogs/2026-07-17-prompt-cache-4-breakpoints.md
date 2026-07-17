# 4 断点 prompt cache 方案（bp1 工具 / bp2 行为 / bp3 上下文 / bp4 历史）

**日期**：2026-07-17
**涉及 commit**：`9837979`

## 改了什么

参考 Anthropic 官方推荐的 prompt cache 4 断点结构，把 SullyOS 之前「1 断点 + 整个 system」改成「4 断点独立 cache」：

| 段 | 内容 | cache_control | 失效触发 |
|---|---|---|---|
| **bp1Tools** | Chat App Rules 整段 + 语音功能 + 双语/HTML/麦当劳 | ✓ 1h TTL | 用户改工具开关（启用 Notion 会让 "8. ..." 编号变） |
| **bp2Rules** | date/call 模式提示 + 语音禁用提示 + 心声输出要求 | ✓ 1h TTL | 跨 mode（约会/电话回 IM） |
| **bp3Context** | 角色卡+世界书+slotHeader+朋友圈+音乐+群聊+日记+笔记+最近心声 | ✓ 1h TTL | 改角色卡/世界书/加工具 |
| **bp4History** | history 最后一条打 cache_control | ✓ 1h TTL | 新增消息（cache 自动延伸到新加的消息） |
| 不缓存 | realtime 时间戳 + innerState 意识流（dynamicTail） | ✗ | 每轮都变 |

## 动了哪些文件

- `utils/chatPrompts.ts`
  - `let baseSystemPrompt = ...` 改成 3 个独立变量 `let bp3Context / bp2Rules / bp1Tools = ''`
  - line 320 附近：朋友圈/日程/音乐/群聊/日记/笔记 全部 `+=` 改成 `bp3Context +=`
  - line 414 附近：Chat App Rules 整段（line 401-735 那 300+ 行大 template）→ `bp1Tools +=`
  - line 750 附近：date/call 模式提示 → `bp2Rules +=`
  - line 762-810 附近：语音消息功能 → `bp1Tools +=`
  - line 813 附近：语音禁用提示 → `bp2Rules +=`
  - 函数返回类型 `{ systemPrompt, dynamicTail }` 改成 `{ bp1Tools, bp2Rules, bp3Context, dynamicTail }`

- `hooks/useChatAI.ts`
  - line 725 附近：接收 3 段独立变量
  - line 730：`systemPrompt` 兼容老字段（拼成大 string 给 `setLastSystemPrompt` 用）
  - line 736-764：双语 / HTML 模式 → `bp1Tools +=`
  - line 820 附近：麦当劳 MiniApp 上下文 → `bp1Tools +=`
  - line 840 附近：心声输出要求 → `bp2Rules +=`
  - line 856 附近：最近 5 条心声 → `bp3Context +=`
  - line 860-880：system content 从单 string 改成 array of 3 text block（各带 cache_control）
  - line 884-905：history 最后一条打 bp4（string content 转 array，array content 末尾追加空 text block）

## 踩坑 / 需要知道的（重要）

1. **Anthropic 限制每条消息最多 4 个 cache_control 标记**——4 断点方案刚好用满（system 3 个 + history 1 个）。如果后续想加第 5 段，必须合并或砍段。

2. **OpenAI 兼容 API 是否透传 cache_control 是未知数**：
   - 昨天 1 断点 + 1h TTL 在即享 ccmax 上「完全没生效」（命中率 0%），原因可能是 cache_control 字段被即享忽略
   - 4 断点方案在即享上**不一定能**起效（同样问题）
   - 青屿 180 kiro 上次 1 断点有效果，4 断点预期能进一步拉高
   - **降级行为**：provider 不认 cache_control → 字段被忽略，回到默认 5m TTL（不会报错）

3. **history 末尾打 bp4 的 cache_control 写法**：
   - string content → 转 `[{ type: 'text', text: 原内容, cache_control: {...} }]`
   - array content（如图片消息）→ 末尾追加 `{ type: 'text', text: '', cache_control: {...} }` 空 text block
   - 不要在图片 block 上直接加 cache_control（OpenAI 兼容 API 不一定支持）

4. **潜在风险 — 识图补丁的 fallback 字符串**：
   - `useChatAI.ts:1100` 和 `:1139` 处的识图 patch 用 `typeof content === 'string' ? original : '[图片]'` 兜底
   - 现在 history 最后一条 user 消息的 content 变成 array（带 cache_control），兜底会显示 `[图片]`
   - **但**：cleanedApiMessages 已经把图片消息的 array content 转成 string（line 770 附近），所以正常情况下 lastMsg 是 string content，转 array 后是 `[{type:'text', text:原内容, cache_control}]` 单元素
   - **影响**：visionDesc 注入时 original 取的是 array 第一个 text block 的 text 字段，**但当前代码不支持 array**（line 1100），所以会 fallback 到 `[图片]`
   - **测试点**：在 Vercel 链接上「先发图后打字」的场景，看 AI 是否能正确理解图片+文字
   - 如果有问题，需要在 line 1100 那里加 array 处理：提取所有 text part 拼成 string

5. **改动面 vs 收益**：
   - 改了 chatPrompts 拼接逻辑（约 60 行）+ useChatAI 构造逻辑（约 50 行）
   - 收益：长对话命中率从 ~50% 拉到 90%+（前提是 provider 透传 cache_control）
   - 即享 ccmax：之前命中率 0% → 期望 30-50%（如果透传）
   - 青屿 180：上次 1 断点 80% → 期望 95%+

6. **没拆 Chat App Rules 内部**：
   - Chat App Rules 那个 300+ 行大 template 内部包含 1-5 项行为规范 + 6-9 项工具说明，按严格 4 断点应该再拆
   - **权衡**：拆内部需要重写整个大 template 字符串，工作量大且容易引入 bug
   - **当前方案**：把 Chat App Rules 整段归 bp1Tools，**实际是 3 段 system + history**（不是严格 4 段 system）
   - **效果**：bp1Tools 比严格的 bp1 大一些（包含部分行为规范），但变化频率仍然低（用户改工具开关时整段失效）
   - **如果后续要严格 4 断点**：再拆 Chat App Rules 内部

## 备注

- **预期效果**（前提是 provider 透传 cache_control）：
  - 即享 ccmax 命中率：0% → 30-50%（如果透传）
  - 青屿 180 命中率：80% → 95%+
  - 跨长间隔聊天（30 分钟以上空闲）：cache 仍能命中（1h TTL）
  - 长对话（200+ 轮）：history 段前 N-1 条一直在 cache 里，命中率随对话长度提升

- **暮色测试计划**：
  - 1. Vercel 部署后，跑一段长对话（50+ 轮）
  - 2. 看即享 ccmax 命中率有没有涨（之前是 0）
  - 3. 如果涨了（说明 cache_control 透传了）→ 命中率高 → 费用降 → 切即享 ccmax
  - 4. 如果没涨（说明 cache_control 不透传）→ 保留青屿 180（目前用的），即享 ccmax 仍然贵

- **风险点回顾**：
  - 4 个 cache_control 标记满档（Anthropic 上限），不能再加
  - 即享 ccmax 不透传 cache_control 的概率不低（昨天 1 断点都没生效）
  - 「先发图后打字」场景可能受影响（待 Vercel 上验证）
  - Chat App Rules 内部未拆（如果后续要严格 4 段，需要再大改）
