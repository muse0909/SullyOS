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

### 五、留在清单里没做的三件

1. **`worker/amsg/src/index.ts:1696` 那句注释现在是错的**——它写「这点残余竞态由客户端
   送达兜底闸兜住（activeMsgRuntime 的 runtime-expire-swallow）」，那道闸已经没了。
   同属 worker 源码，方案一定的是不碰 worker，本轮没动。**下次读到别被误导。**
2. **回执侧的 `detectExpiredOccurrences`（`amsg2TaskContext.ts:343`）仍用旧判据**
   （对称窗 + 一次性走锚点），跟新规则对不上。它只喂面板的「最近没响」，且有
   `hasDeliveredProactiveNear` 送达过滤兜着，影响限于面板文案可能偏保守。
   到点推迟那条路走的是 step 4 的 `amsg2DeferredScan`（新判据），不受影响。
3. **step 11 没写单测**。闸是模块私有函数，唯一可观测效果是 flush 循环里那个
   `continue`；要钉住它得把整条冲刷管线连 DB 带后处理全 mock 出来，测出来的东西不比
   真机验收更真。真正的验收是装测试包实测。

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
