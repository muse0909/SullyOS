# ChatSettingsDrawer 漏 destructure — 聊天设置崩

**日期**：2026-07-31
**涉及 commit**：`b1ab32f`

## 改了什么
- `components/chat/ChatSettingsDrawer.tsx` 组件 destructure 补全 `perCharApiProtocol` / `setPerCharApiProtocol` / `switchPerCharApiProtocol` / `perCharApiClaudeUrl/Key/Model` / `perCharApiGeminiUrl/Key/Model`（共 9 个 prop）

## 踩坑 / 需要知道的（重要）
- 报错 `ReferenceError: perCharApiProtocol is not defined` 在 `Array.map` 里 → 3 tab 协议按钮渲染时 `perCharApiProtocol === p` 找不到变量，整个聊天设置抽屉白屏
- 根因：7/27 `bdbc685` 加 3 tab 协议切换时，**只改了 Props interface 和 Chat.tsx 传 prop，忘了改 destructure**
- TypeScript 为什么没报：`perCharApiProtocol` 是 props 字段名，destructure 漏拿它就成了 free variable。理论上 tsconfig `noImplicitAny` 该报，但项目里大概关了 / 用了 React.FC 隐式 any
- **教训**：加 prop 时三件套（interface 字段 + 父组件传 + 子组件 destructure）必须一起改，缺一就崩。下次加 prop 写到 `setShowPerCharKey` 之后加个"destructure 也要补"提示
- **同类风险**：之前 `bdbc685` 还加了 `perCharApiClaude*/Gemini*` 一组 prop，destructure 也都漏了。这次一并补，避免下次用到时再炸一次

## 备注
- 跟 7/31 那个 `chat null msg guard` 不是同一个 bug，是两件事叠在一起
- 这个 bug 的定位很快——"变量名 + is not defined" + "在 Array.map 里" 几乎是 "destructure 漏了" 教科书症状
- Props interface 里其他 prop 都已经在 destructure 里了，只这一组（7/27 新加的）漏
