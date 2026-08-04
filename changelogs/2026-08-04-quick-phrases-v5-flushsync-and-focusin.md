# 见面 app 快捷键 v5 — flushSync 光标修复 + focusin/focusout 键盘监听

**日期**：2026-08-04
**涉及 commit**：`2a04d09`

## 改了什么

### 1. 光标位置 Bug 修复（暮色 15:23 反馈「中间」实际出现在最后）

**根因**：
之前 v4 用 `requestAnimationFrame` + `setSelectionRange` 在 React 受控 input 上**失效**：
- `setInput(newInput)` 是异步 setState
- `requestAnimationFrame` 之后 React 还没把新 value 提交到 DOM
- `ta.setSelectionRange(cursorAfter)` 基于**旧 value** 的 selection 设
- React 接下来 commit 时把 value 改成 newInput，**selection 被重置到末尾**
- 结果：无论选「最前 / 中间 / 最后」，光标最终都跳到末尾

**修复**：用 `react-dom` 的 `flushSync` 强制 React **同步** commit：

```ts
import { flushSync } from 'react-dom';

onClick={() => {
    const ta = inputRef.current;
    if (!ta) return;
    const pos = p.cursorPos || 'end';
    const insertAt = pos === 'start' ? 0
        : pos === 'middle' ? Math.floor(input.length / 2)
        : input.length;
    const newInput = input.slice(0, insertAt) + p.content + input.slice(insertAt);
    // flushSync 强制 React 同步 commit，setInput 后 ta.value 立即是 newInput
    flushSync(() => setInput(newInput));
    ta.focus();
    const cursorAfter = insertAt + p.content.length;
    ta.setSelectionRange(cursorAfter, cursorAfter);
}}
```

`flushSync` 是 React 18+ 官方提供的「同步提交」API，专门用于这种「setState 之后立即操作 DOM」的场景。

### 2. 键盘收快捷键不隐藏修复（暮色 15:23 反馈）

**根因**：
v4 用 `window.visualViewport.addEventListener('resize', ...)` 监听键盘弹起/收起——**部分安卓 WebView（小米 / 华为部分版本）不触发 `resize` 事件**，因为这些设备把软键盘做成系统级覆盖层，不调整 WebView 的视觉视口。

**修复**：换 **`document` 全局 `focusin` / `focusout` 监听**：

```ts
useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.tagName === 'TEXTAREA' || target === inputRef.current) {
            setShowInputBox(true);
        }
    };
    const onFocusOut = (e: FocusEvent) => {
        const fromTarget = e.target as HTMLElement | null;
        if (!fromTarget) return;
        if (fromTarget.tagName !== 'TEXTAREA' && fromTarget !== inputRef.current) return;
        // 延迟 100ms：等焦点稳定落点（避免点按钮时焦点跳到 button 触发误关）
        setTimeout(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active) {
                setShowInputBox(false);
                return;
            }
            if (active.tagName === 'TEXTAREA' || active === inputRef.current) return;
            setShowInputBox(false);
        }, 100);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
        document.removeEventListener('focusin', onFocusIn);
        document.removeEventListener('focusout', onFocusOut);
    };
}, []);
```

**关键设计**：
- `focusin` 冒泡到 `document`——比 `textarea.onFocus` 更稳定（覆盖所有 input 元素）
- `focusout` 延迟 100ms——等焦点稳定落点，避免点按钮时焦点跳到 button 触发误关
- **齿轮按钮** `onMouseDown preventDefault` 已经阻止了 `focusout`——不影响 modal 打开
- **modal 打开时** `activeElement` 是 modal 的 input → 不是 textarea → 自动隐藏（正确）
- **modal 关闭后**用户点 textarea → `focusin` → 显示（正确）
- **键盘收时** textarea 失焦 → `focusout` 触发 → 100ms 后 `activeElement === body` → 隐藏（正确）

**额外保险**：`textarea.onBlur` 也加 `setTimeout(100ms)` + 检查 `activeElement`——电脑端兼容（macOS Safari 的 focus 行为略有不同）。

## 动了哪些文件

- `components/date/DateSession.tsx`：
  - 顶部 `import` 加 `flushSync`（line 2）
  - visualViewport useEffect → focusin/focusout useEffect（line 235-273）
  - 快捷键按钮 `onClick` 加 `flushSync` 包裹 setInput，删 `requestAnimationFrame`（line 1224-1251）
  - textarea `onBlur` 加 setTimeout 100ms + activeElement 检查（line 1352-1360）

## 踩坑 / 需要知道的

### React 受控 input + setSelectionRange 经典坑

- **症状**：明明 setSelectionRange 在 rAF 里，但光标还是跳末尾
- **根因**：React 受控 input 在 commit 时会**重置 selection 到 value.length**——setSelectionRange 之后 React 提交时把 selection 又重置了
- **修复**：`flushSync(() => setState(...))` 强制同步 commit，setSelectionRange 时 value 已经是新值
- **记忆口诀**：「受控 input + setSelectionRange → 必须 flushSync」

### 安卓 WebView visualViewport 兼容性

- 安卓 Chrome 80+ / Capacitor 6 / iOS 13+ Safari 都支持 visualViewport
- **小米 / 华为部分版本不触发 `resize` 事件**——键盘做成系统覆盖层，WebView 视觉视口不变
- **focusin / focusout 是更稳的 fallback**——所有现代浏览器都支持
- 后续要测 Mac + iOS + 安卓（不同机型）三种场景

### focusin vs focus

- `element.onfocus` 不冒泡
- `element.addEventListener('focus', ...)` 在冒泡阶段不触发（focus 事件**不冒泡**）
- `element.addEventListener('focusin', ...)` **会冒泡**到 document
- **要监听全局 focus 变化，必须用 `focusin` / `focusout`**

## 备注

- v4 改动的 visualViewport 监听**完全删了**——focusin/focusout 替代
- 如果 v5 还有问题，下一个 fallback：**`MutationObserver` 监听 document.activeElement 变化**（最重，但是最稳）
- 暮色下午还问了「Gemini 思维链中文」问题——本 PR 范围外，单独答了（要做客户端翻译）
