# 图床顺序调整 — 弃用 R2，imgbb 直接作主图床 + 'bell' 提示样式

**日期**：2026-07-15
**涉及 commit**：（待提交）

## 改了什么

### 1. 图床顺序调整：R2 → imgbb（直接默认）
- 暮色决定**放弃 R2**（之前试过一直卡 Vercel 函数 10 秒超时，参 changelogs/2026-07-14-r2-presign-two-stage.md 和 2026-07-14-image-b64-blob-upload.md）
- 用户发图 + AI 生图 → **默认直接走 imgbb**
- imgbb 成功 → 不弹 toast（正常流程不该打扰）
- imgbb 失败 / 没配 → 走 base64 兜底 + 'bell' 样式 toast 提示

### 2. 新增 'bell' toast 样式（铃铛胶囊）
- `types.ts` Toast type 加 `'bell'`
- `components/PhoneShell.tsx` 渲染加 'bell' 分支
  - 左侧：`Bell` 图标（amber-500 填充色）
  - 背景：amber-50/95 → emerald-50/95 渐变 + 胶囊圆角
  - 文字：text-slate-700 / 居中
  - 触发场景：图床失败已用 base64 兜底（提醒占 localStorage 空间）
- 暮色审美：浅马卡龙胶囊 + 居中 + 大圆角 + 居左铃铛

### 3. `apps/Chat.tsx` 用户发图链路简化
- 删 R2 整段（1028-1067）：hasR2 判断 + 拿 presign + PUT R2 + 多个 R2 失败 toast
- 删 imgbb 成功时的 toast（"R2 失败，imgbb 兜底成功"）
- 失败 toast 改 'bell' 样式，文字改成"图床失败，已用 base64 临时存储（占 localStorage 空间）"
- 没配 key 时同样用 'bell' toast
- **保留**：base64 控制字符清理（防御）+ console.warn 详细诊断日志

### 4. `hooks/useChatAI.ts` 生图链路同样简化
- 删 R2 整段（1367-1414）
- 删成功 toast
- 失败 / 没配 都用 'bell' 样式 toast

### 5. `apps/Settings.tsx` 图床卡 UI
- imgbb 区块：
  - 标签改"当前主图床"（之前"不推荐用，保留作回退"）
  - 强调底色改 emerald-50（之前是 slate-50 中性）
  - 加"imgbb 对香港/部分 IP 段会触发 CloudFlare 风控（code 103），换 🇯🇵 日本节点一般可解"
- R2 区块：
  - 标签 "Cloudflare R2" 改 `line-through` 灰色
  - 副标改"已废弃 · 试过卡 Vercel 10 秒超时 · 字段保留以备后用"
  - 整个区块 `opacity-60` 弱化

### 6. `api/r2-presign.ts` 加废弃注释
- 文件头注释加 "已废弃" 说明
- 解释为什么不删：保留以备后用 + git 历史决策记录
- Settings.tsx 里的 5 个 R2 字段也**保留**（type 字段 + UI + 保存逻辑都不动）

## 踩坑 / 需要知道的（重要）

### 折腾了一下午的真实根因（不是代码 bug）
- **表象**：发图 400 Bad Request + imgbb 后台留 3 张空白图
- **错误体**：`code 103 "You have been forbidden to use this website"`
- **关键排查过程**（避免下次再绕）：
  1. 我第一反应是 CloudFlare IP 封禁 → 错（手机正常，电脑不正常，重启触发）
  2. 截图发现 imgbb 后台 3 张空白图 → 反证不是 IP 拦截（IP 拦了不会留记录）
  3. 怀疑是 base64 vs file 编码问题 → 错（curl 走 file + UI 走 file 都结果不同，差别在浏览器环境不在调用方式）
  4. 怀疑是 Chrome 扩展 → 错（无痕模式也挂，无痕禁用扩展）
  5. 怀疑是代理规则 → 对了一半
  6. **真凶**：代理默认开了**🇭🇰 香港节点**，imgbb 的 CloudFlare 对香港 IP 段会触发风控（"You have been forbidden"）
  7. 切回**🇯🇵 日本节点** → imgbb 立刻正常
- **复盘经验**（已存到 agent memory）：
  - "代理出口节点 IP 被 CDN 风控"——任何用代理的项目都适用
  - 排查路径：手机 vs 电脑 → 关代理 vs 开代理 → 不同浏览器 → 不同节点
  - 关键信号：CloudFlare 风控错误体（code 103 / "forbidden"）+ 业务服务后台有记录 = 出口 IP 段被风控
  - 不要被"国外图床国内访问"这种通用结论误导——是**特定 IP 段**（香港）被拦，不是图床本身对中国 IP 拦

### 排查期间引入的代码改动（保留是有用的）
- `apps/Chat.tsx`：base64 加 `.replace(/[\s\u0000-\u001F\u007F-\u009F]/g, '')` 控制字符清理
  - 现在看来不是 root cause，但**保留**作为防御
  - canvas.toDataURL 偶尔会输出含换行的 base64（MIME 标准允许每76字符\n），imgbb 接受换行但其他控制字符可能触发 400
- `apps/Chat.tsx`：imgbb 失败时 `console.warn` 详细诊断（status / statusText / key_length / base64_length / base64_first_80 / base64_last_40 / response json）
  - 这次排查全靠这个 log 看清楚 `code 103` 错误体
  - **保留**——下次再出图床问题直接看 console 立刻知道是 IP 段、内容、key、还是格式

### 暮色为什么不用诊断 log 而直接问我
- 当时是"突然发现 bug"场景，没意识到"我看到的 console 数据就是我最好的证据"
- 后续类似情况我应该**第一时间引导暮色去抓 console 截图**，不用我来猜

## 备注

### 图床现状
- **当前主图床**：imgbb（用户发图 + AI 生图默认走这个）
- **备用**（代码已不再调用）：R2 字段 + api/r2-presign.ts 保留
- **base64 兜底**：imgbb 失败时走 base64，会污染 localStorage（这是已知问题，没图床时的最后手段）

### 未来考虑（未做）
- **Vercel 代理上传 imgbb**（`/api/imgbb-proxy`）—— 解决本地代理切换问题（Vercel 出网不受本地代理影响）
  - 改动：新增一个 Vercel function，浏览器把图片 POST 到这个 endpoint，Vercel 再调 imgbb
  - 收益：再也不用怕本地代理/网络环境变化
  - 暮色没明确要做，先留着

### R2 历史 commit 链（保留以备查）
- 2026-07-14 `19a4848` 引入 R2
- 2026-07-14 `4effb08` 改两阶段 presign
- 2026-07-14 `b476c0c` 自写 SigV4（去掉 AWS SDK 冷启动）
- 2026-07-14 `a6348c8` 改 R2 报告
- 2026-07-14 `6282af2` 降级链加 addToast
- 2026-07-15（本 commit）弃用 R2，imgbb 作主

### GroupChat 群聊发图没改
- `apps/GroupChat.tsx:692-693` 群聊发图是直接 base64，不走 imgbb
- 这是设计如此（群聊图不重要），暮色没提，不动
- 群头像 (`GroupChat.tsx:469-471`) 也是直接 base64 存进 group 字段，不走图床

### Mavis 安装签名（顺手记一下）
- 暮色提到"卸载重装的是 Mavis（我）"
- 这是 Mavis 没签名被 macOS Gatekeeper 标记的事，跟 imgbb 没关系
- 回头帮暮色处理 Mavis 签名问题（不阻塞这次发图修复）
