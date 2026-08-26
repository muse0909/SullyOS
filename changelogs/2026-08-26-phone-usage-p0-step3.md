# 2026-08-26 角色查手机 — P0 第 3 步：设置页 toggle + 权限引导 + 4 type 完整支持

暮色 8-26 20:29 决定"mock 逻辑通过，开干 commit 3"。

## 这次落地内容

### 1. types.ts 加 `CharacterProfile.phoneUsageEnabled`

```ts
// 暮色 2026-08-26 角色查手机 P0：
//   - true：开，AI 工具列表里有 get_phone_usage（默认开）
//   - false：关，工具不出现在请求体
//   - undefined：老用户兜底——等同 true（保持现有行为，跟 imageGenEnabled / playSongEnabled 一致）
//   系统权限（PACKAGE_USAGE_STATS）独立存，不放 character 字段里（设备级不是角色级）
phoneUsageEnabled?: boolean;
```

跟 imageGen / playSong **同款模式**：`!== false` 兜底，老用户升级不受影响。

### 2. useChatAI.ts 条件化注册

```diff
- toolsList.push(PHONE_USAGE_TOOL);
+ if (char.phoneUsageEnabled !== false) {
+     toolsList.push(PHONE_USAGE_TOOL);
+ }
```

关闭时工具不出现在请求体（LLM 看不到 schema，不会调）。

### 3. ChatSettingsDrawer 加 UI section（**4 处同改**）

按 8-23 memory "React 组件加 prop 4 处同改" 一次性全改：

| 位置 | 改动 |
|---|---|
| `interface ChatSettingsDrawerProps` | 加 `phoneUsageEnabled` / `phoneUsageGranted` / `onTogglePhoneUsage` / `onOpenPhoneUsageSettings` |
| 组件 destructure | 加新变量 |
| UI section | toggle 圆球 + 引导 banner（`bg-cyan-500` 主色 + `bg-cyan-50` 提示底） |
| Chat.tsx 调用点 | 传新 prop |

**UI 设计**（紧跟放歌 section）：
- 标题"查手机使用"
- 副标题"开启后，AI 可调 get_phone_usage 查询你的手机使用情况"
- toggle 圆球用 **cyan-500**（清新蓝绿）— 跟现有 violet 紫（生图）/ violet 紫（放歌）/ emerald 绿（语音）区分
- **引导 banner**：开启 + 未授权时显示
  - `bg-cyan-50` 浅底 + `border-cyan-100`
  - 提示文案"还需要开启系统'使用情况访问'权限，AI 才能查到你真实的手机数据"
  - cyan-500 "去授权" 按钮（直跳系统设置页）

### 4. Chat.tsx 加 handler + state

**新 state**：
```ts
const [phoneUsageGranted, setPhoneUsageGranted] = useState<boolean>(true);
```
web 端永远 true（mock 不需要权限）。

**新 handler**：
- `handleTogglePhoneUsage` — 开时先调 `phoneUsage.checkPermission()`，写入 state；写 char 开关 + toast
- `handleOpenPhoneUsageSettings` — 调 `phoneUsage.requestPermission()` 跳系统设置页

**新 useEffect**：drawer 打开时检查一次权限（用户从系统设置回来时状态能更新）

**调用点**：4 个新 prop 全传

## 暮色 8-26 18:12 规格对照

暮色 4 个 type 完整支持 — **commit 2 已完成 4 个 type 的 dispatch + 自然语言格式化**，commit 3 是收尾的 UI/权限层。

| 暮色规格 | 落地位置 |
|---|---|
| getCurrentApp() | commit 1 Kotlin / commit 2 TS 桥 + dispatch |
| getAppUsageToday() | 同上 |
| getTotalScreenTimeToday() | 同上 |
| getRecentApps({limit}) | 同上 |
| 类型分发（4 个 type） | commit 2 dispatch 块（`switch (puType)`） |
| 权限引导 | **本 commit**（drawer 引导 banner + 跳设置页） |
| 设置页 toggle | **本 commit**（ChatSettingsDrawer） |

## 验证

- `npx tsc --noEmit`：0 新错（pre-existing 413 个跟我无关）
- `npx vite build`：4.51s 通过
- 4 处同改（interface / destructure / UI / 调用点）**一次到位**，没栽 8-22/8-23 那个"漏 destructure"的坑

## 暮色下一步

1. **重启 vite dev**（让 main bundle 重新加载 types.ts 改动）
2. 进江澈聊天 → 设置面板 → 找"查手机使用" toggle
3. **web 端测试**：
   - 打开 toggle → 不会弹引导（web 永远 granted）
   - 关掉 toggle → 跟江澈说"我刚才在刷什么" → LLM 应该**不**调 get_phone_usage（工具不在请求体里）
4. **commit 4（AI prompt 补充 P1）**：让 LLM 知道什么时候该主动关心（不是被动等用户问）

## 关联

- 8-23 memory "React 组件加 prop 必须 4 处同改" — 这次**一次到位**，interface / destructure / UI / 调用点**都改了**（没栽）
- 7-31 memory "AI 感知 system 消息" — `phoneUsageEnabled` 是**用户主动**设置，不是 system 主动引用 — 不算"主动关心"触发
- 8-14 memory "缩 description 节省 token" — PHONE_USAGE_TOOL description 跟生图/放歌同款 ~200 字符核心规则
- 8-25 memory "commit + push preview 默认，merge master 特权" — commit 3 同样只 push preview
