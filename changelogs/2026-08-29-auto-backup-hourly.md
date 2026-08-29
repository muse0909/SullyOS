# 云端备份 · 自动备份开关

**日期**：2026-08-29
**类型**：功能（云端备份增强）
**来源**：暮色口头规格 6 条，原样落地

## 做了什么

云端备份设置区（设置 → 云端备份，已启用态）新增**自动备份**开关：

1. **开关 UI**：在"上次备份"时间和手动备份按钮之间，含说明小字
   "每小时自动备份一次"，开启后额外显示"上次自动备份: <时间>"。
2. **每小时自动触发**：前台状态下每 60 分钟自动执行一次轻量同步备份——
   调的就是手动"备份到云端(轻量同步)"按钮那个函数（`cloudBackupToWebDAV('text_only')`），
   没有另写备份逻辑。覆盖式上传，跟手动行为完全一致。
3. **状态持久化**：开关状态存在 `cloudBackupConfig.autoBackup`
   （localStorage key `os_cloud_backup_config`，随现有导入/导出走），
   页面加载时读取，开着的自动启动定时器。
4. **前后台感知**：
   - 前台：interval 跑着
   - 切后台 / 页面卸载（`visibilitychange` / `pagehide` / Capacitor `appStateChange` 三路）：清掉 interval
   - 回前台且开关开着：重新启动
5. **防撞车**：系统操作进行中（`sysOperation.status === 'processing'`，比如
   手动备份正在跑）时自动跳过本轮，下个整点再试。
6. **时间分开记**：自动备份成功写 `lastAutoBackupTime`，跟手动备份的
   `lastBackupTime` 互不覆盖。

## 改动文件

| 文件 | 改动 |
|---|---|
| `types.ts` | `CloudBackupConfig` 加 `autoBackup?` / `lastAutoBackupTime?` 两个字段 |
| `context/OSContext.tsx` | `defaultCloudBackupConfig` 加 `autoBackup: false`；`cloudBackupToWebDAV` 之后新增自动备份定时器（ref 镜像防闭包旧值 + 三路前后台监听） |
| `apps/Settings.tsx` | 云端备份区加开关 UI + `handleToggleAutoBackup` |

## 注意

- 定时器从**开关打开**那一刻起算，每小时触发一次（不是整点触发）。
- 手动备份进行中时自动轮次会静默跳过（下个整点再试），不会双备份。
- 自动备份失败时 toast 由 `cloudBackupToWebDAV` 内部弹出，逻辑与手动一致。

## 未做（按暮色要求明确不做）

- 不保留多版本 / 不做自动清理（复用手动备份现有行为）
- 不另写备份函数
