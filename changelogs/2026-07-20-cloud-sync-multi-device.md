# 云端同步（多端互通）—— 电脑手机共享聊天记录 + 记忆宫殿

**日期**：2026-07-20
**涉及 commit**：（待 push 后填）

## 改了什么

暮色多端互通：电脑和手机通过 6 位配对码共享**聊天记录** + **记忆宫殿**。
- 配对码自动生成，存 localStorage，重启 / 关机都在
- 增量同步：发消息后 5 秒内推到云端；轮询 30 秒一次拉新消息
- 互不干扰"云端备份"（GitHub Releases / WebDAV），是两个独立通道
- 独立 Settings 分组「云端同步」，跟"云端备份"分开
- 后端未配置（Neon 没装）时不报错，UI 提示"未配置"

## 动了哪些文件

**新增**
- `api/sync/_lib.ts` —— 公共 helper（Neon client / 配对码生成 / 鉴权 / CORS / 错误处理）
- `api/sync/init.ts` —— 生成新配对码 + 注册设备（"重置配对"）
- `api/sync/pair.ts` —— 加入已有配对码（POST）/ 查询设备列表（GET）
- `api/sync/messages.ts` —— 聊天消息上传（POST）/ 增量拉取（GET）
- `api/sync/memories.ts` —— 记忆节点上传（POST，软删除支持）/ 增量拉取（GET）
- `api/sync/schema.sql` —— Neon 数据库初始化脚本（3 表 + 1 视图）
- `hooks/useCloudSync.ts` —— 全局单例 sync engine + React hooks
- `utils/syncClient.ts` —— API 客户端（fetch 封装 + 配对码 / 设备 ID 持久化）
- `components/settings/SyncSettings.tsx` —— 配对码 UI（独立组件）

**修改**
- `types.ts` —— Message 加 `clientId?: string`（云端去重 key）
- `utils/db.ts` —— `DB.saveMessage` 自动生成 clientId + 触发云端同步
- `utils/memoryPalace/db.ts` —— `MemoryNodeDB.save/delete` 自动触发云端同步
- `hooks/useChatAI.ts` —— 移除手动包装（重复触发问题，移到 db.ts 统一处理）
- `apps/Chat.tsx` —— 订阅 `useCloudMessages`，把云端拉取的新消息按 clientId 去重注入
- `apps/MemoryPalaceApp.tsx` —— 订阅 `useCloudMemories`，云端新记忆自动入库
- `apps/Settings.tsx` —— 新增「云端同步」分组（在「云端备份」后面、「API 配置」前面）

## 踩坑 / 需要知道的（重要）

**1. Vercel Neon 集成需要暮色手动装**
API 端点写完了，但 `DATABASE_URL` 环境变量还没注入。**第一次部署后**：
- 去 Vercel dashboard → 项目 → Storage → Create Database → Neon
- 选免费档（0.5 GB），Vercel 自动注入 `DATABASE_URL`
- 然后在 Neon SQL Editor 跑 `api/sync/schema.sql` 初始化表

**2. 跟 supabase pgvector 是两码事**
之前记忆宫殿已经有 supabase 向量同步（`utils/memoryPalace/supabaseVector.ts`），那是**向量检索**用的。
本次云端同步是**多设备共享**用的，**不**做 pgvector，只同步文本/元数据。
两份独立配置，两份独立数据，别混。

**3. 循环引用问题 + 解法**
原始设计想 `utils/db.ts` 直接 import `hooks/useCloudSync.ts` → 循环（db → useCloudSync → syncClient → db）。
**解法**：在 `utils/syncClient.ts` 把 `generateClientId` 改成内联（不依赖 db.ts），循环断开。
db.ts 和 memoryPalace/db.ts 用 `await import('../hooks/useCloudSync')` 动态 import 避免编译期循环。

**4. 重复触发问题 + 解法**
最初在 useChatAI.ts 顶部也包装了一次 DB.saveMessage，**但** utils/db.ts 里也包装了。
→ 一次消息会被同步两次。修法：useChatAI.ts 不再包装，直接用 import 进来的 DB。
**关键规则**：**云端同步 hook 只放在 db.ts 那一层**（唯一入口），其他地方不再包装。

**5. Vercel 10 秒超时**
所有 API 端点设计 ≤ 10 秒：
- 上传单批最大 500 条消息 / 300 条记忆（实测 Neon 单条 insert ~5ms）
- 拉取单次最大 500 条
- 客户端 fetch timeout 15 秒（给函数 10 秒 + 余量）

**6. IndexedDB auto-increment ID 不能跨设备**
聊天消息本地 `id: number`（IndexedDB auto-increment）—— **每台设备给的 id 不同**。
→ 加了 `clientId: UUID v4` 字段做云端去重 key。本地 id 只用于本地引用。
→ 云端拉到新消息注入 Chat UI 时，**用负数 id 避免跟本地冲突**（不进 IndexedDB，下次刷新靠水位重新拉）。

**7. 软删除策略**
记忆删除时云端用 `deleted=true` 标记（**不**真删行），理由：
- 另一台设备因为网络延迟可能晚点拉到删除标记
- 软删除可以避免"延迟复活"问题
- 本地不自动跟着删（保守策略，留给用户手动）

**8. 鉴权强度**
仅靠 6 位配对码 + 设备 ID 做隔离，**不抗暴力**。
适用范围：个人多端互通（暮色 + 自己的电脑手机），不抗主动攻击。
不适合公开部署 / 多人共用。AGENTS.md 没改（暮色个人用够了）。

## 备注

- 推 preview 后还需要暮色在 Vercel dashboard 装 Neon 集成 + 跑 schema.sql，否则 sync UI 会显示"未配置"
- Vercel Hobby 10 秒限制：用户量大了再考虑分块（目前单批 500 条足够）
- 后续 V2 可加：实时 WebSocket 推送、生图同步、设置/角色卡同步、群聊同步
