// utils/amsg2FallbackPair.test.ts
/**
 * 兜底配对生命周期测试（麦麦 2026-09-30 step 5）。
 *
 * 这一层出错的后果是**每天早安说完话，30 分钟后角色又说一遍**。所以最要紧的两条：
 *   1. 主任务真说出来了 → 兜底必须被取消（不取消 = 重复）
 *   2. 循环任务取消后 → 下个周期必须有新兜底（不重建 = 明天起没有后路）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  findFallbackFor,
  nextFallbackOccurrenceMs,
  planFallbackReconcile,
  resolveOccurrenceForPairing,
  retireFallbackForOccurrence,
  runFallbackReconcile,
  shouldRebuildFallback,
  type FallbackPairDeps,
} from './amsg2FallbackPair';
import type { AmsgLastSkip } from './amsgFirePack';
import type { ActiveMsg2TaskRecord, CharacterProfile } from '../types';

const H = 3600_000;
const MIN = 60_000;
const T0 = Date.parse('2026-10-01T08:00:00Z');
const DELAY = 30 * MIN;

const mainTask = (extra: Partial<ActiveMsg2TaskRecord> = {}): ActiveMsg2TaskRecord => ({
  taskUuid: 'main-uuid',
  clientTaskId: 'main-cid',
  mode: 'auto',
  firstSendTime: new Date(T0).toISOString(),
  recurrenceType: 'daily',
  expirePolicy: 'force',
  source: 'user',
  status: 'scheduled',
  createdAt: T0 - H,
  ...extra,
});

const fallbackTask = (extra: Partial<ActiveMsg2TaskRecord> = {}): ActiveMsg2TaskRecord => ({
  taskUuid: 'fb-uuid',
  clientTaskId: 'fb-cid',
  mode: 'fixed',
  firstSendTime: new Date(T0 + DELAY).toISOString(),
  recurrenceType: 'daily',
  userMessage: '到点啦：该吃药了',
  expirePolicy: 'force',
  source: 'user',
  status: 'scheduled',
  createdAt: T0,
  fallbackFor: 'main-cid',
  ...extra,
});

const charWith = (tasks: ActiveMsg2TaskRecord[]): CharacterProfile =>
  ({ id: 'c1', name: 'x', activeMsg2Config: { enabled: true, tasks } } as unknown as CharacterProfile);

const makeDeps = (tasks: ActiveMsg2TaskRecord[]): FallbackPairDeps & { saved: () => ActiveMsg2TaskRecord[] } => {
  let current = [...tasks];
  const deps = {
    char: charWith(current),
    schedule: vi.fn(async ({ nextOccurrenceMs }) => ({
      ...fallbackTask({ taskUuid: 'fb-new', clientTaskId: 'fb-new-cid', firstSendTime: new Date(nextOccurrenceMs).toISOString() }),
    })),
    cancelRemote: vi.fn(async () => {}),
    persist: vi.fn(async (mutate: (t: ActiveMsg2TaskRecord[]) => ActiveMsg2TaskRecord[]) => {
      current = mutate(current);
      deps.char = charWith(current);
    }),
    diag: vi.fn(),
    saved: () => current,
  };
  return deps as FallbackPairDeps & { saved: () => ActiveMsg2TaskRecord[] };
};

describe('nextFallbackOccurrenceMs（循环兜底算下个周期）', () => {
  it('循环：刚说完这一次 → 兜底排到下一次的 +30 分钟', () => {
    const next = nextFallbackOccurrenceMs({
      occurrenceMs: T0, recurrenceType: 'daily', firstSendTime: new Date(T0).toISOString(),
      delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(next).toBe(T0 + 24 * H + DELAY);
  });

  // 一次性：说完就没有下次了。再排一条 = 用户已经收到却还要再收一次。
  it('一次性：没有下一次，不重建', () => {
    expect(nextFallbackOccurrenceMs({
      occurrenceMs: T0, recurrenceType: 'none', firstSendTime: new Date(T0).toISOString(),
      delayMs: DELAY, nowMs: T0 + 10 * MIN,
    })).toBeNull();
  });

  // 离线几天才回来：靠"当前时刻"推算会算出一个早就过点的时刻，建出来的兜底一落地
  // 就触发，补的是几小时前那条早安。不如不发。
  it('离线太久 → 下一次的兜底已经过点，不建', () => {
    expect(nextFallbackOccurrenceMs({
      occurrenceMs: T0, recurrenceType: 'daily', firstSendTime: new Date(T0).toISOString(),
      delayMs: DELAY, nowMs: T0 + 30 * H,
    })).toBeNull();
  });

  it('第一次触发：算的是第一个周期，不是负数周期', () => {
    const next = nextFallbackOccurrenceMs({
      occurrenceMs: T0, recurrenceType: 'weekly', firstSendTime: new Date(T0).toISOString(),
      delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(next).toBe(T0 + 7 * 24 * H + DELAY);
  });
});

describe('shouldRebuildFallback', () => {
  it('循环 + 有下一次 → 要重建', () => {
    expect(shouldRebuildFallback({
      mainTask: mainTask(), occurrenceMs: T0, delayMs: DELAY, nowMs: T0 + 10 * MIN,
    })).toBe(true);
  });

  it('一次性 → 不重建', () => {
    expect(shouldRebuildFallback({
      mainTask: mainTask({ recurrenceType: 'none' }), occurrenceMs: T0,
      delayMs: DELAY, nowMs: T0 + 10 * MIN,
    })).toBe(false);
  });
});

describe('findFallbackFor', () => {
  it('按主任务 clientTaskId 找得到', () => {
    const fb = fallbackTask();
    expect(findFallbackFor([mainTask(), fb], 'main-cid')?.taskUuid).toBe('fb-uuid');
  });

  it('没有配对 → null', () => {
    expect(findFallbackFor([mainTask()], 'main-cid')).toBeNull();
  });

  // 认的是 fallbackFor 指向谁：兜底自己的 fallbackFor 指向主任务，所以按主任务
  // 的 id 去查，主任务自己永远不会被当成兜底销掉。
  it('不会把主任务自己当兜底（它的 fallbackFor 空着）', () => {
    expect(findFallbackFor([mainTask()], 'main-cid')).toBeNull();
  });
});

describe('retireFallbackForOccurrence（主任务说出来了 → 销兜底）', () => {
  it('循环：取消旧兜底 + 按下个周期重建一条', async () => {
    const deps = makeDeps([mainTask(), fallbackTask()]);
    const r = await retireFallbackForOccurrence(deps, {
      mainTask: mainTask(), occurrenceMs: T0, delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(r).toEqual({ cancelled: 1, rebuilt: 1 });
    expect(deps.cancelRemote).toHaveBeenCalledWith('fb-uuid');
    // 旧的没了、新的在，且新的是"下个周期 + 30 分钟"
    const saved = deps.saved();
    expect(saved.map((t) => t.taskUuid)).toEqual(['main-uuid', 'fb-new']);
    expect(new Date(saved[1].firstSendTime).getTime()).toBe(T0 + 24 * H + DELAY);
  });

  it('一次性：只取消不重建', async () => {
    const deps = makeDeps([mainTask({ recurrenceType: 'none' }), fallbackTask({ recurrenceType: 'none' })]);
    const r = await retireFallbackForOccurrence(deps, {
      mainTask: mainTask({ recurrenceType: 'none' }), occurrenceMs: T0,
      delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(r).toEqual({ cancelled: 1, rebuilt: 0 });
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.saved().map((t) => t.taskUuid)).toEqual(['main-uuid']);
  });

  // 推送和回执先后都到（回执注入那轮角色带出来了，下一轮推送又补收）时会重复调用，
  // 第二次没有兜底可销就当无事发生，不能再重建一条出来。
  it('幂等：兜底已经不在了，什么都不做', async () => {
    const deps = makeDeps([mainTask()]);
    const r = await retireFallbackForOccurrence(deps, {
      mainTask: mainTask(), occurrenceMs: T0, delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(r).toEqual({ cancelled: 0, rebuilt: 0 });
    expect(deps.cancelRemote).not.toHaveBeenCalled();
  });

  // 取消失败时旧记录要留着：面板得看得到它还能重试，不然用户以为已经清干净了，
  // 结果 30 分钟后它照常补一条。
  it('远端取消失败 → 旧记录保留（面板要能重试）', async () => {
    const deps = makeDeps([mainTask(), fallbackTask()]);
    deps.cancelRemote = vi.fn(async () => { throw new Error('network down'); });
    const r = await retireFallbackForOccurrence(deps, {
      mainTask: mainTask(), occurrenceMs: T0, delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(r.cancelled).toBe(0);
    expect(deps.saved().map((t) => t.taskUuid)).toContain('fb-uuid');
  });

  it('重建失败不影响取消结果（旧兜底照样销掉，循环任务退回没后路）', async () => {
    const deps = makeDeps([mainTask(), fallbackTask()]);
    deps.schedule = vi.fn(async () => null);
    const r = await retireFallbackForOccurrence(deps, {
      mainTask: mainTask(), occurrenceMs: T0, delayMs: DELAY, nowMs: T0 + 10 * MIN,
    });
    expect(r).toEqual({ cancelled: 1, rebuilt: 0 });
    expect(deps.saved().map((t) => t.taskUuid)).toEqual(['main-uuid']);
  });
});

describe('resolveOccurrenceForPairing（拿哪一次）', () => {
  // 拿首次当 occurrence 会让循环任务每天都在销"第一天的"兜底，真正的后路留着不管，
  // 于是第二天的兜底永远取消不掉，到点时角色把早安说两遍。
  it('循环任务取「当前这一次」，不是首次', () => {
    const t = mainTask();
    // 2026-10-03 08:05（第三次触发刚过）
    const now = T0 + 2 * 24 * H + 5 * MIN;
    expect(resolveOccurrenceForPairing(t, now)).toBe(T0 + 2 * 24 * H);
  });

  it('一次性任务就是它自己那一次', () => {
    const t = mainTask({ recurrenceType: 'none' });
    expect(resolveOccurrenceForPairing(t, T0 + 10 * MIN)).toBe(T0);
  });
});

// ─── 对账（step 7）───
const skipOf = (extra: Record<string, unknown> = {}) => ({
  v: 1 as const,
  taskUuid: 'main-uuid',
  occurrenceMs: T0,
  reason: 'recurring-unanswered' as const,
  skippedAt: T0,
  ...extra,
}) as AmsgLastSkip;

const planAt = (
  tasks: ActiveMsg2TaskRecord[],
  nowMs: number,
  lastSkip?: AmsgLastSkip | null,
) => planFallbackReconcile({ tasks, nowMs, delayMs: DELAY, lastSkip });

describe('planFallbackReconcile — 该取消的', () => {
  // 这条最要紧：对账是每次开面板都会跑的，一旦误伤就把好好的后路删了。
  it('主任务在、兜底也在 → 什么都不动', () => {
    const plan = planAt([mainTask(), fallbackTask()], T0 + 10 * MIN);
    expect(plan.cancel).toEqual([]);
    expect(plan.build).toEqual([]);
  });

  // 用户手动取消主任务后，兜底是独立的一条云端任务，还在，到点照响。
  it('主任务被手动取消了 → 取消那条孤儿兜底', () => {
    const plan = planAt([fallbackTask()], T0 + 10 * MIN);
    expect(plan.cancel).toHaveLength(1);
    expect(plan.cancel[0].reason).toBe('orphan');
  });

  it('主任务被标记取消 → 同样当孤儿清掉', () => {
    const plan = planAt([mainTask({ status: 'cancelled' }), fallbackTask()], T0 + 10 * MIN);
    expect(plan.cancel.map((c) => c.reason)).toEqual(['orphan']);
  });

  it('主任务被「连续几声没回」停掉 → 取消它的兜底', () => {
    const plan = planAt([mainTask(), fallbackTask()], T0 + 10 * MIN, skipOf());
    expect(plan.cancel).toHaveLength(1);
    expect(plan.cancel[0].reason).toBe('main-stopped');
  });

  // 云端可写的跳过原因还有九种，只有这一种会让主任务永久停摆；其余的照删会误伤。
  it('last_skip 是别的原因 → 不动', () => {
    for (const reason of ['daily-limit', 'min-gap', 'stale', 'schedule-off'] as const) {
      const plan = planAt([mainTask(), fallbackTask()], T0 + 10 * MIN, skipOf({ reason }));
      expect(plan.cancel).toEqual([]);
    }
  });

  // 停掉的是哪条任务只能靠 uuid 反查，对不上就宁可漏一次对账——把还在正常响的
  // 主任务误判成停掉的，代价比漏一次大得多。
  it('last_skip 的 uuid 对不上任何任务 → 不动', () => {
    const plan = planAt([mainTask(), fallbackTask()], T0 + 10 * MIN, skipOf({ taskUuid: 't-别的' }));
    expect(plan.cancel).toEqual([]);
  });

  it('last_skip 压根没有 → 不动', () => {
    expect(planAt([mainTask(), fallbackTask()], T0 + 10 * MIN, null).cancel).toEqual([]);
  });

  it('兜底自己是「被停掉」的那条 → 不当主任务处理（不连锁取消）', () => {
    const plan = planAt(
      [mainTask(), fallbackTask({ taskUuid: 'fb-uuid2' })],
      T0 + 10 * MIN,
      skipOf({ taskUuid: 'fb-uuid2' }),
    );
    expect(plan.cancel).toEqual([]);
  });
});

describe('planFallbackReconcile — 该补建的', () => {
  it('强制发送的主任务没有兜底 → 补一条，时刻 = 下次触发 + 30 分钟', () => {
    const plan = planAt([mainTask()], T0 + 10 * MIN);
    expect(plan.build).toHaveLength(1);
    // 下一次触发是明天 8:00，兜底落在 8:30。
    expect(plan.build[0].fireAtMs).toBe(T0 + 24 * H + DELAY);
  });

  // 遇忙作废的那次是直接取消，本来就没人来说这句，配后路没意义。
  it('遇忙作废的主任务 → 不补', () => {
    const plan = planAt([mainTask({ expirePolicy: 'expire' })], T0 + 10 * MIN);
    expect(plan.build).toEqual([]);
  });

  it('固定模式但没写原文 → 建不出兜底，不补', () => {
    const plan = planAt([mainTask({ mode: 'fixed', userMessage: '' })], T0 + 10 * MIN);
    expect(plan.build).toEqual([]);
  });

  it('主任务被停掉 → 不补（等用户回话复活后下一次对账会补上）', () => {
    const plan = planAt([mainTask()], T0 + 10 * MIN, skipOf());
    expect(plan.build).toEqual([]);
  });

  // 兜底是跟主任务同循环的，一条记录代表所有周期。拿 firstSendTime 判"这次过去了"
  // 会把好好的每日兜底误删——那正是 step 5 刚修好的"按下个周期重建"。
  it('每日兜底的首次时刻已过 → 仍然保留，不当废的删', () => {
    const plan = planAt([mainTask(), fallbackTask()], T0 + 3 * 24 * H);
    expect(plan.cancel).toEqual([]);
  });

  it('已取消的兜底记录 → 当没有处理，主任务该补还是补', () => {
    const plan = planAt([mainTask(), fallbackTask({ status: 'cancelled' })], T0 + 10 * MIN);
    expect(plan.build).toHaveLength(1);
  });

  it('下一次触发 + 30 分钟已经过去 → 不补（补出来落地就白发）', () => {
    // 一次性任务触发在 35 分钟前，兜底那一刻也早过了。
    const plan = planAt([mainTask({ recurrenceType: 'none' })], T0 + 35 * MIN);
    expect(plan.build).toEqual([]);
  });

  it('一次性任务、兜底那一刻还没到 → 补', () => {
    const plan = planAt([mainTask({ recurrenceType: 'none' })], T0 + 5 * MIN);
    expect(plan.build).toHaveLength(1);
  });

  it('一次性任务、触发还没到 → 补', () => {
    const plan = planAt([mainTask({ recurrenceType: 'none' })], T0 - 10 * MIN);
    expect(plan.build).toHaveLength(1);
    expect(plan.build[0].fireAtMs).toBe(T0 + DELAY);
  });
});

describe('runFallbackReconcile（真的去动云端）', () => {
  it('计划为空 → 一次网络请求都不发', async () => {
    const deps = makeDeps([mainTask(), fallbackTask()]);
    const r = await runFallbackReconcile({ ...deps, delayMs: DELAY, nowMs: T0 + 10 * MIN });
    expect(r).toMatchObject({ cancelled: 0, rebuilt: 0, failed: [], buildFailed: [] });
    expect(deps.cancelRemote).not.toHaveBeenCalled();
    expect(deps.schedule).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('孤儿兜底 → 远端取消 + 本地出清单', async () => {
    const deps = makeDeps([fallbackTask()]);
    const r = await runFallbackReconcile({ ...deps, delayMs: DELAY, nowMs: T0 + 10 * MIN });
    expect(r.cancelled).toBe(1);
    expect(deps.cancelRemote).toHaveBeenCalledWith('fb-uuid');
    expect(deps.saved()).toEqual([]);
  });

  // 取消失败就把记录留着：远端那条还在响，本地清单里得看得见还能重试。
  it('远端取消失败 → 记录留在清单里，不当成功', async () => {
    const deps = makeDeps([fallbackTask()]);
    (deps.cancelRemote as any).mockRejectedValueOnce(new Error('boom'));
    const r = await runFallbackReconcile({ ...deps, delayMs: DELAY, nowMs: T0 + 10 * MIN });
    expect(r.cancelled).toBe(0);
    expect(r.failed).toHaveLength(1);
    expect(deps.saved().map((t) => t.taskUuid)).toEqual(['fb-uuid']);
  });

  it('缺兜底 → 建一条并进清单', async () => {
    const deps = makeDeps([mainTask()]);
    const r = await runFallbackReconcile({ ...deps, delayMs: DELAY, nowMs: T0 + 10 * MIN });
    expect(r.rebuilt).toBe(1);
    expect(deps.saved().map((t) => t.taskUuid).sort()).toEqual(['fb-new', 'main-uuid']);
  });

  it('建兜底失败 → 记进 buildFailed，不写进清单', async () => {
    const deps = makeDeps([mainTask()]);
    (deps.schedule as any).mockResolvedValueOnce(null);
    const r = await runFallbackReconcile({ ...deps, delayMs: DELAY, nowMs: T0 + 10 * MIN });
    expect(r.rebuilt).toBe(0);
    expect(r.buildFailed).toHaveLength(1);
    expect(deps.saved().map((t) => t.taskUuid)).toEqual(['main-uuid']);
  });
});
