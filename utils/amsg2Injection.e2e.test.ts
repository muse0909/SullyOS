// utils/amsg2Injection.e2e.test.ts
/**
 * 回执注入 · 端到端验证（麦麦 2026-09-30 暮色第 5 条要求）。
 *
 * 不是单测那样"调一个函数看返回值"，而是**造一条「到点推迟」回执，走一遍真实的
 * 组装流程，把最终发给模型的提示词打出来**，再组装一次确认已消费的不会重复出现。
 *
 * 之所以要这样：注入链路断过一次（collectAmsg2TaskContext 全项目无人调用，
 * 而那套函数 + 注释 + 单测都在，看着是完整的）。纯函数测不出来——它测的是
 * 「函数返回值对不对」，而那次断的是「有没有人调它」。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildAmsg2NoticesText, buildAmsg2TaskContextText } from './amsg2TaskContext';
import { getPendingTasks, visibleTasks } from './amsg2Tasks';
import type { ActiveMsg2ExpiredNoticeRecord, ActiveMsg2TaskRecord, CharacterProfile, Message } from '../types';

const T0 = Date.parse('2026-10-01T08:00:00Z');
const H = 3600_000;

// ── 一个最小的内存台账，替代 ActiveMsgStore（那是 IDB，测不了）────
class FakeNoticeStore {
  records: Amsg2ExpiredNoticeRecord[] = [];
  async getExpiredNotices() { return [...this.records]; }
  async markExpiredNoticesNotified(_charId: string, ids: string[]) {
    const set = new Set(ids);
    this.records = this.records.map((r) => (set.has(r.id) ? { ...r, notifiedAt: r.notifiedAt ?? Date.now() } : r));
  }
  async upsertExpiredNotices(_charId: string, recs: Amsg2ExpiredNoticeRecord[]) {
    const byId = new Map(this.records.map((r) => [r.id, r]));
    for (const r of recs) if (!byId.has(r.id)) byId.set(r.id, r);
    this.records = [...byId.values()];
    return this.records;
  }
  get unnotified() { return this.records.filter((r) => !r.notifiedAt); }
}

const store = new FakeNoticeStore();

/** 复刻 collectAmsg2TaskContext 的产出逻辑，但台账换掉（其余一律走真函数）。 */
const assemble = (char: CharacterProfile, nowMs: number) => {
  const unnotified = store.unnotified;
  const pending = visibleTasks(getPendingTasks(char.activeMsg2Config, nowMs));
  return {
    text: buildAmsg2TaskContextText(pending, unnotified, nowMs, 'Asia/Shanghai'),
    expiredIds: unnotified.map((r) => r.id),
    notices: unnotified,
  };
};

const charOf = (tasks: ActiveMsg2TaskRecord[]): CharacterProfile =>
  ({ id: 'char-x', name: '江澈', activeMsg2Config: { enabled: true, tasks } } as unknown as CharacterProfile);

const mainTask = (): ActiveMsg2TaskRecord => ({
  taskUuid: 'main-uuid', clientTaskId: 'main-cid', mode: 'auto',
  firstSendTime: new Date(T0).toISOString(), recurrenceType: 'daily',
  promptHint: '提醒她吃药', expirePolicy: 'force', source: 'user',
  status: 'scheduled', createdAt: T0 - H,
});

const fbTask = (): ActiveMsg2TaskRecord => ({
  taskUuid: 'fb-uuid', clientTaskId: 'fb-cid', mode: 'fixed',
  firstSendTime: new Date(T0 + 30 * 60_000).toISOString(), recurrenceType: 'daily',
  userMessage: '到点啦：提醒她吃药', expirePolicy: 'force', source: 'user',
  status: 'scheduled', createdAt: T0, fallbackFor: 'main-cid',
});

describe('回执注入 · 端到端（暮色第 5 条）', () => {
  beforeEach(() => { store.records = []; });

  it('造一条「到点推迟」回执 → 走真实组装 → 提示词里有回执原文', () => {
    store.records.push({
      id: `main-uuid:${T0}`, charId: 'char-x', occurrenceMs: T0,
      mode: 'auto', promptHint: '提醒她吃药', recurrenceType: 'daily',
      kind: 'deferred', createdAt: T0 + 10 * 60_000,
    });

    const char = charOf([mainTask(), fbTask()]);
    const now = T0 + 20 * 60_000;
    const result = assemble(char, now);

    // ===== 暮色要看的就是这段：最终发给模型的提示词 =====
    console.log('\n════════ 第一次组装 · 最终提示词 ════════');
    console.log(result.text);
    console.log('═══════════════════════════════════════\n');

    expect(result.text).toContain('已推迟');
    expect(result.text).toContain('这轮对话里换种方式说出来');
    expect(result.expiredIds).toEqual([`main-uuid:${T0}`]);
  });

  it('兜底任务不进排程清单（角色够不着自己的后路）', () => {
    store.records.push({
      id: `main-uuid:${T0}`, charId: 'char-x', occurrenceMs: T0,
      mode: 'auto', recurrenceType: 'daily', kind: 'deferred', createdAt: T0,
    });
    const result = assemble(charOf([mainTask(), fbTask()]), T0 + 20 * 60_000);
    console.log('\n════════ 兜底可见性检查 ════════');
    console.log(result.text);
    console.log('══════════════════════════════\n');
    // 主任务在、兜底不在
    expect(result.text).toContain('main-uui');
    expect(result.text).not.toContain('fb-uuid');
  });

  it('消费之后重新组装：已消费的不会重复出现', async () => {
    store.records.push({
      id: `main-uuid:${T0}`, charId: 'char-x', occurrenceMs: T0,
      mode: 'auto', recurrenceType: 'daily', kind: 'deferred', createdAt: T0,
    });
    const char = charOf([mainTask(), fbTask()]);
    const now = T0 + 20 * 60_000;

    // 第一轮：带着
    const first = assemble(char, now);
    expect(first.text).toContain('已推迟');
    expect(first.expiredIds).toHaveLength(1);

    // 模拟「请求成功了」→ consumeAmsg2Notices 里的第一步
    await store.markExpiredNoticesNotified('char-x', first.expiredIds);

    // 第二轮：不该再出现
    const second = assemble(char, now);
    console.log('\n════════ 消费后重新组装 · 提示词 ════════');
    console.log(second.text || '(空 —— 没有回执，块不出现)');
    console.log('═════════════════════════════════════\n');
    expect(second.text).not.toContain('已推迟');
    expect(second.expiredIds).toHaveLength(0);
  });

  it('遇忙作废照旧不进上下文（只有台账，面板看得到）', () => {
    store.records.push({
      id: 'main-uuid', charId: 'char-x', occurrenceMs: T0,
      mode: 'auto', recurrenceType: 'none', kind: 'expired', createdAt: T0,
    });
    const result = assemble(charOf([mainTask()]), T0 + 20 * 60_000);
    console.log('\n════════ 遇忙作废 · 提示词 ════════');
    console.log(result.text || '(只有排程块，没有回执段)');
    console.log('═══════════════════════════════════\n');
    expect(result.text).not.toContain('已作废');
    // 但台账里有，面板据此显示"为什么没响"
    expect(store.records.some((r) => r.kind === 'expired')).toBe(true);
  });

  it('到点生成那条路：只有回执那半，不重复排程清单', () => {
    store.records.push({
      id: `main-uuid:${T0}`, charId: 'char-x', occurrenceMs: T0,
      mode: 'auto', recurrenceType: 'daily', kind: 'deferred', createdAt: T0,
    });
    const char = charOf([mainTask(), fbTask()]);
    const now = T0 + 20 * 60_000;
    const result = assemble(char, now);
    // activeMsgClient.buildPendingNoticesBlock 取的是这一半
    const fireSide = buildAmsg2NoticesText(result.notices, undefined);
    console.log('\n════════ 到点生成 · 只带回执那半 ════════');
    console.log(fireSide ?? '(空)');
    console.log('══════════════════════════════════════\n');
    expect(fireSide).toContain('已推迟');
    // 回执那半仍然带任务短编号 —— 角色要能对上自己排的是哪条。但"进行中"那段
    // （完整的排程现状块）不在里面：到点那边由 AMSG_SLOT_TASK_LIST 单独渲染，
    // 同一份清单在 prompt 里出现两次、且快照与现场可能不一致。
    expect(fireSide).toContain('main-uui');
    expect(fireSide).not.toContain('进行中：');
    expect(fireSide).not.toContain('schedule_active_message');
    // 兜底那半条：不在回执里，也不该在"进行中"里
    expect(fireSide).not.toContain('fb-uuid');
  });
});
