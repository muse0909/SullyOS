# emoji-reorder modal 3 个 bug 修复

**日期**：2026-07-01  
**涉及 commit**：`6f00006`

## 改了什么

修复暮色反馈的 3 个表情包相关 bug：

1. **删除按钮不工作** — `DB.deleteEmoji is not a function`
2. **长按拖动落点算错**（拖动几个位置后，上滑想再排序时落点错位）
3. **emoji 列表本身滑不动**（modal 里列表超长时不能滚下去看下面）

## 动了哪些文件

- `utils/db.ts` — 把 `deleteEmoji` 函数加回去（3 行实现，跟 commit `6d36218` 重构前的签名一致）
- `components/chat/ChatModals.tsx`：
  - `reorderList` / `onMoveEmoji` 加 ref 镜像，updateDragAt 读 ref 拿最新值（修 stale closure）
  - 容器去掉 `touch-none`，拖动浮层加 `touch-none`

## 踩坑 / 需要知道的（重要）

### Stale closure 又来了（commit 6d36218 的隐藏 bug）

`updateDragAt` 是 `useEffect(() => {...}, [isDragging])` 闭包内定义的 const 函数。但它内部读的是闭包内的 `reorderList` 和 `onMoveEmoji`。拖动过程中 `onMoveEmoji` 触发 `setReorderList` → React 重渲染 → 但 useEffect 依赖项 `[isDragging]` 没变 → effect 不重跑 → `updateDragAt` 闭包内的 `reorderList` 一直是 effect 执行时的旧版本。

结果：拖动第一个位置时 `currentIdx` 算对了，拖动几下后位置变了，但 `updateDragAt` 还以为 item 在旧位置，`currentIdx` 和 `target` 计算全错。

**为什么 commit 5c7556c（鼠标拖动挂 document）没暴露这个 bug**：当时暮色可能主要测了 PC 鼠标，鼠标能稳定触发 mousemove，每次拖动一两个位置就松手，没暴露 stale closure。手机触摸情况可能更明显——手指在屏幕上滑动多个位置后，落点就乱了。

**修复套路**：跟 `draggingName` 用同一个模式——用 ref 镜像 state / prop，effect 闭包内读 ref.current 拿最新值。后续写「跨组件回调 + 闭包内读 state」的模式时默认就要加 ref，不要等出问题再加。

### 容器 `touch-none` 跟 `overflow-y-auto` 直接冲突

`touch-none` = `touch-action: none`，告诉浏览器「这个元素上不要处理任何 touch 手势（包括滚动）」。但 `overflow-y-auto` 又希望容器能滚动。两者同时存在 = 滚动废了，暮色在 modal 里想滑列表看下面就是动不了。

当时写 `touch-none` 应该是为了让拖动浮层时容器不滚动，但**位置写错了**——应该写在**浮层**上（拖动时阻止浮层内原生滚动，让我们的拖动逻辑接管），而不是写在**容器**上。容器是要让用户能滚的。

**Lesson**：用 `touch-action: none` 之前先想清楚——是「这个元素上的 touch 不要触发原生手势」还是「这个元素上不能滚动」。前者正常用，后者需要把 `touch-none` 加在拖动元素 / 浮层上，而不是加在可滚容器上。

### commit 6d36218 重构 emoji CRUD 时漏补 `deleteEmoji`

当时把 `deleteEmoji: async (name: string) => { store.delete(name) }` 整个换成了 `updateEmoji: async (oldName, updates) => {...}`。新函数功能更全，但签名变了、且只支持「改」不支持「删」。结果 Chat.tsx:1727 的 `DB.deleteEmoji(selectedEmoji.name)` 调用没改回去，build 也不报（TypeScript 把 `DB.deleteEmoji` 当 `any`），运行时直接 `DB.deleteEmoji is not a function`。

**Lesson**：跟 memory 里记的「删 useState 必须搜全部 JSX 引用点」是同类陷阱——重命名函数 / 删函数前必须 grep 所有调用点，不能只看 type 觉得 build 过就没事。

## 备注

- 删除按钮恢复后，emoji 列表右上角 ↑↓ 单步移动按钮也能正常工作（之前修拖动时也顺带修了它依赖的 `onMoveEmoji`）
- 这次的 3 个修复是独立的，commit 信息也列了 3 条对应，方便以后单独 revert
- 暮色原 bug 描述是 "表情包删除按钮不好使，移动位置时上滑不上去"—— 通过 ask_user 二次确认是 A（拖动落点错）+ C（列表滑不动）的组合，少走弯路