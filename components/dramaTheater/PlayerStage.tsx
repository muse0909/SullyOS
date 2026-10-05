/**
 * 剧场 · 播放器（自绘控制条）
 *
 * 为什么不用 <video controls>：
 *   暮色要「在音量图标旁边加一个下一集的按钮」。原生 controls 是安卓 WebView 自己画的，
 *   页面里没有任何 API 能往它内部插按钮。想放进去只能自己画一条。
 *   顺带那条视频下面多余的蓝色进度条也就一起没了（暮色 10-05 明确要删）。
 *
 * 顺带的好处：第 3 步要往画布上取视频帧喂给 live，自己画的条不影响取帧。
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Play, Pause, SpeakerHigh, SpeakerSlash, CornersOut, SkipForward, ArrowCounterClockwise,
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
  /** 剧名 —— 用来记这部剧的视频比例，好让加载页和播放页一样高 */
  title?: string;
  cinema: boolean;
  setCinema: (v: boolean) => void;
  onEnded: () => void;
  onTime: (position: number, duration: number) => void;
  loading: boolean;
  loadProgress: number;
  error: string;
  onRetry: () => void;
  hasNext: boolean;
  onNext: () => void;
  /** 拖完进度条 */
  onSeek?: (t: number) => void;
  /** 媒体本身放不出来（比如手机本地文件地址被内核拒了），交给外层换一条路 */
  onMediaError?: () => void;
  /** 真的播起来了（用来把「误报的 error」撤回去） */
  onMediaReady?: () => void;
  p: Palette;
};

/**
 * 每部剧的视频比例，存本地。
 *
 * 为什么记：横屏剧（16:9）和竖屏剧（9:16）自然高度差一倍多，而 `<video>`
 * 在元数据读出来之前**没有固有高度**（真正的原因不是 max-h，是这个）。
 * 不知道比例就没法在加载页把高度撑对，加载页和播放页必然不一样高 ——
 * 那正是暮色 10-05 说的「你看看图上两个高度差很多」。
 *
 * 同一部剧所有集比例是一样的，所以第一次播完记住之后，
 * 之后每次进播放页都能提前算准，加载页和播放页**一模一样高、零跳变**。
 */
const RATIO_KEY = 'theater_ratio';

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
    // 只留最近 30 部，别让这个 key 无限长
    const keys = Object.keys(map);
    if (keys.length > 30) {
      keys.slice(0, keys.length - 30).forEach((k) => delete map[k]);
    }
    localStorage.setItem(RATIO_KEY, JSON.stringify(map));
  } catch { /* 存不下就用默认值，不影响播放 */ }
}

const PlayerStage: React.FC<Props> = ({
  src, episode, title, cinema, setCinema, onEnded, onTime,
  loading, loadProgress, error, onRetry, hasNext, onNext, onSeek, onMediaError, onMediaReady, p,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [ratio, setRatio] = useState(() => readRatio(title));
  // 播的时候控制条藏起来，点一下画面再出来（暮色 10-05：「播放的时候进度条要隐藏」）
  const [barOn, setBarOn] = useState(true);
  const hideTimer = useRef<number | null>(null);

  // 换集就归零，不然上一集的进度会挂在新集上
  useEffect(() => {
    setPos(0);
    setDur(0);
    setScrub(null);
    setEnded(false);
    setBarOn(true);
  }, [src]);

  // 换剧就换回这部剧记着的比例
  useEffect(() => { setRatio(readRatio(title)); }, [title]);

  /** 元数据到了 = 真实比例知道了，更新并记住（以后加载页就能提前算对） */
  const onMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.duration) setDur(v.duration);
    const r = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0;
    if (r > 0.1 && r < 10) {
      setRatio(r);
      saveRatio(title, r);
    }
  };

  /** 播起来 3 秒后把控制条收掉 */
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setBarOn(false), 3000);
  };
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  /**
   * 换到新的一集就自己开始播。
   *
   * 之前这里只把进度归零、**一句让视频播起来的话都没有**，所以不管点「下一集」
   * 还是自动连播接到下一集，画面都停在 0:00，得再手点一下播放键
   * （暮色 10-05 真机反馈：「点下一集不会自动播放」）。
   *
   * 不用 autoPlay 属性、改成 src 到位后显式 play()：autoPlay 在安卓 WebView 里
   * 常被拦（带声音的自动播需要用户手势），被拦了就静默停住，用户完全不知道为什么。
   * 显式调 play() 的 promise 拒了也不慌 —— 播放按钮还在，用户点一下就行，
   * 不会像现在这样「点了下一集却像没反应」。
   */
  useEffect(() => {
    if (!src) return;
    const v = videoRef.current;
    if (!v) return;
    const t = setTimeout(() => {
      const el = videoRef.current;
      if (!el) return;
      el.play().catch(() => {
        // 拦下来了就让控制条显示成「没在播」，用户能看见、能点
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
    if (!el || !dur) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return null;
    const pct = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return pct * dur;
  };

  const shown = scrub !== null ? scrub : pos;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (shown / dur) * 100)) : 0;

  // 高度：知道比例就按比例算（宽度撑满 → 高度 = 宽/比例，再受 42vh/64vh 封顶），
  // 这样横屏剧不会被撑成 42vh 而上下留黑边，竖屏剧照旧顶到 42vh。
  // 不知道比例（第一次播这部剧）就先给 42vh 占位，元数据到了再修正。
  const maxH = cinema ? '64vh' : '42vh';
  const stageStyle: React.CSSProperties = ratio
    ? { aspectRatio: String(ratio), maxHeight: maxH, maxWidth: '100%', margin: '0 auto' }
    : { height: maxH };

  return (
    <div className="shrink-0 relative bg-black flex justify-center" style={stageStyle}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        // 麦麦 2026-10-05：**不能**加 crossOrigin。
        // 电脑上取的剧已经变成浏览器本地的临时地址，跟页面同源，不加画布就是干净的，
        // 第 3 步取帧直接能读；一加反而会去要跨域头，而这个地址没有跨域头，视频会直接播不了。
        //
        // object-contain 而不是 fill：容器已经按比例算好了高度，
        // 但比例是「记住的那一部剧的比例」，万一是别的比例也不能拉伸变形。
        className="w-full h-full bg-black object-contain"
        onClick={() => {
          if (!barOn) { setBarOn(true); scheduleHide(); return; }
          toggle();
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setPos(v.currentTime);
          if (v.duration) setDur(v.duration);
          onTime(v.currentTime, v.duration || 0);
        }}
        onLoadedMetadata={onMeta}
        onCanPlay={() => onMediaReady?.()}
        onPlay={() => { setPlaying(true); setEnded(false); setBarOn(true); scheduleHide(); onMediaReady?.(); }}
        onPause={() => { setPlaying(false); setBarOn(true); }}
        onError={() => onMediaError?.()}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
          setBarOn(true);
          onTime(dur || pos, dur || pos);
          onEnded();
        }}
      />

      {/* 从电脑取视频要下完才能播，几十兆大概一两秒，给个说法免得以为卡死。
          暮色 10-05 说原来那个「白字 + 一根细进度条」太难看 —— 黑底上一根 4px 的
          细线看着像坏掉的界面。换成浮在黑底上的一张浅色圆角卡片，跟项目里
          弹窗/浮层的观感一致。 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-white/92 px-7 py-5 shadow-xl">
            <div className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-sky-300 animate-spin" />
            <div className="text-[13px] font-bold text-slate-700">正在从电脑取这一集</div>
            <div className="w-28 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-sky-300 transition-all" style={{ width: `${Math.max(8, Math.round(loadProgress * 100))}%` }} />
            </div>
            <div className="text-[11px] text-slate-400 tabular-nums">{Math.round(loadProgress * 100)}%</div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center px-6">
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-white/92 px-7 py-5 shadow-xl max-w-[85%]">
            <div className="text-[13px] font-bold text-slate-700 text-center leading-relaxed">{error}</div>
            <button
              onClick={onRetry}
              className="rounded-full bg-sky-100 px-5 py-1.5 text-[12px] font-bold text-sky-700 active:scale-95 flex items-center gap-1.5"
            >
              <ArrowCounterClockwise size={13} weight="bold" />
              重试
            </button>
          </div>
        </div>
      )}

      {/* 控制条：暮色 10-05 —— 下一集放在音量左边
          切集正在取的时候整条不画：那会儿 blobUrl 里还是上一集，
          画出来会是「上一集的时间 + 这一集的集号」，自己骗自己。
          10-05 追加：正在播的时候整条藏起来（3 秒后），点画面才出来。 */}
      {!loading && (
      <div
        className={`absolute inset-x-0 bottom-0 px-3 pt-10 pb-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent transition-opacity duration-200 ${
          barOn ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 进度条：触摸区做高一点，手指粗也拖得动 */}
        <div
          ref={barRef}
          className="h-6 flex items-center touch-none"
          onPointerDown={(e) => {
            if (!dur) return;
            scrubbing.current = true;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
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
            if (t !== null && v) {
              v.currentTime = t;
              onSeek?.(t);
            }
          }}
          onPointerCancel={() => { scrubbing.current = false; setScrub(null); }}
        >
          <div className="relative h-1 w-full rounded-full bg-white/25">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/75" style={{ width: `${pct}%` }} />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow"
              style={{ left: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-white">
          <button onClick={toggle} className="shrink-0 w-7 h-7 flex items-center justify-center active:scale-90">
            {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
          </button>

          <span className="shrink-0 text-[11px] tabular-nums text-white/85">
            {fmtTime(shown)} / {fmtTime(dur)}
          </span>

          <span className="shrink-0 text-[10px] text-white/40">第 {episode} 集</span>

          <div className="flex-1" />

          {/* 下一集 —— 暮色要的位置：音量图标旁边 */}
          {hasNext && (
            <button
              onClick={onNext}
              className="shrink-0 flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold active:scale-90"
            >
              <SkipForward size={12} weight="fill" />
              下一集
            </button>
          )}
          {!hasNext && ended && (
            <span className="shrink-0 text-[10px] text-white/45">没有下一集了</span>
          )}

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
            onClick={() => setCinema(!cinema)}
            className={`shrink-0 w-7 h-7 flex items-center justify-center active:scale-90 ${cinema ? 'text-sky-300' : ''}`}
            title="影院模式"
          >
            <CornersOut size={17} />
          </button>
        </div>
      </div>
      )}
    </div>
  );
};

export default PlayerStage;
