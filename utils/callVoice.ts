/**
 * callVoice.ts — 通话语音采集
 *
 * 麦麦 2026-09-29：打电话功能从"打字"升级成"说话"的底层。
 *
 * 为什么不用 @capacitor-community/media：
 *   那个插件能录完整音频文件，但它只能在**录完之后**拿到文件，
 *   拿不到"此刻正在说话的音量"。而打电话必须有实时音量——
 *   一是用来判断你什么时候说完了，二是通话界面上得让你看到自己在说话。
 *   所以这里直接用浏览器标准的录音接口，自己控制每一块采样。
 *
 * 输出的音频规格（按 MiniMax 语音识别接口的要求定）：
 *   单声道 / 16000 Hz / 16-bit PCM / WAV 封装
 *   官方说明：识别不依赖高采样率与立体声，转成单声道 16k 识别率不受影响，
 *   但上传体积会小一半（50MB 上限更不容易碰到）。
 *
 * 第一阶段只负责"录得到"，不负责"转文字"——转文字在下一阶段。
 */

export interface CallVoiceRecording {
  /** 录出来的音频，单声道 16k WAV */
  blob: Blob;
  /** 实际录了多久（毫秒） */
  durationMs: number;
  /** 采样率，固定 16000 */
  sampleRate: number;
}

export interface CallVoiceStartOptions {
  /** 音量变化时的回调，参数 0~1 */
  onVolume?: (volume: number) => void;
  /** 静音超过阈值时长时触发（表示"你大概说完了"） */
  onSilence?: (silentMs: number) => void;
  /** 采集过程中被系统打断（来电、切后台、拔耳机） */
  onInterrupted?: (reason: string) => void;
}

/** 采集参数 */
const TARGET_SAMPLE_RATE = 16000;
const SCRIPT_BUFFER_SIZE = 4096;

/** 静音判定：音量低于这个值算"没在说" */
const SILENCE_THRESHOLD = 0.02;
/** 静音判定：连续这么多次采样没声音，认为你说完了 */
const SILENCE_TICK_MS = 120;
const DEFAULT_SILENCE_MS = SILENCE_TICK_MS * 5; // 约 600ms

/** 单次录音最长时长，防止内存爆掉（官方接口上限 500 秒，这里留余量） */
const MAX_RECORDING_MS = 5 * 60 * 1000;

const mimeCandidates = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

const isAudioRecordingSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  const md = navigator.mediaDevices;
  if (!md || typeof md.getUserMedia !== 'function') return false;
  return !!(window.AudioContext || (window as any).webkitAudioContext);
};

/** 把浏览器拒 microphones 给的中文原因翻译一下，别把英文报错甩给暮色 */
const describeMediaError = (err: any): string => {
  const name = String(err?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限被拒了';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '没找到麦克风';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '麦克风被别的程序占着了，关掉再试';
  if (name === 'AbortError') return '麦克风启动被打断';
  if (name === 'OverconstrainedError') return '麦克风不支持所需的参数';
  return err?.message || '麦克风打不开';
};

/**
 * 线性插值重采样到目标采样率。
 * 浏览器给的 AudioContext 通常是 44100 / 48000，接口要 16000。
 */
const resample = (input: Float32Array, inputRate: number, outputRate: number): Float32Array => {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] || 0;
    const b = input[idx + 1] ?? a;
    output[i] = a + (b - a) * frac;
  }
  return output;
};

/** Float32 [-1,1] → 16-bit PCM */
const floatTo16BitPcm = (input: Float32Array): Int16Array => {
  const buffer = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    buffer[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return buffer;
};

/** 给 PCM 数据套一个标准 44 字节 WAV 文件头 */
const buildWavBlob = (pcm: Int16Array, sampleRate: number): Blob => {
  const bytesPerSample = 2;
  const channelCount = 1;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);            // fmt chunk 大小
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);            // 位深
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i += 1) {
    view.setInt16(offset, pcm[i], true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

export class CallVoiceRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mimeType = '';

  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private running = false;

  private options: CallVoiceStartOptions = {};
  private rafId: number | null = null;
  private silentTicks = 0;
  private silenceFired = false;
  private lastTrackEnded: (() => void) | null = null;

  static isSupported(): boolean {
    return isAudioRecordingSupported();
  }

  get isRecording(): boolean {
    return this.running;
  }

  /** 主动申请权限（提前调一次，进入通话页时用，避免第一次按住才弹窗显得慢） */
  static async preflight(): Promise<{ ok: boolean; message?: string }> {
    if (!isAudioRecordingSupported()) {
      return { ok: false, message: '当前环境不支持录音' };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return { ok: true };
    } catch (err: any) {
      return { ok: false, message: describeMediaError(err) };
    }
  }

  async start(options: CallVoiceStartOptions = {}): Promise<void> {
    if (this.running) return;
    this.options = options;
    this.chunks = [];
    this.silentTicks = 0;
    this.silenceFired = false;
    this.lastTrackEnded = null;

    if (!isAudioRecordingSupported()) {
      throw new Error('当前环境不支持录音');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,   // 尽量别把它自己扬声器的声音收回去
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    // 通话被系统打断（来电 / 切后台 / 拔耳机）时要通知前端，不能静默死掉
    const track = this.stream.getAudioTracks()[0];
    if (track) {
      this.lastTrackEnded = () => {
        if (this.running) this.options.onInterrupted?.('麦克风被系统中断了');
      };
      track.addEventListener('ended', this.lastTrackEnded);
    }

    const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.audioContext = new AudioCtor();
    // 安卓上 AudioContext 经常是 suspended，不 resume 就完全没数据
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => { /* resume 失败下面 state 检查会兜住 */ });
    }

    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.source.connect(this.analyser);

    const inputRate = this.audioContext.sampleRate || 44100;

    // ScriptProcessor 虽然官方标了废弃，但兼容性最好（不需要额外加载 worklet 文件），
    // 通话场景够用。等真需要更省电时再换 AudioWorklet。
    const processor = this.audioContext.createScriptProcessor(SCRIPT_BUFFER_SIZE, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!this.running) return;
      const input = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(input));
    };
    this.processor = processor;
    this.source.connect(processor);
    // ScriptProcessor 必须连到 destination 才会触发 onaudioprocess。
    // 接一个静音增益节点，避免录自己的声音被放大外放出去。
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);

    this.mimeType = '';
    for (const candidate of mimeCandidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(candidate)) {
        this.mimeType = candidate;
        break;
      }
    }

    this.startedAt = Date.now();
    this.running = true;
    this.loopVolume(inputRate);
  }

  /** 音量轮询 + 静音判定。音量用 Analyser 实时算，比从 processor 拿更平滑。 */
  private loopVolume = (_inputRate: number) => {
    const analyser = this.analyser;
    if (!analyser) return;

    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (!this.running || !this.analyser) return;
      analyser.getByteTimeDomainData(buffer);

      // 算均方根，范围大概 0~0.5，除个系数映射到 0~1
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const value = (buffer[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const volume = Math.max(0, Math.min(1, rms * 3.2));
      this.options.onVolume?.(volume);

      // 静音判定
      if (volume < SILENCE_THRESHOLD) {
        this.silentTicks += 1;
        if (!this.silenceFired && this.silentTicks * SILENCE_TICK_MS >= DEFAULT_SILENCE_MS) {
          this.silenceFired = true;
          this.options.onSilence?.(this.silentTicks * SILENCE_TICK_MS);
        }
      } else {
        this.silentTicks = 0;
        this.silenceFired = false;
      }

      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  };

  /** 停止并返回录到的音频。没录到东西返回 null。 */
  async stop(): Promise<CallVoiceRecording | null> {
    if (!this.running) return null;
    this.running = false;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const durationMs = Date.now() - this.startedAt;

    const inputRate = this.audioContext?.sampleRate || 44100;
    const totalLength = this.chunks.reduce((sum, c) => sum + c.length, 0);

    this.teardown();

    if (totalLength === 0 || durationMs < 200) return null;

    const merged = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];

    const resampled = resample(merged, inputRate, TARGET_SAMPLE_RATE);
    const pcm = floatTo16BitPcm(resampled);
    const blob = buildWavBlob(pcm, TARGET_SAMPLE_RATE);

    return { blob, durationMs, sampleRate: TARGET_SAMPLE_RATE };
  }

  /** 中途放弃（挂断 / 切 app），丢掉已录内容 */
  cancel(): void {
    if (!this.running) {
      this.teardown();
      return;
    }
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.chunks = [];
    this.teardown();
  }

  /** 录太久了自动截断保护 */
  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  get isOvertime(): boolean {
    return this.elapsedMs > MAX_RECORDING_MS;
  }

  private teardown() {
    try {
      this.processor?.disconnect();
      this.processor = null;
      this.source?.disconnect();
      this.source = null;
      this.analyser?.disconnect();
      this.analyser = null;
    } catch { /* 断开失败无所谓，反正下面要全关 */ }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        if (this.lastTrackEnded) track.removeEventListener('ended', this.lastTrackEnded);
        track.stop();
      });
      this.stream = null;
    }
    this.lastTrackEnded = null;

    if (this.audioContext) {
      this.audioContext.close().catch(() => { /* 关不掉就算了，浏览器会回收 */ });
      this.audioContext = null;
    }
  }
}

/** 把浏览器拒绝麦克风时抛出的原因翻译成中文（导出给上层用） */
export { describeMediaError as describeCallVoiceError };
