# 见面 app 快捷键 v2：齿轮入口 + 输入框聚焦才显示 + 光标位置

**日期**：2026-08-04
**涉及 commit**：`待提交`

## 改了什么

暮色 8-4 反馈 5 件事：

1. **新建弹窗加"光标位置"字段**（iOS 截图里有"光标位置"段）
2. **快捷键设置从 DateSettings 移到见面 app 单独弹窗**（齿轮按钮触发）
3. **快捷键栏"全屏"按钮去掉文字、胶囊小一点、只在输入框聚焦时显示**
4. **删除改用项目内 Modal**（不要 `window.confirm` 那种大原生弹窗）
5. **开关在"快捷键设置"弹窗里**（关掉 → 见面 app 键盘栏不显示）

## 改动

### 1. `types.ts` — `DateQuickPhrase` 加 `cursorPos` 字段

```ts
export interface DateQuickPhrase {
  id: string;
  display: string;
  content: string;
  enabled: boolean;
  cursorPos?: 'last' | 'cursor';   // 新增，参考 iOS 截图，默认 'last'
}
```

老的 localStorage 数据没这个字段，OK 视为 `'last'`。

### 2. `context/OSContext.tsx` — `addDateQuickPhrase` 加 cursorPos 参数

```ts
const addDateQuickPhrase = (display, content, cursorPos: 'last' | 'cursor' = 'last') => { ... }
```

`updateDateQuickPhrase` 接受 `Partial<DateQuickPhrase>` 不用动。

### 3. `components/date/DateSettings.tsx` — 删除快捷键 section/state/handler/modal

- 解构不再用 5 个 quickPhrases 字段
- 删 `phraseModalOpen` / `phraseModalMode` / `editingPhraseId` / `phraseFormDisplay` / `phraseFormContent` 5 个 state
- 删 `openCreatePhrase` / `openEditPhrase` / `submitPhrase` 3 个 handler
- 删整个「快捷键」section（长文主题 tab 第 1 项）
- 删整个新建/编辑 modal JSX

**短手经验**：上一版我把 state/handler 删了但 modal 块没删干净（残留 `{phraseModalOpen && (...)}` 表达式，build 报 undefined identifier 错误——没删的 modal JSX 引用了不存在的 state）。这次改完应该都干净了。

### 4. `components/date/DateSession.tsx` — 5 处改动

- **import 增补**：`Gear` / `Trash` / `PencilSimple` 图标（用 Phosphor）
- **解构 OSContext 5 个字段**（`dateQuickPhrases` + add/update/delete/toggle）
- **新 state**（5 + 1）：
  - `phraseModalOpen`：设置列表 modal
  - `phraseModalMode`：create / edit
  - `editingPhraseId`：编辑哪条
  - `phraseFormDisplay` / `phraseFormContent` / `phraseFormCursorPos`：表单字段
  - `deleteTargetId`：删除确认 modal 的目标
  - `phraseFormModalOpen`：新建/编辑 modal（独立 state，不和设置列表共用——否则两个 modal 同时显示）
- **新 handler 3 个**：`openCreatePhrase` / `openEditPhrase` / `submitPhrase`
- **快捷键栏重做**（暮色 v2 反馈）：
  - **第 1 个**：齿轮（Gear）按钮，28×28（w-7 h-7），点击 → 弹设置列表 modal
  - **第 2 个**：全屏输入（CornersOut）按钮，28×28，**无文字**（去掉"全屏"两字），点击 → 打开 FullScreenEditor
  - **后面**：自定义快捷键，28×28 圆形（之前 h-8 矩形），按 enabled 过滤
  - **整体**：`{showInputBox && (...)}` 条件，**只在输入框聚焦时显示**
  - 横向滚 `overflow-x-auto no-scrollbar`
- **3 个 modal**（用项目内 `components/os/Modal`）：
  - **设置列表 modal**（z-120）：列表 + 开关 + 编辑/删除 + 底部"关闭/新建"按钮
  - **删除确认 modal**（z-130）：暮色要求"小弹窗"，用项目内 Modal 不用 `window.confirm`
  - **新建/编辑 modal**（z-140）：显示 / 填充内容 / **光标位置**（"最后"/"光标处"两选一胶囊）/ 预览
- **modal 嵌套 z-index 处理**：见面 app 输入框容器是 z-30，3 个 modal 分别用 120/130/140 盖过（参考 Modal.tsx:17-21 注释，暮色之前 7-02 拍板的）

## 踩坑 / 需要知道的（重要）

- **modal 状态设计**：`phraseModalOpen`（设置列表）和 `phraseFormModalOpen`（新建/编辑）必须**分开**——否则点"新建"时两个 modal 同时显示。`submitPhrase` 关闭 form 后**重新打开**设置列表，让用户继续看列表。
- **输入框聚焦时才显示** = `{showInputBox && (...)}`。showInputBox 之前是"输入框容器是否显示"——点屏幕任意位置会 `setShowInputBox(true)`，等价于"打开输入框"。暮色"点输入框时才显示"实际就是 `showInputBox=true`。
- **光标位置**目前**没实现** "cursor" 的实际行为——所有点击都按"末尾"插入。要做"光标处"得加 textarea ref + selectionStart 跟踪，下次重构时做。
- **删 import 时漏删 use 的坑**（8-04 memory 新加的 lesson）这次又踩了：DateSettings 删 state/handler 时**没把 modal 块删干净**——残留 JSX 引用了 undefined state → build 失败。**对策**：以后删东西时用 `grep` 确认所有引用都处理完。
- **TDZ 风险检查**：所有新加的 useState 都**没有** forward ref 引用——OK。
- **build 过**。

## 备注

- **不要给 setInput 加光标位置逻辑**：当前实现是 `setInput(prev => prev ? prev + (prev.endsWith('\n') || prev === '' ? '' : '\n') + p.content : p.content)`——**始终末尾插入**。用户即使选了"光标处"也按末尾来。**未来扩展**：加 inputRef.current.selectionStart + 切片。
- **没改 `setInput` 的 onClick 逻辑**：保持末尾插入，暮色这次没要求改。
- **Modal 在 z-30 容器里嵌套**：参考 6-28 changelog "backdrop-filter 会吃 position: fixed" 那个坑——但项目内已经到处用 Modal（line 1097 "暂时离开"等）兼容，OK 不动。
- **暮色 v1 反馈的"我没看到这个开关"**：是因为之前 DateSettings 那个"快捷键"section 入口在长文主题 tab 第 1 项——**没在用户视线焦点路径上**。这次改到见面 app 输入框旁边，**点输入框时齿轮就在旁边**，自然能找到。

## 之前的 changelog

之前 8-04 还有一版 commit `f82692a`（f82692a 后的"修复 CornersOut import" 在 `11c942f`），那次的"快捷键"section 在 DateSettings。这次完全重做，section 移走。
