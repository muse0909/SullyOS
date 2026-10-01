/**
 * amsg2DeferredScan —— 「到点推迟」的客户端扫描器（麦麦 2026-09-30）。
 *
 * ## 这条链路解决什么
 *
 * 新规则：「强制发送」到点前 10 分钟内用户说过话 → 这次不推送，改在角色的下一轮
 * 上下文里顺口带出。这个"没推送"发生在**云端**（建任务时把 force 翻成 expire 发
 * 过去，云端到点判一次就跳），所以客户端**压根收不到那条 push** —— 收不到就没有
 * "收到时再判一次"的入口，角色手里也就没有任何东西能带出来。
 *
 * 所以必须主动扫一遍：到点已过 + 到点前 10 分钟有用户消息 + 那次没送达 → 写一条
 * 「到点推迟」回执，下一轮对话时告诉角色。
 *
 * ## 为什么判据要另写一套，不复用 detectExpiredOccurrences
 *
 * 旧那个是"防穿帮闸"的检出，两条判据都跟新规则对不上：
 *   - 循环任务看的是**前后对称窗**（到点前 10 分钟 ~ 到点后 10 分钟）。新规则只有
 *     前半段：到点后用户才说话，那是"这次照发了、延迟送达"，不是"该让开"。
 *   - 一次性任务看的是**锚点之后有没有任何消息**（可能隔了几小时）。新规则要的是
 *     到点那一刻的 10 分钟内。
 * 判据不同、结论就不同，混用会让"到点前 10 分钟用户说过话"这种最该让开的情况漏判，
 * 而"用户隔了半天后来说话"这种不该让开的反而被拦。
 *
 * 遇忙作废（expire）不走这里：那条规则是"直接取消、不告诉角色"（见 buildNoticeSections），
 * 它的检出还是旧那套 detectExpiredOccurrences。
 */

import { ActiveMsg2TaskRecord, CharacterProfile, Message } from '../types';
import { describeLastSkip, type AmsgLastSkip } from './amsgFirePack';
import {
  ACTIVE_CHAT_WINDOW_MS,
  hasDeliveredProactiveNear,
  hasRealUserMessageBetween,
  recurrencePeriodMs,
} from './amsg2ExpireGuard';
import { formatTaskTime, isForcePolicy } from './amsg2Tasks';

/** 扫多久以前的触发。太早的回执用户和角色都不关心，台账也只留 48h。 */
const DEFAULT_SCAN_LOOKBACK_MS = 48 * 3600_000;

/**
 * 到点后这么久还没收到东西，才算「没响」（面板上报用）。
 *
 * 不能取 0：云端是 cron 每分钟扫一次，生成 + 推送送达本身要十几秒，刚过点就下结论
 * 会把每次都报成"没响"。也不能太大——30 分钟那是兜底候补的时间，兜底一到点本来就
 * 该响，那时候还算"主任务没响"就对不上了。
 */
const DEFAULT_MISSED_GRACE_MS = 5 * 60_000;

export interface DeferredCandidate {
  /** 一次性 = taskUuid；循环 = `${taskUuid}:${occurrenceMs}`。 */
  id: string;
  task: ActiveMsg2TaskRecord;
  occurrenceMs: number;
}

/**
 * 这条任务需不需要扫「到点推迟」。
 *
 * 判据是"策略是强制发送" —— 只有它才有"让开再带出"这回事。固定模式恒无条件发，
 * 提示词/自动 + 遇忙作废走的是另一条规则（直接取消）。兜底任务自己恒定无条件推，
 * 同样不扫：它是"这次不许再让一次"的后路，让它也让路等于提醒彻底消失。
 */
export const isDeferrable = (task: ActiveMsg2TaskRecord): boolean =>
  task.status === 'scheduled'
  && !task.fallbackFor
  && isForcePolicy(task.mode, task.expirePolicy);

/**
 * 这次触发该让开吗 —— 新规则的全部判据。
 *
 * 四条同时成立才算：
 *   1. 到点已过（还没到的不算，那是未来的事）
 *   2. 到点**前** 10 分钟内有用户发的真实消息
 *   3. 那次确实送达了主动消息的话不能算（已经说过了，不该再带一遍）
 *
 * 第 3 条由调用方用 hasDeliveredProactiveNear 排（它需要 clientTaskId，不归这里管）。
 */
export const shouldDeferOccurrence = (input: {
  occurrenceMs: number;
  nowMs: number;
  messages: Pick<Message, 'role' | 'timestamp' | 'metadata'>[];
  lookbackMs: number;
}): boolean => {
  const { occurrenceMs, nowMs, messages, lookbackMs } = input;
  if (occurrenceMs > nowMs) return false;
  if (occurrenceMs < nowMs - lookbackMs) return false;
  // 只有到点前那半段。用户在到点**之后**才说话 = 这次照发了、只是送达晚了，
  // 那是另一回事，不该在这里被当成"该让开"。
  return hasRealUserMessageBetween(
    messages as any,
    occurrenceMs - ACTIVE_CHAT_WINDOW_MS,
    occurrenceMs,
  );
};

/** 一次扫描里能产出的全部候选（没做送达过滤，那条要 clientTaskId）。 */
export const scanDeferredCandidates = (
  tasks: ActiveMsg2TaskRecord[],
  messages: Pick<Message, 'role' | 'timestamp' | 'metadata'>[],
  nowMs: number = Date.now(),
  lookbackMs: number = DEFAULT_SCAN_LOOKBACK_MS,
): DeferredCandidate[] => {
  const out: DeferredCandidate[] = [];
  for (const task of tasks) {
    if (!isDeferrable(task)) continue;
    const first = new Date(task.firstSendTime).getTime();
    if (!Number.isFinite(first)) continue;

    const periodMs = recurrencePeriodMs(task.recurrenceType);
    if (periodMs === null) {
      // 一次性：只有首次那一次。到点还没过就跳过。
      if (first > nowMs) continue;
      if (!shouldDeferOccurrence({ occurrenceMs: first, nowMs, messages, lookbackMs })) continue;
      out.push({ id: task.taskUuid, task, occurrenceMs: first });
      continue;
    }

    // 循环：回看期内的每一次都要看。快进到起点，别从几个月前逐个迭代。
    let t = first;
    if (t < nowMs - lookbackMs) {
      t = first + Math.ceil((nowMs - lookbackMs - first) / periodMs) * periodMs;
    }
    for (; t <= nowMs; t += periodMs) {
      if (!shouldDeferOccurrence({ occurrenceMs: t, nowMs, messages, lookbackMs })) continue;
      out.push({ id: `${task.taskUuid}:${t}`, task, occurrenceMs: t });
    }
  }
  return out;
};

/**
 * 扫一个角色，把「该推迟但没说出口」的写进回执台账。
 *
 * 返回真正新写进去的那些（面板刷新 / 测试要看的是这个，不是"扫到几轮"的中间态）。
 * 台账按 id 去重，重复调用是幂等的 —— 收件箱每处理一条 push 都会调一次，不能每次
 * 都当成第一次。
 */
export const scanAndRecordDeferred = async (
  char: CharacterProfile,
  messages: Pick<Message, 'role' | 'timestamp' | 'metadata'>[],
  nowMs: number = Date.now(),
): Promise<number> => {
  // 这里不自己读 ActiveMsgStore —— 那是会碰 IDB 的，调用方（useChatAI 组请求时）
  // 已经有 store 了，让它把 store 传进来，避免同一次组装里两次开事务。
  const { ActiveMsgStore } = await import('./activeMsgStore');
  const config = char.activeMsg2Config;
  if (!config?.enabled) return 0;
  const tasks = config.tasks ?? [];
  if (!tasks.length) return 0;

  const candidates = scanDeferredCandidates(tasks, messages, nowMs)
    // 已经送达过的不是"没说出来"，别再让角色带一遍。
    .filter((c) => !hasDeliveredProactiveNear(messages as any, c.occurrenceMs, c.task.clientTaskId));

  if (!candidates.length) return 0;

  const before = new Set((await ActiveMsgStore.getExpiredNotices(char.id)).map((r) => r.id));
  const fresh = candidates.filter((c) => !before.has(c.id));
  if (!fresh.length) return 0;

  await ActiveMsgStore.upsertExpiredNotices(char.id, fresh.map((c) => ({
    id: c.id,
    charId: char.id,
    occurrenceMs: c.occurrenceMs,
    mode: c.task.mode,
    promptHint: c.task.promptHint,
    recurrenceType: c.task.recurrenceType,
    // 「到点推迟」是这套新判据的专属类型，注入给角色的是"这轮顺口带出来"那段。
    kind: 'deferred' as const,
    createdAt: nowMs,
  })));
  return fresh.length;
};

/**
 * 这次到点，客户端本地判「本来该推送」吗 —— 面板上「为什么没响」要显示真实原因时用。
 *
 * 新规则下"该推送"的含义很窄：到点那一刻用户没在说话、且这次没被推迟。
 * 跟 shouldDeferOccurrence 严格互为反面（它判让开，这里判该发），所以两处判据
 * 必须同步改 —— 改一处不改另一处，用户会看到"该推送"却什么都没来的自相矛盾。
 */
export const shouldHavePushed = (input: {
  occurrenceMs: number;
  nowMs: number;
  messages: Pick<Message, 'role' | 'timestamp' | 'metadata'>[];
}): boolean =>
  input.occurrenceMs <= input.nowMs
  && !shouldDeferOccurrence({
    occurrenceMs: input.occurrenceMs,
    nowMs: input.nowMs,
    messages: input.messages,
    lookbackMs: Number.MAX_SAFE_INTEGER,
  });

/** 面板上「这次没响」的一行。 */
export interface MissedOccurrence {
  task: ActiveMsg2TaskRecord;
  occurrenceMs: number;
  /**
   * 本地按新规矩判「该推送」——到点前 10 分钟用户没在说话。
   *
   * 这一栏是这张表存在的意义：**没响有两种，得分开说**。false = 用户当时正在跟
   * 这个角色聊天，按新规矩本来就该让开，"没响"是规矩内的结果；true = 这次压根
   * 不该被让开却还是没响，那才是要查的问题（连不上云端 / 次数到顶 / 云端自己丢了）。
   * 不分这一栏的话，面板会把"用户当时在聊天"和"功能坏了"写成同一句话。
   */
  shouldPush: boolean;
}

/**
 * 面板「为什么没响」的数据源：回看期内哪些触发到点了、宽限期过了、却什么都没收到。
 *
 * 跟 scanDeferredCandidates 的分工：
 *   - 那条扫的是「该让开、也确实让开了、但得让角色知道」（强制发送的推迟回执）
 *   - 这条扫的是「到点了、什么都没来」——不管该让开还是不该让开，面板都要有个说法
 *
 * 送达判定复用 hasDeliveredProactiveNear（按 clientTaskId 精确归属），跟回执那条
 * 是同一把尺：两处对"送达了"的看法分家的话，面板会说"没响"而角色那边其实已经说了。
 */
export const scanMissedOccurrences = (input: {
  tasks: ActiveMsg2TaskRecord[];
  messages: Pick<Message, 'role' | 'timestamp' | 'metadata'>[];
  nowMs?: number;
  lookbackMs?: number;
  graceMs?: number;
}): MissedOccurrence[] => {
  const nowMs = input.nowMs ?? Date.now();
  const lookbackMs = input.lookbackMs ?? DEFAULT_SCAN_LOOKBACK_MS;
  const graceMs = input.graceMs ?? DEFAULT_MISSED_GRACE_MS;
  const out: MissedOccurrence[] = [];

  for (const task of input.tasks) {
    // 状态只有 scheduled / cancelled 两种（见 ActiveMsg2TaskStatus）。已取消的本来
    // 就不该再响，扫它只会报一堆假警。
    if (task.status !== 'scheduled') continue;
    const first = new Date(task.firstSendTime).getTime();
    if (!Number.isFinite(first)) continue;

    const consider = (occurrenceMs: number) => {
      if (occurrenceMs > nowMs - graceMs) return;
      if (occurrenceMs < nowMs - lookbackMs) return;
      if (hasDeliveredProactiveNear(input.messages as any, occurrenceMs, task.clientTaskId)) return;
      out.push({
        task,
        occurrenceMs,
        shouldPush: shouldHavePushed({ occurrenceMs, nowMs, messages: input.messages }),
      });
    };

    const periodMs = recurrencePeriodMs(task.recurrenceType);
    if (periodMs === null) {
      if (first > nowMs) continue;
      consider(first);
      continue;
    }
    // 快进到回看期起点，别从几个月前逐个迭代。
    let t = first;
    if (t < nowMs - lookbackMs) {
      t = first + Math.ceil((nowMs - lookbackMs - first) / periodMs) * periodMs;
    }
    for (; t <= nowMs; t += periodMs) consider(t);
  }

  // 面板上要按时间倒序排——用户关心的是"最近那次为什么没响"，不是三个月前的。
  out.sort((a, b) => b.occurrenceMs - a.occurrenceMs);
  return out;
};

/**
 * 把云端那条 last_skip 对到某次「没响」上。对不上返回 null。
 *
 * **宁可返回 null 也不能乱对**：last_skip 只留最近一条，拿它去解释一次不相关的
 * 没响，等于凭空编一个原因给用户看——那比"云端没记原因"糟糕得多（用户会照着
 * 假原因去排查）。所以只认两种对得上的方式：uuid 精确相等，或云端拿不到 uuid
 * 时按时刻就近（cron 可能比到点晚几分钟，窗口给 10 分钟，跟 ACTIVE_CHAT_WINDOW_MS
 * 同一个量级）。
 */
export const matchSkipToMissed = (
  skip: AmsgLastSkip | null | undefined,
  missed: Pick<MissedOccurrence, 'task' | 'occurrenceMs'>,
): AmsgLastSkip | null => {
  if (!skip) return null;
  if (skip.taskUuid) return skip.taskUuid === missed.task.taskUuid ? skip : null;
  return Math.abs(skip.occurrenceMs - missed.occurrenceMs) <= ACTIVE_CHAT_WINDOW_MS ? skip : null;
};

/**
 * 面板上那一行「为什么没响」。
 *
 * 三档，从确定到不确定往下排：
 *   1. 云端写下了原因 → 照它的话实说，一字不改（云端比客户端更清楚它自己经历了什么）
 *   2. 本地判"本来就该让开" → 说清楚这是规矩内的结果，不是故障
 *   3. 其余 → 明说"云端没记原因"，并把最可能的几种摆出来
 *
 * 第 3 档宁可显得无能也不能猜一个原因：用户是照着这句话去排查的，猜出来的原因
 * 会把他引到完全不相干的地方去，比"我不知道"费时间得多。
 */
export const describeMissedOccurrence = (
  missed: MissedOccurrence,
  skip: AmsgLastSkip | null,
): string => {
  if (skip) return describeLastSkip(skip, (ms) => formatTaskTime(ms));
  const when = formatTaskTime(missed.occurrenceMs);
  if (!missed.shouldPush) {
    return `${when} 那次没响——到点前十分钟你正跟 ta 聊天，按规矩这次让开了。`;
  }
  return `${when} 那次没响——按规矩这次该响的，但云端没留下原因`
    + '（多半是没连上云端、任务没传上去，或者云端自己丢了一次）。';
};
