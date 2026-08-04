# 见面 app 快捷键 v6 + v7 — useRef 诊断 + 光标位置重定义「content 自身」

**日期**：2026-08-04
**涉及 commit**：`f873c4b`

## 改了什么

### v6（先加了诊断）

暮色 15:32 反馈：选了「中间」用时还是出现在最后。怀疑弹窗按钮没工作。

加 3 处 toast 诊断 + useRef 同步 cursorPos（兜底任何 React 批处理陷阱）：
1. 弹窗按钮 `setPhraseFormCursorPos` → toast「光标位置：中间」
2. `submitPhrase` → toast「保存 cursorPos = middle」
3. 快捷键按钮 onClick → toast「设置光标 X / 长 Y（应到 Z）」+ 100ms 后再一个 toast

暮色 15:42 反馈：**toast 全对**（显示「光标位置：中间」+「保存 cursorPos = middle」+「设置光标 2 / 长 2（应到 2）」+「100ms 后光标 2 / 长 2」），但用时光标依然在最后。

### v7（找到真正根因）

暮色 15:55 说「我设置的是标点符号比如【】光标我想要留下【光标】括号中间」+ 截图：input 是空的，content 是 `【】`，选「最前/中间」结果都是 `【】` 光标在末尾。

**根因**：
之前 v3-v6 把 cursor 设在「**input 字符的中间**」：
- `pos === 'middle'` → insertAt = `Math.floor(input.length / 2)`
- cursorAfter = `insertAt + content.length`

但暮色要的是**「content 自己的中间」**——把快捷键当**模板**用：
- 设置 `【】` → 点快捷键 → 出现 `【】` → **光标在 `【` 和 `】` 之间** → 接着打字 → `【用户内容】`

input 是空时，「input 字符中间」=「input 末尾」=「input 开头」——三个位置完全一样，所以「最前/中间/最后」效果相同。

**修复** — 重定义光标位置语义：

| 设置 | 旧语义 | 新语义（v7） |
|---|---|---|
| start | cursor 在 input 字符开头 + content 插 input 开头 | cursor 在 content 开头（`【` 之前）|
| middle | cursor 在 input 字符中间 + content 插 input 中间 | **cursor 在 content 自己中间**（`【` 和 `】` 之间）|
| end | cursor 在 input 字符末尾 + content 插 input 末尾 | cursor 在 content 末尾（`】` 之后）|

**新设计**：
- content **永远**加在 input 末尾（不破坏用户已输入的字）
- cursor 在 content 自身不同位置

```ts
const pos = p.cursorPos || 'end';
const inputLen = input.length;
const contentLen = p.content.length;
const newInput = input + p.content;  // 永远加在末尾

let cursorAfter: number;
if (pos === 'start') {
    cursorAfter = inputLen;  // content 开头
} else if (pos === 'middle') {
    cursorAfter = inputLen + Math.floor(contentLen / 2);  // content 自己中间
} else {
    cursorAfter = inputLen + contentLen;  // content 末尾
}
```

**用户场景**（content = `【】`）：

| input | 设置 | 点快捷键后 | 接着打字 | 结果 |
|---|---|---|---|---|
| 空 | 最前 | `【`\|`】` | X | `【X】` |
| 空 | 中间 | `【`\|`】` | X | `【X】` |
| 空 | 最后 | `【】`\| | X | `【】X` |
| 你好 | 最前 | `你好【`\|`】` | X | `你好【X】` |
| 你好 | 中间 | `你好【`\|`】` | X | `你好【X】` |
| 你好 | 最后 | `你好【】`\| | X | `你好【】X` |

## 动了哪些文件

- `components/date/DateSession.tsx`：
  - 快捷键按钮 onClick 重写（v7）—— content 永远加末尾，cursor 在 content 自身位置
  - `useRef` 同步 cursorPos（v6 兜底）
  - 3 处 toast 诊断（v6 临时诊断用，待后续 v7 确认 OK 后清理）

## 踩坑 / 需要知道的

### 我连续 4 版（v3-v6）都做错了

- v3：把 cursor 设到 `selectionStart`（用户当前光标位置）— 暮色说"识别不到"
- v4：改成 3 选 1（最前/中间/最后）— 但**语义还是「input 字符中间」**
- v5：用 `flushSync` 修 React 受控 input 重置 selection — 修对了技术问题
- v6：加 toast 诊断，发现 setSelectionRange 真的设了
- v7：**重新理解用户需求**——把语义从「input 字符中间」改成「content 自己中间」

**教训**：暮色一直说"光标位置"——我以为是"光标停在 input 的哪个位置"，实际是"光标停在 content 自身的哪个位置"。**当用户用【】这种 2 字符标点做模板时，必须把光标停在 content 自己的中间（【 和 】 之间）**才有意义。

**记忆口诀**：
- 「快捷键光标位置 = content 自身位置，不是 input 字符位置」
- 「模板场景：content 加末尾 + cursor 在 content 身上」

### 4 个版本才彻底解决 = 我没听清用户需求

- 暮色 15:23 第一次说「光标我选了中间，但实际用时还是出现在最后」
- 我以为是技术 bug（selection 被重置 / React 批处理）
- **实际上是我对"中间"的定义错了**
- 暮色 15:55 说「【光标】括号中间」我才意识到

**以后类似的歧义**：
- 用户用"标点符号 / 模板 / 容器"做 content 时 → cursor 默认要落在 content 自身中间
- 用户用"问候语 / 续写"做 content 时 → cursor 默认要落在 content 末尾
- 主动**问一句**比做 4 版更省事

## 备注

- 临时 toast 诊断（v6 加的）保留，v7 确认 OK 后清理
- 「最前」按钮的语义（cursor 在 content 开头 — 接着打字变成 `【X】`）是合理的——支持"在 content 开头插入"场景
- 弹窗里"光标位置 3 选 1"段不动——按钮文案「最前/中间/最后」仍然准确（cursor 在 content 自己的"最前/中间/最后"）
