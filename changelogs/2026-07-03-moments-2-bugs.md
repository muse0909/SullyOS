# 朋友圈 AI reaction + 签名点击 — 2 个真根因

**日期**：2026-07-03
**涉及 commit**：（本次即将创建）

## 改了什么

### Bug #1：发完朋友圈没 AI 反应（toast 弹了但啥都没有）
- 表面：暮色发完朋友圈 → "正在处理图片..." → "已发表" → "保存失败：activeCharacterId is not defined"
- 根因：`apps/MomentsPage.tsx` line 59 `useOS()` destructure **缺 `activeCharacterId` 和 `apiConfig`**，但 line 225-227 又引用了这两个变量
- 后果：ReferenceError 抛在 `try` 块内，被外层 catch 抓到 → 显示"保存失败" toast → 后续 trigger 流程没启动
- "toast 已发表" 是因为 `saveAllPosts` 在 220-222 行就成功 toast 了；ReferenceError 是在 225 行的 `if` 判断时抛的
- 修复：line 59 destructure 补 `activeCharacterId, apiConfig`

### Bug #2：签名点击没反应（iOS + Android 都不行）
- 表面：暮色点签名行（`button` 改过 3 次了），啥都不弹
- 根因：`apps/MomentsPage.tsx` line 385 `<FullScreenEditor>` **没传 `isOpen` prop**
- FullScreenEditor line 124 `if (!isOpen) return null;` —— `isOpen=undefined` 时直接 return null
- 暮色之前看到"点不动"——其实点击**触发了**，state 也变了，但 FullScreenEditor 因为 isOpen undefined 根本没渲染
- 之前 3 个 commit（1407e0a / 7be0a0a / d53bb07）改 button、改 div、touchAction 都没解决真根因
- 修复：line 390 加 `isOpen={editingSignature}`

## 动了哪些文件
- `apps/MomentsPage.tsx` —— useOS() destructure 补 2 个变量 + FullScreenEditor 补 isOpen prop

## 踩坑 / 需要知道的（重要）
- **TypeScript 不会报这种 destructure 缺失**：build 通过 = type ok，但 runtime ReferenceError
- 跟之前的心声弹窗 / useState 删除白屏是同一类问题：**build 不报 ReferenceError**，必须 runtime 触发
- 改 useOS() destructure 前要 grep 整个文件，**所有引用点**都要在 destructure 列表里
- FullScreenEditor 的 `isOpen` 是 **必填**（interface line 7，没 `?`），调用方必须传 —— 跟其他 7 个调用方对比能发现这个

## 备注
- 暮色图片里的 "保存失败：activeCharacterId is not defined" 是关键诊断线索 —— 用户截屏含报错文字
- 暮色"iOS + Android 都不行" ≠ 系统问题（iOS Safari / Chrome / Android 浏览器对 fixed modal 行为不同），是组件 prop 缺失的通用 bug
- 这次没加 console.log 让暮色反馈——因为根因已经明确，修完直接验证就行
