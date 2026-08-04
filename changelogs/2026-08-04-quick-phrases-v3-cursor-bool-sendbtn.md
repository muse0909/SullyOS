# 见面 app 快捷键 v3 + 发送按钮逻辑重做

**日期**：2026-08-04
**涉及 commit**：`待提交`

## 改了什么

暮色 8-4 下午 3 个反馈：

### 1. 光标位置按设置（v2 改错，v3 修正）

**v2 错误**：两种 cursorPos 都把光标移到"插入内容末尾"——暮色说"光标位置要和设置相同"

**v3 正确**：
- `'last'`（最后）：光标停在输入框**末尾**（= newInput.length）
- `'cursor'`（光标处）：光标**不动**，保持在原 `selectionStart` 位置

```ts
const useCursor = p.cursorPos === 'cursor';
const insertAt = useCursor ? (ta.selectionStart || 0) : input.length;
// ... 拼接内容 ...
requestAnimationFrame(() => {
    ta.focus();
    const cursorAfter = useCursor ? insertAt : newInput.length;
    ta.setSelectionRange(cursorAfter, cursorAfter);
});
```

### 2. 键盘收起快捷键自动隐藏

加 `textarea onBlur={() => setShowInputBox(false)}`：
- 键盘收 → blur → 快捷键栏自动隐藏
- 快捷键栏按钮 `onMouseDown preventDefault` 阻止了 blur → 快捷键栏继续显示（不被打断）

```tsx
<textarea
    onFocus={() => setShowInputBox(true)}  // 已有
    onBlur={() => setShowInputBox(false)}   // 新增
    ...
/>
```

### 3. 发送按钮逻辑

**v2 行为**：
- 空内容 + canReroll（最后一条是 assistant）→ 触发重 roll
- 空内容 + hasPendingUserMessage（最后一条是 user）→ 重发

**v3 新行为**（暮色反馈"和重新生成连一起了"）：
- 空内容 + hasPendingUserMessage（最后一条是 user）→ **重发**
- 空内容 + 最后一条是 assistant → **啥都不做**（发送按钮锁死）
- **彻底删除** 空内容走 canReroll 触发重 roll 的逻辑
- "重新生成"还是保留在"+" 菜单里（用户主动从那里点）

```tsx
const handleSend = async () => {
    if (isTyping) return;
    const trimmed = input.trim();
    if (!trimmed) {
        if (hasPendingUserMessage) {
            await handleResend();
        }
        // 暮色 2026-08-04 v3：最后一条是 assistant → 不做事
        return;
    }
    // ... 原有 handleSend 逻辑（发新消息）...
};

// 发送按钮 disabled 条件
disabled={(!input.trim() && !hasPendingUserMessage) || isTyping}
```

- 空内容 + 最后一条是 user → 按钮**可用**（重发）
- 空内容 + 最后一条是 assistant → 按钮**锁死**（不做事）
- 有内容 → 按钮可用（发新消息）

## 踩坑 / 需要知道的（重要）

- **`selectionStart` 失焦时保留**：HTML5 标准，浏览器不主动改。所以用 `ta.selectionStart` 拿"上次聚焦时的光标位置"是对的。
- **`canReroll` 没完全删**——它还在 line 1261 那个"+" 菜单里的"重新生成"按钮（暮色需要从那里主动点）。只是**发送按钮**不再触发重 roll。
- **`showPlusMenu` 打开时 keyboard 自然收**（iOS 行为）→ textarea blur → 快捷键栏隐藏。这是符合暮色要求的。
- **TDZ 风险**：3 处改动都没新增 useState/useEffect 引用其他 const——OK
- **build 过**

## 备注

- **快捷键栏依然在 showInputBox=true 时显示**——但现在 onBlur 也会关掉
- **3 种状态流转**：
  - 初始 → showInputBox=false → 快捷键栏隐藏
  - 用户点输入框 → onFocus → showInputBox=true → 快捷键栏显示
  - 用户收起键盘 / 点别处 → onBlur → showInputBox=false → 快捷键栏隐藏
- **"+ 菜单"打开时**：用户点"+"按钮 → textarea blur（"+ 按钮"没 preventDefault）→ 快捷键栏隐藏 → "+ 菜单"弹出。**这是对的**——"+ 菜单"是独立功能
- **快捷键栏点齿轮 → 弹 modal**：齿轮按钮没 preventDefault → textarea blur → 快捷键栏隐藏 → modal 弹出。Modal 关闭后 → 快捷键栏仍隐藏（用户得重新点输入框）—— 暮色能接受这个行为
- **没改"+" 菜单"重新生成"按钮**——保留，用户主动从那里重 roll
