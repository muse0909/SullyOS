/**
 * 封面图走「先取回来再显示」，不当成图片框的地址直接塞。
 *
 * ## 为什么
 * 10-06 真机取证拿到的硬证据，同一台手机、同一个地址、同一时刻：
 *   - 程序主动去取：`成功 · 180ms · 200 · 98KB image/jpeg`
 *   - 交给图片框去显示：60 张全部「卡住不动」，成功 0、失败 0、还在加载 60
 * 也就是说**地址没问题、请求能通，但图片框那条路就是加载不出来**。
 * 页面源是 https（Vercel）、图是 http（电脑局域网），图片框那条加载路额外有一层
 * 限制，程序主动取的那条不受影响。
 *
 * 这跟当初放视频踩的是同一个坑（1f838f27）：
 * 「allowMixedContent 只对程序主动取的那条路生效，显示的那条路安卓内核单独拦」。
 * 那次改法是「先取回整集变成手机本地的临时地址再播」，这次照抄。
 *
 * ## 为什么不能省掉限并发
 * 去掉图片框自己的懒加载之后，进剧场会一次性要 60 张。
 * 浏览器对同一个地址最多 6 个并发连接（HTTP/1.1），一口气全扔过去不是打不穿转发
 * 服务（实测 60 并发全部 200、平均 10ms），而是**排在队里的那些在图片框里一直显示
 * 不出来**，正是这次的现象。所以这里自己排个队，最多 4 个同时在飞。
 *
 * ## 为什么缓存不主动释放
 * 同一个地址到处都会用（首页、选集页、追剧页），缓存住省得重复取。
 * blob 地址在页面会话结束时由内核一起回收，不 revoke 是安全的；
 * 超过上限时只 evict 最老的一批并且**不 revoke** —— 那些图可能正在被某个 `<img>` 用着，
 * revoke 掉会让已经显示的图突然变空白。
 */

const MAX_CACHE = 200;
/**
 * 6 = 浏览器对同一个地址的并发连接上限（HTTP/1.1）。
 * 设小了纯属自己拖后腿：60 张图按 6 个一批是 10 批，按 4 个一批是 15 批。
 */
const MAX_ACTIVE = 6;

/** src → blob 地址。同一个地址只取一次 */
const cache = new Map<string, string>();
/** 正在飞的，避免同一张图并发取两遍 */
const inflight = new Map<string, Promise<string>>();

let active = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<void> {
  if (active < MAX_ACTIVE) { active++; return Promise.resolve(); }
  return new Promise<void>((resolve) => { waiting.push(resolve); });
}

function release() {
  active--;
  const next = waiting.shift();
  if (next) { active++; next(); }
}

/** 已经取过就直接拿，组件初次渲染时同步能给上，避免闪一下占位 */
export function cachedCoverUrl(src: string): string {
  return src ? cache.get(src) || '' : '';
}

/**
 * 取一张封面，变成手机本地的 blob 地址。
 * 失败会抛出去 —— 调用方记成「这张图挂了」，不要把整个页面的图连坐。
 *
 * ## 为什么重试一次
 * 进场立刻要 60 张，而同一时刻还有 21MB 的剧库列表在传。浏览器对同一个地址只有
 * 6 个连接，排队的那些**有概率压根没发出去就报 `Failed to fetch`** ——
 * 排队的失败跟地址不通是两回事，重试一次通常就成了。
 * 真不通的话重试也就多花 0.6 秒，划得来。
 */
export async function loadCoverBlob(src: string): Promise<string> {
  if (!src) return '';
  const hit = cache.get(src);
  if (hit) return hit;

  const already = inflight.get(src);
  if (already) return already;

  const task = (async () => {
    await acquire();
    try {
      let lastErr: any;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 600));
        try {
          const resp = await fetch(src, { cache: 'force-cache', silentFetch: true } as RequestInit);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          if (!blob.size || blob.type.indexOf('image/') !== 0) throw new Error('不是图片');
          const url = URL.createObjectURL(blob);
          cache.set(src, url);
          if (cache.size > MAX_CACHE) evictOldest();
          return url;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr;
    } finally {
      inflight.delete(src);
      release();
    }
  })();

  inflight.set(src, task);
  return task;
}

/**
 * 腾位置时**不立刻** revoke：被踢掉的那张图可能正被某个 `<img>` 用着，
 * 立刻 revoke 会让已经显示出来的图突然变空白。隔一分钟再放，这时引用早没了。
 */
function evictOldest() {
  const drop = cache.size - MAX_CACHE;
  let i = 0;
  for (const key of cache.keys()) {
    if (i++ >= drop) break;
    const url = cache.get(key);
    cache.delete(key);
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

/** 诊断用：缓存里有多少张 */
export function coverCacheSize(): number {
  return cache.size;
}