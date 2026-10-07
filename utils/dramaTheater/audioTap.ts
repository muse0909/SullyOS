/**
 * 剧场第 3 步：从视频里抽声音，喂给角色。
 *
 * ## 为什么需要单独一个文件
 * 从 `<video>` 里取声音在手机 WebView 上有一串**具体的坑**（见下面三条），
 * 每一条都是「不这么写就完全没声音」，值得单独钉住。
 *
 * ## 三个坑
 *
 * 1. **音频要重采样到 16kHz 的裸 PCM**（官方硬要求）。
 *    视频里的声音通常是 44.1kHz 或 48kHz。降采样用线性插值 —— 别上相位声之类的，
 *    语音识别上听不出差别，但计算量差一个数量级，手机扛不住。
 *
 * 2. **接了 AudioNode 之后必须同时接回扬声器**，否则用户听不到声音。
 *    `createMediaElementSource` 会把声音从「元素直接输出」改成「经过 Web Audio」。
 *    只接采集端不接 `destination`，用户的手机就哑了。
 *
 * 3. **音频来自跨源地址时会变哑**（安全策略）。
 *    跟抽帧那个坑是同一个（CORS）。短剧库线上流是 blob（同源），没事。
 *
 * ## 为什么用 ScriptProcessor 不用 AudioWorklet
 * AudioWorklet 更准，但它要加载一个独立模块文件 —— 打包成单文件 app 之后
 * 那个 URL 不好给。ScriptProcessor 官方标了废弃，但所有 WebView 都还在用，
 * 而且我们只是「顺便听一下」，对精度没要求。
 *
 * ## 一段声音值多少
 * 16kHz × 16 位 = 每秒 32KB。100ms 一包 = 3.2KB。
 * 一集三分钟的剧，就算整集都在送，也就 5.8MB —— Wi-Fi 下无所谓。
 */

const TARGET_RATE = 16000;
/** 官方建议 100ms 一包（1024~2048 个采样点）。1600 个正好 100ms */
const CHUNK_SAMPLES = 1600;

export class AudioTap {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private proc: ScriptProcessorNode | null = null;
  private el: HTMLMediaElement | null = null;
  /** 重采样后的待发队列，按采样点计 */
  private outBuf: Float32Array = new Float32Array(0);
  private inRate = 48000;
  /** 已经接过的元素 —— 同一个 video 只能 createMediaElementSource 一次，第二次直接抛 */
  private attached = false;

  /**
   * 接上视频元素。返回 false = 接不上（这时画面那条路还在，不影响）
   *
   * ⚠️⚠️ **元素换了要整条链重建**（10-07 顺手修的既有 bug）。
   *
   * 原来是 `if (this.attached) return true;` —— 一旦接上就永远说「接好了」。
   * 但**切集会让 video 元素整个重建**（PlayerStage 里 `key={src}`，
   * 为了让旧画面别继续播）。于是新一集的视频元素**从来没被接过**，
   * `attached` 却还是真 —— 采到的是已经销毁的旧元素的数据，
   * 表现是**切集之后角色就听不见声音了**，而且没有任何报错。
   *
   * ⚠️ 千万别把这里写成「先 detach 再无条件 attach 同一个元素」：
   * `createMediaElementSource` 对**同一个元素**只能调一次，第二次直接抛。
   * 文件头「坑 3」记的就是这个。**换元素是安全的**（一个元素一个 SourceNode），
   * 不安全的是重复接同一个。所以判据是「是不是同一个元素」，不是「有没有接过」。
   */
  attach(el: HTMLMediaElement): boolean {
    if (this.attached && this.el === el) return true;
    // 换了新元素 —— 旧的整条链先彻底拆掉（不拆的话旧 ctx 一直在跑，白耗电）
    if (this.attached) this.teardown();
    const Ctor: any =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return false;
    try {
      const ctx: AudioContext = new Ctor();
      const source = ctx.createMediaElementSource(el);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => this.onAudio(e);
      source.connect(proc);
      // ⚠️ 必须接回扬声器（坑 2）。不接这句用户手机就哑了。
      proc.connect(ctx.destination);
      // 全都接成功了再落属性 —— 中途抛异常就一个都不留
      this.el = el;
      this.ctx = ctx;
      this.source = source;
      this.proc = proc;
      this.inRate = ctx.sampleRate || 48000;
      this.attached = true;
      return true;
    } catch (e) {
      // 跨源污染 / 已被接过 —— 认了，画面那条路继续走
      this.teardown();
      return false;
    }
  }

  /** 把整条采集链拆干净，回到「没接过」的状态 */
  private teardown() {
    try { this.proc?.disconnect(); } catch {}
    // ⚠️ 可选链**不能**写在赋值左边（TS2779），得先取出来判空
    try { const p: any = this.proc; if (p) p.onaudioprocess = null; } catch {}
    try { this.source?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.proc = null;
    this.source = null;
    this.ctx = null;
    this.el = null;
    this.attached = false;
    // 队列里攒的是**上一集**的声音，别带进新一集
    this.outBuf = new Float32Array(0);
  }

  /** 浏览器要求音频上下文在用户手势后才能跑 */
  resume() {
    try { if (this.ctx?.state === 'suspended') this.ctx.resume(); } catch {}
  }

  private onAudio(e: AudioProcessingEvent) {
    if (!this.ctx) return;
    const input = e.inputBuffer.getChannelData(0);
    const rs = this.resample(input);
    // 追加到待发队列
    const merged = new Float32Array(this.outBuf.length + rs.length);
    merged.set(this.outBuf, 0);
    merged.set(rs, this.outBuf.length);
    this.outBuf = merged;
  }

  /** 线性插值降采样到 16kHz（坑 1） */
  private resample(input: Float32Array): Float32Array {
    if (this.inRate === TARGET_RATE) return input;
    const ratio = this.inRate / TARGET_RATE;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const a = input[idx] ?? 0;
      const b = input[idx + 1] ?? a;
      out[i] = a + (b - a) * frac;
    }
    return out;
  }

  /**
   * 取一包 100ms 的 16kHz PCM（裸的，等下自己 base64）。
   * 没有攒够就返回 null。
   */
  takeChunk(): Float32Array | null {
    if (this.outBuf.length < CHUNK_SAMPLES) return null;
    const chunk = this.outBuf.slice(0, CHUNK_SAMPLES);
    this.outBuf = this.outBuf.slice(CHUNK_SAMPLES);
    return chunk;
  }

  /** 攒了多少采样点了（诊断用） */
  get pending(): number {
    return this.outBuf.length;
  }

  /** 把攒着的丢掉 —— 换集/离开播放页时叫，不然上一集的声音会串到下一集 */
  flush() {
    this.outBuf = new Float32Array(0);
  }

  /**
   * ⚠️ **不要在正常流程里调这个。**
   *
   * 一个 `<video>` 元素只能 createMediaElementSource 一次，第二次直接抛。
   * 而换集不换元素（同一个标签），所以「离开 → detach → 再来」这条路上
   * detach 完就再也采不到声音了。这个方法留着是给「组件真的卸载、
   * 元素不会再用」的场合，正常进出播放页请走 flush()。
   */
  detach() {
    try { this.proc?.disconnect(); } catch {}
    try { this.source?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
    this.proc = null;
    this.source = null;
    this.ctx = null;
    this.el = null;
    this.attached = false;
    this.outBuf = new Float32Array(0);
  }
}

/** Float32 [-1,1] → 16 位小端 PCM 的 base64（官方要的格式） */
export function floatToPcmBase64(chunk: Float32Array): string {
  const buf = new ArrayBuffer(chunk.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < chunk.length; i++) {
    let s = Math.max(-1, Math.min(1, chunk[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)) as any);
  }
  return btoa(bin);
}