## 拾光机一键部署适配（2026-09-15）

暮色 9-15 15:55 拍板"对齐做吧"——把一键部署按钮指向拾光机自己的 worker / D1。

### 为什么不能直接用一键部署

`utils/cfProvision.ts` 里有 3 个**写死的常量**全是 **upstream 默认值**：
- `AMSG_SCRIPT_NAME = 'sullyos-amsg'` ← upstream worker 名
- `AMSG_D1_NAME = 'sullyos-amsg'` ← upstream D1 名
- `BUNDLE_BASE = 'https://raw.githubusercontent.com/Tosd0/sullyos-workers/main/amsg'` ← upstream 作者仓库

拾光机 fork 用 `wrangler.toml:name = "sullyos"` + `database_name = "sully-amsg2"`——**跟 upstream 默认值完全不一样**。所以一键部署按钮现在跑会建一个叫 `sullyos-amsg` 的 worker，跟拾光机 wrangler.toml 配置的 `sullyos` 不匹配——拾光机前端读不到 worker URL，连不上。

### 改的 3 处

| 常量 | 原版 | 拾光机 | 跟谁对齐 |
|---|---|---|---|
| `AMSG_SCRIPT_NAME` | `sullyos-amsg` | **`sullyos`** | wrangler.toml name |
| `AMSG_D1_NAME` | `sullyos-amsg` | **`sully-amsg2`** | wrangler.toml database_name |
| `BUNDLE_BASE` | Tosd0 公共仓库 | **保持不变** | worker/amsg/src/index.ts 完全一致 |

BUNDLE_BASE 保持 Tosd0 仓库——因为拾光机 fork HEAD 跟 upstream HEAD 在 `worker/amsg/src/index.ts` **完全一致**（diff 空）——Tosd0 上的 bundle 等同于拾光机自己 build 的 bundle。如果以后拾光机有专属 bundle 仓库，再改这里。

### 摸底

- `npx vite build` ✓ 4.71s

### 暮色接下来要做

1. CF 仪表盘加 `AMSG_MASTER_KEY`（**先把图 1 的 Secret 复选框勾上**——之前没勾）
3. 拾光机 modal 改 Worker 地址为 `https://sullyos.1812038909.workers.dev`（去 -amsg）
4. 共享密钥两处对齐（拾光机 modal 跟 CF 仪表盘 `AMSG_SERVER_TOKEN` 填一样）
5. 点"连接并启用"验证

### 一键部署按钮以后能用

暮色之后想重新装拾光机（比如换 CF 账号）可以直接点"一键部署"——会自动建 `sullyos` worker + `sully-amsg2` D1 + 装代码 + 加 cron，不用再手动跑 wrangler deploy。