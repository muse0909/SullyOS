
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { useMusic, musicApi, normalizeCookie, toHttps, Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { Gear, User as UserIcon, Crosshair, Play as PlayIcon, Pause as PauseIcon, List } from '@phosphor-icons/react';
import {
  C, Sparkle, CrossStar, MizuHeader, SearchBar, SongRow, MiniPlayer,
  VinylDisc, GlassProgress, PlayControls, BokehBg,
  MetaChip, SubActions,
} from './music/MusicUI';
import NeteaseProfilePage from './music/NeteaseProfilePage';
import CharVisitPage from './music/CharVisitPage';
import QueuePanel from './music/QueuePanel';

// ------------------------- 工具 -------------------------
const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
};

type View = 'search' | 'settings' | 'player' | 'profile' | 'visit_char' | 'listen';

// ========================= 主组件 =========================
const MusicApp: React.FC = () => {
  const { closeApp, addToast, characters, userProfile, updateUserProfile } = useOS();
  const {
    cfg, setCfg,
    current, playing, progress, duration, loadingSong,
    lyric, tlyric, activeLyricIdx,
    profile, playSong, togglePlay, nextSong, prevSong, seek,
    liked, toggleLike, setToastHandler,
    listeningTogetherWith, addListeningPartner, removeListeningPartner,
    addLocalSong, removeLocalSong, localAlbumSongs,
    playMode, setPlayMode,
    regeneratingId, regeneratingStatus,
    queue,  // 暮色 2026-08-02 00:05：MusicApp 漏解构 queue（播放页"队列 · N 首"按钮 + 标题用到了）
  } = useMusic();
  const isCurrentRegenerating = !!current && current.id === regeneratingId;
  // 把对轴入口和单曲循环按钮移到 SubActions 里，避免散乱
  // 下载本地生成的歌曲到本地文件系统
  const downloadCurrentLocal = useCallback(async () => {
    if (!current?.local || !current.localAssetKey) return;
    try {
      const entry = await DB.getAssetRaw(current.localAssetKey).catch(() => null) as
        | { blob?: Blob; mimeType?: string }
        | Blob
        | null;
      const blob: Blob | null = entry instanceof Blob
        ? entry
        : (entry?.blob instanceof Blob ? entry.blob : null);
      if (!blob) { addToast('音频文件丢失', 'error'); return; }
      const mime = current.localMimeType || (entry && !(entry instanceof Blob) ? entry.mimeType : '') || blob.type || 'audio/mpeg';
      const ext = /wav/i.test(mime) ? 'wav' : /ogg/i.test(mime) ? 'ogg' : /flac/i.test(mime) ? 'flac' : /m4a|aac|mp4/i.test(mime) ? 'm4a' : 'mp3';
      const safe = (current.name || 'song').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safe}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      addToast('已下载', 'success');
    } catch {
      addToast('下载失败', 'error');
    }
  }, [current, addToast]);

  const cyclePlayMode = useCallback(() => {
    const order: ('loop' | 'single' | 'shuffle')[] = ['loop', 'single', 'shuffle'];
    const next = order[(order.indexOf(playMode) + 1) % order.length];
    setPlayMode(next);
    addToast(next === 'loop' ? '列表循环' : next === 'single' ? '单曲循环' : '随机播放', 'info');
  }, [playMode, setPlayMode, addToast]);

  // 伴听 char 名单（用于 MiniPlayer / 播放页徽章）—— 带头像，给"小情侣"头像块用
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  // 当前歌在哪些 char 的歌单里（用于 MiniPlayer 的"也收藏"提示）
  const charsWithSong = useMemo(() => {
    if (!current) return [];
    return characters
      .map(c => {
        const pl = c.musicProfile?.playlists.find(p => p.songs.some(s => s.id === current.id));
        return pl ? { id: c.id, name: c.name, playlistTitle: pl.title } : null;
      })
      .filter((x): x is { id: string; name: string; playlistTitle: string } => !!x);
  }, [current, characters]);

  // 把 OS toast 注入到 Music Context（这样全局播放报错也能弹 toast）
  useEffect(() => { setToastHandler(addToast); }, [addToast, setToastHandler]);

  const [view, setView] = useState<View>('search');
  // ── 手动对轴 modal state ──
  const [showLyricSync, setShowLyricSync] = useState(false);
  // 暮色 2026-08-01 22:40：音乐 app 内部的播放队列浮层开关
  const [showQueue, setShowQueue] = useState(false);
  const [syncDraft, setSyncDraft] = useState<number[]>([]);
  const [visitCharId, setVisitCharId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const lyricBoxRef = useRef<HTMLDivElement | null>(null);

  // ── 首页发现区：推荐歌单 / 榜单 / 热搜词（不需登录）──
  const [discoverPls, setDiscoverPls] = useState<Array<{ id: number; name: string; picUrl: string; playCount: number; trackCount: number; copywriter?: string }>>([]);
  const [discoverToplists, setDiscoverToplists] = useState<Array<{ id: number; name: string; cover: string }>>([]);
  const [discoverHots, setDiscoverHots] = useState<Array<{ first: string; iconType?: number }>>([]);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  // 歌单详情弹层（点快速发现 / 榜单卡片进）
  const [discoverDetail, setDiscoverDetail] = useState<{ kind: 'playlist' | 'toplist'; id: number; name: string } | null>(null);
  const [discoverDetailSongs, setDiscoverDetailSongs] = useState<Song[]>([]);
  const [discoverDetailLoading, setDiscoverDetailLoading] = useState(false);

  // 歌词自动滚动：把 current line 对齐到滚动容器视觉中心
  // 注意 offsetTop 依赖 offsetParent，容器没 position:relative 时会跨到祖先节点、值偏大，
  // 导致 current line 被推到中心上方。改用 getBoundingClientRect 对齐，和 DOM 嵌套解耦。
  useEffect(() => {
    if (view !== 'player') return;
    const box = lyricBoxRef.current; if (!box || activeLyricIdx < 0) return;
    const el = box.querySelector<HTMLDivElement>(`[data-lyric-idx="${activeLyricIdx}"]`);
    if (!el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elTopInBox = elRect.top - boxRect.top + box.scrollTop;
    box.scrollTo({ top: elTopInBox - box.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [activeLyricIdx, view]);

  // ── 搜索 ──
  const doSearch = useCallback(async () => {
    const kw = keyword.trim(); if (!kw) return;
    setSearching(true);
    try {
      const r = await musicApi.search(cfg, kw);
      const songs: Song[] = (r?.result?.songs || []).map((s: any) => ({
        id: s.id, name: s.name,
        artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
        album: s.al?.name || s.album?.name || '',
        albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
        duration: (s.dt || s.duration || 0) / 1000,
        fee: s.fee ?? 0,
      }));
      setResults(songs);
      if (!songs.length) {
        const hint = r?.msg || r?.message || (r?.code != null ? `code=${r.code}` : '') || '无数据';
        addToast(`没找到: ${hint}`, 'info');
      }
    } catch (e: any) {
      addToast(`搜索失败：${e.message}`, 'error');
    } finally {
      setSearching(false);
    }
  }, [keyword, cfg, addToast]);

  // ── 首页发现区：并行拉推荐歌单 / 榜单 / 热搜词 ──
  const loadDiscover = useCallback(async () => {
    if (discoverLoaded || discoverLoading) return;
    setDiscoverLoading(true);
    try {
      const [plRes, tlRes, hotRes] = await Promise.allSettled([
        musicApi.personalized(cfg, 12),
        musicApi.toplist(cfg),
        musicApi.searchHot(cfg),
      ]);
      if (plRes.status === 'fulfilled') {
        const arr = (plRes.value?.result || []).map((p: any) => ({
          id: p.id, name: p.name || '',
          picUrl: toHttps(p.picUrl || ''),
          playCount: p.playCount || 0,
          trackCount: p.trackCount || 0,
          copywriter: p.copywriter || '',
        }));
        setDiscoverPls(arr);
      }
      if (tlRes.status === 'fulfilled') {
        const arr = (tlRes.value?.list || []).slice(0, 4).map((t: any) => ({
          id: t.id, name: t.name || '', cover: toHttps(t.coverImgUrl || ''),
        }));
        setDiscoverToplists(arr);
      }
      if (hotRes.status === 'fulfilled') {
        const arr = (hotRes.value?.result?.hots || []).slice(0, 10).map((h: any) => ({
          first: h.first || '', iconType: h.iconType,
        }));
        setDiscoverHots(arr);
      }
    } catch (e: any) {
      // 不弹 toast 打扰用户 — 发现区是 nice-to-have，挂了用户还是能搜歌
      console.warn('[loadDiscover]', e?.message);
    } finally {
      setDiscoverLoading(false);
      setDiscoverLoaded(true);
    }
  }, [cfg, discoverLoaded, discoverLoading]);

  // 进入 search 视图时拉一次（搜过结果后也会保留，方便用户回到首页看）
  useEffect(() => {
    if (view === 'search' && !discoverLoaded && !discoverLoading) {
      loadDiscover();
    }
  }, [view, discoverLoaded, discoverLoading, loadDiscover]);

  // 点歌单 / 榜单卡片 → 加载歌单详情
  const openDiscoverDetail = useCallback(async (kind: 'playlist' | 'toplist', id: number, name: string) => {
    setDiscoverDetail({ kind, id, name });
    setDiscoverDetailSongs([]);
    setDiscoverDetailLoading(true);
    try {
      // playlist 和 toplist 都是 /playlist/detail 同接口（toplist id 也是歌单 id）
      const r = await musicApi.playlistDetail(cfg, id);
      const songs: Song[] = (r?.playlist?.tracks || []).map((s: any) => ({
        id: s.id, name: s.name,
        artists: (s.ar || []).map((a: any) => a.name).join(' / '),
        album: s.al?.name || '',
        albumPic: toHttps(s.al?.picUrl || ''),
        duration: (s.dt || 0) / 1000,
        fee: s.fee ?? 0,
      }));
      setDiscoverDetailSongs(songs);
    } catch (e: any) {
      addToast(`加载失败：${e.message}`, 'error');
    } finally {
      setDiscoverDetailLoading(false);
    }
  }, [cfg, addToast]);

  // ════════════════ 搜索页 ════════════════
  const renderSearch = () => (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="未来音楽"
        onClose={closeApp}
        right={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('profile')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
              title="我的"
            >
              <UserIcon size={16} weight="bold" />
            </button>
            <button
              onClick={() => setView('settings')}
              className="p-1.5 rounded-full transition-all"
              style={{ color: C.primary }}
            >
              <Gear size={16} weight="bold" />
            </button>
          </div>
        }
      />
      <SearchBar value={keyword} onChange={setKeyword} onSearch={doSearch} searching={searching} />

      {/* 用户状态 — 玻璃标签 */}
      {profile && (
        <div className="px-5 -mt-1 mb-1.5 flex items-center gap-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-2 pl-0.5 pr-3 py-0.5 rounded-full text-[10px] shizuku-glass cursor-pointer"
            style={{ color: C.muted }}
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="w-5 h-5 rounded-full object-cover" />
            ) : <Sparkle size={6} color={C.sakura} delay={0.3} />}
            {profile.nickname} · {cfg.quality}
          </button>
        </div>
      )}
      {!cfg.cookie && (
        <div className="px-5 -mt-1 mb-1.5 relative z-10">
          <button
            onClick={() => setView('profile')}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] cursor-pointer"
            style={{ background: `${C.vip}18`, color: C.vip, border: `1px solid ${C.vip}30` }}
          >
            未登录 — 点击登录网易云
          </button>
        </div>
      )}

      {/* 歌曲列表 / 发现区（未搜过时显示发现区） */}
      <div className="flex-1 overflow-y-auto px-2 pb-24 relative z-10 shizuku-scrollbar">
        {results.length === 0 && !searching && (
          <div className="px-3 pt-2 pb-4 space-y-5">
            {/* 热搜词 — pill 列表 */}
            {discoverHots.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Sparkle size={7} color={C.sakura} delay={0.2} />
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>
                    热门搜索
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {discoverHots.map((h, i) => (
                    <button
                      key={`${h.first}-${i}`}
                      onClick={() => { setKeyword(h.first); setResults([]); }}
                      className="px-2.5 py-1 rounded-full text-[10px] transition-all active:scale-95"
                      style={{
                        background: i < 3 ? `linear-gradient(135deg, ${C.sakura}25, ${C.glow}20)` : `${C.faint}15`,
                        color: i < 3 ? C.primary : C.muted,
                        border: `1px solid ${i < 3 ? C.sakura + '50' : C.faint + '30'}`,
                      }}
                    >
                      {i < 3 && <span style={{ color: C.sakura, fontWeight: 700, marginRight: 3 }}>{i + 1}</span>}
                      {h.first}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 官方榜单 — 横排大卡（4 个） */}
            {discoverToplists.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Sparkle size={7} color={C.lavender} delay={0.4} />
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>
                    官方榜单
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {discoverToplists.map(tl => (
                    <button
                      key={tl.id}
                      onClick={() => openDiscoverDetail('toplist', tl.id, tl.name)}
                      className="text-left rounded-2xl overflow-hidden transition-all active:scale-[0.98]"
                      style={{
                        background: `linear-gradient(135deg, ${C.sakura}18, ${C.lavender}12)`,
                        border: `1px solid ${C.faint}30`,
                        boxShadow: `0 2px 10px ${C.glow}10`,
                      }}
                    >
                      <div className="flex items-center gap-2.5 p-2.5">
                        <img
                          src={tl.cover}
                          alt=""
                          className="w-12 h-12 rounded-lg object-cover shrink-0"
                          style={{ boxShadow: `0 2px 8px ${C.glow}20` }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] truncate" style={{ color: C.text, fontWeight: 600 }}>
                            {tl.name}
                          </div>
                          <div className="text-[9px] mt-0.5" style={{ color: C.faint }}>
                            官方 · 实时更新
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 推荐歌单 — 3 列图标网格（不放横滑了，暮色嫌占地方） */}
            {discoverPls.length > 0 && (
              <section>
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Sparkle size={7} color={C.glow} delay={0} />
                  <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>
                    快速发现
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {discoverPls.slice(0, 12).map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => openDiscoverDetail('playlist', pl.id, pl.name)}
                      className="text-left transition-all active:scale-95"
                    >
                      <div className="relative w-full aspect-square rounded-xl overflow-hidden"
                        style={{ boxShadow: `0 2px 10px ${C.glow}20`, background: `${C.faint}18` }}>
                        <img src={pl.picUrl} alt="" className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[8px] text-white text-right"
                          style={{ background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.55))' }}>
                          ♪ {pl.trackCount}
                        </div>
                      </div>
                      <div className="text-[10px] mt-1.5 line-clamp-2 leading-tight" style={{ color: C.text }}>
                        {pl.name}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* loading 状态 */}
            {discoverLoading && discoverPls.length === 0 && (
              <div className="text-center py-8">
                <div className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: `${C.sakura}`, borderTopColor: 'transparent' }} />
                <div className="text-[10px] mt-2" style={{ color: C.faint }}>发现好音乐…</div>
              </div>
            )}

            {/* 加载完成但都为空时（API 全挂） */}
            {!discoverLoading && discoverLoaded && discoverPls.length === 0 && discoverToplists.length === 0 && discoverHots.length === 0 && (
              <div className="text-center py-8">
                <div className="text-[10px]" style={{ color: C.faint }}>暂时拉不到推荐，搜首歌试试？</div>
              </div>
            )}
          </div>
        )}
        {results.map(s => (
          <SongRow
            key={s.id}
            name={s.name}
            artists={s.artists}
            album={s.album}
            albumPic={s.albumPic}
            duration={fmtTime(s.duration)}
            isVip={s.fee === 1}
            isActive={current?.id === s.id}
            onClick={() => playSong(s)}
          />
        ))}
      </div>

      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={() => setView('player')}
          onPrev={prevSong}
          onToggle={togglePlay}
          onNext={nextSong}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={removeListeningPartner}
          charsWithSong={charsWithSong}
          regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
        />
      )}

      {/* 歌单 / 榜单详情弹层 — 从发现区点进来 */}
      {discoverDetail && (
        <div className="absolute inset-0 z-40 flex flex-col"
          style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
          <BokehBg />
          <div className="relative z-10 flex items-center justify-between h-12 px-4 shizuku-glass-strong"
            style={{ borderBottom: `1px solid rgba(255,255,255,0.3)` }}>
            <button onClick={() => setDiscoverDetail(null)} className="text-[11px] px-2 py-1 rounded-full" style={{ color: C.muted }}>
              ← 返回
            </button>
            <div className="text-[12px] tracking-[0.2em] truncate mx-2 flex-1 text-center"
              style={{ color: C.primary, fontFamily: `'Georgia', 'Noto Serif SC', serif`, fontWeight: 600 }}>
              {discoverDetail.name}
            </div>
            {/* 暮色 2026-08-01：歌单 / 榜单详情页加"播放全部"按钮 — 暗紫主题色，不另起绿色。
                点了把 discoverDetailSongs 全部塞进 queue 从第一首开始播，替换当前队列。 */}
            <button
              onClick={() => {
                if (discoverDetailSongs.length === 0) return;
                const first = discoverDetailSongs[0];
                playSong(first, { alsoSetQueue: true, replaceQueue: discoverDetailSongs, startIdx: 0 });
                addToast(`已加入 ${discoverDetailSongs.length} 首到播放列表`, 'success');
              }}
              disabled={discoverDetailSongs.length === 0}
              className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded-full shrink-0 active:scale-95 transition-transform"
              style={{
                background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                color: '#fff',
                opacity: discoverDetailSongs.length === 0 ? 0.4 : 1,
                boxShadow: `0 2px 8px ${C.glow}30`,
              }}
              aria-label="播放全部歌曲"
              title={`播放全部 ${discoverDetailSongs.length} 首`}
            >
              <PlayIcon size={9} weight="fill" />
              播放全部
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-24 relative z-10 shizuku-scrollbar">
            {discoverDetailLoading && (
              <div className="text-center py-12">
                <div className="inline-block w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: C.sakura, borderTopColor: 'transparent' }} />
                <div className="text-[10px] mt-2" style={{ color: C.faint }}>载入歌单…</div>
              </div>
            )}
            {!discoverDetailLoading && discoverDetailSongs.length === 0 && (
              <div className="text-center py-12 text-[10px]" style={{ color: C.faint }}>歌单为空</div>
            )}
            {discoverDetailSongs.map(s => (
              <SongRow
                key={s.id}
                name={s.name}
                artists={s.artists}
                album={s.album}
                albumPic={s.albumPic}
                duration={fmtTime(s.duration)}
                isVip={s.fee === 1}
                isActive={current?.id === s.id}
                onClick={() => {
                  playSong(s, { alsoSetQueue: true, replaceQueue: discoverDetailSongs, startIdx: discoverDetailSongs.findIndex(x => x.id === s.id) });
                }}
              />
            ))}
          </div>
          {current && (
            <MiniPlayer
              name={current.name}
              artists={current.artists}
              albumPic={current.albumPic}
              playing={playing}
              onTap={() => setView('player')}
              onPrev={prevSong}
              onToggle={togglePlay}
              onNext={nextSong}
              userAvatar={userProfile?.avatar}
              userName={userProfile?.name}
              companions={companions}
              onKickCompanion={removeListeningPartner}
              charsWithSong={charsWithSong}
              regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
            />
          )}
        </div>
      )}
    </div>
  );

  // ════════════════ 播放页 ════════════════
  const bitrateMap: Record<string, string> = {
    standard: '128 kbps',
    higher:   '192 kbps',
    exhigh:   '320 kbps',
    lossless: '1411 kbps',
    hires:    '24bit · Hi-Res',
  };

  const renderPlayer = () => {
    if (!current) {
      // 未在播放 → 给个"去搜索找首歌"的占位（之前直接 return null 会让 tab 1 进来看不到东西）
      return (
        <div className="flex flex-col h-full relative"
          style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
          <BokehBg />
          <MizuHeader title="Now Playing" />
          <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10">
            <div className="relative w-32 h-32 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${C.faint}30, ${C.muted}25)`, border: `2px dashed ${C.faint}60` }}>
              <PlayIcon size={36} weight="duotone" color={C.muted} />
            </div>
            <div className="text-[12px] mt-5" style={{ color: C.muted }}>未在播放</div>
            <div className="text-[10px] mt-1.5" style={{ color: C.faint }}>去「搜索」找首歌吧</div>
            <button
              onClick={() => setView('search')}
              className="mt-5 px-5 py-2 rounded-full text-[11px] transition-all active:scale-95"
              style={{
                background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                color: 'white',
                boxShadow: `0 3px 12px ${C.glow}30`,
              }}
            >
              去找首歌 →
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="Now Playing" onBack={() => setView('search')} />

        <div className="flex-1 flex flex-col items-center px-5 pt-4 pb-3 relative z-10 overflow-hidden">
          <div className="shrink-0 mt-1 relative">
            <VinylDisc albumPic={current.albumPic} playing={playing} size={150} bitrate={bitrateMap[cfg.quality]} />
            {/* 重录中覆盖层 — 只在本地歌且 regeneratingId 匹配时显示 */}
            {isCurrentRegenerating && (
              <div className="absolute inset-0 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: `radial-gradient(circle, rgba(0,0,0,0.55) 30%, rgba(0,0,0,0.35) 70%)`,
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  boxShadow: `0 0 30px ${C.glow}80`,
                  animation: 'shizuku-glow 2s ease-in-out infinite',
                }}
              >
                <div className="text-center space-y-1.5 px-3">
                  <div className="w-7 h-7 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <div className="text-[10px] tracking-[0.2em] text-white font-semibold" style={{ fontFamily: 'Georgia, serif' }}>
                    正在重录
                  </div>
                  <div className="text-[9px] text-white/80 truncate max-w-[120px]" style={{ fontFamily: 'monospace' }}>
                    {regeneratingStatus || '处理中…'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 横幅形式的重录提示 — 进入播放页第一时间看到状态 */}
          {isCurrentRegenerating && (
            <div className="mt-3 px-3 py-1.5 rounded-full flex items-center gap-2 text-[10px] tracking-wider"
              style={{
                background: `linear-gradient(135deg, ${C.primary}15, ${C.lavender}25)`,
                border: `1px solid ${C.glow}60`,
                color: C.primary,
              }}
            >
              <Sparkle size={9} color={C.sakura} delay={0} />
              <span>新版本即将到来 · {regeneratingStatus || '处理中'}</span>
              <Sparkle size={9} color={C.lavender} delay={0.5} />
            </div>
          )}

          <section className="mt-5 text-center space-y-1.5 shrink-0 px-2">
            <h2 className="font-light tracking-tight leading-tight"
              style={{ color: C.primary, fontFamily: `'Noto Serif','Georgia',serif`, fontSize: '22px' }}>
              {current.name}
            </h2>
            <p className="text-[10px] uppercase opacity-70"
              style={{ color: C.muted, fontFamily: `'Space Grotesk','SF Mono',monospace`, letterSpacing: '0.2em' }}>
              {current.artists}
            </p>
          </section>

          <div
            ref={lyricBoxRef}
            className="flex-1 w-full my-3 min-h-0 overflow-y-auto text-center scroll-smooth shizuku-scrollbar px-2"
            style={{
              maskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
              WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)',
            }}
          >
            {lyric.length === 0 ? (
              <div className="pt-6 flex flex-col items-center gap-2" style={{ color: C.faint }}>
                <Sparkle size={12} color={C.glow} />
                <span className="text-[11px] italic tracking-wider" style={{ fontFamily: `'Noto Serif','Georgia',serif` }}>
                  {loadingSong ? 'loading...' : 'no lyrics'}
                </span>
              </div>
            ) : (
              <div className="space-y-4 py-8">
                {lyric.map((l, i) => {
                  const tr = tlyric.find(t => Math.abs(t.t - l.t) < 0.2);
                  const active = i === activeLyricIdx;
                  // 关键：字号 / 字重不随 active 变 —— 变了会触发重排换行。
                  //     只让外层盒子用 transform:scale 视觉放大，不动内部文字度量。
                  return (
                    <div key={i} data-lyric-idx={i}
                      className="transition-transform duration-300 will-change-transform"
                      style={{
                        transform: active ? 'scale(1.05)' : 'scale(1)',
                        transformOrigin: 'center center',
                        opacity: active ? 1 : 0.45,
                      }}>
                      <div className="flex items-center justify-center gap-2 px-3">
                        <CrossStar
                          size={12}
                          color={C.sakura}
                          delay={0}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                        <div
                          className="text-[16px] leading-[1.4]"
                          style={{
                            fontFamily: `'Noto Serif','Georgia',serif`,
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            color: active ? undefined : C.faint,
                            ...(active
                              ? {
                                  background: `linear-gradient(135deg, ${C.primary} 0%, ${C.accent} 50%, #9a6bc5 100%)`,
                                  WebkitBackgroundClip: 'text',
                                  WebkitTextFillColor: 'transparent',
                                  backgroundClip: 'text',
                                  filter: `drop-shadow(0 0 14px ${C.glow}a0) drop-shadow(0 0 4px ${C.sakura}80)`,
                                }
                              : {}),
                          }}
                        >
                          {l.text}
                        </div>
                        <CrossStar
                          size={12}
                          color={C.lavender}
                          delay={0.9}
                          solid={active}
                          className={active ? '' : 'opacity-0'}
                        />
                      </div>
                      {tr && (
                        <div
                          className="text-[12px] leading-[1.4] mt-1 px-3"
                          style={{
                            fontWeight: 400,
                            maxWidth: '100%',
                            wordBreak: 'break-word',
                            opacity: active ? 0.78 : 0.4,
                            color: active ? C.accent : C.faint,
                          }}
                        >
                          {tr.text}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="w-full shrink-0 max-w-sm">
            <div className="flex justify-between items-center mb-2 px-0.5">
              <MetaChip>{fmtTime(progress)}</MetaChip>
              <MetaChip>{fmtTime(duration)}</MetaChip>
            </div>
            <GlassProgress progress={progress} duration={duration} fmtTime={fmtTime} onSeek={seek} />
          </div>

          <div className="shrink-0 relative">
            <Sparkle size={9} className="absolute top-1 left-[30%]" color={C.sakura} delay={0} />
            <Sparkle size={7} className="absolute top-3 right-[28%]" color={C.lavender} delay={1.2} />
            <PlayControls playing={playing} loading={loadingSong} onPrev={prevSong} onToggle={togglePlay} onNext={nextSong} />
          </div>

          {/* 暮色 2026-08-01 22:40：播放队列入口（音乐 app 内部"≡ 队列"）— 弹 QueuePanel */}
          <button
            onClick={() => setShowQueue(true)}
            className="shrink-0 mx-auto mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] active:scale-95 transition-transform"
            style={{
              background: 'rgba(255,255,255,0.6)',
              color: C.primary,
              border: `1px solid ${C.faint}50`,
              boxShadow: `0 1px 6px ${C.glow}20`,
            }}
            aria-label="查看播放队列"
            title={`播放队列（${queue.length} 首）`}
          >
            <List size={11} weight="bold" />
            队列 · {queue.length} 首
          </button>

          <div className="shrink-0 mt-3 w-full">
            <SubActions
              liked={liked}
              onLike={toggleLike}
              showSync={!!(current.local && current.localLyrics && lyric.length > 0)}
              onSync={() => {
                setSyncDraft(lyric.map(l => l.t));
                setShowLyricSync(true);
              }}
              showDownload={!!(current.local && current.localAssetKey)}
              onDownload={downloadCurrentLocal}
              playMode={playMode}
              onCyclePlayMode={cyclePlayMode}
            />
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 设置页 ════════════════
  const renderSettings = () => {
    const setDraft = (updates: Partial<typeof cfg>) => setCfg({ ...cfg, ...updates });
    const commit = () => { addToast('已保存', 'success'); setView('search'); };
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="设置" onBack={() => setView('search')} />
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 text-sm relative z-10 shizuku-scrollbar">
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.glow} delay={0} /> 后端 Worker 地址
            </div>
            <input className="w-full rounded-xl px-3 py-2 outline-none text-xs shizuku-glass" value={cfg.workerUrl}
              onChange={e => setDraft({ workerUrl: e.target.value })} placeholder="https://..."
              style={{ color: C.text }} />
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.sakura} delay={0.5} /> 会员 Cookie (MUSIC_U)
            </div>
            <textarea className="w-full rounded-xl px-3 py-2 outline-none text-[10px] shizuku-glass" rows={3} value={cfg.cookie}
              onChange={e => setDraft({ cookie: e.target.value })} placeholder="MUSIC_U=xxx 或直接粘贴值..."
              style={{ color: C.text, fontFamily: 'monospace', resize: 'none' }} />
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>
              也可以在「我的」页面里扫码 / 手机号登录，自动填入 cookie
            </div>
          </div>
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="text-[10px] mb-2 tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
              <Sparkle size={6} color={C.lavender} delay={1} /> 音质
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {(['standard', 'higher', 'exhigh', 'lossless', 'hires'] as const).map(q => (
                <button key={q} onClick={() => setDraft({ quality: q })}
                  className="py-2 rounded-xl text-[10px] transition-all"
                  style={{
                    background: cfg.quality === q ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : C.glass,
                    color: cfg.quality === q ? 'white' : C.muted,
                    border: cfg.quality === q ? '1px solid transparent' : `1px solid rgba(255,255,255,0.3)`,
                    boxShadow: cfg.quality === q ? `0 2px 12px ${C.glow}30` : 'none',
                    backdropFilter: 'blur(8px)',
                  }}
                >{q}</button>
              ))}
            </div>
            <div className="text-[9px] mt-1.5 italic" style={{ color: C.faint }}>lossless / hires 需要黑胶 SVIP</div>
          </div>

          {/* 暮色 2026-08-01：隐藏悬浮迷你播放器开关 — 控制 GlobalMiniPlayer 是否显示 */}
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
                  <Sparkle size={6} color={C.glow} delay={0.5} /> 隐藏悬浮迷你播放器
                </div>
                <div className="text-[9px] mt-1 italic" style={{ color: C.faint }}>
                  关闭后其他页面不再显示小圆球 / 展开条
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !userProfile.miniPlayerHidden;
                  updateUserProfile({ miniPlayerHidden: next });
                  addToast(next ? '已隐藏迷你播放器' : '已显示迷你播放器', 'info');
                }}
                className="shrink-0 w-12 h-6 rounded-full relative transition-colors"
                style={{
                  background: userProfile.miniPlayerHidden ? C.faint + '40' : `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                }}
                aria-label={userProfile.miniPlayerHidden ? '显示迷你播放器' : '隐藏迷你播放器'}
              >
                <div
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all"
                  style={{ left: userProfile.miniPlayerHidden ? '2px' : '26px' }}
                />
              </button>
            </div>
          </div>

          {/* 暮色 2026-08-01：AI 主动放歌开关 — 关掉后 LLM 输出的 play_song / play_song_and_join
              token 会被静默拒绝（跟"歌搜不到"一样的 fallback）。每日每个角色最多 3 次。 */}
          <div className="rounded-2xl p-3.5 shizuku-glass" style={{ boxShadow: `0 2px 16px ${C.glow}08` }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] tracking-wider flex items-center gap-1.5" style={{ color: C.muted }}>
                  <Sparkle size={6} color={C.glow} delay={0.7} /> 允许 AI 主动放歌
                </div>
                <div className="text-[9px] mt-1 italic" style={{ color: C.faint }}>
                  关闭后角色不能主动给你换歌（每日每角色最多 3 次）
                </div>
              </div>
              <button
                onClick={() => {
                  const next = !(userProfile.musicAiAutoPlayEnabled !== false);  // 默认 true
                  updateUserProfile({ musicAiAutoPlayEnabled: next });
                  addToast(next ? '已允许 AI 主动放歌' : '已禁止 AI 主动放歌', 'info');
                }}
                className="shrink-0 w-12 h-6 rounded-full relative transition-colors"
                style={{
                  background: userProfile.musicAiAutoPlayEnabled === false ? C.faint + '40' : `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                }}
                aria-label={userProfile.musicAiAutoPlayEnabled === false ? '允许 AI 主动放歌' : '禁止 AI 主动放歌'}
              >
                <div
                  className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all"
                  style={{ left: userProfile.musicAiAutoPlayEnabled === false ? '2px' : '26px' }}
                />
              </button>
            </div>
          </div>
          <div className="space-y-3 pt-1">
            <button
              onClick={async () => {
                const lines: string[] = [];
                const ck = normalizeCookie(cfg.cookie);
                lines.push(`Worker: ${cfg.workerUrl}`);
                lines.push(`Cookie: ${ck ? ck.slice(0, 18) + '...(' + ck.length + 'c)' : '(未填)'}`);
                try {
                  const res = await fetch(`${cfg.workerUrl.replace(/\/+$/, '')}/netease/search`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...(ck ? { 'X-Netease-Cookie': ck } : {}) },
                    body: JSON.stringify({ keyword: '晴天', limit: 3 }),
                  });
                  lines.push(`HTTP ${res.status}`);
                  const txt = await res.text(); lines.push(txt.slice(0, 800));
                  try { const j = JSON.parse(txt); lines.push(`---\ncode=${j.code}  songs=${j?.result?.songs?.length ?? 'N/A'}`); } catch {}
                } catch (e: any) { lines.push(`异常: ${e.message}`); }
                alert(lines.join('\n'));
              }}
              className="w-full py-2.5 rounded-2xl text-[10px] tracking-wider shizuku-glass transition-all"
              style={{ color: C.vip, border: `1px solid ${C.vip}30` }}
            >诊断（搜索晴天）</button>
            <button onClick={commit}
              className="w-full py-3 rounded-2xl text-xs text-white tracking-wider transition-all relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 3px 18px ${C.glow}30` }}>
              <span className="relative z-10">保存</span>
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)`,
                backgroundSize: '200% 100%', animation: 'shizuku-shimmer 3s ease-in-out infinite',
              }} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ════════════════ 一起听 ════════════════
  // 选 AI 角色作"同伴" + 当前播放的歌 = 一起听模式
  // 拜访（CharVisitPage）也在这个 tab 里，作为"高级版一起听"入口
  // （addListeningPartner / listeningTogetherWith 已在顶部 useMusic() destructure 过）
  const togglePartner = (charId: string) => {
    if (listeningTogetherWith.includes(charId)) {
      removeListeningPartner(charId);
    } else {
      addListeningPartner(charId);
    }
  };

  const renderListen = () => (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader title="一起听" onClose={closeApp} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 relative z-10 shizuku-scrollbar space-y-5">

        {/* STEP 1 — 选同伴（多选） */}
        <section>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>01</span>
            <span className="text-[12px]" style={{ color: C.primary, fontWeight: 600 }}>选一位同伴</span>
            <span className="text-[10px]" style={{ color: C.faint }}>· {listeningTogetherWith.length} 位正在听</span>
          </div>
          {characters.length === 0 ? (
            <div className="text-[10px] py-6 text-center" style={{ color: C.faint }}>暂无角色 · 请先在角色管理添加</div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {characters.map(ch => {
                const picked = listeningTogetherWith.includes(ch.id);
                const isImage = (ch.avatar || '').startsWith('data:') || (ch.avatar || '').startsWith('http');
                return (
                  <button
                    key={ch.id}
                    onClick={() => togglePartner(ch.id)}
                    className="text-center transition-all active:scale-95"
                  >
                    <div className="relative w-14 h-14 mx-auto">
                      {isImage ? (
                        <img src={ch.avatar} alt="" className="w-14 h-14 rounded-full object-cover"
                          style={{
                            border: `2px solid ${picked ? C.accent : C.faint}80`,
                            boxShadow: picked ? `0 0 0 3px ${C.glow}40, 0 4px 14px ${C.glow}40` : 'none',
                            opacity: picked ? 1 : 0.7,
                          }} />
                      ) : (
                        <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-semibold"
                          style={{
                            background: `linear-gradient(135deg, ${picked ? C.primary : C.faint}, ${picked ? C.lavender : C.muted})`,
                            border: `2px solid ${picked ? C.accent : C.faint}80`,
                            boxShadow: picked ? `0 0 0 3px ${C.glow}40, 0 4px 14px ${C.glow}40` : 'none',
                            fontFamily: `'Noto Serif', serif`,
                          }}>
                          {ch.avatar || ch.name.slice(0, 1)}
                        </div>
                      )}
                      {picked && (
                        <div className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, color: 'white' }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] mt-1.5 truncate" style={{ color: picked ? C.primary : C.muted, fontWeight: picked ? 600 : 400 }}>
                      {ch.name}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* STEP 2 — 选一首歌 */}
        <section>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>02</span>
            <span className="text-[12px]" style={{ color: C.primary, fontWeight: 600 }}>选一首歌</span>
          </div>
          {current ? (
            <button
              onClick={() => setView('player')}
              className="w-full rounded-2xl p-3 flex items-center gap-3 text-left transition-all active:scale-[0.99]"
              style={{
                background: `linear-gradient(135deg, ${C.sakura}18, ${C.lavender}15)`,
                border: `1px solid ${C.sakura}40`,
                boxShadow: `0 2px 10px ${C.glow}15`,
              }}
            >
              <img src={current.albumPic} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0"
                style={{ boxShadow: `0 2px 8px ${C.glow}20` }} />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] truncate" style={{ color: C.text, fontWeight: 600 }}>{current.name}</div>
                <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>{current.artists}</div>
              </div>
              <div className="text-[10px] shrink-0" style={{ color: C.accent }}>在播 →</div>
            </button>
          ) : (
            <div className="text-[10px] py-4 text-center rounded-2xl shizuku-glass" style={{ color: C.faint }}>
              歌单为空
            </div>
          )}
          <button
            onClick={() => setView('search')}
            className="w-full mt-2 py-2 rounded-2xl text-[11px] shizuku-glass transition-all"
            style={{ color: C.accent, border: `1px solid ${C.accent}30` }}
          >
            去搜索找首歌一起听
          </button>
        </section>

        {/* 当前一起听状态摘要 — 放在 03 拜访上面，不被 tab bar 挡 */}
        {listeningTogetherWith.length > 0 && current && (
          <section className="rounded-2xl p-3 shizuku-glass" style={{ border: `1px solid ${C.sakura}40` }}>
            <div className="text-[10px] tracking-wider mb-1.5" style={{ color: C.sakura, fontWeight: 600 }}>
              一起听中
            </div>
            <div className="flex items-center gap-2">
              <img src={userProfile?.avatar || ''} alt="" className="w-7 h-7 rounded-full object-cover border" style={{ borderColor: C.glow + '60' }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
              <div className="text-[11px]" style={{ color: C.muted }}>你</div>
              <div className="text-[11px]" style={{ color: C.sakura }}>×</div>
              <div className="flex -space-x-2">
                {listeningTogetherWith.slice(0, 5).map(id => {
                  const ch = characters.find(c => c.id === id);
                  if (!ch) return null;
                  const av = ch.avatar || '';
                  const isImg = av.startsWith('data:') || av.startsWith('http');
                  return isImg ? (
                    <img key={id} src={av} alt="" className="w-7 h-7 rounded-full object-cover border-2" style={{ borderColor: C.bg }} />
                  ) : (
                    <div key={id} className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] border-2"
                      style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, borderColor: C.bg }}>
                      {av || ch.name.slice(0, 1)}
                    </div>
                  );
                })}
              </div>
              <div className="text-[10px] flex-1 truncate" style={{ color: C.muted }}>在听《{current.name}》</div>
            </div>
          </section>
        )}

        {/* 拜访 · 高级版一起听 */}
        {onVisitCharAvailable && (
          <section>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>03</span>
              <span className="text-[12px]" style={{ color: C.primary, fontWeight: 600 }}>去拜访 · 他们的音乐角落</span>
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto pb-1 shizuku-scrollbar">
              {characters.map(ch => {
                const initialized = !!ch.musicProfile?.initializedAt;
                const avatar = ch.avatar || '';
                const isImage = avatar.startsWith('data:') || avatar.startsWith('http');
                return (
                  <button
                    key={ch.id}
                    onClick={() => { setVisitCharId(ch.id); setView('visit_char'); }}
                    className="shrink-0 text-center"
                    title={initialized ? `拜访 ${ch.name} 的音乐角落` : `${ch.name} 还没开启音乐角落`}
                  >
                    <div className="w-14 h-14 mx-auto">
                      {isImage ? (
                        <img src={avatar} alt="" className="w-14 h-14 rounded-full object-cover"
                          style={{ border: `2px solid ${initialized ? C.accent : C.faint}60`, opacity: initialized ? 1 : 0.55 }} />
                      ) : (
                        <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-semibold"
                          style={{
                            background: initialized ? `linear-gradient(135deg, ${C.primary}, ${C.lavender})` : `linear-gradient(135deg, ${C.faint}, ${C.muted})`,
                            border: `2px solid ${initialized ? C.accent : C.faint}60`,
                            fontFamily: `'Noto Serif', serif`,
                            opacity: initialized ? 1 : 0.7,
                          }}>
                          {avatar || ch.name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] mt-1 truncate" style={{ color: initialized ? C.text : C.faint, maxWidth: 56 }}>
                      {ch.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={() => setView('player')}
          onPrev={prevSong}
          onToggle={togglePlay}
          onNext={nextSong}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={removeListeningPartner}
          charsWithSong={charsWithSong}
          regenStatus={isCurrentRegenerating ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );

  // ════════════════ 底部 tab bar ════════════════
  // 4 个 tab：播放(player view) / 搜索 / 一起听 / 我的
  // 暮色：tab 1 改成"播放"进 player view；"搜索" tab 顶部承载发现区（推荐+榜单+热搜）
  const isTabActive = (tab: 'player' | 'search' | 'listen' | 'profile') => {
    if (tab === 'player') return view === 'player';
    if (tab === 'search') return view === 'search';
    if (tab === 'listen') return view === 'listen';
    if (tab === 'profile') return view === 'profile';
    return false;
  };
  const goTab = (tab: 'player' | 'search' | 'listen' | 'profile') => {
    if (tab === 'player') setView('player');
    else if (tab === 'search') setView('search');
    else if (tab === 'listen') setView('listen');
    else if (tab === 'profile') setView('profile');
  };
  const onVisitCharAvailable = true; // 角色列表存在就有拜访入口

  return (
    <div className="absolute inset-0 overflow-hidden">
      {view === 'search' && renderSearch()}
      {view === 'listen' && renderListen()}
      {view === 'player' && renderPlayer()}
      {view === 'settings' && renderSettings()}
      {view === 'profile' && (
        <NeteaseProfilePage
          onBack={closeApp}
          onOpenPlayer={() => setView('player')}
          onOpenSearch={() => setView('search')}
          onOpenSettings={() => setView('settings')}
          onVisitChar={id => { setVisitCharId(id); setView('visit_char'); }}
        />
      )}
      {/* 手动对轴 modal — 全屏覆盖，不开新 view */}
      {showLyricSync && current && current.local && (() => {
        const fmt = (s: number) => {
          if (!isFinite(s)) return '0:00.0';
          const m = Math.floor(s / 60);
          const sec = (s % 60).toFixed(1).padStart(4, '0');
          return `${m}:${sec}`;
        };
        const setLineTime = (idx: number, t: number) => {
          setSyncDraft(prev => {
            const next = [...prev];
            next[idx] = Math.max(0, t);
            return next;
          });
        };
        const tapCurrent = (idx: number) => setLineTime(idx, progress);
        const resetAuto = () => {
          if (!duration || duration <= 0) return;
          const intro = Math.min(2, duration * 0.05);
          const outro = Math.min(3, duration * 0.05);
          const usable = Math.max(duration - intro - outro, duration * 0.6);
          const step = usable / lyric.length;
          setSyncDraft(lyric.map((_, i) => intro + i * step));
        };
        const saveSync = () => {
          if (!current) return;
          // 把 draft 写到 song.lyricLineTimings 里 → addLocalSong 上行覆盖
          const updated: Song = { ...current, lyricLineTimings: syncDraft };
          addLocalSong(updated);
          // 重新 playSong 让 LyricLine 立即用新时间
          playSong(updated, { alsoSetQueue: false });
          setShowLyricSync(false);
          addToast('对轴已保存 ✦', 'success');
        };

        return (
          <div className="absolute inset-0 z-50 flex flex-col"
            style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 60%, ${C.bgDeep} 100%)` }}>
            <BokehBg />
            {/* Header */}
            <div className="relative z-10 flex items-center justify-between h-12 px-4 shizuku-glass-strong"
              style={{ borderBottom: `1px solid rgba(255,255,255,0.3)` }}>
              <button onClick={() => setShowLyricSync(false)} className="text-[11px] px-2 py-1 rounded-full" style={{ color: C.muted }}>取消</button>
              <div className="flex items-center gap-1.5">
                <Crosshair size={13} weight="duotone" color={C.primary} />
                <span className="text-[12px] tracking-[0.25em]" style={{ color: C.primary, fontFamily: 'Georgia, serif' }}>歌词对轴</span>
              </div>
              <button onClick={saveSync} className="text-[11px] font-bold px-3 py-1 rounded-full"
                style={{
                  background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                  color: 'white',
                  boxShadow: `0 2px 10px ${C.glow}50`,
                }}>保存</button>
            </div>

            {/* Live progress + transport */}
            <div className="relative z-10 px-4 pt-3 pb-2 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <button onClick={togglePlay}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 transition-transform"
                  style={{
                    background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
                    color: 'white',
                    boxShadow: `0 3px 12px ${C.glow}50`,
                  }}
                >
                  {playing ? <PauseIcon size={14} weight="fill" /> : <PlayIcon size={14} weight="fill" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between text-[10px] mb-1" style={{ color: C.muted, fontFamily: 'monospace' }}>
                    <span style={{ color: C.primary, fontWeight: 600 }}>{fmt(progress)}</span>
                    <span>{fmt(duration)}</span>
                  </div>
                  <div className="h-1 rounded-full shizuku-glass cursor-pointer relative"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      seek((e.clientX - rect.left) / rect.width);
                    }}
                  >
                    <div className="absolute top-0 left-0 h-full rounded-full"
                      style={{
                        width: `${duration > 0 ? (progress / duration) * 100 : 0}%`,
                        background: `linear-gradient(90deg, ${C.primary}, ${C.glow})`,
                      }} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <button onClick={resetAuto} className="text-[10px] underline" style={{ color: C.muted }}>
                  重置为均匀分布
                </button>
                <p className="text-[10px] flex-1 text-right" style={{ color: C.muted }}>
                  播放时点 ⊙ 把当前时间设给那一句
                </p>
              </div>
            </div>

            {/* Lyric list with tap-to-set */}
            <div className="flex-1 overflow-y-auto px-3 pb-6 shizuku-scrollbar relative z-10 pt-1">
              {lyric.length === 0 ? (
                <div className="text-center text-[11px] py-12" style={{ color: C.faint }}>没有歌词可对轴</div>
              ) : (
                <div className="space-y-1.5">
                  {lyric.map((l, i) => {
                    const t = syncDraft[i] ?? l.t;
                    const isActive = i === activeLyricIdx;
                    return (
                      <div key={i}
                        className="flex items-center gap-2 rounded-xl px-2.5 py-2 transition-all"
                        style={{
                          background: isActive
                            ? `linear-gradient(135deg, ${C.glow}25, ${C.lavender}18)`
                            : 'rgba(255,255,255,0.5)',
                          border: `1px solid ${isActive ? C.glow + '60' : C.faint + '30'}`,
                          boxShadow: isActive ? `0 2px 12px ${C.glow}30` : 'none',
                        }}
                      >
                        <span className="text-[9px] tabular-nums w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</span>
                        <button
                          onClick={() => tapCurrent(i)}
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-90 transition-all"
                          style={{
                            background: `${C.primary}15`,
                            border: `1px solid ${C.primary}30`,
                            color: C.primary,
                          }}
                          title="把这一句设到当前播放时间"
                        >
                          ⊙
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] truncate" style={{ color: isActive ? C.primary : C.text, fontWeight: isActive ? 600 : 400 }}>
                            {l.text}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] tabular-nums" style={{ color: C.muted, fontFamily: 'monospace' }}>{fmt(t)}</span>
                            <button
                              onClick={() => setLineTime(i, t - 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >−.2s</button>
                            <button
                              onClick={() => setLineTime(i, t + 0.2)}
                              className="text-[9px] px-1 rounded"
                              style={{ color: C.faint }}
                            >+.2s</button>
                            <button
                              onClick={() => seek(duration > 0 ? t / duration : 0)}
                              className="text-[9px] px-1 rounded ml-auto"
                              style={{ color: C.accent }}
                            >跳到此处</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {view === 'visit_char' && visitCharId && (
        <CharVisitPage
          charId={visitCharId}
          onBack={() => { setView('profile'); setVisitCharId(null); }}
          onOpenPlayer={() => setView('player')}
        />
      )}

      {/* 底部 tab bar — 4 个主视图都显示（player/visit_char/settings 隐藏） */}
      {(view === 'player' || view === 'search' || view === 'listen' || view === 'profile') && (
        <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none">
          <div className="pointer-events-auto mx-2 mb-2 rounded-3xl shizuku-glass-strong flex items-stretch"
            style={{ border: `1px solid ${C.faint}30`, boxShadow: `0 -4px 20px ${C.glow}10` }}>
            {([
              { key: 'player' as const, label: '播放', icon: 'player' },
              { key: 'search' as const, label: '搜索', icon: 'search' },
              { key: 'listen' as const, label: '一起听', icon: 'listen' },
              { key: 'profile' as const, label: '我的', icon: 'profile' },
            ]).map(t => {
              const active = isTabActive(t.key);
              return (
                <button
                  key={t.key}
                  onClick={() => goTab(t.key)}
                  className="flex-1 py-2 flex flex-col items-center gap-0.5 transition-all active:scale-95"
                >
                  {t.icon === 'player' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? C.primary : C.muted}>
                      <path d="M8 5v14l11-7L8 5z" />
                    </svg>
                  )}
                  {t.icon === 'search' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? C.primary : C.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                    </svg>
                  )}
                  {t.icon === 'listen' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? C.primary : C.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                  )}
                  {t.icon === 'profile' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? C.primary : C.muted}>
                      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-8 2-8 5v2h16v-2c0-3-4-5-8-5z" />
                    </svg>
                  )}
                  <span className="text-[9px] tracking-wider"
                    style={{ color: active ? C.primary : C.muted, fontWeight: active ? 600 : 400 }}>
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 暮色 2026-08-01 22:40：播放队列浮层（与 GlobalMiniPlayer 共用 QueuePanel） */}
      <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} title="当前播放 · 队列" />
    </div>
  );
};

export default MusicApp;
