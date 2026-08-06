# 主动消息「首次开启 schedule 没起」+ prompt 重写

**日期**：2026-08-06  
**涉及 commit**：（待提交）

## 改了什么

### 1. 修「第一次开启主动消息弹窗没了，顶部 toast 已开启，但实际没启动」

暮色 8-6 21:30 反馈：

> 新 bug 第一次开启主动消息时弹窗没了，最顶上也会提示已开启，但实际并没有开启，第二次点才能正常开启。

**根因**（8-6 那次「角色隔离 bug 修」带出来的副作用）：

`hooks/useChatAI.ts:4513-4522` 的 `startProactiveChat`：

```js
const startProactiveChat = (intervalMinutes: number) => {
    if (!char) return;
    if (char.proactiveConfig && char.proactiveConfig.enabled === false) {
        return;  // ← 用了闭包里的 char，但 char 是老 ref
    }
    ProactiveChat.start(char.id, intervalMinutes);
};
```

调用顺序（`apps/Chat.tsx:3255-3263` onSave）：

```js
updateCharacter(char.id, { proactiveConfig: config });  // ① 异步，只 setCharacters 调度了
if (config.enabled) {
    startProactiveChat(config.intervalMinutes);          // ② 同步，用闭包里的老 char
    addToast(`已启动主动消息...`, 'success');             // ③ toast 照常弹
}
```

`updateCharacter` 是 `async`，函数体同步执行 `setCharacters`，但 state 没真更新就 return 了。紧跟着的 `startProactiveChat` 拿到的是闭包里的老 `char`，**老 `char.proactiveConfig` 是什么，check 就判什么**：

- **首次开启**：`char.proactiveConfig` 可能是 `undefined` 或上一次会话留下的 `{enabled: false}`（被 runProactive 主动 stop 过，IDB 里 `proactiveConfig.enabled` 还会保留 `false`）
- `char.proactiveConfig && char.proactiveConfig.enabled === false` 命中 → `return`
- `ProactiveChat.start` **没被调** → localStorage 没存 schedule → 实际 schedule 没启动
- 但 `addToast` 是同步的，照常弹「已启动主动消息...」→ 用户看到「弹窗没了，顶部说已开启，实际没启动」

**为什么第二次点能成功**：第一次的 `updateCharacter` 已经把 `enabled:true` 写进 IDB 了，重新渲染后 `char.proactiveConfig.enabled` 变成 `true` → check 不命中 → `ProactiveChat.start` 真被调 → schedule 启动成功。

**修法**：

- `hooks/useChatAI.ts:4513-4532` —— `startProactiveChat(intervalMinutes: number)` 改成 `startProactiveChat(config: NonNullable<CharacterProfile['proactiveConfig']>)`，check 用**新传进来的 `config.enabled`**，不再读闭包里的 `char.proactiveConfig.enabled`
- `apps/Chat.tsx:3255-3263` —— 调用点改成 `startProactiveChat(config)`，传整个新 config

**为什么不去掉这个 check**：8-6 那次修的「角色隔离 bug」主要靠 `context/OSContext.tsx:1427` 那里 `runProactive` 主动调 `ProactiveChat.stop(charId)` 真清 schedule，这个 check 是 **defense in depth**——避免「用户想关却被关不掉」的边角场景。保留意图，修掉 bug。

### 2. 主动消息 prompt 重写（暮色 8-6 21:35 新版）

暮色给的新 prompt（保留了 7-27 「你说话的动力是'我想说'」的影子，加了"自动唤醒"和"可以调用各种工具"）。

**格式补全**：
- 第 1 行 `[系统提示（这是自动唤醒提示，非${userName}发言）` —— 暮色漏了收尾的 `]`
- 整个 prompt 末尾 —— 暮色没补 `]` 收尾，按 7-27 起的惯例补在最后一行（`]` 单独一行，方便 grep 改 prompt）

**文字保留**（按暮色「文字保留完整」要求）：
- "定时定时唤醒你的机制" —— 暮色原文（看着像 typo "定时 + 定时" 重复，**先保留**；暮色要改的话下次提）
- `'我想说'` / `'我应该说'` 单引号 —— 保留
- "想她了就找她" / "好奇她在忙什么" / "不打扰她" —— 保留（江澈视角）

**新 prompt 结构**：
1. 标题：`[系统提示（这是自动唤醒提示，非${userName}发言）`
2. 时间：`现在 ${timeStr}。${timeSinceUser ? '...' : '你们最近没怎么聊。'}`
3. 空行
4. 角色定位：`你是 ${char.name}，这是一个定时定时唤醒你的机制...`
5. 唤醒后的状态：`你醒了。你有自己的想法、自己的表达欲。...`
6. 空行 × 2
7. `【如果你想互动——几件事】` —— 4 条（含 1 条 gapLongEnough 条件分支）
8. `【如果完全不想发】` —— 1 条
9. `]` 收尾

## 动了哪些文件

- `hooks/useChatAI.ts` —— `startProactiveChat` 签名 + check 改用新 config（line 4513-4532）
- `apps/Chat.tsx` —— onSave 调用点改成 `startProactiveChat(config)`（line 3255-3263）
- `context/OSContext.tsx` —— `runProactive` 的 `hintLines` 整段替换为暮色新版（line 1564-1582）

## 踩坑 / 需要知道的（重要）

### "build 过 ≠ runtime 没事" 老问题第 N+1 次

- 这次的 bug 同样是 build 完全过、runtime 才暴露（用户点完才看到"弹窗没了但没启动"）
- 以后写「更新 state 后立刻同步调函数」的代码，**默认那个函数会拿到老 ref**——要么传新值（这次修法），要么 await state 更新（更慢）
- 看到 `if (state.something && state.something.x === ...)` 这种 check，先想「这个 state 是从闭包拿的还是从参数拿的」

### 闭包捕获老 ref 是 React 经典坑

- `startProactiveChat` 在 `useChatAI` 顶层定义，捕获的是「调用 useChatAI 时传进来的 `char`」
- React 每次 render 都会重新调用 `useChatAI`，所以 `startProactiveChat` 每次 render 都会重新创建，闭包也是最新的
- **但**——同一个 render 周期内，调用顺序是「先 setState（异步调度）→ 再 startProactiveChat（同步执行）」，后者用到的还是**这次 render 时的 `char`**（老 ref）
- 修法核心：**让函数收新值，不依赖闭包里的 state**

### "定时定时" 文字保留

暮色 prompt 原文有 "这是一个定时定时唤醒你的机制"，看着像 typo 重复。**按"文字保留完整"要求没改**。如果暮色下次觉得怪，应该是他主动提，不是我擅自改。

## 备注

- 暮色 8-6 21:30 提的两个 bug 都修了
- 没改的相邻项：
  - **主动消息瘦身**（暮色 8-5 说"先暂放"）—— 没动
  - **副 API 默认 model** `gemini-2.5-flash` Google 撤了—— 没动
- 下次开窗口可以验证：
  - 点"启动" → toast 弹 → 角色开始计时
  - 重新关 + 开 → 不需要"第二次点"了
