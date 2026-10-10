// utils/activeMsgClient.fireTemplate.test.ts
/**
 * buildFirePack 里「模板尾部谁最后」的判据测试（麦麦 2026-10-02，暮色定：钢印放最后）。
 *
 * ## 为什么这条值得单独立一个测试
 *
 * 「回到你自己」钢印是 recency 末位人声锚，它靠**最后一眼**起作用。模板尾部任何东西
 * 拼在它后面都会跟它抢那一眼 —— 而这个错已经犯过一次：早先回执块是挂在钢印**后面**
 * 的（当时的理由是"拼尾巴比新加槽位简单"，槽位那半句是对的，位置那半句是错的）。
 *
 * 后果不报错、只是悄悄变差：主动消息更容易滑回均值腔。所以这里拿真实拼出来的模板
 * 逐行定位，不靠读源码断言（读源码那种测试，改个注释就假绿）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// buildFirePack 进去就要摸这三样：时间差提示（读聊天）、日程表、日程开关。
// 全是 IndexedDB 相关的，node 环境里没有 —— 这里换成定值，让断言只关心模板拼法。
vi.mock('./db', () => ({
  DB: {
    getRecentMessagesByCharId: vi.fn(async () => []),
    getCharacter: vi.fn(async () => null),
    getUserProfile: vi.fn(async () => null),
    getGroups: vi.fn(async () => []),
    getAllCharacters: vi.fn(async () => []),
    getEmojis: vi.fn(async () => []),
    getEmojiCategories: vi.fn(async () => []),
    getWorldBooks: vi.fn(async () => []),
    // buildSystemPrompt 那一串会挨个问；本文件只关心模板尾部，缺哪个补哪个成空值。
    getCharacterStatusPanel: vi.fn(async () => null),
    getMemories: vi.fn(async () => []),
    getMemoryRooms: vi.fn(async () => []),
    getDiaryEntries: vi.fn(async () => []),
    getEventBoxes: vi.fn(async () => []),
    getCharacterEvents: vi.fn(async () => []),
    getSchedule: vi.fn(async () => []),
    getMemos: vi.fn(async () => []),
    getWorldbook: vi.fn(async () => null),
  },
}));
vi.mock('./dailySchedule', () => ({ getDailyScheduleForChar: vi.fn(async () => null) }));
// 只把「日程总开关」摁成关的（省掉读作息表那条支路），其余导出照原样带进来。
// 不能整个 mock 掉：utils/context.ts 从这儿取 isEmotionOn，整 mock 会报「没有这个导出」。
vi.mock('./scheduleGenerator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./scheduleGenerator')>()),
  isScheduleFeatureOn: vi.fn(() => false),
}));
// 近史转写是重活（要扫整段聊天），这里给空的：模板尾部怎么拼跟它无关。
vi.mock('./chatContextRange', () => ({ loadCharacterContextMessages: vi.fn(async () => []) }));

import { buildFirePack } from './activeMsgClient';
import {
  AMSG_SLOT_CURRENT_TIME,
  AMSG_SLOT_TIME_SINCE_USER,
  AMSG_SLOT_AWAY_HINT,
  AMSG_SLOT_TASK_INSTRUCTION,
  AMSG_SLOT_USER_CLOCK,
  AMSG_SLOT_SELF_LOG,
  AMSG_SLOT_TASK_LIST,
  AMSG_SLOT_SCENE,
  AMSG_SLOT_REALTIME_WORLD,
} from './amsgFirePack';
import type { CharacterProfile, RealtimeConfig, UserProfile } from '../types';

/** worker 那串 fillSlot 认识的全集。模板里出现表外的占位符 = 客户端擅自加槽位，到点不填、字面量发给模型。 */
const KNOWN_SLOTS = [
  AMSG_SLOT_CURRENT_TIME,
  AMSG_SLOT_TIME_SINCE_USER,
  AMSG_SLOT_AWAY_HINT,
  AMSG_SLOT_TASK_INSTRUCTION,
  AMSG_SLOT_USER_CLOCK,
  AMSG_SLOT_SELF_LOG,
  AMSG_SLOT_TASK_LIST,
  AMSG_SLOT_SCENE,
  AMSG_SLOT_REALTIME_WORLD,
];

const STAMP_HEAD = '（开口前回到你自己：';
const NOTICE_HEAD = '【刚才没来得及说出口的】';

const char = (extra: Partial<CharacterProfile> = {}) => ({
  id: 'c1',
  name: '小满',
  persona: '测试',
  avatar: '',
  ...extra,
} as unknown as CharacterProfile);

const user = { name: '你', avatar: '', bio: '' } as unknown as UserProfile;

const build = async (opts: { pendingNoticesBlock?: string } = {}) =>
  // 刻意**不传** templateStub：那条路会把整份模板换成占位串，尾部根本不在里面，
  // 测了等于没测。这里走真模板，依赖（近史 / 表情 / 日程）都在上面 mock 成空值。
  buildFirePack(char(), user, [], {} as RealtimeConfig, undefined, opts);

/** 最后一行非空内容。钢印必须是它。 */
const lastNonEmptyLine = (t: string) =>
  t.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

describe('buildFirePack 模板尾部：钢印必须是最后一句', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('不带回执时，钢印就是最后一句', async () => {
    const { template } = await build();
    expect(template).toContain(STAMP_HEAD);
    expect(lastNonEmptyLine(template)).toContain(STAMP_HEAD);
  });

  // 这条是本文件存在的理由：早先 pendingNoticesBlock 是 .concat 到钢印后面的，
  // 钢印因此被压下去、抢不到最后一眼。暮色 2026-10-02 拍板：钢印放最后。
  it('带回执时，钢印仍然必须是最后一句', async () => {
    const { template } = await build({
      pendingNoticesBlock: `${NOTICE_HEAD}\n- 今天早安那条到点了，你在说话，改在这轮顺口带出来。`,
    });
    expect(template).toContain(NOTICE_HEAD);
    expect(lastNonEmptyLine(template)).toContain(STAMP_HEAD);
  });

  it('回执排在钢印前面（不是后面、也不是紧挨钢印的前一行里混着）', async () => {
    const { template } = await build({ pendingNoticesBlock: NOTICE_HEAD });
    expect(template.indexOf(NOTICE_HEAD)).toBeLessThan(template.indexOf(STAMP_HEAD));
    // 中间留一个空行，别让回执和钢印黏成一段
    const between = template.slice(template.indexOf(NOTICE_HEAD), template.indexOf(STAMP_HEAD));
    expect(between.trim()).toBe(NOTICE_HEAD);
  });

  // 拼进模板正文（而不是新加 AMSG_SLOT_*）是硬约束：云端槽位写死，客户端加的
  // 它不填，回执就带着 {{AMSG_XXX}} 字面量发给模型。
  //
  // 注意判据不是「模板里没有花括号」——那 9 个**真**槽位本来就该以占位符形态待在模板里，
  // 等 worker 到点填。判据是「占位符只有那 9 个、一个不多」，多出来的那个才是事故。
  it('模板里只有那 9 个已知槽位，没有多出来的未填占位符', async () => {
    const { template } = await build({ pendingNoticesBlock: NOTICE_HEAD });
    // 先锚一下「这确实是真模板不是占位串」：本次任务槽位必须在，否则上面的判据会假绿。
    expect(template).toContain(AMSG_SLOT_TASK_INSTRUCTION);
    const found = [...new Set([...template.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]))];
    expect(found.filter((s) => !KNOWN_SLOTS.includes(s as never))).toEqual([]);
  });

  it('回执传空白串 = 当没传（不留空行、不改尾部形状）', async () => {
    const withEmpty = await build({ pendingNoticesBlock: '   ' });
    const without = await build();
    expect(lastNonEmptyLine(withEmpty.template)).toContain(STAMP_HEAD);
    expect(lastNonEmptyLine(withEmpty.template)).toBe(lastNonEmptyLine(without.template));
  });
});
