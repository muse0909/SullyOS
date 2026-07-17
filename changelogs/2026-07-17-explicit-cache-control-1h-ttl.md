# 显式 cache_control 标记（1h TTL）

**日期**：2026-07-17
**涉及 commit**：`b234cb1`

## 改了什么

SullyOS 之前依赖 provider 默认的 cache TTL（实测即享 kiro 0.1x 只给 50-60s，青屿能给到 1h+）。

这次加显式 `cache_control: { type: 'ephemeral', ttl: '1h' }` 标记到 system 消息的 content block：

```ts
// 改前
const fullMessages = [{ role: 'system', content: systemPrompt }, ...cleanedApiMessages];

// 改后
const fullMessages = [
    {
        role: 'system',
        content: [
            {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral', ttl: '1h' }
            }
        ]
    },
    ...cleanedApiMessages
];
```

## 动了哪些文件

- `hooks/useChatAI.ts` —— `fullMessages` 构造处把 system 消息从 string 改成 array of single block + cache_control 标记

## 踩坑 / 需要知道的

1. **cache_control 是 Anthropic 原生字段**，OpenAI 兼容 API 大部分 provider 也透传。即享/青屿如果透传 → 拿 1h TTL；如果不认 → 忽略 cache_control 字段，回落到 provider 默认 TTL。

2. **1h TTL 需要 provider 账户开通**（Anthropic 官方要求），不开放的话会忽略 ttl 字段。即享 kiro 0.1x 便宜档不一定支持——**最差就是回落到 5m 标准值**（跟之前一样）。

3. **改后只标记 system message**，history 和 dynamicTail（realtime + innerState 末尾追加的两条 system 消息）不标记：
   - history 是动态增长的，每次都变（最后一条消息每次都新），标记会浪费 cache 段
   - dynamicTail 每轮都变，标记没意义

4. **风险评估**：
   - 如果 provider 报错（不认 content array 格式）—— **需要回滚**到 string
   - 如果只是 cache 命中率没变化—— 至少没坏处

5. **预期效果**：
   - 青屿：5m TTL → 1h TTL，**跨 1 小时空闲也能命中**（实测 10-12 点还在）
   - 即享 kiro：50-60s → 可能 1h（如果透传），可能不变（如果不透传）
   - 即享 ccmax：5m → 1h

6. **后续观察点**：
   - Vercel 部署后，暮色测一下青屿**跨空闲（30 分钟以上）的 cache_read 涨不涨**
   - 如果即享 kiro 仍 50-60s → 即享没透传 cache_control
   - 如果错误日志出现 "invalid content format" → 改回 string

## 备注

- 上次改（`e4b48c7`）把 innerState + realtime 挪到 messages 末尾，已经让青屿 80% → 93%
- 这次（`b234cb1`）再加 1h TTL 标记，主要针对**跨空闲窗口**（睡觉、午休、开会）
- 单条费用进一步下降（特别是第二天早上的第一两条）
