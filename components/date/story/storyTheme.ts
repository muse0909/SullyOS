/**
 * 剧情模式 / 见面选角 — 淡紫主题共享常量
 *
 * 暮色 8-25:从原版搬过来,DateApp 选角页 + StoryTheater 列表页都用这套色系。
 *   复用避免在两个文件里各写一份导致漂移。
 */

export const SELECT_THEME = {
    pageBg: 'linear-gradient(180deg,#efe9f7 0%,#f4eff9 45%,#f7f2fb 100%)',
    stars: 'radial-gradient(1.5px 1.5px at 14% 16%,rgba(190,160,225,.45),transparent),radial-gradient(1px 1px at 80% 12%,rgba(220,190,235,.5),transparent),radial-gradient(1.5px 1.5px at 42% 28%,rgba(180,200,240,.4),transparent),radial-gradient(1px 1px at 86% 42%,rgba(200,175,230,.4),transparent),radial-gradient(1px 1px at 22% 66%,rgba(210,185,235,.35),transparent),radial-gradient(1px 1px at 66% 80%,rgba(200,210,240,.35),transparent)',
    title: '#6a5790',
    titleShadow: 'rgba(170,150,220,.4)',
    line: 'rgba(150,120,190,.5)',
    cardBorder: 'rgba(170,140,210,.3)',
    cardShadow: '0 8px 22px rgba(150,120,200,.18)',
    inner: 'rgba(170,140,210,.22)',
    gem: 'rgba(190,160,220,.85)',
};

/** 6 色柔色底(原版 line 726-731,按序循环) */
export const CARD_TINTS: readonly string[] = [
    'linear-gradient(180deg,rgba(250,212,228,.85),rgba(242,228,246,.8))',
    'linear-gradient(180deg,rgba(232,228,248,.85),rgba(242,238,250,.8))',
    'linear-gradient(180deg,rgba(226,216,246,.85),rgba(238,230,249,.8))',
    'linear-gradient(180deg,rgba(212,230,247,.85),rgba(234,240,250,.8))',
    'linear-gradient(180deg,rgba(226,212,245,.85),rgba(238,228,249,.8))',
    'linear-gradient(180deg,rgba(234,231,242,.88),rgba(242,240,247,.82))',
];
