/**
 * 聊天页面 Header 右侧「迷你音乐控制条」— 固定宽度黑色胶囊
 * 包含：上一曲 | 播放/暂停 | 下一曲
 * 不显示歌曲名、歌手名等文字
 * 驱动来自全局 MusicContext
 */
import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { useMusic } from '../../context/MusicContext';
import { AppID } from '../../types';

  const ChatMusicPlayer: React.FC = () => {
  const { openApp } = useOS();
  const { current, playing, togglePlay, prevSong, nextSong } = useMusic();
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseStartTimeRef = useRef<number | null>(null);
  const [elapsedPauseTime, setElapsedPauseTime] = useState(0);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HIDE_DELAY = 10 * 60 * 1000; // 10分钟，改成 1 * 60 * 1000 就是1分钟

useEffect(() => {
  if (!isPlaying) {
    // 暂停 → 启动计时
    hideTimerRef.current = setTimeout(() => {
      setVisible(false); // 你现有的隐藏状态变量名替换这里
    }, HIDE_DELAY);
  } else {
    // 播放 → 取消计时，确保显示
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setVisible(true);
  }
  return () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };
}, [isPlaying]);

    
  const handleLongPressStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      openApp(AppID.Music);
    }, 500);
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    prevSong();
  };

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePlay();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    nextSong();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openApp(AppID.Music);
  };

  return (
    <div
      className="w-[112px] h-10 rounded-full bg-black/75 backdrop-blur-xl shadow-md flex items-center justify-center gap-2 px-2 shrink-0 overflow-hidden cursor-pointer"
      onTouchStart={handleLongPressStart}
      onTouchEnd={handleLongPressEnd}
      onTouchCancel={handleLongPressEnd}
      onContextMenu={handleContextMenu}
      aria-label="音乐控制条"
      title="长按进入音乐页面"
    >
      {/* 上一曲按钮 */}
      <button
        onClick={handlePrevious}
        className="w-7 h-7 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
        aria-label="上一曲"
        title="上一曲"
      >
        <SkipBack size={16} weight="fill" />
      </button>

      {/* 中间封面按钮（播放/暂停） */}
      <button
        onClick={handlePlayPause}
        onMouseDown={handleLongPressStart}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-white/10 hover:bg-white/20 active:scale-95 transition-all shrink-0 relative"
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停' : '播放'}
      >
        {current.albumPic ? (
          <img src={current.albumPic} alt="cover" className="w-full h-full object-cover rounded-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-600 to-slate-800 text-white/70">
            ♪
          </div>
        )}
        {/* 播放/暂停图标叠加在封面中间 */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
          {playing ? <Pause size={14} weight="fill" className="text-white" /> : <Play size={14} weight="fill" className="text-white" />}
        </div>
      </button>

      {/* 下一曲按钮 */}
      <button
        onClick={handleNext}
        className="w-7 h-7 rounded-full flex items-center justify-center text-white/90 hover:bg-white/10 active:bg-white/20 transition-colors shrink-0"
        aria-label="下一曲"
        title="下一曲"
      >
        <SkipForward size={16} weight="fill" />
      </button>
    </div>
  );
};

export default ChatMusicPlayer;
