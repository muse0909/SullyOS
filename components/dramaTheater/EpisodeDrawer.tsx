/**
 * 剧场 · 选集抽屉（播放页右上角那个按钮拉出来的）
 *
 * 走 createPortal 挂到 body —— 不是为了好看，是必须的：
 * App.tsx:36 那层外壳有 style={{ transform: 'translateZ(0)' }}，
 * 页面里任何 fixed 的东西定位都会被这层 transform 吃掉
 * （项目里 Modal.tsx 开头注释记的就是这个坑，changelogs/2026-06-28-buff-popup-portal-fix.md）。
 *
 * 视觉上按暮色 10-05 定的胶囊 + 浅色马卡龙那套来，不跟 apps/theater 那个
 * 「彼方·剧院」混 —— 那是另一个模块，跟短剧剧场没关系。
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { X, DeviceMobile, HardDrive, CloudSlash, CloudArrowDown, GearSix, Trash, Play } from '@phosphor-icons/react';
import type { Palette } from '../../utils/dramaTheater/theme';

export type EpState = 'phone' | 'mac' | 'none';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  total: number;
  current: number;
  stateOf: (n: number) => EpState;
  /** 这部剧能不能在线播（电脑上没下、靠电脑边下边播）。
   *  原来只认「手机里有 / 电脑里有」两种，在线剧的集就被判成「没有」直接禁用，
   *  点下去一点反应都没有（用户 10-06 实测：选集页点在线剧的任何一集都点不动）。 */
  canPlayOnline: boolean;
  /** 明明能在线播却判成不能的原因，直接写在图例那一行。
   *  「点不动」最耗时间的就是「不知道为什么点不动」——这一行就是答案。 */
  onlineBlockedReason?: string;
  onPick: (n: number) => void;
  onDeletePhone: (n: number) => void;
  onOpenSettings: () => void;
  p: Palette;
  savingAll: boolean;
};

const EpisodeDrawer: React.FC<Props> = ({
  open, onClose, title, total, current, stateOf, canPlayOnline, onlineBlockedReason, onPick, onDeletePhone, onOpenSettings, p, savingAll,
}) => {
  if (!open) return null;

  const body = (
    <div className="fixed inset-0 z-[130]" style={{ zIndex: 130 }}>
      <div className={`absolute inset-0 ${p.scrim}`} onClick={onClose} />
      <div
        className={`absolute inset-y-0 right-0 w-[80%] max-w-[19rem] flex flex-col ${p.card} shadow-2xl`}
        style={{ borderTopLeftRadius: '2rem', borderBottomLeftRadius: '2rem' }}
      >
        {/* 头 */}
        <div className={`shrink-0 px-4 pt-5 pb-3 flex items-start gap-2 ${p.line} border-b`}>
          <div className="flex-1 min-w-0">
            <h2 className={`text-sm font-bold truncate ${p.title}`}>{title}</h2>
            <p className={`mt-0.5 text-[10px] ${p.sub}`}>
              共 {total} 集 · 正在看第 {current} 集
            </p>
          </div>
          <button
            onClick={onClose}
            className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90 ${p.chipOn}`}
          >
            <X size={15} weight="bold" />
          </button>
        </div>

        {/* 图例：哪一集到底在哪 */}
        <div className={`shrink-0 px-4 py-2.5 flex items-center gap-3 text-[10px] ${p.sub} ${p.line} border-b`}>
          <span className="flex items-center gap-1"><DeviceMobile size={11} className="text-emerald-500" />手机里</span>
          <span className="flex items-center gap-1"><HardDrive size={11} className="text-sky-500" />电脑里</span>
          {canPlayOnline && (
            <span className="flex items-center gap-1">
              <CloudArrowDown size={11} className="text-violet-400" />在线看
            </span>
          )}
          {!canPlayOnline && (
            <span className="flex items-center gap-1">
              <CloudSlash size={11} className={p.faint} />{onlineBlockedReason || '都没有'}
            </span>
          )}
        </div>

        {/* 集数 */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-4">
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: Math.max(total, 1) }, (_, i) => i + 1).map((n) => {
              const st = stateOf(n);
              const cur = n === current;
              // 「能不能点」不等于「文件在不在」：电脑上没这集不代表不能看，
              // 在线路径能播（用户 10-06 反馈：这里原来是灰的、点不动）。
              const play = st !== 'none' || canPlayOnline;
              return (
                <div key={n} className="relative">
                  <button
                    onClick={() => play && onPick(n)}
                    disabled={!play}
                    className={`w-full aspect-square rounded-xl text-xs font-bold transition active:scale-95 ${
                      st === 'phone'
                        ? 'bg-emerald-50 text-emerald-600'
                        : st === 'mac'
                        ? 'bg-sky-50 text-sky-600'
                        // 文件不在但能在线播：不能还用那个灰 —— 看着像点不动
                        : canPlayOnline
                        ? 'bg-violet-50 text-violet-500'
                        : p.night
                        ? 'bg-[#1e293b] text-slate-600'
                        : 'bg-slate-100 text-slate-300'
                    }`}
                  >
                    {n}
                  </button>
                  {/* 正在播的这一集：右上角一个小播放键。
                      原来是把整格刷成蓝色高亮，结果「这一集在不在手机里」这个
                      信息被盖住了，跟上面的图例对不上（暮色 10-05 提的）。 */}
                  {cur && (
                    <span
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center pointer-events-none"
                      title="正在播这一集"
                    >
                      <Play size={10} weight="fill" className="text-white" />
                    </span>
                  )}
                  {/* 手机里存着的，右上角给个能删的小角标 */}
                  {st === 'phone' && !cur && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeletePhone(n); }}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center active:scale-90"
                      title="从手机里删掉这一集"
                    >
                      <Trash size={10} className="text-rose-400" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {total === 0 && (
            <p className={`text-[11px] text-center py-8 ${p.sub}`}>还问不出总集数</p>
          )}
          {savingAll && (
            <p className="mt-3 text-[10px] text-center text-sky-500">正在往手机里存…</p>
          )}
        </div>

        {/* 底：去剧场设置 */}
        <div className={`shrink-0 px-4 py-3 ${p.line} border-t`}>
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center justify-center gap-1.5 rounded-full bg-slate-100 py-2.5 text-[11px] font-bold text-slate-500 active:scale-95"
          >
            <GearSix size={13} />
            剧场设置
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
};

export default EpisodeDrawer;
