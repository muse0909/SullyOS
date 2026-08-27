# 2026-08-27 聊天外观：自定义 CSS 抽屉 + 预装示例预设

暮色 8-27 第二步：在同步过来的 875 行 ChatAppearanceEditor「快速预设」section 顶部加「自定义 CSS」按钮，弹抽屉（textarea + 实时预览 + 保存为预设 + 预设列表），App 根插 `<style id="user-custom-css">` 注入并按 localStorage 激活预设启动加载。预装 `示例-暖色气泡` 让暮色知道格式和选择器怎么写。跟 chatFineTuneCss / chatChromeCustomCss 共存（3 个独立 style 标签，DOM 顺序后者覆盖前者——用户 CSS 排在最后面所以总能盖过默认）。

> 注：第一步（同步 chat appearance 完整对接）跟第二步（自定义 CSS 抽屉）一起 commit 在这次 commit 里。
> 此前第一步的 commit `2bfc4374` 因为 Vercel + Neon 集成抽风被 force 回滚到 7ad67266 整段作废。
> 这次是 chat appearance 整套（第一步 + 第二步）重新做完后第一次 push。

## 第一步重做（已删 commit `2bfc4374` 内容恢复）

### types.ts
14 个新 OSTheme 字段 + `ChatFineTuneFields` + `ChatFineTuneOverride` — 同之前

### 4 个新文件
- `utils/chatFineTuneCss.ts` + `.test.ts`（16 个单测全过）
- `utils/whiteboxSound.ts`
- `components/chat/ChatFineTunePanel.tsx`
- `components/chat/WhiteboxSoundEditor.tsx`

### `components/appearance/ChatAppearanceEditor.tsx`
整文件替换为 upstream 875 行最新版

### `apps/Appearance.tsx`
`resetAllChromeCss` + 传 `onResetAllChrome` / `onOpenApp`

### `apps/Chat.tsx`
注入 chatFineTuneCss + chatChromeCustomCss + 守护样式，加 `sully-chat-root` 类

### `components/chat/MessageItem.tsx`
加 5 个 sully-chat-* 类名

## 第二步（新增）

### `utils/customCssPresets.ts`（新）
- 类型 `CustomCssPreset = {name: string, css: string}`
- localStorage `custom_css_presets` = JSON 数组；`custom_css_active` = 当前激活预设名
- `loadPresets` / `savePresets` / `getActivePresetName` / `setActivePresetName`
- `ensureDefaultPreset`：首次打开 CustomCssDrawer 时若预设列表为空，预装 `示例-暖色气泡`（**不主动激活**，避免老用户进应用突然发现样式被改）
- `syncUserCustomCssToDom(css)`：把 CSS 注入 `<style id="user-custom-css">`，空串 = 清空
- `bootstrapUserCustomCss`：启动时按激活名查预设并注入
- 默认 CSS：`/sully-chat-root .sully-bubble-ai/`, `.sully-bubble-user { background: #fff5e6 !important; border-radius: 16px !important; }` + 顶栏浅暖色块

### `components/appearance/CustomCssDrawer.tsx`（新）
右侧滑出抽屉：
- **多行 textarea**（等宽字体 `ui-monospace` + slate-900 深色底 + slate-100 浅色字 + focus 蓝色边）
- **「实时预览」** 按钮：把当前 textarea 内容塞进 `<style id="user-custom-css">`，不动 localStorage
- **「保存为预设」** 按钮：弹小输入框起名字；同名已存在则覆盖
- **「载入示例」** 按钮：把默认 CSS 加载到 textarea（方便用户参考格式 / 选择器）
- **「清空激活」** 按钮（仅在有激活预设时显示）：移除激活名 + 清空 style
- **预设列表**：
  - 每项显示名字 + 头两行预览
  - 激活的高亮（emerald 边 + "激活" 标签）
  - **应用** 按钮：写入激活名 + 注入 style
  - **编辑** 按钮：把 CSS 加载到 textarea（不立即应用，等用户改完点实时预览）
  - **删除** 按钮：confirm 后从 localStorage 删；删的是激活则同时清激活
- 顶部 "当前：xxx" 徽标显示激活名
- 提示文案写清楚「!important 才能盖过默认」「跟白框自定义和聊天细节共存」

### `components/appearance/ChatAppearanceEditor.tsx`
- 顶部加 `customCssOpen` state
- `useEffect(() => ensureDefaultPreset(), [])` 首次挂载时预装示例
- page === 0（快速预设）section 顶部加「自定义 CSS」按钮（`<Code>` icon + primary 色边框 + primary/5 背景）
- 末尾挂 `<CustomCssDrawer onClose={...} />`（用 fragment 包裹，return 现在是 `<>{div + drawer}</>`）

### `index.tsx`
- import `bootstrapUserCustomCss`
- React 挂载前同步执行 IIFE：确保 `<style id="user-custom-css">` 元素存在 + 立即注入上次激活的预设 CSS
- 注入位置在 `<head>` 末尾；跟 `<App />` 内的 chatFineTuneCss / chatChromeCustomCss 是 3 个独立 style 标签，DOM 顺序：用户 CSS 最后 → 同优先级时后写胜

## 注入顺序与优先级

```
<style>{chatFineTuneCss}</style>           ← apps/Chat.tsx 注入（外观 → 聊天细节 微调）
<style>{chatChromeCustomCss}</style>       ← apps/Chat.tsx 注入（外观 → 白框自定义 CSS）
<style id="user-custom-css">{...}</style>  ← index.tsx 注入（用户自定义 CSS，抽屉管理）
```

3 个独立 style 标签，浏览器按 DOM 顺序后者覆盖前者。**用户 CSS 排最后，所以同优先级下总能盖过默认**。需要更稳可在选择器里加 `!important`。

## 共存验证

- 切换预设（ChatAppearanceEditor「快速预设」section）不影响 user-custom-css（两个是独立层）
- 「白框自定义 CSS」跟「用户自定义 CSS」都是 free-form CSS 选择器，命名空间都是 `.sully-chat-root`，叠加生效
- 「聊天细节微调」（chatFineTuneCss）跟「用户自定义 CSS」选择器都打气泡根/头像 slot，叠加生效；用户想盖过微调时加 `!important` 即可

## 验证

- `npx tsc --noEmit` 没引入新错误
- `npx vitest run`：chatFineTuneCss 16 个单测全过
- `npx vite build` 通过（4.00s）
- 用户流程：外观 → 聊天界面 → 「快速预设」section 顶部「自定义 CSS」按钮 → 抽屉滑出 → 改 textarea → 实时预览 → 保存为预设 → 重启 App 自动应用

## 涉及文件

第一步（重做）：
- `types.ts`、`utils/chatFineTuneCss.ts`+`.test.ts`、`utils/whiteboxSound.ts`
- `components/chat/ChatFineTunePanel.tsx`、`components/chat/WhiteboxSoundEditor.tsx`
- `components/appearance/ChatAppearanceEditor.tsx`
- `apps/Appearance.tsx`、`apps/Chat.tsx`、`components/chat/MessageItem.tsx`

第二步（新增）：
- `utils/customCssPresets.ts`（新）
- `components/appearance/CustomCssDrawer.tsx`（新）
- `components/appearance/ChatAppearanceEditor.tsx`（接入）
- `index.tsx`（启动注入）
