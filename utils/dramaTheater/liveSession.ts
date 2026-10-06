/**
 * 实时会话（gemini-3.8-live，走 WebSocket 直连 Google 官方）。
 *
 * ## 为什么必须封装在这一层
 * 协议细节（setup 字段、重连、恢复码、二进制帧、流式转写）全关在里面，
 * 组件只管「发一句话、收一段流式文字」。别把 WebSocket 散到组件里去。
 *
 * ## 三个从官方文档里读出来、照抄就会错的点
 *
 * 1. **只能用 clientContent，不能用 realtimeInput 发打字**
 *    文档原话：realtimeInput 的「一轮结束」是靠**用户活动**推导的
 *    （*"derived from user activity"*）。纯打字没有语音活动，边界不确定，
 *    模型会一直等。clientContent 要显式 `turnComplete: true` 才收尾。
 *    附带好处：clientContent 会**打断**模型当前生成 —— 你打字它立刻停嘴。
 *
 * 2. **`contextWindowCompression` 在 setup 顶层，不在 generationConfig 里**
 *    放错位置不会报错，只是静默不生效。
 *
 * 3. **收到的消息不保证是字符串**（10-06 真机踩过）
 *    WebSocket 的 `binaryType` 默认 `'blob'`，服务端用二进制帧推过来时
 *    `event.data` 是 Blob，`JSON.parse(blob)` 抛错 —— 而错被 catch 吞掉之后，
 *    现象是**界面上一条都不显示**，长得像「服务端不回话」，实际是收到了没读出来。
 *    必须 `binaryType = 'arraybuffer'` + 按类型分支解析。
 *
 * ## 密钥
 * key 在 URL 里，**绝不 console.log 完整 URL**（手机上有调试浮标会记录）。
 * 所有报错信息过 `maskKey`。
 */

import { maskKey } from './liveProbe';
import { LIVE_WS_BASE, defaultLiveConfig } from './liveConfig';

const WS_BASE = LIVE_WS_BASE;
export const LIVE_MODEL = `models/${defaultLiveConfig.model}`;

export type LiveState =
  | 'idle' | 'connecting' | 'ready'
  /** 正在重连（断开了，正在接回去） */
  | 'reconnecting'
  /** 连不上了，重试也白搭，得让用户处理（一般是代理/密钥） */
  | 'failed';

export type LiveTurn = {
  role: 'user' | 'model';
  text: string;
};

export type LiveOpts = {
  apiKey: string;
  /** 剧场设置里配的模型名（不带 models/ 前缀）。不传就用默认那个 */
  model?: string;
  /** 剧场设置里配的 WebSocket 端点 */
  baseUrl?: string;
  systemPrompt: string;
  /** 进场时带的历史（角色卡之外的上下文） */
  history?: LiveTurn[];
  /** 流式文字：每次增量都回调，第二个参数是这一轮到目前为止的全文 */
  onText?: (delta: string, full: string) => void;
  /** 一轮说完 */
  onTurnComplete?: (full: string) => void;
  /** 模型被打断（用户中途打字了） */
  onInterrupted?: () => void;
  onState?: (s: LiveState, note?: string) => void;
  /** 调试信息，UI 上不显示 */
  onTrace?: (msg: string) => void;
};

/** 服务端主动断开前的预告。timeLeft 是毫秒数 */
type GoAway = { timeLeft?: number };

const CONNECT_TIMEOUT = 15000;
/** 多久没收到任何东西就认为链路死了（心跳兜底） */
const SILENCE_LIMIT = 90000;

export class LiveSession {
  private ws: WebSocket | null = null;
  private opts: LiveOpts;
  private state: LiveState = 'idle';
  /** 恢复码：断了带着它接上，聊过的东西还在 */
  private handle = '';
  /** 这一轮模型正在说的话 */
  private speaking = '';
  /** 用户自己是不是正在连着打字 */
  private wantOpen = false;
  /** 已经重试过几轮了，别无限重连 */
  private retry = 0;
  /** 上一次收到任何东西的时间（心跳兜底） */
  private lastBeat = 0;
  private timers: number[] = [];
  /** 排队等重连用的历史，断了期间用户又发了的话 */
  private pendingInput: string[] = [];

  constructor(opts: LiveOpts) {
    this.opts = opts;
  }

  /** 开一个会话。history 灌进去不会触发模型回话（文档：initial history will not trigger a model call） */
  async start(): Promise<void> {
    this.wantOpen = true;
    await this.open(false);
  }

  /** 说话。断了的话先攒着，重连成功后自动补发 */
  send(text: string): void {
    if (!text.trim()) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.state === 'failed') {
      this.pendingInput.push(text);
      if (!this.wantOpen) this.start();
      return;
    }
    this.pushUserTurn(text);
  }

  close(): void {
    this.wantOpen = false;
    this.clearTimers();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.setState('idle');
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ─────────────────────────── 内部 ───────────────────────────

  private setState(s: LiveState, note?: string) {
    this.state = s;
    this.opts.onState?.(s, note);
  }

  private clearTimers() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  private trace(s: string) {
    // ⚠️ 绝不打完整 URL（里面有密钥）
    this.opts.onTrace?.(s.replace(WS_BASE, '[ws]'));
  }

  private async open(isResume: boolean) {
    this.clearTimers();
    this.setState(isResume ? 'reconnecting' : 'connecting');

    const key = this.opts.apiKey;
    if (!key) {
      this.setState('failed', '还没填密钥');
      return;
    }

    const base = this.opts.baseUrl || WS_BASE;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${base}?key=${encodeURIComponent(key)}`);
    } catch (e: any) {
      this.scheduleRetry(`建不了连接：${e?.message || e}`);
      return;
    }
    this.ws = ws;
    // ⚠️ 必须在 onopen 之前设（见文件头第 3 点）
    ws.binaryType = 'arraybuffer';

    const connectTimer = window.setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch {}
        this.scheduleRetry('15 秒没连上');
      }
    }, CONNECT_TIMEOUT);
    this.timers.push(connectTimer);

    ws.onopen = () => {
      this.lastBeat = Date.now();
      this.retry = 0;
      this.trace('连上了，发 setup');
      ws.send(JSON.stringify(this.buildSetup(isResume)));
    };

    ws.onmessage = (ev) => {
      this.lastBeat = Date.now();
      this.onMessage(ev.data);
    };

    ws.onerror = () => {
      // ⛔ 不在这里下结论。浏览器的 WebSocket 错误**不给原因**，
      // 原因要去 onclose 的 code/reason 里看，或者根本没 close（那就是超时）。
      this.trace('连接出错');
    };

    ws.onclose = (ev) => {
      const why = ev.reason ? `（${ev.reason}）` : '';
      this.trace(`连接关闭 code=${ev.code}${why}`);
      // 用户主动关的不算断
      if (!this.wantOpen) { this.setState('idle'); return; }
      if (ev.code === 1000) { this.setState('idle'); return; }
      // 认证类错误重连没有意义
      if (ev.code === 1007 || ev.code === 1008) {
        this.setState('failed', `被服务端拒了 code=${ev.code}${why} —— 多半是密钥或权限`);
        return;
      }
      this.scheduleRetry(`断了 code=${ev.code}${why}`);
    };

    this.armHeartbeat();
  }

  /** setup。字段名严格按 BidiGenerateContentSetup 的表格，别自作主张改下划线 */
  private buildSetup(isResume: boolean) {
    const model = (this.opts.model || defaultLiveConfig.model).replace(/^models\//, '');
    const setup: any = {
      model: `models/${model}`,
      // ⚠️ gemini-3.8-live 只支持 AUDIO 输出（官方原话）。
      // 想只要文字也不行 —— 必须 AUDIO，然后开转写拿文本，音频数据收到就丢。
      generationConfig: { responseModalities: ['AUDIO'] },
      systemInstruction: { parts: [{ text: this.opts.systemPrompt }] },
      outputAudioTranscription: {},
      // 开了这个服务端才会发 newHandle；重连时带上它就能接回上下文
      sessionResumption: {},
      // ⚠️ 在 setup 顶层，不在 generationConfig 里。放错地方静默失效。
      contextWindowCompression: { triggerTokens: 80000 },
      // 进场的历史走这条路灌，不会触发模型回话
      historyConfig: { initialHistoryInClientContent: true },
      realtimeInputConfig: { turnCoverage: 'TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO' },
    };
    if (isResume && this.handle) setup.sessionResumption = { handle: this.handle };
    return { setup };
  }

  private onMessage(raw: any) {
    readMessage(raw).then((msg) => {
      if (!msg) return;
      if (msg.setupComplete) {
        this.setState('ready');
        this.flushHistory();
        this.flushPending();
        return;
      }
      if (msg.error) {
        this.setState('failed', msg.error?.message || '服务端报错');
        this.trace(`错误：${msg.error?.message || JSON.stringify(msg.error).slice(0, 120)}`);
        return;
      }
      if (msg.sessionResumptionUpdate) {
        const u = msg.sessionResumptionUpdate;
        // resumable=false 时 newHandle 是空串 —— 这时恢复不了，重连等于从头来
        if (u.newHandle) this.handle = u.newHandle;
        if (u.resumable === false && this.handle) this.trace('这一轮恢复不了');
        return;
      }
      if (msg.goAway) {
        const left = (msg.goAway as GoAway)?.timeLeft;
        this.trace(`服务端预告要断，还有 ${left ? Math.round(left / 1000) : '?'} 秒`);
        // ⭐ 关键：趁没断就悄悄接上，别等真断了才反应
        this.reconnectEarly();
        return;
      }
      const sc = msg.serverContent;
      if (sc) {
        if (sc.outputTranscription?.text) {
          const t = String(sc.outputTranscription.text);
          // ⚠️ 转写是**累积**的整段，不是增量。所以不能每次都拼。
          if (t.startsWith(this.speaking)) {
            const delta = t.slice(this.speaking.length);
            this.speaking = t;
            if (delta) this.opts.onText?.(delta, t);
          } else {
            // 不是同一段（新一轮），先结上一轮
            if (this.speaking.trim()) this.finishTurn();
            this.speaking = t;
            if (t) this.opts.onText?.(t, t);
          }
        }
        if (sc.interrupted) {
          this.trace('模型被打断');
          this.speaking = '';
          this.opts.onInterrupted?.();
          return;
        }
        if (sc.turnComplete) {
          this.finishTurn();
        }
        // 🔇 modelTurn.parts[].inlineData 就是音频数据。
        //    **收到就丢，绝不解 base64、绝不进内存**。
        //    我们只要文字（outputTranscription），声音是白流过来的。
        if (sc.modelTurn?.parts?.some((x: any) => x.inlineData)) {
          this.trace('收到音频数据（已丢弃，不播）');
        }
      }
    });
  }

  private finishTurn() {
    const full = this.speaking.trim();
    this.speaking = '';
    if (full) this.opts.onTurnComplete?.(full);
  }

  /** 灌历史。turnComplete: true 才算灌完，但灌历史本身不会触发模型回话 */
  private flushHistory() {
    const h = this.opts.history || [];
    if (!h.length) return;
    this.trace(`灌历史 ${h.length} 条`);
    this.ws?.send(JSON.stringify({
      clientContent: {
        turns: h.map((t) => ({
          role: t.role,
          parts: [{ text: t.text }],
        })),
        turnComplete: true,
      },
    }));
  }

  /** 重连成功后把断线期间攒的话补发出去 */
  private flushPending() {
    if (!this.pendingInput.length) return;
    const list = this.pendingInput;
    this.pendingInput = [];
    this.trace(`补发 ${list.length} 句`);
    list.forEach((t, i) => {
      if (i === 0) this.pushUserTurn(t);
      else window.setTimeout(() => this.pushUserTurn(t), 400);
    });
  }

  /**
   * 发一句话。
   * ⚠️ 必须用 clientContent + turnComplete:true —— 见文件头第 1 点。
   */
  private pushUserTurn(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.pendingInput.push(text); return; }
    // 用户插话 → 打断模型现在这段
    if (this.speaking) { this.speaking = ''; this.trace('用户插话，清掉未说完的'); }
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text }] }],
        turnComplete: true,
      },
    }));
  }

  /** 服务端预告要断：立刻在旧连接还活着的时候把新的接上 */
  private reconnectEarly() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.trace('趁没断先接上');
    // 旧连接别急着关，等新的 ready 再说
    const old = this.ws;
    const fresh = new Promise<void>((resolve) => {
      this.open(true);
      const iv = window.setInterval(() => {
        if (this.state === 'ready') { clearInterval(iv); resolve(); }
        if (this.state === 'failed') { clearInterval(iv); resolve(); }
      }, 300);
    });
    fresh.then(() => {
      this.reconnecting = false;
      try { old?.close(); } catch {}
    });
  }

  private reconnecting = false;

  /** 真的断了，退避重试 */
  private scheduleRetry(note: string) {
    if (!this.wantOpen) { this.setState('idle'); return; }
    this.retry++;
    if (this.retry > 4) {
      this.setState('failed', `${note} —— 重试 4 次都没成功`);
      return;
    }
    this.trace(`${note}，第 ${this.retry} 次重试`);
    this.setState('reconnecting', note);
    const wait = Math.min(1000 * this.retry, 5000);
    this.timers.push(window.setTimeout(() => this.open(true), wait));
  }

  /**
   * 心跳兜底。
   * 有些代理/NAT 会掐掉看起来"空闲"的连接 —— 对我们就是一条正在说话的线突然静了。
   * ⚠️ 这里**不发业务消息**（发了会污染对话），只是定期确认连接还在。
   */
  private armHeartbeat() {
    this.timers.push(window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.state !== 'ready') return;
      if (Date.now() - this.lastBeat > SILENCE_LIMIT) {
        this.trace(`${SILENCE_LIMIT / 1000} 秒没动静，当成断了重连`);
        this.scheduleRetry('长时间没回应');
      }
    }, 20000));
  }
}

/**
 * 按类型读一条 WebSocket 消息 —— 见文件头第 3 点。
 * 独立成函数是因为探针那边（liveProbe.ts）要用完全一样的逻辑，两处不能各写一份。
 */
export function readMessage(raw: any): Promise<any | null> {
  if (typeof raw === 'string') {
    try { return Promise.resolve(JSON.parse(raw)); } catch { return Promise.resolve(null); }
  }
  if (raw instanceof ArrayBuffer) {
    try { return Promise.resolve(JSON.parse(new TextDecoder().decode(raw))); } catch { return Promise.resolve(null); }
  }
  if (raw instanceof Blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => { try { resolve(JSON.parse(String(fr.result))); } catch { resolve(null); } };
      fr.onerror = () => resolve(null);
      fr.readAsText(raw);
    });
  }
  return Promise.resolve(null);
}

export { maskKey };
