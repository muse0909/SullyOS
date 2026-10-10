// utils/amsg2MissedSummary.test.ts
/**
 * 「最近没响」那张卡的合并逻辑测试（麦麦 2026-10-01 step 8）。
 *
 * 这一层出错的后果是**用户被同一件事告知两次**（云端记一条、客户端记一条），
 * 或者更糟：把"顺口带出来了"显示成"取消了"，用户以为消息又被吞了，转头去查对话。
 * 所以下面每条都盯住去重和四种 kind 的措辞差异。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildMissedSummary,
  isAfterDismissal,
  readDismissedAt,
  writeDismissedAt,
} from './amsg2MissedSummary';
import type { Amsg2ExpiredNoticeRecord } from '../types';
import type { AmsgLastSkip } from './amsgFirePack';

const MIN = 60_000;
const T0 = Date.parse('2026-10-01T08:00:00Z');

const notice = (
  kind: NonNullable<Amsg2ExpiredNoticeRecord['kind']>,
  occurrenceMs: number,
  id = `n-${kind}-${occurrenceMs}`,
): Amsg2ExpiredNoticeRecord => ({
  id,
  charId: 'c1',
  occurrenceMs,
  mode: 'auto',
  recurrenceType: 'none',
  kind,
  createdAt: occurrenceMs,
});

const skip = (extra: Partial<AmsgLastSkip> = {}): AmsgLastSkip => ({
  v: 1,
  taskUuid: 't-1',
  occurrenceMs: T0,
  reason: 'daily-limit',
  skippedAt: T0,
  ...extra,
});

describe('buildMissedSummary — 云端那条', () => {
  it('没有 lastSkip、没有台账 → 空（面板什么都不显示）', () => {
    expect(buildMissedSummary({ lastSkip: null, notices: [] })).toEqual([]);
  });

  it('有 lastSkip → 显示一条，标成云端说的', () => {
    const out = buildMissedSummary({ lastSkip: skip(), notices: [] });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('cloud');
    expect(out[0].text).toContain('到上限');
  });
});

describe('buildMissedSummary — 本地台账那四种', () => {
  it('四种都出得来，而且措辞不能串（这是最要紧的一条）', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: [
        notice('expired', T0 - 4 * 24 * 3600_000),
        notice('deferred', T0 - 3 * 24 * 3600_000),
        notice('quota-blocked', T0 - 2 * 24 * 3600_000),
        notice('user-cancelled', T0 - 24 * 3600_000),
      ],
    });
    expect(out).toHaveLength(4);
    const byKind = new Map(out.map((e) => [e.occurrenceMs, e.text]));
    // 遇忙作废：取消了，不会出现在聊天里
    expect(byKind.get(T0 - 4 * 24 * 3600_000)).toContain('取消');
    expect(byKind.get(T0 - 4 * 24 * 3600_000)).not.toContain('顺口带出');
    // 到点推迟：**会**在聊天里出现。写成"取消了"用户会以为又被吞了。
    expect(byKind.get(T0 - 3 * 24 * 3600_000)).toContain('顺口带出');
    // 名额满：不是时机不对，是没轮上
    expect(byKind.get(T0 - 2 * 24 * 3600_000)).toContain('次数用完');
    // 你自己删的
    expect(byKind.get(T0 - 24 * 3600_000)).toContain('你自己');
  });

  // 老记录没有 kind 字段（见 Amsg2ExpiredNoticeRecord 注释），按 expired 读。
  it('老记录没写 kind → 当遇忙作废读，不崩', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: [{ id: 'old', charId: 'c1', occurrenceMs: T0, mode: 'auto', recurrenceType: 'none', createdAt: T0 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('取消');
  });

  it('按时间倒序', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: [notice('expired', T0 - 2 * MIN), notice('deferred', T0 - MIN)],
    });
    expect(out.map((e) => e.occurrenceMs)).toEqual([T0 - MIN, T0 - 2 * MIN]);
  });

  it('只留最近 6 条', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: Array.from({ length: 12 }, (_, i) => notice('expired', T0 - i * MIN)),
    });
    expect(out).toHaveLength(6);
    expect(out[0].occurrenceMs).toBe(T0);
  });
});

describe('buildMissedSummary — 跟任务行上去重', () => {
  // 强制发送到点被云端 expire 拦下时，客户端会同时写一条 deferred。同一次触发
  // 两个来源各记一条，两张都显示用户会以为出了两次岔子。
  it('任务行上已经说过的 → 这张卡里不再重复', () => {
    const out = buildMissedSummary({
      lastSkip: skip(),
      notices: [notice('deferred', T0)],
      coveredOccurrences: [T0],
    });
    expect(out).toEqual([]);
  });

  // 云端 fire 跟到点时刻本身能差一两分钟，容差要给够。
  it('差一分钟也算同一件事（云端 fire 会比到点晚）', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: [notice('deferred', T0 + MIN)],
      coveredOccurrences: [T0],
    });
    expect(out).toEqual([]);
  });

  it('差了半小时就是两件事，都要显示', () => {
    const out = buildMissedSummary({
      lastSkip: null,
      notices: [notice('deferred', T0 + 30 * MIN)],
      coveredOccurrences: [T0],
    });
    expect(out).toHaveLength(1);
  });

  it('没传 coveredOccurrences（调用方没接 step 6）→ 全部显示，不静默丢', () => {
    const out = buildMissedSummary({ lastSkip: skip(), notices: [notice('deferred', T0)] });
    expect(out).toHaveLength(2);
  });
});

describe('已看过的时间水位线', () => {
  /** 最小可用的 localStorage 假身（项目里测存储的通用写法，见 chatPresenceStorage.test.ts）。 */
  const stubStorage = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (map.has(k) ? map.get(k) : null),
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => { map.clear(); },
      key: (i: number) => [...map.keys()][i] ?? null,
      length: map.size,
    } as unknown as Storage);
  };

  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('没看过 → 水位线 0，所有条目都显示', () => {
    expect(readDismissedAt('c1')).toBe(0);
    expect(isAfterDismissal(T0, 0)).toBe(true);
  });

  it('看完关掉 → 之前的都不再显示', () => {
    writeDismissedAt('c1', T0);
    expect(isAfterDismissal(T0, readDismissedAt('c1'))).toBe(false);
    expect(isAfterDismissal(T0 + MIN, readDismissedAt('c1'))).toBe(true);
  });

  // 连着点两次"知道了"：第二次不能把水位线退回去让旧条目又冒出来。
  it('水位线只前进不后退', () => {
    writeDismissedAt('c1', T0);
    writeDismissedAt('c1', T0 - 5 * MIN);
    expect(readDismissedAt('c1')).toBe(T0);
  });

  it('不同角色各记各的', () => {
    writeDismissedAt('c1', T0);
    expect(readDismissedAt('c2')).toBe(0);
  });

  it('localStorage 读坏了当 0（顶多多显示一次，不能崩面板）', () => {
    vi.stubGlobal('localStorage', { getItem: () => '不是数字', setItem: () => {} } as unknown as Storage);
    expect(readDismissedAt('c1')).toBe(0);
  });

  it('localStorage 写不进去不抛（隐私模式）', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded'); },
    } as unknown as Storage);
    expect(() => writeDismissedAt('c1', T0)).not.toThrow();
  });
});
