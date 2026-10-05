/**
 * 剧场 · 主页面
 *
 * 第 1 步只做三件套 + 播放器，不接 AI。
 * 形态照暮色定的原型：上面播放器，下面聊天框（聊天第 2 步才填）。
 *
 * 页面四个：
 *   列表（3 列海报网格，三个页签）→ 选集 → 播放 → 设置
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { ArrowLeft, GearSix, MagnifyingGlass, Play, DownloadSimple, FilmSlate, X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  getRelayAddr, setRelayAddr, normalizeAddr, pingRelay, forgetRelay, getKnownRelays,
  fetchDramas, fetchTasks, searchDramas, queueDownload, fetchEpisodes, localVideoUrl,
  RelayDrama, RelayTask,
} from '../utils/dramaTheater/relayClient';
import { saveUploadedVideo, listUploadedVideos, deleteUploadedVideo, UploadedVideo } from '../utils/dramaTheater/localVideos';

// ── 小零件 ──

const Tag: React.FC<{ tone: 'ok' | 'no' | 'new'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls = tone === 'ok' ? 'bg-emerald-50 text-emerald-600' : tone === 'new' ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-400';
  return <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${cls}`}>{children}</span>;
};

const Pill: React.FC<{ primary?: boolean; onClick?: () => void; disabled?: boolean; children: React.ReactNode }> = ({
  primary, onClick, disabled, children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`rounded-full px-5 py-2.5 text-xs font-bold transition active:scale-95 disabled:opacity-40 ${
      primary ? 'bg-sky-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
    }`}
  >
    {children}
  </button>
);

type Page = 'list' | 'episodes' | 'player' | 'settings';

// ═══════════════════════════════════════════════════

const TheaterApp: React.FC = () => {
  const { activeCharacterId, characters, addToast } = useOS();
  const char = useMemo(
    () => characters.find((c: any) => c.id === activeCharacterId),
    [characters, activeCharacterId]
  );

  const [page, setPage] = useState<Page>('list');
  const [tab, setTab] = useState<'downloaded' | 'searched' | 'mine'>('downloaded');

  // ── 转发服务连接 ──
  const [addr, setAddr] = useState(getRelayAddr());
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connError, setConnError] = useState('');
  const [known, setKnown] = useState(getKnownRelays());

  // ── 数据 ──
  const [dramas, setDramas] = useState<RelayDrama[]>([]);
  const [tasks, setTasks] = useState<RelayTask[]>([]);
  const [uploads, setUploads] = useState<UploadedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RelayDrama[]>([]);

  // ── 选中的剧 / 集 ──
  const [picked, setPicked] = useState<RelayDrama | null>(null);
  const [epTotal, setEpTotal] = useState(0);
  const [currentEp, setCurrentEp] = useState(1);
  const [saving, setSaving] = useState(false);

  // ── 播放器 ──
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [uploadPlay, setUploadPlay] = useState<UploadedVideo | null>(null);

  // 已下载的集：按剧名分桶，短剧库的目录名就是剧名
  const downloadedByDrama = useMemo(() => {
    const map = new Map<string, number[]>();
    tasks.forEach((t) => {
      if (!t.playable || !t.dramaTitle) return;
      const arr = map.get(t.dramaTitle) || [];
      arr.push(t.episode);
      map.set(t.dramaTitle, arr);
    });
    map.forEach((v) => v.sort((a, b) => a - b));
    return map;
  }, [tasks]);

  // ── 探活 + 拉数据 ──
  const refresh = useCallback(async () => {
    setChecking(true);
    setConnError('');
    const info = await pingRelay(addr);
    setOnline(info.online);
    setChecking(false);
    setKnown(getKnownRelays());

    // 填了地址但连不上 —— 得说清楚是哪一类，不然用户只能对着「没连上」干瞪眼。
    if (addr.trim() && !info.online) {
      setConnError(
        info.reached === false
          ? '连不上电脑。先确认手机和电脑连的是同一个 WiFi，' +
            '再确认电脑上「短剧库」和「剧场转发」两个窗口都开着。'
          : '连上了电脑，但短剧库没响应 —— 电脑上「短剧库」那个窗口可能没开。'
      );
    }

    setUploads(await listUploadedVideos());
    if (!info.online) {
      setLoadError('');
      setDramas([]);
      setTasks([]);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const [ds, ts] = await Promise.all([fetchDramas(addr), fetchTasks(addr)]);
      setDramas(ds);
      setTasks(ts.filter((t) => t.playable));
    } catch (e: any) {
      setLoadError(e?.message || '拉数据失败');
    } finally {
      setLoading(false);
    }
  }, [addr]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAddr = async (input: string) => {
    const clean = normalizeAddr(input);
    setAddr(clean);
    setRelayAddr(clean);
    await refresh();
  };

  // ── 搜索 ──
  const doSearch = async () => {
    const q = query.trim();
    if (!q || !online) return;
    setSearching(true);
    setTab('searched');
    try {
      setSearchResults(await searchDramas(addr, q));
    } catch (e: any) {
      addToast(e?.message || '搜不到', 'error');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ── 选集 ──
  // 集数不采信剧库的 episodeCount —— 实测那个字段的值是 '1'，是假数据。
  // 只信两个来源：短剧库已下载的集数，和 playback/open 返回的 episodes 真实长度。
  const openEpisodes = async (d: RelayDrama) => {
    setPicked(d);
    const localEps = downloadedByDrama.get(d.title) || [];
    setEpTotal(localEps[localEps.length - 1] || 0);
    setCurrentEp(localEps[0] || 1);
    setPage('episodes');

    try {
      const r = await fetchEpisodes(addr, d.id);
      if (r.total) setEpTotal(r.total);
    } catch {
      // 问不到就先用本地已有的，最差也就只显示存过的那几集
    }
  };

  // ── 存到手机 ──
  const saveToPhone = async () => {
    if (!picked || !online) return;
    setSaving(true);
    try {
      await queueDownload(addr, [picked.id]);
      addToast('已经排上队了，下载完会出现在「已下载」里', 'success');
    } catch (e: any) {
      addToast(e?.message || '排队失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 播放 ──
  const playEpisode = (ep: number) => {
    if (!picked) return;
    setUploadPlay(null);
    setCurrentEp(ep);
    setPage('player');
    setPlaying(false);
    setProgress(0);
  };

  const playUpload = (v: UploadedVideo) => {
    setUploadPlay(v);
    setPicked(null);
    setPage('player');
    setPlaying(false);
    setProgress(0);
  };

  // 播放器地址：上传的走本地文件，其余走转发服务
  const videoSrc = useMemo(() => {
    if (uploadPlay) return uploadPlay.uri;
    if (!picked || !addr) return '';
    return localVideoUrl(addr, picked.title, currentEp);
  }, [uploadPlay, picked, addr, currentEp]);

  // ── 列表数据（三个页签共用）──
  const listItems = useMemo(() => {
    if (tab === 'mine') {
      return uploads.map((v) => ({
        key: v.id,
        title: v.name,
        cover: v.poster,
        sub: `${v.episodeCount} 集 · 上传的`,
        badge: { tone: 'ok' as const, text: '已存' },
        onClick: () => playUpload(v),
      }));
    }
    const source = tab === 'searched' ? searchResults : dramas;
    // 「已下载」只留本地真有集的剧
    const filtered = tab === 'downloaded'
      ? source.filter((d) => (downloadedByDrama.get(d.title)?.length || 0) > 0)
      : source;
    return filtered.map((d) => {
      const eps = downloadedByDrama.get(d.title)?.length || 0;
      return {
        key: d.id,
        title: d.title,
        cover: d.coverUrl,
        // 列表不显示总集数（剧库那个字段是假数据），只说本地存了几集
        sub: eps ? `已存 ${eps} 集` : '没存',
        badge: eps ? { tone: 'ok' as const, text: `已存 ${eps}集` } : { tone: 'no' as const, text: '未存' },
        onClick: () => openEpisodes(d),
      };
    });
  }, [tab, uploads, dramas, searchResults, downloadedByDrama]);

  const fmtTime = (s: number) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // ═══════════════ 渲染 ═══════════════

  // 顶栏
  const TopBar: React.FC<{ title: string; onBack?: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
    <div className="shrink-0 flex items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur-xl border-b border-white/40">
      {onBack
        ? <button onClick={onBack} className="shrink-0 w-9 h-9 rounded-full bg-white/70 flex items-center justify-center active:scale-95">
            <ArrowLeft size={18} weight="bold" className="text-slate-600" />
          </button>
        : <div className="shrink-0 w-9" />}
      <h1 className="flex-1 text-center text-base font-bold text-slate-800 truncate">{title}</h1>
      {right || <div className="shrink-0 w-9" />}
    </div>
  );

  // ═══════════ 页面 1：列表 ═══════════
  if (page === 'list') {
    return (
      <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-sky-50 via-white to-white">
        <TopBar title="剧场" right={
          <button onClick={() => setPage('settings')} className="shrink-0 w-9 h-9 rounded-full bg-white/70 flex items-center justify-center active:scale-95">
            <GearSix size={18} className="text-slate-500" />
          </button>
        } />

        {/* 没连上电脑：先给个能扫的地址，不然用户干瞪眼 */}
        {!online && (
          <div className="mx-4 mt-3 rounded-3xl bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 text-center">先连上电脑</h3>
            <p className="text-[11px] text-slate-400 text-center mt-1.5 leading-relaxed">
              在电脑上打开短剧库和「剧场转发」，<br />然后把地址填在下面
            </p>
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="192.168.x.x:8999"
              className="mt-3 w-full rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-center text-slate-700 outline-none"
            />
            <div className="mt-3 flex justify-center">
              <Pill primary onClick={() => saveAddr(addr)} disabled={!addr.trim() || checking}>
                {checking ? '正在试…' : '连一下'}
              </Pill>
            </div>
            {connError && <p className="mt-3 text-[11px] text-amber-600 leading-relaxed text-center">{connError}</p>}
          </div>
        )}

        {/* 搜索 */}
        <div className="px-4 mt-3 shrink-0">
          <div className="flex items-center gap-2 rounded-full bg-slate-100/80 px-4 py-2.5">
            <MagnifyingGlass size={16} className="text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="搜片源、找剧名"
              className="flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
            {query && <button onClick={doSearch} disabled={!online || searching} className="shrink-0">
              <Pill primary>{searching ? '搜着…' : '搜'}</Pill>
            </button>}
          </div>
        </div>

        {/* 三个页签 */}
        <div className="px-4 mt-3 shrink-0 flex gap-1 rounded-full bg-slate-100/80 p-1">
          {([['downloaded', '已下载'], ['searched', '搜到的'], ['mine', '我的上传']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-2 rounded-full text-xs font-bold transition ${
                tab === k ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {online && loading && <div className="text-center text-xs text-slate-400 py-10">正在读剧库…</div>}
          {online && !loading && loadError && (
            <div className="text-center text-xs text-slate-400 py-10">{loadError}</div>
          )}
          {online && !loading && !loadError && listItems.length === 0 && (
            <div className="text-center text-xs text-slate-400 py-10">
              {tab === 'searched' ? '搜点什么试试' : tab === 'mine' ? '还没传过视频' : '短剧库里还没有下载好的剧'}
            </div>
          )}

          {/* 暮色 10-05 定：固定 3 列，不给切换 */}
          <div className="grid grid-cols-3 gap-2.5">
            {listItems.map((it) => (
              <div key={it.key} onClick={it.onClick} className="cursor-pointer min-w-0 active:scale-95 transition-transform">
                <div className="relative w-full aspect-[3/4] rounded-xl bg-slate-200 overflow-hidden">
                  {it.cover ? (
                    <img src={it.cover} className="w-full h-full object-cover pointer-events-none" alt={it.title} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <FilmSlate size={26} />
                    </div>
                  )}
                  <div className="absolute top-1.5 left-1.5">
                    <Tag tone={it.badge.tone}>{it.badge.text}</Tag>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100">
                    <div className="w-7 h-7 rounded-full bg-black/40 flex items-center justify-center">
                      <Play size={12} weight="fill" className="text-white" />
                    </div>
                  </div>
                </div>
                <h3 className="mt-1.5 text-[11px] font-bold text-slate-700 truncate">{it.title}</h3>
                <p className="text-[9.5px] text-slate-400 truncate">{it.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ 页面 2：选集 ═══════════
  if (page === 'episodes' && picked) {
    const localEps = downloadedByDrama.get(picked.title) || [];
    return (
      <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-sky-50 via-white to-white">
        <TopBar title={picked.title} onBack={() => setPage('list')} />

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {/* 头部：封面 + 存到手机（暮色定的重点）*/}
          <div className="flex gap-3">
            <div className="w-20 h-27 rounded-2xl overflow-hidden bg-slate-200 shrink-0" style={{ height: '6.7rem' }}>
              {picked.coverUrl && <img src={picked.coverUrl} className="w-full h-full object-cover" alt="" />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-slate-800 leading-snug">{picked.title}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Tag tone={localEps.length ? 'ok' : 'no'}>{localEps.length ? `已存 ${localEps.length} 集` : '没存'}</Tag>
                {epTotal > 0 && <Tag tone="new">共 {epTotal} 集</Tag>}
              </div>
              <div className="mt-2.5 flex gap-2">
                <Pill primary onClick={saveToPhone} disabled={!online || saving}>
                  {saving ? '排队中…' : '存到手机'}
                </Pill>
                {localEps.length > 0 && epTotal > localEps.length && (
                  <Pill disabled>没存的 {epTotal - localEps.length} 集</Pill>
                )}
              </div>
            </div>
          </div>

          {/* 集数网格：暮色定：选集页不显示简介 */}
          <div className="mt-5 text-xs font-bold text-slate-500">点集数直接看</div>
          <div className="mt-2.5 grid grid-cols-5 gap-2">
            {Array.from({ length: Math.max(epTotal, localEps[localEps.length - 1] || 0) }, (_, i) => i + 1).map((n) => {
              const has = localEps.includes(n);
              return (
                <button
                  key={n}
                  onClick={() => has && playEpisode(n)}
                  disabled={!has}
                  className={`aspect-square rounded-xl text-xs font-bold transition active:scale-95 ${
                    has
                      ? n === currentEp
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'bg-emerald-50 text-emerald-600'
                      : 'bg-slate-100 text-slate-300'
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>

          {localEps.length > 0 && (
            <div className="mt-5 text-xs font-bold text-slate-500">存到手机的，断网也能看</div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════ 页面 3：播放 ═══════════
  if (page === 'player') {
    const title = uploadPlay ? uploadPlay.name : `${picked?.title || ''}`;
    return (
      <div className="absolute inset-0 flex flex-col bg-white">
        <TopBar title={title} onBack={() => setPage(uploadPlay ? 'list' : 'episodes')} />

        {/* 播放器 */}
        <div className="shrink-0 bg-black">
          <video
            ref={videoRef}
            src={videoSrc}
            controls
            playsInline
            // 麦麦 2026-10-05：必须写 crossOrigin。
            // 不写的话这个 video 是「不带 CORS 的跨源加载」，第 3 步把它画到 canvas 上会被污染，
            // getImageData 直接抛 SecurityError，角色就永远看不到画面。
            // 写成 anonymous 后走 CORS 加载，画布不脏 —— 转发服务那边已经带了 Allow-Origin 头。
            crossOrigin="anonymous"
            className="w-full max-h-[42vh] bg-black"
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setProgress(v.currentTime);
              if (v.duration) setDuration(v.duration);
            }}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </div>

        {/* 进度条（视频原生 controls 之外的补充信息，第 4 步摘要条挂在这下面）*/}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 text-[10px] text-slate-400">
          <span>{fmtTime(progress)}</span>
          <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-sky-400 rounded-full" style={{ width: duration ? `${(progress / duration) * 100}%` : '0%' }} />
          </div>
          <span>{fmtTime(duration)}</span>
        </div>

        {/* 聊天区：第 2 步接 live，这一步先留个位 */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3">
          <div className="h-full flex flex-col items-center justify-center text-center">
            <FilmSlate size={30} className="text-slate-200" />
            <p className="mt-2 text-[11px] text-slate-300">
              {char ? `这里会放跟${char.name}聊天的框` : '这里会放聊天的框'}
            </p>
            <p className="mt-1 text-[10px] text-slate-300">第 2 步才接上</p>
          </div>
        </div>

        {/* 输入框（第 2 步才通）*/}
        <div className="shrink-0 px-4 py-3 border-t border-slate-100">
          <div className="flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5">
            <input
              disabled
              placeholder="说点什么…"
              className="flex-1 bg-transparent text-sm text-slate-400 outline-none"
            />
          </div>
        </div>
      </div>
    );
  }

  // ═══════════ 页面 4：设置 ═══════════
  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-b from-sky-50 via-white to-white">
      <TopBar title="剧场设置" onBack={() => setPage('list')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3">
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700">连你的电脑</h3>
          <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
            电脑上打开短剧库和「剧场转发」，它会显示一个地址。<br />手机连同一个 WiFi，填进去就行。
          </p>
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="192.168.x.x:8999"
            className="mt-3 w-full rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-700 outline-none"
          />
          <div className="mt-3 flex justify-center gap-2">
            <Pill primary onClick={() => saveAddr(addr)} disabled={!addr.trim() || checking}>
              {checking ? '正在试…' : '保存并连'}
            </Pill>
            <Pill onClick={refresh}>重试</Pill>
          </div>
          <div className="mt-3 text-center">
            {checking ? <Tag tone="no">正在试…</Tag>
              : online ? <Tag tone="ok">已经连上了</Tag>
              : <Tag tone="no">没连上</Tag>}
          </div>
          {connError && <p className="mt-2.5 text-[11px] text-amber-600 leading-relaxed text-center">{connError}</p>}
        </div>

        {known.length > 0 && (
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700">之前连过</h3>
            <div className="mt-2.5 space-y-2">
              {known.map((k) => (
                <div key={k.base} className="flex items-center gap-2">
                  <button
                    onClick={() => saveAddr(k.base)}
                    className="flex-1 text-left rounded-2xl bg-slate-50 px-4 py-2.5 text-xs text-slate-600 active:scale-95"
                  >
                    {k.base}
                  </button>
                  <button
                    onClick={() => { forgetRelay(k.base); setKnown(getKnownRelays()); }}
                    className="shrink-0 w-9 h-9 rounded-full bg-slate-50 flex items-center justify-center active:scale-95"
                  >
                    <X size={14} className="text-slate-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700">出门在外</h3>
          <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
            装了 Tailscale 之后，出门也能连上家里。<br />
            不想带电脑就先「存到手机」，存完跟电脑无关。
          </p>
        </div>

        {/* 上传：第 5 步才接，这里先留位置 */}
        <div className="rounded-3xl bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700">我自己的视频</h3>
          <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">第 5 步做，先占个位。</p>
        </div>
      </div>
    </div>
  );
};

export default TheaterApp;
