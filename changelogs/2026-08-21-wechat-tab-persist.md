# WeChat tab 持久化（让相册/情侣空间返回时看到发现页）

## 背景

暮色 8-21 反馈：相册、情侣空间从发现页点进去 → 返回时看到"联系人页"，不是发现页。

朋友圈/收藏/小纸条/日记都正常返回到发现页，**只有相册和情侣空间不对**。

## 根因

不是 `parent` 参数错（parent 已经在第一次 closeApp 后被清成 null，第二次返回走的是 OSContext 默认 closeApp → 回桌面/回 Chat）。

**根因是 WeChat 内部 tab state 不持久化**：

| 入口 | WeChat 行为 | 返回时 |
|---|---|---|
| 朋友圈/收藏/小纸条/日记 | DiscoverPage 的 subPage — WeChat 不 unmount | subPage state 保留 → 看到发现页 ✓ |
| 相册/情侣空间 | 独立 app — openApp 触发 WeChat unmount | WeChat 重新 mount → `useState<TabKey>('messages')` 重新初始化 → tab='messages'（联系人页）✗ |

朋友圈等是 **DiscoverPage 内部 subPage state**（不触发 activeApp 切换），相册是**独立 AppID.Gallery**（openApp 切走 activeApp → WeChat unmount → 重新 mount 时 state 全部重置）。

## 改动文件

### 1. `context/OSContext.tsx` — 加 wechatTab 全局 state

**接口**（L318-321 区域）：
```ts
registerBackHandler: (handler: () => boolean) => () => void;
handleBack: () => void;
// 暮色 2026-08-21：WeChat tab 提到 OSContext — 独立 app 跳走/返回时保留 tab
wechatTab: 'messages' | 'discover' | 'me';
setWechatTab: (tab: 'messages' | 'discover' | 'me') => void;
```

**state**（parentApp 后面）：
```ts
const [wechatTab, setWechatTab] = useState<'messages' | 'discover' | 'me'>('messages');
```

**context value 暴露**：
```ts
registerBackHandler,
handleBack,
wechatTab,         // ← 新增
setWechatTab,      // ← 新增
```

### 2. `apps/WeChat.tsx` — 内部 tab 改用 OSContext

**`useOS()` 解构**（L21）：
```ts
const { ..., wechatTab, setWechatTab } = useOS();
```

**删 `useState<TabKey>('messages')`**（L24）—— 不再用组件内部 state。

**所有 `tab` / `setTab` 引用** 改成 `wechatTab` / `setWechatTab`：
- L107 `setTab('discover')` → `setWechatTab('discover')`（discoverTabRequestId handler）
- L152-158 三个 `{tab === 'X' && ...}` → `{wechatTab === 'X' && ...}`
- L156 `onClose={() => setTab('messages')}` → `onClose={() => setWechatTab('messages')}`（DiscoverPage 关闭）
- L169 `onClick={() => setTab(t.key)}` → `onClick={() => setWechatTab(t.key)}`（底栏 tab 切换）
- L171/L175 `tab === t.key` → `wechatTab === t.key`

**TabKey type 保留**（L9）：`type TabKey = 'messages' | 'discover' | 'me';` — WeChat 内部用，OSContext 用 `'messages' | 'discover' | 'me'` 字符串 union（等价）。

## 完整流程（验证后）

| 入口 | tab 切换 | 返回 |
|---|---|---|
| 桌面 → WeChat → 消息/发现/我 切换 | tab 切到底栏，OSContext 存 | — |
| 桌面 → WeChat → 朋友圈（subPage） | WeChat 不 unmount，subPage 切 | 朋友圈内"返回" → closeApp → 桌面 ✓ |
| 桌面 → WeChat → 联系人/Chat 切换角色 | openedCharId 变 | Chat 内"返回" → 回联系人 ✓ |
| **桌面 → WeChat → 发现 → 相册** | activeApp 切 Gallery，WeChat unmount | 相册"返回" → closeApp → activeApp=Chat → WeChat mount → wechatTab='discover' ✓ |
| **桌面 → WeChat → 发现 → 情侣空间** | 同上 | 同上 ✓ |

## 风险

- **聊天内"切到发现"按钮**（L99 ChatHeaderShell 右上角星星）：用 `requestOpenDiscoverTab()` 路径，**不走 setWechatTab**。需要检查这条路径在新方案下还工作。

让我看一下 `requestOpenDiscoverTab` 的实现 — 暮色 7-12 写的是用 `consumePendingDiscoverTab` + setTab('discover') 的组合，**新方案 setTab → setWechatTab 已同步改**。`requestOpenDiscoverTab` 本身不动，触发机制一样。

- **重置系统时 wechatTab 不重置**：系统设置里的"格式化系统（出厂设置）"应该把所有 state 重置。`resetSystem` 函数走的是 `DB.deleteDB() + localStorage.clear()`，**不直接清 OSContext state**——靠刷新页面让 OSProvider 重新 mount。刷新后 wechatTab 默认 'messages'。OK。

## 不在本轮做的

- WeChat 顶栏标题"联系人"硬编码（应该按 tab 动态显示"消息/发现/我"）—— 暮色没反馈，先不动
- 其他 app 的导航需求 — 这次只针对 WeChat tab
