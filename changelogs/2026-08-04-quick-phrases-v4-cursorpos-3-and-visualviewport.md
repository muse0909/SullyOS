# 见面 app 快捷键 v4 — 光标位置 3 选 1 + 视觉视口监听

**日期**：2026-08-04
**涉及 commit**：`f56aef3`

## 改了什么

### 1. 光标位置 3 选 1（最前 / 中间 / 最后）

暮色反馈：之前 v2 加的「光标处」（在用户当前光标位置插入）识别不到——安卓 WebView 的 `selectionStart` 经常不准确。

改成 3 选 1 按钮，弹窗里和点击时都按这个走：

```ts
// types.ts
cursorPos?: 'start' | 'middle' | 'end'

// 快捷键按钮 onClick
const pos = p.cursorPos || 'end';
const insertAt = pos === 'start' ? 0
    : pos === 'middle' ? Math.floor(input.length / 2)
    : input.length;
const newInput = input.slice(0, insertAt) + p.content + input.slice(insertAt);
setInput(newInput);
requestAnimationFrame(() => {
    ta.focus();
    const cursorAfter = insertAt + p.content.length;
    ta.setSelectionRange(cursorAfter, cursorAfter);
});
```

`最前` → 文本开头 / `中间` → 文本正中间 / `最后`（默认）→ 文本末尾。光标位置和插入位置一致。

### 2. 视觉视口监听（visualViewport）— 键盘收快捷键自动隐藏

之前 v3 靠 `onBlur={() => setShowInputBox(false)}` 隐藏快捷键栏——但安卓 WebView 的 onBlur **不可靠**：点齿轮按钮已经加了 `onMouseDown preventDefault` 阻止 blur，但键盘收时不一定会触发 blur（手动点其他区域才会）。

改用 **visualViewport API**（安卓 5+ / iOS 13+ 都支持）：

```ts
useEffect(() => {
    if (!window.visualViewport) return;
    let prevKeyboardHeight = 0;
    const onResize = () => {
        const vh = window.visualViewport?.height || 0;
        const keyboardHeight = window.innerHeight - vh;
        // 只在「键盘从弹起到收起」时关闭快捷键栏
        if (prevKeyboardHeight > 100 && keyboardHeight < 50) {
            setShowInputBox(false);
        }
        prevKeyboardHeight = keyboardHeight;
    };
    window.visualViewport.addEventListener('resize', onResize);
    return () => window.visualViewport.removeEventListener('resize', onResize);
}, []);
```

关键设计：
- **跟踪 `prevKeyboardHeight`**——只在「键盘从有→无」时关，不在「键盘从无→有」时开（键盘弹起走 textarea onFocus）
- **阈值 >100 / <50**——避免误判（部分安卓机型会有 ~50px 的浮动）
- **modal 不受影响**——modal 打开时 keyboardHeight 不变，不会误关
- **关闭 modal 后**——modal 关闭 → 用户点 textarea 重新 focus → `onFocus` 触发 `setShowInputBox(true)` → 快捷键栏回来

### 3. 齿轮按钮 onMouseDown preventDefault

暮色反馈：安卓手机点齿轮按钮，键盘被收起来而不是弹出设置弹窗（Mac 正常）。

加 `onMouseDown={(e) => e.preventDefault()}`——阻止默认的"按下按钮让 textarea blur"行为，键盘保持弹起状态，弹窗正常弹出。

## 动了哪些文件

- `types.ts` —— `DateQuickPhrase.cursorPos` 类型从可选（无值）→ 3 选 1 联合类型
- `context/OSContext.tsx` —— `addDateQuickPhrase` 第三个参数类型同步
- `components/date/DateSession.tsx`：
  - 新增 visualViewport useEffect（line 235-256）
  - 弹窗光标位置段改 3 选 1 按钮（line 1545-1551）
  - 齿轮按钮加 `onMouseDown` preventDefault（line 1175）
  - 快捷键按钮 onClick 按 pos 算 insertAt（line 1208-1224）

## 踩坑 / 需要知道的

- **安卓 visualViewport 支持情况**：安卓 Chrome 5+ / WebView 80+ 都支持，老设备回退到 onBlur 行为（部分场景不完美，但够用）
- **iOS visualViewport**：iOS 13+ Safari 完美支持
- **visualViewport 事件触发时机**：`resize` 事件在键盘动画过程中会触发多次，跟踪 `prevKeyboardHeight` 避免每次都 setState
- **不要在 visualViewport 监听里 setShowInputBox(true)**——键盘弹起时 textarea onFocus 已经处理了，避免和 visualViewport 互相打架
- **modal 关闭后快捷键栏恢复**：modal 自带 onClose → setShowInputBox(false) 但不影响（因为 modal 还在 z-120+ 层），modal 关闭后 textarea 重新 onFocus 自动回来

## 备注

- 之前 3 个 modal 的 z-120 / z-130 / z-140 层级保持不变
- 发送按钮重做上一版（commit `b8e18d3`）暮色已确认 OK
- 暮色问的「Gemini 直连思维链全英文」问题不在本 PR 范围（是 model 行为，不是代码），下面单独回答
