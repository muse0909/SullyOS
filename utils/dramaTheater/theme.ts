/**
 * 剧场 · 夜间模式
 *
 * 范围只做剧场内部（暮色 10-05 只提了剧场）。
 * 项目里其实没有全局夜间模式 —— types.ts 有个 theme.darkMode 字段，
 * 但除了 ThemeMaker 的预览没人读它，所以不存在「顺手跟着全局走」这条路。
 * 硬接一个全局开关会牵动 30+ 个 app，超出这次范围。
 *
 * 三个档：跟随系统 / 白天 / 夜间。默认跟随系统。
 */

import { useEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';
const KEY = 'theater_theme';

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setThemeMode(m: ThemeMode) {
  try {
    localStorage.setItem(KEY, m);
  } catch {}
}

function systemDark(): boolean {
  try {
    return !!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  } catch {
    return false;
  }
}

export function useTheaterTheme(): { mode: ThemeMode; night: boolean; setMode: (m: ThemeMode) => void } {
  const [mode, setModeState] = useState<ThemeMode>(getThemeMode);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
    } catch {}
    if (!mq) return;
    const on = () => setSysDark(mq!.matches);
    on();
    // 老版 WebView 只支持 addListener，新版只支持 addEventListener，两个都挂一遍。
    // 走 any 断言是因为 TS 的 MediaQueryList 类型里 removeEventListener 是必有的，
    // 直接判会报 TS2774（老 WebView 上其实是 undefined）。
    const legacy = mq as any;
    if (legacy.addEventListener) legacy.addEventListener('change', on);
    else if (legacy.addListener) legacy.addListener(on);
    return () => {
      if (legacy.removeEventListener) legacy.removeEventListener('change', on);
      else if (legacy.removeListener) legacy.removeListener(on);
    };
  }, []);

  const setMode = (m: ThemeMode) => {
    setThemeMode(m);
    setModeState(m);
  };

  return { mode, night: mode === 'dark' || (mode === 'auto' && sysDark), setMode };
}

/**
 * 一套颜色，页面里所有地方都从这里取。
 * 这样加夜间模式不用把每个元素写两遍 —— 只换皮，不改结构。
 */
export type Palette = {
  night: boolean;
  page: string;
  bar: string;
  card: string;
  title: string;
  sub: string;
  faint: string;
  line: string;
  input: string;
  chip: string;
  chipOn: string;
  scrim: string;
};

export function palette(night: boolean): Palette {
  if (night) {
    return {
      night,
      page: 'bg-[#0f172a]',
      bar: 'bg-[#0f172a]/90 border-white/5',
      card: 'bg-[#1e293b]',
      title: 'text-slate-100',
      sub: 'text-slate-400',
      faint: 'text-slate-500',
      line: 'border-white/5',
      input: 'bg-[#1e293b] border-white/5 text-slate-200 placeholder:text-slate-500',
      chip: 'text-slate-500',
      chipOn: 'bg-[#334155] text-slate-100',
      scrim: 'bg-black/60',
    };
  }
  return {
    night,
    page: 'bg-gradient-to-b from-sky-50 via-white to-white',
    bar: 'bg-white/80 border-white/40',
    card: 'bg-white shadow-sm',
    title: 'text-slate-800',
    sub: 'text-slate-400',
    faint: 'text-slate-300',
    line: 'border-slate-100',
    input: 'bg-slate-50 border-slate-100 text-slate-700 placeholder:text-slate-400',
    chip: 'text-slate-400',
    chipOn: 'bg-white text-sky-600 shadow-sm',
    scrim: 'bg-black/40',
  };
}
