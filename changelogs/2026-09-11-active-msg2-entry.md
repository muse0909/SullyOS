# 2026-09-11 归档：接上主动消息 2.0 弹窗入口

## 问题

SullyOS preview 分支里 `components/chat/ActiveMsg2SettingsModal.tsx` 存在但**没人 import**（孤儿组件），UI 上点不到。

upstream `apps/Chat.tsx:50` import 了这个 modal，但 SullyOS 的 `apps/Chat.tsx` 只接了 1.x 老弹窗（`ProactiveSettingsModal`），2.0 入口全缺。

## 改了什么

### 1. `apps/Chat.tsx`（+18 行）

接 4 处：

- **line 48**：加 `import ActiveMsg2SettingsModal from '../components/chat/ActiveMsg2SettingsModal';`（紧跟 ProactiveSettingsModal 那行）
- **line 183**：加 `const [showActiveMsg2Modal, setShowActiveMsg2Modal] = useState(false);`（紧跟 showProactiveModal 那行）
- **line 1519**：加 `case 'active-msg-2': setShowActiveMsg2Modal(true); break;`（在 handlePanelAction switch 里，紧跟 'proactive' case）
- **line 3470-3485**：加 `<ActiveMsg2SettingsModal ... />` JSX（紧跟 ProactiveSettingsModal JSX 后）

JSX 完整形态：
```tsx
{char && (
    <ActiveMsg2SettingsModal
        isOpen={showActiveMsg2Modal}
        onClose={() => setShowActiveMsg2Modal(false)}
        char={char}
        apiConfig={apiConfig}
        userProfile={userProfile}
        groups={groups}
        realtimeConfig={realtimeConfig}
        onSave={(config) => updateCharacter(char.id, { activeMsg2Config: config })}
        addToast={addToast}
    />
)}
```

### 2. `components/chat/ChatInputArea.tsx`（+10 行）

- **line 3**：import 加 `Alarm` icon（@phosphor-icons/react 已有 ChatCircleDots/CalendarBlank 等，再多一个 Alarm）
- **line 514-521**：在 1.x "主动消息"按钮**后**、日程按钮**前**，加 2.0 按钮：
  ```tsx
  <button onClick={() => onPanelAction('active-msg-2')} className={...}>
      <div className="...">
          <Alarm className="w-6 h-6" weight="bold" />
      </div>
      <span className="text-xs font-bold">主动消息 2.0</span>
  </button>
  ```

## 三处类型一致性

| 位置 | 字符串/类型 | 接收方 |
|---|---|---|
| `ChatInputArea.tsx:514` 按钮 onClick | `onPanelAction('active-msg-2')` | `ChatInputAreaProps.onPanelAction: (type: string, payload?: any) => void` ✓ |
| `apps/Chat.tsx:1519` switch case | `case 'active-msg-2':` | 字面量匹配 ✓ |
| `apps/Chat.tsx:1519` 触发 | `setShowActiveMsg2Modal(true)` | `useState<boolean>` ✓ |
| `apps/Chat.tsx:3480` modal onSave | `(config) => updateCharacter(char.id, { activeMsg2Config: config })` | `ActiveMsg2SettingsModalProps.onSave: (config: NonNullable<...>) => void` ✓ |

## 没改的（按你要求）

- 1.x 老弹窗 `ProactiveSettingsModal`（line 506-512 那段原样）
- `components/chat/ActiveMsg2SettingsModal.tsx`（已经上一轮 3cf80359 commit 改完了，本轮不动）
- Worker / Android / OSContext / index.tsx / 推送链路
- upstream 其他文件（amx2Tasks / amsgFirePack / pushSubscribeShared 等推送链路 utils）

## 验证

- **Vite build** ✅ 4.23s 通过
- **TypeScript** 错误数 **421**（无新增，跟存量错误数对齐）
- **diff stat**：`apps/Chat.tsx +18 / components/chat/ChatInputArea.tsx +10`（共 28 行 + 1 行 import 微调）

## 触发路径

现在 UI 上的完整链路：
1. 用户打开聊天页 → 点底部 `+` 按钮 → 弹出"操作面板"网格
2. 看到"主动消息"（1.x，紫色 ChatCircleDots 图标）+ **"主动消息 2.0"**（蓝色 Alarm 图标）两个按钮
3. 点"主动消息 2.0" → `onPanelAction('active-msg-2')` 触发
4. `apps/Chat.tsx` `handlePanelAction` switch case 'active-msg-2' → `setShowActiveMsg2Modal(true)`
5. `ActiveMsg2SettingsModal` 弹出来
6. 改完点"保存并同步" → `onSave(config)` → `updateCharacter(char.id, { activeMsg2Config: config })` 写回

## 风险

- 2.0 弹窗本身跟 upstream 接口**不一致**（config 形态 vs upstream 的 updater 形态），暮色上一轮拍板用 SullyOS 现有 config 形态，**这是设计选择不是 bug**
- 弹窗保存走 `ActiveMsgClient`（cloud worker），得 worker 端 `/api/active-msg` 接口已部署（暮色之前已经部署过，应该 OK）
