# 见面 app：思维链嵌进消息气泡内部 + 强制中文 thinking

**日期**：2026-08-03
**涉及 commit**：`待提交`

## 改了什么

### 1. 思维链嵌进最后一条 AI 消息气泡内部（暮色反馈）

暮色反馈"思维链出现在了消息的末尾，想要的是放在消息的上面 / 放在正文气泡里"。看截图参考风格（白/灰文字、无 emoji、简洁）。

- 旧版：思维链作为**独立琥珀色折叠块**在 `sessionMessages.map` 之后、isTyping 之前
- 新版：思维链**嵌进最后一条 AI 消息气泡的内部顶部**（`thinkingToggleNode`），作为消息气泡的 prefix
- 样式重做：
  - 颜色：白/灰（`text-white/55` hover `text-white/80`），去琥珀色
  - 无 emoji（去掉 🤔）
  - 文字："思考 1 次 · 152 字" / 展开时"思考 1 次"
  - 展开后：左侧 `border-l border-white/20` 分割线 + `text-white/65` 文字
  - `e.stopPropagation()` 防止点思维链触发气泡的 contextMenu / 选中等副作用
- 位置判断：`idx === sessionMessages.length - 1 && msg.role === 'assistant' && currentThinking && (char.dateShowThinking ?? true)`
  - **只最后一条**带 thinking（currentThinking 是 state，新一轮开始就清空）
  - long-bubble 和 half-novel 两个分支都嵌

### 2. 强制中文 thinking 增强 prompt

暮色反馈"还是英文的"。基础 prompt 之前加了"推理用中文"但 Claude 仍输出英文，**不保证 100%**——Anthropic 官方说 thinking 是模型内部过程，prompt 引导**有效但不保证**。

- 强指令版 prompt：
  - "**100% 用中文**"
  - "**禁止**在 thinking 中夹杂任何英文（包括 'the'、'is'、'and'、'user'、'I'、'would'、'should' 这些常见词）"
  - "**先在脑内默念一句**'用中文'，再开始正式推理"
  - "即使涉及代码、英文术语 / 引用片段，**思考和解释也用中文**"
- 两处 prompt 同步加（handleSendMessage / handleReroll）

**注意**：Anthropic API 不支持 `thinking.lang` 参数——只能在 prompt 层面引导。**如果还是不灵**，下一步选项：
- **A**: 换模型——Qwen3 / DeepSeek R1 / GLM-4.5 这种**原生中文 thinking**的模型
- **B**: 客户端 UI 加"翻译思维链"按钮（接翻译 API，要花钱要慢）

## 动了哪些文件

- `components/date/DateSession.tsx:737-857` — longform `sessionMessages.map` 改成 `(msg, idx)` 取 idx，新增 `thinkingToggleNode` 嵌进气泡内部
- `apps/DateApp.tsx:363-372, 449-457` — 两处 system prompt 「推理语言」段加强

## 踩坑 / 需要知道的（重要）

- **"只最后一条带 thinking" 是当前实现的核心约束**：因为 `currentThinking` 是组件 state，只在最近一次 API 返回时有值，**新一轮开始就清空**。这意味着：
  - 用户发新消息前，思维链一直显示在最后一条 AI 消息里
  - 用户发新消息 → setCurrentThinking('') → 思维链消失（直到新 API 返回）
  - 历史消息的 thinking **不会**显示（state 只持有"最近一次"的）
  - **如果想让历史消息也带 thinking**（每条消息入库时存它的 thinking 字段），要改 DB schema + MessageItem 渲染层——这是更大的改动
- **位置判断的边界**：当 `isTyping` 时，最后一条是 typing 加载气泡（不是 sessionMessages 里的），所以 `sessionMessages[length-1]` 还是上一条 AI 消息——**这时 thinking 还会显示在上一条 AI 消息里**（用户可能觉得"思考完了"还在亮）。但用户已经发了下一句，isTyping=true 期间 thinking 状态会被清空（handleSend 的 setCurrentThinking('')），所以**实际上**新一发送 thinking 就消失了。OK 这个逻辑自洽。
- **e.stopPropagation** 是必须的——否则点思维链按钮会触发外层气泡的 `onContextMenu` / `onTouchStart` 等事件，可能导致长按弹操作菜单。
- **样式跟气泡预设的关系**：thinking 用了 `text-white/55` 等相对透明色，能透过气泡的预设背景色（`bubblePresetStyle`）。如果气泡预设用了**亮色**（如薄荷绿），thinking 文字可能对比度差——下次需要适配的话，可以根据 `bubbleStyle === 'light'` 切深色。
- **build 过了**——没新加 useState/useEffect 引用其他 const，不存在 TDZ 风险。

## 备注

- 这次 commit 是对**上一版思维链的视觉/位置重做**，不是 bug 修复——上一版能用但 UI 暮色不喜欢
- prompt 加强对非 thinking 模型（普通 Claude / GPT / etc）**无影响**——它们没有 thinking 输出
- 如果中文 thinking 还是失败，告诉我，我用 A 或 B 方案
- 等暮色测完这次样式后，再决定要不要把"历史消息也带 thinking"做掉（这是更大的工程）
