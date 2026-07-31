// 情侣空间数据存储 — localStorage
// 暮色 2026-07-31 启动的基础版：3 模块（打卡 / 时间线 / 悄悄话）
// 设计要点：
//   - 按 profile+char 配对存（暮色只一个 profile，留扩展）
//   - 不依赖云同步（暮色 2026-07-31 说"云端一直没跑通，暂放"）
//   - localStorage 容量有限，timeline/whispers 加软上限
//   - 邀请消息不存这里（存到 Chat 的 message 列表里，type: 'couple_space_invite'）

import { CoupleSpace, CoupleCheckin, CoupleTimelineItem, CoupleWhisper, DEFAULT_COUPLE_TASKS } from '../types';

const STORAGE_KEY = 'sullyos_couple_spaces_v1';
const TIMELINE_MAX = 200;     // 时间线软上限
const WHISPERS_MAX = 200;     // 悄悄话软上限
const CHECKINS_MAX = 365;     // 打卡记录软上限（保留 1 年）

// ──────────────────────────────────────────
// 基础 CRUD
// ──────────────────────────────────────────

function readAll(): Record<string, CoupleSpace> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[coupleSpaceStorage] readAll failed', e);
    return {};
  }
}

function writeAll(data: Record<string, CoupleSpace>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('[coupleSpaceStorage] writeAll failed', e);
  }
}

export function makePairId(profileId: string, charId: string): string {
  return `${profileId}__${charId}`;
}

export function getSpace(profileId: string, charId: string): CoupleSpace | null {
  const all = readAll();
  return all[makePairId(profileId, charId)] || null;
}

export function getAllSpaces(): CoupleSpace[] {
  return Object.values(readAll());
}

export function upsertSpace(space: CoupleSpace): void {
  const all = readAll();
  all[space.pairId] = space;
  writeAll(all);
}

export function deleteSpace(profileId: string, charId: string): void {
  const all = readAll();
  delete all[makePairId(profileId, charId)];
  writeAll(all);
}

// ──────────────────────────────────────────
// 初始化（首次进入 / 接受邀请后）
// ──────────────────────────────────────────

export function initSpace(opts: {
  profileId: string;
  charId: string;
  charName: string;
  profileName: string;
  annivDate: string;
}): CoupleSpace {
  const existing = getSpace(opts.profileId, opts.charId);
  if (existing) return existing;

  const now = Date.now();
  const space: CoupleSpace = {
    pairId: makePairId(opts.profileId, opts.charId),
    profileId: opts.profileId,
    charId: opts.charId,
    status: 'open',
    annivDate: opts.annivDate,
    openedAt: now,
    lastInviteAt: now,
    checkins: [],
    consecutiveDays: 0,
    lastCheckinDate: '',
    charLastProactiveDate: '',
    timeline: [],
    whispers: [],
    whisperUnread: 0,
  };
  upsertSpace(space);
  return space;
}

// 暮色 2026-07-31 反馈"前面咱们说的你不记得了吗"——补完整 miya 流程：
//   暮色点"邀请" → markPending（状态 pending）→ 发邀请消息到聊天 → AI 决策
//   → acceptInvite（pending → open）/ declineInvite（pending → declined）
// 之前我简化掉了 AI 决策那步，暮色不认账。

/**
 * 暮色发起邀请：标 pending 状态（不直接开通）
 * 暮色 2026-07-31 选 B（完整版 AI 自动决策）：发邀请消息后等 AI 角色回应
 */
export function markPending(opts: {
  profileId: string;
  charId: string;
  charName: string;
  profileName: string;
  annivDate: string;
}): CoupleSpace {
  const now = Date.now();
  const pairId = makePairId(opts.profileId, opts.charId);
  const existing = getSpace(opts.profileId, opts.charId);

  if (existing) {
    // 已存在 — 如果是 open 就不动；其他状态重置为 pending
    if (existing.status === 'open') return existing;
    existing.status = 'pending';
    existing.annivDate = opts.annivDate;
    existing.lastInviteAt = now;
    upsertSpace(existing);
    return existing;
  }

  const space: CoupleSpace = {
    pairId,
    profileId: opts.profileId,
    charId: opts.charId,
    status: 'pending',
    annivDate: opts.annivDate,
    openedAt: 0,             // 还没开
    lastInviteAt: now,
    checkins: [],
    consecutiveDays: 0,
    lastCheckinDate: '',
    charLastProactiveDate: '',
    timeline: [],
    whispers: [],
    whisperUnread: 0,
  };
  upsertSpace(space);
  return space;
}

/**
 * AI 决定接受邀请（pending → open）
 * 暮色手动接受 + AI 决策成功都走这个
 */
export function acceptInvite(profileId: string, charId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.status = 'open';
  space.openedAt = space.openedAt || Date.now();
  upsertSpace(space);
  return space;
}

/**
 * AI 决定拒绝邀请（pending → declined）
 */
export function declineInvite(profileId: string, charId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.status = 'declined';
  upsertSpace(space);
  return space;
}

/**
 * 重新发邀请（pending 的可以把旧的标 expired，自己重新发）
 * 暮色 2026-07-31 反馈"可以多次发邀请"：跟 miya 的 expireOldPendingInvites 行为一致
 */
export function expireOldPendingInvites(profileId: string, charId: string): void {
  const all = readAll();
  const pairId = makePairId(profileId, charId);
  const space = all[pairId];
  if (space && space.status === 'pending') {
    space.status = 'expired';
    upsertSpace(space);
  }
}

// ──────────────────────────────────────────
// 关系开始日
// ──────────────────────────────────────────

export function setAnnivDate(profileId: string, charId: string, annivDate: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.annivDate = annivDate;
  upsertSpace(space);
  return space;
}

// 暮色 2026-07-31：关系开始日可设置，可以是历史日期
// 暮色和江澈已经认识大半年了，annivDate 填历史日期
export function daysTogether(annivDate: string): number {
  try {
    const start = new Date(annivDate + 'T00:00:00');
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diff = Math.floor((now.getTime() - start.getTime()) / 86400000);
    return diff >= 0 ? diff : 0;
  } catch {
    return 0;
  }
}

// ──────────────────────────────────────────
// 打卡模块
// ──────────────────────────────────────────

function trimCheckins(space: CoupleSpace): void {
  if (space.checkins.length > CHECKINS_MAX) {
    space.checkins = space.checkins.slice(-CHECKINS_MAX);
  }
}

export function addCheckin(
  profileId: string,
  charId: string,
  checkin: Omit<CoupleCheckin, 'id' | 'createdAt'>,
): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;

  const newCheckin: CoupleCheckin = {
    ...checkin,
    id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  space.checkins.push(newCheckin);

  // 重新算连续天数
  if (newCheckin.fromUser || newCheckin.fromChar) {
    space.lastCheckinDate = newCheckin.date;
    space.consecutiveDays = calcConsecutiveDays(space.checkins);
  }
  if (newCheckin.fromChar) {
    space.charLastProactiveDate = newCheckin.date;
  }

  trimCheckins(space);
  upsertSpace(space);
  return space;
}

function calcConsecutiveDays(checkins: CoupleCheckin[]): number {
  if (!checkins.length) return 0;
  const dates = Array.from(new Set(checkins.map(c => c.date))).sort().reverse();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  let count = 0;
  let cursor = new Date(today);
  // 如果今天没打卡，从昨天开始算
  if (dates[0] !== todayStr) {
    cursor.setDate(cursor.getDate() - 1);
  }
  for (const d of dates) {
    const expected = cursor.toISOString().split('T')[0];
    if (d === expected) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}

// 暮色 2026-07-31：AI 主动打卡触发条件
// 30% 概率 + 一天最多 3 条 + 距离上次主动 > 6 小时
export function shouldTriggerAiCheckin(profileId: string, charId: string): boolean {
  const space = getSpace(profileId, charId);
  if (!space || space.status !== 'open') return false;

  const today = new Date().toISOString().split('T')[0];
  const todayCount = space.checkins.filter(c => c.date === today && c.fromChar).length;
  if (todayCount >= 3) return false;

  // 距离上次主动 > 6 小时
  if (space.charLastProactiveDate === today) {
    // 同一天内，看具体时间
    const lastCharCheckin = [...space.checkins].reverse().find(c => c.fromChar);
    if (lastCharCheckin) {
      const hoursSince = (Date.now() - lastCharCheckin.createdAt) / 3600000;
      if (hoursSince < 6) return false;
    }
  }

  return Math.random() < 0.3;
}

// 随机选一个任务
export function pickRandomTask(): typeof DEFAULT_COUPLE_TASKS[number] {
  return DEFAULT_COUPLE_TASKS[Math.floor(Math.random() * DEFAULT_COUPLE_TASKS.length)];
}

// ──────────────────────────────────────────
// 时间线模块
// ──────────────────────────────────────────

function trimTimeline(space: CoupleSpace): void {
  if (space.timeline.length > TIMELINE_MAX) {
    space.timeline = space.timeline.slice(-TIMELINE_MAX);
  }
}

export function addTimelineItem(
  profileId: string,
  charId: string,
  item: Omit<CoupleTimelineItem, 'id' | 'createdAt'>,
): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  const newItem: CoupleTimelineItem = {
    ...item,
    id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  space.timeline.push(newItem);
  // 时间线按日期倒序
  space.timeline.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  trimTimeline(space);
  upsertSpace(space);
  return space;
}

export function updateTimelineItem(
  profileId: string,
  charId: string,
  itemId: string,
  patch: Partial<CoupleTimelineItem>,
): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  const idx = space.timeline.findIndex(t => t.id === itemId);
  if (idx < 0) return null;
  space.timeline[idx] = { ...space.timeline[idx], ...patch };
  upsertSpace(space);
  return space;
}

export function deleteTimelineItem(profileId: string, charId: string, itemId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.timeline = space.timeline.filter(t => t.id !== itemId);
  upsertSpace(space);
  return space;
}

// 暮色 2026-07-31：去重检测
// 时间线从记忆宫殿抽取时，避免重复添加
export function timelineHasContent(profileId: string, charId: string, contentHash: string): boolean {
  const space = getSpace(profileId, charId);
  if (!space) return false;
  return space.timeline.some(t =>
    t.source === 'ai-extract' && t.content.slice(0, 100) === contentHash
  );
}

// ──────────────────────────────────────────
// 悄悄话模块
// ──────────────────────────────────────────

function trimWhispers(space: CoupleSpace): void {
  if (space.whispers.length > WHISPERS_MAX) {
    const removed = space.whispers.length - WHISPERS_MAX;
    space.whispers = space.whispers.slice(-WHISPERS_MAX);
    // 未读数要减掉被裁掉的未读条
    space.whisperUnread = Math.max(0, space.whisperUnread - removed);
  }
}

export function addWhisper(
  profileId: string,
  charId: string,
  whisper: Omit<CoupleWhisper, 'id' | 'createdAt' | 'isRead'>,
): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  const newWhisper: CoupleWhisper = {
    ...whisper,
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    isRead: whisper.from === 'user',  // 用户自己发的默认已读
  };
  space.whispers.push(newWhisper);
  if (newWhisper.from === 'char' && !newWhisper.isRead) {
    space.whisperUnread += 1;
  }
  trimWhispers(space);
  upsertSpace(space);
  return space;
}

export function markWhispersRead(profileId: string, charId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  space.whispers.forEach(w => {
    if (w.from === 'char') w.isRead = true;
  });
  space.whisperUnread = 0;
  upsertSpace(space);
  return space;
}

export function deleteWhisper(profileId: string, charId: string, whisperId: string): CoupleSpace | null {
  const space = getSpace(profileId, charId);
  if (!space) return null;
  const target = space.whispers.find(w => w.id === whisperId);
  space.whispers = space.whispers.filter(w => w.id !== whisperId);
  if (target && target.from === 'char' && !target.isRead) {
    space.whisperUnread = Math.max(0, space.whisperUnread - 1);
  }
  upsertSpace(space);
  return space;
}

// ──────────────────────────────────────────
// 数据迁移（首次访问时）
// ──────────────────────────────────────────

// 暮色 2026-07-31：上线时没数据，从空开始
// 后续如果改数据结构，在这里加迁移逻辑
export function migrateIfNeeded(): void {
  // 占位：未来数据结构变化时加迁移代码
  // 当前版本 v1：基础 3 模块
}
