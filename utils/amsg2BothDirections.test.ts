// utils/amsg2BothDirections.test.ts
/**
 * 唤醒路径那两个方向的销账（麦麦 2026-09-30 暮色「两个方向都要堵」）。
 *
 * 方向一：普通聊天把回执消费掉之后，云端那份 fire_pack 里的旧快照也得换掉。
 *   → 验证的是「标成功才触发重传」，触发动作本身交给冲刷自己的机制（requeue +
 *     退避 + localStorage 底账），不在这里重复造一套。
 *
 * 方向二：同步 fire_pack 时记下这次包里带了哪几条回执的 id，到点那条主动消息真上屏
 *   之后才销。生成失败 / 被闸吞 / 还在收件箱排队 → 一律不算消费。
 *
 * 这里只测纯逻辑 + 那本 localStorage 台账，不碰 IDB / 网络（项目里既有测试都是这个
 * 分寸，见 chatPresenceStorage 的 localStorage stub）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  buildAmsg2NoticesText,
  buildAmsg2TaskContextText,
  buildNoticeConsumeRuntime,
  noticesRenderedForRole,
  pickConsumableShippedIds,
  recordNoticesShippedInPack,
  takeShippedNoticeIds,
} from './amsg2TaskContext';
import { ActiveMsgStore } from './activeMsgStore';
import type { Amsg2ExpiredNoticeRecord, ActiveMsg2TaskRecord } from '../types';

// vitest 默认环境是 node，没有 localStorage —— stub 一个内存版（抄 chatPresenceStorage）。
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size; },
});

/**
 * 时间锚点（麦麦 2026-10-03 新增）。
 *
 * ## 原来这里写死的是 `2026-10-01T08:00:00Z`，那是一条会自己过期的测试
 *
 * 任务 recurrenceType='daily'，而 `pruneStaleTasks` 的规则是「过点 48h 出清单」。
 * 锚点 2026-10-01 16:00（北京时间）一过 2026-10-03 16:00 整，任务就被判出清单，
 * 两条「两条路各走一遍」立刻红。2026-10-03 下午就撞上了：vitest 从 452/5 变
 * 450/7，用 `git stash` 回到改动之前的提交跑**同样红**，排除了是新引入的。
 *
 * 这类失败比没有测试更糟——它是「日历走到那一天就自己亮红灯」，会把真回归淹掉。
 *
 * ## 现在锚在「今天本地 08:00」
 *
 * 任何时刻跑都在 48h 回看窗内：最坏是刚过午夜（8 小时前），最好是 23:59
 * （16 小时前），都远在 48 小时以内。测试**内部的时间相对关系一个字没改**
 * （回执 createdAt 仍是 occurrenceMs + 5s、任务 createdAt 仍是 T - 1h、
 * 消费时机仍是 T + 10min），改的只是那个绝对锚点本身。
 */
const TODAY_8AM = (() => {
  const d = new Date();
  d.setHours(8, 0, 0, 0);
  return d.getTime();
})();

const notice = (over: Partial<Amsg2ExpiredNoticeRecord> & { id: string }): Amsg2ExpiredNoticeRecord => ({
  charId: 'char-a',
  occurrenceMs: TODAY_8AM,
  mode: 'auto',
  recurrenceType: 'daily',
  kind: 'deferred',
  createdAt: TODAY_8AM + 5_000,
  ...over,
});

describe('方向二 · 包里带了哪些回执的台账', () => {
  beforeEach(() => { mem.clear(); });

  it('记了就能取走，取一次就清空（重复调用返回空）', () => {
    recordNoticesShippedInPack('char-a', ['n1', 'n2']);
    expect(takeShippedNoticeIds('char-a')).toEqual(['n1', 'n2']);
    // 第二次必须空：再来一次上屏不能把上一轮那批再销一遍。
    expect(takeShippedNoticeIds('char-a')).toEqual([]);
  });

  it('同一角色多次同步取并集，不覆盖', () => {
    recordNoticesShippedInPack('char-a', ['n1']);
    recordNoticesShippedInPack('char-a', ['n2', 'n1']);
    expect(takeShippedNoticeIds('char-a').sort()).toEqual(['n1', 'n2']);
  });

  it('角色之间互不串（谁带的只能销给谁）', () => {
    recordNoticesShippedInPack('char-a', ['a1']);
    recordNoticesShippedInPack('char-b', ['b1']);
    expect(takeShippedNoticeIds('char-a')).toEqual(['a1']);
    expect(takeShippedNoticeIds('char-b')).toEqual(['b1']);
  });

  it('没带过的角色取不到东西，也不留下空壳键', () => {
    expect(takeShippedNoticeIds('char-none')).toEqual([]);
    recordNoticesShippedInPack('char-a', ['a1']);
    takeShippedNoticeIds('char-a');
    // 销干净之后不该在 localStorage 里留一个空数组。
    expect(mem.get('amsg2_fired_notices')).toBeUndefined();
  });
});

describe('方向二 · 哪些才算「角色已经说出来了」', () => {
  it('台账里没有的、已经销过的，一律不销', () => {
    const ledger = [
      notice({ id: 'n1' }),
      notice({ id: 'n2', notifiedAt: Date.now() }),
    ];
    // n3 压根不在台账里（可能已经被普通聊天那条路销掉了）
    expect(pickConsumableShippedIds(['n1', 'n2', 'n3'], ledger)).toEqual(['n1']);
  });

  it('遇忙作废不进包，也不该被同包里的别的回执带着销掉', () => {
    const ledger = [notice({ id: 'defer', kind: 'deferred' }), notice({ id: 'busy', kind: 'expired' })];
    expect(pickConsumableShippedIds(['defer', 'busy'], ledger)).toEqual(['defer']);
  });

  it('老记录没有 kind 字段时按「遇忙作废」读（不告诉角色的那类）', () => {
    const legacy = { ...notice({ id: 'old' }), kind: undefined };
    expect(pickConsumableShippedIds(['old'], [legacy as Amsg2ExpiredNoticeRecord])).toEqual([]);
  });

  it('包里带了哪些 = 真正会进角色上下文的那几条（跟文案同一份判据）', () => {
    const records = [
      notice({ id: 'defer', kind: 'deferred' }),
      notice({ id: 'busy', kind: 'expired' }),
      notice({ id: 'quota', kind: 'quota-blocked' }),
      notice({ id: 'cancel', kind: 'user-cancelled' }),
    ];
    expect(noticesRenderedForRole(records).map((r) => r.id)).toEqual(['defer', 'quota', 'cancel']);
  });
});

describe('方向一 · 消费成功才触发重传', () => {
  // 这里**直接调真的 buildNoticeConsumeRuntime**，不复制它的判定：上一轮教训就是
  // 纯函数测不出「有没有人调它」，再复制一份判定就等于把同一个坑又挖一遍。
  // 台账是真的（fake-indexeddb + 真 ActiveMsgStore），只有建任务 / 销远端 / 写回
  // 清单这三个外部动作是注入的空壳。
  const CHAR = 'char-a';
  const dep = { delayMs: 30 * 60_000 };

  const notice = (id: string) => ({
    id, charId: CHAR, occurrenceMs: TODAY_8AM,
    mode: 'auto' as const, recurrenceType: 'daily' as const,
    kind: 'deferred' as const, createdAt: Date.now(),
  });

  beforeEach(async () => {
    mem.clear();
    await ActiveMsgStore.upsertExpiredNotices(CHAR, [notice('n1'), notice('n2')]);
  });

  const runtime = (resync?: (charId: string) => void) => buildNoticeConsumeRuntime({
    ...dep,
    resync,
    schedule: vi.fn(async () => null),
    cancelRemote: vi.fn(async () => {}),
    persist: vi.fn(async () => {}),
  });

  const char = () => ({ id: CHAR, name: '江澈', activeMsg2Config: { enabled: true, tasks: [] } } as any);

  it('标成功 → 调一次 resync，带的是这个角色；台账真的销掉了', async () => {
    const resync = vi.fn();
    await runtime(resync).settle(char(), ['n1']);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(resync).toHaveBeenCalledWith(CHAR);
    const after = await ActiveMsgStore.getExpiredNotices(CHAR);
    expect(after.find((r) => r.id === 'n1')?.notifiedAt).toBeTruthy();
    expect(after.find((r) => r.id === 'n2')?.notifiedAt).toBeFalsy();
  });

  it('标失败 → 不调 resync（台账还挂着，重传也是白传），且不往上抛', async () => {
    const resync = vi.fn();
    const spy = vi.spyOn(ActiveMsgStore, 'markExpiredNoticesNotified').mockRejectedValueOnce(new Error('IDB 挂了'));
    await expect(runtime(resync).settle(char(), ['n1'])).resolves.toBeUndefined();
    expect(resync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('不传 resync 也能跑（退回旧行为：等下一轮聊天顺路补传）', async () => {
    await expect(runtime().settle(char(), ['n1'])).resolves.toBeUndefined();
    const after = await ActiveMsgStore.getExpiredNotices(CHAR);
    expect(after.find((r) => r.id === 'n1')?.notifiedAt).toBeTruthy();
  });

  it('重传触发自己抛错也不影响这一轮聊天（不往上抛）', async () => {
    const resync = vi.fn(() => { throw new Error('打脏抛错'); });
    await expect(runtime(resync).settle(char(), ['n1'])).resolves.toBeUndefined();
  });
});

describe('两条路各走一遍 · 确认都只说一次（暮色第 4 条）', () => {
  // 这一组是端到端的：真文案 + 真台账 + 真销账函数，只有时间用假的。
  // 两个方向都验，验的是「同一条回执在两条路上加起来只出现一次」。
  const T = TODAY_8AM;
  const task: ActiveMsg2TaskRecord = {
    taskUuid: 'uuid-7f3a', clientTaskId: 'cid-7f3a', mode: 'auto',
    firstSendTime: new Date(T).toISOString(), recurrenceType: 'daily',
    promptHint: '提醒她吃药', expirePolicy: 'force', source: 'user',
    status: 'scheduled', createdAt: T - 3600_000,
  };
  const rec = (id: string): Amsg2ExpiredNoticeRecord => ({
    id, charId: id.split('|')[0], occurrenceMs: T, mode: 'auto',
    promptHint: '提醒她吃药', recurrenceType: 'daily', kind: 'deferred', createdAt: T + 5_000,
  });
  const unnotified = async (charId: string) =>
    (await ActiveMsgStore.getExpiredNotices(charId)).filter((r) => !r.notifiedAt);

  beforeEach(() => { mem.clear(); });

  it('路 A：普通聊天先消费 → 之后同步的包和下一轮聊天都不再带', async () => {
    const c = 'char-A';
    await ActiveMsgStore.upsertExpiredNotices(c, [rec(`${c}|${T}`)]);
    const taskOf = { ...task, taskUuid: `${c}|${T}` };

    // 第 1 步：普通聊天这一轮把它带出来
    const step1 = buildAmsg2TaskContextText([taskOf], await unnotified(c), T + 600_000, 'Asia/Shanghai');
    expect(step1).toContain('已推迟');
    // 第 2 步：请求成功 → 标消费
    await ActiveMsgStore.markExpiredNoticesNotified(c, (await unnotified(c)).map((r) => r.id));
    // 第 3 步：立刻重传的包，尾部那一段是空的
    expect(buildAmsg2NoticesText(await unnotified(c), undefined) ?? '').toBe('');
    // 第 4 步：下一轮普通聊天也不再交代一遍
    const step4 = buildAmsg2TaskContextText([taskOf], await unnotified(c), T + 1_200_000, 'Asia/Shanghai');
    expect(step4).not.toContain('已推迟');
  });

  it('路 B：到点先上屏 → 之后那一轮普通聊天不再交代', async () => {
    const c = 'char-B';
    await ActiveMsgStore.upsertExpiredNotices(c, [rec(`${c}|${T}`)]);
    const taskOf = { ...task, taskUuid: `${c}|${T}` };

    // 第 1 步：同步时把它拼在包尾部
    const fireBlock = buildAmsg2NoticesText(await unnotified(c), undefined) ?? '';
    expect(fireBlock).toContain('已推迟');
    // 第 2 步：同步成功 → 记下这批带过哪些
    recordNoticesShippedInPack(c, noticesRenderedForRole(await unnotified(c)).map((r) => r.id));
    // 第 3 步：到点真上屏 → 销账
    const shipped = takeShippedNoticeIds(c);
    expect(shipped).toEqual([`${c}|${T}`]);
    const target = pickConsumableShippedIds(shipped, await ActiveMsgStore.getExpiredNotices(c));
    await ActiveMsgStore.markExpiredNoticesNotified(c, target);
    // 第 4 步：之后那一轮普通聊天不再交代
    const step4 = buildAmsg2TaskContextText([taskOf], await unnotified(c), T + 2_400_000, 'Asia/Shanghai');
    expect(step4).not.toContain('已推迟');
  });
});
