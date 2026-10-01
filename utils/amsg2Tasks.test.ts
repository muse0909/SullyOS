// utils/amsg2Tasks.test.ts
import { describe, it, expect } from 'vitest';
import {
  MAX_ACTIVE_TASKS_PER_CHAR,
  REPLACE_CANCEL_FAILED_NOTE,
  AMSG_FALLBACK_DELAY_MS,
  applyRemoteTaskDelta,
  applyScheduledTask,
  AMSG2_SCHEDULE_SECRECY_NOTE,
  buildFallbackText,
  buildFireTaskListBlock,
  currentOccurrenceMs,
  describeRemoteLastError,
  describeTaskProgress,
  findTaskByShortId,
  getPendingTasks,
  hasActiveAiTask,
  isFallbackTask,
  isForcePolicy,
  isPendingTask,
  isRemoteMissingTask,
  noticeKindForTask,
  keepUncancelledTasks,
  parseRemoteTaskLastError,
  pruneFiredTasks,
  pruneStaleTasks,
  reconcileTasksWithRemote,
  FIXED_AS_PROMPTED_PREFIX,
  resolveCloudExpirePolicy,
  shortTaskId,
  toDatetimeLocalValue,
  visibleTasks,
  isReplaceableCharacterWakeup,
  EXPIRE_POLICY_OPTIONS,
  describeExpirePolicy,
} from './amsg2Tasks';
import type { ActiveMsg2TaskRecord } from '../types';

const H = 3600_000;
const task = (extra: Partial<ActiveMsg2TaskRecord> = {}): ActiveMsg2TaskRecord => ({
  taskUuid: 'aabbccdd-0000-0000-0000-000000000000',
  clientTaskId: 'cid-aabb',
  mode: 'auto', firstSendTime: new Date(Date.now() + H).toISOString(),
  recurrenceType: 'none', expirePolicy: 'expire',
  source: 'character', status: 'scheduled', createdAt: Date.now(),
  ...extra,
});

describe('amsg2Tasks helpers', () => {
  it('shortTaskId 取 uuid 前 8 位；findTaskByShortId 按短 id 找', () => {
    const t = task();
    expect(shortTaskId(t.taskUuid)).toBe('aabbccdd');
    expect(findTaskByShortId([t], 'aabbccdd')).toBe(t);
    expect(findTaskByShortId([t], 'ffffffff')).toBeUndefined();
  });

  it('isPendingTask：未来一次性/循环任务算待触发，过点一次性不算', () => {
    const now = Date.now();
    expect(isPendingTask(task(), now)).toBe(true);
    expect(isPendingTask(task({ firstSendTime: new Date(now - H).toISOString() }), now)).toBe(false);
    expect(isPendingTask(task({ firstSendTime: new Date(now - H).toISOString(), recurrenceType: 'daily' }), now)).toBe(true);
  });

  it('pruneStaleTasks 清掉过点超过 48h 的一次性任务，循环任务保留', () => {
    const now = Date.now();
    const stale = task({ taskUuid: 'stale000-0000-0000-0000-000000000000', firstSendTime: new Date(now - 49 * H).toISOString() });
    const recent = task({ taskUuid: 'recent00-0000-0000-0000-000000000000', firstSendTime: new Date(now - H).toISOString() });
    const daily = task({ taskUuid: 'daily000-0000-0000-0000-000000000000', firstSendTime: new Date(now - 100 * H).toISOString(), recurrenceType: 'daily' });
    expect(pruneStaleTasks([stale, recent, daily], now).map((t) => shortTaskId(t.taskUuid)))
      .toEqual(['recent00', 'daily000']);
  });

  it('封顶常量为 5', () => {
    expect(MAX_ACTIVE_TASKS_PER_CHAR).toBe(5);
  });

  // 同步门（amsgStateSync）依赖 hasActiveAiTask：只要还有「待触发的非 fixed 任务」才同步 fire_pack。
  // 钉住这条，防止后续改动把它悄悄改死——静默分流杀主动消息是踩过的坑。
  it('getPendingTasks 只留待触发任务；hasActiveAiTask 排除 fixed，无待触发 AI 任务时为 false', () => {
    const now = Date.now();
    const ai = task();
    const fixed = task({ taskUuid: 'fixed000-0000-0000-0000-000000000000', mode: 'fixed' });
    const past = task({ taskUuid: 'past0000-0000-0000-0000-000000000000', firstSendTime: new Date(now - H).toISOString() });
    const config = { enabled: true, tasks: [ai, fixed, past] };
    expect(getPendingTasks(config, now).map((t) => shortTaskId(t.taskUuid))).toEqual(['aabbccdd', 'fixed000']);
    expect(hasActiveAiTask(config, now)).toBe(true);
    expect(hasActiveAiTask({ enabled: true, tasks: [fixed, past] }, now)).toBe(false);
    expect(hasActiveAiTask(undefined, now)).toBe(false);
  });
});

// 防坑：角色用工具建的任务 firstSendTime 是完整 ISO 8601，datetime-local 输入框只认
// 'YYYY-MM-DDTHH:mm'——不折算编辑角色任务时时间框会空白。断言全部与本机时区无关。
describe('toDatetimeLocalValue', () => {
  it('已是 datetime-local 格式 → 原样返回（跨时区恒成立）', () => {
    expect(toDatetimeLocalValue('2026-07-21T09:00')).toBe('2026-07-21T09:00');
  });
  it('完整 ISO（带 Z / 秒 / 毫秒）→ 折成 16 位 YYYY-MM-DDTHH:mm（无 Z 无秒）', () => {
    const out = toDatetimeLocalValue('2026-07-21T01:00:00.000Z');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(out).not.toContain('Z');
  });
  it('再折一次结果不变（幂等，防重复编辑时间漂移）', () => {
    const once = toDatetimeLocalValue('2026-07-21T01:00:00.000Z');
    expect(toDatetimeLocalValue(once)).toBe(once);
  });
  it('无法解析 / 空串 → 原样返回，不抛错', () => {
    expect(toDatetimeLocalValue('')).toBe('');
    expect(toDatetimeLocalValue('not-a-date')).toBe('not-a-date');
  });
});

// ─── 并清单 / 关闭时保留 —— 面板与角色工具共用的规则 ───
// 这两个函数的存在意义是「绝不留下本地看不见、远端却会触发的幽灵任务」，
// 所以每条都按这个标准钉：什么情况下记录必须留下来。

describe('applyScheduledTask', () => {
  const A = task({ taskUuid: 'aaaaaaaa-0000-0000-0000-000000000000' });
  const B = task({ taskUuid: 'bbbbbbbb-0000-0000-0000-000000000000' });
  const fresh = task({ taskUuid: 'cccccccc-0000-0000-0000-000000000000' });

  it('纯新建：并到清单末尾，其它任务不动', () => {
    const out = applyScheduledTask([A, B], fresh, {}, Date.now());
    expect(out.map((t) => t.taskUuid)).toEqual([A.taskUuid, B.taskUuid, fresh.taskUuid]);
  });

  it('替换成功：旧记录移除，新记录进来', () => {
    const out = applyScheduledTask([A, B], fresh, { replaceTaskUuid: A.taskUuid }, Date.now());
    expect(out.map((t) => t.taskUuid)).toEqual([B.taskUuid, fresh.taskUuid]);
  });

  it('替换时远端取消失败：旧记录必须保留并标错（远端新旧并存，本地不能只剩新的）', () => {
    const out = applyScheduledTask(
      [A, B], fresh,
      { replaceTaskUuid: A.taskUuid, replacedCancelFailed: true },
      Date.now(),
    );
    expect(out.map((t) => t.taskUuid)).toEqual([A.taskUuid, B.taskUuid, fresh.taskUuid]);
    expect(out.find((t) => t.taskUuid === A.taskUuid)?.lastError).toBe(REPLACE_CANCEL_FAILED_NOTE);
    // 没被替换的那条不该被牵连打标
    expect(out.find((t) => t.taskUuid === B.taskUuid)?.lastError).toBeUndefined();
  });

  it('顺手清掉过点 48h 的一次性任务，但循环任务不清', () => {
    const stale = task({ taskUuid: 'dddddddd-0000-0000-0000-000000000000', firstSendTime: new Date(Date.now() - 72 * H).toISOString() });
    const oldDaily = task({ taskUuid: 'eeeeeeee-0000-0000-0000-000000000000', recurrenceType: 'daily', firstSendTime: new Date(Date.now() - 72 * H).toISOString() });
    const out = applyScheduledTask([stale, oldDaily], fresh, {}, Date.now());
    expect(out.map((t) => t.taskUuid)).toEqual([oldDaily.taskUuid, fresh.taskUuid]);
  });
});

describe('keepUncancelledTasks', () => {
  const notes = { failed: '取消失败', appeared: '关闭时新出现' };
  const A = task({ taskUuid: 'aaaaaaaa-0000-0000-0000-000000000000' });
  const B = task({ taskUuid: 'bbbbbbbb-0000-0000-0000-000000000000' });
  const C = task({ taskUuid: 'cccccccc-0000-0000-0000-000000000000' });

  it('全部取消成功 → 清单清空', () => {
    const attempted = new Set([A.taskUuid, B.taskUuid]);
    expect(keepUncancelledTasks([A, B], attempted, new Set(), notes)).toEqual([]);
  });

  it('取消失败的留下并标错（远端还活着，用户得能再试）', () => {
    const attempted = new Set([A.taskUuid, B.taskUuid]);
    const out = keepUncancelledTasks([A, B], attempted, new Set([B.taskUuid]), notes);
    expect(out.map((t) => t.taskUuid)).toEqual([B.taskUuid]);
    expect(out[0].lastError).toBe(notes.failed);
  });

  it('取消期间才出现的任务留下（压根没被尝试过，跟着清掉就成幽灵任务）', () => {
    // C 是关闭流程跑到一半时角色在聊天里刚排的，不在 attempted 里
    const attempted = new Set([A.taskUuid, B.taskUuid]);
    const out = keepUncancelledTasks([A, B, C], attempted, new Set(), notes);
    expect(out.map((t) => t.taskUuid)).toEqual([C.taskUuid]);
    expect(out[0].lastError).toBe(notes.appeared);
  });
});

// 回归守卫：面板打开时抓的远端底账是「那一刻」的快照，之后新建的任务当然不在里面。
// 曾经每建一条任务，卡片下面就立刻冒一行「⚠ 远端不存在」，关掉面板重开才消失——
// 第一次用的人会以为排程失败了。
describe('远端对账（applyRemoteTaskDelta / isRemoteMissingTask）', () => {
  const now = Date.now();
  const A = task({ taskUuid: 'aaaaaaaa-0000-0000-0000-000000000000' });
  const NEW = task({ taskUuid: 'nnnnnnnn-0000-0000-0000-000000000000' });

  it('新建成功后记进底账 → 不再误标「远端不存在」', () => {
    const opened = new Set([A.taskUuid]);            // 打开面板时远端只有 A
    expect(isRemoteMissingTask(NEW, opened, now)).toBe(true);   // 不记账就是这个错觉

    const after = applyRemoteTaskDelta(opened, { present: [NEW.taskUuid] });
    expect(isRemoteMissingTask(NEW, after, now)).toBe(false);
    expect(isRemoteMissingTask(A, after, now)).toBe(false);     // 别牵连原有任务
  });

  it('编辑 = 新建 + 取消旧的：新 uuid 进账、旧 uuid 出账', () => {
    const after = applyRemoteTaskDelta(new Set([A.taskUuid]), {
      present: [NEW.taskUuid],
      gone: [A.taskUuid],
    });
    expect(after).toEqual(new Set([NEW.taskUuid]));
  });

  it('替换时旧任务取消失败 → 旧 uuid 留在账上（远端新旧并存，别标成不存在）', () => {
    const after = applyRemoteTaskDelta(new Set([A.taskUuid]), { present: [NEW.taskUuid] });
    expect(isRemoteMissingTask(A, after, now)).toBe(false);
  });

  it('底账没拉到（null）→ 一直保持 null，整个徽标不显示', () => {
    expect(applyRemoteTaskDelta(null, { present: [NEW.taskUuid] })).toBeNull();
    expect(isRemoteMissingTask(A, null, now)).toBe(false);
  });

  it('已过点的一次性任务不标：它本来就该从远端消失', () => {
    const fired = task({
      taskUuid: 'ffffffff-0000-0000-0000-000000000000',
      firstSendTime: new Date(now - 24 * H).toISOString(),
    });
    expect(isRemoteMissingTask(fired, new Set(), now)).toBe(false);
  });

  it('待触发的任务确实从远端消失了 → 照标（这才是徽标存在的意义）', () => {
    expect(isRemoteMissingTask(A, new Set(), now)).toBe(true);
  });
});

// 回归守卫：循环任务的 firstSendTime 是「第一次」的锚点，可能在好几天前。
// 直接把它显示出来，一条每天的任务看着就像「过点了还没触发」——设置面板、角色查到的
// 清单、注入角色的排程现状块三处都栽在这上面，所以时间一律走 currentOccurrenceMs。
describe('currentOccurrenceMs（清单显示的「这一次」）', () => {
  const NOW = new Date('2026-07-26T14:00:00.000Z').getTime();
  const at = (iso: string) => new Date(iso).getTime();

  it('一次性任务恒为 firstSendTime，过没过点都一样', () => {
    const future = task({ firstSendTime: '2026-07-27T09:00:00.000Z' });
    const past = task({ firstSendTime: '2026-07-20T09:00:00.000Z' });
    expect(currentOccurrenceMs(future, NOW)).toBe(at('2026-07-27T09:00:00.000Z'));
    expect(currentOccurrenceMs(past, NOW)).toBe(at('2026-07-20T09:00:00.000Z'));
  });

  it('每天：几天前建的任务推到今天/明天的那一次，而不是原始锚点', () => {
    const daily = task({ recurrenceType: 'daily', firstSendTime: '2026-07-20T09:00:00.000Z' });
    // 今天 09:00 已经过了（现在 14:00），下一次是明天 09:00
    expect(currentOccurrenceMs(daily, NOW)).toBe(at('2026-07-27T09:00:00.000Z'));
  });

  it('每周：按 7 天推，跨月也不迭代', () => {
    const weekly = task({ recurrenceType: 'weekly', firstSendTime: '2026-05-04T09:00:00.000Z' });
    const next = currentOccurrenceMs(weekly, NOW)!;
    expect(next).toBeGreaterThan(NOW);
    expect((next - at('2026-05-04T09:00:00.000Z')) % (7 * 24 * H)).toBe(0);
  });

  it('时间串坏掉 → null（调用方退回原值显示，不抛错）', () => {
    expect(currentOccurrenceMs(task({ firstSendTime: '不是时间' }), NOW)).toBeNull();
  });
});

// 「已到点」这三个字对一次性任务等于没说——发过了还是卡住了，用户分不出来。
// 远端底账正好能分辨，这里钉住三档口径。
describe('describeTaskProgress', () => {
  const now = Date.now();
  const pending = task({ taskUuid: 'aaaaaaaa-0000-0000-0000-000000000000' });
  const fired = task({
    taskUuid: 'ffffffff-0000-0000-0000-000000000000',
    firstSendTime: new Date(now - 24 * H).toISOString(),
  });

  it('还没到点 → 待触发（底账有没有都一样）', () => {
    expect(describeTaskProgress(pending, new Set([pending.taskUuid]), now)).toBe('待触发');
    expect(describeTaskProgress(pending, null, now)).toBe('待触发');
  });

  it('过点了、远端那行还在 → cron 还没消费', () => {
    expect(describeTaskProgress(fired, new Set([fired.taskUuid]), now)).toBe('已到点·待处理');
  });

  it('过点了、远端已经没有 → worker 处理完了（发出去或被闸作废）', () => {
    expect(describeTaskProgress(fired, new Set(), now)).toBe('已触发');
  });

  it('底账没拉到 → 不猜，给中性文案', () => {
    expect(describeTaskProgress(fired, null, now)).toBe('已到点');
  });

  // 一次性任务重试用完会被标 'failed' 留在远端，永远不会再被消费——
  // 这时候还说「待处理」是骗人，它不会有下文了。
  it('远端那行还在但已是 failed 终态 → 发送失败，不再说「待处理」', () => {
    expect(describeTaskProgress(fired, new Set([fired.taskUuid]), now, 'failed')).toBe('发送失败');
    // 非终态的远端 status（pending 等）不改变原口径。
    expect(describeTaskProgress(fired, new Set([fired.taskUuid]), now, 'pending')).toBe('已到点·待处理');
  });
});

// ─── 远端 lastError（上一次没发出去的原因）的收敛与人话 ───
describe('parseRemoteTaskLastError', () => {
  it('标准形状（run-tick 写的 {at, occurrence, reason}）原样收敛', () => {
    expect(parseRemoteTaskLastError({
      at: '2026-07-30T15:00:10.000Z',
      occurrence: '2026-07-30T15:00:00.000Z',
      reason: 'stale',
    })).toEqual({
      at: '2026-07-30T15:00:10.000Z',
      occurrence: '2026-07-30T15:00:00.000Z',
      reason: 'stale',
    });
  });

  it('null / 非对象 / 全空对象 → null（旧 worker 没这字段，界面不显示那行）', () => {
    expect(parseRemoteTaskLastError(null)).toBeNull();
    expect(parseRemoteTaskLastError(undefined)).toBeNull();
    expect(parseRemoteTaskLastError('stale')).toBeNull();
    expect(parseRemoteTaskLastError({})).toBeNull();
    expect(parseRemoteTaskLastError({ at: 123, reason: '' })).toBeNull();
  });

  it('字段残缺时留下能用的部分', () => {
    expect(parseRemoteTaskLastError({ reason: 'HTTP 403' })).toEqual({
      at: undefined, occurrence: undefined, reason: 'HTTP 403',
    });
  });
});

describe('describeRemoteLastError', () => {
  const fmt = (iso: string) => `T(${iso})`;

  it("reason 'stale' → 「到点时已过期太久，跳过了一次」，时间优先用 occurrence", () => {
    expect(describeRemoteLastError({
      at: '2026-07-30T15:00:10.000Z',
      occurrence: '2026-07-30T15:00:00.000Z',
      reason: 'stale',
    }, fmt)).toBe('T(2026-07-30T15:00:00.000Z) 到点时已过期太久，跳过了一次');
  });

  it('其余 reason → 「上次到点没发出去（连续失败）」并带上原因', () => {
    expect(describeRemoteLastError({
      occurrence: '2026-07-30T15:00:00.000Z',
      reason: 'Web Push 返回 HTTP 403',
    }, fmt)).toBe('T(2026-07-30T15:00:00.000Z) 上次到点没发出去（连续失败：Web Push 返回 HTTP 403）');
  });

  it('reason 是一长串原始报错时截断，别把整段堆栈糊上卡片', () => {
    const text = describeRemoteLastError({ reason: 'x'.repeat(500) }, fmt)!;
    expect(text.length).toBeLessThan(120);
    expect(text).toContain('上次到点没发出去');
  });

  it('没有 occurrence 退回 at；两个都没有就不带时间；null → null', () => {
    expect(describeRemoteLastError({ at: '2026-07-30T15:00:10.000Z', reason: 'boom' }, fmt))
      .toBe('T(2026-07-30T15:00:10.000Z) 上次到点没发出去（连续失败：boom）');
    expect(describeRemoteLastError({ reason: 'boom' }, fmt))
      .toBe('上次到点没发出去（连续失败：boom）');
    expect(describeRemoteLastError(null, fmt)).toBeNull();
  });
});

describe('pruneFiredTasks', () => {
  const now = Date.now();
  const uuids = (list: ActiveMsg2TaskRecord[]) => list.map((t) => shortTaskId(t.taskUuid));
  const fired = task({
    taskUuid: 'ffffffff-0000-0000-0000-000000000000',
    firstSendTime: new Date(now - 24 * H).toISOString(),
  });
  const pending = task({ taskUuid: 'aaaaaaaa-0000-0000-0000-000000000000' });

  it('走完的一次性任务出清单，待触发的留下', () => {
    expect(uuids(pruneFiredTasks([fired, pending], new Set(), now))).toEqual(['aaaaaaaa']);
  });

  it('过点了但远端那行还在 → worker 还没处理，留着', () => {
    expect(uuids(pruneFiredTasks([fired], new Set([fired.taskUuid]), now))).toEqual(['ffffffff']);
  });

  // 带错误的那行是用户唯一能看见的线索（远端可能还会照发），清掉等于把问题藏起来。
  it('带 lastError 的即使走完也留着', () => {
    const broken = { ...fired, lastError: REPLACE_CANCEL_FAILED_NOTE };
    expect(uuids(pruneFiredTasks([broken], new Set(), now))).toEqual(['ffffffff']);
  });

  it('底账没拉到时一条都不动', () => {
    expect(uuids(pruneFiredTasks([fired, pending], null, now))).toEqual(['ffffffff', 'aaaaaaaa']);
  });

  it('循环任务过点了也不清——它下一轮还会响', () => {
    const daily = task({
      taskUuid: 'dddddddd-0000-0000-0000-000000000000',
      firstSendTime: new Date(now - 24 * H).toISOString(),
      recurrenceType: 'daily',
    });
    expect(uuids(pruneFiredTasks([daily], new Set(), now))).toEqual(['dddddddd']);
  });

  // 清理口径必须跟面板上那行字一致：写着「已触发」的正是该清掉的那条，
  // 两边走岔就会出现「显示已触发却清不掉」或者「还在处理却被清了」。
  it('清理口径与 describeTaskProgress 的「已触发」对齐', () => {
    for (const t of [fired, pending]) {
      const remote = new Set<string>();
      const kept = pruneFiredTasks([t], remote, now).length === 1;
      expect(kept).toBe(describeTaskProgress(t, remote, now) !== '已触发');
    }
  });
});

// 回归守卫：fire 时刻的排程清单。平时聊天角色每轮都看得到自己挂着什么，到点生成时
// 以前是瞎的——于是它会把同一件事再排一遍，或者说「等下再告诉你 X」而 X 早就排好了。
// 这一块跟聊天那份说同一套话，但有三处只属于 fire：时区换算、摘掉正在发的那条、不带作废回执。
describe('buildFireTaskListBlock', () => {
  const NOW = Date.UTC(2026, 6, 30, 12, 0);
  const fireTask = (over: Partial<ActiveMsg2TaskRecord> = {}): ActiveMsg2TaskRecord => ({
    taskUuid: 'aaaaaaaa-1111-4111-8111-111111111111',
    clientTaskId: 'client-1',
    mode: 'auto',
    firstSendTime: new Date(NOW + 3600_000).toISOString(),
    recurrenceType: 'none',
    expirePolicy: 'expire',
    source: 'user',
    status: 'scheduled',
    createdAt: NOW,
    ...over,
  });

  it('列出待触发任务，时间按 tzId 换算（worker 跑在 UTC，不能用运行时本地时区）', () => {
    const block = buildFireTaskListBlock([fireTask()], { nowMs: NOW, tzId: 'Asia/Shanghai' });
    expect(block).toContain('7月30日 21:00');            // UTC 13:00 → UTC+8 21:00
    expect(buildFireTaskListBlock([fireTask()], { nowMs: NOW, tzId: 'UTC' }))
      .toContain('7月30日 13:00');
  });

  it('tzId 与当前时间槽 / self_log 同一参照系（东京钟）', () => {
    // UTC 13:00 → 东京 22:00。
    const block = buildFireTaskListBlock([fireTask()], { nowMs: NOW, tzId: 'Asia/Tokyo' });
    expect(block).toContain('7月30日 22:00');
    expect(block).not.toContain('13:00');
  });

  it('摘掉正在发的那一条——列进去角色会以为还得再排一次', () => {
    const firing = fireTask({ clientTaskId: 'client-firing' });
    const other = fireTask({
      taskUuid: 'bbbbbbbb-2222-4222-8222-222222222222',
      clientTaskId: 'client-other',
    });
    const block = buildFireTaskListBlock([firing, other], {
      nowMs: NOW, tzId: 'UTC', excludeClientTaskId: 'client-firing',
    });
    expect(block).toContain(shortTaskId(other.taskUuid));
    expect(block).not.toContain(shortTaskId(firing.taskUuid));
  });

  it('过点的一次性任务不列（isPendingTask 同一把尺）', () => {
    const past = fireTask({ firstSendTime: new Date(NOW - 86_400_000).toISOString() });
    expect(buildFireTaskListBlock([past], { nowMs: NOW, tzId: 'UTC' })).toBe('');
  });

  it('循环任务写「下一次」的时间，不是好几天前的首次', () => {
    const daily = fireTask({
      firstSendTime: new Date(Date.UTC(2026, 6, 20, 13, 0)).toISOString(),
      recurrenceType: 'daily',
    });
    const block = buildFireTaskListBlock([daily], { nowMs: NOW, tzId: 'UTC' });
    expect(block).toContain('7月30日 13:00');
    expect(block).not.toContain('7月20日');
  });

  // 回归守卫：这一块以前只说「别重复排、也别当它们不存在」，没说「别念出来」。
  // 短 id 和「遇忙作废」是纯系统腔，被角色照着复述出来就是当场穿帮。
  it('带防复述约束（跟平时聊天那份共用同一句）', () => {
    const block = buildFireTaskListBlock([fireTask()], { nowMs: NOW, tzId: 'UTC' });
    expect(block).toContain(AMSG2_SCHEDULE_SECRECY_NOTE);
    expect(block).toContain('不要向用户复述');
  });

  it('没有可列的 → 空串（槽位被抹平）', () => {
    expect(buildFireTaskListBlock([], { nowMs: NOW, tzId: 'UTC' })).toBe('');
    expect(buildFireTaskListBlock([fireTask()], {
      nowMs: NOW, tzId: 'UTC', excludeClientTaskId: 'client-1',
    })).toBe('');
  });

  it('带上模式与防穿帮策略——角色要据此判断这条会不会被让路', () => {
    const block = buildFireTaskListBlock([fireTask({ expirePolicy: 'force', mode: 'prompted', promptHint: '叫他起床' })], {
      nowMs: NOW, tzId: 'UTC',
    });
    expect(block).toContain('强制发送');
    expect(block).toContain('叫他起床');
  });
});

describe('reconcileTasksWithRemote（跟远端底账对一次账）', () => {
  const remoteRow = (over: Record<string, unknown> = {}) => ({
    uuid: 'amsgself-char1-1754179200000-0',
    status: 'scheduled',
    lastError: null,
    clientTaskId: 'amsgself-char1-1754179200000-0-c',
    messageType: 'auto',
    recurrenceType: 'daily',
    nextSendAt: '2026-08-03T01:00:00.000Z',
    ...over,
  }) as any;

  // 角色在 fire 里给自己排的任务是随 push 认领的。那条 push 推失败、或者被防穿帮闸
  // 吞掉，认领就跟着没了，而任务在 D1 里照常到点触发——面板列不出来、用户也取消不掉，
  // 唯一的办法是关掉整个 2.0 或者删角色。
  it('远端有、本地没有的任务补回清单', () => {
    const out = reconcileTasksWithRemote([], [remoteRow()]);
    expect(out.map((t) => t.taskUuid)).toEqual(['amsgself-char1-1754179200000-0']);
    expect(out[0].source).toBe('character');
    expect(out[0].recurrenceType).toBe('daily');
    expect(out[0].nextSendAt).toBe('2026-08-03T01:00:00.000Z');
  });

  it('本地已有的不重复补，只把远端算的下次触发时刻同步过来', () => {
    const local = [task({ taskUuid: 'amsgself-char1-1754179200000-0' })];
    const out = reconcileTasksWithRemote(local, [remoteRow()]);
    expect(out).toHaveLength(1);
    expect(out[0].nextSendAt).toBe('2026-08-03T01:00:00.000Z');
  });

  it('远端那行还没有下次触发时刻 → 不凭空造一条本地记录', () => {
    expect(reconcileTasksWithRemote([], [remoteRow({ nextSendAt: undefined })])).toEqual([]);
  });

  it('远端一条都没有 → 原样返回，不动本地清单', () => {
    const local = [task()];
    expect(reconcileTasksWithRemote(local, [])).toEqual(local);
  });
});

describe('currentOccurrenceMs 跨夏令时', () => {
  // 循环任务按角色所在时区的墙钟推进（worker 那边用 Intl 算）。本地固定加 24 小时的话，
  // 纽约的每日任务过一次夏令时切换就永久偏一小时，显示的时刻跟真正会响的对不上。
  it('对过账就用远端算的那个时刻，不自己按固定周期乘', () => {
    const dstTask = task({
      firstSendTime: '2026-03-07T13:00:00.000Z',   // 纽约 3/7 08:00（EST）
      recurrenceType: 'daily',
      nextSendAt: '2026-03-08T12:00:00.000Z',      // 纽约 3/8 08:00（EDT，真实间隔 23h）
    });
    const now = Date.parse('2026-03-07T14:00:00.000Z');

    expect(currentOccurrenceMs(dstTask, now)).toBe(Date.parse('2026-03-08T12:00:00.000Z'));
    // 固定 +24h 会算成 13:00Z，也就是纽约的 09:00——那正是旧行为偏掉的那一小时。
    expect(currentOccurrenceMs(dstTask, now)).not.toBe(Date.parse('2026-03-08T13:00:00.000Z'));
  });

  it('远端给的那次已经过点 → 退回自己推算（还没对上这一轮的账）', () => {
    const stale = task({
      firstSendTime: '2026-03-07T13:00:00.000Z',
      recurrenceType: 'daily',
      nextSendAt: '2026-03-08T12:00:00.000Z',
    });
    const now = Date.parse('2026-03-20T00:00:00.000Z');
    expect(currentOccurrenceMs(stale, now)).toBeGreaterThan(now);
  });
});

// 麦麦 2026-09-30：发往云端那份的策略翻译。
//
// 云端 shouldExpireFire 对 force 一次窗口都不判（`policy !== 'expire' → false`），
// 所以「force + 到点前 10 分钟用户说过话就不推」这条新规则只能靠翻译让云端去跳。
// 本地记录始终是真策略，翻译只发生在发给云端的那份 metadata 上。

// ─── 麦麦 2026-09-30：30 分钟兜底 ───
// 兜底是「强制发送」被让开、角色又一直没顺口带出来时的最终保证。三个判定都纯，
// 单测能锁住；真正建任务的编排（排程 + 落账）靠联调看诊断和 D1。
describe('isForcePolicy（谁需要配兜底）', () => {
  it('提示词/自动 + 强制发送 → 要兜底', () => {
    for (const mode of ['prompted', 'auto'] as const) {
      expect(isForcePolicy(mode, 'force')).toBe(true);
    }
  });

  it('遇忙作废 → 不要兜底（没有需要补的后路）', () => {
    expect(isForcePolicy('auto', 'expire')).toBe(false);
    expect(isForcePolicy('auto', undefined)).toBe(false);
  });

  // 钙片这类提醒多是固定模式。固定恒 force，之前不会走「到点让路」那套，
  // 但它在云端压根不进判定闸 —— 到点必推，也就永远等不到兜底接手。
  // 把它纳进来才是「固定模式 + 强制发送」这条新规则真正落地的样子。
  it('固定模式恒 force → 要兜底（哪怕调用方没写策略）', () => {
    expect(isForcePolicy('fixed', undefined)).toBe(true);
    expect(isForcePolicy('fixed', 'expire')).toBe(true);
    expect(isForcePolicy('fixed', 'force')).toBe(true);
  });
});

describe('AMSG_FALLBACK_DELAY_MS', () => {
  it('就是 30 分钟', () => {
    expect(AMSG_FALLBACK_DELAY_MS).toBe(30 * 60_000);
  });
});

describe('buildFallbackText（兜底到点原样发的那句）', () => {
  // 固定模式就是「原样补那句」，一个字都不能改——补的是钙片提醒，就还得是那句提醒。
  it('固定模式用主任务原文，不改一个字', () => {
    expect(buildFallbackText('fixed', '别太油', '该吃钙片了')).toBe('该吃钙片了');
  });

  // 没有那句可补就不该建兜底（返回空串，由调用方跳过），总比补一句不相干的话强。
  it('固定模式没原文 → 空串（调用方据此不建兜底）', () => {
    expect(buildFallbackText('fixed', '别太油', '   ')).toBe('');
    expect(buildFallbackText('fixed', '别太油', undefined)).toBe('');
  });

  // 暮色 2026-09-30 拍板：提示词/自动**不能丢掉原文换默认句**。丢了的话兜底推过来
  // 就是一句看不出在提醒什么的话，等于没提醒。方向词（"别太油"）照样原样带进去。
  it('提示词/自动：方向词原样带进模板', () => {
    expect(buildFallbackText('prompted', '别太油', undefined)).toBe('到点啦：别太油');
    expect(buildFallbackText('auto', '记得提醒我吃药', undefined)).toBe('到点啦：记得提醒我吃药');
  });

  it('提示词/自动：长句也带，一字不改', () => {
    const hint = '别太油，自然一点，像平时聊天那样';
    expect(buildFallbackText('prompted', hint, undefined)).toBe(`到点啦：${hint}`);
  });

  it('首尾空白先去掉再拼（免得模板里出现"到点啦：  "这种空隙）', () => {
    expect(buildFallbackText('prompted', '  记得提醒我吃药  ', undefined)).toBe('到点啦：记得提醒我吃药');
  });

  it('什么都没给 → 兜底默认句', () => {
    expect(buildFallbackText('auto', undefined, undefined)).toBe('你之前定的那件事，到点啦。');
  });
});

describe('isFallbackTask / visibleTasks（兜底不给人看）', () => {
  it('带 fallbackFor 的是兜底，其余不是', () => {
    expect(isFallbackTask({ fallbackFor: 'cid-main' })).toBe(true);
    expect(isFallbackTask({})).toBe(false);
  });

  // 兜底躺在本地清单里是第 5 步取消它的前提，但它不该在面板列表里冒充用户排的任务。
  it('visibleTasks 滤掉兜底，其余原样保留（顺序不变）', () => {
    const main = task({ clientTaskId: 'cid-main' });
    const fb = task({ clientTaskId: 'cid-fb', fallbackFor: 'cid-main' });
    const other = task({ clientTaskId: 'cid-other' });
    expect(visibleTasks([main, fb, other])).toEqual([main, other]);
    // 原数组不能被就地改——面板拿 allTasks 还要用来关 2.0 时取消全部。
    expect(visibleTasks([main, fb, other])).not.toBe([main, fb, other]);
  });
});

// ─── 麦麦 2026-09-30：发给云端那份的形态 ───
// 云端那道到点判定的真实长相（对着线上 bundle 逐行核过）：
//   shouldExpireFire 第一行 `policy !== 'expire' → return false` —— 对 force 一次不判；
//   taskNeedsLlm 只放 prompted / auto 进 onBeforeFire —— fixed 连门都摸不到。
// 所以「force + 到点前 10 分钟用户说过话就不推」这条新规则，客户端只能靠翻译
// 让云端去跳。本地记录始终是真策略，翻译只发生在发给云端的那一份上。
describe('resolveCloudExpirePolicy（翻译成云端认得的形态）', () => {
  it('提示词/自动 + 强制发送 → 云端收到 expire，标记被翻过', () => {
    for (const mode of ['prompted', 'auto'] as const) {
      expect(resolveCloudExpirePolicy(mode, 'force')).toEqual({
        cloudPolicy: 'expire', forceAsExpire: true, fixedAsPrompted: false,
      });
    }
  });

  it('没写策略（默认）→ 原样 expire，两条标记都不打', () => {
    expect(resolveCloudExpirePolicy('auto', undefined))
      .toEqual({ cloudPolicy: 'expire', forceAsExpire: false, fixedAsPrompted: false });
    expect(resolveCloudExpirePolicy('prompted', 'expire'))
      .toEqual({ cloudPolicy: 'expire', forceAsExpire: false, fixedAsPrompted: false });
  });

  // 固定 + 强制发送：光翻策略没用（taskNeedsLlm 挡着），必须连模式一起翻成 prompted。
  // 这是钙片那类提醒第一次真正走进新规则——代价是每个周期多一次模型调用。
  it('固定 + 强制发送 → 策略翻 expire，且模式也翻成 prompted（附提示词前缀）', () => {
    for (const policy of [undefined, 'force'] as const) {
      const r = resolveCloudExpirePolicy('fixed', policy);
      expect(r.cloudPolicy).toBe('expire');
      expect(r.forceAsExpire).toBe(true);
      expect(r.fixedAsPrompted).toBe(true);
      expect(r.cloudHint).toBe(FIXED_AS_PROMPTED_PREFIX);
    }
  });

  // 固定模式恒 force（resolveExpirePolicy 钉死，面板上它永远显示「强制发送」），
  // 所以"固定 + 遇忙作废"这个组合压根不存在 —— 每一条固定任务都会走翻译。
  // 这不是 bug，是暮色 9-30 定的规则本身：固定模式也要走 10 分钟窗、不接受照发。
  it('固定模式无论调用方写什么策略，一律翻成 prompted + expire', () => {
    for (const policy of [undefined, 'expire', 'force'] as const) {
      const r = resolveCloudExpirePolicy('fixed', policy);
      expect(r).toMatchObject({ cloudPolicy: 'expire', forceAsExpire: true, fixedAsPrompted: true });
    }
  });
});

describe('FIXED_AS_PROMPTED_PREFIX', () => {
  // 「原话」不是「原样发送」：模型没法逐字复读，说「原样发送」它会理解成照着意思说，
  // 措辞飘得更远；约束"内容不许变"、放它决定语气，才是暮色接受的那点代价。
  it('写"原话"而不是"原样发送"', () => {
    expect(FIXED_AS_PROMPTED_PREFIX).toContain('原话');
    expect(FIXED_AS_PROMPTED_PREFIX).not.toContain('原样');
  });
});

// ─── 麦麦 2026-09-30：回执的四种类型 ───
// 旧口径只有两种（作废 / 手动取消），把「强制发送」和「固定」一起排除了。新规则下
// 强制发送同样会被让开，它得有一条自己的回执——说「这轮顺口带出来」，不是「别提了」。
// 这两种给角色的动作是相反的，混在一段里说它会随便挑一条。
describe('noticeKindForTask（这条没发出去时，角色该听到哪一种交代）', () => {
  it('遇忙作废 → expired', () => {
    expect(noticeKindForTask(task({ mode: 'auto', expirePolicy: 'expire' }))).toBe('expired');
    expect(noticeKindForTask(task({ mode: 'prompted', expirePolicy: 'expire' }))).toBe('expired');
  });

  it('强制发送 → deferred（旧口径这里返回的是「不用判」，角色压根不知道被让开过）', () => {
    expect(noticeKindForTask(task({ mode: 'auto', expirePolicy: 'force' }))).toBe('deferred');
    expect(noticeKindForTask(task({ mode: 'prompted', expirePolicy: 'force' }))).toBe('deferred');
  });

  // 固定模式恒无条件发，真没发出去是投递失败，走 lastError 那条路。
  // 在回执里告诉角色"你那条没发"是骗它去补一句它压根不需要说的话。
  it('固定模式 → 不产回执（恒无条件发）', () => {
    expect(noticeKindForTask(task({ mode: 'fixed', expirePolicy: 'force' }))).toBeNull();
    expect(noticeKindForTask(task({ mode: 'fixed', expirePolicy: 'expire' }))).toBeNull();
  });

  it('已取消的任务 → 不产回执', () => {
    expect(noticeKindForTask(task({ mode: 'auto', expirePolicy: 'expire', status: 'cancelled' }))).toBeNull();
  });
});

// ─── 入口闸「只替换 自排+once+遇忙作废」（麦麦 2026-10-01 step 9）───
describe('isReplaceableCharacterWakeup（角色改口时能顶掉哪一条）', () => {
  // task() 的默认值恰好就是「自排 + 一次性 + 遇忙作废」这一组，下面每条只改一个字段。
  it('自排 + 一次性 + 遇忙作废 → 可以顶掉', () => {
    expect(isReplaceableCharacterWakeup(task())).toBe(true);
  });

  // 用户自己排的任务，角色没资格替他改主意。
  it('手动排的 → 不许顶', () => {
    expect(isReplaceableCharacterWakeup(task({ source: 'user' }))).toBe(false);
  });

  // 循环是长期约定，悄悄换成另一条等于单方面撕毁。
  it('循环的 → 不许顶（每天早安那种）', () => {
    for (const r of ['daily', 'weekly'] as const) {
      expect(isReplaceableCharacterWakeup(task({ recurrenceType: r }))).toBe(false);
    }
  });

  // 强制发送的保证就是"到点一定送到"，角色能自己撤掉，这条保证就没了。
  it('强制发送 → 不许顶', () => {
    expect(isReplaceableCharacterWakeup(task({ expirePolicy: 'force' }))).toBe(false);
  });

  // 兜底抄了主任务的 source（主任务是自排时兜底也是 'character'），只看来源会误顶。
  it('兜底 → 不许顶（它 source 看着也是 character）', () => {
    expect(isReplaceableCharacterWakeup(task({ fallbackFor: 'cid-main' }))).toBe(false);
  });

  it('已取消的 → 不在考虑范围（入口闸那边本来就先滤掉了，这里兜住）', () => {
    expect(isReplaceableCharacterWakeup(task({ status: 'cancelled' }))).toBe(false);
  });

  // 固定模式恒 force（resolveExpirePolicy 钉死），哪怕记录里写着 expire 也算强制发送。
  it('固定模式 → 恒不许顶（恒 force）', () => {
    expect(isReplaceableCharacterWakeup(task({ mode: 'fixed' }))).toBe(false);
  });

  // 三种"不许顶"和一种"可以顶"必须互不重叠：判据的四个条件各自都在挡一类，
  // 任一条写松了就会让角色撤掉它没资格撤的承诺。
  it('四条判据各自都能单独挡住（逐个放宽就放行了）', () => {
    expect(isReplaceableCharacterWakeup(task({ source: 'user' }))).toBe(false);
    expect(isReplaceableCharacterWakeup(task({ recurrenceType: 'daily' }))).toBe(false);
    expect(isReplaceableCharacterWakeup(task({ expirePolicy: 'force' }))).toBe(false);
    expect(isReplaceableCharacterWakeup(task({ fallbackFor: 'x' }))).toBe(false);
    expect(isReplaceableCharacterWakeup(task())).toBe(true);
  });
});

// ─── 策略选项的文案（麦麦 2026-10-01 step 10）───
describe('EXPIRE_POLICY_OPTIONS（面板上那两个按钮）', () => {
  const opt = (id: 'expire' | 'force') => EXPIRE_POLICY_OPTIONS.find((o) => o.id === id)!;

  it('两个都在，顺序是「遇忙作废」在前', () => {
    expect(EXPIRE_POLICY_OPTIONS.map((o) => o.id)).toEqual(['expire', 'force']);
  });

  // 任务列表、那张「最近没响的」卡、兜底提示用的都是 describeExpirePolicy。
  // 选择器叫「自动作废」而别处叫「遇忙作废」时，用户会当成两种策略。
  it('标签跟 describeExpirePolicy 用同一对词', () => {
    for (const o of EXPIRE_POLICY_OPTIONS) {
      expect(o.label).toBe(describeExpirePolicy(o.id));
    }
  });

  // 这两条描述原来挂反了：expire 挂着"转为对话里自然带出"。用户按那句去等，
  // 等不到就以为功能坏了——所以两个方向都要盯住。
  it('遇忙作废 → 明说取消、聊天里不会出现，且不提"带出"', () => {
    const d = opt('expire').desc;
    expect(d).toContain('取消');
    expect(d).toContain('不会出现');
    expect(d).not.toContain('带出');
  });

  it('强制发送 → 说清顺口带出 + 30 分钟兜底', () => {
    const d = opt('force').desc;
    expect(d).toContain('顺口带出');
    expect(d).toContain('30 分钟');
  });

  it('两条都不许承诺"作废了会在聊天里出现"', () => {
    for (const o of EXPIRE_POLICY_OPTIONS) {
      expect(o.desc).not.toContain('转为对话里');
    }
  });
});
