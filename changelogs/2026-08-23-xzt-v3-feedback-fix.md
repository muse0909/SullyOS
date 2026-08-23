# 2026-08-23 小纸条 v3 反馈修复：未拆封空白 + 老数据兜底 + destructure 漏改

## 暮色 8-23 15:38 反馈

### 反馈 1："不要未拆封，空白就行"
之前 commit 4 在 `revealedAt == null` 状态下显示 📩 + "未拆封" 占位。暮色觉得太繁琐，改成"纯空白"。

### 反馈 2："小纸条样式我选了系统便签，是不是以前的不会换成系统便签的样式了？只有新的才可以？"
之前 commit 1 的渲染逻辑：`!useImage && note.style ? note.style : ''` —— 老纸条 `note.style == null` 时 className 空字符串，走纯白兜底。暮色希望老纸条**也**用新便签 CSS。

**修法**：渲染时 fallback 到 `note-pink` 默认便签（不动 DB，老数据不污染）。

### 反馈 3："小纸条点不开了"
```
ReferenceError: onMarkRevealed is not defined
at index-CszgdFgg.js:1670:74239
```
**第三次栽在 destructure 漏改**（7-31 perCharApiProtocol、8-22 autoToggleAutoDiary、8-23 onMarkRevealed）。

上次 memory 里写了"ChatSettingsDrawer 改 prop 必须 4 处同改"，但**这条规则没扩展到普通组件**——任何 `interface Props { ... }` 加 prop 都得同时改：
1. interface
2. 组件内 `const { ..., 新变量, ... } = props` destructure
3. UI 用
4. 调用点传 prop

## 改了什么

### components/notes/XiaoZhiTiaoDetail.tsx
- 补 destructure：`({ note, charName, onBack, onDelete, onAddReply, onMarkRevealed })` — 之前漏了 `onMarkRevealed`
- FullXiaoZhiTiaoCard 未拆封态从 📩 + "未拆封" → 空白（条件 `isRevealed && (...)` 改为只渲染已看过的内容）
- 便签 className fallback：没 `styleImageUrl` 且没 `style` → 默认 `note-pink`

### components/notes/XiaoZhiTiaoCard.tsx
- 同款修复
- `noteClassName = useImage ? '' : (note.style || DEFAULT_FALLBACK_STYLE)`（`DEFAULT_FALLBACK_STYLE = 'note-pink'`）
- `isRevealed && (...)` —— 未拆封时便签 div 内部什么都不渲染
- 删了 `noteClassName ? undefined : { backgroundColor: '#ffffff' }` 兜底（CSS 类名由 builtinNoteStyles.css 决定）

## 涉及文件

- `components/notes/XiaoZhiTiaoDetail.tsx` 补 destructure + 空白态 + className fallback
- `components/notes/XiaoZhiTiaoCard.tsx` 同款

## 验证

- build 通过（4.12s）
- 点击小纸条不再崩（`onMarkRevealed` 找到）
- 未拆封态：便签 div 内部完全空白（无 📩 / 无文字 / 无任何标记）
- 老纸条（没 `style` 字段）：渲染默认 `note-pink` 便签（粉色便签 + 角钉装饰）
- 新纸条（`[[XIAO_ZHI_TIAO: ...]]` 解析时存 `style = 'note-pink' / note-grid / ...`）：按写入时的 CSS 渲染
- `styleImageUrl` 存在：仍走图（用户上传图优先）

## destructure 漏改教训（第三次！）

暮色 7-31、8-22、8-23 三次栽在同一坑——加 prop 漏 destructure 改，TS 编译不报错，运行时崩。

之前 memory 写的是"ChatSettingsDrawer 必须 4 处同改"，但实际是**所有** React 组件都该遵守：interface + destructure + UI + 调用点。

**预防**：以后给任何 React 组件加 prop，**立刻在 destructure 行加新变量**（按字母序或按接口顺序），不要等"用的时候再加"。
