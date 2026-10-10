// utils/amsg2ExpireGuard.test.ts
/**
 * 「这次到点该不该让开」这套判据的测试（麦麦 2026-10-02）。
 *
 * ## 为什么这份测试比别的都较真
 *
 * 这套判据有**两个执行者**：云端到点时判一次（决定推不推），客户端回看期扫一次
 * （决定面板说没说）。两边一旦漂了，面板就会当着用户的面说一套、角色实际收的是另一套，
 * 而且这种错不报错、只在真机上偶尔冒出来一次。
 *
 * 所以这里钉的不是"某个函数返回 true"，而是**逐条对着线上代码抄下来的判据**。抄的
 * 时候对着 `worker.bundle.js` 第 8889-8899 行（sha256 前 12 位 `3bcc8e259345`，
 * worker 自报 2026-10-01.2）逐行核的，抄完把原文贴在 `utils/amsg2ExpireGuard.ts`
 * 的文件头。
 *
 * 改这份测试之前先想清楚：你是在改客户端，还是在改云端？后者的话先改云端再回来同步。
 */
import { describe, it, expect } from 'vitest';

import {
  ACTIVE_CHAT_WINDOW_MS,
  detectExpiredOccurrences,
  occurrenceIsExpired,
  shouldExpireFire,
} from './amsg2ExpireGuard';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 到点时刻固定在 2026-10-02 08:00 本地时间轴上的某一刻，后面全部相对它算。 */
const T0 = Date.UTC(2026, 9, 2, 8, 0, 0);

type Msg = { role: string; timestamp: number; metadata?: Record<string, unknown> | null };

const userAt = (offsetMs: number): Msg => ({ role: 'user', timestamp: T0 + offsetMs });

/** AI 自己主动发的那条不算——「真实用户消息」的定义与 buildTimeGapHint 共用同一叶子 helper。 */
const assistantAt = (offsetMs: number): Msg => ({ role: 'assistant', timestamp: T0 + offsetMs });

/** 云端 `laterOf(pack, presence)` 算出来的是「全局最后一条真实用户消息」，只取一条。 */
const lastUser = (...offsets: number[]): Msg[] => offsets.map(userAt);

describe('occurrenceIsExpired — 跟云端 shouldExpireFire 逐条对应', () => {
  it('到点前 10 分钟内说过话 → 作废', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 - 9 * MIN,
      occurrenceMs: T0,
      nowMs: T0,
    })).toBe(true);
  });

  it('差一毫秒也在窗内（用的是 `>` 不是 `>=`）', () => {
    // 云端原文：last > occurrenceMs - ACTIVE_CHAT_WINDOW_MS
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 - ACTIVE_CHAT_WINDOW_MS - 1,
      occurrenceMs: T0,
      nowMs: T0,
    })).toBe(false);
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 - ACTIVE_CHAT_WINDOW_MS + 1,
      occurrenceMs: T0,
      nowMs: T0,
    })).toBe(true);
  });

  it('到点前 11 分钟说过话 → 不作废（窗是有边的）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 - 11 * MIN,
      occurrenceMs: T0,
      nowMs: T0,
    })).toBe(false);
  });

  // 这条是 step 11 那个 bug 的核心：老版本一次性任务判「锚点之后有任何消息就作废」，
  // 没有时间上限。用户早上收到消息、晚上十点随口回一句，那条早安就被吞了。
  it('到点后很久才说话 → 不作废（老锚点规则会作废，这是回归钉子）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + 5 * HOUR,
      occurrenceMs: T0,
      nowMs: T0 + 5 * HOUR,
    })).toBe(false);
  });

  it('从没说过话 → 不作废（last == null 一律放行）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: null,
      occurrenceMs: T0,
      nowMs: T0,
    })).toBe(false);
  });

  it('缺触发时刻 → 不作废（判不了就放行，不误杀）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0,
      occurrenceMs: null,
      nowMs: T0,
    })).toBe(false);
  });

  // `+10min` 那半边看着像「到点后也算」，实际上被 `last <= nowMs` 夹住。
  // 准时 fire 时 nowMs ≈ occurrenceMs，于是那半边永远不生效。
  it('准时 fire：到点后说话的那条已经在 nowMs 之后，判不了，不作废', () => {
    // 注意 nowMs 必须严格小于那条消息的时间才成立——fire 是在到点那一刻跑完的，
    // 用户在它之后说的话云端根本还看不见。
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + 5 * MIN,
      occurrenceMs: T0,
      nowMs: T0,          // fire 准点跑完
    })).toBe(false);
  });

  // 上面的反面：fire 延迟了的话，到点后、判定前说的话会被算进去。
  // ⚠️ 实测**延迟上限约 60 秒**（cron `* * * * *` 一跳一分钟，捞任务的条件是
  // `next_send_at <= now`），所以现实中只可能覆盖到点后那一分钟上下。
  // 下面 3 分钟 / 20 分钟两个值是**把判据边界钉死**——真机跑不到那么久，但改错了
  // 总得有人逮得住（删掉 `+10min` 那道上界，这两条就会红）。
  it('fire 延迟时：到点后、判定前说的话算进去（延迟 3 分钟）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + 2 * MIN,
      occurrenceMs: T0,
      nowMs: T0 + 3 * MIN,   // fire 晚了 3 分钟
    })).toBe(true);
  });

  it('fire 延迟超过 10 分钟：到点后 15 分钟的那条被上界挡掉', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + 15 * MIN,
      occurrenceMs: T0,
      nowMs: T0 + 20 * MIN,
    })).toBe(false);
  });

  // 把「现实中真会发生的那个量级」单独钉一条，别让上面两条把它盖过去。
  it('现实中真会发生的量级：延迟 60 秒、到点后 30 秒说话 → 算进去', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + 30_000,
      occurrenceMs: T0,
      nowMs: T0 + 60_000,
    })).toBe(true);
  });

  it('last 晚于判定时刻 → 不作废（`last <= nowMs` 那一条真的在挡东西）', () => {
    expect(occurrenceIsExpired({
      lastUserMessageAt: T0 + MIN,
      occurrenceMs: T0,
      nowMs: T0 - MIN,
    })).toBe(false);
  });
});

describe('shouldExpireFire — 策略不是 expire 就放行，其余全部转交 occurrenceIsExpired', () => {
  it('policy 不是 expire → 恒放行', () => {
    const inside = { lastUserMessageAt: T0 - MIN, occurrenceMs: T0, nowMs: T0 };
    expect(shouldExpireFire({ policy: 'force', ...inside })).toBe(false);
    expect(shouldExpireFire({ policy: undefined, ...inside })).toBe(false);
  });

  it('policy 是 expire 时，逐条等价于 occurrenceIsExpired', () => {
    // 两条判据不许分叉：分叉了面板就会说另一套。
    const cases: Array<{ lastUserMessageAt: number | null; occurrenceMs: number | null; nowMs: number }> = [
      { lastUserMessageAt: T0 - 9 * MIN, occurrenceMs: T0, nowMs: T0 },
      { lastUserMessageAt: T0 - 11 * MIN, occurrenceMs: T0, nowMs: T0 },
      { lastUserMessageAt: T0 + 5 * HOUR, occurrenceMs: T0, nowMs: T0 + 5 * HOUR },
      { lastUserMessageAt: null, occurrenceMs: T0, nowMs: T0 },
      { lastUserMessageAt: T0, occurrenceMs: null, nowMs: T0 },
    ];
    for (const c of cases) {
      expect(shouldExpireFire({ policy: 'expire', ...c }))
        .toBe(occurrenceIsExpired(c));
    }
  });
});

describe('detectExpiredOccurrences — 面板检出必须跟推送同一个答案', () => {
  const base = {
    taskUuid: 'task-1',
    policy: 'expire',
    firstSendTime: new Date(T0).toISOString(),
  };

  it('一次性任务：到点前 10 分钟说过话 → 产出一条（老版本压根产不出）', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'none',
      messages: lastUser(-5 * MIN),
      nowMs: T0 + MIN,
    });
    // 回归点：老实现要求 anchorMs，而调用方从不传，一次性任务在这里恒返回 []。
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ id: 'task-1', occurrenceMs: T0 });
  });

  it('一次性任务：到点后 5 小时才说话 → 不产出（老锚点规则会产出）', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'none',
      messages: lastUser(5 * HOUR),
      nowMs: T0 + 5 * HOUR,
    });
    expect(out).toEqual([]);
  });

  it('一次性任务：到点前 11 分钟说话 → 不产出', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'none',
      messages: lastUser(-11 * MIN),
      nowMs: T0 + MIN,
    });
    expect(out).toEqual([]);
  });

  it('每天任务：只产出落在窗内的那几格，id 带 occurrence', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'daily',
      // 三天，每天各自在触发前 5 / 9 / 20 分钟说过话 → 前两天命中、第三天不命中。
      // 刻意排成「越往后越远」：这样如果实现偷懒取全局最后一条（= 第三天那条），
      // 前两格会被一起误伤，测试立刻红。
      //
      // nowMs 定在第三天触发前 5 分钟：再晚的话 48h 回看期会把第一格切掉（那是另一个
      // 行为，下面单独有测试钉着），这里只想验「三格里哪几格命中」。
      messages: lastUser(-5 * MIN, DAY - 9 * MIN, 2 * DAY - 20 * MIN),
      nowMs: T0 + 2 * DAY - 5 * MIN,
    });
    expect(out.map((o) => o.occurrenceMs)).toEqual([T0, T0 + DAY]);
    expect(out[0].id).toBe(`task-1:${T0}`);
  });

  it('每天任务：AI 自己发的不算', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'daily',
      messages: [assistantAt(-MIN)],
      nowMs: T0 + MIN,
    });
    expect(out).toEqual([]);
  });

  // 逐格取「当时那一条」，不是全局那一条。这条是本文件最容易写错的地方：
  // 用户在 T0+15 分说了话，**不该**让 T0 那一格跟着被判成作废——
  // 云端准点在 T0 跑的时候，+T0+15 那句话根本还不存在。
  it('每天任务：后续某次触发之后说的话，不会误伤更早那一格', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'daily',
      messages: lastUser(-5 * MIN, 15 * MIN),
      nowMs: T0 + 20 * MIN,
    });
    expect(out.map((o) => o.occurrenceMs)).toEqual([T0]);
  });

  it('每天任务：那次触发之前根本没说过话 → 不命中', () => {
    // 唯一一条消息在该次触发之后，本格不能看见它。
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'daily',
      messages: lastUser(3 * MIN),
      nowMs: T0 + 20 * MIN,
    });
    expect(out).toEqual([]);
  });

  it('force 也走同一套判据（到点被让开的强制发送要有 id，面板才能把措辞分开）', () => {
    const on = detectExpiredOccurrences({
      ...base, policy: 'force', recurrenceType: 'none',
      messages: lastUser(-5 * MIN), nowMs: T0 + MIN,
    });
    const off = detectExpiredOccurrences({
      ...base, policy: 'force', recurrenceType: 'none',
      messages: lastUser(-20 * MIN), nowMs: T0 + MIN,
    });
    expect(on).toHaveLength(1);
    expect(off).toEqual([]);
  });

  it('策略既不是 expire 也不是 force → 一条都不产', () => {
    const out = detectExpiredOccurrences({
      ...base, policy: undefined, recurrenceType: 'daily',
      messages: lastUser(-MIN), nowMs: T0 + MIN,
    });
    expect(out).toEqual([]);
  });

  it('回看期外的老触发不产（不无限往前翻）', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'none',
      messages: lastUser(-5 * MIN),
      nowMs: T0 + 5 * DAY,      // 远超 48h 默认回看期
      lookbackMs: 48 * HOUR,
    });
    expect(out).toEqual([]);
  });

  it('还没到的任务不产', () => {
    const out = detectExpiredOccurrences({
      ...base,
      recurrenceType: 'none',
      messages: lastUser(-5 * MIN),
      nowMs: T0 - 10 * MIN,
    });
    expect(out).toEqual([]);
  });

  it('firstSendTime 解析不出来 → 静默返回空（不抛）', () => {
    const out = detectExpiredOccurrences({
      ...base, firstSendTime: '不是日期', recurrenceType: 'daily',
      messages: lastUser(-MIN), nowMs: T0,
    });
    expect(out).toEqual([]);
  });

  // 这条是整份文件存在的理由：检出与推送判据必须逐格同答。
  it('同一个输入，检出结果与 occurrenceIsExpired 逐格同答', () => {
    const messages = lastUser(-5 * MIN);
    const out = detectExpiredOccurrences({
      ...base, recurrenceType: 'daily', messages, nowMs: T0 + 2 * MIN,
    });
    const last = messages[messages.length - 1].timestamp;
    for (const o of out) {
      expect(occurrenceIsExpired({
        lastUserMessageAt: last,
        occurrenceMs: o.occurrenceMs,
        nowMs: T0 + 2 * MIN,
      })).toBe(true);
    }
  });
});
