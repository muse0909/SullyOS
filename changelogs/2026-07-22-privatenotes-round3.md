# 私密记事 — 第三轮：修 userProfile 报错 + 输入框交互改造

**日期**：2026-07-22
**涉及 commit**：pending
**前置**：`fc58cbd`（第二轮）+ `ee6c7e8`（收藏页修复）

## 改了什么

### 1. 修 `ReferenceError: userProfile is not defined`
暮色点私密记事设置齿轮后白屏，console 报 `userProfile is not defined at kk (Vercel 部署 index-DXNOOErq.js:1543:86840)`。

**根因**：上一轮 `fc58cbd` 我在 `PrivateNotesPage.tsx` SettingsDrawer 的 section 描述里写了：

```jsx
<p>默认会把这条提示词发给 AI：「这是一张你随手撕下来塞在 {userProfile.name} 口袋里的纸条...」</p>
```

这是 **JSX 文本** — `{userProfile.name}` 被 React 当成**表达式**求值。但 `userProfile` 在 SettingsDrawer 组件 scope 里**没定义**（SettingsDrawer 没用 `useOS()`，也没从 props 接收）→ ReferenceError。

注意：上一轮**默认 prompt 段**（`utils/chatPrompts.ts` 字符串模板）里 `{userProfile.name}` 是**正确的** — 那里 `userProfile` 是 `buildSystemPrompt` 函数参数。**但 SettingsDrawer 是 React 组件，不是字符串模板**。

**修法**：改成静态文字「塞在**对方**口袋里的纸条」（更通用，且不绑死暮色名字 — 琪琪那边也适用）。

### 2. 详情页输入框交互改造
暮色看图三：「输入框又被盖住了，改成在篮框位置增加个回复按钮，点一下弹出输入法，输入框贴在输入法上面」。

**新交互**：
- **默认不显示输入框** — 便签下方居中显示「💬 回复」按钮（胶囊，白底浅磨砂）
- **点回复按钮** → 自动聚焦 input，键盘弹起
- **键盘弹起监听**：`window.visualViewport.resize` 计算 `innerHeight - visualViewport.height = 键盘高度` → input 区 `bottom: keyboardHeight` 动态定位
- **取消 / 发送完** → 收起 input，回到「回复」按钮

**实现要点**：
- `isReplying: boolean` state 切换
- `keyboardHeight: number` state 跟 visualViewport
- input 用 `absolute bottom: keyboardHeight` 定位（不用 fixed — PhoneShell 里 fixed 经常踩坑）
- `useEffect` 监听 `visualViewport.resize` 仅在 `isReplying=true` 时挂载
- 自动 focus 用了 80ms setTimeout（让 React commit + 视觉过渡完成再 focus，避免键盘弹起时机错乱）

## 动了哪些文件
- `apps/PrivateNotesPage.tsx` — SettingsDrawer section 描述里 `{userProfile.name}` → "对方"（1 行）
- `components/notes/NotebookDetail.tsx` — 重写输入区：默认「回复」按钮 + 弹出 input + visualViewport 监听（约 60 行）

## 踩坑 / 需要知道的（重要）
- **JSX 文本 vs 字符串模板** — 上一轮我在 SettingsDrawer（React 组件）里写了 `{userProfile.name}` 当成"普通文字"，但 React 把花括号当成表达式求值。下次写**React 组件内的 description 文字**，别用 `${var}` / `{var}` — 想要变量从 context/props 拿，或者用静态文字
- **visualViewport 兼容性** — iOS Safari 13+ / Android Chrome 61+ 都支持，覆盖 95%+ 用户。比 `window.innerHeight` 监听更准（iOS Safari 不会因为 toolbar 收缩触发 false alarm）
- **absolute vs fixed 定位** — PhoneShell 整体是 `absolute inset-0`，子组件用 `fixed` 容易被父级 `transform/filter/backdrop-filter` 影响（changelog 2026-06-28 提过的踩坑）。这次 input 区用 `absolute left-0 right-0 bottom: ${kbh}px`，相对"内容层"定位
- **不是所有 keyboardHeight 都需要手动算** — iOS 17+ 有 `keyboard-inset-height` CSS env，但兼容性问题 + Android 不支持，先用 visualViewport 算更稳
- **输入区交互模式参考** — 微信朋友圈的"评论"按钮也是这套：默认胶囊按钮 + 点了才弹输入框 + 键盘联动。这次照着做的视觉

## 备注
- 暮色提了 4 件事 + 1 报错，这次先修报错 + 任务 2（输入框交互）。任务 3（小纸条样式自定义上传）/ 任务 4（简笔画小表情）/ 任务 5（贴纸系统调研）等暮色对方案拍板再做
- 报错来源：上一轮 `fc58cbd` 的 JSX 笔误，**我自己的锅**。下次写 React 组件文字描述要警觉
