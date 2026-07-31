# 紧急修复：聊天页 TDZ 崩溃（coupleSpaceInviteResolved useEffect 位置错）

**日期**：2026-07-31  
**涉及 commit**：`4d03b3f`（修复）+ `ecd04e0`（触发 bug）

## 出错现场

暮色 22:45 反馈"聊天页炸了"：

```
App Crash: Cannot access 'Gs' before initialization
ReferenceError: Cannot access 'Gs' before initialization
    at r4 (https://sully-os-git-preview-muse0909s-projects.vercel.app/assets/index-yOR7W3q1.js:1667:13133)
    at Ae (.../vendor-react...)
    at Kt (.../vendor-react...)
    ...
```

`Gs` 是 minified 后的变量名——是我**新加**的 useEffect 闭包引用 `reloadMessages` 时，minifier 把它编成 `Gs`。

## 根因（TDZ：const 在声明前被引用）

**`ecd04e0` 这次 commit 在 `apps/Chat.tsx:730` 加了一个新 useEffect**：

```ts
useEffect(() => {
    if (!char?.id) return;
    const handler = (e: Event) => {
        ...
        reloadMessages(visibleCountRef.current);  // ← 引用 line 822 才声明的 reloadMessages
    };
    window.addEventListener('coupleSpaceInviteResolved', handler);
    return () => window.removeEventListener('coupleSpaceInviteResolved', handler);
}, [char?.id, reloadMessages]);  // ← deps array 在 render 时立即求值
```

但 **`const reloadMessages = useCallback(...)` 在 line 822 才声明**。

**React render 流程**：
1. 渲染组件函数（同步执行）
2. render 到 line 730 → 注册 useEffect
3. useEffect 的 **deps array 在 render 时立即求值** → `reloadMessages` 还**没**声明（line 822 才声明）→ **TDZ** → `ReferenceError: Cannot access 'Gs' before initialization`

**TS 不查、build 通过、运行时崩**——这是 const TDZ 的经典症状。

## 修法

**useEffect 挪到 `reloadMessages` 声明之后**（line 974）：
- 之前 emotion-updated useEffect 之后
- render 顺序：line 807 reloadMessages 已声明 → line 974 useEffect 求值 reloadMessages → **OK**

```diff
- // line 730: useEffect 引用 reloadMessages
+ // line 974: useEffect 引用 reloadMessages
```

## 动了哪些文件

- `apps/Chat.tsx`
  - **删除**：line 727-740 新 useEffect（在 reloadMessages 之前）
  - **新增**：line 972-985 同一 useEffect（在 reloadMessages 之后 + emotion-updated 之后 + 🛟 人格抢救之前）
  - 注释加一行说明：hooks 引用 forward 声明会 TDZ

## 踩坑 / 需要知道的（重要）

### TDZ 错误跟 memory 里的"const TDZ 顺序"教训一致

memory 里 7/24 笔记：
> **踩坑**：SullyOS `apps/Chat.tsx` 加角色 API 状态时，useState/useEffect 放在 `const char = ...` 上面（line 120 vs line 195），useEffect 闭包引用了 char。Build 通过、TS 不报错，运行时 `ReferenceError: Cannot access 're' before initialization`

**这次完全同一个坑**——只是从 `char` 变成了 `reloadMessages`。`useState`/`useCallback`/`useEffect` **不能** forward 引用其他 useState/useCallback/useEffect 声明的 const。

### 为什么 Chat 之前没崩

Chat 之前**所有** useEffect 引用 `reloadMessages` 的位置**都在 line 822 之后**：
- line 883: `}, [activeCharacterId, reloadMessages])` ← 之前就有
- line 898: `}, [activeCharacterId, reloadMessages])` ← 之前就有

`reloadMessages` 之前的 useEffect（line 680-725）**只**引用 `char?.id` 这种**早**声明的 const。**我新加**的 useEffect 第一次 break 这个不变量。

### useEffect deps array 在 render 时求值（不是 deferred）

**之前我的 mental model 是错的**——以为 useEffect deps 只在 useEffect 触发时（mount / deps 变时）求值。

**实际是**：useEffect **每次 render 都调用**（包括注册 + cleanup + 调度）——deps array 在 render 时立即求值，**不**等 useEffect 实际执行。所以：

- 闭包函数体在 render 时**只**生成（不执行）——闭包体内的 forward 引用**不**抛 TDZ
- **但** deps array 在 render 时**立即**求值——forward 引用的变量会抛 TDZ

**判断标准**：useEffect 的 deps array 跟函数体一样严格——**不能** forward 引用同文件 line 在它**之后**声明的 const。

### 防御（下次加 useEffect 前先 grep）

```bash
# 1. 加 useEffect 前先看函数体 / deps 引用了哪些变量
grep -n "useState\|useCallback\|useEffect\|const " <文件> | head -30
# 2. 看每个引用变量的声明位置
# 3. 新 useEffect 位置必须 > 所有引用变量的声明位置
```

**或者用 ref 解耦**：把 forward 引用改成 `xxxRef.current`（ref 在组件顶层早就 `useRef(null)` 声明了），避免 TDZ。

### 怎么快速定位 TDZ 是哪个变量

报错 `Cannot access 'Gs' before initialization` —— `Gs` 是 minified 后的变量名，**不是**组件名。

**定位步骤**：
1. 看 stack 里最底层的 `r4`（minified 后的组件函数）—— 是崩的组件
2. 看代码 + 报错时间，回想**最近**改过什么 useEffect / useCallback
3. 找新加的 useEffect 是否 forward 引用

**更直接**：把变量名加注释（比如 `// const reloadMessages` 后面加 `// TDZ-safe`），build 后的 source map 能看到原名。

## 备注

- 之前 commit `ecd04e0` 实际功能**没错**（接受/拒绝 UI 反馈、toast、卡视觉区分都对）——只是 useEffect 位置错了
- 修完 useEffect 位置后功能应该正常
- 建议暮色**刷新一次 Vercel 部署的页面**（强制跳过 Service Worker 缓存）
