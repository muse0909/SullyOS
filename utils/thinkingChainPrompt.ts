/**
 * thinkingChainPrompt.ts
 *
 * 思考链（内心独白）提示词构造器。
 * 当角色需要对自己说些什么来整理思路时，在 system prompt 中追加此段。
 */
export function buildThinkingChainPrompt(charName: string, userName: string): string {
    return `## 思考链：内心独白（不要写出来，只在内心想）

在回复用户之前，请先在心里过一遍以下思考：

1. **当前感受**：作为${charName}，你现在对${userName}有什么样的情绪？
2. **场景感知**：你们现在在什么情境下？之前发生了什么？
3. **欲言又止**：有什么话你想说，但又觉得直接说出来不太合适？

请在心里默默过完这些再给出你的回复。这样的思考过程会让你的回应更自然、更有人情味。`;
}