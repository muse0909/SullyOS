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
};

/** 进场时灌多少条历史给模型。太多会挤掉角色卡，太少接不上话 */
const HISTORY_TURNS = 20;

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

  const addTrace = useCallback((s: string) => {
    setTrace((old) => [...old.slice(-40), s]);
  }, []);

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

1. **你看不到画面，也不知道剧情演到哪了。** 你只能从用户说的话里知道发生了什么。
   用户问你「现在演到哪了」「刚才是谁」，老实说不知道 —— **绝对不要编剧情**。
   角色扮演最容易被顺着骗过去编出一整段不存在的剧情，这里一个字都不要编。

2. **聊天区在视频下面，视频正在放，用户随时可能没在看你。**
   他没跟你说话的时候，不要主动开口、不要评价剧情。
   用户没叫你的时候，安静看剧就好。

3. 你现在说的每一句都会**逐字出现在用户的聊天框里**，用户会当成你的原话。
   不要用「我可以帮你分析剧情」这种服务腔，直接说人话。

> ⚠️ 这里**故意不写「播到第几分钟」**：播放进度只在开场那一刻读一次，
> 写在提示词里就是个一直不变的假数字，比不写更糟（用户会以为它准）。
> 等第 3 步接上画面，模型自己就知道看到哪了。`;
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
    try {
      const all = await DB.getMessagesByCharId(char.id, true);
      const mine = all
        .filter((m: any) => m.metadata?.source === 'theater')
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .slice(-40)
        .map((m: any) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          text: m.content,
          tag: (m.metadata?.theaterTag as string) || '',
        }));
      setMsgs(mine);
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

    // 3. 历史（不限来源 —— 同一个角色，主聊天里聊到哪他也该记得）
    let history: LiveTurn[] = [];
    try {
      const all = await DB.getMessagesByCharId(char.id, true);
      history = all
        .slice(-HISTORY_TURNS)
        .map((m: any) => ({
          role: (m.role === 'assistant' ? 'model' : 'user') as 'user' | 'model',
          // ⚠️ 别给历史加前缀（比如 [剧场]）。模型会把这个当自己的台词 pattern，
          // 然后每场都吐「[剧场] xxx，[剧场] yyy」出来 —— 现场模型自己卡到这种碎法。
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
        setMsgs((old) => {
          const i = old.findIndex((m) => m.id === streamingId.current);
          if (i < 0) return old;
          const next = old.slice();
          next[i] = { ...next[i], text: full, streaming: true };
          return next;
        });
      },
      onInterrupted: () => {
        // 用户插话把它打断了：把没说完的那条定稿，别留半句
        const id = streamingId.current;
        if (!id) return;
        setMsgs((old) => old.map((m) => (m.id === id ? { ...m, streaming: false } : m)));
        streamingId.current = '';
      },
      onTurnComplete: async (full) => {
        const id = streamingId.current;
        streamingId.current = '';
        setMsgs((old) => old.map((m) => (m.id === id ? { ...m, text: full, streaming: false } : m)));
        await saveModel(full);
      },
    });
    sessRef.current = s;
    await s.start();
  }, [char, apiKey, liveModel, liveBaseUrl, userProfile, buildSystemPrompt, addToast, onReady, addTrace]);

  useEffect(() => {
    // 不在播放页就断开 —— 实时会话是长连接，不能在用户只是划海报的时候白挂着
    if (!active) {
      sessRef.current?.close();
      sessRef.current = null;
      setState('idle');
      setNote('');
      return;
    }
    boot();
    return () => { sessRef.current?.close(); sessRef.current = null; };
    // ⚠️ 依赖里**不能**放 scene / onReady 这类每次 render 都新建的回调，
    // 放进去会让这个 effect 每次渲染都重跑一遍 = 反复重连。
    // scene 是通过闭包读的，它自己不在依赖里（见接线处）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, boot]);

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
  const saveModel = useCallback((full: string) => {
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

  const retry = useCallback(() => { boot(); }, [boot]);

  return useMemo(() => ({ msgs, state, note, send, retry, trace }), [msgs, state, note, send, retry, trace]);
}
