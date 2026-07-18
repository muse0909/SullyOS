# 纯聊天模式漏口修正 + cache 日志校准

**日期**：2026-07-18  
**涉及 commit**：`d432d37`

## 改了什么

- 纯聊天模式下，补关「朋友圈工具说明」和「私密记事工具说明」，避免请求体里继续出现发朋友圈 / 写私密记事的大段提示词
- 请求日志里的 `hasCacheControl` 改成按真实对象字段统计，不再因为 prompt 文本里出现 `cache_control` 字样而误报
- 请求日志新增 `chatMode`、`apiProtocol`、`promptChars`，方便直接判断纯聊天模式是否生效、请求体大概有多大

## 动了哪些文件

- `utils/chatPrompts.ts` —— pure 模式跳过朋友圈 / 私密记事工具说明
- `hooks/useChatAI.ts` —— cache_control 字段计数改成递归查对象 key，并补充 prompt 长度日志

## 踩坑 / 需要知道的（重要）

- `cacheControlCount: 0` 才代表前端没有发显式 cache 标记；旧版 `hasCacheControl: true` 可能只是请求体文本里出现了 `cache_control` 这个词
- 如果 `cacheControlCount: 0` 时供应商后台仍显示 cache 写入，那更像是供应商对 Claude 模型做了自动缓存，不是前端发送了 `cache_control` 字段
- `claude-opus-4-6` 走 `/v1/chat/completions` 时仍是 OpenAI 外壳协议；项目里的 Claude 专用分支是 `/v1/messages` 格式，二者不是同一条请求路

## 备注

- pure 模式仍保留语音开关和心声输出要求；这符合原方案里「innerState 保留」的目标，避免把角色核心表现一起砍掉
