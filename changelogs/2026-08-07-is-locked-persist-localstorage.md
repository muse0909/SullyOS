# 锁屏状态持久化 — 导入备份重启后 API 浮窗不显示修复

**日期**：2026-08-07
**涉及 commit**：（当前）

## 改了什么
- 修复"导入备份重启后 API 浮窗不显示"的 bug

## 根因
- `PhoneShell.tsx:341` 有 `if (isLocked) return <锁屏界面>` — 锁屏时整个 PhoneShell return 掉，`<ApiQuickFloat />` 根本不挂载
- `OSContext.tsx:519` `isLocked` 用 `useState(true)` 硬编码初始值 — **没持久化**
- 导入备份成功后会 `setTimeout(() => window.location.reload(), 1500)`（OSContext.tsx:3597）
- `reload` 后 React state 全部重置 → `isLocked` 又变回 `true` → PhoneShell return 锁屏 UI → 浮窗看不到
- 用户必须**点一下锁屏**才解锁看到浮窗，但**"导入备份重启"流程太快（1.5 秒）+ 弹 toast 提示"系统即将重启"**，用户没意识到要点屏幕

## 修法
- `isLocked` 改 lazy init：`useState(() => localStorage.getItem('sullyos_unlocked') !== 'true')`
- `unlock()` 时写 `localStorage.setItem('sullyos_unlocked', 'true')`
- reload 后能记住"已解锁"，直接跳过锁屏

## 动了哪些文件
- `context/OSContext.tsx` — `isLocked` lazy init + `unlock()` 写 localStorage（2 处）

## 备注
- **副作用**：用户点过锁屏解锁后，**永远不再锁屏**（除非手动 `localStorage.removeItem('sullyos_unlocked')` 或清数据）
- 这其实是**预期行为** — 导入备份是用户主动操作，没必要重启后又卡在锁屏
- 如果以后想加"无操作 N 分钟后自动锁屏"功能，需要新加 timer，不能直接 setIsLocked(true)（会覆盖 localStorage 持久化）
