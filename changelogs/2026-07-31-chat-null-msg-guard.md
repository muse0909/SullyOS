# 聊天页 null 消息渲染守卫

**日期**：2026-07-31
**涉及 commit**：`abfdb92`

## 改了什么
- `components/chat/MessageItem.tsx` 第 249-250 行：`m.role === 'user'` / `m.role === 'system'` 加 `?.` 守卫，null 或缺字段时不抛错
- `apps/Chat.tsx` 第 2865 行：`displayMessages.map((m, i) => {...})` 顶部加 `if (!m) return null;` 兜底
- `apps/Chat.tsx` 第 2877-2887 行：`calcBreaks` 加 `if (!cur) return true;`（cur 和 neighbor 互调，防御双向）
- `apps/Chat.tsx` 第 2276 行：`handleForwardToCharacter` 把 `messages` 换成 `safeMessages`

## 踩坑 / 需要知道的（重要）
- 之前 `c7dfdd2` (7/28) 修了 ChatModals / McdMiniApp 改用 `safeMessages`，但 **MessageItem.tsx 内的 `m.role` 没守卫**——这是真正会白屏的渲染路径
- `displayMessages = useMemo(sanitizeChatMessages(messages)...)` 在 `messages` 进来时已经过滤 null，但还有几条**没走 sanitize** 的写入路径可能让 null 漏进来（比如 `setMessages(prev => prev.map(msg => msg.role === ...))` 这种 `prev` 直接用的，`prev` 状态本身如果是脏数据会传导）
- "防御性" 兜底 = `if (!m) return null;` + `m?.role`。**治标**。**治本**得让所有 setMessages 入口都走 `sanitizeChatMessages`。这次没动全量，是**最小修复**让聊天页能正常用

## 备注
- 截图上 PersonalityRescue log 跟在 crash 前面是巧合：PersonalityRescue useEffect 在 chat 打开时跑，碰巧先 log 后 render render 又触发了未守卫的 m.role 路径
- 转发记录 (`handleForwardToCharacter`) 之前用裸 `messages`，理论上也会撞同样的 null 雷，**这次顺手换了 safeMessages**
- ApiQuickFloat 的 4 张配置卡片（主 API / 生图 / 识图 / 副 API）当前都已经有 `PresetHeader`（"保存为预设" 按钮在右上）+ `ProtocolTabs`（3 tab 协议）。`bdbc685` 那个版本加的 3 个底部按钮已经在 `cf01082` 统一卡片样式时删了。**暮色截图里的"底部 3 按钮"是更早的版本**
- 治本建议：把 sanitizeChatMessages 直接放进 setMessages 的 setter 包装里，强制所有写入都过 filter（等下次真有空再改）
