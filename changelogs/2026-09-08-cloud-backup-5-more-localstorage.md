# 2026-09-08 云端备份再补 5 个 localStorage 字段

暮色 9-8 12:12 反馈:"所有的内容在 zip 备份是不是都有?检查一下是不是有遗漏。"

## 这次补的 5 个字段

| Key | 功能 | 漏掉后果 |
|---|---|---|
| `discover_last_seen_at` | 发现页"上次看到时间",用于通知红点未读数 | 重置成 0,所有通知都当新消息 |
| `os_date_quick_phrases` | 见面 app 快捷短语配置 | 用户配置丢 |
| `os_sync_device_id` | 多端同步设备 ID | 跨设备冲突检测失效 |
| `handbook_lifestream_depth` | 跨角色手账深度 | 暮色看不到深度设置 |
| `vr_help_seen` | VR 帮主已看过标记 | 重新弹帮助弹窗 |

## 改了什么

- `types.ts` — `FullBackupData` 加 5 个字段
- `context/OSContext.tsx` export 端 `backupData` — 加 5 个 localStorage 读取(text_only + full 模式)
- `context/OSContext.tsx` import 端 — 加 5 个 localStorage 回写,每个独立 try-catch

## 类型校验

- `discoverLastSeenAt` / `handbookLifestreamDepth`: 数字 + 有限值 + >0
- `dateQuickPhrases`: Array.isArray
- `syncDeviceId` / `vrHelpSeen`: string + 长度 >0

## 故意不补的(临时/调试/单设备状态)

| Key | 理由 |
|---|---|
| `sullyos:enableApiLog` | API 调试日志开关(临时) |
| `sullyos:proactiveLastError` | 主动消息最后错误(临时) |
| `sullyos:lastProactiveMsgTail` / `lastProactiveReqLog` | 主动消息调试日志(临时) |
| `sullyos:lastApiReqLog` / `lastApiRespLog` / `lastApiRespModel` / `lastVisionReqLog` | API 调试日志(临时) |
| `vr_last_fire` | 注释明确说"主动消息上次触发时间是用户机器状态,跨设备不迁移" |
| `__sullyos_build_id__` / `__sullyos_loaded_hash__` | 构建 ID(每次启动重写) |
| `sullyos:lastRestoreAt` | 增量导出时间线锚点(每次导入重写) |

## 流程

- 9-8 12:08 暮色新流程: **所有改动先到 preview,master 合并要等指令**
- 此 commit 在 `preview` 分支:`3af2c260 → 1c8d4e3x` (待补 hash)
- origin/master 仍 = 300acc70(等暮色说"合 master"再 merge)
