/**
 * 实时会话（gemini-3.8-live，走 WebSocket 直连 Google 官方）。
 *
 * ## 🔴 setup 里**只能放服务端 schema 里有的字段名**（10-07 02:03 实锤）
 *
 * 服务端原话：
 * > `Invalid JSON payload received. Unknown name "mediaResolution" at 'setup': Cannot find field.`
 *
 * 翻译：**1007 = 你发过去的配置里有我不认识的字段。** 不是密钥、不是权限、
 * 不是网络、不是断线 —— 我在这上面绕了一整晚（见下面第 4 点）。
 *
 * ⚠️ 查文档时**要看清楚是哪一家的文档**：
 * `docs.cloud.google.cn`（云端平台版）和 `ai.google.dev`（官方直连版）
 * 字段名和摆放位置**不一样**。那次照着云端那篇加 `mediaResolution`，
 * 官方直连直接拒收。以后加字段先想一句「这条是不是云端版的」。
 *
 * 加新字段的代价是**整个会话连不上**，不是「这个功能不生效」——
 * 所以不确定就宁可不加。
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
 *    （**画面和声音例外**，它们本来就该走 realtimeInput，见 sendFrame / sendAudio）
 *
 * 2. **`contextWindowCompression` 在 setup 顶层，不在 generationConfig 里**
 *    放错位置不会报错，只是静默不生效。
 *    ⚠️ 但 10-07 实锤之后**这个字段整个拿掉了** —— 到底它属不属于
 *    官方直连这条路，当时没验证过。宁可少一个优化，不拿整个会话冒险。
 *
 * 3. **收到的消息不保证是字符串**（10-06 真机踩过）
 *    WebSocket 的 `binaryType` 默认 `'blob'`，服务端用二进制帧推过来时
 *    `event.data` 是 Blob，`JSON.parse(blob)` 抛错 —— 而错被 catch 吞掉之后，
 *    现象是**界面上一条都不显示**，长得像「服务端不回话」，实际是收到了没读出来。
 *    必须 `binaryType = 'arraybuffer'` + 按类型分支解析。
 *
 * 4. **1007 的真正含义**（10-07 01:17 才搞明白，前面绕了一晚上）
 *    见文件头第一段。当时的修法是「砍掉三个可疑字段」，方向对了但**没找到证据**，
 *    所以一直不确定是不是真修好了。02:03 又自己撞了一次同款报错，才拿到服务端原话。
 *    **教训**：连接类报错要拿到服务端那句原文，别靠猜哪个字段有问题。
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
  /**
   * 连接代数。每开一条连接 +1，旧连接的所有回调先比对这个号，对不上直接扔。
   * ⚠️ 这是「重连几次之后渲染进程崩掉」的根治点（见 open() 的注释）。
   */
  private gen = 0;
  /** 历史灌过没有 —— 只灌一次，重连不重复灌 */
  private historySent = false;
  /** 已经送出去多少帧了（诊断用） */
  private framesSent = 0;
  private lastFrameAt = -1;
  /**
   * 攒着的画面背景说明（**只攒不发**，见 sendFrame）。
   *
   * 攒它是为了在用户开口时，把这句拼在他那句话**前面**一起发。
   * 用完就清 —— 不然隔了很久之后的问话还会挂着一句八竿子打不着的进度。
   */
  private bgNote = '';
  /** 用户最后一次发话的时间，用来判断模型是不是「自己主动插嘴」 */
  private lastUserTurnAt = 0;

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
    this.diag();
    this.opts.onState?.(s, note);
  }

  private clearTimers() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  private trace(s: string) {
    // ⚠️ 绝不打完整 URL（里面有密钥）
    this.opts.onTrace?.(s.replace(WS_BASE, '[ws]'));
    this.diag(s);
  }

  private async open(isResume: boolean) {
    this.clearTimers();
    // 上一条连接先彻底关掉再开新的 —— 不关的话它的事件还会继续触发状态机
    const prev = this.ws;
    if (prev) {
      try { prev.onopen = prev.onmessage = prev.onerror = prev.onclose = null as any; } catch {}
      try { prev.close(); } catch {}
    }
    this.ws = null;
    // ⚠️ 代数守卫：每开一条连接 +1。所有事件回调先比对自己的代数，
    // 对不上直接扔掉。不这么做的话，旧连接迟到的 onclose/onerror 会把
    // 新连接的状态机搅乱（旧连接的 onclose 走 1000 分支会把整个会话置成 idle，
    // 于是新连接好好的却显示不出来，还会被心跳判定成没动静）。
    const gen = ++this.gen;
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
      if (gen !== this.gen) return;
      this.scheduleRetry(`建不了连接：${e?.message || e}`);
      return;
    }
    this.ws = ws;
    // ⚠️ 必须在 onopen 之前设（见文件头第 3 点）
    ws.binaryType = 'arraybuffer';

    const connectTimer = window.setTimeout(() => {
      if (gen !== this.gen) return;
      if (ws.readyState !== WebSocket.OPEN) {
        try { ws.close(); } catch {}
        this.scheduleRetry('15 秒没连上');
      }
    }, CONNECT_TIMEOUT);
    this.timers.push(connectTimer);

    ws.onopen = () => {
      if (gen !== this.gen) return;
      this.lastBeat = Date.now();
      this.retry = 0;
      this.trace('连上了，发 setup');
      ws.send(JSON.stringify(this.buildSetup(isResume)));
    };

    ws.onmessage = (ev) => {
      if (gen !== this.gen) return;
      this.lastBeat = Date.now();
      this.onMessage(ev.data);
    };

    ws.onerror = () => {
      if (gen !== this.gen) return;
      // ⛔ 不在这里下结论。浏览器的 WebSocket 错误**不给原因**，
      // 原因要去 onclose 的 code/reason 里看，或者根本没 close（那就是超时）。
      this.trace('连接出错');
    };

    ws.onclose = (ev) => {
      if (gen !== this.gen) return;
      const why = ev.reason ? `（${ev.reason}）` : '';
      this.trace(`连接关闭 code=${ev.code}${why}`);
      // 用户主动关的不算断
      if (!this.wantOpen) { this.setState('idle'); return; }
      if (ev.code === 1000) { this.setState('idle'); return; }
      // 认证类错误重连没有意义
      if (ev.code === 1007 || ev.code === 1008) {
        // ⚠️ 1007 **绝大多数是「setup 里有服务端不认识的字段」**（10-07 02:03 实锤），
        // 不是密钥、不是权限。之前这里一律写「多半是密钥或权限」，把方向带偏了一晚上。
        const why1007 = ev.code === 1007
          ? '（1007 = 配置里有服务端不认识的字段，去 buildSetup 对字段名）'
          : '';
        this.setState('failed', `被服务端拒了 code=${ev.code}${why}${why1007 ? '' : why} —— 这个多半才是密钥或权限`);
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
      // ⚠️ 3.8 只支持音频输出。开音频 + 开转写拿文本，音频数据收到就丢。
      generationConfig: { responseModalities: ['AUDIO'] },
      // 历史**只**走 setup 之后的 clientContent.turns（见 flushHistory），
      // 不塞进 systemInstruction。
      // —— 实测塞进去模型会把里面的来源标记（[剧场]）当自己的台词 pattern，
      // 然后输出切成 [剧场]xxx，[剧场]yyy 这种碎段。
      systemInstruction: { parts: [{ text: this.opts.systemPrompt }] },
      outputAudioTranscription: {},
      // 长会话续命：服务端发新句柄，断了带它能接回上下文。
      sessionResumption: {},
    };
    if (isResume && this.handle) setup.sessionResumption = { handle: this.handle };
    return { setup };
  }

  private onMessage(raw: any) {
    readMessage(raw).then((msg) => {
      if (!msg) return;
      if (msg.setupComplete) {
        this.setState('ready');
        // ⚠️ 历史**只在第一次连上时灌**。
        // 重连带 sessionResumption 的话上下文已经在了，再灌一遍就是重复 ——
        // 实测重连时模型会对着重复的历史吐一大段（10-07 现场）。
        if (!this.historySent) {
          this.historySent = true;
          this.flushHistory();
        }
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
          // 🔍 **原始记录**。上面那些 startsWith / 拼接全是照着一个假设写的
          // （「转写一轮之内累积」），从没在真机上验证过。先把服务端到底发了
          // 什么记下来，假设对不对一看就知道。
          const w = window as any;
          if (!w.__liveRaw) w.__liveRaw = [];
          w.__liveRaw.push({ k: 'tr', t: t.slice(0, 300), n: t.length });
          if (w.__liveRaw.length > 200) w.__liveRaw.splice(0, w.__liveRaw.length - 200);

          if (t === this.speaking) {
            // 完全一样 —— 服务端重发，忽略
          } else if (t.startsWith(this.speaking)) {
            const delta = t.slice(this.speaking.length);
            this.speaking = t;
            if (delta) this.opts.onText?.(delta, t);
          } else if (this.speaking.startsWith(t)) {
            // 服务端把尾巴收了（转写会自我修正），以长的为准
            this.speaking = t;
          } else {
            // 真接不上 —— 这才是要查的地方，不是「新一轮」就完事了。
            // 现场要能看到：接不上时是「同样的句子又来一遍」还是「真的换内容了」。
            const w2 = window as any;
            if (!w2.__liveRaw) w2.__liveRaw = [];
            w2.__liveRaw.push({
              k: 'MISS',
              had: this.speaking.slice(-120),
              got: t.slice(0, 120),
              t2: t.slice(0, 300),
              n2: t.length,
            });
            this.speaking += t;
            this.opts.onText?.(t, this.speaking);
          }
        }
        if (sc.interrupted) {
          this.trace('模型被打断');
          (window as any).__liveRaw?.push({ k: 'INTR', len: this.speaking.length, t: this.speaking.slice(-80) });
          this.speaking = '';
          this.opts.onInterrupted?.();
          return;
        }
        if (sc.turnComplete) {
          (window as any).__liveRaw?.push({ k: 'TC', len: this.speaking.length, t: this.speaking.slice(-160) });
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
    // 现场：模型是不是在用户没问的时候自己开口了。
    // （声音进 realtimeInput 走的是服务端的活动检测，画面每 1.2 秒也进一次 ——
    //  这两样都可能把模型勾起来说话。出现了就记一笔，别再靠猜。）
    if (full && this.lastUserTurnAt && Date.now() - this.lastUserTurnAt > 5000) {
      (window as any).__liveRaw?.push({
        k: 'SPONT', gapMs: Date.now() - this.lastUserTurnAt, t: full.slice(0, 120),
      });
    }
    if (full) this.opts.onTurnComplete?.(full);
  }

  /**
   * 送一包声音（第 3 步）。
   *
   * ⚠️ 官方硬要求：**16kHz 裸 PCM**（小端），所以外面先降采样过了。
   * 每 100ms 一包是官方建议的节奏 —— 太大延迟高，太小包多。
   */
  sendAudio(pcmBase64: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify({
        realtimeInput: {
          audio: { data: pcmBase64, mimeType: 'audio/pcm;rate=16000' },
        },
      }));
      const w = window as any;
      if (!w.__liveMedia) w.__liveMedia = { frames: 0, audio: 0 };
      w.__liveMedia.audio++;
      return true;
    } catch (e: any) {
      this.trace(`送声音失败：${e?.message || e}`);
      return false;
    }
  }

  /**
   * 送一帧画面（第 3 步）。
   *
   * ⚠️ 走 `realtimeInput.video`，**不跟打字的 clientContent 混** ——
   * 那个的「一轮结束」是靠 turnComplete 显式收尾的，实时输入没有这个标记。
   * 画面是「持续在发生的事」，不是一轮对话的一部分。
   *
   * ## 🔥 这里原来每 1.2 秒还跟着发一句 `（背景画面：正在播到第 X 分 X 秒）`，
   * ##    这就是「答非所问」和「没人设像旁白」的病根（10-07 02:52 现场）
   *
   * 那句话是以 **`role: 'user'` 的身份**进对话的，1.2 秒一句、一直不停。
   * 从模型那边看，它收到的对话长这样：
   * ```
   * user:（背景画面：正在播到第 3 分 04 秒）
   * user:（背景画面：正在播到第 3 分 05 秒）
   * user:（背景画面：正在播到第 3 分 06 秒）
   * user:阿九好看吗          ← 他真正问的那句，夹在中间
   * user:（背景画面：正在播到第 3 分 07 秒）
   * ```
   * 两个后果，正好对上暮色报的两个现象：
   *   1. **答非所问** —— 他那句话**不是最后到达的**，模型按规矩回应最后那句，
   *      于是回的是刚跳过去的那一帧画（"他在描述之前跳过去的画面"）。
   *   2. **没有人设、像旁白** —— 对话里绝大多数是「背景画面」的轮次，
   *      模型的隐含任务已经变成「解说这部剧」，人设自然掉光。
   *
   * 画面照送（模型得真看见），但**说明文字不再单独成轮**，只**攒起来**，
   * 等他真的开口时，作为**他那句话前面的第一段**一起发出去（见 pushUserTurn）——
   * 这就是暮色要的那句：「画面信息放在前面，用户最后一句放在请求最末尾」。
   */
  sendFrame(data: string, at: number, duration = 0) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const mm = Math.floor(at / 60);
    const ss = Math.floor(at % 60);
    try {
      // ⚠️⚠️ 字段名是 **`video`**，不是 `mediaChunks`（10-07 02:16 实锤）。
      //
      // 写错的时候**不报错**：setup 里的错字段服务端会当场甩 1007，
      // 但 realtimeInput 里的错字段它**静默忽略** —— 于是表现是
      // 「进度文字收到了，画面就是没有」，看不出是发错了字段。
      // （`mediaChunks` / `media` 是云端平台版那篇文档里的写法。）
      this.ws.send(JSON.stringify({
        realtimeInput: {
          video: {
            mimeType: 'image/jpeg',
            data,
          },
        },
      }));
      // 进度**只攒着，不发**。等他开口时拼在他话前面（pushUserTurn）。
      // 顺带这里也解释了为什么必须攒：每 1.2 秒发一次的话，那句话八成会排在他问句后面。
      const len = duration ? `，整集约 ${Math.floor(duration / 60)} 分 ${Math.floor(duration % 60)} 秒` : '';
      this.bgNote = `（背景：这会儿在播第 ${mm} 分 ${ss} 秒${len}。画面是隔一阵自动送过来的，中间发生了什么你没看到。这是背景资料，不是他在跟你说话，不用回。）`;
      this.framesSent = (this.framesSent || 0) + 1;
      // 现场：画面确实发出去了吗
      const w = window as any;
      if (!w.__liveMedia) w.__liveMedia = { frames: 0, audio: 0 };
      w.__liveMedia.frames++;
      w.__liveMedia.lastFrameBytes = data.length;
      w.__liveMedia.lastFrameAt = at;
      return true;
    } catch (e: any) {
      this.trace(`送画面失败：${e?.message || e}`);
      return false;
    }
  }

  /** 换集 / 重新播放时叫它一声：下一帧强制送，别接着上一集的进度说 */
  resetFrameClock() {
    this.lastFrameAt = -1;
    this.bgNote = '';
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
   *
   * ## 🎯 排版就是这个函数说了算（10-07 02:52 暮色定的）
   *
   * 他问「阿九好看吗」，模型却回了一段剧情解说。根因不是措辞不对，
   * 是**他那句话不在请求的最末尾** —— 抽帧循环是独立的一条线，随时可能
   * 有一句「背景画面…」排在他后面到达，模型照规矩回最后那句，于是答非所问。
   *
   * 现在这里拼成**同一个 turn 的两个 part**：
   * ```
   * [{ text: '（背景：…这是背景资料，不用回。）' }, { text: '阿九好看吗' }]
   * ```
   * 背景在前、他问的话在**整个请求的最后**。顺序由这一次发出去决定，
   * 后面再怎么抽帧都不会插到它前面（`sendFrame` 只发图、不再发文字轮次）。
   */
  private pushUserTurn(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.pendingInput.push(text); return; }
    // 用户插话 → 打断模型现在这段
    if (this.speaking) { this.speaking = ''; this.trace('用户插话，清掉未说完的'); }
    const bg = this.bgNote;
    this.bgNote = '';
    const parts: Array<{ text: string }> = [];
    if (bg) parts.push({ text: bg });
    parts.push({ text });
    this.lastUserTurnAt = Date.now();
    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts }],
        turnComplete: true,
      },
    }));
  }

  /**
   * 服务端预告要断：立刻在旧连接还活着的时候把新的接上。
   *
   * ⚠️ 原来这里用 300ms 轮询等新连接 ready，等到了才关旧的。等不到就
   * **永远不关**、而且那个 interval 也永远不清 —— 每次重连泄漏一条连接 +
   * 一个 300ms 的定时器。1011 反复重连几轮之后，渲染进程里的 WebSocket
   * 越堆越多，直接 SIGTRAP 崩掉（10-07 三次崩溃地址完全相同，不是随机问题）。
   *
   * 现在不轮询了：直接开新连接，旧的立刻关。代数守卫保证旧连接的事件
   * 不会再搅乱状态机（open() 里已经做了）。
   */
  private reconnectEarly() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.trace('趁没断先接上');
    this.open(true);
    this.reconnecting = false;
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
    this.diag(note);
  }

  /** 诊断 dump：写到 window 上方便 adb/CDP 抓现场 */
  private diag(note?: string) {
    const w = window as any;
    if (!w.__liveDiag) w.__liveDiag = { traces: [] };
    const d = w.__liveDiag;
    if (note) d.traces.push({ at: Date.now(), text: note });
    if (d.traces.length > 80) d.traces = d.traces.slice(-80);
    d.state = this.state;
    d.retry = this.retry;
    d.handle = this.handle ? (this.handle.length > 12 ? this.handle.slice(0, 12) + '...' : this.handle) : '';
    d.speaking = this.speaking ? this.speaking.slice(0, 60) : '';
    d.wantOpen = this.wantOpen;
    d.wsState = this.ws ? (this.ws as any).readyState : -1;
    d.model = (this.opts.model || '').replace(/^models\//, '');
    d.promptChars = (this.opts.systemPrompt || '').length;
    d.bgNote = this.bgNote ? this.bgNote.slice(0, 40) : '';
    d.lastUserTurnAgo = this.lastUserTurnAt ? Math.round((Date.now() - this.lastUserTurnAt) / 1000) : -1;
    d.baseUrlHost = (() => {
        const u = this.opts.baseUrl || '';
        try { return new URL(u).host; } catch { return u.slice(0, 40); }
      })();
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
