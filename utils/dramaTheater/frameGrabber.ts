/**
 * 剧场第 3 步：把画面喂给角色（第 1 步的配套）。
 *
 * ## 为什么单独一个文件
 * 抓帧、压缩、判重是有**确定规律**的一套东西（下面三个数字都是算出来的），
 * 散进组件里改一个参数就会漏掉另外两处。这里全收在一处。
 *
 * ## 三条规矩（`notes/2026-10-06-剧场第2步方案-实时版.md` §二.2）
 *
 * 1. **压到 320 宽、质量 0.5** → 一帧 8~15KB。
 *    320 是「认得出人和场景、又不至于糊到看不出表情」的那个宽度。
 *    ⚠️ 不压的话一帧 55KB，画面又是每秒好几帧，手机会先卡死。
 *    （带宽本身不是问题，暮色 01:39 说连 Wi-Fi —— 但**手机扛不扛得住**是另一回事。）
 *
 * 2. **画面没变化就不送**。判据是跟上一帧比差异大小，不是按固定间隔切。
 *    切镜头 / 剧情往前走 → 变了 → 送；
 *    一整段不动的对话镜头 → 没变 → 一帧都不送。
 *    这样省下的不是流量，是**不让它对着重复画面反复琢磨**。
 *
 * 3. **每次都带上播放进度**。
 *    ⚠️ 画面本身不带「第几分钟」。第 2 步那会儿提示词里故意不写进度
 *    （写的是开场读一次的假数字，比不写更糟）。接上画面后要**逐帧带真实进度**，
 *    它说「刚才是谁」的时候才真的是看见了，不是背了个开头数字。
 *
 * ## 一个必须知道的坑
 * 抓帧要过 `drawImage(video)`，而 **`video` 上有 CORS 跨源的话会污染画布**，
 * `toDataURL` 直接抛安全错误。线上流是走 blob 的（同源），没事；
 * 万一哪天接了跨源地址，这里要换成 `crossOrigin='anonymous'` 并且服务端给 CORS 头。
 */

export type Frame = {
  /** base64，不带前缀（live 协议要的就是裸 base64） */
  data: string;
  /** 当前播放到第几秒 */
  at: number;
  /** 这一帧跟上一帧差多少（0~1），给诊断用 */
  diff: number;
  width: number;
  height: number;
};

/** 抓下来的帧的目标宽度。超过这个就等比缩 */
const TARGET_W = 320;
/** JPEG 质量。0.5 是「脸还认得出、大小砍一半」的那档 */
const JPEG_Q = 0.5;
/**
 * 变化阈值：跟上一帧的平均像素差小于这个就认为「没变」，不送。
 *
 * 取 0.012（约 1.2%）的依据：压缩噪点和轻微的呼吸/抖动落在这个量级，
 * 而切镜头、人物走位、说话时的嘴型变化明显超过它。
 */
const DIFF_SKIP = 0.012;
/** 两帧对比用的取样格数。越多越准也越慢，64 格够用了 */
const GRID = 8;

export class FrameGrabber {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  /** 上一次送出去的画面，缩到 GRID×GRID 的灰度，用来判重 */
  private prevGray: Uint8ClampedArray | null = null;
  private prevAt = -1;

  private ensureCanvas(w: number, h: number) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * 抓一帧。没变化返回 null。
   *
   * @param video   视频元素
   * @param force   true = 不判重，硬送（切集、用户点了播放这类时候用）
   */
  grab(video: HTMLVideoElement, force = false): Frame | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // 还没解码出画面
    if (!vw || !vh) return null;

    const scale = vw > TARGET_W ? TARGET_W / vw : 1;
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    this.ensureCanvas(w, h);
    const ctx = this.ctx;
    if (!ctx) return null;

    try {
      ctx.drawImage(video, 0, 0, w, h);
    } catch {
      // 跨源污染之类。宁可不送，也不要把整个页面的实时会话带崩
      return null;
    }

    let out: Frame;
    try {
      // ⚠️⚠️ 顺序不能换：**先取干净的灰度快照判重，再画时间戳，最后导出**。
      //
      // 时间戳是烧进图里的（`stamp`），而判重用的就是这张画布的灰度。
      // 反过来做的话，每帧左上都多一行不同的秒数 → 灰度永远不一样 →
      // `diff` 永远大于阈值 → 「没变化就不送」那道闸**整个失效**，
      // 每 1.2 秒都硬送一张，token 悄悄翻好几倍，而你以为只改了个标注。
      const gray = this.snapshotGray(w, h);
      let diff = 1;
      if (this.prevGray && !force) {
        diff = meanDiff(this.prevGray, gray);
        if (diff < DIFF_SKIP && Math.abs(video.currentTime - this.prevAt) < 0.4) return null;
      } else if (this.prevGray && force) {
        diff = meanDiff(this.prevGray, gray);
      }
      this.prevGray = gray;
      this.prevAt = video.currentTime;

      // 标上「这会儿在播第几分几秒」
      this.stamp(video.currentTime, w);

      const data = this.canvas!.toDataURL('image/jpeg', JPEG_Q).split(',')[1] || '';
      if (!data) return null;
      out = { data, at: video.currentTime, diff, width: w, height: h };
    } catch {
      return null;
    }
    return out;
  }

  /**
   * 在画面左上角烧一行「第 3:20」——**只画在送给模型的那张图上，不影响用户看到的画面**
   * （用户看的是 `<video>` 本身，跟这里没关系）。
   *
   * ## 为什么要烧进图里，而不是跟图一起发一句文字
   *
   * 时间标记以前是**攒着**的，只在用户开口时拼在他话前面（`liveSession.bgNote`）。
   * 后果：模型平时收到的是**一堆不知道发生在什么时候的图片**，十几张乱序堆着
   * 根本串不起来 —— 它连「这是第几分钟」都不知道，只能说「我不知道演了什么」
   * （暮色 10-08 15:54 现场）。
   *
   * ## 为什么不用 `realtimeInput.parts` 之类的多段结构
   *
   * 写错的字段服务端**不报错，静默忽略**（见 `sendFrame` 的注释）。
   * 那种「改了没反应」的失败最难查，不如用最土的办法：画在图上，零协议风险。
   */
  private stamp(at: number, w: number) {
    const ctx = this.ctx;
    if (!ctx || at <= 0) return;
    const mm = Math.floor(at / 60);
    const ss = Math.floor(at % 60);
    const label = `第 ${mm}:${String(ss).padStart(2, '0')}`;
    const fs = Math.max(11, Math.round(w / 36));
    try {
      ctx.save();
      ctx.font = `bold ${fs}px sans-serif`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, tw + fs * 0.7, Math.round(fs * 1.5));
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(label, Math.round(fs * 0.35), Math.round(fs * 0.22));
      ctx.restore();
    } catch { /* 画不上就算了，不影响画面本身 */ }
  }

  /** 把画面缩成 GRID×GRID 的灰度数组（用来判重，不参与发送） */
  private snapshotGray(w: number, h: number): Uint8ClampedArray {
    const g = document.createElement('canvas');
    g.width = GRID;
    g.height = GRID;
    const c = g.getContext('2d', { willReadFrequently: true });
    if (!c) return new Uint8ClampedArray(GRID * GRID);
    c.drawImage(this.canvas!, 0, 0, GRID, GRID);
    const d = c.getImageData(0, 0, GRID, GRID).data;
    const out = new Uint8ClampedArray(GRID * GRID);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) out[j] = d[i];
    return out;
  }

  /** 换集 / 重置：下一帧强制送一次 */
  reset() {
    this.prevGray = null;
    this.prevAt = -1;
  }
}

/** 两个灰度数组的平均差，归一化到 0~1 */
function meanDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n / 255;
}

/** base64 → ArrayBuffer（live 协议要裸 base64 字符串，这个留着给要 Uint8 的场合） */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}