/**
 * 剧场 · 播放器（**悬浮窗**，暮色 2026-10-07 15:26 定的）
 *
 * ## 为什么改成悬浮窗
 *
 * 原来它是页面流里的一个块（`shrink-0 relative`），高度按
 * 「宽度撑满 → 除以视频比例 → 最高不超过 42vh/64vh」算。这套算法有个致命的地方：
 *
 * **宽度不是自己定的，是被高度倒推出来的。**
 * 竖屏剧比例 0.56，最高 354px 高 → 宽度只能是 354 × 0.56 ≈ 200px，
 * 整个容器缩成 200px 宽居中放着，两侧露出来的是**页面白底**（10-07 真机截图）。
 * 横屏剧比例 1.78，354 × 1.78 = 630 > 手机宽度，所以上限用不上，宽度照旧撑满 —— 所以
 * 「横版好好的、竖版特别小」，同一个根因两种表现。
 *
 * 软键盘一弹，可视屏高变小 → 那个上限跟着变小 → 连**横版剧**都被压窄、两侧露白边。
 * 同一个根因的第三种表现。
 *
 * 暮色的方案是：**播放器变成悬浮窗，背景是全屏聊天页。**
 * 比例不变、大小只调宽度、位置随便拖。这套算法里没有「高度倒推宽度」，
 * 上面三种表现一起消失。
 *
 * ## 骨架是照抄共读的（apps/CoReadFloatingWindow.tsx）
 *
 * 那边已经趟过两个坑：
 *   1. 必须 `createPortal(…, document.body)` —— 手机外壳那层有 overflow-hidden
 *      和 transform，fixed 元素在里面会被裁（AGENTS.md §6.2）。
 *   2. 拖动用 pointer 事件 + `touchAction: 'none'`，不是 mouse/touch 事件。
 *
 * ## ⚠️ 全屏切换**必须复用同一个 DOM 节点**
 *
 * 全屏和浮窗是**同一个 div 的同一套 style**，只改值不换节点。
 * 换成两个分支各渲染一套的话，`key={src}` 相同但父节点换了，video 还是会被重建 ———
 * 而声音采集走的是 `createMediaElementSource(video)`，**同一个 video 元素只能接一次**，
 * 接第二次直接抛异常。换节点 = 声音当场断掉，而且没有任何报错。
 *
 * 所以下面根 div 上没有任何条件渲染包着 video。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, SpeakerHigh, SpeakerSlash, CornersOut, CornersIn, SkipForward,
  ArrowCounterClockwise, Broom, FilmSlate,
} from '@phosphor-icons/react';
import type { Palette } from '../../utils/dramaTheater/theme';

export function fmtTime(s: number): string {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

type Props = {
  src: string;
  episode: number;
  /** 剧名 —— 用来记这部剧的视频比例，好让第一次播也知道该多高 */
  title?: string;
  onEnded: () => void;
  onTime: (position: number, duration: number) => void;
  loading: boolean;
  loadProgress: number;
  /** 加载遮罩上那行字 —— 在线流和「从电脑取文件」不是一回事，别一律写「从电脑取」 */
  loadHint?: string;
  error: string;
  onRetry: () => void;
  /** 播放位满了：给一个「一次清空所有播放位」的动作（短剧库新加的 closeAll） */
  onClearAll?: () => void;
  hasNext: boolean;
  onNext: () => void;
  /** 打开选集抽屉（暮色 10-07：「选集放最右」） */
  onOpenEpisodes?: () => void;
  /** 拖完进度条 */
  onSeek?: (t: number) => void;
  /** 媒体本身放不出来（比如手机本地文件地址被内核拒了），交给外层换一条路 */
  onMediaError?: () => void;
  /** 真的播起来了（用来把「误报的 error」撤回去） */
  onMediaReady?: () => void;
  /**
   * 第 3 步：把视频元素交出去，外层要抓帧喂给角色。
   *
   * ⚠️ 用回调 ref，**不要**跟 `videoRef` 合成一个 ——
   * 合成的话外层拿到的引用会随内部重建变，通知不上。
   */
  onVideoEl?: (el: HTMLVideoElement | null) => void;
  /**
   * 从第几秒开始播（「接着看」要接着上次的进度）。
   * 只在这一集第一次 ready 时生效一次，拖过之后不再管。
   */
  resumeAt?: number;
  p: Palette;
};

/**
 * 每部剧的视频比例，存本地。
 *
 * 为什么记：横屏剧（16:9）和竖屏剧（9:16）自然高度差一倍多，而 `<video>`
 * 在元数据读出来之前**没有固有高度**（真正的原因不是 max-h，是这个）。
 * 不知道比例就没法在第一次播的时候给对高度。
 *
 * 同一部剧所有集比例是一样的，所以第一次播完记住之后，之后都能提前算准。
 */
const RATIO_KEY = 'theater_ratio';
const SIZE_KEY = 'theater_float_size';
const POS_KEY = 'theater_float_pos';

function readRatio(title?: string): number {
  if (!title) return 0;
  try {
    const map = JSON.parse(localStorage.getItem(RATIO_KEY) || '{}');
    const r = Number(map[title] || 0);
    return r > 0.1 && r < 10 ? r : 0;
  } catch {
    return 0;
  }
}

function saveRatio(title: string | undefined, ratio: number): void {
  if (!title || !(ratio > 0.1 && ratio < 10)) return;
  try {
    const map = JSON.parse(localStorage.getItem(RATIO_KEY) || '{}');
    if (Math.abs(Number(map[title] || 0) - ratio) < 0.01) return;
    map[title] = Math.round(ratio * 1000) / 1000;
    const keys = Object.keys(map);
    if (keys.length > 30) keys.slice(0, keys.length - 30).forEach((k) => delete map[k]);
    localStorage.setItem(RATIO_KEY, JSON.stringify(map));
  } catch { /* 存不下就用默认值，不影响播放 */ }
}

/** 三档大小 —— **按宽度**，高度让比例自己算（暮色 10-07：「比例不变，大小只调整宽度」） */
type SizeMode = 'small' | 'medium' | 'large';
const SIZE_PCT: Record<SizeMode, number> = { small: 48, medium: 70, large: 92 };
const SIZE_LABEL: Record<SizeMode, string> = { small: '小', medium: '中', large: '大' };
const NEXT_SIZE: Record<SizeMode, SizeMode> = { small: 'medium', medium: 'large', large: 'small' };

/** 顶部留出状态栏 */
const SAFE_TOP = 34;
/**
 * 底部留出聊天输入框的高度。
 *
 * 暮色 10-07 15:26 选的 B 方案：浮窗压住输入框时自动往上顶，
 * 存档时也错开 —— 拖一次歪了就得手动救一次，太烦。
 */
const INPUT_GUARD = 118;
/** 边缘留一点，手指好抓 */
const EDGE = 6;
/** 比例还不知道时先按这个算（介于横竖之间，猜错的跳变最小） */
const GUESS_RATIO = 1.2;
/** 长按多久算「在拖」，不是点一下 */
const LONG_PRESS_MS = 320;
/** 挪动超过这么多像素也算在拖（不用等满时间，更跟手） */
const DRAG_SLOP = 8;

/** 只有有限的时长才算数（在线流时长是 Infinity，判真会把 Infinity 存进 currentTime） */
const durOk = (x: number) => Number.isFinite(x) && x > 0;

const PlayerStage: React.FC<Props> = ({
  src, episode, title, onEnded, onTime,
  loading, loadProgress, loadHint, error, onRetry, onClearAll, hasNext, onNext,
  onOpenEpisodes, onSeek, onMediaError, onMediaReady, onVideoEl, resumeAt, p,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 第 3 步：把元素交给外层抓帧。回调 ref 每次都返回 null 再返回 el，
  // 这样换 src 时外层也知道「旧的没了」，不会拿着已卸载的元素去抽帧。
  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    onVideoEl?.(el);
  }, [onVideoEl]);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  /** 诊断：视频元素自身的事件 */
  const d = (s: string, extra?: Record<string, unknown>) => {
    try {
      const w = window as unknown as { __theaterDiag?: unknown[] };
      if (!w.__theaterDiag) w.__theaterDiag = [];
      w.__theaterDiag.push({ t: new Date().toISOString().slice(11, 19), step: '播放器:' + s, ...(extra || {}) });
    } catch { /* 忽略 */ }
  };
  const [scrub, setScrub] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [ratio, setRatio] = useState(() => readRatio(title));
  const [barOn, setBarOn] = useState(true);
  const [full, setFull] = useState(false);
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef<number | null>(null);

  // ── 大小档位（存本地，用户调过一次就记住）────────────────
  const [size, setSize] = useState<SizeMode>(() => {
    try {
      const raw = localStorage.getItem(SIZE_KEY);
      if (raw === 'small' || raw === 'medium' || raw === 'large') return raw;
    } catch { /* 读不到就用默认 */ }
    return 'medium';
  });

  /**
   * 位置存的是**中心点**，不是左上角。
   *
   * 因为大小切档时宽度会变 —— 存左上角的话，从「大」切到「小」会往左跳一大截；
   * 存中心点则四周对称地缩，放着不动才符合直觉（暮色 10-07 15:26 定的）。
   */
  const [center, setCenter] = useState<{ cx: number; cy: number }>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (typeof o?.cx === 'number' && typeof o?.cy === 'number') return { cx: o.cx, cy: o.cy };
      }
    } catch { /* 读不到就默认位置 */ }
    return { cx: vw / 2, cy: vh / 2 - 40 };
  });

  // 换集就归零，不然上一集的进度会挂在新集上
  useEffect(() => {
    setPos(0);
    setDur(0);
    setScrub(null);
    setEnded(false);
    setBarOn(true);
    // 换集退出全屏 —— 停在全屏里换集会让人以为没换
    setFull(false);
  }, [src]);

  // 换剧就换回这部剧记着的比例
  useEffect(() => { setRatio(readRatio(title)); }, [title]);

  // ── 几何 ──────────────────────────────────────────────
  const geo = useMemo(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 400;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const r = ratio > 0.1 ? ratio : GUESS_RATIO;
    const want = Math.round(vw * SIZE_PCT[size] / 100);
    // 可用高度 = 屏高 - 状态栏 - 输入框那一条 - 边距。
    // 竖屏大档在小屏手机上可能比可用高度还高 —— 那就**收窄**而不是截断：
    // 截断会破坏比例（暮色：「可以有黑边，但要保证画面全部显示出来」），
    // 收窄只是那一档在小屏上没那么大，比例一点不变。
    const availH = Math.max(120, vh - SAFE_TOP - INPUT_GUARD - EDGE * 2);
    const w = Math.max(140, Math.min(want, Math.round(availH * r)));
    const h = Math.round(w / r);
    return { vw, vh, w, h };
  }, [size, ratio]);

  /**
   * 把中心点夹回屏幕内（并且不压住输入框）。
   *
   * ⚠️ 高的时候 min > max（浮窗比可用高度还高），这时**贴顶**而不是算出一个
   * 反过来的区间 —— `Math.min(Math.max(v, min), max)` 遇到 min > max 会静默给出 min，
   * 看着对其实每次重渲染都在变。
   */
  const clampCenter = useCallback((cx: number, cy: number) => {
    const { vw, vh, w, h } = geo;
    const minCx = Math.min(w / 2 + EDGE, vw / 2);
    const maxCx = Math.max(minCx, vw - w / 2 - EDGE);
    const minCy = Math.min(SAFE_TOP + h / 2 + EDGE, vh / 2);
    const maxCy = Math.max(minCy, vh - INPUT_GUARD - h / 2 - EDGE);
    return {
      cx: Math.max(minCx, Math.min(maxCx, cx)),
      cy: Math.max(minCy, Math.min(maxCy, cy)),
    };
  }, [geo]);

  // 比例第一次读出来 / 档位换了之后，把位置重新夹一次（尺寸变了可能越界）
  useEffect(() => { setCenter((c) => clampCenter(c.cx, c.cy)); }, [clampCenter]);

  // 位置存档（防抖，别拖一下写一次）
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { localStorage.setItem(POS_KEY, JSON.stringify(center)); } catch { /* 存不下就算了 */ }
    }, 350);
    return () => window.clearTimeout(t);
  }, [center]);

  /**
   * 屏幕尺寸变了（转屏、分屏、**软键盘弹起**）就重新夹一次位置。
   *
   * 安卓 WebView 弹键盘会触发 `resize`，可视高度一下少三四十个百分点。
   * 不重新夹的话浮窗会停在旧位置，正好压在被顶上来的输入框底下 ——
   * 而用户看不到「为什么突然挡着了」。
   *
   * ⚠️ 只改 `center`，**不碰 video 的 src/尺寸**。这里触发的是一次普通重渲染，
   * video 元素靠 `key={src}` 保持同一个节点，不会被重建（声音也就不断）。
   */
  useEffect(() => {
    let t = 0;
    const re = () => {
      window.clearTimeout(t);
      // 键盘弹起是连着来好几帧的，防抖一下再算
      t = window.setTimeout(() => setCenter((c) => clampCenter(c.cx, c.cy)), 120);
    };
    window.addEventListener('resize', re);
    window.addEventListener('orientationchange', re);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', re);
      window.removeEventListener('orientationchange', re);
    };
  }, [clampCenter]);

  useEffect(() => {
    try { localStorage.setItem(SIZE_KEY, size); } catch { /* 存不下就算了 */ }
  }, [size]);

  /**
   * 「接着看」：这一集第一次能播的时候，跳到上次看到的位置。
   * 只做一次（`resumedFor` 记住是给哪个 src 做的），用户自己拖过之后不再插手。
   */
  const resumedFor = useRef('');
  useEffect(() => {
    if (!src || !resumeAt || resumeAt < 5) return;
    if (resumedFor.current === src) return;
    const t = setTimeout(() => {
      const el = videoRef.current;
      if (!el) return;
      const target = Number.isFinite(resumeAt) ? resumeAt : 0;
      if (target <= 0) return;
      try {
        el.currentTime = target;
        d('接着上次的进度', { 跳到: target });
      } catch {
        d('跳不过去', { 想跳到: target });
      }
      resumedFor.current = src;
    }, 250);
    return () => clearTimeout(t);
  }, [src, resumeAt]);

  /** 元数据到了 = 真实比例知道了，更新并记住 */
  const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (durOk(v.duration)) setDur(v.duration);
    const r = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0;
    d('元数据到了', { 宽: v.videoWidth, 高: v.videoHeight, 比例: r ? Math.round(r * 100) / 100 : 0 });
    if (r > 0.1 && r < 10) {
      setRatio(r);
      saveRatio(title, r);
    }
  };

  // ── 工具条显隐（上下两条一起显一起藏）──────────────────
  const cancelHide = useCallback(() => {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setBarOn(false), 3000);
  }, [cancelHide]);
  const showBar = useCallback(() => { setBarOn(true); scheduleHide(); }, [scheduleHide]);
  /** 点画面：只管显隐。⚠️ 不再兼播放/暂停 —— 播放暂停固定走控制条按钮 */
  const toggleBar = useCallback(() => {
    if (barOn) { cancelHide(); setBarOn(false); }
    else showBar();
  }, [barOn, cancelHide, showBar]);
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  /**
   * 换到新的一集就自己开始播。
   *
   * 不用 autoPlay 属性、改成 src 到位后显式 play()：autoPlay 在安卓 WebView 里
   * 常被拦（带声音的自动播需要用户手势），被拦了就静默停住，用户完全不知道为什么。
   */
  useEffect(() => {
    if (!src) return;
    const v = videoRef.current;
    if (!v) return;
    d('src 到了，准备自动播', { src: String(src).slice(0, 32) });
    const t = setTimeout(() => {
      const el = videoRef.current;
      if (!el) return;
      el.play().catch((e: any) => {
        d('自动播被拦', { 原因: String(e?.message || e) });
        setPlaying(false);
      });
    }, 60);
    return () => clearTimeout(t);
  }, [src]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const seekTo = (clientX: number): number | null => {
    const el = barRef.current;
    if (!el || !durOk(dur)) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const t = pct * dur;
    return Number.isFinite(t) && t >= 0 ? t : null;
  };

  /** 时长未知（在线边下边播）就拖不了 —— 也不知道往哪儿拖 */
  const canSeek = durOk(dur);
  const shown = scrub !== null ? scrub : pos;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (shown / dur) * 100)) : 0;
  const small = size === 'small' && !full;

  // ── 长按拖动 ──────────────────────────────────────────
  /**
   * ⚠️ 点按 / 长按拖 / 显隐 三件事共用一根手指，判定必须写死在这一处。
   *
   *   按下        → 起一个 320ms 定时器
   *   320ms 到     → 进入「在拖」（并震动一下，告诉用户抓到了）
   *   提前挪动 >8px → 直接进「在拖」（不等满时间，更跟手）
   *   抬起        → 在拖 = 结束拖；不在拖 = 点按（只管显隐工具条）
   *
   * 拖动期间**取消隐藏计时** —— 否则会拖到一半工具条没了。
   */
  const press = useRef({ x: 0, y: 0, bx: 0, by: 0, id: -1, dragging: false });
  const lpTimer = useRef<number | null>(null);
  const startDrag = useCallback((e: React.PointerEvent) => {
    if (press.current.dragging) return;
    press.current.dragging = true;
    press.current.bx = center.cx;
    press.current.by = center.cy;
    cancelHide();
    setDragging(true);
    try { navigator.vibrate?.(12); } catch { /* 没这 API就算了 */ }
  }, [center.cx, center.cy, cancelHide]);

  const onPressStart = (e: React.PointerEvent) => {
    if (full) return;
    press.current = { x: e.clientX, y: e.clientY, bx: center.cx, by: center.cy, id: e.pointerId, dragging: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 抓不住就靠冒泡 */ }
    if (lpTimer.current) window.clearTimeout(lpTimer.current);
    lpTimer.current = window.setTimeout(() => startDrag(e), LONG_PRESS_MS);
  };

  const onPressMove = (e: React.PointerEvent) => {
    if (full || e.pointerId !== press.current.id) return;
    const dx = e.clientX - press.current.x;
    const dy = e.clientY - press.current.y;
    if (!press.current.dragging) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (lpTimer.current) { window.clearTimeout(lpTimer.current); lpTimer.current = null; }
      startDrag(e);
    }
    setCenter(clampCenter(press.current.bx + dx, press.current.by + dy));
  };

  const onPressEnd = (e: React.PointerEvent) => {
    if (lpTimer.current) { window.clearTimeout(lpTimer.current); lpTimer.current = null; }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
    if (press.current.dragging) {
      press.current.dragging = false;
      setDragging(false);
      scheduleHide();
      return;
    }
    if (!full) toggleBar();
  };

  /**
   * 播放区内部**只能有一个视频**，两条工具条永远压在它上面 ——
   * 所以这里写死三层，谁也别想盖住进度条（暮色 10-06：「所有的进度条都显示在最上面一层」）：
   *
   *   z-0   video            画面
   *   z-20  遮罩/出错卡片
   *   z-30  两条工具条
   *
   * 容器上那个 `isolation: isolate` 是**必须的**：它开出一个新的层叠上下文，
   * 播放区里面的 z 值就不再跟外面比。否则外面任何一个 `transform` / `filter` /
   * `backdrop-filter` 都能把整块播放区压到别的东西底下。
   *
   * ⚠️ Portal 之后这一层隔离依然要留着 —— 挂到 body 上了，但它现在会跟聊天区、
   * 输入框这些 z 值较低的兄弟比，没有隔离就会出 10-06 那个「进度条被挡住」的老问题。
   */
  const boxStyle: React.CSSProperties = full
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%', isolation: 'isolate' }
    : {
        position: 'fixed',
        left: center.cx - geo.w / 2,
        top: center.cy - geo.h / 2,
        width: geo.w,
        height: geo.h,
        isolation: 'isolate',
        // 拖动的时候不能有过渡，否则会「粘」在手指后面
        transition: dragging ? 'none' : 'left .18s ease, top .18s ease, width .18s ease, height .18s ease',
      };

  /**
   * 两条工具条的公共外观。
   *
   * ⚠️ padding 由**每个分支自己写**，不在这里写死 —— 之前这里带了 `pt-2 pb-8`，
   * 分支又要改成 `pt-1 pb-6`，两个 Tailwind 类谁后生效说不准（生成的 CSS 顺序
   * 不是按 className 字符串顺序来的），表现就是「小窗的条子边距莫名其妙」。
   * 两边都写完整，冲突就没了。
   *
   * 全屏时顶部那条要多让一截给状态栏（`pt-9`），不然按钮压在状态栏下面点不到。
   */
  const barCls = (side: 'top' | 'bottom', pad: string) =>
    `z-30 absolute inset-x-0 ${side === 'top' ? 'top-0 bg-gradient-to-b' : 'bottom-0 bg-gradient-to-t'} from-black/85 via-black/45 to-transparent transition-opacity duration-200 ${pad} ${
      barOn ? 'opacity-100' : 'opacity-0 pointer-events-none'
    }`;

  const body = (
    <div
      style={boxStyle}
      className={`z-[120] bg-black flex justify-center overflow-hidden select-none ${
        full ? '' : 'rounded-2xl shadow-2xl ring-1 ring-white/10'
      }`}
    >
      <video
        /**
         * `key={src}` —— **换片就重建这个元素**，这是「切剧时旧画面继续播」的解法。
         *
         * 换成 `key`：旧元素直接从 DOM 上摘掉（浏览器随即停掉它的取流和解码），
         * 新元素 `src={src || undefined}` 什么都不带，什么都不请求。干净。
         */
        key={src || '空'}
        ref={setVideoRef}
        src={src || undefined}
        playsInline
        // 麦麦 2026-10-05：**不能**加 crossOrigin。
        // 电脑上取的剧是浏览器本地的临时地址，跟页面同源，不加画布就是干净的，
        // 第 3 步取帧直接能读；一加反而会去要跨域头，而这个地址没有跨域头，视频直接播不了。
        //
        // object-contain：容器按比例算好了高度，比例不对也**只留黑边不裁画面**
        // （暮色 10-07：「全屏不要为了撑满屏幕裁掉画面，可以有黑边」）。
        className="relative z-0 w-full h-full bg-black object-contain"
        style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={onPressStart}
        onPointerMove={onPressMove}
        onPointerUp={onPressEnd}
        onPointerCancel={onPressEnd}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setPos(v.currentTime);
          if (durOk(v.duration)) setDur(v.duration);
          onTime(v.currentTime, durOk(v.duration) ? v.duration : 0);
        }}
        onLoadedMetadata={onMeta}
        onCanPlay={() => { d('可以播了', { readyState: videoRef.current?.readyState }); onMediaReady?.(); }}
        onPlaying={() => d('正在播放', { 播到: videoRef.current?.currentTime })}
        onWaiting={() => d('缓冲中')}
        onStalled={() => d('卡住了', { 已缓冲段: videoRef.current?.buffered.length })}
        onPlay={() => { d('开始播放'); setPlaying(true); setEnded(false); setBarOn(true); scheduleHide(); onMediaReady?.(); }}
        onPause={() => { d('暂停', { 播到: videoRef.current?.currentTime }); setPlaying(false); cancelHide(); setBarOn(true); }}
        onError={() => {
          const v = videoRef.current;
          d('视频报错', { 码: v?.error?.code, 说明: v?.error?.message, src: String(v?.src || '').slice(0, 40) });
          onMediaError?.();
        }}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          cancelHide();
          setBarOn(true);
          onTime(dur || pos, dur || pos);
          onEnded();
        }}
      />

      {/* 加载遮罩 / 出错卡片。小浮窗只有 190px 宽，所以这块刻意做得很紧凑，
          不然一张 px-7 py-5 的白卡能把整个小窗撑爆。 */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-2">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/92 px-3 py-2.5 shadow-xl max-w-[94%]">
            <div className="w-6 h-6 rounded-full border-[2.5px] border-slate-200 border-t-sky-300 animate-spin" />
            <div className="text-[10px] font-bold text-slate-700 text-center leading-snug">{loadHint || '正在从电脑取这一集'}</div>
            <div className="w-20 h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-sky-300 transition-all" style={{ width: `${Math.max(8, Math.round(loadProgress * 100))}%` }} />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-2">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-white/92 px-3 py-2.5 shadow-xl max-w-[94%]">
            <div className="text-[10px] font-bold text-slate-700 text-center leading-snug">{error}</div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={onRetry}
                className="rounded-full bg-sky-100 px-3 py-1 text-[10px] font-bold text-sky-700 active:scale-95 flex items-center gap-1"
              >
                <ArrowCounterClockwise size={11} weight="bold" />
                重试
              </button>
              {onClearAll && (
                <button
                  onClick={onClearAll}
                  className="rounded-full bg-rose-100 px-3 py-1 text-[10px] font-bold text-rose-600 active:scale-95 flex items-center gap-1"
                >
                  <Broom size={11} weight="bold" />
                  清空播放位
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 上面那条：**导航**（暮色 10-07 15:26）
          剧名 / 下一集 / 大小 / 选集。「选集放最右，大小挨着选集」——
          这俩都是「换个姿势看」，逻辑上是一组的。
          和下面那条一起显一起藏。 */}
      {!loading && !error && !small && (
        <div className={barCls('top', full ? 'pt-9 pb-8' : 'pt-2 pb-8')}>
          <div className="flex items-center gap-1.5 px-2 text-white">
            <span className="flex-1 min-w-0 truncate text-[10px] font-bold text-white/85 drop-shadow">
              {title ? `《${title}》` : ''} 第 {episode} 集
            </span>

            {hasNext && (
              <button
                onClick={onNext}
                className="shrink-0 flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold active:scale-90"
              >
                <SkipForward size={11} weight="fill" />
                下一集
              </button>
            )}
            {hasNext && small && (
              <button
                onClick={onNext}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white/20 active:scale-90"
                title="下一集"
              >
                <SkipForward size={11} weight="fill" />
              </button>
            )}
            {!hasNext && ended && (
              <span className="shrink-0 text-[10px] text-white/45">没有下一集了</span>
            )}

            <button
              onClick={() => setSize((cur) => NEXT_SIZE[cur])}
              className="shrink-0 flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold active:scale-90"
              title={`大小：${SIZE_LABEL[size]}（点切换 小/中/大）`}
            >
              <CornersIn size={11} weight="bold" />
              {SIZE_LABEL[size]}
            </button>

            {onOpenEpisodes && (
              <button
                onClick={onOpenEpisodes}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-white/20 active:scale-90"
                title="选集"
              >
                <FilmSlate size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 小窗：上面那条塞不下，压成一行极简（下一集 / 大小 / 选集）。 */}
      {!loading && !error && small && (
        <div className={`${barCls('top', 'px-1.5 pt-1 pb-6')} flex items-center gap-1 justify-end`}>
          {hasNext && (
            <button onClick={onNext} className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-white/20 active:scale-90" title="下一集">
              <SkipForward size={10} weight="fill" />
            </button>
          )}
          <button
            onClick={() => setSize((cur) => NEXT_SIZE[cur])}
            className="shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-bold active:scale-90"
            title={`大小：${SIZE_LABEL[size]}`}
          >
            {SIZE_LABEL[size]}
          </button>
          {onOpenEpisodes && (
            <button onClick={onOpenEpisodes} className="w-5 h-5 shrink-0 flex items-center justify-center rounded-full bg-white/20 active:scale-90" title="选集">
              <FilmSlate size={10} />
            </button>
          )}
        </div>
      )}

      {/* 下面那条：**播放**（暮色 10-05：下一集挪走了，这里只剩播放相关的）
          小窗只有 190px 宽，挤不下进度条和文字 —— 只留播放 / 音量 / 全屏。 */}
      {!loading && !error && (
        <div className={barCls('bottom', 'px-3 pt-10 pb-2')}>
          {!small && (
            <div
              ref={barRef}
              className={`h-6 flex items-center touch-none ${canSeek ? '' : 'pointer-events-none'}`}
              onPointerDown={(e) => {
                if (!canSeek) return;
                scrubbing.current = true;
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
                setScrub(seekTo(e.clientX));
              }}
              onPointerMove={(e) => {
                if (!scrubbing.current) return;
                setScrub(seekTo(e.clientX));
              }}
              onPointerUp={(e) => {
                if (!scrubbing.current) return;
                scrubbing.current = false;
                const t = seekTo(e.clientX);
                setScrub(null);
                const v = videoRef.current;
                if (v && t !== null && Number.isFinite(t) && t >= 0) {
                  try {
                    v.currentTime = t;
                    onSeek?.(t);
                  } catch {
                    d('定位失败', { 想跳到: t });
                  }
                }
              }}
              onPointerCancel={() => { scrubbing.current = false; setScrub(null); }}
            >
              <div className="relative h-1 w-full rounded-full bg-white/25">
                {canSeek && (
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/75" style={{ width: `${pct}%` }} />
                )}
                {canSeek && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow"
                    style={{ left: `${pct}%` }}
                  />
                )}
              </div>
            </div>
          )}

          <div className={`flex items-center gap-2 text-white ${small ? 'justify-center px-1 py-0.5' : ''}`}>
            <button onClick={toggle} className="shrink-0 w-7 h-7 flex items-center justify-center active:scale-90">
              {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
            </button>

            {!small && (
              <span className="shrink-0 text-[11px] tabular-nums text-white/85">
                {canSeek ? `${fmtTime(shown)} / ${fmtTime(dur)}` : `${fmtTime(shown)} / 边下边播`}
              </span>
            )}

            <div className="flex-1" />

            <button
              onClick={() => {
                const v = videoRef.current;
                const next = !muted;
                setMuted(next);
                if (v) v.muted = next;
              }}
              className="shrink-0 w-7 h-7 flex items-center justify-center active:scale-90"
              title={muted ? '取消静音' : '静音'}
            >
              {muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}
            </button>

            <button
              onClick={() => {
                const next = !full;
                setFull(next);
                cancelHide();
                setBarOn(true);
                if (!next) scheduleHide();
              }}
              className={`shrink-0 w-7 h-7 flex items-center justify-center active:scale-90 ${full ? 'text-sky-300' : ''}`}
              title={full ? '退出全屏' : '全屏'}
            >
              {full ? <CornersIn size={17} /> : <CornersOut size={17} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ⚠️ 必须 Portal 到 body —— 手机外壳那层有 overflow-hidden + transform，
  // fixed 元素在里面会被裁（AGENTS.md §6.2，Appearance 的全屏预览踩过同一个）。
  return createPortal(body, document.body);
};

export default PlayerStage;