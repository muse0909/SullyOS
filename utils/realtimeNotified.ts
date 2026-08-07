// realtimeNotified — 主动消息"真实世界感知"通知状态
// 暮色 2026-08-07 19:31 反馈：
//   8-5 commit 8228f95 写"正常聊天 / 主动消息 / 早晚各一次主动推"三个场景分开
//   但代码实现简化成 shouldInjectRealtime = !!isProactive — 主动消息每个时段都带热搜+天气
//   "早晚各一次" 的窗口判断完全没实现
//   这次补回：
//   - 早 5-9 / 晚 17-21 默认窗口
//   - 同一窗口当天已通知过 → 跳过（避免 30 分钟一次主动消息里反复塞热搜）
//   - 持久化"今天 morning/evening notified timestamp"
//
// 字段：
//   { date: 'YYYY-MM-DD', morningAt?: number, eveningAt?: number }
//
// 调用：
//   - shouldNotifyRealtime()  返回 boolean — 这次主动消息能不能带新闻/天气
//   - markRealtimeNotified()   调用后写入 timestamp（同步持久化）
//
// 跟 proactiveCount（每天每 char 3 次上限）独立：realtimeNotified 是"窗口级"，
// proactiveCount 是"调用级"。

const STORAGE_KEY = 'sullyos_realtime_notified_v1';

export interface RealtimeNotifiedState {
  date: string; // YYYY-MM-DD，按设备本地时间
  morningAt?: number; // timestamp
  eveningAt?: number;
}

const MORNING_START_HOUR = 5;
const MORNING_END_HOUR = 9;
const EVENING_START_HOUR = 17;
const EVENING_END_HOUR = 21;

export type RealtimeWindow = 'morning' | 'evening' | null;

const todayDateStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const loadState = (): RealtimeNotifiedState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayDateStr() };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.date) {
      return { date: todayDateStr() };
    }
    return parsed;
  } catch {
    return { date: todayDateStr() };
  }
};

const saveState = (state: RealtimeNotifiedState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[realtimeNotified] save failed', e);
  }
};

/** 当前小时是不是在早/晚窗口内。 */
export const getCurrentRealtimeWindow = (now: Date = new Date()): RealtimeWindow => {
  const h = now.getHours();
  if (h >= MORNING_START_HOUR && h < MORNING_END_HOUR) return 'morning';
  if (h >= EVENING_START_HOUR && h < EVENING_END_HOUR) return 'evening';
  return null;
};

/**
 * 这次主动消息能不能带新闻/天气。
 * 规则：必须在早/晚窗口内 + 当日该窗口还没通知过。
 */
export const shouldNotifyRealtime = (now: Date = new Date()): boolean => {
  const win = getCurrentRealtimeWindow(now);
  if (!win) return false;
  const state = loadState();
  // 跨天 → 重置
  if (state.date !== todayDateStr()) return true;
  if (win === 'morning') return !state.morningAt;
  if (win === 'evening') return !state.eveningAt;
  return false;
};

/** 标记"该窗口已通知"——避免同一窗口重复塞热搜/天气。 */
export const markRealtimeNotified = (now: Date = new Date()): void => {
  const win = getCurrentRealtimeWindow(now);
  if (!win) return;
  const today = todayDateStr();
  const state = loadState();
  if (state.date !== today) {
    saveState({ date: today, [win === 'morning' ? 'morningAt' : 'eveningAt']: now.getTime() });
    return;
  }
  if (win === 'morning') state.morningAt = now.getTime();
  else if (win === 'evening') state.eveningAt = now.getTime();
  saveState(state);
};

/** 测试 / 调试用：清空通知状态。 */
export const resetRealtimeNotified = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
};

export const REALTIME_WINDOW_HOURS = {
  morning: { start: MORNING_START_HOUR, end: MORNING_END_HOUR },
  evening: { start: EVENING_START_HOUR, end: EVENING_END_HOUR },
} as const;
