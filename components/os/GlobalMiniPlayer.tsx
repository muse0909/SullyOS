/**
 * 全局悬浮 Mini 播放器
 * 仅在 非 Music / 非 Launcher 应用里 显示，表示「后台正在放歌」。
 * Launcher 页让位给已有的 Dock，Music 页让位给页面内自带的 MiniPlayer。
 *
 * 暮色 2026-08-01 反馈：
 * - 默认折叠：只显示一个带封面的小圆球，点开才展开完整控制条；
 * - 折叠态 + 展开态 都能拖动（之前展开态固定在底部，会遮挡聊天页 input 框）；
 * - 隐藏走 userProfile.miniPlayerHidden（持久），不再用 sessionStorage；
 * - 切到新歌不再自动复活（用户主动取消隐藏才会显示）。
 *
 * 聊天页（Chat / GroupChat）也显示这个（之前排除 chat 让位给 ChatMusicPlayer，
 * 现在 ChatMusicPlayer 已删除）。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, CaretDown } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

const BUBBLE_SIZE = 40;             // 折叠态小圆球直径
const EXPANDED_W = 260;              // 展开态宽度
const EXPANDED_H = 60;               // 展开态高度
const EDGE_PAD = 8;
const STORAGE_KEY = 'globalMiniPlayer.bubblePos.v1';
const DRAG_THRESHOLD = 4;            // 像素：超过这个位移算拖动，不触发点击

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
  const { activeApp, userProfile, updateUserProfile, openApp } = useOS();
  const { current, playing, togglePlay, nextSong, prevSong, progress, duration } = useMusic();

  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState<Pos>(() => readPos());

  const hidden = !!userProfile.miniPlayerHidden;
  const setHidden = useCallback((v: boolean) => {
    updateUserProfile({ miniPlayerHidden: v });
  }, [updateUserProfile]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{
    startX: number; startY: number;
    offX: number; offY: number;
    parentW: number; parentH: number;
    moved: boolean;
    pointerId: number | null;
  } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // 持久化位置
  useEffect(() => {
    if (!pos) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch {}
  }, [pos]);

  // 拖动 pointer 事件 — 折叠态和展开态共用
  // 重要：展开态点 button 时不能初始化 dragState（否则松手触发 endDrag 把按钮"吃掉"），
  // 用 closest('button') 把展开态的整个 button 子树排除掉
  // 边界用 window.innerWidth/Height（不用 parent.getBoundingClientRect —— 后者在某些嵌套 absolute 容器里可能拿到非 viewport 尺寸）
  //
  // 暮色 2026-08-01 反馈：
  //   1) 折叠态（button 自己收 onPointerDown）卡死中间位置不能拖。
  //      根因：onPointerDown 绑在 button 上时，target.closest('button') 永远命中 button 自己 →
  //      永远 early return → dragState 永远不初始化。
  //      修：折叠态（!expanded）下整个 button 就是要拖动/点击的目标，无嵌套 button，
  //      跳过 closest 检查，直接 init dragState。
  //   2) 折叠态长按跳音乐 app 不行（`window.location.hash = '#music'` 在 React Router 下不稳）。
  //      改：短按封面 = openApp('music') 进音乐 app 播放页（替换之前的"短按展开"）；
  //      长按 = setExpanded(true) 展开（替换之前的"长按跳音乐 app"）；
  //      展开态进入后，展开态本身点空白仍是 openApp('music')，符合暮色预期。
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 展开态：排除 button 子树（按钮是给 onClick 处理的，不该被 dragState 吞掉）
    if (expanded && target.closest('button')) {
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      parentW: window.innerWidth,
      parentH: window.innerHeight,
      moved: false,
      pointerId: e.pointerId,
    };

    // 折叠态长按 = 展开（替换之前"长按跳音乐 app"的 hash 跳转，那个在 React Router 下不稳）
    if (!expanded) {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      longPressTimer.current = window.setTimeout(() => {
        if (dragState.current && !dragState.current.moved) {
          // 长按 = 展开
          try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch {}
          setExpanded(true);
          dragState.current = null;
        }
      }, 500);
    }

    try { (e.currentTarget as any).setPointerCapture?.(e.pointerId); } catch {}
  }, [expanded]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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

    // 用 viewport 坐标（不用 parent），更稳
    let x = e.clientX - ds.offX;
    let y = e.clientY - ds.offY;

    // 限制范围：折叠态用 BUBBLE_SIZE，展开态用 EXPANDED_W/H
    const w = expanded ? EXPANDED_W : BUBBLE_SIZE;
    const h = expanded ? EXPANDED_H : BUBBLE_SIZE;
    // 实时用 window 尺寸（ds.parentW 是按下时存的，可能不准确）
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    x = Math.max(EDGE_PAD, Math.min(vw - w - EDGE_PAD, x));
    y = Math.max(EDGE_PAD, Math.min(vh - h - EDGE_PAD, y));
    setPos({ x, y });
  }, [expanded]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (ds && !ds.moved) {
      // 没移动 = 点击
      if (!expanded) {
        // 折叠态：点击封面 = 进音乐 app 播放页（暮色 8-1 反馈要的行为）
        // 展开态：点击 button 子树已经在 onPointerDown early return，不会到这里；
        //        点击空白处（div 本体）= 进音乐 app 播放页（保持原行为）
        openApp(AppID.Music);
      } else {
        setExpanded(false);
      }
    }
    dragState.current = null;
    try { (e.currentTarget as any).releasePointerCapture?.(e.pointerId); } catch {}
  }, [expanded, openApp]);

  if (!current) return null;
  if (activeApp === AppID.Music) return null;
  if (activeApp === AppID.Launcher) return null; // Launcher 的 dock 够用了
  if (activeApp === AppID.Call) return null;     // 通话中不打扰
  if (hidden) return null;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  // 折叠态：小圆球（可拖动、单击展开、长按跳音乐 app）
  if (!expanded) {
    const positional: React.CSSProperties = pos
      ? { left: pos.x, top: pos.y }
      : { right: 12, bottom: 80 };  // 默认位置往上挪一点，避开 home indicator
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
          aria-label="音乐播放器（点击展开，拖动移位，长按跳音乐 app）"
          title="点击展开 · 拖动移位 · 长按跳音乐"
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

  // 展开态：可拖动、点空白处跳音乐 app
  const expPositional: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 12, bottom: 80 };

  return (
    <div
      ref={wrapRef}
      className="absolute z-[55] pointer-events-none"
      style={expPositional}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => e.preventDefault()}
        className="pointer-events-auto flex items-center gap-2.5 rounded-2xl px-2.5 py-2 relative overflow-hidden animate-fade-in touch-none select-none"
        style={{
          width: EXPANDED_W,
          height: EXPANDED_H,
          background: 'rgba(20, 24, 35, 0.65)',
          backdropFilter: 'blur(24px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.6)',
          border: '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          cursor: 'grab',
        }}
        aria-label="音乐播放器（点击跳音乐 app，拖动移位）"
        title="点击跳音乐 · 拖动移位"
      >
        {/* 封面 */}
        <img
          src={current.albumPic}
          alt=""
          className="w-9 h-9 rounded-lg object-cover shrink-0 pointer-events-none"
          style={{ border: '1px solid rgba(255,255,255,0.2)' }}
        />

        {/* 文字 */}
        <div className="flex-1 min-w-0 text-left pointer-events-none">
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
            aria-label="收起成小球"
            title="收起成小球"
          >
            <CaretDown size={14} weight="bold" />
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
