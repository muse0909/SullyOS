# 输入框 + 外观 + 气泡工坊 排版优化

**日期**：2026-06-28
**涉及 commit**：`b89bdbe`

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

## 备注
- 用户在原任务里说"前面改的两个一起 push 到预览分支"——指任务 1 和 2，一起 push 了
- 任务 4 排版和长文气泡相关的代码也在这一个 commit 里（用户说"做一版看效果"）
- 下次和用户讨论长文气泡的实现方案：是要"BubbleStyle 加 mode 字段"还是"加第二个主题预设字段"