# 2026-08-16 格式化系统（恢复出厂设置）

暮色 8-16 反馈："在系统设置增加格式化系统恢复出厂设置按钮。保留云端备份设置，其他一键清空原始数据。"

## 行为

- 清空**所有** IDB 数据库（AetherOS_Data v63 + ActiveMsg v1 + 其他）
- 清空 localStorage **大部分** key
- **保留** 云端备份相关 localStorage key：
  - `os_cloud_sync_config`（配对码 + 设备 ID + 同步时间戳）
  - `os_sync_device_id`（设备 UUID v4）
  - `os_sync_*` 前缀（兜底）
- 不清远程（云端数据 + 配对码仍可用）
- 完成后 `location.reload()` 刷新页面

## 涉及改动

### 1. 新建 `utils/factoryReset.ts`

导出：
- `factoryReset(options): Promise<FactoryResetResult>` —— 清所有 IDB + 清大部分 localStorage
- `FactoryResetOptions { includeRemote?: boolean }`
- `FactoryResetResult { indexedDBsDeleted, localStorageKeysRemoved, localStorageKeysPreserved, remoteAttempted }`

实现要点：
- 用 `indexedDB.databases()` 列出所有 IDB 库（支持的浏览器），逐个 `deleteDatabase`；不支持就硬删 `AetherOS_Data` + `ActiveMsg`
- 遍历 `localStorage`，按保留清单过滤
- `deleteDatabase` 的 `onblocked` 警告但不 reject（用户刷新页面会真删）

### 2. `apps/MemoryPalaceApp.tsx`（系统设置末尾）

新加"极端区：格式化系统（恢复出厂设置）"块（在原"危险区：一键清空向量记忆"下面）。

**三重 confirm**（避免误触）：
1. `confirm` 第一步：提示清空范围 + 保留范围
2. `confirm` 第二步：再次确认
3. `prompt` 第三步：输入"格式化"才执行

UI 样式：
- 背景 `#451a03`（深棕色）
- 边框 `#fbbf24`（金黄色）
- 文字 `#fef3c7`（米黄色）
- 按钮 `#7c2d12`（深红棕）

## 涉及文件

- `utils/factoryReset.ts` — 新建
- `apps/MemoryPalaceApp.tsx` — import + 加 UI 块
- `changelogs/2026-08-16-factory-reset.md` — 本文件

## 风险 / 注意事项

1. **不可撤销**：清掉的所有数据需要靠云端备份恢复（如有）
2. **保留清单只覆盖云端备份 key**：其他 localStorage（如用户配置、UI 偏好、自定义 prompt）也会被清。如果有"其他想保留的 key"，告诉我
3. **`deleteDatabase` 可能被阻塞**：有未关闭的 IDB 连接时会卡，提示用户关闭其他页面后刷新
4. **远程数据不动**：配对码/设备 ID 保留 = 同一台设备仍是云端备份成员；远程记忆/向量仍在云端（可用"云端 → 本地"恢复）
5. **强制刷新**：执行完 `location.reload()` 重新加载页面（IDB 已删，状态要重新初始化）
