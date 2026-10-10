// utils/amsg2TaskContext.test.ts
/**
 * 回执文案测试（麦麦 2026-09-30）。
 *
 * 这段文案唯一的消费者是角色——它照着这几段决定「这轮顺口带出来」还是「别提了」。
 * 两种动作是相反的，一旦混在一段里，模型会随便挑一条，于是新规则里"改在对话里
 * 自然带出"这件事就落空了。所以这里锁的是**段落必须分开**这件事，不锁具体措辞。
 */
import { describe, it, expect } from 'vitest';
import { buildAmsg2NoticesText } from './amsg2TaskContext';
import type { Amsg2ExpiredNoticeRecord } from '../types';

const notice = (
  kind: Amsg2ExpiredNoticeRecord['kind'],
  extra: Partial<Amsg2ExpiredNoticeRecord> = {},
): Amsg2ExpiredNoticeRecord => ({
  id: `aaaaaaaa-0000-0000-0000-00000000000${kind === 'expired' ? 1 : 2}`,
  charId: 'char-1',
  occurrenceMs: Date.parse('2026-09-30T08:00:00Z'),
  mode: 'auto',
  recurrenceType: 'none',
  kind,
  createdAt: Date.now(),
  ...extra,
});

const text = (kinds: Amsg2ExpiredNoticeRecord['kind'][]) =>
  buildAmsg2NoticesText(kinds.map((k) => notice(k)), 'Asia/Shanghai') ?? '';

describe('buildAmsg2NoticesText：回执分段', () => {
  it('没有回执时整块不出现（不占 prompt 位置）', () => {
    expect(buildAmsg2NoticesText([], 'Asia/Shanghai')).toBeNull();
  });

  // 遇忙作废（kind='expired'）刻意不产段：新规则里它是「直接取消、不告诉角色」。
  // 告诉角色等于让它在对话里复述"我有条消息被系统取消了"——那是把系统内部动作
  // 漏给用户看。它只留面板。
  it('遇忙作废不进角色上下文（新规则：直接取消、不告诉角色）', () => {
    const out = text(['expired']);
    expect(out).toBe('');
  });

  it('混着来时，遇忙作废那一段也不出现，其余照常', () => {
    const out = text(['deferred', 'expired', 'quota-blocked', 'user-cancelled']);
    expect(out).toContain('已推迟');
    expect(out).toContain('没发出去');
    expect(out).toContain('已被手动取消');
    expect(out).not.toContain('已作废');
    // 也不能因为滤掉一段就顺带漏了任务编号（行是过滤的，编号是每段自己拼的）
    expect(out.match(/\[aaaaaaaa\]/g) ?? []).toHaveLength(3);
  });

  // 推迟段不能夹带「作废」那套动作：作废是三选一（续期/放弃），推迟是这轮顺口说出来。
  // 混在一段里模型会挑它更顺手的那个挑，于是"改在对话里自然带出"整个落空。
  it('推迟段只说这轮顺口带出来，不夹带作废那套三选一', () => {
    const out = text(['deferred']);
    expect(out).toContain('已推迟');
    expect(out).toContain('顺着带一句');
    expect(out).not.toContain('renew_active_message');
    expect(out).not.toContain('三选一');
  });

  // 名额满跟作废是两回事：内容是真的想说，只是没轮上。告诉角色"作废"它会当成
  // 对方不想听，从此不再提——而额度明天就恢复了。
  it('名额满段说清"内容是真想说的"，别让角色当成被拒绝', () => {
    const out = text(['quota-blocked']);
    expect(out).toContain('额度');
    expect(out).toContain('renew_active_message');
    // 这句是整段的关键：它拦住"额度满了 = 对方不想听 = 我以后不提了"这个误读。
    expect(out).toContain('真的想对用户说的');
    expect(out).toContain('别当成对方不想听');
  });

  it('只有一种时只出现那一段', () => {
    expect(text(['deferred'])).not.toContain('已作废');
    expect(text(['user-cancelled'])).not.toContain('已推迟');
  });

  // 老记录没写 kind —— 它当年就是"遇忙作废"，按新规则同样不进角色上下文。
  // 别在迁移的时候把它当成别的东西，那会让一条从没有过的回执凭空冒出来。
  it('没有 kind 的老记录按遇忙作废处理，同样不注入', () => {
    const old = notice(undefined);
    expect(buildAmsg2NoticesText([old], 'Asia/Shanghai')).toBeNull();
  });

  it('每段都带上任务短编号和原定时间（角色要能对上自己排的是哪条）', () => {
    const out = text(['deferred']);
    expect(out).toContain('[aaaaaaaa]');
    expect(out).toContain('原定');
  });
});

/**
 * 「不注入」不等于「不记录」（麦麦 2026-09-30 暮色定的分工）。
 *
 * 遇忙作废这条：用户该知道自己排的东西为什么没响，所以它照旧落台账、面板照旧读得到；
 * 但它不告诉角色。哪天有人看到 buildNoticeSections 里没有 expired 那一段就顺手把
 * 产出路径也删了，这条测试就是拦这个的。
 */
describe('noticeKindForTask：产出与注入是两件事', () => {
  it('遇忙作废仍被识别为一种回执（面板据此显示"为什么没响"），只是不注入角色', async () => {
    const { noticeKindForTask } = await import('./amsg2Tasks');
    const t = {
      taskUuid: 'u-1', clientTaskId: 'c-1', mode: 'auto' as const,
      firstSendTime: new Date().toISOString(), recurrenceType: 'none' as const,
      expirePolicy: 'expire' as const, source: 'user' as const,
      status: 'scheduled' as const, createdAt: Date.now(),
    };
    // 产出侧认它
    expect(noticeKindForTask(t)).toBe('expired');
    // 注入侧滤掉它
    const out = buildAmsg2NoticesText([notice('expired')], 'Asia/Shanghai');
    expect(out).toBeNull();
  });
});
