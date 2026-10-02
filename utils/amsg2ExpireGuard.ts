// utils/amsg2ExpireGuard.ts
/**
 * amsg2 防穿帮闸 — 纯判定逻辑。
 *
 * ⚠️ 叶子模块：会被 worker/amsg 打进 Cloudflare bundle，同时被客户端送达兜底
 * （activeMsgRuntime）与排程现状块（amsg2TaskContext）复用——不得 import
 * 浏览器 / DB / React 依赖（与 utils/agenticTools.ts 同一约束）。
 *
 * 语义（设计：claude-notes/2026-07-21-amsg2-liveness-design.md「防穿帮闸」）：
 *   - expire（默认）：到点时对话已前进 → 作废，转「排程现状块」告知；
 *   - force：闹钟型，照发；
 *   - 一次性任务「对话前进」= 创建锚点之后出现真实用户消息；
 *   - 循环任务只看「到点前 ACTIVE_CHAT_WINDOW_MS 内是否在聊」——用锚点的话，
 *     昨天聊过天就会永久作废今天的早安。
 */

export type AmsgExpirePolicy = 'expire' | 'force';

/**
 * ⚠️ 本文件是**云端线上代码的客户端镜像**。改动前先看下面的"镜像对照"，改错了一边
 * 面板就会跟推送说两套话。
 *
 * ## 镜像对照（麦麦 2026-10-02 实测）
 *
 * 线上跑的 bundle（`worker.bundle.js`，sha256 前 12 位 `3bcc8e259345`，worker 报
 * 2026-10-01.2；来自 Tosd0/sullyos-workers，那是个自动镜像，每次都从
 * `qegj567-cloud/SullyOS` —— 也就是我们的 upstream —— 同步构建产物）里：
 *
 *     var ACTIVE_CHAT_WINDOW_MS = 10 * 6e4;                              // 8889
 *     function shouldExpireFire(input) {                                // 8894
 *       if (input.policy !== "expire") return false;
 *       if (input.occurrenceMs == null) return false;
 *       const last = input.lastUserMessageAt;
 *       if (last == null) return false;
 *       return last > input.occurrenceMs - ACTIVE_CHAT_WINDOW_MS
 *        *           && last <= input.nowMs;
 *     }
 *
 * 三个容易看漏的地方：
 *
 *  1. **没有锚点**。线上 bundle 里 `anchorMs` 出现 0 次，一次性 / 每天 / 每周走同一条
 *     规则。老版本（2026-09-02，仓库里当时的样子）一次性任务走"锚点之后有任何消息
 *     就作废"，没有时间上限——那条已经没有了。
 *  2. **窗口是对称的**（`±10min`），但第三个条件 `last <= input.nowMs` 会把它夹住：
 *     `nowMs` 是 fire 的**真实执行时刻**，所以真正生效的区间是「设定时间前 10 分钟 ~
 *     实际触发那一刻」。
 *     浮动有多大？定时触发器是 `* * * * *`（bundle 11176 行），每分钟一跳；捞任务的条件
 *     是 `next_send_at <= now`（10836 行），`now` 就是 cron 那一刻。所以**延迟上限就是
 *     60 秒左右**，不是 10 分钟——`occurrenceMs + 10min` 那道上界在正常情况下永远碰不到，
 *     是冗余保险。（代码自己认的线也印证这个量级：`LATE_START_MS` 3 分钟算迟、
 *     `TICK_STALL_MS` 5 分钟算卡住。）
 *     结论：**「到点前 10 分钟」这条规则在线上是严格成立的**，真机验收「到点后说话仍
 *     送达」稳得很，不需要赌 cron 准不准。
 *     例外是重试退避（`retry_after` + `retry-wait` 状态），那是失败路径，间隔是秒级。
 *  3. 云端到点其实有**两道**门，`shouldExpireFire` 是第二道。第一道在 bundle 15813 行：
 *     `isFreshChatPresence(...)` —— presence 行 45 秒内新鲜就直接 skip，理由记
 *     `active-chat-presence`。它判的是"用户此刻正在打字/等回复"，比"到点前 10 分钟说过话"
 *     更近也更严。客户端**不复制这道门**（presence 45 秒 TTL 对回看期扫描没有意义，
 *     而且到点那一刻的判定本来就只该在云端做一次）。
 *
 * `occurrenceIsExpired` 是这套判据的**唯一定义**，推送判定（`shouldExpireFire`）和
 * 面板回执判定（`detectExpiredOccurrences`）都调它。抄两份必然漂移。
 */

/** 循环任务的「正在聊天」窗口：到点前后 10 分钟内有真实用户消息就算热聊。 */
export const ACTIVE_CHAT_WINDOW_MS = 10 * 60_000;

/** 触发时刻附近的推理/送达宽限（fire 后 10-30s 才送达，判定窗口向后放这么多）。 */
export const FIRE_GRACE_MS = 90_000;

/** 排程现状块只回看这么久内的触发时刻，太老的不再提。 */
const DEFAULT_LOOKBACK_MS = 48 * 3600_000;

const DAY_MS = 24 * 3600_000;

/** 循环任务两次触发之间隔多久；一次性任务没有周期，返回 null。 */
export const recurrencePeriodMs = (recurrenceType: string | undefined): number | null =>
  recurrenceType === 'daily' ? DAY_MS
    : recurrenceType === 'weekly' ? 7 * DAY_MS
      : null;

/**
 * 这一次触发到底该不该被让开 —— 云端判据的唯一定义。
 *
 * 与线上 `shouldExpireFire` 逐条对应（见文件头"镜像对照"）。**改这里等于改云端行为**，
 * 改之前先确认线上那份是不是也跟着变了。
 *
 * @param lastUserMessageAt 用户**最后一次**发真实消息的时刻（全局最后一条，不是窗口内最后一条）。
 *   云端那边是 `laterOf(fire_pack 快照, presence 行)` 算出来的，客户端用本地历史算——
 *   取的都是「最后一次」，口径一致。
 */
export function occurrenceIsExpired(input: {
  lastUserMessageAt: number | null | undefined;
  occurrenceMs: number | null | undefined;
  nowMs: number;
}): boolean {
  if (input.occurrenceMs == null) return false;
  const last = input.lastUserMessageAt;
  if (last == null) return false;
  return last > input.occurrenceMs - ACTIVE_CHAT_WINDOW_MS
    && last <= input.occurrenceMs + ACTIVE_CHAT_WINDOW_MS
    && last <= input.nowMs;
}

export interface ExpireFireInput {
  policy: string | undefined;
  /** 判定时刻已知的最后一条真实用户消息时间戳。 */
  lastUserMessageAt: number | null | undefined;
  nowMs: number;
  /**
   * 本次触发时刻。窗口锚定它而不是 nowMs——生成+送达可能比到点晚十几分钟，拿判定
   * 时刻算 10 分钟窗会把撞上对话的消息误放行。
   */
  occurrenceMs: number | null | undefined;
}

/**
 * fire 时刻该不该作废这次触发。
 *
 * 判据全部在 `occurrenceIsExpired` 里，这里只管"策略不是 expire 就放行"这一条。
 *
 * ⚠️ 客户端**已经没有任何调用者**（step 11 把送达兜底闸整条删了，云端是唯一真相）。
 * 它留着是因为仓库里的 `worker/amsg/src/index.ts` 还 import 着它——那份源码是 2026-09-02
 * 的旧版、我们不部署，但改函数签名会把它编译坏。线上跑的不是这份，是每天自更新拉的
 * 镜像包（见文件头"镜像对照"）。
 */
export function shouldExpireFire(input: ExpireFireInput): boolean {
  if (input.policy !== 'expire') return false;
  return occurrenceIsExpired({
    lastUserMessageAt: input.lastUserMessageAt,
    occurrenceMs: input.occurrenceMs,
    nowMs: input.nowMs,
  });
}

export interface RealUserMessageLike {
  role: string;
  timestamp: number;
  metadata?: Record<string, unknown> | null;
}

/** 「真实用户消息」定义与 activeMsgClient.buildTimeGapHint 保持一致。 */
const isRealUserMessage = (m: RealUserMessageLike): boolean =>
  m.role === 'user' && !(m.metadata as { proactiveHint?: unknown } | null | undefined)?.proactiveHint;

export function getLastRealUserMessageAt(messages: RealUserMessageLike[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserMessage(messages[i])) return messages[i].timestamp;
  }
  return null;
}

/** (afterMs, beforeMs] 内是否有真实用户消息。 */
export function hasRealUserMessageBetween(
  messages: RealUserMessageLike[],
  afterMs: number,
  beforeMs: number,
): boolean {
  return messages.some((m) =>
    isRealUserMessage(m) && m.timestamp > afterMs && m.timestamp <= beforeMs);
}

/** 送达判定的回看窗：触发时刻之后这么久内的消息才算这次触发的产物。 */
const DELIVERED_WINDOW_MS = 30 * 60_000;

/**
 * 某个触发时刻附近是否真的送达过定时主动消息（区分「作废了」和「发出去之后
 * 用户才回复」）。定时任务的落库消息带 metadata.activeMsg2.taskId（非空）；
 * instant 聊天回复的 taskId 是 null，不算。
 *
 * 按精确 id 归属：任务的送达一定带同源 amsgClientTaskId，id 不同或缺 id 的消息都不算
 * 本任务的送达——否则会拿别的任务的送达当证据、误抹掉本任务的作废回执。
 */
export function hasDeliveredProactiveNear(
  messages: RealUserMessageLike[],
  occurrenceMs: number,
  clientTaskId: string,
): boolean {
  return messages.some((m) => {
    if (m.role !== 'assistant') return false;
    const meta = m.metadata as { activeMsg2?: { taskId?: unknown }; amsgClientTaskId?: unknown } | null | undefined;
    if (meta?.activeMsg2?.taskId == null) return false;
    if (meta.amsgClientTaskId !== clientTaskId) return false;
    return m.timestamp >= occurrenceMs - FIRE_GRACE_MS && m.timestamp <= occurrenceMs + DELIVERED_WINDOW_MS;
  });
}

export interface ExpiredNoticeCandidate {
  /** 一次性 = taskUuid；循环 = `${taskUuid}:${occurrenceMs}`。 */
  id: string;
  occurrenceMs: number;
}

export interface DetectExpiredInput {
  taskUuid: string;
  policy: string | undefined;
  recurrenceType: string | undefined;
  /** ISO 字符串，任务首次触发时间。 */
  firstSendTime: string;
  messages: RealUserMessageLike[];
  nowMs: number;
  lookbackMs?: number;
}

/**
 * 排程现状块的「这次没发出去」检出：回看期内哪些触发时刻**云端会判它作废**。
 *
 * 判据函数就是 `occurrenceIsExpired`——跟云端推送共用同一个函数，不是"照着写的相似版"。
 * 面板说「到点了却什么都没来」的理由必须跟角色实际收到没收到对得上，两处判据各写一份
 * 的话迟早会漂（2026-10-02 之前就是漂的：这里一次性走锚点、循环走对称窗，云端两条都不认）。
 *
 * ## 为什么喂进去的 `last` 和 `nowMs` 不是全局值（这里最容易写错）
 *
 * 云端是**一次 fire 判一次**：`last` 取的是那一刻已知的最后一条用户消息、`nowMs` 是
 * 那一刻。准点 fire 时两者都 ≈ 触发时刻，于是那条规则等价于「用户在**这次触发前** 10 分钟
 * 内说过话」。
 *
 * 而这里是**回头扫一整段历史**。每格都拿全局最后一条 / 扫描时刻 nowMs 去判的话，答案会
 * 整体偏掉：用户今天下午随口回了一句，昨天早上那次触发就被误判成"当时有人在说话"——
 * 那格连 `last` 都不该看见今天这条。所以每格取的是「**该次触发时刻当时**的最后一条真实
 * 用户消息」，`nowMs` 代入该次触发时刻。这是准点 fire 的等价回放。
 *
 * 代价是明确的：云端 fire **延迟**时能看见「到点后到判定前」那几分钟内的消息
 * （`occurrence + 10min` 那道上界就是为它留的），事后回看补不出这个信息——触发当时
 * 的 presence 早就过期了。宁可少报一条，也不凭空报一条没依据的。
 *
 * 另外，云端还有第一道门（`active-chat-presence`，判「此刻 45 秒内用户正在打字」），
 * 这里刻意没有：那是到点那一瞬间的事实，事后补不出来，补它只会让面板凭空多报。
 *
 * 调用方需另用 hasDeliveredProactiveNear 排除实际送达过的（这里不做，方便单测各管一半）。
 *
 * `force` 也放行：到点被让开的「强制发送」同样需要一个 id，好让面板把"顺口带出"和
 * "遇忙作废"分开说（措辞见 amsg2TaskContext 的 buildNoticeSections）。
 */
export function detectExpiredOccurrences(input: DetectExpiredInput): ExpiredNoticeCandidate[] {
  if (input.policy !== 'expire' && input.policy !== 'force') return [];
  const first = new Date(input.firstSendTime).getTime();
  if (!Number.isFinite(first)) return [];
  const horizon = input.nowMs - (input.lookbackMs ?? DEFAULT_LOOKBACK_MS);

  // 真实用户消息按时间排好序，逐格二分/线性回退找「当时那一条」。消息量就是一段聊天，
  // 格子数受 48h 回看期封顶（每天 1 格、每周 1 格），线性回退够用。
  const realUser = input.messages
    .filter(isRealUserMessage)
    .map((m) => m.timestamp)
    .sort((a, b) => a - b);

  /** 该次触发时刻当时、用户最后一条真实消息在不在、是什么时刻。 */
  const lastAt = (occurrenceMs: number): number | null => {
    let found: number | null = null;
    for (let i = 0; i < realUser.length; i++) {
      if (realUser[i] <= occurrenceMs) found = realUser[i];
      else break;
    }
    return found;
  };

  const periodMs = recurrencePeriodMs(input.recurrenceType);
  const out: ExpiredNoticeCandidate[] = [];

  // 一次性任务只有 first 这一格。它**不再需要锚点**：老版本靠 anchorMs 判「排完之后有
  // 没有任何消息」，没有时间上限，跨夜任务必然误判；而调用方从来不传这个参数，于是
  // 一次性任务在这里一条都产不出来（面板上只靠云端 last_skip 那一条撑着）。
  if (periodMs === null) {
    if (first > input.nowMs || first < horizon) return [];
    if (occurrenceIsExpired({ lastUserMessageAt: lastAt(first), occurrenceMs: first, nowMs: first })) {
      out.push({ id: input.taskUuid, occurrenceMs: first });
    }
    return out;
  }

  // 快进到回看期起点，别从几个月前逐个迭代。
  let t = first;
  if (t < horizon) t = first + Math.ceil((horizon - first) / periodMs) * periodMs;
  for (; t <= input.nowMs; t += periodMs) {
    if (occurrenceIsExpired({ lastUserMessageAt: lastAt(t), occurrenceMs: t, nowMs: t })) {
      out.push({ id: `${input.taskUuid}:${t}`, occurrenceMs: t });
    }
  }
  return out;
}
