# 2026-08-16 格式化系统（保留云端备份）

暮色 8-16 反馈："麦麦，格式化不是放在记忆宫殿，我说的是放在系统设置里，我刚看了一下系统设置的备份里就有这个按钮，记忆宫殿的那个格式化按钮全部去掉，把系统设置中备份里的格式化按钮改成保留云端备份的版本。"

## 行为

**保留**（云端备份相关 localStorage key）：
- `os_cloud_sync_config`（配对码 + 设备 ID + 同步时间戳）
- `os_sync_device_id`（设备 UUID v4）
- `os_sync_*` 前缀（兜底）

**清空**：
- 所有 IDB 数据库（AetherOS_Data v63 主库 + ActiveMsg v1 主动消息库 + 其他）
- 大部分 localStorage（角色配置、UI 偏好、自定义 prompt、情绪 API 配置 等）
- **不**清远程数据（云端记忆/向量仍可用）

## 涉及改动

### 1. 新建 `utils/factoryReset.ts`

导出：
- `factoryReset(options): Promise<FactoryResetResult>` —— 清所有 IDB + 清大部分 localStorage
- `FactoryResetOptions { includeRemote?: boolean }`
- `FactoryResetResult { indexedDBsDeleted, localStorageKeysRemoved, localStorageKeysPreserved, remoteAttempted }`

实现要点：
- 用 `indexedDB.databases()` 列出所有 IDB 库（支持的浏览器），逐个 `deleteDatabase`；不支持就硬删 `AetherOS_Data` + `ActiveMsg`
- 遍历 `localStorage`，按保留清单过滤
- `deleteDatabase` 的 `onblocked` 警告但不 reject

### 2. 改 `context/OSContext.tsx` 的 `resetSystem`（系统设置 → 备份 → "格式化系统 (出厂设置)" 按钮调的是这个）

**改前**：
```ts
const resetSystem = async () => {
    try {
        await DB.deleteDB();
        localStorage.clear();  // ← 会把云端备份配对码也清掉
        window.location.reload();
    } catch (e) { ... }
};
```

**改后**：
```ts
const resetSystem = async () => {
    try {
        const result = await factoryReset();  // 清所有 IDB + 清大部分 localStorage
        addToast(`格式化完成（保留云端备份 ${result.localStorageKeysPreserved.length} 项）`, 'success');
        window.location.reload();
    } catch (e) { ... }
};
```

### 3. `apps/MemoryPalaceApp.tsx` 撤回之前误加的"极端区：格式化系统"块

暮色 8-16 纠正：原按钮已在系统设置里（`Settings.tsx` 的 ZIP 备份区块里），我之前加到记忆宫殿的"系统设置"（`globalSettings` 视图末尾）位置错了。

撤回：去掉 import `factoryReset` + 去掉整块"极端区" UI。

## 涉及文件

- `utils/factoryReset.ts` — 新建
- `context/OSContext.tsx` — 改 `resetSystem` + import `factoryReset`
- `apps/MemoryPalaceApp.tsx` — 撤回误加的 UI 块
- `changelogs/2026-08-16-factory-reset.md` — 本文件

## 风险 / 注意事项

1. **不可撤销**：清掉的所有数据需要靠云端备份恢复（如有）
2. **保留清单只覆盖云端备份 key**：其他 localStorage 也会被清。如果有"其他想保留的 key"，告诉我加进 `PRESERVED_LS_KEYS`
3. **`deleteDatabase` 可能被阻塞**：有未关闭的 IDB 连接时会卡，提示用户关闭其他页面后刷新
4. **远程数据不动**：配对码/设备 ID 保留 = 同一台设备仍是云端备份成员；远程记忆/向量仍在云端
5. **强制刷新**：执行完 `location.reload()` 重新加载页面

## 踩坑：放错位置

暮色之前说"在系统设置增加格式化系统恢复出厂设置按钮"，我误以为"系统设置"指 `MemoryPalaceApp` 里的 `globalSettings` 视图（记忆宫殿的全局配置）。**实际上**"系统设置"指 `Settings.tsx`（主系统设置 App），那里已经有"格式化系统 (出厂设置)" 按钮了，我只需要**改**那个按钮的行为，不需要**新加**按钮。
