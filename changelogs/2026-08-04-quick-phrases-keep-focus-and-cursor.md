# 见面 app 快捷键：iOS 软键盘收回 + 光标位置 bug 修复

**日期**：2026-08-04
**涉及 commit**：`待提交`

## 改了什么

暮色 8-4 反馈快捷键点击有 bug：

- **iOS 软键盘会自动收回去**——点快捷键按钮时 textarea blur → 软键盘收起
- **光标不出现**——点击后 textarea 没有焦点，光标看不见
- 期望：**点快捷键后键盘不收回 + 光标在设置的位置**（"最后"或"光标处"）

## 根因

点击 `<button>` 元素时浏览器触发的事件顺序：
1. `mousedown` 在 button 上
2. button 获得焦点（**但 textarea 失去焦点**）
3. `mouseup` / `click` 触发
4. iOS Safari 看到 textarea blur → **自动收起软键盘**

之前快捷键按钮只用 `onClick` 处理——没阻止焦点转移 + 没强制恢复焦点 + 没设置光标位置。

## 修复

`components/date/DateSession.tsx` 快捷键按钮 onClick 改写：

```ts
// 1. onMouseDown preventDefault — 关键！阻止按钮点击导致 textarea blur
onMouseDown={(e) => e.preventDefault()}

// 2. onClick — focus + setSelectionRange 按 cursorPos 设置
onClick={() => {
    const ta = inputRef.current;
    if (!ta) return;

    // 决定插入位置
    const insertAt = (p.cursorPos === 'last')
        ? input.length                                          // 强制末尾
        : (ta.selectionStart || 0);                            // 当前光标位置

    const before = input.slice(0, insertAt);
    const after = input.slice(insertAt);
    const newInput = before + p.content + after;
    setInput(newInput);

    // 保持焦点 + 移动光标到插入内容末尾
    requestAnimationFrame(() => {
        ta.focus();
        const newPos = insertAt + p.content.length;
        ta.setSelectionRange(newPos, newPos);
    });
}}
```

## 踩坑 / 需要知道的（重要）

- **onMouseDown preventDefault 是核心修复**——不阻止的话 iOS 软键盘照样收。这是经典的"按钮保持 input 焦点"模式。
- **requestAnimationFrame 包裹 focus + setSelectionRange**——避免 React 状态批处理期间 `selectionStart` 还没更新到 DOM（用 setTimeout 0 也行但 rAF 更稳）
- **`selectionStart` 在 textarea 失焦时保留**——这是 HTML5 标准行为，浏览器不主动改 selectionStart/End。所以失焦时读 selectionStart 仍是上次聚焦时的光标位置——可以做"光标处"插入。
- **TDZ 风险检查**：onMouseDown/onClick 都引用 input 和 inputRef —— 都在闭包内，**不 forward ref**——OK
- **build 过**

## 备注

- **光标位置（cursorPos）逻辑**：
  - `'last'`（默认）：永远追加到末尾
  - `'cursor'`：用 `ta.selectionStart` 作为插入位置
- **如果 textarea 完全没聚焦过**（selectionStart 是 0）—— cursorPos='cursor' 也等同于 'last'（都从 0 插入，等于末尾）
- **多行内容**插入时，光标会停在多行内容**最后**的末尾（不是中间）—— OK
- **没改** 7-15 加的"输入框空 + 末尾有换行时不加换行"那段逻辑（v1 那段）—— 改成"按 cursorPos 插入"后那段不再适用
- **新行为**：光标位置现在**真的**生效——之前 v1 的 "input 末尾追加" 等价于强制 'last'，现在按用户设置走

## 测试

- 见面 app 长文模式 → 点输入框（聚焦）→ 软键盘弹出
- 看到上方快捷键栏
- 点任意快捷键 → **键盘不收回** + 光标在**设置的位置**
  - cursorPos='last' → 末尾
  - cursorPos='cursor' → 用户当前光标处
- 多行内容（带 `\n`）→ 插入后光标停在多行内容末尾
