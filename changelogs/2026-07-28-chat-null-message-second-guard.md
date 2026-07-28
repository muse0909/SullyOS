# 聊天页空消息二次崩溃补挡

**日期**：2026-07-28  
**涉及 commit**：`c7dfdd2`

## 改了什么
- 聊天页传给 `ChatModals` 和 `McdMiniApp` 的消息统一改成过滤后的 `safeMessages`，避免子组件拿到 `null` 消息再读 `role`。
- 云端同步合流前先过滤异常消息，避免坏消息进入当前聊天 state。
- 聊天搜索抽屉自己从 IndexedDB 拉全量消息时也补过滤，避免搜索入口绕过聊天页主过滤。

## 动了哪些文件
- `apps/Chat.tsx` —— 子组件入参和云端消息合流统一走干净消息列表。
- `components/chat/ChatSearchDrawer.tsx` —— 搜索抽屉拉库后先过滤 `null` / 缺 `role` / 缺 `id` / 非文本内容的坏消息。

## 踩坑 / 需要知道的（重要）
- 前一轮只挡住了聊天页主列表；搜索抽屉是独立拉库入口，所以库里已有坏消息时仍会崩。
- 这次是显示层防炸，不会主动清 IndexedDB 里的坏记录；好处是风险小，不会误删用户聊天记录。

## 备注
- 已跑 `npm run build` 通过；大 chunk warning 是项目既有提示。
