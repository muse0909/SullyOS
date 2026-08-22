# 2026-08-22 ChatSettingsDrawer 漏 destructure — onToggleAutoDiary

**日期**：2026-08-22 22:50
**涉及 commit**：`403a2f68` 后续热修

## 症状

打开聊天设置 → 应用崩溃 → `ReferenceError: onToggleAutoDiary is not defined`

控制台：
```
ReferenceError: onToggleAutoDiary is not defined
  at r7 (index-DcMPZwpT.js:1193:94956)
  ...
App Crash: ReferenceError: onToggleAutoDiary is not defined
```

## 根因

跟 2026-07-31 的 `perCharApiProtocol` 漏 destructure bug **同款**：

- 加了 `autoDiaryEnabled` + `onToggleAutoDiary` props 到 `ChatSettingsDrawerProps` 接口 ✓
- 加了 UI section 调用 `onClick={onToggleAutoDiary}` ✓
- Chat.tsx 调用点加了 `autoDiaryEnabled` / `onToggleAutoDiary` props ✓
- **但漏了** `ChatSettingsDrawer` 内部 `const { ..., autoDiaryEnabled, onToggleAutoDiary, ... } = props;` 的 destructure

TypeScript 不会报错（interface 是声明形状，destructure 完全是另一回事）—— 运行时渲染才炸。

## 修复

`components/chat/ChatSettingsDrawer.tsx:131` 补一行：
```diff
-    emotionEnabled, onToggleEmotion,
-    imageGenEnabled, onToggleImageGen, playSongEnabled, onTogglePlaySong,
-    contextLimit, onSetContextLimit,
+    emotionEnabled, onToggleEmotion,
+    imageGenEnabled, onToggleImageGen, playSongEnabled, onTogglePlaySong,
+    autoDiaryEnabled, onToggleAutoDiary,
+    contextLimit, onSetContextLimit,
```

## 教训（以后改 ChatSettingsDrawer 必须 3 处同改）

| 步骤 | 改什么 | 不改会怎样 |
|---|---|---|
| 1 | `ChatSettingsDrawerProps` interface 加 prop | 调用方传 prop 时 TS 报错 |
| 2 | `const { ... } = props;` destructure 加变量名 | 渲染时 `ReferenceError`（**当前 bug**）|
| 3 | UI section 用该变量 | 不会炸，但没意义 |
| 4 | Chat.tsx 调用点传 prop | TS 报错 |

**关键**：3 处任一漏改，TS 编译不会报错（destructure 是运行时），只有运行时才崩。

参考：2026-07-31 那次 `perCharApiProtocol` bug 也漏了 destructure，修法一样（[`changelogs/2026-07-31-chatsettings-destructure-fix.md`](./2026-07-31-chatsettings-destructure-fix.md)）。

## 验证

- build 通过
- 打开聊天设置不再崩，"自动写日记"开关可见可点
