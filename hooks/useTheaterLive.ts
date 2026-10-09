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
import { isInvited, setInvited as setInvitedStore } from '../utils/dramaTheater/invite';

export type TheaterMsg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 发出/开始流式的时刻。剧场聊天在气泡旁边显示时间戳（暮色 21:16 要的） */
  ts: number;
  /** 正在流式输出中 */
  streaming?: boolean;
  /** 哪一步剧、哪一集 —— 主聊天里就靠这个把剧里的话认出来 */
  tag?: string;
  /** 空回时显示的那行提示，点它重试 */
  failed?: boolean;
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
  /** 新一轮开始：清空聊天框（从别的页面进播放页时调，切集不要调） */
  startFresh: () => void;
  /** 集末问一句「这有什么想说的」，不显示不入库 */
  /** 已经喂了多少帧（设置页显示用） */
  framesFed: number;
  /** 有没有邀请角色一起看（10-07 02:42 暮色定的） */
  invited: boolean;
  setInvited: (v: boolean) => void;
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
   * **「这条消息属于哪部剧」的唯一出处**（10-08 22:30 暮色截图实锤）
   *
   * ## 原来错在哪
   *
   * 标记只写在 `send()` 里：`tagRef.current = tag`。也就是说
   * **「你在这一轮说过话」才会更新剧名**。
   *
   * 于是换剧之后，只要角色是**自己先开口**（10-08 才加的主动说剧情），
   * 它说的每一句都还挂着**上一部剧**的标签 —— 入库带着错的剧名，
   * 主聊天那个 `剧场 《xxx》` 小标签也是错的，
   * 灌给主聊天模型的上下文 `[剧场 《上一部》]` 同样是错的。
   *
   * `tagRef` 在 `startFresh()` 里也没清（已补上），但那只是治标：
   * 只要新剧里用户一直没说话，模型主动说的话照样是旧标签。
   *
   * ## 现在
   *
   * 每次要用标记都**现算**：问 `scene()`「现在在看哪部哪一集」，
   * 顺手写回 `tagRef` 供别处兜底。
   *
   * ⚠️ `scene` 必须在剧场那边是**稳定引用 + 永远读得到最新值**的
   *（那边已经改成走 ref 了）—— 因为下面 `onText` / `saveModel` 这些
   * 闭包是 boot 时就交出去的，拿的是**建会话那会儿的 scene**。
   * 原来的 `tagRef` 之所以能用，正是因为它是 ref，绕开了这个坑。
   */
  const currentTag = useCallback(() => {
    const s = scene();
    const tag = `《${s.title || '剧场'}》第${s.episode || 1}集`;
    tagRef.current = tag;
    return tag;
  }, [scene]);

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
   * 这一轮**收到过字**的时间戳。0 = 一个字都没收到。
   *
   * ⚠️ 千万别用 `streamingId` 来判「模型有没有回答过」——
   * `onTurnComplete` 一收到就会把它清空，于是「已经答完了」会被误判成
   * 「空回」，紧跟着弹一句「没收到回复」（10-07 03:29 现场，答案就在屏幕上）。
   */
  const answeredAt = useRef(0);
  /** 发出去那一刻连接是不是断着的。断着 = 消息压根没送到，值得自动补发 */
  const sentWhileClosed = useRef(false);
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
  /** 上一次「看一眼」是什么时候（给 NUDGE_MIN_MS 限流用） */
  const lastNudge = useRef(0);
  /** 它最后一次吐字是什么时候。催它之前要看这个：刚说完就该让它歇会儿 */
  const lastSpokeAt = useRef(0);
  /** 他最后一次发话是什么时候。催它之前也要看这个（见抽帧循环里的说明） */
  const lastUserSendAt = useRef(0);
  const audioRef = useRef<AudioTap | null>(null);
  /** 接上声音没有（接不上就只喂画面，不影响别的） */
  const audioOk = useRef(false);
  const framesFedRef = useRef(0);
  /** 多久问一次画面。1.2 秒是「切镜头基本抓得住、静止段几乎不耗」的折中 */
  const FRAME_EVERY = 1200;
  /**
   * 「你自己接一句」最快多久催一次。
   *
   * ## 为什么从 8 秒改成 20 秒（10-08 19:17）
   *
   * 8 秒是**按老的触发方式定的**：那次发的是 `activityStart/activityEnd`，
   * 模型压根不理，等于这个数形同虚设。换成确定能回话的 `clientContent` 之后，
   * 每催一次就是**实打实一句模型的话**——8 秒一集能出十几句，聊天框直接被刷爆。
   *
   * 现在这一句是「陪他一起看」时随口搭的那一嘴，不是解说，
   * 20 秒一句刚好是「一集说三四次」的密度。想更密/更稀只改这一个数。
   */
  const NUDGE_MIN_MS = 20000;
  /**
   * 它刚说完话之后要歇多久才催下一次。
   *
   * 只判 `isSpeaking` 不够：它答完那句的时候 `speaking` 立刻就空了，
   * 但那句往往还有 2~3 秒才说完。这 6 秒是接着那句的，
   * 这时候再塞一句进去，等于把它自己刚讲的那句截断重来。
   */
  const NUDGE_COOLDOWN_MS = 6000;

  /**
   * 播放器把视频元素交过来。**画面和声音都从这里接**。
   *
   * ⚠️ 换 src 时元素不会重建（同一个 video 标签），所以 attach 内部有
   * 「接过就不重复接」的判断 —— 同一个元素调两次 createMediaElementSource
   * 会直接抛异常。
   */
  /**
   * 现在有没有邀请角色一起看（10-07 02:42 暮色定的）。
   *
   * 没邀请 → 角色看不到画面，用户安静追剧。
   * 存在 localStorage 里（见 utils/dramaTheater/invite.ts 的理由）。
   */
  const [invited, setInvitedState] = useState<boolean>(() => isInvited(char?.id || 'none'));
  /** 抽帧循环读的是这个 —— 放 ref 里，循环不用依赖 state */
  const invitedRef = useRef(invited);

  const setInvited = useCallback((v: boolean) => {
    invitedRef.current = v;
    setInvitedState(v);
    setInvitedStore(char?.id || 'none', v);
    // 刚邀请 → 立刻送一帧，别让用户等下一个轮询（最多 1.2 秒的空白）
    if (v) {
      grabberRef.current?.reset();
    } else {
      // 收回邀请 → 把攒着的声音倒掉，别把刚才的台词接着发
      audioRef.current?.flush();
    }
  }, [char?.id]);

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

  /**
   * **新一轮开始**（10-08 18:30 暮色定的）
   *
   * 「每一次从剧场退出来回主屏，这一轮一起看就结束了。
   *   重新进剧场打开视频时聊天框是空的，角色要知道这是新的一轮。」
   *
   * 所以这里做两件事：把聊天框清空 + 把这一轮剩下的临时状态倒干净。
   * **不清库** —— 这一轮的对话退出时会打包发到主聊天，没丢；
   * 剧场只是不再回看它（`boot` 里已经不读库了）。
   *
   * ⚠️ 谁调：**从别的页面进播放页的那一下**，不是每次 `playEpisode` ——
   *    切下一集是同一轮，不能清。清完它这一轮说过的话就断了。
   */
  const startFresh = useCallback(() => {
    flushStreamNow();
    setMsgs([]);
    streamingId.current = '';
    pendingStream.current = '';
    lastNudge.current = 0;
    lastSpokeAt.current = 0;
    lastUserSendAt.current = 0;
    // ⚠️ 上一部剧的标记不能带进这一轮（10-08 22:30）。
    //    不清的话：换剧后**用户还没开口**、角色自己先说话时，
    //    那些话会被打上上一部剧的标签（虽然 currentTag() 已经现算了，
    //    但这里留着清掉，免得别处再读到这个 ref 时拿到脏值）。
    tagRef.current = '';
    grabberRef.current?.reset();
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
   *
   * ## 暮色 02:52 报「没有人设、像旁白」，查下来的结论
   *
   * 先排除了两个常见嫌疑，都**不是**原因：
   *   - 核心指令和世界书有没有带？**带了，而且一直都在。**
   *     `buildSetup()` 里的 `systemInstruction` 是建会话时发一次、
   *     整个会话期间持续生效的，**不是每轮重发，也就不会「后面就没了」**。
   *     内容是 `ContextBuilder.buildCoreContext()` —— 身份、核心指令、世界观、
   *     世界书、私密印象、记忆库、记忆宫殿、角色备忘录、情绪底色，全套。
   *   - 是不是历史把它带跑了？历史走 `clientContent.turns`，也不影响系统指令。
   *
   * 真凶是**对话里塞满了它自己的「解说任务」**：
   * 抽帧循环原来每 1.2 秒就以 `role:'user'` 的身份发一句
   * `（背景画面：正在播到第 3 分 04 秒）`。对模型来说那就是「用户一直在说话，
   * 而且一直在报进度」—— 它的隐含任务自然变成解说这部剧，人设自然掉光。
   *
   * **修法不在提示词里，在发法里**（`liveSession.sendFrame`）：
   * 那句话不再单独成轮，只**攒着**；等用户真开口时拼在他那句话**前面**。
   * 提示词里第 4 条「你不是解说员」只是补一道保险，不是主力。
   */
  /**
   * 现在有没有被邀请一起看（10-07 02:42）。
   *
   * ⚠️⚠️ **必须在组件顶层算，不能写在 buildSystemPrompt 里面** ——
   * 写在里面的那次，真机直接崩了（`ReferenceError: see is not defined`），
   * 因为依赖数组 `[char, userProfile, see]` 在函数**外面**，
   * 那儿访问不到函数体里的局部变量。
   *
   * build + typecheck **两个都拦不住**（作用域错，运行时才炸），
   * 只有真机能发现。跟 07-31 那次是同一类。
   */
  const see = invited;

  const buildSystemPrompt = useCallback((sc: { title: string; episode: number }) => {
    const core = ContextBuilder.buildCoreContext(char, userProfile);
    return `${core}

### [剧场模式]
用户邀请和你一起看《${sc.title || '（剧名未知）'}》，当前是第 ${sc.episode || 1} 集。

画面和声音一直在送过来。每张画面左上角标着「第N集 第X:XX」，是这会儿剧里播到哪儿 —— 切集时这个集号就会变。画面里的字幕直接读、台词直接听，这些是正在发生的事。

#### 什么时候搭话

- 画面里出现新人物、剧情明显往前推了一步 → 用你自己的话随便搭一句。自然地说出你的想法。
- 画面跟前一张差不多、或者你真没什么想说的 → 可以沉默。安静地看也是一种陪伴。
- 用户主动和你说话时，正常回应。用户询问人物、台词或剧情时，根据你实际看到和听到的内容回答。
- 你对剧情、角色的吐槽、猜测、心疼，都是你作为观众的反应，直接说就好。

#### 怎么说

- 你是一起看剧的观众，不是负责讲解剧情的人。你的发言来自你对剧情的真实反应，可以表达喜好、判断、猜测和情绪，也可以和用户讨论剧情、人物及后续发展。

- 发言应自然、简短，符合你自己的性格和说话习惯。让对话像两个人一起看剧时随口发生的交流，而不是对画面的逐条描述。

- 回答只输出自然的纯文字，直接说你想表达的话。`;
  }, [char, userProfile, see]);

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

    // 1. **不再读上一轮的剧场记录**（10-08 18:30 暮色定的）
    //
    // 原来每次 boot 都从库里取最近 40 条 `source==='theater'` 灌进会话。
    // 暮色要的是「每一轮一起看就是一轮，退出回主屏就结束了」：
    //   - 重新进剧场，**聊天框是空的**
    //   - 角色要明确知道**这是新的一轮**
    //
    // 不灌还有一个连带好处：**复读滚雪球的根被切掉了**。
    // 之前那个「同一段话说三遍」的循环，就是它照着自己上一轮复读的样子再写一遍，
    // 而复读的样子全在被重灌的历史里。没有历史可模仿，它只能顺着当下说话。
    //
    // 这一轮的对话并没有丢 —— 退出剧场时 `finishTheaterSession` 会**全部**打包
    // 发到主聊天（那张折叠卡片里）。剧场只是不再回看它。
    //
    // ⚠️ 记忆宫殿那边照旧要读全部消息（下面第 2 步）——那是给**主聊天**注入记忆用的，
    //    跟剧场本轮的上下文是两回事，别一起删了。
    //
    // ⚠️⚠️ 10-09 更正：这一段当时**只做了一半**。
    //    上面删掉的是一条道，第 3 步「灌历史」那条道没堵 ——
    //    上一轮剧场说的话和每场的折叠卡片，照样被当成普通历史灌进了新一轮。
    //    所以「每一轮从零开始」其实一直没真正生效（10-09 00:46 截图：它把
    //    提示词原样背出来，还自己纠正自己）。第 3 步现在也堵上了。

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

    /**
     * 现场：核心指令到底带没带（暮色 02:52 问的「是刚开始带了后面就没了，还是每一轮都带」）。
     *
     * 结论是「**建会话时发一次、整个会话持续生效**，不是每轮重发」——
     * `buildSetup()` 里的 `systemInstruction` 就是这个机制，服务端那边
     * 在关掉连接之前一直拿着它。所以不存在「后面就没了」这种可能。
     *
     * 这里把拼出来的东西记一份到 window上，真机上直接读：
     * 能看到角色指令、世界观、世界书、私密印象、记忆库这些段都在不在。
     */
    const wDiag = window as any;
    wDiag.__livePrompt = {
      chars: core.length,
      heads: (core.match(/^#{2,3} .+$/gm) || []).slice(0, 40),
      hasChar: core.includes('核心性格/指令'),
      hasWorldview: /世界观/.test(core),
      hasWorldbook: /世界书|Worldbook|World Book/i.test(core),
      hasImpression: /私密|印象/.test(core),
      hasMemory: /记忆/.test(core),
      at: Date.now(),
    };

    // 3. 历史 —— 主聊天里的日常记录（剧场的话**不进**这里）
    //
    // 条数 100（暮色 00:34 定的）。主聊天那边是 `char.contextLimit` 默认 500，
    // 剧场照抄那么多又慢又没必要。
    //
    // ⚠️⚠️ **上一轮的剧场记录必须排掉**（10-09 00:58 暮色 22:xx 报错后定的）
    //
    // 原来这里只清工具标签，**来者不拒**——剧场里说的话（`source === 'theater'`）
    // 和每场结束时写的那张折叠卡片，全被当成普通历史灌进了新一轮的会话。
    // 于是「每一轮从零开始」根本没生效：模型一边看着上一轮从头到尾的对话，
    // 一边被提示词要求「你是全新的」—— 它当然懵，于是把提示词原样背出来、
    // 自己跟自己纠正（10-09 00:46 截图就是这个样子）。
    //
    // 第 1 步那段注释写着「不再读上一轮的剧场记录」，**其实只做了一半**：
    // 这里这条道没堵上。两处一起堵才算真的不读。
    //
    // 主聊天的日常记录**保留** —— 同一个角色，日常里聊到哪他也该记得，
    // 人设也是从这儿和角色卡一起带过去的（暮色：「消息上下文会带人设」）。
    //
    // ⚠️ 别给历史加 [剧场] 之类前缀 —— 模型会把它当自己的台词 pattern，
    // 然后输出切成「[剧场]xxx，[剧场]yyy」这种碎段（10-06 现场）。
    let history: LiveTurn[] = [];
    let lastEp = 0;
    const sc = scene();
    try {
      const all = (await DB.getMessagesByCharId(char.id, true)).slice()
        .sort((a: any, b: any) => a.timestamp - b.timestamp);
      /**
       * 顺手算出「这场上一轮看到第几集」—— 开场那句要念给角色听。
       * 找的是**同一部剧**最近一张剧场卡片；找不到就是第一次看，不念集号。
       */
      for (const m of all) {
        const md = m?.metadata || {};
        if (!md.isTheaterMemory) continue;
        if (String(md.theaterTitle || '') !== String(sc.title || '')) continue;
        // ⚠️ 取**最后一张**卡，不是全场最大集号。
        //    他可能看完 10 集又倒回去重看第 3 集 —— 那「上次看到」就是第 3 集。
        //    `all` 已按时间升序，所以后来的直接覆盖前面的。
        const eps = Array.isArray(md.theaterEpisodes) ? md.theaterEpisodes.map(Number).filter(Boolean) : [];
        lastEp = Number(md.theaterEpisode) || (eps.length ? Math.max(...eps) : 0);
      }
      history = all
        // ⚠️ 剧场里说的话 + 剧场折叠卡片 —— **都不带进新一轮**
        .filter((m: any) => m.metadata?.source !== 'theater' && m.metadata?.isTheaterMemory !== true)
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
         * ⚠️ 一收到字就记时间戳。空回兜底的判据靠它（见 send 里的注释）。
         * 这个必须**第一个**做 —— 后面的代码有提前 return 的路径。
         */
        answeredAt.current = Date.now();
        lastSpokeAt.current = Date.now();
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
          if (!text) return;
          setMsgs((old) => {
            // ⚠️ 空回修复（暮色 02:52）：streamingId 是空 = 这轮还没建过泡。
            // 真收到字了才补建 —— 之前是发送时就插空的，模型不回答就留个空气泡。
            if (!streamingId.current) {
              const mid = `m${Date.now()}`;
              streamingId.current = mid;
              return [...old, { id: mid, role: 'assistant', text, ts: Date.now(), streaming: true, tag: currentTag() }];
            }
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

    /**
     * 5. **新一轮开场，给角色发一条**（暮色 10-09 00:58 定的）
     *
     * ## 他要的
     *
     * 「新的一轮连接上就给角色发的一条消息，提醒角色，用户邀请你一起看 xxx，
     *   上次看到了第 x 集，继续一起观看吧。消息上下文会带人设，让角色保持原本人设就可以了。」
     *
     * ## 为什么非得单发一条，而不是只写进提示词
     *
     * 因为**光在提示词里说「这是新一轮」不够** —— 之前就是这么写的，
     * 结果模型一边被告知「你是全新的」，一边眼前挂着上一轮从头到尾的对话，
     * 干脆把整段要求背给用户听，还自己纠正自己（10-09 00:46 截图）。
     *
     * 现在三件事各归各位：
     *   - **聊天框干净**：上一轮的剧场记录一条都不带进来（见第 3 步）
     *   - **记忆还在**：记忆宫殿照旧注入（见第 2 步），它对那一场是有印象的
     *   - **开场点明**：一条真实的消息告诉它「在看哪部、从第几集接着看」
     *
     * 这三条凑齐，它才是「记得、但从头看起」，而不是「失忆」也不是「照着复读」。
     *
     * ## 为什么不显示在聊天框里，也不入库
     *
     * 这不是暮色打的字。显示成用户气泡等于骗他显示；入库的话又会混进主聊天上下文。
     * 跟之前那个集末问句一个处理：**只发给模型**，界面上不留痕。
     * 要看发了什么，读手机调试口里的 `window.__liveTx.last`（记的是 `OPEN-round`）。
     *
     * ⚠️ 只在**邀请了一起看**的时候发。没邀请它连画面都没有，
     *    说「邀请你一起看」是假的（那种情况提示词里另有一支，见 buildSystemPrompt）。
     */
    if (invitedRef.current && sc.title) {
      const cur = Number(sc.episode) || 1;
      const opening = lastEp > 0
        ? `用户邀请你一起看《${sc.title}》。你们上次一起看到第 ${lastEp} 集，现在从第 ${cur} 集继续一起看吧。`
        : `用户邀请你一起看《${sc.title}》，现在从第 ${cur} 集开始一起看。`;
      addTrace(`新一轮开场：${opening}`);
      // ⚠️ 用 `s.send` 而不是外面那个 `send`：外面那个会建气泡、会写库，
      //    这条都不是用户按的，两者都不该发生。断线时它会自己攒着重连补发。
      s.send(opening, 'OPEN-round');
    }
    // ⚠️ `scene` 故意不在依赖里（它每次 render 都是新对象，会让 boot 反复重跑）。
    //    currentTag 包了它，所以也不加 —— 剧场那边已把 scene 改成**稳定引用**，
    //    currentTag 也就恒定不变，这里闭包拿到的跟最新值一致。
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
  /**
   * 配置键。⚠️ **邀请状态必须算进去**（10-07 02:42）：
   * 有没有邀请会改**系统提示词**（「你看得见」vs「你看不见」），
   * 不重连的话服务端那边还拿着旧提示 —— 会出现「用户明明没邀请，
   * 角色却说自己看得见」这种自相矛盾。
   * 所以切换邀请 = 重新开一次会话，这是有意的，不是 bug。
   */
  const cfgKey = `${char?.id || ''}|${liveModel || ''}|${liveBaseUrl || ''}|${apiKey ? 'k' : ''}|${invited ? 'inv' : ''}`;

  // 最新的 boot 放 ref 里用，绕开它的引用变化
  const bootRef = useRef(boot);
  bootRef.current = boot;

  useEffect(() => {
    // ⚠️⚠️ **没邀请 = 压根不把他接进来**（暮色 10-07 03:29 定的）
    //
    // 我昨天只做了一半：把「不邀请时不喂画面声音」做了，**连接照建、话照说**。
    // 现场就是暮色截的那张图 —— 没邀请，角色照样回了一堆
    // 「我现在什么都看不见」，同样的话还说了三遍。
    //
    // 他要的是这个逻辑：
    //   点进去自己看 → **不接 API**。没人在线，没人说话，不重连，不烧流量。
    //   邀请他一起看 → 才把他接进来，才开始送画面和声音。
    //
    // 「连着但不给画面」跟「压根没接进来」是两回事 ——
    // 前者那个角色是被拉进来陪你坐着的，只不过被蒙着眼（所以他会说
    // 「你为什么不邀请我」这种别扭的话，还一直重连）；
    // 后者才是「我自己安静追剧」。
    if (!active || !invited) {
      // 离开播放页 / 收回邀请：关连接、清现场
      if (streamTimer.current) {
        window.clearTimeout(streamTimer.current);
        streamTimer.current = 0;
      }
      pendingStream.current = '';
      streamingId.current = '';
      bootedKey.current = '';
      // 攒着的背景说明也倒掉 —— 邀请收回之后那些帧已经跟他无关了
      audioRef.current?.flush();
      grabberRef.current?.reset();
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
    // ⚠️ `invited` 要**显式**进依赖，不能只靠 cfgKey 那一层。
    // 依赖数组里只写 cfgKey 的话，编译器不知道这里读了 invited；
    // 以后谁把 cfgKey 改了格式，这里就静默失效了 —— 那种坑最难查。
  }, [active, invited, cfgKey]);

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

      /**
       * 🔍 现场记录（10-07 17:07，**只读，不改行为**）
       *
       * 「一点声音都没有」这个现象我连推两次都错了，所以现在只记不改。
       * 这几行能把四种可能一次分清（详见 utils/dramaTheater/audioTap.ts 顶上那段）：
       *   循环根本进不来   → 看到「没进来」且原因那栏写着 noVideo/noSession…
       *   接上了但通道睡着 → 「进了」里 通道状态: 'suspended'
       *   接着但不出数据   → 通道状态 running，但 pending 一直是 0
       *   数据正常         → pending 有数、送出去有计数
       *
       * ⚠️ 一定要**在所有 return 之前**记，否则「循环没进来」这种情况恰恰
       * 是最关键的证据，却什么都留不下（前两轮就是死在这）。
       */
      const w = window as any;
      if (!w.__audioTick) w.__audioTick = { n: 0 };
      // ⚠️ 先收一个局部引用 —— 直接在下面连着写 `audioRef.current.xxx`，
      // TS 会判可空（TS18047），因为它在每一行之间都可能被别处改掉
      const tap = audioRef.current;
      w.__audioTick.n++;
      w.__audioTick.pending = tap?.pending ?? -1;
      w.__audioTick.hasVideo = !!v;
      w.__audioTick.sessionOpen = !!s?.isOpen;
      w.__audioTick.audioOk = audioOk.current;
      w.__audioTick.invited = invitedRef.current;
      w.__audioTick.paused = !!v?.paused;
      // ⚠️ 判据**必须跟改之前一模一样**（audioOk，不是 tap 在不在）——
      // 这一段是纯记录，任何「顺手改一下」都会让记录本身就不可信了
      if (!v || !s || !s.isOpen || v.paused || !audioOk.current || !tap) {
        w.__audioTick.why = !v ? 'noVideo' : !s ? 'noSession' : !s.isOpen ? 'sessionClosed'
          : v.paused ? 'paused' : !audioOk.current ? 'audioOk=false' : '没有采集器';
        return;
      }
      if (!invitedRef.current) { tap.flush(); w.__audioTick.why = '没邀请'; return; }
      tap.resume();
      const chunk = tap.takeChunk();
      w.__audioTick.why = '在送';
      w.__audioTick.sent = (w.__audioTick.sent || 0) + (chunk ? 1 : 0);
      if (chunk) {
        s.sendAudio(floatToPcmBase64(chunk));
      } else {
        // 一包都攒不出来 —— 说明采集端根本没在出数据，记下来别再猜
        const wm = window as any;
        if (wm.__liveMedia && !wm.__liveMedia.audioWarned) {
          wm.__liveMedia.audioWarned = true;
          wm.__liveMedia.audioWhy = `200ms 了还攒不出 100ms 的包（pending=${tap.pending}）`;
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
      // ⚠️ 没邀请 → 他不看，就别抽帧（省掉的是手机的电和渲染压力）
      if (!invitedRef.current) return;
      if (!grabberRef.current) grabberRef.current = new FrameGrabber();
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      const sc = scene();
      const f = grabberRef.current!.grab(v, false, `第${sc.episode || 1}集`);
      // 没变化 → 不送（省下的不是流量，是不让它对着静止画面反复琢磨）
      if (!f) return;
      if (!s.sendFrame(f.data, f.at, dur)) return;
      framesFedRef.current++;

      /**
       * 送完这一帧，**跟着硬问它一句「你自己接一句」**（10-08 19:17 暮色定的）。
       *
       * ## 为什么必须由代码来问
       *
       * 实时模型是对「一次输入」回话的，光往里持续灌画面，它只在人真正说话时才回
       * —— 这就是暮色报的「没有主动说剧情，只有问了才说」。
       * 原先发的 `activityStart/activityEnd`（协议里本来就有的「一段输入开始/结束」）
       * 实测**一点用都没有**：发出去毫无反应，又不报错。
       * 现在退回 `clientContent` 硬问 —— 主聊天每一句都是这么走的，它一定回。
       * 代价是它**没法真的闭嘴**，所以「什么值得说」这件事改在代码里判。
       *
       * ## 五道闸（从松到紧）
       *
       *   1. `grab()` 里「画面跟前一张差不多就不送」—— **这一道才是「闭嘴」**
       *      （静止的对白镜头连问都不会问）
       *   2. `NUDGE_MIN_MS` 20 秒 —— 最多 20 秒一句，一集三四句
       *   3. `NUDGE_COOLDOWN_MS` 6 秒 —— 它刚说完那 6 秒内不催，别把刚讲的截断
       *   4. `isSpeaking` —— 正在说话不催（`nudgeScene` 内部还会再兜一层）
       *   5. **他刚发话 8 秒内不催** —— 他问了一句正等回答，这时插一句
       *      「画面往前走了一步」，两轮问答叠着发出去，模型会以为要一起回答
       *
       * ## 它答完会自己决定说什么
       *
       * 提示词里写着「像坐在旁边看，别解说、别总结」，所以回的是
       * 「刚那个小师妹是不是哭了」这种搭话，不是解说词。
       */
      const now = Date.now();
      const spokeAgo = now - lastSpokeAt.current;
      const userAgo = now - lastUserSendAt.current;
      if (
        !s.isSpeaking
        && spokeAgo >= NUDGE_COOLDOWN_MS
        && userAgo >= 8000
        && now - lastNudge.current >= NUDGE_MIN_MS
      ) {
        lastNudge.current = now;
        s.nudgeScene();
      }
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
    // ⚠️⚠️ 没邀请就不该有话可说（暮色 10-07 03:29：「压根就不把他接进来」）。
    //
    // 这一行**不是多余的**。原来 `LiveSession.send()` 在没连上时会
    // 把这句话 **push 进 pendingInput 然后自己 start()** ——
    // 也就是说「不邀请」这个状态下发一条消息，**反而会把连接建起来**，
    // 上一行加的 `!invited` 守卫就白写了。
    //
    // 不邀请时聊天区本来就不渲染（见 TheaterApp），这里是第二道闸：
    // 万一以后哪个入口漏了，也不会偷偷把人接进来。
    if (!invitedRef.current) return;
    const tag = currentTag();

    // ① 先让用户看到这条消息
    setMsgs((old) => [...old, { id: `u${Date.now()}`, role: 'user', text, tag, ts: Date.now() }]);

    // ② ⚠️ **不预插空泡了**（暮色 02:52 报「空气泡」）。
    //
    // 原来发送时就插一条空的占位，等流式往里填。问题是**模型这轮空回**
    // （被打断 / 连接刚重连上 / 服务端只回了个 turnComplete），
    // 那条空泡就永远留在屏幕上 —— 用户看到一个空白的 AI 气泡。
    //
    // 现在改成：**真收到第一个字的时候才建这个泡**。
    // onText 里发现 streamingId 是空的就补建一条。
    // 代价是模型响应快了的话，头一个字要等几十毫秒才出现 —— 那点延迟
    // 换掉一个空气泡，值。
    const mid = '';
    streamingId.current = mid;

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
    //
    // ⚠️⚠️ **两个定时器的判据不能用 `streamingId`**（10-07 03:29 现场：同样的话说了三遍）。
    //
    // 原来的两个错：
    //   1. `onTurnComplete` 一收到就 `streamingId.current = ''`。
    //      于是「模型已经答完了、只是正好答得快」的情况下，12 秒那个检查照样判定成
    //      「空回」，紧跟着弹一句「没收到回复，点这里再试一次」——
    //      **答案明明就在屏幕上**。截图里就是这个样子。
    //   2. 重发是**把同一句再送一遍**。这在模型那边是**新的一轮对话**，
    //      于是它对着同一句再答一次。跟重连一叠，就成了三遍。
    //
    // 现在分开记两件事：
    //   - `answeredAt`：**这一轮收到过字**。它只增不减，所以「已经答完了」不会被误判。
    //   - `sentWhileClosed`：发的时候连接本来就是断的 → 消息**根本没发出去**，
    //     这种才值得自动重发（重发的是「没送出去的东西」，不是「模型选择不回答」）。
    const sess = sessRef.current;
    const wasClosed = !sess || !sess.isOpen;
    sentWhileClosed.current = wasClosed;
    answeredAt.current = 0;
    // 记一下他刚发话 —— 抽帧循环在催「自己接一句」之前要看这个：
    // 他刚问了一句正等着回答，这时再插一句「画面往前走了一步」，
    // 两轮问答叠在一起，它会以为要一起回答。
    lastUserSendAt.current = Date.now();
    sess?.send(text);

    // ⑤ 空回兜底
    //    - 连接本来就断着 → 8 秒后自动补发一次（消息可能压根没到）
    //    - 连接是好的   → **不重发**，12 秒后只显示提示，让他自己点
    //      （模型收到了却没回答，再送一遍只会得到第二份重复的回答）
    window.setTimeout(() => {
      if (answeredAt.current) return;
      if (!sentWhileClosed.current) return;
      // ⚠️ 只补发没送出去的那句，且只补一次
      sentWhileClosed.current = false;
      sessRef.current?.send(text);
    }, 8000);

    window.setTimeout(() => {
      if (answeredAt.current) return;
      setMsgs((old) => {
        // 已经有人在界面上了就别再补这句（连点两次发送会各起一个定时器）
        if (old.some((m) => m.failed)) return old;
        return [
          ...old,
          {
            id: `e${Date.now()}`,
            role: 'assistant' as const,
            text: '没收到回复，点这里再试一次',
            ts: Date.now(),
            tag: currentTag(),
            failed: true,
          },
        ];
      });
    }, 12000);
  }, [char, currentTag, addTrace]);

  /** 模型这一轮说完了 → 入库 + 记忆后处理 */
  // 入库仍然不阻塞（后面的字），记忆宫殿照常 await。
  const saveModel = useCallback(async (full: string) => {
    if (!char || !full.trim()) return;
    DB.saveMessage({
      charId: char.id,
      role: 'assistant',
      type: 'text',
      content: full,
      // ⚠️ 现算标记，不读 tagRef（10-08 22:30）。
      //    这段闭包是 boot 时交出去的，tagRef 只在「用户发过话」时更新过 ——
      //    换剧之后角色自己开口说的话会被打上上一部剧的剧名。
      metadata: { source: 'theater', theaterTag: currentTag() },
    }).catch((e: any) => addTrace(`模型消息入库失败：${e?.message || e}`));
    runMemoryPost(char);
  }, [char, runMemoryPost, addTrace, currentTag]);


  /** 手动「再试一次」。⚠️ 必须先清配置键 —— 不清的话会被上面的守卫当重复给挡掉 */
  const retry = useCallback(() => {
    bootedKey.current = '';
    boot();
  }, [boot]);

  return useMemo(
    () => ({
      msgs, state, note, send, retry, trace,
      attachVideo, resetFrames, startFresh, framesFed,
      invited, setInvited,
    }),
    [msgs, state, note, send, retry, trace, attachVideo, resetFrames, startFresh, framesFed, invited, setInvited],
  );
}
