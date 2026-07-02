# WeChat 两个 bug 修复：联系人页 + chars 面板切换

**日期**：2026-07-02
**涉及 commit**：`1756244`
**HEAD**：`1756244`

---

## 改了什么

### Bug 1：联系人页被反向同步 effect 破坏 → 修复
- **症状**：点桌面微信图标（ChatTeardrop）进 AppID.Chat，**不再显示联系人列表**，直接跳进聊天框
- **根因**：`apps/WeChat.tsx` 之前加的反向同步 effect：
  ```tsx
  useEffect(() => {
    if (activeCharacterId && !openedCharId) {
      setOpenedCharId(activeCharacterId);
    }
  }, [activeCharacterId, openedCharId]);
  ```
  这个 effect 让用户从 Launcher 进 WeChat 时（activeCharacterId 已有值 + openedCharId=null）直接 setOpenedCharId 跳进 Chat，跳过联系人列表入口。

- **修法（采用 changelog 推荐的方案 C 变体）**：
  - 撤掉反向同步 effect
  - 改走 `pendingDirectChatRef` 路径：
    - `context/OSContext.tsx` 的 `jumpToMessage` 也设 `pendingDirectChatRef.current = charId`（之前只设 highlight ref）
    - WeChat 新加一个 effect 监听 `activeCharacterId` 变化时 consume `pendingDirectChatRef`：
      - 普通进 WeChat：consume 拿到 null → 不动 → 显示联系人列表 ✓
      - jumpToMessage 收藏页跳转：consume 拿到 charId → `setOpenedCharId(charId)` → 进 Chat ✓
      - chat 内字符切换（不走 pendingDirectChatRef）：consume 拿到 null → 不动 → OK ✓

### Bug 2：chat 内 + 号面板"切换会话"切不了 → 修复
- **症状**：在 chat 里点 + → chars 面板 → 点别的角色卡片，**切不回**新角色
- **根因**：`apps/WeChat.tsx` line 65-69（修复前）的 effect：
  ```tsx
  useEffect(() => {
    if (openedCharId && openedCharId !== activeCharacterId) {
      setActiveCharacterId(openedCharId);
    }
  }, [openedCharId, activeCharacterId, setActiveCharacterId]);  // ← 含 activeCharacterId
  ```
  deps 包含 `activeCharacterId` → 用户在 chat 内 chars 面板 `setActiveCharacterId(newId)` 后，effect 检测到 `openedCharId(oldId) !== activeCharacterId(newId)` → 执行 `setActiveCharacterId(openedCharId)` 覆盖回 oldId。

- **修法**：deps 改成 `[openedCharId, setActiveCharacterId]`，移除 `activeCharacterId`。
  - 联系人列表点击入口（openedCharId 变化）→ 同步 activeCharacterId ✓
  - chat 内字符切换（activeCharacterId 变化）→ effect 不再触发反向覆盖 ✓

---

## 动了哪些文件

- `apps/WeChat.tsx` — 撤反向同步 effect + 修 deps + 加 pendingDirectChat consume effect
- `context/OSContext.tsx` — `jumpToMessage` 加 `pendingDirectChatRef.current = charId`

---

## 踩坑 / 需要知道的（重要）

### 1. 三个 effect 的依赖边界要清晰
- **mount effect**（line 33-41）：处理 WeChat 首次 mount 时 consume pendingDirectChat（widget 直跳路径）
- **openedCharId → activeCharacterId effect**（line 71-76 修复后）：只同步联系人列表点击
- **activeCharacterId → openedCharId effect**（line 86-92 新加）：consume pendingDirectChatRef 处理 jumpToMessage

每个 effect 的职责**不重叠**，deps 严格限制。原来的反向同步 effect 把这两个方向的逻辑混在一起，导致 Bug 1 + Bug 2。

### 2. 之前 collect 的"死循环 / TDZ"教训仍在：useCallback/useEffect deps 要严格

Bug 2 的根因就是 useEffect deps 写多了。SullyOS 的死循环教训（见 memory）刚好适用——任何共享 effect 的 deps 都要逐个 review，不能图省事"全列上"。

### 3. jumpToMessage 不设 `directEntryRef`

之前 jumpToChat 设了 `directEntryRef.current = true`，让返回直接回桌面。jumpToMessage 故意没设——收藏页跳过来的"按返回"行为应该回联系人列表（跟普通进 WeChat 一样），不是回桌面（收藏页本身在 WeChat 内部）。

### 4. ref-based 跨组件同步的坑

`pendingDirectChatRef` 是 OSContext 模块级 ref，WeChat mount effect + activeCharacterId effect 都会消费它。
- mount effect 一次性消费（mount 时跑一次）
- activeCharacterId effect 每次 activeCharacterId 变化都跑（但 consume 拿 null 就是 no-op，幂等）
- 两个 effect 都消费同一个 ref：必须确保**只有一次会拿到非 null 值**，否则 openedCharId 会被多次设
- 当前是 OK 的——`consumePendingDirectChat` 内部消费后清空 ref

---

## 备注

- 两个 bug 都修了，理论上 Vercel 部署后两个路径都通：
  - 点桌面 ChatTeardrop → 进联系人列表 → 点 ContactCard → 进 Chat ✓
  - Chat 内 + → chars 面板 → 点别的角色 → 切到新角色 ✓
  - 收藏页 → 定位到聊天 → 直接进 Chat + 高亮 ✓
  - Launcher widget 点 ChatTeardrop → 直接进 Chat + 按返回回桌面 ✓
- 暮色记得硬刷新（Cmd+Shift+R / 清缓存 / 无痕模式）—— 之前的死循环状态可能残留
- 下次测的时候顺便验证聊天页其他功能（消息收发 / 滚动 / 高亮）没受影响