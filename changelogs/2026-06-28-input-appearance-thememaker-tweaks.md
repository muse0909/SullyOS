# 输入框 + 外观 + 气泡工坊 排版优化

**日期**：2026-06-28
**涉及 commit**：`b89bdbe` `6d3ef95` `efea596`

## 改了什么

### 1. 全屏按钮搬进输入框（ChatInputArea.tsx）
- 原来：`[+加号] [全屏] [输入框+表情包] [AI]`，左右不对称
- 现在：`[+加号] [全屏|输入框|表情包] [AI]`，全屏按钮移到输入框**最左**，和右侧表情包 Smiley 对称
- Plus（action panel 触发器）保留在输入框外，因为它会展开一个 8 按钮大面板

### 2. 外观 app 聊天预览固定顶部（Appearance.tsx）
- 标题栏 `h-20` (80px) → `h-14` (56px)，缩 24px
- 标题字号 `text-xl` → `text-base`，回退箭头 `w-6` → `w-5`
- Live Preview section 加 `sticky top-[100px] z-10` —— 滚动时**一直浮在 tab bar 下方**
- 预览框内部整体缩小：
  - 头部 `py-3` → `py-1.5`，字号 `text-xs` → `text-[11px]`
  - 气泡 `text-[11px] px-3 py-2` → `text-[10px] px-2.5 py-1.5`
  - 输入框 `py-2` → `py-1`，字号 `text-[10px]` → `text-[9px]`
  - 整体外 section padding `p-5` → `p-4`，下面的所有 section 也同步

### 3. 气泡工坊重排（ThemeMaker.tsx）
- **返回键改回外观定制**：`closeApp()` → `openApp(AppID.Appearance)`，不再直接跳桌面
- **toolbar 重排为单行**（横向滚动）：
  `[日常聊天] [长文] [回复链] [图片混排] [深色壁纸] · [背景▢][深色▢] · [对比▾] [全屏]`
- **去掉右上角"可读性 A/B/C"字母徽章**（用户没看懂这个指标）
- **A/B 对比改弹窗按钮**：
  - 按钮名字只写"对比"（高亮时表示当前在非单预览模式）
  - 点击弹出小弹窗（44px 宽），内含：单预览 / 左右分屏 / 一键切换
  - 当切到"一键切换"模式，弹窗底部额外显示 A 当前编辑 / B 上次保存 两个按钮
  - 点击弹窗外（absolute inset-0 backdrop）关闭弹窗
- **全屏预览改 React Portal**：原来 `fixed inset-0 z-[120]` 被 PhoneShell line 451 的 `flex-1 relative overflow-hidden` 裁掉，现在用 `createPortal(previewArea, document.body)` 绕过所有 overflow-hidden 祖先
  - 非全屏：previewArea 在 ThemeMaker 内正常渲染
  - 全屏：previewArea portal 到 body 下，全屏显示
  - 弹窗 absolute 定位在 white panel 内，portal 出去后位置仍然正确

## 动了哪些文件
- `components/chat/ChatInputArea.tsx` —— 全屏按钮位置
- `apps/Appearance.tsx` —— 标题栏 + Live Preview 缩放和 sticky
- `apps/ThemeMaker.tsx` —— 返回逻辑、toolbar 重排、对比弹窗、全屏 Portal

## 踩坑 / 需要知道的

1. **全屏预览不真全屏的根因**：
   - PhoneShell line 451 `<div className="flex-1 relative overflow-hidden">` 和 line 452 `<div className="absolute left-0 right-0 bottom-0 overflow-hidden">` 都有 overflow-hidden
   - 加上 line 427 的 background 有 `transform: scale(1.1)` 动画，导致 `fixed` 元素的 containing block 变成这个 background 层
   - 祖先有 transform + overflow-hidden → fixed 元素被裁
   - 解法：React Portal 挂到 body，绕过所有祖先
   - ⚠️ 如果以后哪个 app 也要全屏 modal，记得同样用 Portal

2. **弹窗 backdrop 用 absolute inset-0，不是 fixed**：
   - 用 fixed 会被祖先 transform 影响位置（fixed 的 containing block 改成 transform 祖先）
   - 用 absolute inset-0 相对最近的 relative 祖先（Preview Area），范围正好是 Preview Area 内部
   - 点击 Preview Area 内任意空白（非弹窗、非工具栏）都会关闭弹窗

3. **toolbar 单行布局可能溢出**：
   - 5 个场景按钮 + 2 个 checkbox + 间隔符 + 对比 + 全屏，总宽可能超过 max-w-sm (384px)
   - 用 `overflow-x-auto` 横向滚动兜底
   - 如果以后加更多场景/选项，考虑改两行或用弹窗收纳

4. **"长文气泡"功能未做**：
   - 用户提了个新需求：气泡样式里增加"长文/日常"开关（日常=换行分段，长文=整段一个气泡）
   - 这是个**新功能**，需要改 BubbleStyle 类型 + MessageItem 渲染逻辑
   - 见面 app 已经引用了 `dateLongformBubblePresetId`（DateSession.tsx line 712），见面场景已有"长文"概念但其他场景没有
   - **下一轮**再讨论：是要所有 app 都支持、还是只在气泡工坊加个开关、还是见面 app 的逻辑要扩展
   - 当前 commit 不包含这个改动

5. **可读性 A/B/C 字母未删代码逻辑**：
   - 只删了右上角徽章的 UI 显示
   - `overallContrastScore` 状态、`oneClickFixContrast` 函数、低对比度保存确认弹窗都保留
   - 因为低对比度警告和保存拦截是 **有实际保护作用**的，不能因为 UI 不显眼就删
   - 如果用户后续确认不再需要，可以一起删

6. **sticky 容器 = 滚动祖先**（不是 ThemeMaker root）：
   - 之前以为 sticky 不生效是因为 ThemeMaker 没滚动容器
   - 实际上 `overflow: hidden` 也算滚动祖先（虽然不能滚，但 sticky 把它作为 containing block）
   - PhoneShell line 451 `flex-1 relative overflow-hidden` 就是 ThemeMaker 的 sticky 容器
   - Appearance 的滚动容器是 `<div className="flex-1 overflow-y-auto p-5 ...">` (line 670)，sticky 元素 relative 这个容器
   - 所以 sticky top-0 = 容器可视顶，容器可视顶 = PhoneShell 标题栏下方 / tab bar 下方

7. **sticky 元素必须放在 flow 第一个**：
   - 之前 Live Preview 在"快速风格"后面，sticky 起作用但起始位置在快速风格下面
   - 滚动后 Live Preview 会从"快速风格下面"那个位置停到 top-0
   - 看起来像"sticky 没生效"但其实是位置不对
   - 解决：把 sticky 元素移到 flow 第一个

## 第二轮改动（commit 6d3ef95）

### Live Preview 重新排版（Appearance.tsx）
- Live Preview 移到 flow 第一个（"快速风格"前面）
- `sticky top-0 -mt-5 z-20`：负 margin -mt-5 让 section 顶部 = 容器内顶（绕过 padding）
- 整条 bg-white，无圆角（border-b 替代 rounded-3xl）
- 高度约 172px（屏幕 600px 的 ~29%），接近 1/3
- 标题字号略缩：text-sm → text-[11px]

### Toolbar 整条 sticky（ThemeMaker.tsx）
- toolbar 从 Preview Area 内部提到 Preview Area **顶部**
- `sticky top-0 z-30 bg-white border-b border-slate-200 shrink-0`
- 紧贴 Header 下方，整条白底无圆角
- 只保留 5 场景按钮 + 对比按钮（去掉 背景/深色 checkbox 和全屏按钮）
- 对比弹窗位置：`top-12 right-4` (toolbar 下方屏幕右侧)
- 弹窗内容：单预览 / 左右分屏 / 一键切换 + 分隔线 + A 当前编辑 / B 上次保存（**常驻**，不再藏在 toggle 模式下）
- 弹窗 backdrop：`top-12 left-0 right-0 bottom-0`，限定在 toolbar 下方
- 聊天内容独立滚动容器 `flex-1 overflow-y-auto`

## 第三轮改动（commit efea596）

### 删除全屏预览逻辑（用户要求整个删掉）
- 删 `isPreviewFullscreen` state
- 删 `createPortal` import 和 portal 渲染分支
- Preview Area 改成 `flex-1 bg-slate-100`（去掉 fixed inset-0 全屏变体）
- 删 Editor 的 `!isPreviewFullscreen &&` 条件包裹

### 对比改 toggle 开关
- 删 `showComparePopover` state + 弹窗 JSX + backdrop
- 删 `previewCompareMode` state（split/toggle 模式不再用）
- 加 `ToggleSwitch` 组件：iOS 风格 toggle（小白球左右滑动 + ON/OFF 标签）
  - props: `checked`, `onChange`, `leftLabel`, `rightLabel`
  - 大小：w-9 h-5，translate-x-[16px] 切换
- toolbar 第二个按钮：**当前/上次** toggle（控制 `previewToggleTarget` A/B）

### 深色壁纸改 toggle 开关
- PREVIEW_SCENES 去掉 `dark-wallpaper` 场景（场景数 5 → 4）
- toolbar 第三个按钮：**浅色/深色** toggle（控制 `isPreviewDark`）

### toolbar 新布局
```
[日常聊天] [长文] [回复链] [图片混排] | [当前/上次◯] | [浅色/深色◯]
```

### 圆角清理
- Editor 顶部去掉 `rounded-t-[2.5rem]`（改成直的）
- chat content 容器去掉 `rounded-2xl`（改成直的）
- toolbar 底部只用 `border-b border-slate-200` 分隔

### 提示文字删除
- 删 "A 为当前编辑，B 为上次保存版本"（蓝色框提示）

## 踩坑 / 需要知道的

1. **全屏预览逻辑彻底删除**
   - 不再能进入"全屏只显示聊天预览"模式
   - `isPreviewFullscreen` state 已删
   - React Portal 代码也已删
   - 如果以后想加回来，需要重新引入 state + portal

2. **previewCompareMode 状态彻底删除**
   - 之前有 single/split/toggle 三种模式
   - 现在只用 `previewToggleTarget` 控制单预览时显示 A 还是 B
   - 左右分屏模式不再支持（用户没明确说要保留，弹窗里也没了入口）

3. **`renderPreviewBubble` 中的判断简化**
   - 之前：`previewCompareMode === 'toggle' && previewToggleTarget === 'B' ? lastSavedTheme : editingTheme`
   - 现在：`previewToggleTarget === 'B' ? lastSavedTheme : editingTheme`

4. **ToggleSwitch 组件位置**
   - 放在 `PREVIEW_SCENES` 常量下方，模块顶层
   - 后续如果其他页面需要 toggle 开关，可以复用

5. **PREVIEW_SCENES 删了 dark-wallpaper**
   - 如果以后想"看深色壁纸下的气泡效果"，可以用 toggle 开关切换深色，然后切换场景（如长文）看效果

## 备注
- 第三轮精简后 toolbar 只有 6 个元素（4 场景 + 2 toggle），非常紧凑
- 删的代码 ~95 行，新增 ~50 行，净减 45 行
- 下一步：长文气泡功能（用户上一轮就要求讨论）