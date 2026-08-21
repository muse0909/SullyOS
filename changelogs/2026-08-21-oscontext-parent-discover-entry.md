# OSContext 加 parent 字段 + 发现页加相册入口（+ 情侣空间统一规则）

## 背景

暮色 2026-08-21 要求：
1. 从发现页打开相册 → 返回发现页（新规则）
2. 从桌面打开相册 → 返回桌面（保持原规则）

老架构 `openApp = setActiveApp` / `closeApp = setActiveApp(Launcher)` 实现不了"返回到上一级 app"。

**最初方案**：appStack 数组（push/pop）。暮色质疑后改成 **parent 字段**（轻量，1 级父），刚好覆盖 SullyOS 实际需求（1-2 级嵌套），多级场景用不上 stack。

## 改动文件

### 1. `context/OSContext.tsx` — 加 parentApp 字段

**接口**（L186）：
```ts
openApp: (appId: AppID, parent?: AppID) => void;   // parent 可选
```

**state**（L548 后面）：
```ts
const [parentApp, setParentApp] = useState<AppID | null>(null);
```

**实现**（L3886-3887）：
```ts
const openApp = (appId: AppID, parent?: AppID) => {
    setParentApp(parent ?? null);
    setActiveApp(appId);
};
const closeApp = () => {
    if (parentApp) {
        const target = parentApp;
        setParentApp(null);
        setActiveApp(target);
    } else {
        setActiveApp(AppID.Launcher);
    }
};
```

**不传 parent 的调用方**（所有桌面点 app 图标）保持原行为，关闭回桌面。

### 2. `apps/DiscoverPage.tsx` — 加相册入口 + 情侣空间补 parent

**顶部 import** 加 `Images` 图标。

**入口列表**（情侣空间前面加 GalleryEntry）：
```tsx
<GalleryEntry onClose={onClose} />
<CoupleSpaceEntry onClose={onClose} />
```

**新 GalleryEntry 组件**（照 CoupleSpaceEntry 写）：
```tsx
const GalleryEntry: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { openApp } = useOS();
    return (
        <button
            onClick={() => {
                onClose();
                setTimeout(() => openApp(AppID.Gallery, AppID.Chat), 50);
            }}
            className="...active:bg-indigo-50..."
        >
            <div className="...bg-indigo-50...">
                <Images size={16} className="text-indigo-500" />
            </div>
            <span>相册</span>
            <CaretRight />
        </button>
    );
};
```

**CoupleSpaceEntry 改**（暮色 8-21 决定统一规则）：
```tsx
// 改前
setTimeout(() => openApp(AppID.CoupleSpace), 50);
// 改后
setTimeout(() => openApp(AppID.CoupleSpace, AppID.Chat), 50);
```

## 关于 parent = AppID.Chat

**WeChat 不是独立 AppID**——它就是 `AppID.Chat`（`apps/WeChat.tsx` 是 Chat app 内部的视图，但 activeApp 流里就是 Chat）。所以从发现页（=Chat app 内部）打开相册，parent 传 `AppID.Chat`，相册 closeApp 时回 Chat，看到 WeChat 里的"发现"tab。

## 完整返回行为

| 入口 | 行为 |
|---|---|
| 桌面 → 相册 → 关闭 | 回桌面 ✓ |
| 桌面 → WeChat → 朋友圈/收藏/小纸条（subPage）→ 关闭 | 回桌面 ✓（不走 openApp，subPage 是 WeChat 内部 state） |
| 桌面 → WeChat → 情侣空间 → 关闭 | **回 WeChat（看到发现页）** ✓ 改了 |
| 桌面 → WeChat → 相册（从发现页）→ 关闭 | **回 WeChat（看到发现页）** ✓ 新行为 |
| 桌面 → 任意其他 app → 关闭 | 回桌面 ✓（不传 parent） |
| 桌面 → Chat（聊天页）→ 关闭 | 回桌面 ✓（Chat 自己的 registerBackHandler 处理"先回联系人列表再回桌面"） |

## 验证清单

1. ✅ 桌面 → 相册 → 返回 → 桌面
2. ✅ 桌面 → WeChat → 朋友圈 → 返回 → 桌面（不是 WeChat）
3. ✅ 桌面 → WeChat → 情侣空间 → 返回 → **WeChat 看到发现页**
4. ✅ 桌面 → WeChat → 相册（从发现页）→ 返回 → **WeChat 看到发现页**
5. ✅ 桌面 → 任意其他 app → 返回 → 桌面

## 已知边界

- **2 级嵌套限制**：parent 字段只支持 1 级父。如果未来有 A→B→C 三级需求，parent 会被覆盖（C 关闭回到 B，但 B 不知道自己从 A 来）。SullyOS 实际没这个场景，**等真有再升级成 appStack**。
- **`setTimeout 50ms`**：照 CoupleSpaceEntry 已有模式，避免 DiscoverPage 卸载时序冲突
- **OSContext 内部直接 setActiveApp 不走 openApp**（通知点击 deeplink 等，~10 处）—— 不影响，因为这些是 Chat app 内的导航，target 都是 AppID.Chat，跟"返回父"逻辑无关

## 后续要做

- 暮色手动回归测 5+ 个 app 关闭行为（重点测发现页进入的两个 app）
- 测出"该回桌面的没回桌面"或"该回 WeChat 的回桌面"→ 立刻定位 OSContext 那段
