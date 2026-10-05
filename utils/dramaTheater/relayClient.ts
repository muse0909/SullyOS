/**
 * 剧场 · 转发服务客户端
 *
 * 短剧库跑在电脑上，手机是通过 Mac 上的转发服务跟它说话的。
 * 这一层只管三件事：地址存在哪、连没连上、要什么数据。
 *
 * 为什么要转发：短剧库的播放接口只放行同源请求（Sec-Fetch-Site 必须是
 * same-origin/none，Origin 必须同源），手机是跨站去的，必定 403。
 */

const STORAGE_KEY = 'theater_relay_addr';

// 存下来的地址是「电脑的局域网地址:8999」，转发服务每分钟播一次自己的地址。
export type RelayInfo = {
  base: string;
  online: boolean;
  localIp?: string;
  // false = 压根没连上（网不通/地址错/服务没开）
  // undefined = 连上了，但转发服务说短剧库那边没响应
  reached?: boolean;
};

// 试过的地址按「最近用的排前面」记下来，方便暮色手机和电脑来回切。
export type KnownRelay = { base: string; at: number };

function readKnown(): KnownRelay[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_known');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((x: any) => x && typeof x.base === 'string').slice(0, 6);
  } catch {
    return [];
  }
}

function writeKnown(base: string) {
  try {
    const list = [{ base, at: Date.now() }, ...readKnown().filter((x) => x.base !== base)];
    localStorage.setItem(STORAGE_KEY + '_known', JSON.stringify(list.slice(0, 6)));
  } catch {}
}

export function getRelayAddr(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setRelayAddr(addr: string): string {
  // 去掉结尾斜杠，避免拼出 //api
  const clean = addr.trim().replace(/\/+$/, '');
  try {
    localStorage.setItem(STORAGE_KEY, clean);
  } catch {}
  if (clean) writeKnown(clean);
  return clean;
}

export function getKnownRelays(): KnownRelay[] {
  return readKnown();
}

export function forgetRelay(addr: string) {
  try {
    localStorage.setItem(STORAGE_KEY + '_known', JSON.stringify(readKnown().filter((x) => x.base !== addr)));
  } catch {}
}

/** 拼一个完整地址 */
export function relayUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * 探活。这个顺带确认两件事：转发服务在不在、短剧库有没有开。
 * 只发一个很小的请求，不碰剧库数据。
 */
export async function pingRelay(base: string, timeoutMs = 4000): Promise<RelayInfo> {
  const clean = base.replace(/\/+$/, '');
  const info: RelayInfo = { base: clean, online: false };
  if (!clean) return info;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${clean}/relay/health`, { signal: ctrl.signal, cache: 'no-store' });
    const json = await resp.json().catch(() => ({}));
    info.online = !!json.upstreamOk;
    info.localIp = json.localIp;
  } catch {
    info.online = false;
  } finally {
    clearTimeout(timer);
  }
  return info;
}

/**
 * 试一个地址是不是能用的转发服务。
 * 传进来的可以是 "192.168.0.102:8999" 这种简写，缺协议就按 http 补。
 */
export function normalizeAddr(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  // 忘了写端口就补上，转发服务固定 8999（8998 是短剧库自己）
  if (!/:\d+$/.test(s.replace(/^https?:\/\//i, ''))) s = `${s}:8999`;
  return s;
}

/**
 * 把一集视频整个取回来，交给播放器。
 *
 * 为什么不能直接给 <video> 喂电脑上的地址：
 * App 的页面是 https，电脑上的转发服务是 http。安卓显示内核对「放视频」这条路
 * 单独加了一道混合内容拦截，**配置文件里的 allowMixedContent 管不到它** ——
 * 实测 fetch 已经能通（HTTP 200），video 仍然是 type=Media + mixed-content 拦截。
 *
 * 所以改成：先用能通的那条路（fetch）把文件整个取回来，
 * 变成浏览器本地的临时地址再播放。附带好处是这个地址跟页面同源，
 * 第 3 步往画布上取帧天然干净，不需要额外开跨域。
 */
export async function fetchVideoBlobUrl(
  dramaTitle: string,
  episode: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ url: string; revoke: () => void; size: number }> {
  const base = getRelayAddr();
  if (!base) throw new Error('还没连上电脑');

  const src = localVideoUrl(base, dramaTitle, episode);
  const resp = await fetch(src, { cache: 'no-store' });
  if (!resp.ok) {
    let msg = `取视频失败 HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }

  const total = Number(resp.headers.get('Content-Length') || 0);

  // 带进度的读取：直接 resp.blob() 的话中途没反馈，进度条会一直卡在 0
  if (!resp.body || !onProgress) {
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url), size: blob.size };
  }

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url), size: blob.size };
}


export type RelayDrama = {
  id: string;          // 形如 hongguo:7691205405866724414 —— 不是剧名
  title: string;
  coverUrl?: string;
  intro?: string;
  // 剧库里的集数字段（episodeCount / total / episodes）实测值都是 '1'，是假数据，
  // 所以这里根本不带出来。真集数只能问 playback/open 的 episodes 长度。
  source?: string;
};

export type RelayTask = {
  id: string;
  dramaId?: string;
  dramaTitle?: string;
  episode: number;
  playable?: boolean;
  duration?: number;
  size?: number;
};

/** 已下载的剧：转发服务直接从硬盘读文件 */
export function localVideoUrl(base: string, dramaTitle: string, episode: number): string {
  return relayUrl(
    base,
    `/relay/local/video?drama=${encodeURIComponent(dramaTitle)}&episode=${encodeURIComponent(String(episode))}`
  );
}

async function jget<T>(base: string, path: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(relayUrl(base, path), { signal: ctrl.signal, cache: 'no-store' });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 短剧库本地已缓存的剧库（实测一万多条） */
export async function fetchDramas(base: string): Promise<RelayDrama[]> {
  const j = await jget<any>(base, '/api/ui/dramas', 30000);
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  return list.map((d) => ({
    id: d.id,
    title: d.title || d.name || '未命名',
    coverUrl: d.coverUrl || d.cover_url || d.imageUrl || d.image_url || d.cover || d.image,
    intro: d.intro || d.desc || '',
    source: d.source,
  }));
}

/** 已下载的集 */
export async function fetchTasks(base: string): Promise<RelayTask[]> {
  const j = await jget<any>(base, '/api/ui/tasks', 30000);
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.tasks) ? j.tasks : Array.isArray(j) ? j : [];
  return list.map((t) => ({
    id: t.id,
    dramaId: t.dramaId || t.drama_id,
    // 短剧库返回的目录名就叫剧名，转发服务送本地文件时按剧名找目录 —— 实测 6 部全对得上
    dramaTitle: t.dramaTitle || t.drama_title || t.title,
    episode: Number(t.episode || t.index || 0),
    playable: t.playable,
    // 时长短剧库叫 mediaTotalSeconds，不是 duration
    duration: t.mediaTotalSeconds || t.duration,
    size: t.totalBytes || t.size || t.filesize,
  }));
}

/** 搜剧（只有红果源支持联网搜索，黄豆源不支持） */
export async function searchDramas(base: string, q: string): Promise<RelayDrama[]> {
  const j = await jget<any>(base, `/api/ui/search?q=${encodeURIComponent(q)}&source=hongguo`, 25000);
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
  return list.map((d) => ({
    id: d.id,
    title: d.title || d.name || '未命名',
    coverUrl: d.coverUrl || d.cover_url || d.imageUrl || d.image_url || d.cover || d.image,
    intro: d.intro || d.desc || '',
    source: d.source || 'hongguo',
  }));
}

/**
 * 排下载队列。
 * 短剧库的 ids 要的是剧编号（跟 fetchDramas 里的 id 一样），不是剧名。
 */
export async function queueDownload(base: string, dramaIds: string[], quality = 0): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const resp = await fetch(relayUrl(base, '/api/ui/download'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: dramaIds, quality }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 看某部剧在线有多少集（打开播放会话才有，未下载的剧要靠它） */
export async function fetchEpisodes(base: string, dramaId: string): Promise<{ total: number; session: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(relayUrl(base, '/api/ui/playback/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dramaId, taskId: '', resume: false, fromHistory: false }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
    const j = await resp.json();
    return {
      total: Array.isArray(j.episodes) ? j.episodes.length : 0,
      session: j.session || '',
    };
  } finally {
    clearTimeout(timer);
  }
}
