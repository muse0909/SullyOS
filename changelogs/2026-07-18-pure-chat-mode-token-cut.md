# 纯聊天模式补齐到真省 token

**日期**：2026-07-18  
**涉及 commit**：`ada05be`

## 改了什么

- 把之前只做了一半的纯聊天模式补齐：现在不只是关朋友圈、音乐、群聊、日记这些 awareness，连 OpenAI 协议的 `cache_control`、转账提示词、HTML 提示词也一起对齐到“省 token 优先”
- 聊天设置里的“上下文条数”改成跟未向量化消息数联动，避免滑块看起来能拉很高，实际因为记忆宫殿水位线只会吃到更少内容
- 设置文案改成直接说明 pure mode 关掉了哪些东西，和现在真实行为一致

## 动了哪些文件

- `utils/chatPrompts.ts` —— pure mode 下不再给 AI 转账动作提示词
- `hooks/useChatAI.ts` —— pure mode 下不再注入 HTML 模块提示词，也不再解析 `[html]...[/html]` 输出
- `components/chat/ChatSettingsDrawer.tsx` —— 补齐聊天模式 UI、未向量化条数提示、上下文滑块动态上限和新文案
- `apps/Chat.tsx` —— 把 `chatMode` 设置透传给抽屉

## 踩坑 / 需要知道的（重要）

- 这次不是从零加纯聊天模式，而是接手一个“前半段已经写进仓库、后半段还漏口”的状态。最容易搞混的地方就是：UI 看起来有了，实际 prompt 里还有转账和 HTML 残留
- 未向量化条数是本地算的：`localStorage` 里的 `mp_lastMsgId_${charId}` + IndexedDB 消息查询，不走 API，不耗 token
- 纯聊天模式的目标是省 token，不是封死所有聊天外功能入口。所以像用户手动点开的部分界面还在，但 AI 提示词层已经按 pure mode 收紧了

## 备注

- 本地 `npm run build` 已通过
- Vite 仍有大包体警告，但这是老问题，这次没动打包拆分
