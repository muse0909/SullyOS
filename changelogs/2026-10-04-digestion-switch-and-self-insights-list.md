# 认知消化开关变总闸 + 自我领悟可看可删可改 + 上限 10 条

**日期**：2026-10-04
**涉及 commit**：（提交后补）

## 改了什么

### 1. 开关连注入一起管（暮色主要诉求）

暮色反馈：「认知消化这个有开关的呀，之前一直是关着的，但这一段还是出现在了请求体里」。

根因不是开关坏了，是**开关和注入是两扇门**：
- 开关只在 `hooks/useChatAI.ts` 的自动消化那一处被读到，管的是「要不要生成新的」；
- 两处注入点（`utils/context.ts:31` 和 `:125`）**压根没看过 `digestionEnabled`**，
  只判断「有没有存过的东西」，有就每轮全量塞进请求体。

所以关掉开关 = 不再生产新的，但已存的旧词条一条都不会少。而项目里又没有删除入口，
→ 开关名不副实，关了跟没关一样。

修法：两处注入点都加上 `digestionEnabled !== false` 判据，跟生成点用同一个门。

判据用 `!== false` 而不是 `=== true`，是为了兼容旧角色——很多老角色档案里根本没这个字段，
`undefined` 不应该被当成「关」而突然不注入了。

### 2. 自我领悟列表（可看 / 可改 / 可删）

位置：`apps/MemoryPalaceApp.tsx` 认知消化卡片内，「手动触发消化」按钮下方。

- 右上角显示 `当前条数/10`
- 每条右侧两个圆按钮：铅笔（编辑）、垃圾桶（删除）
- 编辑态是就地 textarea + 保存 / 取消两个胶囊按钮
- 空态文案：「还没有自我领悟。聊天每 50 轮自动消化一次，或点上面手动触发。」
- 开关关着时，提示语明确写「认知消化已关闭，下面这些当前不会进入对话」——
  不写清楚的话，暮色会以为列表里能看到的就等于在生效的

顺带补了 `Icon` 的 `pencil` 分支（这个组件是文件内本地定义的 SVG switch，之前没有铅笔）。

### 3. 上限 10 条，新的顶掉旧的（暮色拍板）

统一走 `utils/memoryPalace/digestion.ts` 新增的 `mergeSelfInsights(existing, incoming)`：
1. 去重（压缩空白后精确匹配，避免同一条领悟反复占额度）
2. 追加
3. 超 10 条从最旧的开始丢（FIFO）

**为什么是 FIFO 而不是按重要度留 10 条**：消化返回的是纯文本数组，没有分数可用，
要打分就得再调一次模型，成本远大于省下的那点 token。行为可预测也更重要。

两处写入都改走这一个函数（`hooks/useChatAI.ts` 自动消化 + `apps/MemoryPalaceApp.tsx` 手动触发），
不然两条路会长出两套不同的规则。

## 动了哪些文件

- `utils/context.ts` —— 两处注入点加开关判据（`buildRoleSettingsContext` + `buildCoreContext`）
- `utils/memoryPalace/digestion.ts` —— 新增 `SELF_INSIGHTS_LIMIT` / `mergeSelfInsights`
- `utils/memoryPalace/index.ts` —— 桶文件导出这两个新符号
- `hooks/useChatAI.ts` —— 自动消化写入改走 `mergeSelfInsights`
- `apps/MemoryPalaceApp.tsx` —— 手动消化改走 `mergeSelfInsights` + 自我领悟列表 UI + `pencil` 图标 + 引入 `useMemo`
- `utils/memoryPalace/digestion.selfInsights.test.ts` —— 新增 17 条
- `utils/context.selfInsights.test.ts` —— 新增 6 条

## 踩坑 / 需要知道的（重要）

- **纯聊天一起生效，不需要额外改**。`utils/chatPrompts.ts` 的纯聊天分支走的是
  `ContextBuilder.buildCoreContext`（传克隆角色），跟主聊天同一个函数。
  所以在 `context.ts` 加门 = 两种模式一起关。别再去 `chatPrompts.ts` 里加一遍。

- **`!== false` 不是 `=== true`**。用 `=== true` 会让所有没存过这个字段的老角色
  突然失去自我领悟——那是个静默的行为变更，没人能察觉。测试里专门有一条盯这个。

- **`userProfile` 是必填参数**。写 `buildCoreContext` 的测试时传 `undefined` 会直接
  崩在读 `.name` 上（不是崩在自我领悟那段）。测试里构造了一个最小 USER 对象。

- **`char` 在 MemoryPalaceApp 里可能为空**。新加的两个处理函数如果照抄 UI 里的写法会多出
  2 个类型错误，`handleDigest` 那句 `if (!char || digesting) return` 是既有惯例，
  守卫要跟它对齐。

- **历史数据不会自动瘦身**。老角色可能有超过 10 条的存量词条（比如 20 条），
  `mergeSelfInsights` 只在**下次消化写入时**才截断，不会主动去改已经存好的数据。
  现在有了列表，暮色可以自己删到 10 条以内。如果想让上限立刻生效，得在列表里手动删——
  这是刻意的：不静默丢用户已有数据。

- **关掉开关后词条还留着**，只是不进请求体。重新打开开关，它们会原样回来。
  这是「暂停」不是「清空」，UI 文案按这个语义写的。

## 验证

- `npx tsc --noEmit`：381（与基线一致）
- `npm run build`：通过
- 新增 23 条测试全过
- 全量 vitest：479 通过 / 15 失败（基线 456/15，多的正好是新增 23 条，失败数未增加）
  15 个失败是三策略语义变更留下的历史问题，跟本次无关

## 备注

- 见面 app 那个自动消化不写回的问题，暮色已明确说不用管。
- 未提交前 master 未动。
