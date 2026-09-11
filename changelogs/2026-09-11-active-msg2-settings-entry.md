# 2026-09-11 归档：系统设置页接上主动消息 2.0 全局入口

## 问题

SullyOS preview 上 `ActiveMsgGlobalSettingsModal`（2.0 全局弹窗）虽然在 `apps/Settings.tsx:28` import、在 `apps/Settings.tsx:2600` 渲染了，但**入口的按钮被 `AMSG2_ENABLED=false` 挡了**——UI 上看不到、点不到。

聊天页的 2.0 入口（commit `3c873a83` 接的）已经有了，但**全局设置入口（Cloudflare Worker URL / 租户）** 在 Settings 页里被 feature flag 短路。

## 改了什么

只动 `apps/Settings.tsx`，去掉两处 `{AMSG2_ENABLED && ( ... )}` 包装：

### 1. 入口 section（line 2521-2550）

**之前**：
```tsx
{/* 暮色 2026-08-06：主动消息 2.0 全局配置入口（接 Cloudflare Worker） — 暮色 2026-08-09 暂停,AMSG2_ENABLED=false 不渲染 */}
{AMSG2_ENABLED && (
<section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50 mb-4">
    ...
    <button onClick={() => setShowAmsg2Config(true)} ...>
        配置主动消息 2.0（Worker URL / 租户）
    </button>
    ...
</section>
)}
```

**之后**：
```tsx
{/* 主动消息 2.0 全局配置入口（接 Cloudflare Worker）— 9-11 开启 Settings 页入口（AMSG2_ENABLED 仅短路 OSContext 事件 / proactiveChat 接入点，Settings 入口独立） */}
<section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50 mb-4">
    ...
    <button onClick={() => setShowAmsg2Config(true)} ...>
        配置主动消息 2.0（Worker URL / 租户）
    </button>
    ...
</section>
```

### 2. 弹窗渲染（line 2598-2605）

**之前**：
```tsx
{AMSG2_ENABLED && (
<ActiveMsgGlobalSettingsModal
    isOpen={showAmsg2Config}
    onClose={() => setShowAmsg2Config(false)}
    addToast={addToast}
/>
)}
```

**之后**：
```tsx
<ActiveMsgGlobalSettingsModal
    isOpen={showAmsg2Config}
    onClose={() => setShowAmsg2Config(false)}
    addToast={addToast}
/>
```

## 跟 `AMSG2_ENABLED` 8 处使用的关系

`AMSG2_ENABLED = false` 仍然在 **5 处** 短路 2.0 行为，**跟 Settings 入口独立**：

| 文件:行 | 内容 | 本轮影响 |
|---|---|---|
| `OSContext.tsx:1451` | 2.0 事件监听短路 | **不动** — 2.0 事件不会跑（避免白屏）|
| `proactiveChat.ts:328, 346, 381, 410` | 4 处 2.0 接入点短路 | **不动** — 1.x 主动消息仍用本地计时器 |
| `Settings.tsx:2522` 入口短路 | Settings 页入口 | **本轮去掉** |
| `Settings.tsx:2599` 弹窗短路 | 弹窗渲染 | **本轮去掉** |

## 没改的

- 1.x 主动消息：聊天页 `ProactiveSettingsModal` 完全不动
- 聊天页 2.0 入口（commit `3c873a83` 那笔）：不动
- `ActiveMsgGlobalSettingsModal.tsx` 弹窗内部：不动
- `ActiveMsg2SettingsModal.tsx` 弹窗内部：不动
- `utils/activeMsgFeatureFlag.ts` flag 值：不动（仍 false，但 Settings 页不受它影响）
- Worker / Android / OSContext 2.0 事件 / proactiveChat 4 处 2.0 接入点
- upstream 同步

## 触发路径

现在 UI 上的完整链路：

1. 用户打开 Settings 页
2. 滚到"主动消息 2.0（Worker URL / 租户）"卡片（原本被 AMSG2_ENABLED 挡了不显示，现在显示）
3. 点"配置主动消息 2.0（Worker URL / 租户）"紫色按钮
4. `setShowAmsg2Config(true)`
5. `ActiveMsgGlobalSettingsModal` 弹出（弹窗内容调 `ActiveMsgClient.getGlobalConfig()` 拉服务端配置）
6. 改完保存 → `addToast('已保存')`

## 风险 / 注意事项

- **这条改动等于"打开 Settings 页 2.0 入口"**，跟暮色 8-9 的"暂停 2.0"决策**部分冲突**——Settings 页入口现在能点，但 2.0 事件 / 2.0 接入点仍被 AMSG2_ENABLED 短路（即**只看到 UI，不能实际跑排程**）。
- 弹窗打开时会调 `ActiveMsgClient.getGlobalConfig()`，如果 Worker URL 还没填，会报友好错误（"请先配置 Worker"），不会白屏。
- 暮色 8-9 暂停 2.0 是产品决策，本轮按 9-11 19:27 指令"接上 Settings 页 2.0 入口"执行，是**精准放开 Settings 页入口**（不连带放开 2.0 完整功能）。

## 验证

- **Vite build** ✅ 4.29s 通过
- **TypeScript** 错误数 421（无新增；apps/Settings.tsx 的 5 个存量错误都跟本改动无关）
- **diff stat**：`apps/Settings.tsx | 8 ++------`（-6 / +2，去 2 处条件包装 + 更新 2 行注释）
