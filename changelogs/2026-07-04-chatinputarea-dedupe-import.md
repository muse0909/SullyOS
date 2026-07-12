# ChatInputArea 重复 import 修复（dev 模式撞到的隐藏 bug）

**日期**：2026-07-04
**涉及 commit**：`700ce14`

## TL;DR

暮色跑 `npm run dev` 验证 settings 时撞到：
```
[plugin:vite:react-babel]
components/chat/ChatInputArea.tsx
Identifier 'ShareNetwork' has already been declared. (4:9)
```

两个相邻的 `import { ... } from '@phosphor-icons/react'`，ShareNetwork 和 Trash 重复 import。合并成一行 + 补 Copy（line 388 用了）。

## 关键教训：build 过 ≠ dev 过

**为什么 build 跑通但 dev 报错**：
- `npm run dev` 用 Vite 的 `@vitejs/plugin-react` 内部 `react-babel` 插件——**严格校验**（重复 import 直接报错）
- `npm run build` 用 esbuild + rollup——**会 tree-shake 死代码**（重复 import 默默吞掉）

**这意味着**：
- 之前 ChatInputArea 这段代码可能在 preview 上被其他 AI 工具窗口"改了一半"留的死代码
- build 完全跑过（esbuild tree-shake 把 ShareNetwork/Trash 第二个 import 吞了）
- 但 dev 模式 react-babel 严格校验，撞墙

**修复 = 手动合并重复 import**（1 行改动）。

## 动了哪些文件

- `components/chat/ChatInputArea.tsx` — 合并 2 行重复 import，Copy 补进去

## 备注

- **这是个隐藏 bug 的金丝雀**——下次 Vite 项目跑 dev 撞到 babel 错，先怀疑重复 import / 未使用变量
- **建议暮色以后**：
  - 改完代码**跑 dev 一次**确认能起（不要只信 build）
  - 撞到红屏就贴错误给我，比 build 过但 dev 红屏好排查
- 已写 memory（agent level）：Vite dev 模式 react-babel 严格校验 vs build esbuild tree-shake
