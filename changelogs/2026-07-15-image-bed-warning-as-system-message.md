# 图床警告改成推系统消息进聊天流

**日期**：2026-07-15
**涉及 commit**：`dac0dc2`

## 改了什么
- 图床失败/未配图床时，警告从 input area 上方的固定 div 改成**推系统消息进聊天流**
- 铃铛胶囊样式由 MessageItem 现有的 `[系统: ...]` 渲染决定（跟 `[连接中断: ...]` 同一个机制）
- 警告留在聊天历史，用户长按可删

## 动了哪些文件
- `apps/Chat.tsx` —— 删固定 div 警告条 + × 按钮 + `imageBedWarning` state；加 `pushImageBedWarning` 函数
- `hooks/useChatAI.ts` —— `onImageBedWarning` 签名 `(string|null)` 改 `string`

## 实现照搬的 pattern
`hooks/useChatAI.ts:3297` 的 `[连接中断: ...]`：
```ts
await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[连接中断: ${e.message}]` });
setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
```

`pushImageBedWarning` (Chat.tsx)：
```ts
const pushImageBedWarning = useCallback(async (msg: string) => {
    if (!char?.id || !msg) return;
    try {
        await DB.saveMessage({ charId: char.id, role: 'system', type: 'text', content: `[系统: ${msg}]` });
        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
    } catch (e) {
        console.warn('🖼️ [ImageBed] 推警告系统消息失败:', e);
    }
}, [char?.id]);
```

## 踩坑 / 需要知道的（重要）

**为什么前 2 轮（`9c9a391`、`64610e5`）都做错了**

暮色反馈："图床提醒应该是聊天消息嵌在聊天流中间，**不是**顶部 toast 也**不是** input area 上方固定 div"。

我之前实现的全是固定 UI 元素：
- `9c9a391`：input area 上方固定 div + × 关闭按钮 + 改文案 ✗
- `64610e5`：第一次把顶部 `addToast(..., 'bell')` 改到 input area 上方固定 div ✗

正确做法：照搬 `useChatAI.ts:3297` 的 `[连接中断: ...]` pattern —— **推 `role: 'system'` 消息进聊天流**，由 MessageItem 自动渲染成 `[系统: ...]` 铃铛胶囊，留在聊天历史里。

**为什么之前没想到**：被"图床警告"这个名字误导，一直想"警告"是 UI 元素（toast/div），没想到跟"连接中断"本质是同类东西（系统状态/事件推送），应该走一样的系统消息通道。

**顺序细节**：warning 之前在 image 之前调用，看起来像是"先警告再发图"。改成 `await handleSendText(base64, 'image')` 之后再调 `pushImageBedWarning`，让警告出现在图后面（更自然：用户先看到自己发的图，再看到"已用原图发送"提示）。

**系统消息会进 LLM context**（跟连接中断一样）：这个是符合预期的，LLM 看到警告能更好地回应。但会导致 context 噪音，每张图床失败的图都加一条系统消息。如果以后觉得吵了，可以加 metadata 标记过滤掉（跟其他系统消息区分开）。

## 备注
- 文案保持上次改的格式：`[原因]，已用原图发送，占内存，建议看完删除`
- 6 处触发（3 处 Chat.tsx 发图 + 3 处 useChatAI.ts 生图）都走 `pushImageBedWarning` callback
- 没有"自动清理"逻辑了——警告是聊天消息，用户想清就长按删除
