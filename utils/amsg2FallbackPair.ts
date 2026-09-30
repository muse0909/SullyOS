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
import { recurrencePeriodMs } from './amsg2ExpireGuard';
import { isFallbackTask } from './amsg2Tasks';

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
  /** 记一条诊断。 */
  diag?: (extra: Record<string, unknown>) => void;
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
