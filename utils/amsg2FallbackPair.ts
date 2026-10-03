/**
 * amsg2FallbackPair —— 兜底跟主任务的配对生命周期（麦麦 2026-09-30，step 5）。
 *
 * ## 背景
 *
 * 「强制发送」任务会配一条 +30 分钟的兜底（见 ActiveMsgClient.scheduleFallbackTask）。
 * 兜底的定义就是「主任务这次没说出来时补一句」，所以：
 *
 *   - **主任务真说出来了** → 兜底多余。不取消的话 30 分钟后角色会把同一件事再说一遍。
 *   - **主任务被顺口带出来了**（角色在下一轮上下文里提了） → 同样多余，同上。
 *   - **主任务是循环的** → 这次取消掉，下次触发还要有后路，得按下一个周期重建。
 *
 * ## 为什么单独一个模块
 *
 * 「取消 + 按下个周期重建」这套动作有三个触发点（推送送达 / 回执被消费 / 循环推进），
 * 而重建要重新走一遍建任务的全套（凭据、角色包、配额、云端那一次往返）。抄三遍的意思
 * 是以后改配对逻辑要改三个地方，漏一个就出现「每天早安说完话，30 分钟后又说一遍」。
 * 所以判定（该不该取消）和执行（怎么取消重建）都收在这里，三个触发点只管调。
 */

import { ActiveMsg2TaskRecord, CharacterProfile } from '../types';
import type { AmsgLastSkip } from './amsgFirePack';
import { recurrencePeriodMs } from './amsg2ExpireGuard';
import { buildFallbackText, currentOccurrenceMs, isFallbackTask, isDeferToNextTurn } from './amsg2Tasks';

/** 循环任务推迟了 n 个周期后，下一次的兜底该排在哪。 */
export const nextFallbackOccurrenceMs = (params: {
  /** 刚被消费/带出的那一次的绝对时刻。 */
  occurrenceMs: number;
  /** 主任务的循环方式。 */
  recurrenceType: ActiveMsg2TaskRecord['recurrenceType'];
  /** 主任务的首次触发时刻（循环口径要拿它做快进）。 */
  firstSendTime: string;
  /** 循环延迟（毫秒），取 AMSG_FALLBACK_DELAY_MS。 */
  delayMs: number;
  nowMs: number;
}): number | null => {
  const periodMs = recurrencePeriodMs(params.recurrenceType);
  // 一次性任务：没有下一次。这一次说出来了，兜底就到此为止。
  if (periodMs === null) return null;

  const first = new Date(params.firstSendTime).getTime();
  if (!Number.isFinite(first)) return null;

  // 刚处理完的那一次之后，循环的下一次在哪。不靠"当前时刻"推算——用户可能离线了
  // 几天才回来，靠 nowMs 会算出一个早就过点的时刻，建出来的兜底立刻就得再判一次。
  const consumedIndex = Math.round((params.occurrenceMs - first) / periodMs);
  const nextOccurrence = first + (Math.max(0, consumedIndex) + 1) * periodMs;
  const nextFallback = nextOccurrence + params.delayMs;
  // 算出来已经过点（离线太久，下一次早就到了）就不建：让它在云端一落地就触发一次，
  // 补的是几小时前那条早安，不如不发。
  return nextFallback > params.nowMs ? nextFallback : null;
};

/** 找出配着某条主任务的兜底（可能没有）。 */
export const findFallbackFor = (
  tasks: ActiveMsg2TaskRecord[],
  mainClientTaskId: string,
): ActiveMsg2TaskRecord | null =>
  tasks.find((t) => isFallbackTask(t) && t.fallbackFor === mainClientTaskId) ?? null;

/** 兜底该重建吗 —— 循环任务才需要，一次性的到此为止。 */
export const shouldRebuildFallback = (params: {
  mainTask: ActiveMsg2TaskRecord;
  /** 刚被消费/带出的那一次。 */
  occurrenceMs: number;
  delayMs: number;
  nowMs: number;
}): boolean =>
  nextFallbackOccurrenceMs({
    occurrenceMs: params.occurrenceMs,
    recurrenceType: params.mainTask.recurrenceType,
    firstSendTime: params.mainTask.firstSendTime,
    delayMs: params.delayMs,
    nowMs: params.nowMs,
  }) != null;

export interface FallbackPairDeps {
  char: CharacterProfile;
  /** 建兜底要用的那套运行时上下文（建任务里要读角色级 API 等）。 */
  schedule: (input: {
    mainTask: ActiveMsg2TaskRecord;
    nextOccurrenceMs: number;
  }) => Promise<ActiveMsg2TaskRecord | null>;
  /** 取消一条远端任务。远端已经不在时也算成功。 */
  cancelRemote: (taskUuid: string) => Promise<void>;
  /** 回写本地清单（整份覆盖，调用方保证 prev 是最新的）。 */
  persist: (mutate: (tasks: ActiveMsg2TaskRecord[]) => ActiveMsg2TaskRecord[]) => Promise<void>;
  /** 记一条诊断。字段类型跟 amsgDiag 的 extra 对齐（只收原始值，不收对象）。 */
  diag?: (extra: Record<string, string | number | boolean | null>) => void;
}

export interface FallbackPairResult {
  /** 取消掉了几条兜底。 */
  cancelled: number;
  /** 重建了几条。 */
  rebuilt: number;
}

/**
 * 主任务这次「已经说出来了」——取消它的兜底；主任务是循环的，按下个周期重建一条。
 *
 * 三个触发点（推送送达 / 回执被消费 / 循环推进）都调这一个函数。幂等：兜底不在就
 * 当无事发生，所以推送和回执先后都到（回执注入的那一轮里角色可能顺口带出，
 * 下一轮推送又补收）也不会重复取消或重复重建。
 */
export const retireFallbackForOccurrence = async (
  deps: FallbackPairDeps,
  input: {
    mainTask: ActiveMsg2TaskRecord;
    occurrenceMs: number;
    delayMs: number;
    nowMs?: number;
  },
): Promise<FallbackPairResult> => {
  const nowMs = input.nowMs ?? Date.now();
  const tasks = deps.char.activeMsg2Config?.tasks ?? [];
  const fallback = findFallbackFor(tasks, input.mainTask.clientTaskId);
  if (!fallback) return { cancelled: 0, rebuilt: 0 };

  // 远端取消：失败也不该把本地记录留着——留着会让面板显示一条"还挂着"的兜底，
  // 而它其实可能已经被上一轮取消过了。先记下来，重建成功后再一起写回。
  let cancelFailed = false;
  try {
    await deps.cancelRemote(fallback.taskUuid);
  } catch (e) {
    cancelFailed = true;
    deps.diag?.({ stage: 'fallback-cancelled', ok: false, error: String(e), taskUuid: fallback.taskUuid });
  }
  if (!cancelFailed) {
    deps.diag?.({
      stage: 'fallback-cancelled', ok: true, taskUuid: fallback.taskUuid,
      forClientTaskId: input.mainTask.clientTaskId, occurrenceMs: input.occurrenceMs,
    });
  }

  // 循环任务：这次说出来了，下次还得有后路。
  let next: ActiveMsg2TaskRecord | null = null;
  const nextOccurrenceMs = nextFallbackOccurrenceMs({
    occurrenceMs: input.occurrenceMs,
    recurrenceType: input.mainTask.recurrenceType,
    firstSendTime: input.mainTask.firstSendTime,
    delayMs: input.delayMs,
    nowMs,
  });
  if (nextOccurrenceMs != null) {
    next = await deps.schedule({ mainTask: input.mainTask, nextOccurrenceMs });
    if (next) {
      deps.diag?.({
        stage: 'fallback-rebuilt', ok: true,
        forClientTaskId: input.mainTask.clientTaskId, nextOccurrenceMs,
        newUuid: next.taskUuid,
      });
    } else {
      deps.diag?.({
        stage: 'fallback-rebuilt', ok: false,
        forClientTaskId: input.mainTask.clientTaskId, nextOccurrenceMs,
        error: '重建兜底失败：这条循环任务下次到点时没有后路（退回旧行为）',
      });
    }
  }

  // 一次写回：取消失败的旧记录留着（面板要能看到它还能重试），重建成功的新记录并进去。
  await deps.persist((list) => {
    const withoutOld = list.filter((t) => t.taskUuid !== fallback.taskUuid || cancelFailed);
    return next ? [...withoutOld, next] : withoutOld;
  });

  return { cancelled: cancelFailed ? 0 : 1, rebuilt: next ? 1 : 0 };
};

/**
 * 这次到点该拿哪一次的时刻来处理。
 *
 * ⚠ 刻意**不用** currentOccurrenceMs：它返回的是**下一次**（还没到的那次，面板用它
 * 显示"下一次几点"）。这里要的是**刚说过的那一次**——推送送达时"这一次"已经发生，
 * 拿下一次会让每一轮都在销一条还没用过的兜底，同时把真正该销的那条留着。
 *
 * 判据：最大的那个 k，使 first + k*period 不晚于 now。取不到（还没到过第一次）
 * 返回 null，调用方自己决定退路。
 */
export const resolveOccurrenceForPairing = (
  task: ActiveMsg2TaskRecord,
  nowMs: number,
): number | null => {
  const first = new Date(task.firstSendTime).getTime();
  if (!Number.isFinite(first)) return null;
  if (first > nowMs) return null;   // 还没到过第一次：没有"刚说过的那次"

  const periodMs = recurrencePeriodMs(task.recurrenceType);
  if (periodMs === null) return first;

  // 直接算不要逐个迭代——循环任务可能已经跑了几个月。
  const k = Math.floor((nowMs - first) / periodMs);
  return first + Math.max(0, k) * periodMs;
};

// ─── 对账：开关保存 / 开面板时把兜底拉回该有的样子 ───

/** 取消一条兜底的原因。写出来而不是一个 true/false：面板和诊断日志都要照它说话。 */
export type FallbackCancelReason =
  /** 主任务已经不在清单里了（用户手动取消了、或被别处删了）——这条兜底是孤儿。 */
  | 'orphan'
  /** 云端那道「连续几声没回」的闸把主任务停了，主任务不会再开口，兜底也就没有意义。 */
  | 'main-stopped';

export interface FallbackReconcilePlan {
  cancel: { task: ActiveMsg2TaskRecord; reason: FallbackCancelReason }[];
  /** 该补建的兜底：主任务 + 兜底该落的时刻。 */
  build: { mainTask: ActiveMsg2TaskRecord; fireAtMs: number }[];
}

/**
 * 云端 last_skip 说主任务被「连续几声没回」停掉了的话，找出它的 clientTaskId。
 *
 * 为什么认得出：云端那道闸是 `countRecurringSends(selfLog, clientTaskId) >=
 * recurringStopAfter`——按**主任务自己的 clientTaskId** 数（见 worker onBeforeFire）。
 * 兜底是另一条任务、另一个 id，数不进去，所以主任务停了兜底照响。这就是"3 次没回
 * 之后角色不响了，30 分钟那条后路却还来一句"的来源。
 *
 * last_skip 只留最近一条，所以这里最多认出最近停掉的那一个；更早的那些兜底会在云端
 * 记成 stale/schedule-off，下一次对账自然清掉。
 *
 * 停掉的是哪条任务只能靠 uuid 反查（last_skip 记的是云端 uuid，不是 clientTaskId）。
 * 对不上就返回 null：宁可漏一次对账，也不能把还在正常响的主任务误判成停掉的。
 */
const resolveStoppedMainClientTaskId = (
  tasks: ActiveMsg2TaskRecord[],
  lastSkip: AmsgLastSkip | null | undefined,
): string | null => {
  if (lastSkip?.reason !== 'recurring-unanswered') return null;
  if (!lastSkip.taskUuid) return null;
  const hit = tasks.find((t) => t.taskUuid === lastSkip.taskUuid);
  // 反查到的还得是主任务本身，不能是别的任务的兜底。
  return hit && !isFallbackTask(hit) ? hit.clientTaskId : null;
};

/**
 * 兜底对账：算出「该取消哪些、该补建哪些」。纯函数，不碰网络也不碰存储。
 *
 * ## 为什么需要它
 *
 * 兜底的生命周期原本只挂在"主任务说出来了"那一条路上（retireFallbackForOccurrence），
 * 下面两种断链没人管：
 *
 *   - **用户手动取消了主任务** → 兜底是独立的一条云端任务，还在，到点照响。用户以为
 *     全取消了，实际半小时后角色又冒出来一句。
 *   - **主任务被云端那道「连续几声没回」停了** → 同上，而且更隐蔽：用户根本没取消过。
 *
 * 补建那半边解决的是另一种断链：建兜底失败时（scheduleFallbackTask 自己吞掉只记诊断）
 * 主任务从此没有后路，而没有任何东西会再试一次。
 *
 * ## 为什么不算"已过点"就取消
 *
 * 兜底跟主任务同循环（每天早安 → 每天 8 点半那条后路），**一条记录代表所有周期**。
 * 拿 firstSendTime 判"这次已经过去"会把一个好好的每日兜底误当成废的删掉——那正是
 * step 5 刚修好的"循环要按下个周期重建"。过期的那些由 retireFallbackForOccurrence
 * 取消+重建负责，不在这里动。
 */
export const planFallbackReconcile = (params: {
  tasks: ActiveMsg2TaskRecord[];
  nowMs: number;
  delayMs: number;
  lastSkip?: AmsgLastSkip | null;
}): FallbackReconcilePlan => {
  const { tasks, nowMs, delayMs } = params;
  const cancel: { task: ActiveMsg2TaskRecord; reason: FallbackCancelReason }[] = [];
  const build: { mainTask: ActiveMsg2TaskRecord; fireAtMs: number }[] = [];
  const stoppedClientTaskId = resolveStoppedMainClientTaskId(tasks, params.lastSkip);

  const liveFallbacks = new Set<string>();
  for (const task of tasks) {
    if (!isFallbackTask(task) || task.status !== 'scheduled') continue;
    const main = tasks.find((m) => m.clientTaskId === task.fallbackFor);
    if (!main || main.status !== 'scheduled') {
      cancel.push({ task, reason: 'orphan' });
    } else if (stoppedClientTaskId && main.clientTaskId === stoppedClientTaskId) {
      cancel.push({ task, reason: 'main-stopped' });
    } else {
      liveFallbacks.add(main.clientTaskId);
    }
  }

  for (const main of tasks) {
    // 兜底自己没有兜底；已取消的也不管。
    if (isFallbackTask(main) || main.status !== 'scheduled') continue;
    // 只有「强制发送」才配兜底：遇忙作废的那次是直接取消，本来就不会有人来说这句。
    if (!isDeferToNextTurn(main.mode, main.expirePolicy)) continue;
    if (liveFallbacks.has(main.clientTaskId)) continue;
    // 主任务被云端停了的不补——等用户回一句话它自己就复活了，那时候下一次对账会补上。
    if (stoppedClientTaskId && main.clientTaskId === stoppedClientTaskId) continue;
    // 固定模式没写原文就建不出兜底（buildFallbackText 返回空），别在这儿造一条空壳。
    if (!buildFallbackText(main.mode, main.promptHint, main.userMessage)) continue;

    const nextOccurrenceMs = currentOccurrenceMs(main, nowMs);
    if (nextOccurrenceMs == null) continue;
    const fireAtMs = nextOccurrenceMs + delayMs;
    // 下一次已经过去太久：补出来落地就是白发一条（scheduleFallbackTask 也会拒），
    // 等下一个周期再说。
    if (fireAtMs <= nowMs) continue;
    build.push({ mainTask: main, fireAtMs });
  }

  return { cancel, build };
};

export interface FallbackReconcileResult extends FallbackPairResult {
  /** 取消失败、留在本地清单里待重试的那些。 */
  failed: ActiveMsg2TaskRecord[];
  /** 建不出来的兜底（主任务 + 原因）。 */
  buildFailed: { mainTask: ActiveMsg2TaskRecord; error: string }[];
}

/**
 * 跑一遍对账：先取消、再补建，最后一次写回本地清单。
 *
 * 顺序是有讲究的：**先取消再补建**。反过来会出现"主任务的兜底刚被建好，紧接着又被
 * 上一轮的取消扫掉"——两条路都要动云端，代价是一次白跑的往返。
 *
 * 幂等：计划为空时一次网络请求都不发（面板开着的每一轮都会调它，不设这道闸就是白烧）。
 */
export const runFallbackReconcile = async (
  input: FallbackPairDeps & {
    /** 兜底比主任务晚多少（毫秒），取 AMSG_FALLBACK_DELAY_MS。 */
    delayMs: number;
    nowMs?: number;
    /** 云端最近一次跳过记录，用来认出「主任务被连续几声没回停了」。 */
    lastSkip?: AmsgLastSkip | null;
  },
): Promise<FallbackReconcileResult> => {
  const nowMs = input.nowMs ?? Date.now();
  const tasks = input.char.activeMsg2Config?.tasks ?? [];
  const plan = planFallbackReconcile({ tasks, nowMs, delayMs: input.delayMs, lastSkip: input.lastSkip });
  const result: FallbackReconcileResult = {
    cancelled: 0, rebuilt: 0, failed: [], buildFailed: [],
  };
  // 计划为空时一次网络请求都不发：面板开着的每一轮都会调它，不设这道闸就是白烧流量。
  if (!plan.cancel.length && !plan.build.length) return result;

  // 取消失败的留在本地清单里（面板显示还能重试）。远端那条还在响，绝不能当成功处理。
  const keepLocal = new Set<string>();
  for (const item of plan.cancel) {
    try {
      await input.cancelRemote(item.task.taskUuid);
      result.cancelled += 1;
      input.diag?.({ stage: 'fallback-reconcile-cancel', ok: true, taskUuid: item.task.taskUuid, reason: item.reason });
    } catch (e) {
      keepLocal.add(item.task.taskUuid);
      result.failed.push(item.task);
      input.diag?.({ stage: 'fallback-reconcile-cancel', ok: false, taskUuid: item.task.taskUuid, reason: item.reason, error: String(e) });
    }
  }

  const built: ActiveMsg2TaskRecord[] = [];
  for (const item of plan.build) {
    try {
      const record = await input.schedule({
        mainTask: item.mainTask,
        // schedule 那层的入参要的是「主任务这次几点触发」，兜底时刻自己会加那 30 分钟。
        nextOccurrenceMs: item.fireAtMs - input.delayMs,
      });
      if (record) {
        built.push(record);
        result.rebuilt += 1;
        input.diag?.({ stage: 'fallback-reconcile-build', ok: true, forClientTaskId: item.mainTask.clientTaskId, newUuid: record.taskUuid });
      } else {
        result.buildFailed.push({ mainTask: item.mainTask, error: '建兜底返回空' });
        input.diag?.({ stage: 'fallback-reconcile-build', ok: false, forClientTaskId: item.mainTask.clientTaskId, error: '建兜底返回空' });
      }
    } catch (e) {
      result.buildFailed.push({ mainTask: item.mainTask, error: String(e) });
      input.diag?.({ stage: 'fallback-reconcile-build', ok: false, forClientTaskId: item.mainTask.clientTaskId, error: String(e) });
    }
  }

  // 一次写回：取消掉的出清单（失败的那些除外，它们还在响、还得留着让人重试），
  // 建出来的并进去。
  // ⚠ removed 只收**确认取消成功**的：把失败的也收进去的话，本地清单会以为那条
  // 兜底没了，而它其实还在云端到点照响——正是这个对账要消灭的那类幽灵任务。
  const removed = new Set(
    plan.cancel.filter((c) => !keepLocal.has(c.task.taskUuid)).map((c) => c.task.taskUuid),
  );
  await input.persist((list) => [
    ...list.filter((t) => !removed.has(t.taskUuid)),
    ...built,
  ]);

  return result;
};;
