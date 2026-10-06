/**
 * 实时连接探针（10-06 21:40 加）。
 *
 * ## 为什么要专门写这个
 *
 * 「安卓上能不能连上 Google 的实时接口」是整套第 2 步的生死关口：
 * 连不上，后面全部白做。但这一步**没法在电脑上验** —— curl 和 nc 不读系统代理，
 * 浏览器和 WebView 读，结论正好相反。
 *
 * 所以只能让手机自己说。**分成三步递进，因为三步失败的原因完全不同**：
 *
 * 1. **普通 HTTPS 能不能通**（`/v1beta/models?key=`）
 *    - 200 → 网络通、key 也对，后面不用怀疑了
 *    - 401/403 → 网络通、**key 不对**
 *    - `Failed to fetch` → **网络压根不通** ← 规则模式下最常见，域名被 DIRECT 了
 *    这一步就把「代理规则没覆盖到」和「key 填错」分开了。
 *    ⚠️ 关键：`generativelanguage.googleapis.com` 是 App 里 Gemini 直连聊天用的**同一个域名**，
 *    代理规则按域名匹配，所以这一步过了，第 2 步大概率也能过。
 *
 * 2. **WebSocket 能不能建起来**
 *    WebSocket 和 HTTPS 同域名同端口，但规则工具可能对它们分别处理（有的只放行网页请求）。
 *    ⚠️ 更要命的是：**长连接可能被 NAT / 路由器空闲超时掐掉**，这个第 1 步测不出来。
 *
 * 3. **真的发一句话，看有没有回话**
 *    只有这一步过了，才能确定整套能用。
 *
 * ## 密钥不要漏
 * URL 里带 key，**绝不 console.log 完整 URL**（手机上有 Vercel 调试浮标会记录）。
 * 这里所有对外输出都过 `maskKey`。
 */

export type ProbeStep = {
  /** 第几步 */
  n: number;
  name: string;
  ok: boolean;
  /** 给人看的结论，失败时写清楚「为什么」 */
  detail: string;
  ms: number;
};

const BASE = 'https://generativelanguage.googleapis.com';
const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** key 脱敏：任何对外输出都不许出现完整 key */
export function maskKey(k: string): string {
  if (!k) return '(空)';
  if (k.length <= 10) return `${k.slice(0, 3)}…`;
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label}超时（${ms / 1000}秒）`)), ms)),
  ]);

/**
 * 收一条 WebSocket 消息并解析成对象。
 *
 * ## ⚠️ 这里踩过一次坑（10-06 21:45 真机）
 *
 * 浏览器 WebSocket 的 `event.data` **不一定是字符串**。`binaryType` 默认是 `"blob"`，
 * 服务端一旦用二进制帧推过来，`event.data` 就是一个 Blob 对象，
 * 直接 `JSON.parse(blob)` 会抛 `SyntaxError: [object Blob]`。
 *
 * 那个错被 `catch` 吞掉之后的现象极具误导性：**界面上一条消息都不显示**，
 * 看起来像「服务端不回话」，实际上是**收到了但没解析出来**。
 * 当时第 3 步卡了 15 秒，真实原因就在这里，跟网络、密钥、权限都没关系。
 *
 * 所以两件事必须一起做：
 *   1 `binaryType = 'arraybuffer'` —— 在 onopen 里设，把 Blob 变成可读的 ArrayBuffer
 *   2 解析时按类型分支，别假定一定是字符串
 */
function readWsMessage(data: any): Promise<any | null> {
  if (typeof data === 'string') {
    try { return Promise.resolve(JSON.parse(data)); } catch { return Promise.resolve(null); }
  }
  if (data instanceof ArrayBuffer) {
    try { return Promise.resolve(JSON.parse(new TextDecoder().decode(data))); } catch { return Promise.resolve(null); }
  }
  if (data instanceof Blob) {
    return new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => { try { resolve(JSON.parse(String(fr.result))); } catch { resolve(null); } };
      fr.onerror = () => resolve(null);
      fr.readAsText(data);
    });
  }
  return Promise.resolve(null);
}

/** 只看原始形态，不解析 —— 万一解析不出来，至少知道服务器到底发了个啥 */
function describeRaw(data: any): string {
  if (typeof data === 'string') return `字符串 ${data.length} 字：${data.slice(0, 160)}`;
  if (data instanceof ArrayBuffer) return `二进制 ${data.byteLength} 字节`;
  if (data instanceof Blob) return `Blob ${data.size} 字节`;
  return `未知类型（${typeof data}）`;
}

/** 第 1 步：普通 HTTPS 通不通、key 对不对 */
async function probeHttps(key: string): Promise<ProbeStep> {
  const t0 = Date.now();
  try {
    const resp = await withTimeout(
      // silentFetch：不走全局报错弹窗（探针失败是正常结果，不该打扰用户）
      fetch(`${BASE}/v1beta/models?key=${encodeURIComponent(key)}`, {
        cache: 'no-store',
        silentFetch: true,
      } as RequestInit),
      12000,
      'HTTPS 测试',
    );
    const ms = Date.now() - t0;
    if (resp.ok) {
      return { n: 1, name: 'HTTPS 通了', ok: true, ms, detail: '网络和密钥都没问题' };
    }
    const body = await resp.text().catch(() => '');
    const tip = resp.status === 401 || resp.status === 403
      ? ' → 密钥不对或没权限，去设置里检查'
      : resp.status === 429
        ? ' → 配额用完了'
        : body ? ` → ${body.slice(0, 120)}` : '';
    return { n: 1, name: '网络通，但这一步没过', ok: false, ms, detail: `HTTP ${resp.status}${tip}` };
  } catch (e: any) {
    return {
      n: 1, name: '连不上', ok: false, ms: Date.now() - t0,
      // ⚠️ 规则模式下最常见的失败。措辞直指真正的原因：域名没走代理
      detail: `${e?.message || e} —— **多半是代理规则没覆盖到这个域名**，把它设成走代理再试`,
    };
  }
}

/** 第 2 步：WebSocket 能不能建起来（长连接可能被 NAT 掐） */
function probeWs(key: string): Promise<ProbeStep> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const url = `${WS_BASE}?key=${encodeURIComponent(key)}`;
    let settled = false;
    const done = (r: ProbeStep) => { if (!settled) { settled = true; try { ws?.close(); } catch {} resolve(r); } };

    const timer = setTimeout(
      () => done({ n: 2, name: '连接超时', ok: false, ms: Date.now() - t0, detail: '15 秒没连上。代理可能只放行网页请求、不放行长连接，去把长连接也放行' }),
      15000,
    );

    try {
      ws = new WebSocket(url);
    } catch (e: any) {
      clearTimeout(timer);
      done({ n: 2, name: '建不了连接', ok: false, ms: Date.now() - t0, detail: String(e?.message || e) });
      return;
    }

    ws.onopen = () => {
      clearTimeout(timer);
      done({ n: 2, name: '长连接通了', ok: true, ms: Date.now() - t0, detail: 'WebSocket 建起来了' });
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done({
        n: 2, name: '长连接被挡', ok: false, ms: Date.now() - t0,
        detail: '没能建立。可能是代理只放行网页不放长连接，或者密钥不对',
      });
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (settled) return;
      done({
        n: 2, name: '被关掉了', ok: false, ms: Date.now() - t0,
        detail: `连接被关闭（code ${ev.code}）${ev.reason ? ` · ${ev.reason}` : ''}`,
      });
    };
  });
}

/** 第 3 步：真的发 setup，看会不会回 setupComplete */
function probeSetup(key: string): Promise<ProbeStep> {
  const t0 = Date.now();
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    const url = `${WS_BASE}?key=${encodeURIComponent(key)}`;
    let settled = false;
    /** 收到过什么 —— 解析不出来时这就是唯一的证据 */
    const seen: string[] = [];
    const done = (r: ProbeStep) => { if (!settled) { settled = true; try { ws?.close(); } catch {} resolve(r); } };
    const timer = setTimeout(
      () => done({
        n: 3, name: '没等到回应', ok: false, ms: Date.now() - t0,
        detail: `setup 发出去了但 15 秒没等到回应。${
          seen.length
            ? `期间收到 ${seen.length} 条：${seen.slice(0, 3).join(' ／ ')}`
            : '**一条都没收到** —— 可能是服务端握手后没接受这条连接'
        }`,
      }),
      15000,
    );

    try { ws = new WebSocket(url); } catch (e: any) {
      clearTimeout(timer);
      done({ n: 3, name: '建不了连接', ok: false, ms: Date.now() - t0, detail: String(e?.message || e) });
      return;
    }

    // ⚠️ 必须在 onopen 之前设：默认是 'blob'，二进制帧到手就是个 Blob 对象
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      ws!.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.8-live',
          generationConfig: { responseModalities: ['AUDIO'] },
          outputAudioTranscription: {},
          systemInstruction: { parts: [{ text: '测试连接，回复一个字就好。' }] },
        },
      }));
    };

    ws.onmessage = (ev) => {
      const raw = describeRaw(ev.data);
      seen.push(raw);

      readWsMessage(ev.data).then((msg) => {
        if (settled || !msg) return;
        if (msg.setupComplete) {
          clearTimeout(timer);
          done({
            n: 3, name: '通了', ok: true, ms: Date.now() - t0,
            detail: '模型认了这次的配置，随时可以开聊',
          });
        } else if (msg.error) {
          clearTimeout(timer);
          done({
            n: 3, name: '模型拒了', ok: false, ms: Date.now() - t0,
            detail: msg.error?.message || JSON.stringify(msg.error).slice(0, 200),
          });
        } else {
          // 还没到 setupComplete 的其它消息（比如 goAway），留着继续等
          seen.push(`字段：${Object.keys(msg).join(',')}`);
        }
      });
    };

    ws.onerror = () => {
      clearTimeout(timer);
      done({
        n: 3, name: '中途断了', ok: false, ms: Date.now() - t0,
        detail: `连上了但发 setup 时断了${seen.length ? `。断之前收到：${seen.slice(0, 2).join(' ／ ')}` : '。一条都没收到过'}`,
      });
    };
    ws.onclose = (ev) => {
      clearTimeout(timer);
      if (settled) return;
      done({
        n: 3, name: '中途被关', ok: false, ms: Date.now() - t0,
        detail: `code ${ev.code}${ev.reason ? ` · ${ev.reason}` : ''}${seen.length ? `。关之前收到：${seen.slice(0, 2).join(' ／ ')}` : '。一条都没收到过'}`,
      });
    };
  });
}

/**
 * 跑完整套。每步的结果都立刻回调 —— 失败也要往下走，
 * 让用户看到「到底卡在哪一步」，而不是只看到一个红叉。
 */
export async function probeLive(
  key: string,
  onStep: (s: ProbeStep) => void,
): Promise<ProbeStep[]> {
  const out: ProbeStep[] = [];
  if (!key) {
    const s: ProbeStep = { n: 0, name: '没填密钥', ok: false, ms: 0, detail: '先去设置里填好 Gemini 的密钥' };
    onStep(s);
    out.push(s);
    return out;
  }

  const push = (s: ProbeStep) => { out.push(s); onStep(s); };

  const one = await probeHttps(key);
  push(one);
  if (!one.ok) return out;

  const two = await probeWs(key);
  push(two);
  if (!two.ok) return out;

  push(await probeSetup(key));
  return out;
}