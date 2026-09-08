# 2026-09-08 云端备份补 7 个 IDB store + 4 个 localStorage 字段

## 暮色 9-8 反馈

"检查一下后加进来的功能有哪些没有加到云端备份里" — 系统性对比 `changelogs/2026-08-25 ~ 2026-09-07` 和 `context/OSContext.tsx` export 端的 `allStores` 列表 + `backupData` 字段，发现 11 处遗漏。

## 漏掉的清单(改之前的状态)

### 7 个 IDB store(export allStores 没列 → switch 没分发 → 备份文件没这 7 个 store)

| Store | 加的时间 | 功能 | 漏掉后果 |
|---|---|---|---|
| `character_memos` | 9-5 push-c-and-memo | 角色备忘录 event/private 区域 | **备忘录条目全丢** |
| `character_status_panels` | 9-5/9-6 status-panel | 状态面板(5 槽+recent) | **状态面板全丢** |
| `story_theaters` | 8-25 剧情模式 | 剧场存档(单人 RP) | 剧场存档丢 |
| `story_theater_presets` | 8-25 | 剧情模式预设库 | 导入的预设丢 |
| `scene_templates` | 8-25 | 剧情模式场景模板 | 自定义场景模板丢 |
| `rp_api_configs` | 8-25 第六步 | RP 独立 API 配置 | 切换/恢复后 RP API 全没 |
| `rp_global_defaults` | 8-26 | RP 全局默认 | RP 全局默认丢 |

### 4 个 localStorage 字段(export backupData 字段没读)

| Key | 加的时间 | 功能 | 漏掉后果 |
|---|---|---|---|
| `sullyos_page_zoom` | 8-27 page-zoom-css | 页面缩放值(0.7~1.3) | 重装/恢复后缩放回到 100% |
| `custom_css_presets` | 8-27 custom-css-state-persistence | 自定义 CSS 预设列表 | 预设全丢 |
| `custom_css_active` | 8-27 | 激活的 CSS 预设名 | 激活状态丢 |
| `custom_css_last_applied` | 8-27 | 最后应用的 CSS 内容 | 应用过的 CSS 丢 |

## 改了什么

### 1. `types.ts` — `FullBackupData` 加 11 个字段

7 个 IDB 字段 (`characterMemos` / `characterStatusPanels` / `storyTheaters` / `storyTheaterPresets` / `sceneTemplates` / `rpApiConfigs` / `rpGlobalDefaults`) + 4 个 localStorage 字段 (`pageZoom` / `customCssPresets` / `customCssActive` / `customCssLastApplied`)。

### 2. `context/OSContext.tsx` export 端

- `allStores` 数组加 7 个 store 名
- `text_only` 模式 store 列表加 7 个(全是纯文字,跟"文字+记忆+基础数据"原则一致)
- switch case 加 7 个分发,跟 `mailbox_letters` 同款
- `backupData` 字段加 11 个 localStorage 读取
- `largeArrayKeys` 数组加 7 个(避免单个 key 巨大对象 JSON.stringify 炸内存)

### 3. `context/OSContext.tsx` import 端

- 加 4 个 localStorage 字段回写,每个独立 try-catch,失败不影响其它字段恢复
- pageZoom 校验 `Number.isFinite`,避免恢复坏值
- customCss 三个字段分别校验类型

### 4. `utils/db.ts` `importFullData`

- 加 7 个 store 回写,跟 `mailboxLetters` 同款 `db.objectStoreNames.contains()` 兜底

## 关键点

- **text_only 模式也带 7 个新 store**:全是纯文字,不带任何图片,符合 text_only 模式"轻量同步基础数据"原则
- **localStorage 字段全在 text_only + full 模式带**:配置类数据该跟基础数据一起同步
- **每个新 store 的 import 都做 `objectStoreNames.contains()` 兜底**:老版本 DB 没这些 store 时不报错(老数据导入兼容)
- **每个 localStorage 字段独立 try-catch**:一个字段坏值不会污染其它恢复

## 涉及的代码位置

- `types.ts:2103-2123` — 新增 11 个字段
- `context/OSContext.tsx:3522-3531` — allStores 加 7 store
- `context/OSContext.tsx:3546-3551` — text_only 加 7 store
- `context/OSContext.tsx:3941-3948` — switch case 加 7 分发
- `context/OSContext.tsx:3701-3719` — backupData 加 11 字段
- `context/OSContext.tsx:3960-3964` — largeArrayKeys 加 7
- `context/OSContext.tsx:4268-4283` — import 加 4 localStorage 回写
- `utils/db.ts:2819-2826` — importFullData 加 7 store 回写

## 验证

- TypeScript build: `npm run build` ✓ (4.17s,0 错误)
- 打包文件:`dist/assets/index.DiCUxzne.js`(4,878 KB,比加改动前略大)
