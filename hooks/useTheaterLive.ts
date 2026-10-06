/**
 * 剧场接实时模型（第 2 步）。
 *
 * ## 方法：照抄见面 app 的陪伴模式，暮色 21:12 拍板
 *
 * > 陪伴模式的写法就是「往主聊天同一张表里存」，打个标记。
 * > 剧场照抄，标记换成 `source: 'theater'`。
 * > 主聊天读消息**不过滤**这个标记 → 天然就接上了，不用「同步」这个动作。
 * > 剧场自己读的时候才过滤 → 只看到剧场里聊的。
 *
 * 所以这里**没有任何同步逻辑**，就三个动作：
 *   1. 进场：角色卡 + 记忆 拼进系统提示（`ContextBuilder` + `injectMemoryPalace`）
 *   2. 说话：先入库 user，再发给模型（见面模式是「先入库再发请求」）
 *   3. 模型说完：入库 assistant，然后跑记忆宫殿后处理
 *
 * ## 「共读」跟「陪伴模式」不是一回事（我自己 21:12 之前搞错过）
 * 共读 = 往系统提示里塞正文；
 * 陪伴模式 = 往同一张消息表里存。
 * 剧场要的是后者 —— 这样主聊天天然能看到剧场里聊的。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// ⚠️ 这四行照抄自 apps/DateApp.tsx，但**路径前缀要改成 ../utils/** ——
// DateApp 在 apps/ 下所以是 '../utils/db'，本文件在 hooks/ 下，写成 '../db'
// 会解析到仓库根去。typecheck 那一步不拦这个（tsconfig 的解析比 build 宽松），
// 只有 `npm run build` 才会报 "Could not resolve"，白等一轮。
import { DB } from '../utils/db';
import { ContextBuilder } from '../utils/context';
import { injectMemoryPalace, processNewMessages, mergePalaceFragmentsIntoMemories } from '../utils/memoryPalace/pipeline';
import { incrementDigestRound, runCognitiveDigestion } from '../utils/memoryPalace';
import { LiveSession, type LiveState, type LiveTurn } from '../utils/dramaTheater/liveSession';
import { FrameGrabber } from '../utils/dramaTheater/frameGrabber';
import { AudioTap, floatToPcmBase64 } from '../utils/dramaTheater/audioTap';

export type TheaterMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 正在流式输出中 */
  streaming?: boolean;
  /** 哪一步剧、哪一集 —— 主聊天里就靠这个把剧里的话认出来 */
  tag?: string;
};

export type UseTheaterLive = {
  msgs: TheaterMsg[];
  state: LiveState;
  note: string;
  send: (text: string) => void;
  retry: () => void;
  trace: string[];
  /**
   * 第 3 步：把正在播的画面喂进去。
   *
   * 播放器那边定时调它。**抽帧、压缩、判重都在 grabber 里**
   * （`utils/dramaTheater/frameGrabber.ts`），这里只管送。
   */
  attachVideo: (el: HTMLVideoElement | null) => void;
  /** 换集 / 重新播放时叫一声：下一帧强制送，别接着上一集的进度说 */
  resetFrames: () => void;
  /** 已经喂了多少帧（设置页显示用） */
  framesFed: number;
};

/** 进场时灌多少条历史给模型。太多会挤掉角色卡，也慢（暮色 00:34 定的 100） */
const HISTORY_TURNS = 100;

export function useTheaterLive(opts: {
  char: any;
  userProfile: any;
  apiKey: string;
  /** 剧场自己配的模型名 / 端点（独立于聊天的主 API，暮色 22:10 要求的） */
  liveModel?: string;
  liveBaseUrl?: string;
  memoryPalaceConfig: any;
  apiConfig: any;
  updateCharacter: (id: string, patch: any) => void;
  addToast: (msg: string, tone?: any) => void;
  /** 现在在看哪部剧哪一集 —— 写进系统提示 */
  scene: () => { title: string; episode: number; at: number };
  /**
   * 只有播放页才连。
   *
   * ⚠️ 这个 hook 必须无条件调在组件顶层（进 if 分支 = 违反 Hooks 规则），
   * 所以「什么时候连」只能靠这个开关控制 ——
   * 不然用户只是在列表页划海报，就会白白建立一个实时会话。
   */
  active: boolean;
  onReady?: () => void;
}): UseTheaterLive {
  const {
    char, userProfile, apiKey, liveModel, liveBaseUrl, memoryPalaceConfig, apiConfig,
    updateCharacter, addToast, scene, active, onReady,
  } = opts;

  const [msgs, setMsgs] = useState<TheaterMsg[]>([]);
  const [state, setState] = useState<LiveState>('idle');
  const [note, setNote] = useState('');
  const [trace, setTrace] = useState<string[]>([]);

  const sessRef = useRef<LiveSession | null>(null);
  const tagRef = useRef('');
  /** 正在流式输出的那条消息 id */
  const streamingId = useRef('');
  /**
   * 流式节流（暮色 00:20「好卡，点也不动」）。
   *
   * ⚠️ 模型是一秒几十段地推字，原来每段都直接 setMsgs 一次，
   * 每次重渲染整个消息列表 —— 渲染进程被打爆，10-07 现场是
   * 「发一条消息就崩」。攒 120ms 刷一次，人眼看不出差别。
   */
  const pendingStream = useRef('');
  const streamTimer = useRef(0);
  /**
   * 当前这条实时会话是按哪套配置开的（角色 + 模型 + 地址 + 有没有密钥）。
   *
   * ⚠️ 用来挡住「effect 反复重跑 → 每次重灌历史 → 模型重复回一堆」
   * （暮色 00:34 现场：同样内容一下刷出十来条）。
   * 配置没变、连接还在 → 什么都不做。
   */
  const bootedKey = useRef('');
  /**
   * 第 3 步：正在播的视频元素 + 抽帧器。
   *
   * ⚠️ 用 ref 不进依赖 —— 这个对象跟实时会话是两条独立的线，
   * 播放器换元素不该触发重连。
   */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const audioRef = useRef<AudioTap | null>(null);
  /** 接上声音没有（接不上就只喂画面，不影响别的） */
  const audioOk = useRef(false);
  const framesFedRef = useRef(0);
  /** 多久问一次画面。1.2 秒是「切镜头基本抓得住、静止段几乎不耗」的折中 */
  const FRAME_EVERY = 1200;

  /**
   * 播放器把视频元素交过来。**画面和声音都从这里接**。
   *
   * ⚠️ 换 src 时元素不会重建（同一个 video 标签），所以 attach 内部有
   * 「接过就不重复接」的判断 —— 同一个元素调两次 createMediaElementSource
   * 会直接抛异常。
   */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (!el) { audioOk.current = false; return; }
    if (!audioRef.current) audioRef.current = new AudioTap();
    audioOk.current = audioRef.current.attach(el);
    // 现场：声音到底接上没。接不上（跨源/不支持）就只喂画面。
    const w = window as any;
    if (!w.__liveMedia) w.__liveMedia = { frames: 0, audio: 0 };
    w.__liveMedia.audioAttached = audioOk.current;
    if (!audioOk.current) w.__liveMedia.audioWhy = 'attach 失败（多半是跨源或内核不支持 Web Audio）';
  }, []);

  const resetFrames = useCallback(() => {
    grabberRef.current?.reset();
    // 换集了 —— 上一集攒的声音留着会串进下一集
    audioRef.current?.flush();
  }, []);

  const framesFed = useMemo(() => framesFedRef.current, []);
  /** 节流攒着的最后一段，立刻刷出来（收尾/被打断时调用，不然会丢字） */
  const flushStreamNow = useCallback(() => {
    if (streamTimer.current) {
      window.clearTimeout(streamTimer.current);
      streamTimer.current = 0;
    }
    const text = pendingStream.current;
    pendingStream.current = '';
    if (!text) return;
    setMsgs((old) => {
      const i = old.findIndex((m) => m.id === streamingId.current);
      if (i < 0) return old;
      const next = old.slice();
      next[i] = { ...next[i], text };
      return next;
    });
  }, []);

  const addTrace = useCallback((s: string) => {
    setTrace((old) => [...old.slice(-40), s]);
  }, []);

  /**
 * 【已撤掉 10-07 01:05】
 *
 * 原来这里有个「掐掉复读」的补丁 —— 模型把同一段话说四遍时就截断。
 * 暮色指出那是治标不治本（对），撤掉了。
 *
 * 真正的怀疑点在 liveSession 的转写合并：
 * 它假设「outputTranscription.text 是一轮之内累积的整段」，
 * 这个假设从没在真机上验证过。如果服务端其实是**每小段重新累积**，
 * 那段 `startsWith` 接不上就往上拼的逻辑，正好会把重叠的段落粘在一起 ——
 * 复读就是这么来的。所以改成先记录服务端发了什么（window.__liveRaw），
 * 假设对不对一看就知道，再决定怎么改。
 */

  // ── 剧场专属的系统提示 ──────────────────────────────────
  /**
   * 陪伴模式里没有这一段（它是在系统提示后面追加场景说明）。
   *
   * ⚠️ **「不要编剧情」这一条是整个产品的命门**。
   * 角色扮演模型最容易被顺着诱导去编剧情，而剧场这个产品的价值恰恰是
   * 「只说自己看见的」（第 3 步接上画面之后）。第 2 步还没画面，
   * 更要提前堵死它「装作看过」的习惯。
   */
  const buildSystemPrompt = useCallback((sc: { title: string; episode: number }) => {
    const core = ContextBuilder.buildCoreContext(char, userProfile);
    return `${core}

### [剧场模式]
你正在陪用户看一部剧，现在开着的是剧里的画面。

- 剧名：《${sc.title || '（不知道叫什么）'}》，现在在第 ${sc.episode || 1} 集

**几条硬的，务必照做：**

1. **你现在看得见画面。** 画面会隔一阵自己送进来，每张都告诉你播到第几分钟。
   你看到的就是用户正在看的那一帧。问他「刚才是谁」「演到哪了」，看你**已经看到的**，
   照实说。

   但**画面只隔一阵送一次，中间发生了什么你不知道**。中间那段他要问你，
   你就说没看到 —— **绝对不要编剧情**。角色扮演最容易被顺着骗过去
   编出一整段不存在的剧情，这里一个字都不要编。

2. **你听得见声音**（短剧的台词会一起进来）。
   有人说话你能听见。听见的那几句就是原话，用户问你「她刚说什么」，照实说。
   静音、暂停、或者声音断断续续的时候，说明那会儿没传过来 —— 说没听到。

3. **画面没送的时候，就是画面没变**（用户暂停了，或者在放不动的长镜头）。
   别把「没收到画面」当成「他关掉了」。

4. **聊天区在视频下面，视频正在放，用户随时可能没在看你。**
   他没跟你说话的时候，不要主动开口、不要评价剧情。
   用户没叫你的时候，安静看剧就好。

5. 你现在说的每一句都会**逐字出现在用户的聊天框里**，用户会当成你的原话。
   不要用「我可以帮你分析剧情」这种服务腔，直接说人话。

6. **只输出纯文字**。你现在在一个只有文字的地方，没有语音条、没有别的花活。

7. **不要重复自己的话。** 说过了就过去了，别翻来覆去讲同一句。

> ⚠️ 这里**故意不写「现在播到第几分钟」**：那写在提示词里就是个永远不变的
> 假数字（画面是持续变的，一个数字很快就是错的，比不写更糟）。
> 真实进度每张画面都单独告诉你，别在提示词里编一个。`;
  }, [char, userProfile]);

  // ── 进场 ──────────────────────────────────────────────
  /**
   * 进场顺序（照抄陪伴模式）：
   *   读历史 → 记忆注入 → 拼角色卡 → 连上 → 把历史灌进系统指令
   *
   * ⚠️ 历史改成塞 systemInstruction（多 part 形式），不走进场的官方那条通道
   * —— 实测官方那条是 1007 真凶；见面 app 走 system instruction 一直稳。
   */
  const boot = useCallback(async () => {
    if (!char) return;
    sessRef.current?.close();
    sessRef.current = null;

    // 1. 剧场自己的聊天记录（只看到剧场里聊的）
    //
    // ⚠️ **只能往后追加，不能整体覆盖**（10-07 现场）。
    // 入库是后台跑的（暮色 23:06 定的「先显示再后台存」），
    // 所以内存里的新消息有一小段时间还没进库。整体覆盖的话，
    // 重连触发 boot() 重跑那一刻就把这些还没入库的消息抹掉了 ——
    // 现象是「我发的字闪一下就没了，过一阵又冒出来」。
    try {
      const all = await DB.getMessagesByCharId(char.id, true);
      const rows = all
        .filter((m: any) => m.metadata?.source === 'theater')
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .slice(-40);
      // ⚠️ 库里也可能已经躺着重复行（重连反复灌历史那几轮留下的）。
      // 连续**相邻**同角色同内容才算重复 —— 隔了几轮又说同一句
      // 是真在重复说话，不该被误删。
      const mine: TheaterMsg[] = [];
      for (const m of rows) {
        const text = m.content || '';
        const last = mine[mine.length - 1];
        if (last && last.role === m.role && last.text === text) continue;
        mine.push({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text,
          tag: (m.metadata as any)?.theaterTag as string || '',
        });
      }
      setMsgs((old) => {
        // ⚠️⚠️ 光按 id 去重**不够**（暮色 00:48 现场：同一条消息显示两遍）。
        //
        // 内存里的消息 id 是 `m${Date.now()}` 这种临时 id，入库之后数据库
        // 会给它一个**完全不同的 id**。下一次 boot() 重跑时，按 id 比对
        // 认不出这两条是同一条 —— 于是把库里那条又追加了一遍，
        // 同一条内容就在列表里出现两次。
        //
        // 现象对得上：闪退重进就没了（两边都从库来，只有一条），
        // 页面上却是两条（一条内存里的、一条刚从库里补进来的）。
        //
        // 所以还得按「角色 + 内容」判重 —— 观众能分辨的重复只有这两种。
        const seenIds = new Set(old.map((m) => m.id));
        const seenText = new Set(old.map((m) => `${m.role}|${m.text}`));
        const missing = mine.filter((m) => !seenIds.has(m.id) && !seenText.has(`${m.role}|${m.text}`));
        if (!missing.length) return old;
        return [...old, ...missing];
      });
    } catch (e: any) {
      addTrace(`读剧场历史失败：${e?.message || e}`);
    }

    if (!apiKey) {
      setState('failed');
      setNote('还没填密钥，先去设置里配好');
      return;
    }

    // 2. 记忆注入 + 角色卡
    let core = '';
    try {
      const all = await DB.getMessagesByCharId(char.id, true);
      await injectMemoryPalace(char, all);
      core = buildSystemPrompt(scene());
    } catch (e: any) {
      addTrace(`准备上下文失败：${e?.message || e}`);
      core = buildSystemPrompt(scene());
    }

    // 3. 历史 —— 跨来源（同一个角色，主聊天里聊到哪他也该记得）
    //
    // 条数 100（暮色 00:34 定的）。主聊天那边是 `char.contextLimit` 默认 500，
    // 剧场照抄那么多又慢又没必要。
    //
    // ⚠️ 别给历史加 [剧场] 之类前缀 —— 模型会把它当自己的台词 pattern，
    // 然后输出切成「[剧场]xxx，[剧场]yyy」这种碎段（10-06 现场）。
    let history: LiveTurn[] = [];
    try {
      const all = await DB.getMessagesByCharId(char.id, true);
      history = all
        // 工具标签 + 控制字符垃圾
        // ⚠️ `<ctrl46>` 这种是调试期脏数据（复制粘贴带进来的），模型学它会吐乱码
        .filter((m: any) => !/<\/?(语音|主动消息|分享|转账|位置|表情|戳一戳|引用|功能)>/.test(m.content || ''))
        .filter((m: any) => !/<ctrl\d+>/.test(m.content || ''))
        .slice(-HISTORY_TURNS)
        .map((m: any) => ({
          role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
          text: m.content,
        }));
    } catch {}

    // 4. 连上
    const s = new LiveSession({
      apiKey,
      model: liveModel,
      baseUrl: liveBaseUrl,
      systemPrompt: core,
      history,
      onTrace: addTrace,
      onState: (st, n) => {
        setState(st);
        setNote(n || '');
        if (st === 'ready') onReady?.();
      },
      onText: (delta, full) => {
        /**
         * ⚠️ 流式**必须节流**（暮色 00:20「好卡，点也不动」）。
         *
         * 原来模型每吐一小段就直接 setMsgs 一次 —— 一秒能来几十次，
         * 每次都重渲染整个消息列表 + 重算滚动位置。渲染进程直接被打爆
         * （10-07 现场：发一条消息就崩）。
         *
         * 现在攒 120ms 一起刷。人眼看不出差别，渲染压力降一个数量级。
         */
        pendingStream.current = full;
        if (streamTimer.current) return;
        streamTimer.current = window.setTimeout(() => {
          streamTimer.current = 0;
          const text = pendingStream.current;
          pendingStream.current = '';
          setMsgs((old) => {
            const i = old.findIndex((m) => m.id === streamingId.current);
            if (i < 0) return old;
            const next = old.slice();
            next[i] = { ...next[i], text, streaming: true };
            return next;
          });
        }, 120);
      },
      onInterrupted: () => {
        // 用户插话把它打断了：把没说完的那条定稿，别留半句
        const id = streamingId.current;
        if (!id) return;
        flushStreamNow();
        setMsgs((old) => old.map((m) => (m.id === id ? { ...m, streaming: false } : m)));
        streamingId.current = '';
      },
      onTurnComplete: async (full) => {
        const id = streamingId.current;
        streamingId.current = '';
        // ⚠️ 收尾必须先把节流里攒着的最后一段刷出来，否则最后几个字会丢
        flushStreamNow();
        if (full) {
          setMsgs((old) => old.map((m) => (m.id === id ? { ...m, text: full, streaming: false } : m)));
        }
        await saveModel(full);
      },
    });
    sessRef.current = s;
    await s.start();
  }, [char, apiKey, liveModel, liveBaseUrl, userProfile, buildSystemPrompt, addToast, onReady, addTrace]);

  /**
   * 🔥 会话生命周期。**这里以前是个每 0.7 秒转不停的死循环**（10-07 01:12 现场）。
   *
   * 现场记录（window.__liveDiag.traces）：
   * ```
   * 连上了，发 setup
   * 灌历史 1 条
   * 连接关闭 code=1000
   * 连上了，发 setup      ← 0.7 秒后又是这三行，连了 30 多轮
   * ...
   * ```
   * 一条转写都没发出来，全是空转，界面就一直闪「连上了吗」。
   *
   * 循环是这么转起来的：
   *   1. 这段 effect 的依赖里有 `boot`，而 boot 的依赖链上有 `char` / `userProfile`
   *      / `addToast` 这些**上游给的对象** —— 只要它们在两次渲染之间换了引用，
   *      boot 就是新的，effect 就重跑。
   *   2. 重跑前 React 先跑收尾，收尾里 `sessRef.current.close()` → 断开 → setState
   *      → **触发重渲染**。
   *   3. 重渲染 → boot 又是新的 → 回到第 1 步。自己喂自己，停不下来。
   *
   * 我上一轮加的守卫（按配置键判断要不要重连）本来能挡住，
   * 但**收尾里把配置键清空了**，守卫每轮都判定成「配置变了」——
   * 等于自己把自己废掉了。
   *
   * 现在的做法：
   *   - boot 放进 ref，effect **不再依赖它**，它的引用变不变跟这段无关；
   *   - 依赖只剩「在不在播放页」+ 配置键（都是原始值，不是对象）；
   *   - **收尾里绝不关连接** —— 连接的生命周期只由 !active 和配置变化决定；
   *   - 真正卸载时才收尾，那一段用空依赖，只跑一次。
   *
   * 顺带说明：复读也是这个循环造成的 —— 每 0.7 秒重建会话、每轮都重灌一遍历史，
   * 模型每次都收到同一段内容、每次都重新回应一遍。
   */
  const cfgKey = `${char?.id || ''}|${liveModel || ''}|${liveBaseUrl || ''}|${apiKey ? 'k' : ''}`;

  // 最新的 boot 放 ref 里用，绕开它的引用变化
  const bootRef = useRef(boot);
  bootRef.current = boot;

  useEffect(() => {
    if (!active) {
      // 离开播放页：这是唯一该关连接的地方
      if (streamTimer.current) {
        window.clearTimeout(streamTimer.current);
        streamTimer.current = 0;
      }
      pendingStream.current = '';
      bootedKey.current = '';
      sessRef.current?.close();
      sessRef.current = null;
      setState('idle');
      setNote('');
      return;
    }
    // 配置没变、连接还在 → 什么都不做（这才是守卫该有的样子）
    if (sessRef.current && bootedKey.current === cfgKey) return;
    bootedKey.current = cfgKey;
    bootRef.current();
  }, [active, cfgKey]);

  // 只在真正卸载时收尾。空依赖 = 只在卸载跑一次，不会每轮都执行。
  useEffect(() => () => {
    if (streamTimer.current) window.clearTimeout(streamTimer.current);
    pendingStream.current = '';
    sessRef.current?.close();
    sessRef.current = null;
  }, []);

  /**
   * ── 第 3 步：抽帧循环 ──
   *
   * ⚠️ 依赖只留 `active`，**不放 sessRef / state** —— 会话连上、断开会改状态，
   * 放进依赖就变成「一连接就重开抽帧循环」的另一个自我喂养循环
   * （10-07 01:12 刚踩过这个坑，别再踩一次）。sessRef 是 ref，读它不触发重跑。
   */
  useEffect(() => {
    if (!active) return;
    // 声音：200ms 跑一次，一包就是 100ms 的量。跑太快会空转，跑太慢攒太多。
    const audioIv = window.setInterval(() => {
      const v = videoRef.current;
      const s = sessRef.current;
      if (!v || !s || !s.isOpen) return;
      if (v.paused) return;
      if (!audioOk.current || !audioRef.current) return;
      audioRef.current.resume();
      const chunk = audioRef.current.takeChunk();
      if (chunk) {
        s.sendAudio(floatToPcmBase64(chunk));
      } else {
        // 一包都攒不出来 —— 说明采集端根本没在出数据，记下来别再猜
        const w = window as any;
        if (w.__liveMedia && !w.__liveMedia.audioWarned) {
          w.__liveMedia.audioWarned = true;
          w.__liveMedia.audioWhy = `200ms 了还攒不出 100ms 的包（pending=${audioRef.current.pending}）`;
        }
      }
    }, 200);
    return () => {
      window.clearInterval(audioIv);
      // ⚠️ 只丢队列，**不能 detach** ——
      // 同一个 video 元素调第二次 createMediaElementSource 会直接抛异常，
      // 那个元素就再也采不到声音了。离开播放页时保持挂着，切回来还能用。
      audioRef.current?.flush();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const iv = window.setInterval(() => {
      const v = videoRef.current;
      const s = sessRef.current;
      if (!v || !s || !s.isOpen) return;
      if (v.paused) return;
      if (!grabberRef.current) grabberRef.current = new FrameGrabber();
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      const f = grabberRef.current!.grab(v);
      // 没变化 → 不送（省下的不是流量，是不让它对着静止画面反复琢磨）
      if (!f) return;
      if (s.sendFrame(f.data, f.at, dur)) framesFedRef.current++;
    }, FRAME_EVERY);
    return () => window.clearInterval(iv);
  }, [active]);

  // ── 记忆宫殿后处理（照抄 DateApp:242 的 runMemoryPalacePostHook）──
  const runMemoryPost = useCallback(async (c: any) => {
    if (!c?.memoryPalaceEnabled) return;
    const mpEmb = memoryPalaceConfig?.embedding;
    const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
    const mpLLM = (mpLLMConfigured?.baseUrl)
      ? mpLLMConfigured
      : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
    if (!mpEmb?.baseUrl || !mpEmb?.apiKey || !mpLLM.baseUrl) return;

    try {
      const recentMsgs = await DB.getRecentMessagesByCharId(c.id, 50);
      const r = await processNewMessages(
        recentMsgs, c.id, c.name, mpEmb, mpLLM, userProfile?.name || '', false,
      );
      if (r?.autoArchive && (c as any).autoArchiveEnabled) {
        const merged = mergePalaceFragmentsIntoMemories(c.memories || [], r.autoArchive.fragments);
        updateCharacter(c.id, {
          memories: merged,
          hideBeforeMessageId: r.autoArchive.hideBeforeMessageId,
        } as any);
      }
      const shouldDigest = incrementDigestRound(c.id);
      if (shouldDigest) {
        const persona = [c.systemPrompt || '', c.worldview || ''].filter(Boolean).join('\n');
        await runCognitiveDigestion(c.id, c.name, persona, mpLLM, false, userProfile?.name, mpEmb);
      }
    } catch (e: any) {
      console.warn('📚 [剧场 记忆宫殿]', e?.message || e);
    }
  }, [memoryPalaceConfig, apiConfig, userProfile?.name, updateCharacter]);

  // ── 发消息 ────────────────────────────────────────────
  // 暮色 23:06 拍板：「先显示再后台存」。
  // 入库是写本地数据库，慢的话会卡住输入框里的「发出去」。
  const send = useCallback((text: string) => {
    if (!char || !text.trim()) return;
    const s = scene();
    const tag = `《${s.title || '剧场'}》第${s.episode || 1}集`;
    tagRef.current = tag;

    // ① 先让用户看到这条消息
    setMsgs((old) => [...old, { id: `u${Date.now()}`, role: 'user', text, tag }]);

    // ② 给一条空的模型消息占位，等会儿流式往里填
    const mid = `m${Date.now()}`;
    streamingId.current = mid;
    setMsgs((old) => [...old, { id: mid, role: 'assistant', text: '', streaming: true, tag }]);

    // ③ 入库改成后台跑，不阻塞发送
    DB.saveMessage({
      charId: char.id,
      role: 'user',
      type: 'text',
      content: text,
      // source 是「接上主聊天」的关键；theaterTag 是让主聊天认出来源的线索
      metadata: { source: 'theater', theaterTag: tag },
    }).catch((e: any) => addTrace(`用户消息入库失败：${e?.message || e}`));

    // ④ 发出去
    sessRef.current?.send(text);
  }, [char, scene, addTrace]);

  /** 模型这一轮说完了 → 入库 + 记忆后处理 */
  // 入库仍然不阻塞（后面的字），记忆宫殿照常 await。
  const saveModel = useCallback(async (full: string) => {
    if (!char || !full.trim()) return;
    DB.saveMessage({
      charId: char.id,
      role: 'assistant',
      type: 'text',
      content: full,
      metadata: { source: 'theater', theaterTag: tagRef.current },
    }).catch((e: any) => addTrace(`模型消息入库失败：${e?.message || e}`));
    runMemoryPost(char);
  }, [char, runMemoryPost, addTrace]);

  /** 手动「再试一次」。⚠️ 必须先清配置键 —— 不清的话会被上面的守卫当重复给挡掉 */
  const retry = useCallback(() => {
    bootedKey.current = '';
    boot();
  }, [boot]);

  return useMemo(
    () => ({ msgs, state, note, send, retry, trace, attachVideo, resetFrames, framesFed }),
    [msgs, state, note, send, retry, trace, attachVideo, resetFrames, framesFed],
  );
}
