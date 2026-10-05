/**
 * 剧场 · 正在追剧（观看记录）
 *
 * 为什么记在手机本地而不是问短剧库：
 *   短剧库的 /api/ui/playback/history 记的是「网页播放器」看过的，
 *   而剧场是 App 自己在放视频（放的是取回手机的本地文件），
 *   走的不是它那条播放会话，那边永远收不到这里的进度。
 *   所以剧场自己记一份，App 放的每一集都跑不掉。
 *
 * 电脑那边的记录也读一份合进来（剧场首页/选集页在电脑上看过的那部分），
 * 两边按剧名去重，手机自己记的优先。
 */

const KEY = 'theater_watch';
const LIMIT = 200;

export type WatchEntry = {
  title: string;
  /**
   * 剧库里的 id（比如 hongguo:7687...）。
   *
   * **必须有它，否则从「正在追剧」点进来的剧播不了在线的。**
   * 之前没存这个字段，于是追剧列表那处只能 `openEpisodes({ id: '', ... })`，
   * 剧 id 是空的 → 「能不能在线播」判成否 → 选集页的集数全灰、点不动
   * （用户 10-06 深夜实测：进去了但一集都点不了）。
   */
  dramaId?: string;
  coverUrl?: string;
  episode: number;
  total: number;
  position: number;  // 秒
  duration: number;  // 秒
  origin: 'mac' | 'upload' | 'mac-history';
  watchedAt: number;
};

function read(): WatchEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((x) => x && typeof x.title === 'string');
  } catch {
    return [];
  }
}

function write(list: WatchEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, LIMIT)));
  } catch {}
}

export function listWatch(): WatchEntry[] {
  return read().sort((a, b) => b.watchedAt - a.watchedAt);
}

/**
 * 记一次观看。同一部剧只留一条，续写集数和进度。
 * 只在真的看了一会儿之后才记（调用方判断），不然点开就退也算「看过」。
 */
export function upsertWatch(e: Omit<WatchEntry, 'watchedAt'>): void {
  if (!e.title) return;
  const list = read().filter((x) => x.title !== e.title);
  list.unshift({ ...e, watchedAt: Date.now() });
  write(list);
}

export function removeWatch(title: string) {
  write(read().filter((x) => x.title !== title));
}

export function clearWatch() {
  write([]);
}
