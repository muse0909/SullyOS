# 2026-08-27 聊天外观：自定义 CSS 重构为标准弹窗 + 修复生效问题

暮色 8-27 第三步：自定义 CSS 编辑器从「右侧抽屉」改为「标准弹窗」，入口移到浮层面板页签栏最左端；同时排查并修复之前应用 CSS 没生效的问题（关键：style 标签挂到 body 末尾，而不是 head 末尾）。

## 改动 1：入口移出 + 平级

**改前**：
- 「快速预设」section 顶部右侧的"自定义 CSS"小按钮（674-682 行）→ 弹**右侧抽屉**

**改后**：
- 浮层面板页签栏最左端，跟「快速预设」页签按钮平级并列
- 点击 → 弹**标准弹窗**（fixed inset-0 + 黑遮罩 + 居中卡片，max-w-lg / h-[80vh]）
- page === 0 section 内部不再有"自定义 CSS"按钮，只留提示语 + 预设网格

视觉示意：
```
[‹] [自定义 CSS] [快速预设] [聊天壳] [头部] ... ›   ← 新位置（左起第二）
                                                  ← 跟「快速预设」页签平级
```

## 改动 2：标准弹窗内部布局

**改前**（旧 CustomCssDrawer 右侧抽屉）：
- 顶部：标题 + 当前激活徽标 + 关闭
- 提示文字："用 .sully-chat-root 锁定 / 需 !important / 跟白框自定义 CSS 和聊天细节共存"
- textarea + 4 个按钮：「实时预览」「保存为预设」「载入示例」「清空激活」（仅激活时）
- 下方：已保存的预设列表（每项：名字 + 头两行预览 + 应用/编辑/删除 3 按钮）
- 底部：保存为预设的小输入弹窗

**改后**（新 CustomCssModal 标准弹窗）：
- 顶部 title bar：标题 + 当前激活徽标（如果已激活）+ 关闭
- **顶部布局（下拉菜单 + 删除）**：
  - `<select>` 默认显示"选择预设"，展开列出所有预设名（激活项加"（当前激活）"后缀）
  - 选中某项 → 自动把 CSS 加载到下方 textarea（**不立即应用**）
  - 「删除」按钮 → confirm 后从 localStorage 删；删的是激活项则同时清激活 + 清空 style
- **中间**：textarea（多行 CSS 输入，等宽字体 + 深色底浅色字）
- **底部 3 按钮**：
  - **应用** → 把 textarea 当前内容**立即**注入到 `<style id="user-custom-css">` 并生效
  - **保存为预设** → 弹小输入框起名；同名覆盖；存到 localStorage + 立即应用
  - **清空** → 清空 textarea（不动 style 标签）
- 内嵌保存为预设的小输入弹窗（z 更高，盖在主弹窗上）

去掉了：提示文字、实时预览按钮、载入示例按钮、清空激活按钮、预设列表展示区。

## 改动 3：修复 CSS 不生效问题

### 根因
之前启动时 IIFE 把 `<style id="user-custom-css">` 挂到 **head 末尾**：
```js
el = document.createElement('style');
el.id = 'user-custom-css';
document.head.appendChild(el);  // ← 挂 head 末尾
```

但 Chat.tsx 渲染的 `<style>{chatFineTuneCss}</style>` 和 `<style>{chatChromeCustomCss}</style>` 是 React tree 的 `<div className="sully-chat-root">` 的子节点，物理位置在 **body 内的 div 里面**。

按 DOM 顺序「后者覆盖前者」：
- head 末尾的 user CSS（位置在 body 之前）
- body 内 div 里的 chatFineTuneCss / chatChromeCustomCss（位置在 body 之后）

→ 后面那俩反而**盖过**了 user CSS！这就是预览/应用没生效的根因。

### 修法
`syncUserCustomCssToDom` 改成 **appendChild 到 body 末尾**（不是 head）：

```js
el.textContent = css;
document.body.appendChild(el);  // 总是 move 到 body 末尾
```

**为什么 body 末尾能解决问题**：
- 启动时（React 还没挂载）→ user CSS 在 body 末尾
- React 挂载后 Chat.tsx 渲染的 `<style>` 在 body 内的 div 里面 → 物理上在 body 末尾的 user CSS **之前**
- 按 DOM 顺序，user CSS 胜出 → 总能盖过 chatFineTuneCss / chatChromeCustomCss

**appendChild 已存在节点 = 移动到末尾**（不是复制），所以每次"应用"都会重新占位，确保 user CSS 永远在 body 最末。

### 影响面
- `index.tsx` 启动时 IIFE 不再手动 `createElement` + `head.appendChild`——直接调 `bootstrapUserCustomCss()`，后者走新的 `syncUserCustomCssToDom`（自动 append 到 body 末尾）
- `syncUserCustomCssToDom` 兼容「找不到节点」的情况：自动 createElement + appendChild

## 关键设计决策

| 项 | 选择 | 理由 |
|---|---|---|
| 弹窗载体 | 自写（不套项目级 Modal） | Modal 写死 max-w-sm（384px），写 CSS 太窄；改 max-w-lg（512px）+ h-[80vh] |
| 下拉菜单 | 原生 `<select>` | 跟系统样式一致、零依赖、移动端自动调用原生选择器；写自定义 dropdown 反而要写一堆状态 |
| 应用 vs 保存为预设 | 拆分两个动作 | 应用 = 临时生效（不持久化）；保存为预设 = 持久化到 localStorage（保存后自动应用）；跟旧版「实时预览 + 保存为预设」二选一更清晰 |
| 保存为预设后是否立即激活 | 激活 | 用户保存了 = 想用 = 自动设为激活 + 立即应用，避开"存了但没生效"的歧义 |
| 删除激活预设 | 清空 style | 跟旧版行为一致（如果删的是激活的则同时清空激活名 + style），避免 UI 跟实际不一致 |
| 清空按钮 | 只清 textarea（不动 style） | 用户可能想重写——如果清 textarea 同时清 style，会误删已应用的样式 |

## 验证

- `npx tsc --noEmit` 没引入新错误（项目里既有的 413 个错误没增加）
- `npx vite build` 通过（3.83s）
- `npx vitest run` 234/237 通过（失败的 3 个 VRScheduler 测试是 jsdom 缺 localStorage 的既有问题，跟本次改动无关）
- 用户流程：外观 → 聊天界面 → 浮层面板页签栏最左端「自定义 CSS」→ 标准弹窗打开 → 改 textarea → 点「应用」→ 立刻看到聊天页样式变化

## 涉及文件

- `utils/customCssPresets.ts`（改 `syncUserCustomCssToDom`：appendChild 到 body 末尾）
- `components/appearance/CustomCssModal.tsx`（**新文件**，替代旧 CustomCssDrawer）
- `components/appearance/CustomCssDrawer.tsx`（**删除**）
- `components/appearance/ChatAppearanceEditor.tsx`（按钮移出到页签栏最左端 + 改 import + 删 page === 0 内部旧按钮）
- `index.tsx`（启动时 IIFE 简化，移除手动 createElement + head.appendChild）
