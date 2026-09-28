# 修重复识图——IIFE 写完 imageDesc 同步 React state + setMessages 类型签名补充

**日期**：2026-09-28
**涉及 commit**：（提交后填）

## 改了什么

### 1. 修重复识图 bug（`hooks/useChatAI.ts` IIFE 写 imageDesc 后）

**症状**：用户发图后立即追问文字，第二次 triggerAI 又调了一次 Vision API 识别同一张图。

**根因**：
- 第一轮 IIFE 写 imageDesc 是**异步**的（Vision API 调用 + DB 写入 + 孤儿 mutate `_fTargetImageRawMsg.metadata`）
- 但 try 块的 `setMessages(await DB.getRecentMessagesByCharId(...))` 在 line 5024 **同步执行**
- setMessages 在 IIFE 写 DB **之前**完成 → 重读 DB 拉到的 state **不含 imageDesc**
- 第二轮 triggerAI 进入时：contextMsgs = state → _fTargetImageRawMsg.find 找到小女孩图 → `!imageDesc` filter 没拦住 → 重复调 Vision API

**修复**：
IIFE 写完 imageDesc 后（DB 写入 + 孤儿 mutate 之后），**用 setState 函数式调用增量同步 React state**：

```typescript
setMessages((prev: Message[]) => Array.isArray(prev)
    ? prev.map((m: any) => m?.id === _tMsgId
        ? { ...m, metadata: { ...(m.metadata || {}), imageDesc: _tImageDesc } }
        : m)
    : prev);
```

**代价**：
- 主请求速度不变（IIFE 仍异步）
- React state 强一致（IIFE 写完 → 立即同步）
- 不重读全 DB（只更新一条 msg 的 metadata）

### 2. setMessages 类型签名补充（`hooks/useChatAI.ts` line 625）

**之前**：
```typescript
setMessages: (msgs: Message[]) => void;
```

**现在**：
```typescript
setMessages: (msgs: Message[] | ((prev: Message[]) => Message[])) => void;
```

**原因**：React 标准 setState 支持 `(prev) => newState` 函数式调用，这次增量同步用到；之前类型签名不开放，下次别的地方要用又得绕 `(setMessages as any)`，顺手补上。

类型兼容性：Chat.tsx 传的 React setState 类型是 `Dispatch<SetStateAction<Message[]>>`，跟新签名兼容（SetStateAction = `Message[] | ((prev) => Message[])`），不需要改 Chat.tsx 调用方式。

## 动了哪些文件

- `hooks/useChatAI.ts` line 625：`UseChatAIProps.setMessages` 类型签名
- `hooks/useChatAI.ts` IIFE 写 imageDesc 段（line 5283+）：加 setMessages 函数式增量同步 + 注释更新

## 踩坑 / 需要知道的（重要）

### 不重读 DB 的原因

老的 setMessages 路径是 `await DB.getRecentMessagesByCharId(char.id, 200)` —— 重读全表 200 条消息，每次开销大。函数式 setState 只更新**一条** msg 的 metadata 字段，性能远好于重读 DB。

### setMessages 函数式调用是 React 标准 API

React setState 从 v16.8 hooks 开始就支持 `(prev) => newState` 函数式调用，TypeScript 类型 `Dispatch<SetStateAction<T>>` 也明确暴露。这次只是把 useChatAI 的接口对齐到 React 标准。

### 极端情况兜底

理论上 useChatAI 收到的 setMessages 一定支持函数式（React 必然支持），但加 try/catch 兜底防止万一报错时主流程被破坏（DB 已写入、孤儿 mutate 已完成，只是 React state 没同步——下轮 triggerAI 仍然会重读 DB 拿到 imageDesc，不会破坏功能）。

### 没改 line 5024 的 setMessages

老的 `setMessages(await DB.getRecentMessagesByCharId(char.id, 200))` 没改——它仍然在 IIFE 之前执行，拉不到 imageDesc 是已知问题但不需要解决（IIFE 写完会通过函数式 setState 同步）。

## 测试场景（暮色 9-28 19:00 反馈）

| 场景 | 期望 | 验证方式 |
|---|---|---|
| 发图 → 立即追问文字 | Vision API 只调一次 | 看 `Vision Gemini` 日志：只出现 1 次（不是 2 次） |
| 发图 → 等 5 秒 → 追问 | Vision API 只调一次 | 看 `Vision Gemini` 日志：只出现 1 次 |
| 发图 → 立即再发一张图 | Vision API 调一次（图 2 命中） | 看 sanity check 区间扫描：图 1 + 图 2 都 inject |
| 发图 → 立即发第三张图 | Vision API 调一次（最新一张） | 看 sanity check：图 1 降级成文字、图 2 + 图 3 都 inject |

## 备注

- 未完成项：无
- 依赖：依赖 React setState 函数式调用是稳定 API（React 16.8+）
- 跟其他功能耦合：IIFE 写完 imageDesc 后多了一步 setMessages 调用，理论上可能跟 Chat.tsx 别的 setMessages 产生 race condition（同时多次 setMessages）—— React 会合并多次 setMessages 到同一渲染，不影响功能