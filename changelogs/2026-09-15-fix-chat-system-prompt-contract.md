# 2026-09-15 修复聊天发送 [连接中断: Cannot read properties of undefined (reading 'length')]

## 问题

暮色 9-15 17:54 反馈：聊天页"一直弹"连接中断系统消息，发不出消息。报错的固定模板：

```
[连接中断: Cannot read properties of undefined (reading 'length')]
```

## 根因

`utils/chatPrompts.ts` 的 `ChatPrompts.buildSystemPrompt` 在 9-12 step 4 commit（`2d73a1f7`）里把返回类型从 4 段对象改为单一 string：

```ts
// 改前（4 段对象）
return { bp1Tools, bp2Rules, bp3Context, dynamicTail: { realtimeText, hotNewsText, innerState } };

// 改后（string）— step 4 commit 自作主张
const dynamicTail = [bp1Tools, bp2Rules, bp3Context, timeText, hotNewsText, evolvedNarrative]
    .filter(Boolean).join('\n\n');
return dynamicTail;
```

commit message 里说"5 个 caller 都用 string 拼接"，**但实际上 5 个 caller 中只有 2 个（`chatRequestPayload.ts`、`activeMsgClient.ts`）是当 string 用**，另外 3 个仍按对象字段读：

| caller | 文件:行 | 用法 |
|---|---|---|
| `hooks/useChatAI.ts` | 936, 967-970 | `systemPromptResult.bp1Tools` 等字段 |
| `context/OSContext.tsx` | 1821, 1832-1840 | `sp.bp1Tools`、`sp.dynamicTail?.realtimeText` |
| `context/OSContext.tsx` | 2787, 2792-2793 | `systemPromptResult.bp3Context`、`systemPromptResult.dynamicTail` |
| `utils/chatRequestPayload.ts` | 202 | 当 string |
| `utils/activeMsgClient.ts` | 741 | 当 string |

改完 `systemPromptResult.bp1Tools / .bp2Rules / .bp3Context / .dynamicTail` 全是 `undefined`。

## 崩点

`hooks/useChatAI.ts:1886-1907` 构造 `logEntry` 字面量时求值 `bp1Tools.length`：

```ts
const logEntry = {
    timestamp: new Date().toISOString(),
    url: `${baseUrl}/chat/completions`,
    model: effectiveApi.model,
    chatMode: char.chatMode || 'full',
    apiProtocol,
    stream: userStream,
    temperature: userTemp,
    maxTokens: 8000,
    totalMessages: fullMessages.length,
    toolCount: toolsList.length,
    hasCacheControl: cacheControlFieldCount > 0,
    cacheControlCount: cacheControlFieldCount,
    promptChars: {
        bp1Tools: bp1Tools.length,        // ← bp1Tools 是 undefined, TypeError
        bp2Rules: bp2Rules.length,
        bp3Context: bp3Context.length,
        dynamicTail: dynamicTailParts.join('\n\n').length,
        history: historyTotalChars,
        requestJson: requestJson.length,
    },
    requestBody: baseReqBody,
};
```

`logEntry` 对象字面量在 `if (isApiLogEnabled())` 之前构造，每次发消息必求值，`bp1Tools.length` 立刻抛 `TypeError`，被 line 5039 catch 抓住：

```ts
} catch (e: any) {
    await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[连接中断: ${e.message}]` });
    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
}
```

捕获到的 `e.message` 正好是 `"Cannot read properties of undefined (reading 'length')"`，所以聊天页一直弹这条系统消息。

## 修复

恢复 `chatPrompts.ts` 的 4 段对象契约，并相应改另外 2 个原本当 string 用的 caller。

**3 处改动**：

1. `utils/chatPrompts.ts:1165-1175` —
   - 改回 4 段对象返回
   - `dynamicTail` 重新变成 `{realtimeText, hotNewsText, innerState}`
2. `utils/chatRequestPayload.ts:202-208` —
   - 改成按对象字段拼 3 段（`bp1Tools` / `bp2Rules` / `bp3Context`）成大 string
   - 后面 `systemPrompt += ...` 逻辑保持不动
3. `utils/activeMsgClient.ts:741-756` —
   - 改成按对象字段拼 3 段（fire_pack 模板不需要 dynamicTail，实时热搜/天气/意识流在 fire 那一刻 worker 侧 `renderFirePack` 渲染，不烤进打包模板）

## 验证

- `npm run build` ✓ build pass
- TS 无新报错

## 待暮色验证

- 浏览器刷新 + 给角色发消息，不再弹"连接中断"系统消息
- chat 的人设段落（角色卡 / 世界书 / 朋友圈 / 心声底色）正常显示

## 备注

- step 4 commit（`2d73a1f7`）的判断"5 caller 都 string"是错的。修完保留 4 段 cache 拆分的上游原契约
- `dynamicTail` 字段 9-12 同步时还套了一个 `dynamicTailParts` 5 段拼接块（`useChatAI.ts:1241-1266`）—— 老代码逻辑跟新接口对得上，没动
- 9-12 changelog 提到"OtContext 也走 cache"，但因为这次返 string，已有的 cache 拆分（bp1/bp2/bp3 system content blocks）一并失效；本次修复同时恢复了 cache 拆分的可能性
