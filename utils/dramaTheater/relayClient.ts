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
export async function fetchVideoBytes(
  dramaTitle: string,
  episode: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ blob: Blob; size: number }> {
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
    return { blob, size: blob.size };
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
  return { blob, size: blob.size };
}

export async function fetchVideoBlobUrl(
  dramaTitle: string,
  episode: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ url: string; revoke: () => void; size: number }> {
  const { blob, size } = await fetchVideoBytes(dramaTitle, episode, onProgress);
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url), size };
}

// ── 在线剧（电脑上没下过的那些）─────────────────────────────

/**
 * 记住开过的会话，下次进来先把旧的还回去。
 *
 * 为什么需要：短剧库的并发名额默认只有 4 个（playback_resources.go:39
 * `MaxSessions: 4`），闲置 **10 分钟**才回收（ui_playback.go:17
 * `playbackIdleTimeout = 10 * time.Minute`）。正常退出会 close 掉，
 * 但 app 被系统杀掉、来不及 close 的那些就赖在那儿占名额了 ——
 * 表现就是「点首页的剧一直 429」，而等 10 分钟自己就好了。
 *
 * 所以本地留一份开过的会话号，每次进剧场先把没关的全关一遍。
 */
const OPEN_SESSIONS_KEY = 'theater_open_sessions';

function readOpenSessions(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_SESSIONS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function rememberSession(session: string): void {
  try {
    const list = readOpenSessions();
    if (!list.includes(session)) {
      list.push(session);
      // 只留最近 8 个，别让这个 key 无限长
      localStorage.setItem(OPEN_SESSIONS_KEY, JSON.stringify(list.slice(-8)));
    }
  } catch { /* 存不下就靠 10 分钟超时兜底 */ }
}

function forgetSession(session: string): void {
  try {
    localStorage.setItem(
      OPEN_SESSIONS_KEY,
      JSON.stringify(readOpenSessions().filter((s) => s !== session))
    );
  } catch { /* 忽略 */ }
}

/** 把之前开着没关的会话全还回去。进剧场时调一次。 */
export function reclaimStaleSessions(): number {
  const stale = readOpenSessions();
  stale.forEach((s) => {
    closeOnlinePlayback(s);
    forgetSession(s);
  });
  return stale.length;
}

/**
 * 开一个播放会话。
 *
 * 电脑上没下载的剧（剧库首页那 10455 条里绝大多数）之前在剧场里点不动：
 * 集数格子是灰的。根因是取片只走电脑的下载目录，压根没有在线这条路。
 * 短剧库那边其实有完整的在线播放（网页版 player.js 就是这么放的）：
 *   POST /api/ui/playback/open    → 拿 session + 每一集的 chapterId
 *   GET  /api/ui/playback/stream  → 边转边送的 fMP4 流
 * 真机 10-05 在电脑上实测过：红果某剧 open 返回 45 集，stream 真取到
 * 83.8 MB、头是 ftypiso5、X-Playback-Source: online。
 */
export async function openOnlinePlayback(
  dramaId: string
): Promise<{ session: string; total: number }> {
  const base = getRelayAddr();
  if (!base) throw new Error('还没连上电脑');
  const resp = await fetch(`${base}/api/ui/playback/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dramaId }),
    cache: 'no-store',
  });
  if (!resp.ok) {
    // 429 是这个接口唯一会「必然重试无效」的错误，单独说清楚该怎么办。
    // 别只丢一个 HTTP 429 给用户 —— 他不知道是网络问题还是自己操作问题。
    if (resp.status === 429) throw new Error(PLAYBACK_BUSY_MSG);
    throw new Error(`取播放地址失败 HTTP ${resp.status}`);
  }
  const j = await resp.json();
  if (j?.error) throw new Error(j.error);
  const session = String(j?.session || '');
  if (!session) throw new Error('短剧库没给播放会话');
  rememberSession(session);
  const total = Number(j?.episodes?.length || 0);
  return { session, total };
}

/**
 * 429 时给用户看的话。
 *
 * 名额总数是 4（playback_resources.go:39 `MaxSessions: 4`），电脑网页版在播
 * 也占一个，所以「电脑在播 + 手机在播 + 之前崩掉留下的」很容易凑满。
 * 占用 10 分钟才自动回收（ui_playback.go:17），但直接重启短剧库进程是**立刻**清的 ——
 * 会话表 `app.playbacks` 是纯内存的（emby_playback.go:12 遍历的就是那个 map），
 * 没有任何落盘，所以重启即清零。
 */
export const PLAYBACK_BUSY_MSG =
  '电脑上的播放位满了。等一会儿它自己会清，或者点下面的按钮一次清空所有播放位。';

/**
 * 把电脑上**所有**播放位一次清空（短剧库 2026-10-05 新加的 action）。
 *
 * 为什么需要：名额只有 4 个，任何一个「忘了关的」就能把所有人堵死（429），
 * 而用户既看不到有几个挂着、也没有别的办法清 —— 原来唯一的出路是重启短剧库。
 * 这个接口是 2026-10-05 麦麦给短剧库加的，实测 `{"closed":4,"ok":true}` 生效。
 *
 * ⚠️ 会把**别人正在看的也一起断掉**（电脑网页版也在共用这 4 个名额）。
 * 所以只在「确实是 429、且用户主动点了」的时候才调，不能自动调。
 */
export function clearAllOnlinePlayback(): Promise<number> {
  const base = getRelayAddr();
  if (!base) return Promise.resolve(0);
  return fetch(`${base}/api/ui/playback/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'closeAll' }),
    cache: 'no-store',
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => Number(j?.closed || 0))
    .catch(() => 0);
}

/**
 * 把播放会话还回去。
 *
 * **不还的话会撞 429。** 短剧库那边每开一个 playback/open 就占一个名额
 * （internal/app/ui_playback.go:265：`activePlaybackSessionsLocked() >= MaxSessions`
 * 就回 429「同时播放数量已达上限，请稍后再试」），名额总数是配置的 MaxSessions。
 * 网页版每次切集/关面板都会发 `{session, action:'close'}`（player.js:216-220），
 * 我们第一版只 abort 了本地的流、**没告诉短剧库**，切几集就攒满几个名额，
 * 之后连开都开不出来。电脑上在播也占名额，所以会出现「电脑一播手机就 429」。
 *
 * 用 sendBeacon 是为了页面已经在跳走时也能送到；发不出去就拉倒，
 * 短剧库那边还有闲置超时兜底。
 */
export function closeOnlinePlayback(session: string, progress?: number): void {
  if (!session) return;
  const base = getRelayAddr();
  if (!base) return;
  forgetSession(session);
  const body = JSON.stringify({ session, action: 'close', ...(progress ? { progress } : {}) });
  const url = `${base}/api/ui/playback/control`;
  try {
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch { /* 落到下面的 fetch */ }
  try {
    void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { /* 还不回去就算了，有闲置超时兜底 */ }
}

/**
 * 拉一集的在线流，边下边喂给播放器。
 *
 * 跟 fetchVideoBytes 的区别是**不整集下完再播**：在线流是转码出来的长连接
 * （实测 112 秒那集拉了 40 秒才结束），整集下完再播等于白等。
 * 用 MediaSource 一段段 appendSourceBuffer，播完这一集就把会话释放掉。
 *
 * **必须带「首包超时」看门狗。**（2026-10-06 凌晨从短剧库日志查出来的）
 * 红果的在线源在续读时会挂，日志里全是：
 *   「媒体续读资源已变化」
 *   「媒体续读未返回所需字节范围（HTTP 403）」
 * 短剧库拉不到就**自己一直重试**（同一集 `run` 字段一路涨到 15），
 * 而它重试期间**那个会话一直占着并发名额** —— 名额总共只有 4 个，
 * 所以一集坏掉，其他人（和电脑网页版）全被连带，然后满屏 429。
 *
 * 源的问题我们改不了（红果 CDN 的事），但「一集坏掉就把名额占死」能防：
 * 超过 STREAM_FIRST_BYTE_TIMEOUT 还没收到第一个字节，就主动断开并报错，
 * 外层 catch 会立刻 `closeOnlinePlayback(session)` 把名额还回去。
 */
const STREAM_FIRST_BYTE_TIMEOUT = 30000;

export async function streamOnlineEpisode(
  session: string,
  episode: number,
  signal: AbortSignal,
  onBytes?: (loaded: number) => void
): Promise<{ url: string; mime: string; cleanup: () => void }> {
  const base = getRelayAddr();
  if (!base) throw new Error('还没连上电脑');

  // 内部自己的一套 signal：外层切集/退页要能中断它，看门狗也要能中断它，
  // 而这两者要能区分（「用户切走了」和「这一集拉不下来」给的提示不一样）。
  const inner = new AbortController();
  let timedOut = false;
  let firstByteSeen = false;
  const relayAbort = () => inner.abort();
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
  signal.addEventListener('abort', relayAbort);

  const watchdog = setTimeout(() => {
    if (!firstByteSeen) {
      timedOut = true;
      inner.abort();
    }
  }, STREAM_FIRST_BYTE_TIMEOUT);
  const clearWatchdog = () => {
    clearTimeout(watchdog);
    signal.removeEventListener('abort', relayAbort);
  };

  const url =
    `${base}/api/ui/playback/stream?session=${encodeURIComponent(session)}` +
    `&episode=${episode}&start=0&quality=0&version=1&remux=0`;

  let resp: Response;
  try {
    resp = await fetch(url, { cache: 'no-store', signal: inner.signal });
  } catch (e) {
    clearWatchdog();
    if (timedOut) throw new Error('电脑那边这一集一直拉不下来（多半是红果源抽风），播放位已经还回去了，换一集试试');
    throw e;
  }
  if (!resp.ok || !resp.body) {
    clearWatchdog();
    throw new Error(`在线播放失败 HTTP ${resp.status}`);
  }
  // 拿到响应头就认为「开始了」：短剧库转码要时间，那段时间是没有 body 的，
  // 但会话已经是活的，不该再被看门狗打断。之后再慢也无所谓。
  clearWatchdog();

  /**
   * 挑一个这台设备**真能播**的编码，写死一个值是不行的。
   *
   * 真机 23:5x 踩的：原来兜底是裸的 `video/mp4`，结果 vivo 那台机器直接
   *   NotSupportedError: The type provided ('video/mp4') is unsupported
   * 整个在线剧一个都放不出来（而下载到手机的剧走整集文件、不经过这里，所以照常能播，
   * 现象就是「下载好的能看、在线的一个不行」）。
   *
   * 原因是 `MediaSource.addSourceBuffer` 对**不带 codecs 的 video/mp4** 相当挑剔，
   * 同一个视频在 iOS/桌面 Chrome 上没事、在部分安卓 WebView 上直接拒收。
   * 那台机器实测：
   *   video/mp4                              → 不支持
   *   video/mp4; codecs="avc1.42C01F, ..."   → 支持   （Baseline）
   *   video/mp4; codecs="avc1.64001F, ..."   → 支持   （High）
   *
   * 短剧库自己也是这个口径（`ui_playback.go:18` 的 playbackMIME 就是 Baseline 那个）。
   * 顺序上先信短剧库给的头（它知道自己转成了什么），读不到再从候选里挑设备支持的。
   */
  const candidates = [
    resp.headers.get('X-Playback-MIME') || resp.headers.get('X-Playback-Mime') || '',
    'video/mp4; codecs="avc1.42C01F, mp4a.40.2"',
    'video/mp4; codecs="avc1.64001F, mp4a.40.2"',
  ].filter(Boolean);

  let mime = '';
  for (const c of candidates) {
    if (MediaSource.isTypeSupported(c)) { mime = c; break; }
  }
  if (!mime) {
    // 到这一步就别让 addSourceBuffer 去抛那个天书般的 NotSupportedError 了，
    // 说人话，并且**把真凶告诉他**：这台设备的内核扛不住在线边下边播。
    throw new Error(
      '这台手机的内核放不了在线边下边播。下载到手机里的剧不受影响，照样能看。'
    );
  }

  const ms = new MediaSource();
  const msUrl = URL.createObjectURL(ms);

  const done = (async () => {
    await new Promise<void>((resolve) => {
      ms.addEventListener('sourceopen', () => resolve(), { once: true });
    });
    const sb = ms.addSourceBuffer(mime);
    const reader = resp.body!.getReader();
    let loaded = 0;
    for (;;) {
      const { done: fin, value } = await reader.read();
      if (fin) break;
      if (!value || !value.byteLength) continue;
      loaded += value.byteLength;
      onBytes?.(loaded);
      const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      await new Promise<void>((resolve, reject) => {
        sb.addEventListener('updateend', () => resolve(), { once: true });
        sb.addEventListener('error', () => reject(new Error('在线播放缓冲失败')), { once: true });
        try {
          sb.appendBuffer(buf);
        } catch (e: any) {
          reject(new Error(e?.message || '在线播放缓冲失败'));
        }
      });
    }
    try { ms.endOfStream(); } catch {}
  })();

  const cleanup = () => {
    try { inner.abort(); } catch {}
    try { resp.body?.cancel(); } catch {}
    try { URL.revokeObjectURL(msUrl); } catch {}
    clearWatchdog();
  };

  return { url: msUrl, mime, cleanup: () => { cleanup(); void done.catch(() => {}); } };
}


export type RelayDrama = {
  id: string;          // 形如 hongguo:7691205405866724414 —— 不是剧名
  title: string;
  coverUrl?: string;
  intro?: string;
  // 剧库里的集数字段（episodeCount / total / episodes）实测值都是 '1'，是假数据，
  // 所以这里根本不带出来。真集数只能问 playback/open 的 episodes 长度。
  source?: string;
  // ↓ 下面三个是实测真有的（10-05 重新核对过，之前说「集数全是假数据」说宽了）：
  //   categoryName  网页版的分类下拉框就是拿这个字段建的
  //                （短剧库源码 internal/webui/library.js:108 `map(categoryName)`，
  //                  筛选也是 `categoryName(drama) !== channel`，见同文件 99 行）
  //   onlineDate    "2026-10-05" 这种真日期，10444 条里 5001 条有
  //   episodeHint   红果/罐罐/饭锅站源这个值是真的（红果 2631 条里 0 条是 '1'），
  //                但黄豆 56% 是 '1'、大帝 100% 是 '1'，所以只当「先显示着」用，
  //                最终集数还是 playback/open 说了算
  categoryName?: string;
  onlineDate?: string;
  episodeHint?: number;
};

export type RelayTask = {
  id: string;
  dramaId?: string;
  dramaTitle?: string;
  episode: number;
  playable?: boolean;
  duration?: number;
  size?: number;
  // 实测：task 里的 total 是这一部剧真实集数（不是剧库列表里那个假的 episodeCount）
  total?: number;
  releaseStatus?: string;
};

export type RelaySource = {
  key: string;
  name: string;
  count: number;
  ready: boolean;
};

export type DramaSnapshot = {
  items: RelayDrama[];
  sources: RelaySource[];
  hasMore: boolean;
  total: number;
};

// 站源 key → 中文名。短剧库只回 key，界面上不能直接甩英文给暮色看。
const SOURCE_NAMES: Record<string, string> = {
  hongguo: '红果',
  huangdou: '黄豆',
  huangguo: '黄果',
  huangguoai: '黄果AI',
  'huangguo-video': '黄果视频',
  huaguo: '花果',
  yaguo: '亚果',
  piguo: '皮锅',
  guanguo: '罐罐',
  fanguo: '饭锅',
  heguo: '喝锅',
  dsd: '大帝',
  maoguo: '猫锅',
  niuguo: '牛锅',
  wuguo: '五锅',
  huangju: '黄剧',
  xingguo: '星锅',
  yeguo: '野锅',
  zuiguo: '最锅',
  cloudfront: '黄果CDN',
  emby: '本地',
};

export function sourceName(key: string): string {
  return SOURCE_NAMES[key] || key;
}

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

function mapDrama(d: any): RelayDrama {
  // episodeCount 和 totalEpisode 都见过，取大的那个；1 视为「没给」不当真
  const hint = Math.max(Number(d.episodeCount) || 0, Number(d.totalEpisode) || 0);
  return {
    id: d.id,
    title: d.title || d.name || '未命名',
    coverUrl: d.coverUrl || d.cover_url || d.imageUrl || d.image_url || d.cover || d.image,
    intro: d.intro || d.desc || '',
    source: d.source,
    categoryName: d.categoryName || undefined,
    onlineDate: d.onlineDate || undefined,
    episodeHint: hint > 1 ? hint : 0,
  };
}

/**
 * 剧库首页。
 * 实测一次就回全量（10444 条）+ sources（每个站源多少部、能不能用）+ hasMore。
 * sources 里 status=failed 的站源要滤掉，不然界面上会出现点进去空的分类。
 */
export async function fetchDramas(base: string): Promise<DramaSnapshot> {
  const j = await jget<any>(base, '/api/ui/dramas', 40000);
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
  const rawSources: any = j?.sources && typeof j.sources === 'object' ? j.sources : {};
  const sources: RelaySource[] = Object.keys(rawSources)
    .map((key) => {
      const s = rawSources[key] || {};
      return {
        key,
        name: sourceName(key),
        count: Number(s.count || 0),
        ready: s.status === 'ready' && Number(s.count || 0) > 0,
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    items: list.map(mapDrama),
    sources,
    hasMore: !!j?.hasMore,
    total: Number(j?.total || list.length),
  };
}

/**
 * 剧库首页的分类不用这个接口。
 * /api/ui/categories 回的是站源侧的内容类型（真人剧/漫剧/AI剧），
 * 剧库里没有哪个字段对得上，筛不出东西。
 * 网页版的分类下拉框是自己按 categoryName 汇总的
 * （短剧库源码 internal/webui/library.js:106-117 rebuildChannels，
 *  同文件 99 行按 `categoryName(drama) !== channel` 过滤），App 照抄这个做法。
 */

/** 电脑上（网页版播放器）看过的剧，合进「正在追剧」用 */
export async function fetchMacWatchHistory(base: string): Promise<any[]> {
  const j = await jget<any>(base, '/api/ui/playback/history', 15000);
  return Array.isArray(j?.data) ? j.data : [];
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
    total: Number(t.total || 0),
    releaseStatus: t.releaseStatus,
  }));
}

/** 搜剧（只有红果源支持联网搜索，黄豆源不支持） */
export async function searchDramas(base: string, q: string): Promise<RelayDrama[]> {
  const j = await jget<any>(base, `/api/ui/search?q=${encodeURIComponent(q)}&source=hongguo`, 25000);
  const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : [];
  return list.map((d) => ({ ...mapDrama(d), source: d.source || 'hongguo' }));
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
