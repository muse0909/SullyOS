# 生图工具 description 收紧 — 默认不调，仅三种情感场景放行

**日期**：2026-07-22
**涉及 commit**：`2223402`

## 改了什么

暮色反馈"生图程序在角色没有主动调用时也会偶尔自动触发"。

根因在 `hooks/useChatAI.ts:48-52` `IMAGE_GENERATION_TOOL` 的 description 写的是：

> "Use this when the user asks you to draw/paint/generate an image, **or when you want to share a visual (like a selfie, a scene, a photo you took, etc)**."

最后那半句**开放了 LLM 自主生图的权限**。配合 `tool_choice: 'auto'`，LLM 在以下场景会自己跑生图：
- 用户问"在干嘛" → LLM 觉得"我应该发张自拍" → 调生图
- 聊到"我看到窗外" → LLM 觉得"发张照片给 ta" → 调生图
- 任何闲聊，LLM 想"加点画面感" → 调生图

**代码层面看不出异常**——`tool_call` 是 model 自主决策，没违反任何规则。业务上"用户没要图却触发"。

**江澈改写后的 description**（照搬，未做改写）：

> "Generate an image based on a text prompt. Use this when the user explicitly asks you to draw, paint, or generate an image. You may also use this proactively ONLY in the following scenarios: (1) the user is emotionally down and you want to comfort them with a visual; (2) you miss the user and want to share a selfie or scene; (3) special dates such as anniversaries or birthdays. Do NOT use this tool for casual chat decoration, adding 'visual flair' to normal conversation, or when the user has not mentioned anything image-related. When in doubt, do not call."

**核心逻辑**：默认不调，三种情感场景放行（情绪低落安慰 / 想念 / 特殊日期），日常闲聊不碰，拿不准就不碰。

## 动了哪些文件

- `hooks/useChatAI.ts` — 改 `IMAGE_GENERATION_TOOL.description` 一行，加 4 行注释标注根因 + 江澈改写

## 踩坑 / 需要知道的

- **这是 LLM 行为约束，不是代码兜底**。新 description 是给 LLM 看的"应该 / 不应该"，但 LLM 不一定 100% 遵守（特别是 description 写得很长时，模型对"放行条件"的权重可能不稳定）。如果改完后还偶发"角色自主生图"的情况，**优先看 description 是不是被 token 截断**（provider 一般有 8K-16K context，description 字符数也吃 token），必要时把 description 拆短或移到 system prompt 里的硬规则段。
- **不会影响用户明确要图**。"给我画张图"/"发张自拍"这种 prompt 仍然能触发。
- **不影响朋友圈主动生图**（commit 历史里 line 2584 注释说"AI 主动发的动态都是纯文字，图片要走 imageGenProvider 这里不做"）—— 朋友圈的生图走 `publishPostAsChar` 自己的逻辑，不走 tool_call。
- **不影响 MCD MiniApp** —— 麦当劳点餐只挂 `MCD_PROPOSE_TOOL`，不挂 `IMAGE_GENERATION_TOOL`，两条工具链是独立的。

## 备注

- 用户反馈"偶尔"——说明不是 100% 触发，是 LLM 概率性行为。新 description 收紧了"主动调"的语义，理论上概率会大幅下降。如果改完后还偶发，下次考虑：把 description 移到 system prompt 顶部 + 缩短 description 长度（token 截断风险）。
- 江澈 = 暮色常用的 AI 角色名（不是真人），暮色 2026-07-22 明确说"江澈写的，按他说的改吧"——意思是文案是江澈 AI 角色输出的，由暮色审核采纳。
