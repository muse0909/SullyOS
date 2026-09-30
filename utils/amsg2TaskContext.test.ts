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

  it('四种类型各占一段，互不混说', () => {
    const out = text(['deferred', 'expired', 'quota-blocked', 'user-cancelled']);
    expect(out).toContain('已推迟');
    expect(out).toContain('已作废');
    expect(out).toContain('没发出去');
    expect(out).toContain('已被手动取消');
  });

  // 这两段挨在一起最危险：「推迟」的意思是这轮自然带出来，「作废」是别提了。
  // 模型读到一段里就会挑一个它更顺手的挑。
  it('推迟段和作废段必须分开，且各自说清要做什么', () => {
    const out = text(['deferred', 'expired']);
    const deferredAt = out.indexOf('已推迟');
    const expiredAt = out.indexOf('已作废');
    expect(deferredAt).toBeGreaterThanOrEqual(0);
    expect(expiredAt).toBeGreaterThan(deferredAt);
    // 推迟 = 这轮顺口说出来；作废 = 三选一。别把两个动作塞进同一段。
    expect(out.slice(deferredAt, expiredAt)).toContain('顺着带一句');
    expect(out.slice(deferredAt, expiredAt)).not.toContain('renew_active_message');
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
    expect(text(['expired'])).not.toContain('已推迟');
    expect(text(['user-cancelled'])).not.toContain('已作废');
  });

  // 老记录没写 kind（存的时候这个字段还不存在），按作废读是对的：它当年就是作废。
  it('没有 kind 的老记录按「已作废」处理', () => {
    const old = notice(undefined);
    const out = buildAmsg2NoticesText([old], 'Asia/Shanghai') ?? '';
    expect(out).toContain('已作废');
    expect(out).not.toContain('已推迟');
  });

  it('每段都带上任务短编号和原定时间（角色要能对上自己排的是哪条）', () => {
    const out = text(['deferred']);
    expect(out).toContain('[aaaaaaaa]');
    expect(out).toContain('原定');
  });
});
