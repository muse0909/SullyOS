# 2026-08-27 聊天外观：自定义 CSS 改 inline 面板 + 快速预设合并

暮色 8-27 第四步：自定义 CSS 改回 inline 面板（紧邻"快速预设"），撤销 8-27 第三步做的"页签栏按钮 + 标准弹窗"方案。

## 改前（第三步的错误方案）

- "自定义 CSS" 按钮挪到浮层面板页签栏最左端（跟「快速预设」页签平级）
- 点击 → 弹 CustomCssModal 标准弹窗（fixed inset-0 + 黑遮罩 + 居中卡片）
- 浮层 page 0 仍是「快速预设」内容

暮色反馈截图问题：
1. 入口位置错了：按钮不应该扔到页签栏外，要**挨着「快速预设」**，**都在一个 groupClass 框里**
2. 不应该是弹窗：自定义 CSS 内容应该**直接放到设置框里**（inline 展示），跟"消息气泡/头像形状..."等 section 一样的样式
3. 紫色线位置：设置框应该**延伸到页面最底**，不留空

## 改后（第四步）

### 1. 「快速预设」+「自定义 CSS」合并成同一个 groupClass section

主区域「实时预览」section 下方新增**一个 groupClass section**（跟"消息气泡/头像形状..."等 section 同一种样式），分上下两部分：

```
+---------------------------------------------------+
| 快速预设                                          |  ← 灰色小标题
| 一键换整套聊天壳...                               |  ← 提示语
| [默认聊天] [WeChat] [Telegram] [Discord] [iMessage]|  ← 预设网格
| [沉浸剧场] [紧凑密聊] [像素终端]                  |
| ─────────────────────────────────────             |  ← 分割线
| 自定义 CSS                                        |  ← 灰色小标题
| [选择预设 ▼] [删除]                              |  ← 下拉菜单 + 删除按钮
| +----------------------------------+              |
| | textarea（多行 CSS 输入）         |              |
| +----------------------------------+              |
| [应用]  [保存为预设]  [清空]                      |  ← 底部 3 按钮
| 当前激活：xxx                                     |  ← 激活徽标
+---------------------------------------------------+
```

整个 section 用 `groupClass` 样式（`rounded-3xl border border-slate-100 bg-white p-5 shadow-sm`），是流式 section —— **能延伸到页面最底**（紫色线位置），不留空。

### 2. 浮层改成 5 页

「快速预设」从浮层 page 0 拎到主区域，浮层 PAGE_TITLES 改成 5 页：
- 聊天壳（原 page 1）
- 头部（原 page 2）
- 气泡与头像（原 page 3）
- 细节微调（原 page 4）
- 表情包与输入栏（原 page 5）

page 初值保持 0（默认展示「聊天壳」）。

### 3. 新增 CustomCssPanel 组件

新建 `components/appearance/CustomCssPanel.tsx`（**inline 组件，不是弹窗**）—— 把"自定义 CSS"那部分 state + UI 封装好。

逻辑跟之前的 CustomCssModal 一样：
- 顶部：下拉菜单 + 删除按钮
- 中间：textarea
- 底部：应用 / 保存为预设 / 清空 三按钮
- 激活徽标显示当前激活预设
- 保存为预设的小输入弹窗（用 fixed + z-[200] 浮在父 section 上）

state 全在组件内部（presets / activeName / selectedName / draft / savePromptOpen 等），不污染 ChatAppearanceEditor。

### 4. 修复生效问题（保留第三步的修法）

`syncUserCustomCssToDom` 改用 `appendChild 到 body 末尾`（不是 head）—— 按 DOM 顺序「后者覆盖前者」，user CSS 排在 React 渲染的 `<style>` 之后，盖过 chatFineTuneCss / chatChromeCustomCss。重复调用 = 移动节点 = 永远占 body 最末。

`index.tsx` 启动时 IIFE 简化为只调 `bootstrapUserCustomCss()`，后者自动 append 到 body 末尾。

## 关键设计决策

| 项 | 选择 | 理由 |
|---|---|---|
| 「快速预设」+「自定义 CSS」是否合并成同一 section | 合并 | 暮色原话"都在一个框里"= 同一 groupClass section |
| 形态 | inline section（不是弹窗） | 暮色原话"不是要做成弹窗，是都要放到设置那个框里" |
| 浮层是否删 page 0 | 删 | 「快速预设」已搬出，浮层只保留非"快速预设"的 5 页 |
| CustomCssPanel 抽成独立组件 | 抽 | state 全在内部，ChatAppearanceEditor 不被污染；以后想挪到别处也好挪 |
| 保存为预设的小输入弹窗 | 用 fixed + z-[200] 浮在父 section 上 | 父 section 是流式，弹窗浮在上面而不是破坏文档流 |
| 激活徽标位置 | 放最底下 | 顶部已被下拉菜单占据，徽标放底部一目了然 |

## 验证

- `npx tsc --noEmit` 没引入新错误
- `npx vite build` 通过（3.95s）
- `npx vitest run` 234/237 通过（3 个 VRScheduler 失败是 jsdom 缺 localStorage 的既有问题）
- 用户流程：外观 → 聊天界面 → 实时预览 section 下方就是"快速预设 + 自定义 CSS" section → 直接编辑 textarea → 点"应用"→ 立刻看到聊天页样式变化

## 涉及文件

- `components/appearance/CustomCssPanel.tsx`（**新文件**）
- `components/appearance/CustomCssModal.tsx`（**删除**）
- `components/appearance/ChatAppearanceEditor.tsx`：
  - 删 `customCssOpen` state（不再需要弹窗开关）
  - 删页签栏最左端"自定义 CSS"按钮
  - 删浮层 page 0（原"快速预设"内容）
  - PAGE_TITLES 改成 5 页：['聊天壳', '头部', '气泡与头像', '细节微调', '表情包与输入栏']
  - 浮层 page 0~5 → page 0~4（"聊天壳"变成 page 0）
  - 主区域"实时预览" section 后面**新增** groupClass section（"快速预设 + 自定义 CSS"），inline 渲染 CustomCssPanel
  - 删末尾的 `<CustomCssModal />` 挂载
- `utils/customCssPresets.ts`（**保留**第三步的 body 末尾 appendChild 修法 —— 跟当前实现兼容）
- `index.tsx`（**保留**第三步的启动 IIFE 简化）
