# 语音收藏失效 + 跳转错位修复

**日期**：2026-07-03
**涉及 commit**：(本次)

## 改了什么

### #4 语音收藏：blob URL → IndexedDB 持久化
- **根因**：`Chat.tsx` 的 `addFavorite` 用的是 TTS 生成的 `blob:` URL，blob URL 和当前 document 绑定，**离开当前页面（甚至切到其他 modal）就会失效**，所以"新语音能自动进收藏但无法播放"
- **旧** `audio.onError` 弹的 toast 文案"语音已失效（CDN 链接过期）"——是 blob URL 失效，**不是 CDN 过期**（之前没有真的上传到云端）
- **新方案**：
  1. `addFavorite` 不再传 `url: blobUrl`，让 favorite item 通过 `sourceMessageId` 关联到 Chat 已经存到 IndexedDB 的 voice blob（`voice_msg_${msgId}`）
  2. `FavoritesPage` 的 voice 卡片 mount 时**异步**从 IndexedDB 读 blob + `URL.createObjectURL` 生成新 blob URL，喂给 `<audio>`
  3. unmount 时 `URL.revokeObjectURL` 清理
  4. IndexedDB 找不到 blob 时才标 `invalid`（提示"语音数据已丢失（升级前的老收藏）"）
- **新接口**：`getFavoriteVoiceBlob(sourceMessageId): Promise<Blob | null>`，从 IndexedDB 读
- **新加 toast**："语音数据已丢失（升级前的老收藏）" / "语音读取失败" / "语音播放失败"，区分了根因

### #5 跳转错位
- **根因**：`AppErrorBoundary` 的 `resetKey` 只在 `hasError` 时才 reset children，**正常不会 reset**。所以 jumpToMessage 触发 WeChat re-render 时，**FavoritesPage 不会 unmount**
- 但 WeChat 的 `pendingDirectChatRef` 消费在 `useEffect`（**异步**）里——`activeCharacterId` 变化 → React re-render → FavoritesPage 还在 → useEffect 跑 → setOpenedCharId → 第二次 re-render → 渲染 Chat
- 中间这一帧**FavoritesPage 还在 + Chat 已经 mounted** = absolute inset-0 div 叠加成图 1 的"头像栏挡住一半 + 露出蓝色底"
- **修法**：把 WeChat 内的两个 `useEffect` 改成 `useLayoutEffect`——**DOM 更新前同步消费 + 同步 setOpenedCharId**，**消除中间帧**

## 动了哪些文件
- `utils/favoritesStorage.ts` —— `url` 字段加注释说明（可空）、新加 `getFavoriteVoiceBlob` 函数（动态 import DB 避免循环）
- `apps/Chat.tsx:380` —— `addFavorite` 去掉 `url: blobUrl`，加注释说明不传的原因
- `apps/FavoritesPage.tsx` —— `FavoriteCard` 改用 `useEffect` 异步从 IndexedDB 读 blob；toast 文案区分根因；新增"加载中..."占位
- `apps/WeChat.tsx` —— `useEffect` × 2 → `useLayoutEffect` × 2（mount effect + activeCharacterId 变化 effect），加注释说明
- `AGENTS.md` —— 索引追加今天 ComfyUI/Pony 两份报告（之前 commit 没合进来）

## 踩坑 / 需要知道的
- **老 voice 收藏会失效一次**：升级前存到 localStorage 的 favorite item，`url` 字段是 blob URL，原 blob 已经 GC。**用户点开会弹"语音数据已丢失（升级前的老收藏）"**——按暮色 OK A 决定，**可以接受**
- **为什么 `getFavoriteVoiceBlob` 用 dynamic import `./db`**：`favoritesStorage.ts` 被 `FavoritesPage` 引用，`db.ts` 体积大 + 引用链长，dynamic import 避免循环依赖 + 不让 `addFavorite`（不读 blob 的纯文本收藏）白白加载 IndexedDB 模块
- **`useLayoutEffect` 改用的影响范围**：只在 WeChat 内改，没动其他位置。**只影响 jumpToMessage 跳转路径**，jumpToChat 走的不是这条路径（activeApp 变化会触发 WeChat remount + mount effect 跑），但因为 mount effect 也改成了 useLayoutEffect，**统一了行为**
- **跳转到 Chat 之前如果用户在 DiscoverPage 的某个 subPage**（朋友圈/收藏/日记），现在会**先**同步切到 Chat 路径，**不再有中间帧**——但用户**视觉上不会看到任何切换**（没有"联系人列表闪一下"再"Chat 进来"）
- 暮色说"返回后聊天页会恢复正常"——这正符合 useLayoutEffect 修复后的预期（不再有 race）

## 备注
- 老的 voice favorite 升级后会自动标 `invalid`（FavoritesPage 渲染时检测 IndexedDB 找不到就 mark），用户**手动重新触发**那条 AI 消息的语音（点语音按钮）会重新存 IndexedDB，下次再收藏就 OK 了
- 后续如果要支持**跨设备同步 voice favorite**，可以加一个 IndexedDB → Netlify Blobs 的上传逻辑，但这次先不动
- 朋友圈设置页 + AI 通知逻辑还没做，**给方案中**
