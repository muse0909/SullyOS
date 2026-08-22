// 暮色 2026-08-22：日记"已读"时间戳（DiscoverPage 小红点用）
//   journal_last_seen_at: 全局时间戳（localStorage）
//   - JournalApp 进入时 → 写当前时间（视为已读）
//   - DiscoverPage 进入时 → 读这个时间，比对所有角色最新 diary 的 timestamp
//   - 跨 tab / 跨刷新都靠 localStorage 持久化

const STORAGE_KEY = 'journal_last_seen_at';

export function getJournalLastSeenAt(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? parseInt(raw, 10) : 0;
}

export function setJournalLastSeenAt(ts: number = Date.now()): void {
  localStorage.setItem(STORAGE_KEY, String(ts));
}
