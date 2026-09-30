// utils/amsg2DeferredScan.test.ts
/**
 * 「到点推迟」扫描器的判据测试（麦麦 2026-09-30）。
 *
 * 这一层最怕的是**判据用错窗口**：新规则只有"到点前 10 分钟"这一段，而旧的那套
 * 防穿帮检出对循环任务看的是前后对称窗、一次性看的是锚点之后有*任何*消息。
 * 判据偏宽会把不该拦的拦掉（用户隔了半天说了句话，到点的早安被吞），偏窄会漏判
 * 最该让开的那种。下面每条都盯住这两个方向。
 */
import { describe, it, expect } from 'vitest';
import {
  isDeferrable,
  scanDeferredCandidates,
  shouldDeferOccurrence,
  shouldHavePushed,
} from './amsg2DeferredScan';
import { ACTIVE_CHAT_WINDOW_MS } from './amsg2ExpireGuard';
import type { ActiveMsg2TaskRecord, Message } from '../types';

const MIN = 60_000;
const T0 = Date.parse('2026-10-01T08:00:00Z');

/** 到点前 n 分钟的**真实用户**消息（AI 主动消息不算，见 isRealUserMessage）。 */
const userMsg = (minutesBeforeOccurrence: number, at = T0): Message => ({
  role: 'user',
  timestamp: at - minutesBeforeOccurrence * MIN,
  metadata: null,
}) as unknown as Message;

const task = (extra: Partial<ActiveMsg2TaskRecord> = {}): ActiveMsg2TaskRecord => ({
  taskUuid: 't-1',
  clientTaskId: 'c-1',
  mode: 'auto',
  firstSendTime: new Date(T0).toISOString(),
  recurrenceType: 'none',
  expirePolicy: 'force',
  source: 'user',
  status: 'scheduled',
  createdAt: T0 - 3600_000,
  ...extra,
});

const scan = (tasks: ActiveMsg2TaskRecord[], messages: Message[], nowMs: number) =>
  scanDeferredCandidates(tasks, messages, nowMs, 48 * 3600_000);

describe('isDeferrable（谁要扫）', () => {
  it('强制发送 → 要扫', () => {
    expect(isDeferrable(task({ expirePolicy: 'force' }))).toBe(true);
  });

  it('遇忙作废 → 不扫（那条是"直接取消、不告诉角色"，判据在别处）', () => {
    expect(isDeferrable(task({ expirePolicy: 'expire' }))).toBe(false);
  });

  // 兜底的职责就是"这次不许再让一次"。扫它等于让后路也让路 = 提醒彻底消失。
  it('兜底任务 → 不扫（它是后路，让它也让路等于提醒没了）', () => {
    expect(isDeferrable(task({ mode: 'fixed', fallbackFor: 'c-main' }))).toBe(false);
  });

  it('已取消的 → 不扫', () => {
    expect(isDeferrable(task({ status: 'cancelled' }))).toBe(false);
  });
});

describe('shouldDeferOccurrence（新规则的判据：到点前 10 分钟）', () => {
  it('到点前 5 分钟用户说过话 → 该让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages: [userMsg(5)], lookbackMs: 48 * 3600_000,
    })).toBe(true);
  });

  it('到点前 10 分钟内（边界）→ 该让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN,
      messages: [userMsg(ACTIVE_CHAT_WINDOW_MS / MIN - 0.5)],
      lookbackMs: 48 * 3600_000,
    })).toBe(true);
  });

  // 这一条是新旧判据的真正分歧点。旧的循环任务看前后对称窗，会把这条判成该让开；
  // 新规则只有到点**前**那一半 —— 到点后用户才说话，那是"这次照发了、送达晚了"，
  // 不是"该让开"，拦掉它等于白扔一条已经该到的消息。
  it('到点**后**用户才说话 → 不让开（送达延迟，不是该让开）', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN,
      messages: [{ role: 'user', timestamp: T0 + 5 * MIN, metadata: null } as unknown as Message],
      lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });

  // 旧的一次性判据是"锚点之后有*任何*消息"，隔 3 小时说话也算。新规则只看 10 分钟。
  it('用户隔了 3 小时才说话 → 不让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 4 * 3600_000, messages: [userMsg(180)], lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });

  it('到点那一刻用户没说话 → 不让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages: [userMsg(30)], lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });

  // AI 主动消息不算"用户说过话"（isRealUserMessage 的口径）。
  it('只有 AI 的主动消息 → 不让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN,
      messages: [{ role: 'assistant', timestamp: T0 - 3 * MIN, metadata: null } as unknown as Message],
      lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });

  it('还没到点 → 不让开（那是未来的事）', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 - MIN, messages: [userMsg(5)], lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });

  it('太早（超出回看期）→ 不让开', () => {
    expect(shouldDeferOccurrence({
      occurrenceMs: T0, nowMs: T0 + 72 * 3600_000, messages: [userMsg(5)], lookbackMs: 48 * 3600_000,
    })).toBe(false);
  });
});

describe('scanDeferredCandidates（扫一轮产出什么）', () => {
  it('一次性：到点前说过话 → 出一条，id 用 taskUuid', () => {
    const out = scan([task()], [userMsg(5)], T0 + 30 * MIN);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('t-1');
    expect(out[0].occurrenceMs).toBe(T0);
  });

  it('一次性：没说过话 → 不产出', () => {
    expect(scan([task()], [userMsg(30)], T0 + 30 * MIN)).toHaveLength(0);
  });

  it('循环：每次触发单独判、单独产出，id 带触发时刻', () => {
    // 每天 8:00，回看期 48h，所以只有 T0 和 T0+24h 两次落在窗内
    // （T0+48h 那次离 now 正好 48h 再加 30 分钟，已被 lookback 截掉——这是对的，
    //  台账也只留 48h，扫出更早的没人会看）。
    const now = T0 + 24 * 3600_000 + 30 * MIN;
    const out = scan(
      [task({ recurrenceType: 'daily' })],
      [userMsg(5, T0), userMsg(5, T0 + 24 * 3600_000)],
      now,
    );
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.occurrenceMs)).toEqual([T0, T0 + 24 * 3600_000]);
    // 循环的 id 必须带 occurrence，否则两次触发会互相覆盖成一条
    expect(new Set(out.map((c) => c.id)).size).toBe(2);
    expect(out[1].id).toBe(`t-1:${T0 + 24 * 3600_000}`);
  });

  // 循环任务里只有一次该让开，就只产那一次 —— 不能因为别的周期撞上了消息就整条
  // 都算成"该推迟"，那会让角色在下一轮里把三天的事一口气说出来。
  it('循环：只有撞上对话的那一次产出', () => {
    const out = scan(
      [task({ recurrenceType: 'daily' })],
      [userMsg(60, T0), userMsg(5, T0 + 24 * 3600_000)],
      T0 + 24 * 3600_000 + 30 * MIN,
    );
    expect(out).toHaveLength(1);
    expect(out[0].occurrenceMs).toBe(T0 + 24 * 3600_000);
  });

  it('扫到 0 条不报错（没任务是常态）', () => {
    expect(scan([], [], T0)).toEqual([]);
  });
});

describe('shouldHavePushed（面板上「该推送却没来」）', () => {
  // 这两个判据必须严格互为反面：改一处不改另一处，用户会看到"本来该推送"
  // 却什么都没来的自相矛盾。
  it('到点前说过话 → 不该推送（该让开）', () => {
    expect(shouldHavePushed({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages: [userMsg(5)],
    })).toBe(false);
  });

  it('到点前没说话 → 该推送', () => {
    expect(shouldHavePushed({
      occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages: [userMsg(30)],
    })).toBe(true);
  });

  it('还没到点 → 不该推送（还没到，说不上没来）', () => {
    expect(shouldHavePushed({ occurrenceMs: T0, nowMs: T0 - MIN, messages: [] })).toBe(false);
  });

  it('两个判据在同一条输入上永远给出相反答案', () => {
    const cases: Message[][] = [[], [userMsg(5)], [userMsg(30)], [userMsg(1)]];
    for (const messages of cases) {
      const deferred = shouldDeferOccurrence({
        occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages, lookbackMs: 48 * 3600_000,
      });
      const pushed = shouldHavePushed({ occurrenceMs: T0, nowMs: T0 + 30 * MIN, messages });
      expect(deferred).toBe(!pushed);
    }
  });
});
