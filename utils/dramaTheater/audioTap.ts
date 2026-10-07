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

/**
 * 🔍 现场记录（10-07 17:07 加 —— **只读状态，一行行为都没改**）
 *
 * ## 为什么加这个
 *
 * 暮色反馈「一点声音都没有」，我连着两次都推错了方向：
 *   - 第一次推「切集重建通道 → 新通道睡着」，他说「刚进播放页就没声，还没切集」
 *   - 第二次推「唤醒调用被挡在 invited 后面」，他说「邀请了也还是没声」
 *
 * 两次都被现场否掉。**所以不再猜了**，先把数据记下来。
 * 真机复现一次，读这份记录就能一次分清四种可能：
 *   1. 压根没接上（attach 抛异常 / 跳过）
 *   2. 接上了但通道是睡的（`ctxState: 'suspended'`）← 睡着就一个字都不出声
 *   3. 接着但采不出数据（`pending` 一直是 0）
 *   4. 数据正常（那就是别的地方，比如音量为 0 / 播放器静音）
 *
 * 手机连调试口就能读：
 *   `window.__audioTap.log`    —— 时间线
 *   `window.__audioTap.now`    —— 最后一条
 *   `window.__audioTap.pending` —— 队列里攒了多少采样点（0 = 一直没出数据）
 */
function tapLog(step: string, extra?: Record<string, unknown>) {
  try {
    const w = window as any;
    if (!w.__audioTap) w.__audioTap = { log: [] };
    const t = w.__audioTap;
    t.log.push({ at: Date.now(), step, ...(extra || {}) });
    if (t.log.length > 120) t.log.splice(0, t.log.length - 120);
    t.now = t.log[t.log.length - 1];
  } catch { /* 记录失败不能影响功能 */ }
}

/** 给元素发个稳定编号，日志里才能看出「换了新元素」还是「同一个」 */
let EL_SEQ = 0;
function elId(el: any): string {
  try {
    if (!el) return 'null';
    if (!el.__tapId) el.__tapId = 'el' + (++EL_SEQ);
    return el.__tapId;
  } catch {
    return '未知';
  }
}

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

  /** 接上视频元素。返回 false = 接不上（这时画面那条路还在，不影响） */
  attach(el: HTMLMediaElement): boolean {
    tapLog('attach 调进来', {
      元素: elId(el), 手上那个: elId(this.el), attached: this.attached,
      通道状态: this.ctx?.state || '还没建',
    });
    if (this.attached) { tapLog('attach 直接返回（已接过）', {}); return true; }
    const Ctor: any =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) { tapLog('内核没有 AudioContext', {}); return false; }
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
      // 🔍 关键：通道建出来是什么状态。
      // 'suspended' = 睡着 = 一个字都不出声（接管了视频但没在跑）
      tapLog('接上了', { 元素: elId(el), 通道状态: ctx.state, 采样率: this.inRate });
      return true;
    } catch (e: any) {
      // 跨源污染 / 已被接过 —— 认了，画面那条路继续走
      tapLog('attach 抛异常', { 元素: elId(el), 错: String(e?.message || e) });
      return false;
    }
  }

  /** 浏览器要求音频上下文在用户手势后才能跑 */
  resume() {
    // 🔍 醒来到底成功没有 —— 「调用了」和「真的醒了」是两回事
    try {
      if (this.ctx?.state !== 'suspended') return;
      this.ctx.resume().then(
        () => tapLog('resume 成功', { 之后: this.ctx?.state }),
        (e: any) => tapLog('resume 被拒', { 错: String(e?.message || e), 还是: this.ctx?.state }),
      );
    } catch (e: any) {
      tapLog('resume 抛异常', { 错: String(e?.message || e) });
    }
  }

  /** 🔍 攒着的采样点数。0 = 一直没出数据（通道睡着就永远是 0） */
  // 说明：真正那个 getter 在下面（takeChunk 旁边），这里只补一句诊断用途。

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