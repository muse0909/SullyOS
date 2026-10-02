# step 11 + 钢印位置 — 主动消息 2.0 改造收尾

**日期**：2026-10-02
**涉及 commit**：`8ec4608f` `e0e59ea2` `76b16fa0`
**分支**：`fix/amsg2-realign`（远端 HEAD = `76b16fa0`）
**master / preview 远端仍在 `ef17e1aa`，全程未沾染**

---

## 改了什么

### 1. 钢印挪回模板最后一句（`e0e59ea2`）

「回到你自己」钢印是 recency 末位人声锚，靠**开口前最后一眼**起作用。早先把未消费
回执（到点推迟那种）用 `.concat()` 挂在钢印**后面**——理由是"拼尾巴比新加槽位简单"，
槽位那半句是对的，位置那半句是错的。

后果不报错、只是悄悄变差：主动消息更容易滑回均值腔。

- `buildFirePack`：`pendingNoticesBlock` 从钢印后面挪到钢印前面（`['', block, '']`）
- 普通聊天那条路（`insertAmsg2TaskContextBlock` 插在 `volatileTail` 之前、钢印焊在
  `volatileTail` 末尾）本来就是钢印最后，没动。现在两条路形状一致：
  `[任务 + 回执] → [钢印]`

### 2. step 11：删掉客户端那道「该不该说出口」的判定（`76b16fa0`）

收件箱里整套「防穿帮闸·客户端兜底层」拆掉，-270/+11。云端推来的东西直接落进聊天流。

---

## 动了哪些文件

- `utils/activeMsgClient.ts` —— `buildFirePack` 钢印位置；订正 `pendingNoticesBlock` 的 JSDoc
- `utils/activeMsgClient.fireTemplate.test.ts` —— **新建**，5 条
- `utils/activeMsgRuntime.ts` —— 删判定本体 + 全部配套件；文件头补墓碑注释
- `utils/amsgDiag.ts` —— 未动（那几个 trace stage 本来就没进枚举）
- `components/Amsg2DebugPanel.tsx` —— 删死掉的上色分支
- `utils/amsg2Tasks.ts` / `utils/amsgInstantChat.ts` —— 注释订正

---

## 踩坑 / 需要知道的（重要）

### 一、判断云端行为只能看线上 bundle，仓库源码会骗人

这是本轮最重要的一条，反复踩。

| | 版本 | `shouldExpireFire` |
|---|---|---|
| 仓库 `utils/amsg2ExpireGuard.ts` | 2026-09-02 | 一次性走**锚点**分支；循环走 `-10min ~ nowMs` 非对称窗 |
| 线上 bundle | 2026-10-01.2 | **对称 ±10 分钟窗，一次性/每天/每周一视同仁，锚点概念整个没了** |

硬证据：`anchorMs` 这个字符串在 `/tmp/author-bundle.js`（sha256 前 12 位
`3bcc8e259345`，与正式云端 `/config-check` 报的 `selfUpdate.state.bundleHash` 一致）
里出现 **0 次**。

**所以「读仓库源码推测云端行为」会得到错答案。** 方案一（不改 worker）正是在这个
事实前提下定的。

### 二、原来那道客户端闸为什么是「必然打架」而不是「重复劳动」

1. **判据分叉**：一次性任务走"锚点之后有任何消息就作废"，**没有时间上限**。用户到点后
   说过话就整条被吞，而云端照规矩推了。
2. **判的时刻不同**：客户端拿送达时刻的 `Date.now()` 配本地历史，云端拿到点那一刻。
   生成 + 送达晚几十分钟是常事。
3. **新鲜度顾虑已不成立**：云端读的是
   `laterOf(fire_pack 快照, presence 行)`，presence 是每轮聊天开场就写的几十字节、
   TTL 45s——**它本来就是为盖住 fire_pack 上传滞后才加的**。客户端这道闸当初存在的
   理由，已经有人补了。

第 3 条是关键。删之前如果没查到 `laterOf` + presence，就只能靠猜，删了会丢掉真实的
竞态保护。

### 三、测试 mock 踩的两个坑

- `vi.mock('./scheduleGenerator')` 整个 mock 掉 → `utils/context.ts` 要的
  `isEmotionOn` 没了，报"没有这个导出"。改成 `importOriginal` 部分 mock。
- 「模板里不该有花括号」这条判据**本身是错的**：那 9 个真槽位本来就该以占位符形态
  待着等 worker 填。改成「占位符只能出现在那 9 个已知槽位里」，并锚一条
  `AMSG_TASK_INSTRUCTION` 必须在，防占位模板假绿。

**并且验过它真能抓回归**：把回执挂回钢印后面，2 条立刻红。写完不验的测试等于没写。

### 四、代理端口会变

git 配的是 `http.proxy = http://127.0.0.1:7890`，梯子续费后 7890 死了、7891 活了。
推之前先探活口：

```bash
for p in 7890 7891; do
  curl -s -o /dev/null -w "$p %{http_code}\n" \
    --proxy http://127.0.0.1:$p --max-time 12 https://github.com
done
```

通了之后**必须显式覆盖**（env 里的 `all_proxy` 不够，git 优先用自己的 config）：

```bash
git -c http.proxy=http://127.0.0.1:7891 -c https.proxy=http://127.0.0.1:7891 \
  push origin fix/amsg2-realign
```

### 五、暮色 2026-10-02 复核后的补充（commit `7fcd34f5`）

暮色看完 step 11 的结果提了 7 个问题，逐条处理如下。

#### 1. 线上判据到底算不算「到点之后的消息」——**我上一条讲得不够严谨，认**

##### 1a. 补充查证：实际触发时间相对设定时间浮动多少、判据锚在哪（暮色 2026-10-02 追加问）

**浮动范围：0 ~ 60 秒。** 不是随机抖动，是"等下一个整分钟"。

- 定时触发器是 `AMSG_CRON_EXPRESSION = "* * * * *"`（bundle 11176 行）——**每分钟一跳**。
  测试云端 2026-10-01 建的触发器实测就是这个（`GET /workers/scripts/sullyos-test/schedules`
  返回 `{"cron": "* * * * *"}`）。
- 捞到期任务（10831-10839 行）：

  ```sql
  WHERE status = 'pending' AND next_send_at <= ?
  ```

  绑定的参数是 `options.nowMs ?? Date.now()`，也就是**cron 那一刻的时刻**。
  所以一条设定在 08:00:00 的任务，会在 08:00:xx 那一跳被捞走，xx 落在 0~60 秒之间。

- 代码自己认的两条线（10728-10729 行）也印证这个量级：

  ```js
  var TICK_STALL_MS = 5 * 6e4;   // 5 分钟 = 卡住了
  var LATE_START_MS = 3 * 6e4;   // 3 分钟 = 算迟
  ```

  也就是说设计者预期「迟到 3 分钟内」是正常范围，超过 5 分钟就算卡死。
- 例外是**重试**（`retry_after` 列 + `classifyOverdueTasks` 的 `retry-wait` 状态），
  失败退避会把时间往后推。那是失败路径不是正常路径，重试本身的间隔是
  `setTimeout(1000 * retryCount)`（1 秒、2 秒、3 秒…），量级是秒不是分。

**判据锚在「设定时间」，不是实际触发时刻。** 两个时刻是分开的：

```js
const occurrenceMs = Date.parse(String(ctx.task.nextSendAt));  // 15844  ← 设定时间
const expireInput = { ..., nowMs: ctx.now.getTime() };         // 15852  ← 实际 fire 那一刻
```

`ctx.now` 确实是现取的：`now: new Date(nowFn())`（3160 行），`nowFn` 来自 2874 行
`typeof ctx._agenticNow === "function" ? ctx._agenticNow : Date.now`，而
`_agenticNow` 在整个生产 bundle 里**只被读、从没被赋值**（只有 2874 一处），所以走的是
`Date.now()`。

**所以真实覆盖的区间是：设定时间前 10 分钟 ~ 实际触发那一刻**，
也就是 **设定时间前 10 分钟 ~ 设定时间后 0~60 秒**。

##### 1b. 更正：上一条把「到点后那半边」的范围说大了

上一条我写「fire 延迟时到点后 10 分钟内都可能算进去」。**不对。**
因为 cron 一分钟一跳，延迟上限就是 60 秒左右，那道 `last <= occurrenceMs + 10min`
的上界在正常情况下**永远碰不到**，它是冗余保险。

结论（这对我们有利）：

- **暮色定的「到点前 10 分钟」规则在线上是严格成立的**，不是"基本成立"。
- 「到点后你说话会不会导致作废」的准确答案是：**只有你恰好在那 0~60 秒里说话才会**，
  正常情况下几乎不会碰到。
- 真机验收「到点后说话仍送达」这个场景，实际上是稳的——不需要赌 cron 准不准。

##### 1c. 判据原文

原文照抄（`worker.bundle.js` 8889-8899 行，未压缩，共 16916 行；sha256 前 12 位
`3bcc8e259345`，worker 自报 `2026-10-01.2`）：

```js
var ACTIVE_CHAT_WINDOW_MS = 10 * 6e4;                    // 8889
function shouldExpireFire(input) {                      // 8894
  if (input.policy !== "expire") return false;
  if (input.occurrenceMs == null) return false;
  const last = input.lastUserMessageAt;
  if (last == null) return false;
  return last > input.occurrenceMs - ACTIVE_CHAT_WINDOW_MS
      && last <= input.occurrenceMs + ACTIVE_CHAT_WINDOW_MS
      && last <= input.nowMs;                           // 8898
}
```

调用现场（15844-15867）：

```js
const occurrenceMs = Date.parse(String(ctx.task.nextSendAt));   // 15844 计划触发时刻
const presenceLastUserMessageAt = presence?.charId === charId ? presence.lastUserMessageAt : null;
const expireInput = {
  policy,
  lastUserMessageAt: laterOf(pack.lastUserMessageAt ?? null, presenceLastUserMessageAt),
  nowMs: ctx.now.getTime(),                                        // 15852 fire 真实执行时刻
  occurrenceMs
};
if (!instant && shouldExpireFire(expireInput)) {                   // 15863
  await recordSkip(ctx, charId, "conversation-moved-on", occurrenceMs);
  return { skip: true };
}
```

**关键在 `nowMs` 是 fire 的真实执行时刻**（`ctx.now.getTime()`），它把 `+10min`
那半边夹住了：

- **准时 fire**：`nowMs ≈ occurrenceMs`，于是 `last <= occurrence+10min && last <= nowMs`
  等价于 `last <= nowMs`——**「到点后」那半边永远不生效，实际只看「到点前 10 分钟」**。符合规则。
- **fire 延迟**：延迟 3 分钟就在到点后 3 分钟内生效，超过 10 分钟被上界挡掉。

**所以我上一条写的真机验收场景「到点前没说话、到点后说了话必须送达」有前提**：
那次 fire 得准点跑完。准点的情况下云端判放行，删掉客户端闸之后消息照常送达——这点成立；
但不能像上次那样说得那么绝对。

**还有第二道门我上次漏了**（15813 行，在 15863 那道**之前**执行）：

```js
if (!instant && policy === "expire" && isFreshChatPresence(presence, charId, ctx.now.getTime())) {
  await recordSkip(ctx, charId, "active-chat-presence", ...);
  return { skip: true };
}
```

`isFreshChatPresence`（9230 行）= `activeAt <= nowMs + 10s && nowMs - activeAt <= 45s`。
它判的是「此刻 45 秒内用户正在打字」，比「到点前 10 分钟说过话」更近也更严。
**客户端不复制这道门**（见第 5 项）。

#### 2. 这套判据是谁写的——**原作者的，我们没碰过**

链路查实了：

```
qegj567-cloud/SullyOS（= 本仓库 upstream，原作者）
        ↓ GitHub Actions 自动同步（作者 github-actions[bot]，
          commit message 全是 "chore: sync worker bundles from qegj567-cloud/SullyOS@<sha>"）
Tosd0/sullyos-workers（纯镜像仓库，我们不部署它）
        ↓ 线上 worker 每天自更新去拉
线上 sullyos（正式）/ sullyos-test（测试）
```

三方 sha256 **完全一致**（`3bcc8e259345` / 771898 字节）：镜像当前那份、本地
`.secrets/test-env/worker.bundle.js`、线上正式云端自报的 `bundleHash`。方案一
（不碰 worker）站得住。

#### 3. 强制发送那条路删闸后还通不通——**通，零影响**

因为**云端判「这次别发」时压根不推 push**，客户端那道闸从来没机会参与。
被推迟时客户端能看到的只有"没有消息"，检出靠自己的扫描器。

每一环都在（都在客户端，都没被 step 11 碰到）：

| 环节 | 代码 |
|---|---|
| 建任务时把 force 翻成 expire + 打标记 | `activeMsgClient.ts:2663` / `:2739` |
| 建任务时同步建 +30 分钟兜底 | `activeMsgClient.ts:2893` → `scheduleFallbackTask`（`:2936`），`AMSG_FALLBACK_DELAY_MS` 在 `amsg2Tasks.ts:135` |
| 检出「这次被让开了」 | `amsg2TaskContext.ts:337` → `amsg2DeferredScan.ts` 的 `shouldDeferOccurrence` |
| 顺口带出（注入角色上下文） | `amsg2TaskContext.ts` 的 `buildNoticeSections` deferred 段 |
| 消费 + 销兜底 | `amsg2TaskContext.ts:396` `consumeAmsg2Notices`，调用点 `useChatAI.ts:2117` |
| 30 分钟后兜底自己响 | 兜底任务 `nextSendAt` = occurrence + 30min |
| 兜底对账 | `amsg2FallbackPair.ts:322` `runFallbackReconcile`，调用点 `ActiveMsg2SettingsModal.tsx:287` |

顺带一提：原闸里那段 `if (meta.amsgForceDeferred === true) return false;` 短路
（当时注释写着"整套送达判定最终会在 step 11 删掉"）现在随闸一起没了，效果一样
（都不吞）。

#### 4. worker 注释——**已在本文件第 105 行记一笔，worker 继续不碰**

#### 5. `detectExpiredOccurrences` 跟云端对齐（`7fcd34f5`）

抽了 `occurrenceIsExpired` 作**唯一实现**，`shouldExpireFire`（推送侧）和
`detectExpiredOccurrences`（面板侧）都调它。抄两份必然漂，而这正是 7-31 之前的现状。

**改出来一个副产品**：一次性任务以前**恒返回空数组**——老实现第一行
`if (input.anchorMs == null) return [];` 而调用方 `amsg2TaskContext.ts:343`
从来不传这个参数。面板上关于「一次性任务为什么没响」只剩云端 `last_skip` 一条撑着。
现在这条兜底路径通了。

**另一个自己踩出来的坑**（第一版写错了，被自己的测试当场逮住）：我一开始用
`getLastRealUserMessageAt(messages)` 取**全局**最后一条喂进去。原因——云端是
**一次 fire 判一次**（`last` = 那一刻已知的最后一条，`nowMs` = 那一刻），而这里是
**回头扫一整段历史**。每格都拿全局最后一条判的话，用户今天下午随口回一句，昨天早上
那次触发就被误判成「当时有人在说话」。

改成每格取「**该次触发时刻当时**的最后一条真实用户消息」，`nowMs` 代入该次触发
时刻——准点 fire 的等价回放。代价明确写在代码注释里：云端 fire **延迟**时能看见
「到点后到判定前」那几分钟的消息，事后回看补不出，宁可少报也不凭空报。

**测试**：新增 `utils/amsg2ExpireGuard.test.ts`，25 条。三个变异都验过能被抓住：
逐格 lastAt 换成全局最后一条 → 2 条红；去掉 `+10min` 上界 → 2 条红；去掉
`last <= nowMs` → 2 条红。

> 踩了个坑：用 bash 里的 python 改文件做变异，**改完回读发现根本没写进去**，连跑三遍
> 都以为「测试不灵」。后来改用编辑工具做变异才准。**验测试抓不抓得住回归，一定要先
> 回读确认变异真的写进去了。**

#### 6. 一直红的那 5 条测试

| 文件 | 用例 | 失败原因 |
|---|---|---|
| `utils/amsg2Tasks.test.ts` | `describeRemoteLastError` > reason 是一长串原始报错时截断 | 截断后长度 135，断言要 <120 |
| `utils/amsgFirePack.test.ts` | `renderFirePack — 把 includeClock 透传给场景块` > includeClock=false 时钟点消失，活动还在 | 关掉 includeClock 后场景块仍带 `22:00` |
| `utils/vrWorld/vrWorld.test.ts` | `VRScheduler.reconcile` > 补建 enabled 但缺调度的角色 | 测试自己没 stub `localStorage`，`ReferenceError: localStorage is not defined`（`vrWorld.test.ts:15`） |
| `utils/vrWorld/vrWorld.test.ts` | `VRScheduler.reconcile` > 清掉已删除/已关闭角色的残留调度 | 同上 |
| `utils/vrWorld/vrWorld.test.ts` | `VRScheduler.reconcile` > 间隔被改过 → 跟随最新设定，且不重置已有首火时间 | 同上 |

全是本轮之前就红的，跟这 11 步没关系。

#### 7. 测试环境

**测试云端已部署且体检全绿**（直连查询）：

```json
{"ok": true, "missing": [], "warnings": [], "instantChat": true,
 "instantTick": true, "backgroundJobs": true, "workerVersion": "2026-10-01.2",
 "selfUpdate": {"supported": false, "state": null}}
```

- worker `sullyos-test`，子域 `solly-test-5f67c4`，地址
  `https://sullyos-test.solly-test-5f67c4.workers.dev`
- `workerVersion 2026-10-01.2` = 我分析的那份，一字不差
- `selfUpdate.supported: false` = 自更新关着（暮色 2026-10-01 定的）

**测试包已打好并验过身份**：

```
android/app/build/outputs/apk/debug/拾光机-2026-10-02-7fcd34f5-test-debug.apk   (43.8 MB)
package: com.aetheros.simulator.amsgtest    ← 跟正式包不同
versionName: 2026-10-02-7fcd34f5-test        ← 跟 HEAD 对得上
application-label: Solly                     ← 跟「拾光机」不同
```

**applicationId 不同 = 可以跟正式包同时装在手机上，数据完全隔离**（各自独立的
存储、独立的 userId）。这解决了清单里挂了很久的「修身份撞车」那条——它本来就已经是
解决好的，只是没人确认过。桌面图标名字也不一样，暮色一眼能分辨。

包里确实是新代码（解开 APK 的 assets 核过）：

| 符号 | 结果 |
|---|---|
| `runtime-expire-swallow` | ✅ 已不在 |
| `runtime-expire-decision` | ✅ 已不在 |
| `evaluateScheduledPushExpired` | ✅ 已不在 |
| `revokeSwallowedSelfLogEntry` | ✅ 已不在 |
| `lastUserMessageAt` / `occurrenceMs` | ✅ 在 |

（函数名本身查不到是因为压缩时被重命名，整个模块 5 个导出名在包里都查不到；
对象属性名不压缩，用它复核。）

**没推 master / preview**，两个远端都还在 `ef17e1aa`。

### 六、这一轮新踩的坑：workers.dev 现在**直连能通，走代理反而断**

代理活着（GitHub 200），但 `sullyos-test.solly-test-5f67c4.workers.dev` 和正式
`sullyos.1812038909.workers.dev` **走代理一律 5 秒超时（code 000），直连反而 200**。

跟之前记的「workers.dev 必须走代理」正好相反。判断方法：两种都试一遍，谁通用谁。

### 七、留在清单里没做的

1. **step 11 没写单测**。闸是模块私有函数，唯一可观测效果是 flush 循环里那个
   `continue`；要钉住它得把整条冲刷管线连 DB 带后处理全 mock 出来，测出来的东西不比
   真机验收更真。真正的验收是装测试包实测。
2. **⚠️ `shouldDeferOccurrence`（`utils/amsg2DeferredScan.ts:79`）与云端判据差
   0~60 秒，暮色 2026-10-02 定：先不改，记在这里。**

   - 客户端的窗口是 `(occurrence-10min, occurrence]`（右端就是**设定时间**那一刻）；
     云端是 `(occurrence-10min, occurrence+10min]` 再夹 `nowMs`，而 `nowMs` 最多比设定
     时间晚 **60 秒**（cron 一分钟一跳，见 1a 节）。
   - **后果（暮色点名要写清的那条）**：在那 0~60 秒里用户发了消息 → 云端**作废**这次触发
     （不推送），但客户端 `shouldDeferOccurrence` 判 false → **不记回执**。于是
     - 面板「最近没响」里**不会出现**这一次（查不到原因）；
     - 角色**不知道**自己有条话没说出口，也就无从"顺口带出"；
     - **更实际的一条：「强制发送」任务的那条 +30 分钟兜底不会被销掉**，到点会照常推
       一条出去。而原任务已经被云端作废了——结果就是同一天、同一条早安，兜底在 30 分钟后
       单独冒出来，角色并不知道它本该在 8:00 说的话是什么（回执没进它上下文）。
   - 触发条件苛刻：必须恰好在设定时间到定时器跳之间的那不到一分钟里说话。准点 fire 的
     绝大多数情况不涉及。
   - 修法：把 `shouldDeferOccurrence` 的右端从 `occurrenceMs` 改成
     `min(occurrenceMs + ACTIVE_CHAT_WINDOW_MS, occurrenceMs + 实际延迟)` —— 但客户端
     事后扫历史**拿不到**当时的实际延迟（`presence` 早就过期），只能近似。是否值得做、
     怎么近似，等暮色定。**本轮明确不改。**
3. `source='manual'` 与类型 `'user' | 'character'` 不符（不影响任何判断）。


---

## 数据库里能查到什么、我怎么核对

step 11 本身**不产生任何数据**（纯删代码），所以核对靠行为：

| 场景 | 怎么验 | 数据库里看什么 |
|---|---|---|
| 一次性遇忙作废，到点前 10 分钟用户发过话 | 到点后**不该有 push** | `tasks` 表该行 `next_send_at` 前进到下一个周期；`client_state` 的 `last_skip` = `conversation-moved-on` |
| 同一个一次性任务，到点前**没**说话、到点后说了话 | 以前会被吞，**现在必须送达** | `messages` 表有那条落库记录；`last_skip` **没有**新记录 |
| 每天的遇忙作废，到点前 10 分钟说话 | 不推送 | 同上，`last_skip` = `conversation-moved-on` |
| 面板「最近没响」 | 折叠态显示最近那次，展开态列回看期内每一次 | 跟 `last_skip` + `occurred_at` 对得上 |

`scripts/amsg-task-inspect.mjs` 可以直接查 D1 那几行。

**关键一条**：第 2 行那个场景就是 step 11 修的 bug。以前客户端拿"锚点之后有任何消息"
判，延迟送达的窗口内用户一说话就吞。现在只看云端判没判。

---

## 备注

- 11 步全部改完。真机验收清单见下条待办。
- 中间状态**没有**合进 master / preview，符合暮色定的规矩。
- 沙盘（测试云端）**不开自动更新**、令牌明文**暂不换**，都还是暮色 2026-10-01 定的。
