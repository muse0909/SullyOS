/**
 * 封面图诊断（10-06 真机「海报完全不显示」）。
 *
 * ## 为什么要这个
 * 电脑这边能查的全查过了，都是好的：
 *   短剧库 12314 部剧、封面字段齐全；抽 36 张不同站源实测，36/36 是真图（jpeg/webp）、
 *   3~20ms 就回来；跨域头 / 缓存头 / 私网头都正确；转发服务健康；拼地址的 19 处调用点全带
 *   电脑地址；装进 apk 的配置里 `allowMixedContent: true` 在**顶层**（CapConfig 就是读顶层
 *   这个键，Bridge 才据此设 MIXED_CONTENT_ALWAYS_ALLOW）。
 *
 * 也就是说：**服务端、代码、配置全对，只有手机上不出图。**
 * 这种「两边都对不上」的 bug 靠读代码永远读不出来 —— 必须让被测对象自己说话。
 * （同一个教训在 10-06 那晚已经吃过一次：连着四次先改代码再验证，全错。）
 *
 * ## 关键字段是 `currentSrc`
 * `img.src` 是我们写进去的，`img.currentSrc` 是**内核最终真去请求的那个地址**。
 * 两者不一致 = 内核在中间动了手脚，最典型的是 **http 被自动升级成 https**：
 * https 页面里的 http 图片，浏览器默认先试着走 https，电脑上的转发服务没有 https，
 * 于是升级失败 → 图片加载不出来，但 `<img>` 不报错、不抛异常，只是 `naturalWidth === 0`。
 * 界面上表现就是「一片图标占位，什么都不报」—— 完全看不出是这个原因。
 *
 * ## 怎么用
 * 剧场右上角「查图」按钮 → 弹窗点「重新检测」→ 截图发回来。
 * 页面侧同时挂 `window.__theaterDiag`，能用调试通道直接读也行。
 */

export type CoverRecord = {
  src: string;
  currentSrc: string;
  /** 内核最终有没有真的把图取回来（naturalWidth > 0） */
  ok: boolean;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  at: number;
};

const MAX_RECORDS = 60;

const g = globalThis as any;

function bucket(): CoverRecord[] {
  if (!Array.isArray(g.__theaterCoverDiag)) g.__theaterCoverDiag = [];
  return g.__theaterCoverDiag as CoverRecord[];
}

/**
 * 读一张已经挂上去的 `<img>`。取不到就只留地址。
 *
 * `currentSrc` 在图片真正开始加载之前是空串，所以这个函数可能在
 * onLoad 之后还能拿到更有价值的信息 —— 两个时机都记，以最后一次为准。
 */
export function probeCover(img: HTMLImageElement | null | undefined, src: string): CoverRecord {
  const rec: CoverRecord = {
    src,
    currentSrc: img?.currentSrc || '',
    ok: !!img && img.complete && img.naturalWidth > 0,
    complete: !!img && img.complete,
    naturalWidth: img?.naturalWidth || 0,
    naturalHeight: img?.naturalHeight || 0,
    at: Date.now(),
  };
  const list = bucket();
  // 同一个地址只留最新的一条，别把 36 张图刷成 72 行
  const i = list.findIndex((x) => x.src === src);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
  if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
  publish();
  return rec;
}

function publish() {
  g.__theaterDiag = snapshot();
}

/** 页面环境 —— 一起报上去，不然没法判断是「混合内容」还是别的 */
export function pageEnv() {
  const loc = typeof location !== 'undefined' ? location : ({} as Location);
  const mixed = bucket().filter((x) => x.src !== x.currentSrc && x.currentSrc);
  return {
    href: loc.href || '',
    protocol: loc.protocol || '',
    host: loc.host || '',
    /** 页面源是 https、海报是 http 的话，这里两条会一真一假 */
    pageIsHttps: loc.protocol === 'https:',
    /** 实际统计：有多少张图的「内核地址」跟「我们给的地址」不一样 */
    upgraded: mixed.length,
    total: bucket().length,
    loaded: bucket().filter((x) => x.ok).length,
    failed: bucket().filter((x) => !x.ok && x.complete).length,
    records: bucket().slice(-12).reverse(),
  };
}

export function snapshot() {
  return pageEnv();
}

/**
 * 主动发一次请求，绕开 `<img>` 直接看结果。
 * 用来区分「地址根本够不着」和「够得着了但没显示」——
 * 后者说明请求成功了，问题在内核显示/安全策略那层。
 */
export async function refetchOne(src: string, timeoutMs = 8000) {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(src, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(timer);
    const blob = await r.blob();
    return {
      src,
      ms: Date.now() - t0,
      ok: r.ok,
      status: r.status,
      type: blob.type,
      size: blob.size,
      note: r.ok && blob.size > 1000 ? '请求本身没问题 —— 那问题在内核显示/安全策略这一层' : '请求本身就失败了',
    };
  } catch (e: any) {
    return { src, ms: Date.now() - t0, ok: false, error: String(e?.message || e), note: '请求压根发不出去' };
  }
}

export function resetDiag() {
  g.__theaterCoverDiag = [];
  publish();
}