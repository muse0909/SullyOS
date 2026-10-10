# 主动消息 2.0「到点发不发」改造 — 交接摘要

> 写给下一个接手的人（新窗口 / 新助手）。**本文件尚未提交**。
> 数据全部取自 `git log` / 仓库实测 / D1 查询，没有凭记忆的部分。
> 生成时间：2026-10-02 22:15

---

## 0. 一句话

暮色要求把主动消息 2.0 的「到点发不发」规则从原来那套（锚点判据 + 客户端二次闸）
改成**只留两条、统一在到点那一刻判断**。代码已全部改完（11 步 / 25 个提交）并推到
`fix/amsg2-realign`，测试包已打好，**卡在「等暮色装到手机上真机验收」这一步**。

---

## 1. 现在在哪

| 项 | 值 |
|---|---|
| 分支 | `fix/amsg2-realign` |
| HEAD | `89efaf61` |
| 远端 | `origin/fix/amsg2-realign` = `89efaf61` ✅ 已推 |
| `origin/master` | `ef17e1aa` —— **未沾染** |
| `origin/preview` | `ef17e1aa` —— **未沾染** |
| 本地 master | `9cc535ea`（落后远端 13 个，**不影响**：fix 已包含 origin/master 全部内容，`git log fix..origin/master` 为空） |
| 工作区 | 干净（租约调用点已按暮色 2026-10-03 拍板的方案 C 提交，见第 6 节） |
| 本轮提交数 | 25 个（`ef17e1aa..89efaf61`） |
| 本轮代码量 | 45 文件 / +9022 / -449（**含 10 个无关文件误入，见第 7 节**） |
| 类型检查 | tsc 379 个错误，**与基线 `/tmp/k-base.txt` 逐字一致**，本轮 0 新增 |
| 单元测试 | vitest **452 通过 / 5 失败**，5 条全是本轮之前就红的 |
| 打包 | `npm run build` 通过 |

### 那 5 条一直红的（不是本轮造成的，别去追）

| 文件 | 用例 | 原因 |
|---|---|---|
| `utils/amsg2Tasks.test.ts` | `describeRemoteLastError` 截断 | 截断后 135 字符，断言要 <120 |
| `utils/amsgFirePack.test.ts` | `includeClock=false` 时钟点消失 | 关掉后场景块仍带 `22:00` |
| `utils/vrWorld/vrWorld.test.ts` × 3 | `VRScheduler.reconcile` 三条 | 测试自己没 stub `localStorage`（`vrWorld.test.ts:15`） |

---

## 2. 新规则（暮色定案，这是所有改动的唯一目标）

判断**只留两条**，统一在**到点那一刻**判断，只看「到点前 10 分钟内有没有**用户发的真实消息**」
（AI 主动消息不算）：

1. **遇忙作废**（`expire`）：有消息 → 作废、不推送、**也不告诉角色**。
   - once（一次性）→ 到此结束
   - daily / weekly → 只跳本次
2. **强制发送**（`force`）：没消息 → 正常推；有消息 → 改成在**角色下一轮回复的上下文里带出**。
   - 兜底 = 到点后 30 分钟准点照推

另外三条：

3. 删掉「用户一发消息就立刻删掉角色自排任务」
4. 页面文案：「转为对话里自然带出」从「自动作废」挪到「强制发送」
5. 「回到你自己」钢印**必须是模板最后一句**

---

## 3. 11 步做了什么（逐条 → commit）

前 3 步的提交信息里没标 step 号，按时间顺序对应。

| 步 | commit | 干了什么 |
|---|---|---|
| — | `d58835b3` | 补齐云端写、客户端不认的 4 个跳过原因（`schedule-off` / `min-gap` / `recurring-unanswered` / `daily-limit`），面板原来这四种情况啥都不显示 |
| — | `f0e69dff` | 「强制发送」发给云端时**翻成遇忙作废** + 打 `amsgForceDeferred` 标记。云端 `shouldExpireFire` 第一行就是 `policy !== 'expire' → return false`，对 force 一次窗口都不判，客户端只能翻译过去让云端去跳 |
| — | `b453927e` | 「强制发送」配 **+30 分钟兜底**（建成 `fixed` 模式：不调模型、不占名额、不进 fire_pack、面板和角色都看不见） |
| — | `2547e084` | 三处跟定案对不上：兜底不藏面板 / fixed 也走新规则 / 兜底文案带上原文 ⚠️ **这个提交误带了 10 个无关文件，见第 7 节** |
| — | `2fd2151e` | **step 3** — 回执 kind 从 2 种扩到 4 种（`expired` 遇忙作废 / `deferred` 到点推迟 / `quota-blocked` 名额满 / `user-cancelled` 手动取消）+ 四段文案 |
| — | `5414a7e9` | 遇忙作废只做内部分类，**不注入角色上下文** |
| — | `f16ff4aa` | **step 4** — 「到点推迟」客户端扫描器 `amsg2DeferredScan`（新判据：到点前 10 分钟有用户消息） |
| — | `d18d9730` | **step 5** — 兜底配对生命周期：主任务说出来了就销兜底，循环按下个周期重建 |
| — | `175b622a` | 补上唤醒路径两个方向：消费后立刻重传不带它的包 + 到点上屏后销回执 |
| — | `9f86f443` | 接上回执注入链路（上一版整套函数**没人调用**） |
| — | `30b6ccae` | **step 6** — 面板说清「到点了却什么都没来」的真实原因 |
| — | `58e7a7e7` | **step 7** — 兜底对账：取消孤儿 / 主任务被停掉的，补建缺失的 |
| — | `d3e6c75c` | **step 8** —「最近没响」合并成一张卡 + 给作废台账补出口 |
| — | `217282e1` | **step 9** — 删「发消息即删角色自排任务」+ 入口闸改成只替换「自排 + 一次性 + 遇忙作废」那三种 |
| — | `8ec4608f` | **step 10** — 策略文案：两条描述原来**挂反了** |
| — | `e0e59ea2` | 钢印挪回模板最后一句（回执改插它**前面**） |
| — | `76b16fa0` | **step 11** — 删掉客户端那道「该不该说出口」的判定（`activeMsgRuntime` -270/+11） |
| — | `7fcd34f5` | 判据与云端对齐：抽 `occurrenceIsExpired` 作**唯一实现**，`shouldExpireFire` 删锚点分支，`detectExpiredOccurrences` 重写，新建 `utils/amsg2ExpireGuard.test.ts`（26 条） |
| — | `b005030a` / `fe71839b` / `62d53471` / `89efaf61` | 报告与取证文档 |
| — | `902311ed` / `c6b62037` | `.gitignore` 排除 `.secrets/` + 测试环境 `wrangler.test.toml` |
| — | `ec9279ff` | `scripts/amsg-task-inspect.mjs`（解密云端任务、打印策略字段） |

### 顺带做的（不在 11 步里，但同一批推的）

- `ec9279ff` 建了核对脚本；`.secrets/` 排除；测试环境部署配置

---

## 4. 已查实的事实（有取证，不是推测）

### 判据来源：**原作者的，我们没碰过**

链路：`qegj567-cloud/SullyOS`（upstream）→ GitHub Actions 自动同步到 `Tosd0/sullyos-workers`
镜像 → 线上自更新。**是原作者的代码，本轮一行没改。**

### 线上 bundle 才是真相，仓库源码会骗人

| | 版本 | `shouldExpireFire` |
|---|---|---|
| 仓库 `utils/amsg2ExpireGuard.ts` | 2026-09-02 | 一次性走**锚点**分支；循环走 `-10min ~ nowMs` 非对称窗 |
| 线上 bundle | 2026-10-01.2 | **对称 ±10 分钟窗，一次性/每天/每周一视同仁，锚点概念整个没了** |

硬证据：`anchorMs` 这个字符串在 `/tmp/author-bundle.js`（16916 行未压缩，sha256 前 12 位
`3bcc8e259345`，与正式云端 `/config-check` 报的 `bundleHash` 一致）里出现 **0 次**。

### 云端到点有**两道门**

- bundle **15813 行** `active-chat-presence`（读 `chat_presence`，TTL 45s）
- bundle **15863 行** `shouldExpireFire`

第一道门只在 `policy === 'expire'` 时生效；**`force` 任务根本不看它**。

### 其他

- cron `AMSG_CRON_EXPRESSION = "* * * * *"`（bundle 11176 行），每分钟一跳
- 捞任务条件 `next_send_at <= ?`（bundle 10836 行）
- 判据锚在**设定时间**（`occurrenceMs = Date.parse(ctx.task.nextSendAt)`，bundle 15844 行）
- `nowMs` 是 fire 那一刻（bundle 3160 行现取 `Date.now()`；`ctx._agenticNow` 在生产 bundle 里只被读从未赋值）
- worker `/client-state` 接收端在 bundle 6964-7020 行，**不在仓库 `worker/amsg/src/` 里**
- 推送投递失败码走 `pushStatus` 字段（bundle 2052 行 `readPushStatusCode`）

### 方案一（已定）：**不改 worker**

云端是整包自更新，改一行就会被覆盖。

---

## 5. 环境

### 测试云端（已部署，体检全绿）

```json
{"ok": true, "missing": [], "warnings": [], "instantChat": true,
 "instantTick": true, "backgroundJobs": true, "workerVersion": "2026-10-01.2",
 "selfUpdate": {"supported": false, "state": null}}
```

- worker `sullyos-test`，子域 `solly-test-5f67c4`
- 地址 `https://sullyos-test.solly-test-5f67c4.workers.dev`
- D1 `832bd291-219e-46cb-b2ec-acbd00277209`（`sully-amsg2-test`）
- 5 个 secret 全绑上（`AMSG_MASTER_KEY` / `AMSG_SERVER_TOKEN` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_EMAIL`）
- `selfUpdate.supported: false`（自更新按暮色定关着）
- cron 实测 `{"cron": "* * * * *"}`
- 凭证在 `.secrets/test-env/`（`.gitignore` 已生效）
- 三处 sha256 完全一致：镜像 / 本地 `.secrets/test-env/worker.bundle.js` / 线上自报

### 测试包

**最新那个（带租约调用点，验 13 条用这个）：**

```
android/app/build/outputs/apk/debug/拾光机-2026-10-03-634071a0-test-debug.apk   43.9 MB
package:           com.aetheros.simulator.amsgtest    ← 跟正式包不同，可共存、数据隔离
versionName:       2026-10-03-634071a0-test             ← 带 commit
application-label: Solly                               ← 桌面名跟「拾光机」不同
```

`aapt2 dump badging` 实测输出（aapt2 在 gradle 缓存里，SDK 那个路径没有）：
```
package: name='com.aetheros.simulator.amsgtest' versionCode='1791012455' versionName='2026-10-03-634071a0-test' ...
application-label:'Solly'
```

**上一个（没有租约调用点，已作废）：** `拾光机-2026-10-02-fe71839b-test-debug.apk`
⚠️ `changelogs/2026-10-02-amsg2-realign-step11-and-stamp.md` 里写的包名是
`2026-10-02-7fcd34f5-test-debug.apk`，**磁盘上从来没有过那个文件**（实际是 `fe71839b`）。
以磁盘为准。

**⚠️ 两个包都没装到手机上。**

### 包内容怎么验的（这套方法下轮直接用）

**先踩的坑：主动消息代码不在主 bundle 里。** 主文件 `index.*.js` 里搜「回到你自己」
是 0 命中 —— 看着像"包是旧代码"。实际它在 **`memory-palace.*.js`** 那个 chunk
（chunk 名跟内容无关）。**在主 bundle 里搜主动消息的东西一律会误判。**

**光搜符号不够** —— 压缩会把函数名改成 `Q9`、`K9` 这样的短名，搜不到不代表没打进去。
真正能用的是**先确认 APK 里的 chunk 跟本地 `dist/` 的一致**：

```bash
shasum -a 256 <解包出来的 chunk> dist/assets/<同名 chunk>
```

这次两边都是 `4a5063be8ebd1de8…` → 一样，就说明 APK 里跑的就是本地这份 build。
先锁死这一点，再去 dist 里找符号。

在 dist 主 bundle 里找到的证据（`useChatAI` 的 `triggerAI` 入口，压缩后）：

```js
if(j||!t)return;                                    // if (isTyping || !char) return;
const Ye=t.activeMsg2Config;
Ye!=null&&Ye.enabled&&Ej(Ye)&&K9(t.id,V8(We));     // 前置条件 + start(char.id, getLastReal(userMsgs))
const ge=`tr_${Date.now().toString(36)}_...`;       // 紧接着就是 triggerId 那行 → 位置对得上
```

以及 `finally` 块开头：

```js
}finally{Q9(t.id);const qt=Hs=>{...}}                // stopAmsgChatPresence(char.id)
```

短名对应（各「1 处定义 + 1 处调用」，用 `(?<![A-Za-z0-9_$.])名(?![A-Za-z0-9_$])` 数）：

| 短名 | 是谁 | 计数 |
|---|---|---|
| `K9` | `startAmsgChatPresence` | 2（定义+调用） |
| `Q9` | `stopAmsgChatPresence` | 2（定义+调用） |
| `V8` | `getLastRealUserMessageAt` | 2（定义+调用） |
| `Ej` | `hasActiveAiTask` | 5（定义 + 4 处调用，含我这处） |

11 步的代码也逐条核过（`memory-palace` chunk + 主 bundle）：
step 11 删的 5 个符号（`runtime-expire-swallow` / `runtime-expire-decision` /
`evaluateScheduledPushExpired` / `revokeSwallowedSelfLogEntry` / `canExpire`）**全 0 命中**；
钢印位置（`e0e59ea2`）实测是
`...]).concat((S=r?.pendingNoticesBlock)!=null&&S.trim()?["",...,""]:[],\`（开口前回到你自己：...\`)`，
**回执确实拼在钢印前面**；`quota-blocked` 2 次、`user-cancelled` 3 次、`最近没响` 1 次、
`遇忙作废` 1 次、`强制发送` 2 次、`occurrenceMs`、`lastUserMessageAt` 都在。

**云端那道 `active-chat-presence` 门从这一个包开始会生效**（前面那些包里没人写
`chat_presence`，那道门等于不存在）。第 1 条的原因可能因此显示
`active-chat-presence` 而不是 `conversation-moved-on`。

### 正式环境（**没动过**，只是记录位置）

账号 `af81f767662c9764072455ffdd6b6cc1`，D1 `fb42b0b1-5a44-42cf-bf76-b32a085bbc19`，
worker `sullyos`，token 在 `/tmp/.cftok`

---

## 6. 活跃会话租约的调用点（暮色 2026-10-03 拍板走方案 C，已提交）

暮色授权补「活跃会话租约」的调用点 —— 补之前 `chat_presence` 云端**一直是 0 行**，
也就是 worker 那道 `active-chat-presence` 门等于不存在。

- 19-21 行：import 里加 `hasActiveAiTask`（从 `../utils/amsg2Tasks`）
- 22-27 行：加 `startAmsgChatPresence` / `stopAmsgChatPresence` / `getLastRealUserMessageAt` 的 import
- `triggerAI` 入口 `if (isTyping || !char) return;` **之后** → 照搬原作者的
  `amsg2Cfg?.enabled && hasActiveAiTask(amsg2Cfg)` 前置条件，通过才
  `startAmsgChatPresence(char.id, getLastRealUserMessageAt(currentMsgs))`
- `finally {` 块**开头** → `stopAmsgChatPresence(char.id)`
- `utils/amsgStateSync.ts` 函数体**一行没动**

### TDZ 三点（暮色点名要先确认，结论：都不会崩）

1. `char` —— 上一行 `if (isTyping || !char) return;` 已经判过空
2. `hasActiveAiTask` —— 模块顶层 import，模块初始化时就绑好
3. `activeMsg2Config` —— `types.ts:1427` 的可选字段，`?.` 兜住

### 原作者的调用位置（照抄依据）

`git grep "AmsgChatPresence" upstream/master` —— **全仓只有 2 个调用点**：

```
upstream/master:hooks/useChatAI.ts:41:import { markAmsgStateDirty, startAmsgChatPresence, stopAmsgChatPresence } from '../utils/amsgStateSync';
upstream/master:hooks/useChatAI.ts:1354:    startAmsgChatPresence(char.id, getLastRealUserMessageAt(contextMsgs));
upstream/master:hooks/useChatAI.ts:2110:    stopAmsgChatPresence(char.id);
```

- **没有**页面挂载/卸载，**没有** `visibilitychange`（`grep visibilitychange upstream/master` 在
  `utils/hooks/apps/components` 里 **0 命中**）
- 租约实现两边**逐字一致**：
  `diff upstream:utils/amsgChatPresence.ts 本地` → 完全一致
  `diff upstream:amsgStateSync.ts 767-808 本地 680-721` → 完全一致
- 作者原注释（`utils/amsgChatPresence.ts:9-12`）：
  > 一轮真实用户消息进入生成流程时立即写 `chat_presence`，等待角色回复期间每 15s 续租；
  > 成功/失败/中断后停止续租，远端值靠 45s TTL 自然失效。
- 暮色担心的「阅读/打字超 45 秒云端判不在场」**原作者同样存在**，不是我们引入的。
  **方案 C = 照搬，不额外在页面挂载时开第二份租约**，这个缺口按原作者的样子留着。

### 遗留项：为什么用 `currentMsgs` 而不是原作者的 `contextMsgs`

本地 `hooks/useChatAI.ts` 里 `contextMsgs` 在 **1092 行**才定义（可能换成 `fullHistory`），
调用点在它**之前**，用 `contextMsgs` 会直接 TDZ 崩（这项目 7-31 刚被 TDZ 崩过一次）。
所以取 `triggerAI` 的入参 `currentMsgs`。

**暮色 2026-10-03 拍板：接受这个差异，记成遗留项。** 具体表现：`currentMsgs` 里
**一条真实用户消息都没有**时（全是角色主动发的 / 卡片 / 转发），这里算出 `null`，
而原作者会从完整历史里翻出最后一条真实用户消息。`lastUserMessageAt` 传 null 时，
worker 侧 `laterOf` 会退回用 `fire_pack` 里的旧值。

`as any` 已去掉（`Message.metadata` 是 `any`、`role` 是 `string` 的子类型，本来就兼容）。
去掉后 tsc 仍是 379 且与基线逐字一致，vitest 452/5 不变。

---

## 7. ⚠️ 一个我自己犯的错：`2547e084` 误带了 10 个无关文件

> 暮色 2026-10-02 初版这里写的是「12 个」，**数错了**。2026-10-03 用
> `git show --numstat 2547e084` 逐文件核过：15 个文件里 5 个是真改动、**10 个是误带**。

那三个无关文件被 `git add` 扫进去了（当时工作区有别的窗口留下的改动）：

```
.vite/deps_temp_c505ad87/package.json          3 +
changelogs/2026-08-04-dateapp-3mode-prompt-split.md   68 +
changelogs/2026-09-05-push-c-and-memo.md        89 +
notes/2026-09-04-character-memo-design.md      436 +
notes/2026-09-04-sully-architecture-survey.md  624 +
notes/2026-09-04-sully-character-intent-design.md 846 +
notes/2026-09-05-push-c-plan.md                217 +
public/splash-new.png                    Bin 0 -> 2735439 bytes   ← 2.7 MB 二进制
thought-display-options.html                381 +
timestamp-position-options.html              547 +
```

`notes/` 那 4 份可能是**暮色自己在别的窗口写的**（不敢自己删）。`public/splash-new.png`
和 `.vite/deps_temp_*/` 明显是垃圾。**合并到 master 之前要处理，等暮色定。**

---

## 8. 没做的 / 进行到哪

### 代码已改完，卡在这

- [ ] **【等暮色】装测试包到手机** + 设置页填测试云端地址和密钥
- [ ] 真机实测 13 条验收（清单见下）
- [ ] 验收通过后才推 master / preview

### 验收清单：13 条

> **原来的「11 条验收」逐条原文没能捞回来** —— 翻了 `notes/` 全部、`changelogs/` 全部、
> 本轮 25 个提交的完整 message + body，**任何文件或提交里都没存过**，它只在对话里说过。
> 下面这份是 2026-10-03 按 11 步的行为重写、再按暮色当天的要求改过第 1/3/5/6 条并加了
> 第 12/13 条。**暮色已过目确认可用。**

**两个前提**（影响每一条的期望）：

1. 定时器每分钟一跳，**实测真实触发比设定时间晚 45~73 秒**。所以「到点前 10 分钟内说话」
   要按**设定时间**算，不是按手机看到推送的时间。
2. 新包带上了租约调用点，**云端那道 `active-chat-presence` 门会开始生效** ——
   用户正在跟这个角色聊天时，到点那条 expire 任务会被这道门拦下。

#### 第 1 条 · 遇忙作废：到点前说过话 → 不推、面板说得出原因

- **准备**：建一条**遇忙作废**的一次性任务，设定时间设在 **10 分钟后**
- **触发**：设定时间**前 5 分钟**给角色发一条真实消息（要发出去，不能只是打开聊天页）
- **推送**：**不该有任何推送**
- **面板**：「最近没响的」里出现这一条。⚠️ **新包有了 presence 门以后，原因可能显示
  `active-chat-presence`（到点时用户正跟这个角色聊天）而不是 `conversation-moved-on`**
  —— 取决于 10 分钟后那一刻你是不是还在跟这个角色的这一轮生成里。两种都算过。
- **回执**：**角色那边什么都读不到** —— 遇忙作废刻意不产段（`buildNoticeSections` 把
  `kind='expired'` 静默滤掉）。这是定案，别误判成 bug。
- **数据库**：`client_state` 的 `last_skip` 多一条，reason 是上面两种之一

#### 第 2 条 · 遇忙作废：到点前**没**说话 → 正常推

- **准备**：同一条遇忙作废的一次性任务，设定时间同样 10 分钟后
- **触发**：**什么都别发**，安静等
- **推送**：**正常收到**一条角色消息
- **面板**：「最近没响的」里**没有**这一条
- **数据库**：`last_skip` **没有**新记录

#### 第 3 条 · 强制发送：到点前说过话 → 不推，改在对话里带出

- **准备**：建一条**强制发送**的一次性任务，设定时间 10 分钟后
- **触发**：**设定时间前 5 分钟**说一句，等到**设定时间 + 2 分钟以后**再发一句，
  **角色这一轮要带出那件事**
- **推送**：设定那一刻**不该有推送**
- **面板**：「最近没响的」里出现这一条，标着**已推迟**
- **回执**：角色那一轮的上下文里出现这一段（原文）：
  > 已推迟（到点时用户刚跟你说过话，所以这次没有插嘴）：
  > 这几条不是取消，是**这轮对话里换种方式说出来**——用户在跟你说话，硬插一条定时消息会撞车。

  **必须真的顺口提了那件事才算过**，光有回执不算。
- **数据库**：`last_skip` 有记录

#### 第 4 条 · 强制发送：到点前**没**说话 → 正常推

- **准备**：强制发送一次性任务，设定 10 分钟后
- **触发**：安静等
- **推送**：**正常收到**
- **面板**：「最近没响的」里**没有**这一条
- **回执**：角色上下文里**没有**任何推迟段

#### 第 5 条 · 强制发送的 30 分钟兜底：没说出来就补一条

- **准备**：强制发送一次性任务，设定时间 10 分钟后
- **触发**：**设定时间前 5 分钟说一句，之后不再发任何消息**，等**设定时间 + 30 分钟**的兜底
- **推送**：设定那一刻不推；**设定 + 30 分钟**推一条 `到点啦：<你当初定的那件事>`
  （`buildFallbackText`，原文照拼，不改写）
- **面板**：任务列表里**看不见**这条兜底（兜底三不之一：不给人看）
- **数据库**：`scheduled_messages` 里能看到这条，但客户端面板不列

#### 第 6 条 · 兜底配对：角色说出来了，兜底就该消失

- **准备**：接第 3 条的做法 —— 强制发送 + 到点前说话，角色在对话里顺口带了出来
- **触发**：**设定时间前 5 分钟说一句，等到设定时间 + 2 分钟以后再发一句，
  角色这一轮把那件事带出来了**
- **推送**：**设定 + 30 分钟不该再冒出第二条**
- **面板**：兜底不列，看不出来
- **这是最容易翻车的** —— 以前会「每天早安说完话，30 分钟后又说一遍」

#### 第 7 条 · 兜底对账：孤儿会被清掉，缺的会补建

- **准备**：拿第 5 条那条已经触发过的任务
- **触发**：**打开主动消息设置面板**（对账在面板打开时跑，`ActiveMsg2SettingsModal.tsx:287`
  调 `reconcileFallbacks(skip)`）
- **期望**：已触发的主任务如果它的兜底还在跑 → 被取消；反过来该有兜底而没有 → 补建一条
- **面板**：任务列表里**不出现**「取消失败」的幽灵条目

#### 第 8 条 · 删掉「你一发消息就删掉角色自排任务」

- **准备**：让角色自己排一条主动消息（`source='character'`），确认面板里能看到
- **触发**：你**给角色发一条普通消息**，等它回完
- **期望**：那条角色自排的任务**还在** —— 没被自动删掉
- **这是 step 9 的核心**。以前你一回话它就没了

#### 第 9 条 · 面板两条策略描述不再挂反

- **准备**：打开主动消息设置面板
- **期望**（原文，`amsg2Tasks.ts:263-264`）：
  - **遇忙作废** = 直接取消，**聊天里永远不会出现**（不告诉角色）
  - **强制发送** = 到点前十分钟你在说话就改在下一轮顺口带出；一直没带出来，30 分钟后兜底补一句
- **以前是反的**：遇忙作废挂着「转为对话里自然带出」，你按那句去等，等不到就以为功能坏了

#### 第 10 条 · 面板「最近没响的」

- **准备**：做完第 1 / 3 条之后
- **触发**：打开面板
- **期望**：一张卡（不是两处散的），标题「最近没响的」，折叠态显示最近那一次，展开态列回看期内
  每一次，每条带时间和原因
- **原因要对得上 `last_skip` 的原文**。10 种闸名的人话在 `utils/amsgFirePack.ts:204-236`：
  `active-chat-presence` 到点时用户正跟这个角色聊天 / `conversation-moved-on` 排程之后对话已经往前走了 /
  `schedule-off` 开关关着 / `min-gap` 间隔没过 / `unanswered-limit` 连发上限 /
  `recurring-unanswered` 连续几声没回 / `daily-limit` 今天次数满了 /
  `empty-generation` 模型没写出正文 / `side-effects-only` 只做了副作用 / `stale` 过期太久
- **不知道原因时要明说「云端没留下原因」，不准瞎编**

#### 第 11 条 · step 11 专项：一次性任务到点后说话，必须送达

**11 步里唯一一个「修 bug」性质的验收，也是最该重点测的。**

- **准备**：建一条遇忙作废的一次性任务，设定时间 10 分钟后
- **触发**：**到点前后都别说话**，等推送来了之后**再**回一句
- **期望**：
  - **推送必须正常收到**（到点那一刻你没说话，云端就该发）
  - 你回话之后**消息不会被吞掉**
  - 面板「最近没响的」里**没有**这一条
  - `last_skip` **没有**新记录
- **老版本这里是坏的**：它拿「设定时间之后有任何消息」当判据、**没有时间上限**。
  你早上收到消息、晚上随口回一句，那条就被吞了
- **注意时间窗**：真实触发比设定时间晚 45~73 秒。「到点后说话」得在这 73 秒**之后**，
  别卡在中间（卡中间会落进云端的 `last <= nowMs` 判定里，那是另一个结果）

#### 第 12 条 · 连续 3 次没回就停掉以后，兜底也不推

- **准备**：建一条**强制发送**的循环任务（比如每天早上 8 点）
- **触发**：连着 3 天**故意不回**它的消息（触发 `recurring-unanswered` 那道闸，它到上限后
  就不再自己响）
- **期望**：
  - 主任务**不再推送**
  - **+30 分钟的兜底也不推送** ← 这条是重点。循环停掉之后兜底跟着一起消失，
    不该出现「主任务不响了、兜底还在 30 分钟后冒出来」
  - 面板「最近没响的」里能看到 `recurring-unanswered`（连续几声没回，达到上限）
- **数据库**：`last_skip` 里能看到 `recurring-unanswered` 那条

#### 第 13 条 · 每天 8 点的强制发送循环任务：当天兜底不推，第二天主任务和兜底都还在

- **准备**：建一条**强制发送**的**每天 8 点**主任务（它会自动配一条 8:30 的兜底）
- **触发**：第一天**在 8 点那轮正常回一句**（或者用第 5 条那种「说完就不管」也行，
  关键是让主任务这次**真的说出来了**）
- **期望**：
  - **当天 8:30 的兜底不推**（主任务说出来了，兜底多余）
  - **第二天的主任务还在**（8 点照常会响）
  - **第二天的兜底也还在**（8:30 那条被重建了，不是被连根删了）
- **面板**：任务列表里**只看到一条**每天 8 点的任务，**看不到**那条 8:30 的兜底
  （兜底三不之一：不给人看）
- **最容易翻车的**：以前会「第二天没有兜底了」—— 循环销兜底的同时没按下个周期重建，
  第三天起彻底没后路

### 已定「本轮明确不改」

- [ ] **`shouldDeferOccurrence`（`utils/amsg2DeferredScan.ts:79`）与云端差 0~60 秒** ——
      客户端右端是 `occurrenceMs`（设定时间那一刻），云端是 `occurrence+10min` 再夹 `nowMs`，
      而 `nowMs` 最多比设定时间晚 60 秒（cron 一分钟一跳）。后果：用户恰好在设定时间到
      定时器跳之间说话 → 云端作废、客户端不记回执 → 面板查不到、角色不知道、"强制发送"的
      +30 分钟兜底不会被销掉会单独冒出来。触发条件苛刻。**暮色 10-02 定：先不改。**
- [ ] `source='manual'` 与类型 `'user' | 'character'` 不符（不影响任何判断）
- [ ] step 11 没写单测（要 mock 整条冲刷管线，不比真机验收真）
- [ ] 方向二台账按**角色**记（不按任务）—— 精度缺口

### 待修（本轮之外）

- [ ] 报告里更正「触发浮动 0~60 秒」为实测值（**6 次实测全部超过 60 秒**）
- [ ] 撤回「presence 通道已覆盖上传滞后」的论证
- [ ] 修 14:30 那次的推送投递失败（522）
- [ ] 角色 7497 / Solly 的 API 凭据刷新失败
- [ ] 残留的 `sullyos-amsg` 旧后端 + 同名库删不删
- [ ] 暂放：令牌格式、限流明细、名额显示

---

## 9. D1 里能查到什么 / 查不到什么

### 查得到

- `scheduled_messages`（3 行，全 `pending` / `retry_count=0` / `last_error=None`）
- `client_state`（5 行：`daily_sends` / `fire_pack` / `self_log` / `tool_config` / `tool_pack`）
- `message_outbox`（12 行 = 6 次 fire × 2 段）
- `worker_diagnostics`（1 行 `schema_ensured`）
- `push_subscriptions`（1 行）

### 查不到（确认过，别再找）

- **聊天记录**（用户消息时间戳）—— 要拿测试期间的真实时间戳只能从 app 本地导出
- **`last_skip` 历史** —— 一直是 0 行
- **云端判据执行日志**
- `scheduled_messages` 里**没有** `isForceAsExpire` / `amsgForceDeferred` / `occurrenceMs` /
  `fireAtMs` 这类字段 —— **策略字段在加密的 `encrypted_payload` 里**，要用
  `scripts/amsg-task-inspect.mjs` 解开。`fireAtMs` 根本不存在，只能用
  `message_outbox.created_at` 近似。

### 2026-10-02 暮色测试期间的实测

- **6 次 fire，判据一条都没拦**（`chat_presence` / `last_skip` / `last_error` /
  `tick_failure` 全 0 行）
- **实测触发偏移**（设定时刻 → 写 outbox）：
  `+63.0` / `+52.4` / `+45.3` / `+72.8` / `+66.4` / `+47.6` 秒
  —— **全部超过 60 秒，与我之前推导的 0~60 秒不符**
- `32ac3c5d`（14:30 那次）两段 `delivered_at = NULL` = **NEVER_DELIVERED**，
  其余 5 次成功 → 522 是 **Web Push 投递层失败，与判据无关**
- 截图里「该角色已有 1 条任务的 API 凭据没刷新成功」= 角色 7497 / Solly 的聊天 API
  配置问题，**与主动消息判据无关**

---

## 10. 环境坑（这轮踩的，下轮别再踩）

1. **代理端口会变**（7890 ↔ 7891）。推之前先探活：
   ```bash
   for p in 7890 7891; do
     curl -s -o /dev/null -w "$p %{http_code}\n" \
       --proxy http://127.0.0.1:$p --max-time 12 https://github.com
   done
   git -c http.proxy=http://127.0.0.1:$p -c https.proxy=http://127.0.0.1:$p \
     push origin fix/amsg2-realign
   ```
   env 里的 `all_proxy` 不够，git 优先用自己的 config。

2. **workers.dev 现在直连能通，走代理反而断**（跟之前记的正好相反）。两种都试一遍。

3. **Cloudflare 不允许拉 worker 源码**（`/content` 端点 405，令牌无读脚本权限），
   只能用版本号字符串当指纹。

4. **写测试做变异验证时必须用编辑工具改文件** —— 用 bash 里的 python 改会**静默不生效**，
   然后误判成「测试不灵」。

5. **本地权限闸会拦 `rm -rf`**（路径解析到工作区），要删临时目录用 `mktemp -d`。

6. **DNS 在这个网络被污染。**

---

## 12. ⚠️ 提示词跟 step 9 打架（2026-10-03 查到，**未改**，等暮色定）

`schedule_next_wakeup` 排的 dynamic 到底算不算「角色自排」、跟 step 9 删掉的那条逻辑冲不冲突。
查实如下。

### dynamic 的真实字段

`utils/proactivePushConfig.ts:403-410`（工具桥那条路径）+ `651-659`（token 解析那条路径）：

```ts
  taskInput: {
    mode: 'prompted',
    recurrenceType: 'none',
    firstSendTime: string;
    promptHint: string;
    reason: string;
    source: 'character';     ← 是的，算 source='character'
  };
```

`expirePolicy` 没显式传 → `resolveExpirePolicy('prompted', undefined)` =
`(mode === 'fixed' ? 'force' : (policy ?? 'expire'))` = **`'expire'`**（`amsg2Tasks.ts:56-59`）。

**所以 dynamic 三个条件全中**，正好是 `isReplaceableCharacterWakeup`（`amsg2Tasks.ts:214`）
允许被顶掉的那一类。

### 但提示词里有一句已经变成假话

`utils/chatPrompts.ts:315`（**这是真发给模型的字符串**）：

```
'- 暮色在 dynamic 时间到达前发任何消息，当前 dynamic 自动取消（不需要你自己处理）',
```

`cancelCharacterWakeups` 那个函数在 step 9（`217282e1`）里**被整个删掉**了
（`git show 217282e1 -- utils/activeMsgClient.ts` 显示整段函数体都是 `-`），
`Chat.tsx:1366-1372` 留了墓碑注释。**全项目现在没有任何地方调它。**

→ **提示词在骗角色**：角色会以为「用户发消息了我就不用管了」，结果那条任务还在，到点照样响。

`chatPrompts.ts:298` 的注释也是同一句过期描述。

### 紧挨着的第 316 行反而是对的

```
'- 新的回复会覆盖之前未触发的 dynamic（同一角色只有 1 条 dynamic 在册）',
```

这条对应 step 9 之后的入口闸，对 dynamic 成立（三条件全中）。
但对**循环 / 强制发送**的自排任务不成立 —— 入口闸会拒绝，诊断打
`wakeup-dedup-skip-local`（`proactivePushConfig.ts:613-622`）。
dynamic 不会是循环/强制发送（`recurrenceType` 写死 `none`、`expirePolicy` 默认 `expire`），
所以这句话对 dynamic 不用改。

### 还有一个容易混的点：老 1.x 通道**仍然**在取消

`Chat.tsx:1362` 的 `cancelDynamicScheduleOnWorker(char.id)` 还在，那条取消的是
worker 侧的 1.x dynamic schedule，**不是** 2.0 的 character wakeup。

→ 同一句提示词下，1.x 通道的行为和 2.0 通道的行为**现在不一样**。

**本轮不动。** 要改的话有两选：改提示词（把 315 那句删掉/改写成「你自己改口就再排一条，
新的会覆盖旧的」），或者把取消逻辑加回来（等于把 step 9 删的东西复活，跟新规则打架）。
**等暮色定。**

---

## 13. ⚠️ 测试该用哪个角色（2026-10-03 查实）

### 问题出在哪

测试云端 `sully-amsg2-test` 里 `llm_credentials` 表**只有 1 行**：

```
user_id:  7694a0d6-f7f6-419c-86f9-a4d25a25cf09
cred_id:  char:preset-sully-v2/chat
created:  2026-10-02T05:28:59.635Z
```

`char:preset-sully-v2` **不是真实角色的 chatId，是 Solly 那个预设**。
而 `client_state` 的 namespace 也只有 `amsg:char:preset-sully-v2` 一个角色。

→ 10-02 那次测试**全程只用了 Solly 一个角色**。截图里那句
「该角色已有 1 条任务的 API 凭据没刷新成功」就是这条，跟主动消息判据无关。

### 建议：换江澈或麦麦

- **江澈** `char-1777529391404`
- **麦麦** `char-1784463346142`

理由：它们**不走** `llm_credentials`（那张表只有 Solly 预设一条），走主 API，
所以根本不会撞上「凭据刷新失败」。

### 但要先做一件事

江澈/麦麦在测试云端是**全新角色**（云端一份包都没有）。先随便聊两句，
让它把 `fire_pack` / `tool_pack` 传上去，**再排任务**。

`amsg2Tasks.ts:89-93` 记着这条坑：欠着即时对话回复时 `fire_pack` 不覆盖，
新角色云端一份包都没有时会**硬失败**——不过那条已经配了真 fixed 兜底，30 分钟后原话照送，
是自愈的。实测时别撞上第一轮就排任务。

### 验完要清理

测试角色会在云端留下 `scheduled_messages` / `client_state` / `message_outbox` 行。
**删任何数据前先问暮色。**

---

## 14. 绝对红线

- **worker 绝对不碰** —— 只在报告里记，`worker/amsg/` 里任何文件包括 `index.ts` 都不能改
- **中间状态不得合进暮色日常用的 APK 或网页** —— 等 11 步验收通过才推 master 和 preview
- **沙盘不开自动更新；令牌明文暂不换**（暮色 10-01 定的）
- **删库里任何数据先问暮色**
- **密钥 / token 不打印到输出**
- **所有核对由麦麦自己做**（数据库查询、解密、看策略字段），暮色只看结论
- **严禁推测** —— 只查代码和真实数据，每步先贴真实原文 / 原始 SQL 输出，再给结论
