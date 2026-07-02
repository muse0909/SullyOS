# 仿微信联系人页 — Step 1 框架壳

**日期**：2026-07-01  
**涉及 commit**：`1403d3e`

## 改了什么

仿微信风格联系人页的**最小可用骨架**：
- 点底部「消息」图标 / 桌面「Message」卡片 → 进入仿微信界面（之前是直接进聊天）
- 顶部：标题"消息" + 右上齿轮（占位，未来接设置）
- 中间：三 Tab 切换（消息 / 发现 / 我）—— 后两个暂为占位文字
- 消息 Tab：联系人卡片列表，从 `OSContext.characters` 渲染，每张卡片显示头像 + 名字
- 点联系人卡片 → 进原 Chat 聊天界面（Chat.tsx 一行不动）
- 左上角 absolute 浮一个"←"返回按钮，叠在 Chat 上方，点它回到联系人列表
- 注册 `registerBackHandler`，物理返回键 / Android Back 也走相同逻辑

## 动了哪些文件

- `apps/WeChat.tsx`（**新建**）—— 联系人页壳，约 170 行
  - 内部状态：`tab`（当前 Tab）+ `openedCharId`（已点开的角色；null = 还在列表）
  - `openedCharId` 有值时渲染 `<Chat />` + 左上角"返回"按钮
  - `registerBackHandler` 处理 Android Back：先清 `openedCharId`，再走默认 `closeApp`
  - `setActiveCharacterId(openedCharId)` 同步到 OSContext，让原 Chat 拿到正确的角色

- `components/PhoneShell.tsx` —— 路由切换
  - 加一行 `import WeChat from '../apps/WeChat';`
  - line 381：`case AppID.Chat: return <Chat />;` → `case AppID.Chat: return <WeChat />;`

- **Chat.tsx 完全未动** —— 通过 OSContext 的 `activeCharacterId` 跟 WeChat 通信

## 设计要点

按暮色审美要点执行：
- 灰底 `#ededed` + 白色圆角卡片（微信风格）
- Tab 选中态：绿松石色文字 + 底部细线 + 居中（不依赖默认下划线框）
- 联系人大卡片：`rounded-2xl` + `shadow-sm` + `p-3` + 头像 12 + 名字粗体 + 占位预览"点击开始聊天…"
- 占位 Tab：图标 + 标题 + 提示文案，居中布局
- 「返回」按钮：白底胶囊 + 阴影，叠在 Chat 左上角

## 踩坑 / 需要知道的（重要）

1. **没动 Chat.tsx，但能选中正确角色的关键**：Chat 在 init 时从 `OSContext.characters` + `OSContext.activeCharacterId` 拿数据。WeChat 通过 `setActiveCharacterId(openedCharId)` 在 effect 里同步，Chat 重 mount 时会看到正确的 activeCharacterId（PhoneShell 用了 `resetKey={activeCharacterId}`，见 PhoneShell.tsx line 460）。

2. **左上角"返回"按钮是 overlay 而不是改 Chat 顶栏**：要避免碰 Chat.tsx，所以用 absolute 浮层。视觉上跟 Chat 自身的 onClose 按钮叠在同一区域，但因为 z-index 高先点击响应。要注意不要跟 Chat 自己的 onClose 按钮视觉重叠导致歧义——目前 Chat 顶栏的左上 onClose 按钮是 `p-2 absolute left-3` 在某些主题下会露出来，两套返回按钮共存。等 Step 3 决定要哪个（讨论后再调整）。

3. **Chat 重 mount 会丢失聊天滚动位置**：因为 `resetKey` 在 PhoneShell line 460：`resetKey={\`${activeApp}:${activeCharacterId || 'none'}\`}`，切 activeCharacterId 会强制 unmount/remount。这是原本就有的行为，跟这次改动无关，但暮色测试时如果发现"点联系人进 Chat 总从头滚"——这是历史行为，不是 bug。

4. **build 通过且 asset hash 变了**（index-yMz-p-oc.js）—— runtime 包含改动，不用担心缓存。

## 接下来 — Step 2/3 待办

| Step | 内容 | 暮色能看到啥 |
|---|---|---|
| Step 2 | 联系人卡片接真实数据：最后消息预览 + 每角色未读数 + 按时间排序 | 联系人卡片显示真实最新消息 + 红点未读数 |
| Step 3 | 点进 Chat 后的"返回联系人列表"按钮优化 + 嵌套 Chat 时的滚动状态保留 | 进 Chat 后左上角更自然的返回，不丢 Chat 内的滚动位置 |
| Step 4（确认砍） | ~~➕ 号弹窗（添加角色）~~ —— 砍掉，神经连接里添加角色自动进联系人列表 | — |
| 后续 | 发现 tab：朋友圈 + 收藏 + 日记 | — |
| 后续 | 我 tab：档案页面接入 | — |

## 备注

- 这一步 chat 用的是 character 列表数据，没做"过滤 user 自己"逻辑（OSContext 290 行已经过滤过 `isLocked` 的 user 角色，但具体怎么实现还没看）。如果发现 user 自己出现在联系人列表里，Step 2 顺带修。
- WeChat.tsx 用了 `useOS()` 直接拿 `characters`，没单独写 selector——目前可用，但当 character 列表很大（之前踩过大数据角色加载不出），未来可能需要 useMemo 优化。Step 1 不处理。
- `chore` commit `fd5cf2b` 顺手把上一轮残留的 3 份 changelog + AGENTS.md 索引一并提交了，跟这次 Step 1 无关，只是清理工作区。
