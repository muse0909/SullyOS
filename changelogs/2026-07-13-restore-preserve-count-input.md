# 危险区域补回「清空保留条数」输入框

**日期**：2026-07-13
**涉及 commit**：`fdf6900`

## 改了什么
- `components/chat/ChatSettingsDrawer.tsx` 加 `preserveCount` / `setPreserveCount` props + 危险区域 section 在按钮上面加回 `<input type="number">` 输入框
- 按钮文案 `清空当前角色聊天记录` → `执行清空`（沿用旧版 ChatModals.tsx 危险区的原始文案）
- 输入框两边文案 `清空时建议保留最后 [N] 条记录以维持语境` 沿用旧版
- Trash icon + `不可恢复。建议先到「记忆宫殿」一键向量化后再清空。` 保留（暮色 10f8c9a 之后加的，没说要删）
- `apps/Chat.tsx` 父组件 `<ChatSettingsDrawer>` 传 2 个 props 进来

## 动了哪些文件
- `components/chat/ChatSettingsDrawer.tsx` —— +14 -1 行
  - line 63-65 加 props
  - line 79 destructure 同步
  - line 350-374 危险区域 section 改结构
- `apps/Chat.tsx` —— +1 行
  - line 2430 传 `preserveCount={preserveCount} setPreserveCount={setPreserveCount}`

## 踩坑 / 需要知道的（重要）

### 根因：10f8c9a commit 拆设置时漏搬输入框
2026-06-29 `10f8c9a`（"设置入口搬到头像右上角 + 心声/日程解耦"）把整个设置从 `components/chat/ChatModals.tsx`（Modal 弹窗）拆到新文件 `components/chat/ChatSettingsDrawer.tsx`（右侧滑出抽屉）。

拆的时候**漏了**危险区域里那个 `<input type="number">` 输入框——只搬了"清空当前角色聊天记录"按钮和说明文字，**没搬输入框**。

### 为什么没在 85ab5a0 hotfix 里被发现
`85ab5a0`（hotfix 修"10f8c9a 漏的 ChatModals 死 props 导致白屏"）只检查了 ChatModals 这边的 prop 漏传，**没检查 Drawer 漏掉的 UI**。build 不报、Vite 不做 TS 检查，runtime 也没崩——只是 UI 上少了那个输入框，所以一直没暴露。

### `preserveCount` state 其实一直在
`apps/Chat.tsx:68` 的 `const [preserveCount, setPreserveCount] = useState<number>(10);` **从来没被删过**，`apps/Chat.tsx:1502` 的 `const keepN = preserveCount ?? 10;` 也一直在用——所以清空逻辑一直在跑，默认保留 10 条。**缺的只是 UI 入口**。

### 改这个的影响面
- `handleClearHistory` 内部逻辑（line 1456-1533）原样不动
- `preserveCount` useState（line 68）原样不动
- `keepN` 行为不变
- ChatSettingsDrawer 其它 6 个 section 原样不动
- ChatModals 原样不动（preserveCount prop 之前就已经从 ChatModals 删了，10f8c9a 做的）
- Chat.tsx 父组件只加了 1 行传 prop，其它不动

## 备注
- 旧版危险区域在 `git show 10f8c9a^:components/chat/ChatModals.tsx` 548-564 行可以查到
- 下次拆组件 / 搬代码时记得检查：原文件的整个 section 范围 UI 元素都搬过去没
- 给 AI 协作者参考：**用户提"之前能 XXX 现在不能了"先看 input UI 是否被搬动**——拆 Modal 拆组件是高发漏点
