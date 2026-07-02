# 收藏页改造 + v4 反馈 7 项 + 两个新 bug（联系人页被破坏 / 切换会话切不了）

**日期**：2026-07-02
**涉及 commit**：`908dd64` `15eb543` `43a4e7b` `26a1153`
**当前 HEAD**：`26a1153`

---

## 这一晚做了什么（已 push 到 preview）

### 收藏页 v1 (`908dd64`)
- `utils/favoritesStorage.ts`（FavoriteItem + addFavorite/updateFavorite/removeFavorite/markFavoriteInvalid + genFavoriteId）
- `OSContext.tsx` 加 `jumpToMessage(charId, msgId)` + `consumePendingHighlightMessageId`（用 ref 存，避免 stale）
- `Chat.tsx` TTS 完成时（`synthesizeSpeechDetailed` 后）自动 `addFavorite` 归档（type='voice'，星标默认 false）
- `MessageItem.tsx` 加 `data-message-id={m.id}` 锚点
- 高亮注入：动态 `<style>` 注入 `[data-message-id="X"]` 背景琥珀色 + 2 秒 timeout
- `FavoritesPage.tsx`（按角色分组 + Tab 全部/星标 + 4 层结构）

### 修 TDZ + 死循环 (`15eb543`)
- TDZ 根因：`import { FavoriteItem }` 把 type 当 value 引入，Vite/esbuild 在严格模式生成 TDZ const 抛错
- 死循环根因：`useEffect` deps 包含 `consumePendingHighlightMessageId`（OSContext.value 每次 render 都新建，函数引用每次都变）→ effect 每次都跑 → 死循环 re-render（用户交互被吃——返回按钮 / 切换会话全部不响应）
- 修法：用 `useRef` 镜像 `consumePendingHighlightMessageId`，deps 只保留 `[activeCharacterId]`

### 修 useEffect deps TDZ (`43a4e7b`)
- 错误：`Cannot access 'T' before initialization at jv`（minified 后变量名 `T`）
- 根因：`useEffect(() => {...scrollIntoView...}, [highlightMessageId, messages])` 中 `messages` 在 Chat 组件后半段才定义，React 19 在某些模式下会同步评估 deps 数组 → TDZ
- 修法：deps 只保留 `[highlightMessageId]`（一次执行一次够了）

### v4 反馈 7 项 (`26a1153`)
1. ✅ 收藏页去角色分组（暮色原话："不喜欢混在一起的"，指不喜欢**分组本身**，不是混合排序）
2. ✅ 收藏卡片操作按钮移到右上角，顺序 ⭐→📍→🗑 三个 icon button 横排
3. ✅ 收藏页留白加大（px-4 → px-5，space-y-2.5）
4. ✅ 发现页留白加大（px-3 → px-5）
5. ✅ 聊天页底部 Tab 栏加磨砂（bg-white/85 backdrop-blur-xl）
6. ✅ 系统调试终端弹窗改自适应（Modal 加 `adaptiveHeight` prop，StatusBar 调试终端用）
7. ⚠️ 定位到聊天 — 修复了，但**同时把联系人页搞坏了**（见下方 bug）

### 额外修复
- **定位到聊天**："不能跳"的根因 = WeChat 是 3-Tab 容器（消息/发现/我），**只有 `openedCharId` 不为 null 时才渲染 `<Chat />`**。`jumpToMessage` 只 `setActiveCharacterId`，没同步 `openedCharId`，跳过去看到的是联系人列表，看起来像"没切"。
- 我加的反向同步 effect：
  ```tsx
  // apps/WeChat.tsx 第 65-70 行附近
  useEffect(() => {
    if (activeCharacterId && !openedCharId) {
      setOpenedCharId(activeCharacterId);
    }
  }, [activeCharacterId, openedCharId]);
  ```
  **这个 effect 是双刃剑**：jumpToMessage 时它正确把 openedCharId 同步上去了；但**用户从 launcher 进 AppID.Chat 时**（默认 tab='messages'，openedCharId=null，activeCharacterId 有值），effect 直接触发 openedCharId 同步 → **跳过联系人页直接进 Chat**。

---

## ⚠️ 当前 preview 上的 bug（待下个窗口修）

### Bug 1: 联系人页被破坏（紧急）
- **症状**：点桌面微信图标（AppID.Chat）→ 直接进聊天框，**不再显示联系人列表**
- **用户原话**："宝，你把联系人页弄没啦？点底下消息图标进去不是联系人页啦，是聊天框啦"
- **根因**：`apps/WeChat.tsx` 那个反向同步 effect（第 65-70 行附近）
- **修复方向**（下个窗口二选一）：
  - **方案 A**（最简单）：**直接撤掉反向同步 effect**，让联系人页恢复。**副作用**：收藏页"定位到聊天" 失效（只 setActiveCharacterId 不 setOpenedCharId）
  - **方案 B**（推荐，干净）：把 `openedCharId` 升到 OSContext 改成 `activeOpenChatId` ref；jumpToMessage 设它，WeChat 读它；联系人列表（activeOpenChatId null 时）和直接定位（activeOpenChatId 有值时）清晰分开。**这一步是大改，需要同时改 OSContext + WeChat + jumpToMessage 调用点**
  - **方案 C**（折中）：用 `pendingOpenChatId` ref（类似 `pendingDirectChat` 模式），jumpToMessage 设它，WeChat 内部 `consume` 它；同时加一个 `cameFromLocate` 标志区别普通进入

### Bug 2: 聊天页 + 号面板里"切换会话"切不了（紧急）
- **用户原话**："我说的是这里的切换会话，不是联系人切换那里呀。那里是对的，聊天页里切换会话切换不了啦"
- **位置**：`components/chat/ChatInputArea.tsx` line 642-669 `showPanel === 'chars'` 的 char 列表（红框区域，气泡样式下面）
- **调用链**：`onClick={() => onCharSelect(c.id)}` → Chat.tsx `handleCharSelectCallback` → `setActiveCharacterId(id) + setShowPanel('none')`
- **根因未确认**（下个窗口排查）：
  - 可能 1：ChatInputArea line 300-301 `bg-white/80 backdrop-blur-2xl` 让祖先链有 backdrop-filter，可能吃点击（之前 AGENTS.md 提过 backdrop-filter 会吃 position: fixed，但这里不是 fixed……但 ChatInputArea 整个是 flex 列底部，可能被某些 wrapper transform 影响）
  - 可能 2：`registerBackHandler` 没注册 / WeChat 在某种状态下 backHandlerRef 被卡住
  - 可能 3：`setActiveCharacterId` 实际生效了但用户看到的 Chat 还在显示旧角色（截图说明 activeCharacter 是 New Character，但用户切回江澈时——可能 hotfix `43a4e7b` 之前的死循环 re-render 状态遗留）
- **建议排查步骤**（下个窗口）：
  1. 先硬刷新（Cmd+Shift+R / 清缓存 / 无痕模式）—— 因为之前 `43a4e7b` 之前死循环 re-render 状态可能还在
  2. 看 console 日志：onCharSelect 有没有真的被调用
  3. 加 console.log 到 handleCharSelectCallback，看 setActiveCharacterId 之前之后的 activeCharacterId 值
  4. 看 Chat.tsx 里 activeCharacterId 变化时有没有 reload 消息 / scroll 重置

---

## 收藏页这一晚的真正状态

### 结构（已改完）
- 顶 Tab：消息收藏 / 语音收藏（默认 'voice'）
- 内容：所有 favorite 按时间倒序**混在一起**（**没有按角色分组**，暮色不喜欢分组）
- 卡片：日期 + 右上角 ⭐→📍→🗑 三图标 + 语音条（仅 voice） + 文字内容
- 留白：px-5 + space-y-2.5

### 数据流
- 语音收藏：Chat.tsx TTS 完成时自动 `addFavorite({ type: 'voice', url, text, charId, charName, sourceMessageId, createdAt, starred: false })`
- 文本收藏：ChatModals.tsx 消息操作 modal 里 ⭐ 按钮（已实现）
- 失效：`<audio onError>` → `markFavoriteInvalid(item.id)` + toast，不重新生成 TTS

---

## 内存/记忆已更新的事项

- ✅ **"留白这个已经说过很多次了"** → memory 红字：卡片列表 ≥ px-5，卡片间 ≥ space-y-2.5，弹窗 body ≥ px-6 py-4

---

## 下个窗口接手清单

1. **修 Bug 1（联系人页被破坏）**——建议方案 B 或 C
2. **修 Bug 2（聊天页 + 号面板切会话切不了）**——按上面排查步骤
3. 如果两个都修好 + 刷新 OK，可以开始做**相册改造**（暮色原话："相册放进发现页" + 旧 362 张江澈 GalleryImage 数据保留）
4. **日记功能**（晚安后自动写）——之前在愿望清单

---

## 文件改动清单（git show 用）

- `apps/FavoritesPage.tsx`：v1 → v4 改造（4 层 → 2 层 → 去分组 + 留白 + 操作右移）
- `apps/WeChat.tsx`：加反向同步 effect（导致联系人页 bug）+ 底部 Tab 磨砂
- `apps/Chat.tsx`：useEffect deps 移除 messages（TDZ fix）
- `apps/ChatModals.tsx`：消息操作 modal ⭐ 按钮正式实现 + 加 useOS
- `components/os/StatusBar.tsx`：系统调试终端改自适应高度
- `utils/favoritesStorage.ts`：新文件
- `context/OSContext.tsx`：加 jumpToMessage + consumePendingHighlightMessageId
- `components/chat/MessageItem.tsx`：加 data-message-id 锚点

## 备注
- 暮色说"存到记忆里，咱们这个窗口上下文太多啦，咱们换个新窗"——这次是收尾动作，不改代码
- 暮色晚间偏好：精简到 1-2 行确认 + 晚安
- 暮色明确"不要再做改动了"——所有未修复的等下个窗口处理