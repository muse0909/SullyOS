// utils/amsg2MissedSummary.ts
/**
 * amsg2MissedSummary —— 面板上「最近没响的」那一张卡（麦麦 2026-10-01 step 8）。
 *
 * ## 为什么要这张卡
 *
 * 「为什么这次没响」这件事散在三处，用户要自己拼：
 *   1. 云端那道闸拦下时写的 `last_skip`（面板顶部一张孤零零的卡）
 *   2. 客户端自己记的作废台账（四种：遇忙作废 / 顺口带出 / 名额满 / 你取消的）
 *      —— **这张台账角色读得到，用户读不到**（它只进角色的排程现状块）
 *   3. step 6 在每条任务下面那行「为什么没响」
 *
 * 归成一处之前，第 2 条对用户**根本不存在**：任务被名额顶掉了、角色自己记了一条
 * "顺口带出"，用户只看到"到点了没响"，只能猜。
 *
 * ## 三处的分工（别混）
 *
 *   - 挂在任务上的 → 由 step 6 在那条任务下面说（`amsg2DeferredScan`）
 *   - 没挂上任何任务的（你取消的、名额满的、云端零散跳过的）→ 归到这张卡
 *
 * 靠 occurrenceMs 邻近去重：同一次触发，云端和客户端各记一条的情况很常见
 * （强制发送到点被云端 expire 拦下，客户端同时写一条 `deferred`），两张都显示
 * 会让用户以为发生了两件事。
 *
 * ## 为什么不删台账
 *
 * 台账里的 `expired` 记录永远不会被"消费"——遇忙作废的定义就是不告诉角色，所以它
 * 没有消费方，只靠 48h TTL 自然消失。删了它等于把这 48 小时的审计抹掉，而这里要的
 * 只是"用户看过了别再显示"：面板用一个时间水位线记下看到哪儿了（见 readDismissedAt）。
 */

import type { Amsg2ExpiredNoticeRecord } from '../types';
import { describeLastSkip, type AmsgLastSkip } from './amsgFirePack';
import { formatTaskTime } from './amsg2Tasks';

/** 同一次触发最多差这么多算"同一件事"（云端 fire 跟到点时刻本身就能差一两分钟）。 */
const SAME_OCCURRENCE_TOLERANCE_MS = 3 * 60_000;

/** 一次最多列几条。再多就往下滚，面板不是日志。 */
const SUMMARY_MAX = 6;

export interface AmsgMissedSummaryEntry {
  /** 稳定 key，渲染列表用。 */
  key: string;
  occurrenceMs: number;
  /** 一句话，照实说。 */
  text: string;
  /** 这一条是谁记的——云端说的还是本地记的，面板上标出来。 */
  source: 'cloud' | 'local';
}

/**
 * 四种本地记录的措辞。入参是**已经格式化好的时间串**（formatTaskTime 的产物），
 * 不是时间戳——文案里要的是"10月1日 8:00"这种用户读得懂的说法。
 */
const localTexts: Record<
  NonNullable<Amsg2ExpiredNoticeRecord['kind']>,
  (at: string) => string
> = {
  // 遇忙作废：直接取消、不告诉角色。用户这边照样说清楚发生了什么，只是别让他
  // 以为"待会儿会在聊天里出现"——那条永远不会来（见 buildNoticeSections）。
  expired: (at) => `${at} 那次主动消息取消了——到点时你正跟 ta 聊天，按规矩这次不让 ta 插嘴。`,
  // 到点推迟：强制发送改在下一轮上下文里顺口带出。这条**会**在聊天里出现，
  // 文案必须说清楚"去哪找"，否则用户会以为又被吞了。
  deferred: (at) => `${at} 那次主动消息没插嘴——到点前十分钟你刚说过话，改成在你们的聊天里顺口带出来了。`,
  // 名额满：不是时机不对，是没轮上。跟"取消"分开说，否则用户会去查对话。
  'quota-blocked': (at) => `${at} 那次主动消息没发出去——次数用完了（今天的上限，或者你未回复期间 ta 已经连发到头）。`,
  'user-cancelled': (at) => `${at} 那条被取消了——是你自己在面板里删掉的，ta 知道这件事。`,
};

const localSource = (r: Amsg2ExpiredNoticeRecord) => localTexts[r.kind ?? 'expired'];

/**
 * 合并三处来源，去重、倒序、截断。
 *
 * @param coveredOccurrences 已经在任务行上说过了的那些触发时刻（step 6 扫出来的）。
 *   差得近的条目从这张卡里去掉——同一件事说两遍，用户会以为出了两次岔子。
 */
export const buildMissedSummary = (input: {
  lastSkip: AmsgLastSkip | null | undefined;
  notices: Amsg2ExpiredNoticeRecord[];
  coveredOccurrences?: number[];
}): AmsgMissedSummaryEntry[] => {
  const covered = input.coveredOccurrences ?? [];
  const isCovered = (ms: number) =>
    covered.some((c) => Math.abs(c - ms) <= SAME_OCCURRENCE_TOLERANCE_MS);

  const out: AmsgMissedSummaryEntry[] = [];
  if (input.lastSkip && !isCovered(input.lastSkip.occurrenceMs)) {
    out.push({
      key: `cloud:${input.lastSkip.occurrenceMs}:${input.lastSkip.reason}`,
      occurrenceMs: input.lastSkip.occurrenceMs,
      text: describeLastSkip(input.lastSkip, (ms) => formatTaskTime(ms)),
      source: 'cloud',
    });
  }
  for (const r of input.notices) {
    if (isCovered(r.occurrenceMs)) continue;
    out.push({
      key: `local:${r.id}`,
      occurrenceMs: r.occurrenceMs,
      text: localSource(r)(formatTaskTime(r.occurrenceMs)),
      source: 'local',
    });
  }
  out.sort((a, b) => b.occurrenceMs - a.occurrenceMs);
  return out.slice(0, SUMMARY_MAX);
};

// ─── 已看过的时间水位线 ───
// 只记"看到哪儿了"，不删台账：台账是角色也要读的东西，删了等于抹掉这 48 小时的账。

const DISMISS_KEY = (charId: string) => `amsg2_missed_dismissed_${charId}`;

export const readDismissedAt = (charId: string): number => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY(charId));
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

export const writeDismissedAt = (charId: string, occurrenceMs: number): void => {
  try {
    // 只前进不后退：连着点两次"知道了"，第二次不能把水位线退回去让旧条目又冒出来。
    const prev = readDismissedAt(charId);
    localStorage.setItem(DISMISS_KEY(charId), String(Math.max(prev, occurrenceMs)));
  } catch {
    /* 隐私模式下写不进去，忽略即可（顶多多显示一次） */
  }
};

/** 水位线之后的条目才显示。 */
export const isAfterDismissal = (occurrenceMs: number, dismissedAt: number): boolean =>
  occurrenceMs > dismissedAt;
