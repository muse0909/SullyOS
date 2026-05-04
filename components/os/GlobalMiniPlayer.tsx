/**
 * 全局悬浮 Mini 播放器
 * 仅在 非 Music / 非 Launcher 应用里 显示，表示「后台正在放歌」。
 * Launcher 页让位给已有的 Dock，Music 页让位给页面内自带的 MiniPlayer。
 *
 * 默认折叠：只显示一个带封面的小圆球，点开才展开完整控制条；
 * 小球可拖动、可长按隐藏；切到新歌时会自动再出现。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, CaretDown, X } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

const BUBBLE_SIZE = 40;
const EDGE_PAD = 8;
const STORAGE_KEY = 'globalMiniPlayer.bubblePos.v1';
const HIDDEN_KEY = 'globalMiniPlayer.hidden.v1';
const DRAG_THRESHOLD = 4; // 像素：超过这个位移算拖动，不触发点击

type Pos = { x: number; y: number } | null;

const readPos = (): Pos => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
  } catch {}
  return null;
};

const GlobalMiniPlayer: React.FC = () => {
  const { activeApp } = useOS();
  const { current, playing, togglePlay, nextSong, prevSong, progress, duration } = useMusic();

  const [expanded, setExpanded] = useState(false); // 默认折叠
  const [pos, setPos] = useState<Pos>(() => readPos()); // null = 默认右下
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return sessionStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
  });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    startX: number; startY: number;
    offX: number; offY: number;
    parentW: number; parentH: number;
    moved: boolean;
    pointerId: number | null;
  } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // 只有用户真正"重新按下播放"（playing 从 false → true）才自动取消隐藏。
  // 仅靠 current.id 判断会让组件每次挂载（比如打开聊天 App）就把上一首歌"复活"显示出来——
  // 即使用户上次已经手动关掉了球、并且当下并没有在听歌。
  // ref 初始化为当前 playing 值：避免挂载瞬间被误判为 false→true 跳变。
  const prevPlayingRef = useRef(playing);
  useEffect(() => {
    if (playing && !prevPlayingRef.current) {
      setHidden(false);
      try { sessionStorage.removeItem(HIDDEN_KEY); } catch {}
    }
    prevPlayingRef.current = playing;
  }, [playing]);

  // 持久化位置
  useEffect(() => {
    if (!pos) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  const hide = useCallback(() => {
    setHidden(true);
    setExpanded(false);
    try { sessionStorage.setItem(HIDDEN_KEY, '1'); } catch {}
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const bubbleRect = el.getBoundingClientRect();

    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - bubbleRect.left,
      offY: e.clientY - bubbleRect.top,
      parentW: parentRect.width,
      parentH: parentRect.height,
      moved: false,
      pointerId: e.pointerId,
    };

    // 长按隐藏
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      if (dragState.current && !dragState.current.moved) {
        hide();
        dragState.current = null;
      }
    }, 600);

    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch {}
  }, [hide]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragState.current;
    const el = wrapRef.current;
    if (!ds || !el) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      ds.moved = true;
      if (longPressTimer.current) {
        window.clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
    if (!ds.moved) return;

    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    let x = e.clientX - parentRect.left - ds.offX;
    let y = e.clientY - parentRect.top - ds.offY;
    x = Math.max(EDGE_PAD, Math.min(ds.parentW - BUBBLE_SIZE - EDGE_PAD, x));
    y = Math.max(EDGE_PAD, Math.min(ds.parentH - BUBBLE_SIZE - EDGE_PAD, y));
    setPos({ x, y });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const ds = dragState.current;
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (ds && !ds.moved) {
      // 算作点击 → 展开
      setExpanded(true);
    }
    dragState.current = null;
    try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch {}
  }, []);

  if (!current) return null;
  if (activeApp === AppID.Music) return null;
  if (activeApp === AppID.Launcher) return null; // Launcher 的 dock 够用了
  if (activeApp === AppID.Call) return null;     // 通话中不打扰
  if (hidden) return null;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  // 折叠态：小圆球（可拖动、长按隐藏、单击展开）
  if (!expanded) {
    const positional: React.CSSProperties = pos
      ? { left: pos.x, top: pos.y }
      : { right: 12, bottom: 12 };
    return (
      <div
        ref={wrapRef}
        className="absolute z-[55] pointer-events-none"
        style={positional}
      >
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(e) => e.preventDefault()}
          className="pointer-events-auto relative w-10 h-10 rounded-full overflow-hidden active:scale-95 transition-transform touch-none select-none"
          style={{
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            border: '1px solid rgba(255,255,255,0.25)',
          }}
          aria-label="音乐播放器（点击展开，拖动移位，长按隐藏）"
          title="点击展开 · 拖动移位 · 长按隐藏"
        >
          <img
            src={current.albumPic}
            alt=""
            draggable={false}
            className="w-full h-full object-cover pointer-events-none"
          />
          {/* 播放/暂停小指示 */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(0,0,0,0.25)' }}
          >
            {playing
              ? <Pause size={14} weight="fill" color="#fff" />
              : <Play size={14} weight="fill" color="#fff" />}
          </div>
          {/* 进度细条 */}
          <div className="absolute left-0 bottom-0 w-full h-[2px] bg-white/20 pointer-events-none">
            <div
              className="h-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </button>
      </div>
    );
  }

  // 展开态：原来的完整 Mini 播放器
  // 刻意不给外层 wrapper 绑 onClick —— 在别的 App 里点它不应该跳到 Music App
  // （会把用户正在做的事情弄丢），只有里面的按钮生效。
  return (
    <div className="absolute left-3 right-3 bottom-3 z-[55] pointer-events-none">
      <div
        className="pointer-events-auto flex items-center gap-2.5 rounded-2xl px-2.5 py-2 relative overflow-hidden animate-fade-in"
        style={{
          background: 'rgba(20, 24, 35, 0.65)',
          backdropFilter: 'blur(24px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        }}
      >
        {/* 封面 */}
        <img
          src={current.albumPic}
          alt=""
          className="w-9 h-9 rounded-lg object-cover shrink-0"
          style={{ border: '1px solid rgba(255,255,255,0.2)' }}
        />

        {/* 文字 */}
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[11px] font-medium truncate text-white">{current.name}</div>
          <div className="text-[9px] truncate text-white/60">{current.artists}</div>
        </div>

        {/* 控制 */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); prevSong(); }}
            className="p-1.5 rounded-full text-white/80 active:scale-95 transition-transform"
          >
            <SkipBack size={14} weight="fill" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="p-1.5 rounded-full text-white active:scale-95 transition-transform"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); nextSong(); }}
            className="p-1.5 rounded-full text-white/80 active:scale-95 transition-transform"
          >
            <SkipForward size={14} weight="fill" />
          </button>
          {/* 折叠按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="p-1.5 rounded-full text-white/70 active:scale-95 transition-transform ml-0.5"
            aria-label="收起播放器"
            title="收起成小球"
          >
            <CaretDown size={14} weight="bold" />
          </button>
          {/* 隐藏按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); hide(); }}
            className="p-1.5 rounded-full text-white/70 active:scale-95 transition-transform"
            aria-label="隐藏播放器（切到下一首时会再出现）"
            title="隐藏（下一首会再出现）"
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        {/* 底部细进度条 */}
        <div className="absolute left-0 bottom-0 h-[2px] bg-gradient-to-r from-sky-400 to-indigo-400 transition-all duration-150"
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export default GlobalMiniPlayer;
