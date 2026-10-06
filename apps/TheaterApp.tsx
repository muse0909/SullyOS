/**
 * 剧场 · 主页面
 *
 * 暮色 2026-10-05 定的四个页签（原来只有三个，而且「已下载」把电脑和手机混成一个）：
 *   剧库首页 —— 短剧库的全库，跟网页上看到的一样，能翻能筛
 *   缓存剧库 —— 电脑上短剧库已经下好的
 *   本地剧库 —— **真的躺在手机里**的：存过来的 + 自己上传的
 *   正在追剧 —— 看过的
 *
 * 这一步仍然不接 AI（第 2 步才接 live），下面聊天框还是占位。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import {
  ArrowLeft, GearSix, MagnifyingGlass, Play, FilmSlate, X, UploadSimple, Trash,
  DeviceMobile, HardDrive, CloudSlash, CloudArrowDown, Moon, Sun, DeviceMobileCamera, Sparkle,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import Modal from '../components/os/Modal';
import PlayerStage, { fmtTime } from '../components/dramaTheater/PlayerStage';
import EpisodeDrawer, { type EpState } from '../components/dramaTheater/EpisodeDrawer';
import {
  getRelayAddr, setRelayAddr, normalizeAddr, pingRelay, forgetRelay, getKnownRelays,
  fetchDramas, fetchTasks, searchDramas, fetchEpisodes, fetchVideoBlobUrl, fetchVideoBytes,
  fetchMacWatchHistory, sourceName, openOnlinePlayback, streamOnlineEpisode, closeOnlinePlayback,
  reclaimStaleSessions, localVideoUrl, clearAllOnlinePlayback, PLAYBACK_BUSY_MSG,
  type RelayDrama, type RelayTask, type RelaySource,
} from '../utils/dramaTheater/relayClient';
import {
  listPhoneDramas, findPhoneDrama, dramaKey, saveEpisodeToPhone, phoneEpisodeUri,
  deletePhoneEpisode, deletePhoneDrama, clearPhoneLibrary, phoneLibraryUsage,
  saveUploads, base64ToBlob, fmtBytes, downloadEpisodeToPhone, type PhoneDrama,
} from '../utils/dramaTheater/localVideos';
import { listWatch, upsertWatch, removeWatch, clearWatch } from '../utils/dramaTheater/watchHistory';
import { useTheaterTheme, palette, type Palette } from '../utils/dramaTheater/theme';

const AUTONEXT_KEY = 'theater_autonext';
const PAGE = 60;

/**
 * 诊断记录：把在线播放的**每一步**写进 window.__theaterDiag。
 *
 * 2026-10-06 深夜这轮排查逼出来的：靠猜连错三次（先怪 429、再怪高度、
 * 最后发现是按钮被 disabled），每次都得请用户点一次、我在外面轮询，
 * 而轮询会因为 WebView 调试端口掉线而丢现场。
 *
 * 所以改成**让被测对象自己说话**：点一次之后读 window.__theaterDiag，
 * 就能看到它走到哪一步、报了什么，不用依赖连接一直活着。
 * 只挂在 window 上、不进 localStorage、不产生任何副作用。
 */
function diag(step: string, extra?: Record<string, unknown>): void {
  try {
    const w = window as unknown as { __theaterDiag?: unknown[] };
    if (!w.__theaterDiag) w.__theaterDiag = [];
    w.__theaterDiag.push({ t: new Date().toISOString().slice(11, 19), step, ...(extra || {}) });
    if (w.__theaterDiag.length > 80) w.__theaterDiag.splice(0, w.__theaterDiag.length - 80);
  } catch { /* 诊断不能影响功能 */ }
}

// ── 小零件 ──

const Tag: React.FC<{ tone: 'ok' | 'no' | 'new' | 'mac'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls =
    tone === 'ok' ? 'bg-emerald-50 text-emerald-600'
    : tone === 'new' ? 'bg-sky-50 text-sky-600'
    : tone === 'mac' ? 'bg-sky-50 text-sky-600'
    : 'bg-slate-100 text-slate-400';
  return <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${cls}`}>{children}</span>;
};

const Pill: React.FC<{
  primary?: boolean; onClick?: () => void; disabled?: boolean; tone?: Palette; children: React.ReactNode;
}> = ({ primary, onClick, disabled, tone, children }) => {
  const p = tone || palette(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-5 py-2.5 text-xs font-bold transition active:scale-95 disabled:opacity-40 ${
        primary ? 'bg-sky-500 text-white shadow-sm' : p.night ? 'bg-[#334155] text-slate-200' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {children}
    </button>
  );
};

/**
 * 下载选择窗：选要下哪几集到手机。
 *
 * 暮色 10-05 要求：点「下载到手机」弹窗，能手动输区间（比如 2-20），
 * 有全选、全不选，全选就是整部。**必须显示体积**（同一天定的）——
 * 之前「整部存到手机」一点就开下，实测 107 集 ≈ 1.5 GB，误触没有退路。
 *
 * 体积只能估：转发服务不吐单集大小（实测 /relay/local/video 的响应头里没有
 * Content-Length 之外的可用信息），所以拿「电脑上已存的这几集的平均大小」乘，
 * 再拿手机里已存的集数校准。第一次没有参照时给不出数字，就说「估不出来」。
 */
const DownloadPicker: React.FC<{
  p: Palette;
  title: string;
  avail: number[];              // 电脑里有、手机还没有的集
  checked: Set<number>;
  range: string;
  setRange: (v: string) => void;
  avgBytes: number;             // 0 = 还没有参照，给不出体积
  onToggle: (n: number) => void;
  onApplyRange: () => void;
  onAll: () => void;
  onNone: () => void;
  onClose: () => void;
  onConfirm: () => void;
}> = ({ p, title, avail, checked, range, setRange, avgBytes, onToggle, onApplyRange, onAll, onNone, onClose, onConfirm }) => {
  const picked = checked.size;
  const est = avgBytes > 0 ? avgBytes * picked : 0;
  const min = avail[0];
  const max = avail[avail.length - 1];

  return (
    <Modal
      isOpen={!!title}
      title="下载到手机"
      onClose={onClose}
      zIndex={130}
      footer={
        <>
          <button
            onClick={onClose}
            className={`flex-1 rounded-full py-2.5 text-xs font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-300' : 'bg-slate-100 text-slate-500'}`}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!picked}
            className="flex-1 rounded-full py-2.5 text-xs font-bold bg-sky-500 text-white active:scale-95 disabled:opacity-40"
          >
            {picked ? `下载 ${picked} 集` : '先选集'}
          </button>
        </>
      }
    >
      <p className={`text-[11px] text-center mb-3 ${p.sub}`}>
        电脑里有 {avail.length} 集还没下到手机 · 第 {min}-{max} 集
      </p>

      {/* 区间输入：2-20 这种。写完点「照这段」才生效 */}
      <div className="flex items-center gap-2 mb-3">
        <input
          value={range}
          onChange={(e) => setRange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onApplyRange(); }}
          placeholder={`比如 ${min}-${Math.min(min + 18, max)}`}
          inputMode="numeric"
          className={`flex-1 min-w-0 rounded-2xl px-3 py-2.5 text-sm text-center outline-none ${p.input}`}
        />
        <button
          onClick={onApplyRange}
          disabled={!range.trim()}
          className={`shrink-0 rounded-full px-3 py-2.5 text-[11px] font-bold active:scale-95 disabled:opacity-40 ${p.night ? 'bg-[#334155] text-slate-200' : 'bg-slate-100 text-slate-500'}`}
        >
          照这段
        </button>
        <button
          onClick={onAll}
          className={`shrink-0 rounded-full px-3 py-2.5 text-[11px] font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-200' : 'bg-slate-100 text-slate-500'}`}
        >
          全选
        </button>
        <button
          onClick={onNone}
          className={`shrink-0 rounded-full px-3 py-2.5 text-[11px] font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-200' : 'bg-slate-100 text-slate-500'}`}
        >
          全不选
        </button>
      </div>

      {/* 体积：不显示就等于默认允许一次下 1.5 G */}
      <div className={`rounded-2xl px-4 py-3 mb-3 text-center ${p.night ? 'bg-[#0f172a]' : 'bg-sky-50'}`}>
        <p className={`text-[13px] font-bold ${p.title}`}>
          这次要下 {picked} 集
          {est > 0 ? `，大约 ${fmtBytes(est)}` : ''}
        </p>
        <p className={`text-[10px] mt-1 ${p.sub}`}>
          {est > 0
            ? '下完跟电脑就没关系了，断网也能看'
            : picked ? '体积暂时估不出来' : '还没选集'}
        </p>
      </div>

      <div className="grid grid-cols-6 gap-1.5 max-h-[26vh] overflow-y-auto no-scrollbar">
        {avail.map((n) => {
          const on = checked.has(n);
          return (
            <button
              key={n}
              onClick={() => onToggle(n)}
              className={`aspect-square rounded-lg text-[11px] font-bold transition active:scale-95 ${
                on
                  ? 'bg-sky-500 text-white'
                  : p.night
                  ? 'bg-[#1e293b] text-slate-500'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </Modal>
  );
};

/** 一部剧的引用：电脑上的剧和手机上传的剧都要能选中，字段凑成同一套 */
type DramaRef = { id: string; title: string; coverUrl?: string; origin: 'mac' | 'upload'; episodeHint?: number };

/**
 * 上传确认窗：选完文件先问剧名再存。
 *
 * 抽成独立组件是为了能挂在**多个页面分支**下面 —— 之前它内联写在设置页的
 * return 里，只有进到设置页那段 JSX 才会渲染，本地剧库点「传视频」时
 * 存是存进去了、弹窗却不出现（真机 10-05 反馈）。
 */
const UploadModal: React.FC<{
  p: Palette;
  files: File[];
  name: string;
  setName: (v: string) => void;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ p, files, name, setName, uploading, onCancel, onConfirm }) => (
  <Modal
    isOpen={files.length > 0}
    title="传到手机里"
    onClose={onCancel}
    zIndex={130}
    footer={
      <>
        <button
          onClick={onCancel}
          className={`flex-1 rounded-full py-2.5 text-xs font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-300' : 'bg-slate-100 text-slate-500'}`}
        >
          取消
        </button>
        <button
          onClick={onConfirm}
          disabled={uploading || !name.trim()}
          className="flex-1 rounded-full py-2.5 text-xs font-bold bg-sky-500 text-white active:scale-95 disabled:opacity-40"
        >
          {uploading ? '正在存…' : `存 ${files.length} 个文件`}
        </button>
      </>
    }
  >
    <p className={`text-[11px] text-center mb-3 ${p.sub}`}>
      选了 {files.length} 个文件，按顺序当成连续几集
    </p>
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="给它起个剧名"
      className={`w-full rounded-2xl px-4 py-3 text-sm text-center outline-none ${p.input}`}
    />
  </Modal>
);

type Page = 'list' | 'episodes' | 'player' | 'settings';
type Tab = 'home' | 'mac' | 'phone' | 'watch';

// ═══════════════════════════════════════════════════

const TheaterApp: React.FC = () => {
  const { activeCharacterId, characters, addToast } = useOS();
  const char = useMemo(
    () => characters.find((c: any) => c.id === activeCharacterId),
    [characters, activeCharacterId]
  );

  const { mode: themeMode, night, setMode: setThemeMode } = useTheaterTheme();
  const p = useMemo(() => palette(night), [night]);

  const [page, setPage] = useState<Page>('list');
  const [tab, setTab] = useState<Tab>('home');

  // ── 转发服务连接 ──
  const [addr, setAddr] = useState(getRelayAddr());
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connError, setConnError] = useState('');
  const [known, setKnown] = useState(getKnownRelays());

  // ── 数据 ──
  const [dramas, setDramas] = useState<RelayDrama[]>([]);
  const [sources, setSources] = useState<RelaySource[]>([]);
  const [tasks, setTasks] = useState<RelayTask[]>([]);
  const [phoneList, setPhoneList] = useState<PhoneDrama[]>([]);
  const [usage, setUsage] = useState({ bytes: 0, count: 0, dramas: 0 });
  const [macWatch, setMacWatch] = useState<any[]>([]);
  const [watch, setWatch] = useState(listWatch());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RelayDrama[]>([]);
  const [searched, setSearched] = useState('');

  // ── 剧库首页筛选 ──
  // 暮色 10-05：首页默认就加载红果。红果是几个站源里内容最正常的，
  // 「全部站源」里混着黄豆那种大量成人向内容，一进来就摆在最前面不合适。
  // 只改默认站源，其他站源照旧能点（点「全部站源」或别的站源都行）。
  const DEFAULT_SOURCE = 'hongguo';
  const [srcFilter, setSrcFilter] = useState(DEFAULT_SOURCE);
  const [sortKey, setSortKey] = useState('default');
  const [visible, setVisible] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 整部存手机时的「停一下」：这个必须用 ref，state 那个值在循环里是开始时的快照，
  // 读它永远读不到用户中途点的「停」
  const saveAllCancel = useRef(false);

  // ── 选中的剧 / 集 ──
  const [picked, setPicked] = useState<DramaRef | null>(null);
  const [epTotal, setEpTotal] = useState(0);
  const [currentEp, setCurrentEp] = useState(1);
  const [curDuration, setCurDuration] = useState(0);

  // ── 存到手机 ──
  const [saveAll, setSaveAll] = useState({ busy: false, done: 0, total: 0, cancel: false });
  const [expandedPhone, setExpandedPhone] = useState('');

  // ── 下载选择窗（暮色 10-05：点「下载到手机」先选要哪几集）──
  // 存的是「这部剧里电脑有、手机还没有的集」，勾选状态用一个 Set 存，
  // 区间输入、全选、全不选都只改这个 Set。
  const [dlPick, setDlPick] = useState<{ title: string; avail: number[] } | null>(null);
  const [dlChecked, setDlChecked] = useState<Set<number>>(new Set());
  const [dlRange, setDlRange] = useState('');

  // ── 上传 ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [pendingName, setPendingName] = useState('');
  const [uploading, setUploading] = useState(false);

  // ── 播放器 ──
  const [blobUrl, setBlobUrl] = useState('');
  // blobUrl 里装的到底是第几集。必须有这个：
  // 自动连播切到下一集时，setCurrentEp 立刻生效，但取下一集的视频是异步的
  // （几十兆要一两秒）。这中间 blobUrl 里装的还是上一集。
  // 「把这一集存到手机」如果在窗口期点了，按 currentEp 存下来的就是上一集的内容 ——
  // 真机 10-05 实测存出个「003.mp4 里装的是 002 的内容」，跟电脑原文件一比字节完全对得上。
  const [blobEp, setBlobEp] = useState(0);
  const [srcKind, setSrcKind] = useState<'mac' | 'phone' | 'online' | ''>('');
  // 在线播放的现场：一条流对应一个 AbortController + 一个 MediaSource 清理函数，
  // 切集/退页必须把它们收掉，不然连接和缓冲一直挂着。
  const onlineAbort = useRef<AbortController | null>(null);
  const onlineCleanup = useRef<(() => void) | null>(null);
  // 当前在线播放的会话号，切集/退页/播完都要拿它去还回去（不还就撞 429）
  const onlineSession = useRef('');
  const [dlLoading, setDlLoading] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [dlError, setDlError] = useState('');
  /** 是不是「播放位满了」这种堵死型错误 —— 只有这种才给一键清空的入口 */
  const [busyStall, setBusyStall] = useState(false);
  /** 正在下第几集、到百分之几（原生下载报的，粒度到集） */
  const [saveEpProgress, setSaveEpProgress] = useState<{ ep: number; pct: number } | null>(null);
  const [cinema, setCinema] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const mediaFallback = useRef(false);
  const posRef = useRef({ pos: 0, dur: 0 });
  const lastRecord = useRef(0);

  const [autoNext, setAutoNext] = useState(() => {
    try { return localStorage.getItem(AUTONEXT_KEY) !== '0'; } catch { return true; }
  });

  // ── 电脑上已缓存的集（按剧名分桶）──
  const macByDrama = useMemo(() => {
    const map = new Map<string, { eps: number[]; total: number; dramaId: string }>();
    tasks.forEach((t) => {
      if (!t.playable || !t.dramaTitle) return;
      const cur = map.get(t.dramaTitle) || { eps: [] as number[], total: 0, dramaId: '' };
      cur.eps.push(t.episode);
      if (t.dramaId) cur.dramaId = t.dramaId;
      if ((t.total || 0) > cur.total) cur.total = t.total || 0;
      map.set(t.dramaTitle, cur);
    });
    map.forEach((v) => {
      v.eps.sort((a, b) => a - b);
      // task.total 实测是真实集数，比剧库列表里那个假的 episodeCount 靠谱
      if (v.total < v.eps[v.eps.length - 1]) v.total = v.eps[v.eps.length - 1];
    });
    return map;
  }, [tasks]);

  const epState = useCallback(
    (title: string, n: number): EpState => {
      const ph = findPhoneDrama(phoneList, title);
      if (ph?.episodes.some((e) => e.episode === n)) return 'phone';
      if ((macByDrama.get(title)?.eps || []).includes(n)) return 'mac';
      return 'none';
    },
    [phoneList, macByDrama]
  );

  /**
   * 当前这部剧能不能**在线**播（电脑上没这一集、靠电脑边下边播）。
   *
   * 这一个定义给**所有**地方用，别再各写各的 —— 这个项目里同一个问题
   * 一共写过三套标准，漏了两套，用户看到的现象是「有的集能点有的不能、
   * 而且没人说得清为什么」（2026-10-06 排查了一整晚的根因）：
   *   - 自动连播  onEnded        —— 早就有对的（st !== 'none' || (id && online)）
   *   - 选集抽屉  EpisodeDrawer   —— 10-06 改了
   *   - 播放页网格（用户实际点的那处）—— 10-06 漏了，onClick 还在挡着
   * 判据沿用自动连播那一套：epState 认不出来，但有剧 id + 连着电脑，
   * 就说明能走在线播放（文件在不在，和能不能看，是两件事）。
   */
  const canPlayOnline = !!picked?.id && online;
  /** 某一集能不能点：手机有 / 电脑有 / 能在线播，任一即可 */
  const canPlayEpisode = useCallback(
    (title: string, n: number) => {
      const d = picked;
      return epState(title, n) !== 'none' || (!!d?.id && online) || d?.origin === 'upload';
    },
    [epState, picked?.id, picked?.origin, online]
  );

  // ── 探活 + 拉数据 ──
  const reloadPhone = useCallback(async () => {
    const [list, u] = await Promise.all([listPhoneDramas(), phoneLibraryUsage()]);
    setPhoneList(list);
    setUsage(u);
  }, []);

  const refresh = useCallback(async () => {
    setChecking(true);
    setConnError('');
    const info = await pingRelay(addr);
    setOnline(info.online);
    setChecking(false);
    setKnown(getKnownRelays());

    if (addr.trim() && !info.online) {
      setConnError(
        '连不上电脑。先确认手机和电脑连的是同一个 WiFi，' +
          '再确认电脑上「短剧库」和「剧场转发」两个窗口都开着。'
      );
    }

    await reloadPhone();
    setWatch(listWatch());
    if (!info.online) {
      setLoadError('');
      setDramas([]);
      setTasks([]);
      setSources([]);
      setMacWatch([]);
      return;
    }
    setLoading(true);
    setLoadError('');

    /**
     * 先把上次开着没关的会话还回去，再拉数据。
     *
     * 短剧库的并发名额只有 4 个（playback_resources.go:39），而且闲置
     * **10 分钟**才回收（ui_playback.go:17）。正常退出会 close 掉，但 app
     * 被系统杀掉、来不及 close 的就赖在那儿了 —— 表现是「点首页的剧一直 429」，
     * 而干等十分钟自己就好了。
     *
     * 所以本地留一份开过的会话号（relayClient 的 theater_open_sessions），
     * 每次进剧场先把它们全关一遍。必须在 pingRelay 之后做：关会话要发请求给
     * 电脑，没连上电脑时发不出去，等下次进来再说。
     */
    reclaimStaleSessions();

    try {
      const [snap, ts, mw] = await Promise.all([
        fetchDramas(addr),
        fetchTasks(addr),
        fetchMacWatchHistory(addr).catch(() => [] as any[]),
      ]);
      setDramas(snap.items);
      setSources(snap.sources);
      // 默认站源是红果，万一这个库里没有红果（换了站源/数据被清），
      // 顶着个不存在的站源首页就是一片空白，认不出来为什么空 —— 退回全部。
      setSrcFilter((cur) => (snap.sources.some((s) => s.key === DEFAULT_SOURCE) ? cur : ''));
      setTasks(ts.filter((t) => t.playable));
      setMacWatch(mw);
    } catch (e: any) {
      setLoadError(e?.message || '拉数据失败');
    } finally {
      setLoading(false);
    }
  }, [addr, reloadPhone]);

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
    if (!q) return;
    if (!online) return addToast('还没连上电脑，搜不了', 'error');
    setSearching(true);
    setTab('home');
    setSearched(q);
    setVisible(PAGE);
    try {
      setSearchResults(await searchDramas(addr, q));
    } catch (e: any) {
      addToast(e?.message || '搜不到', 'error');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setSearched('');
    setSearchResults([]);
  };

  // 分类筛选：暮色 10-05 明确「图4中的分类删掉」。
  // 原来这行是按剧库的 categoryName 汇总（照抄网页版 library.js:106-117 的做法），
  // 但实际用起来「AI成人短剧」这类分类占了半屏，点进去内容也很杂，所以整条拿掉。
  // 站源筛选保留，分类不再是首页的筛选维度。

  useEffect(() => { setVisible(PAGE); }, [srcFilter, sortKey, tab, searched]);

  /**
   * 按一部剧算它到底多少集。**换剧时必须重算**，不然会带着上一部剧的值走。
   *
   * 真机 10-05 抓到的：用户先看了 39 集的那部，再从「正在追剧」点开一部自己
   * 上传的（只有 1 集），选集页标题写「共 39 集」、底下铺了 39 个格子，
   * 追剧记录里也被写成了 / 39。根因是 playEpisode 压根没碰 epTotal，
   * 而 epTotal 是个组件级 state，还停在上一部剧的值。
   */
  const guessTotal = useCallback((d: DramaRef): number => {
    const ph = findPhoneDrama(phoneList, d.title);
    const mac = macByDrama.get(d.title);
    return Math.max(
      ph?.episodes[ph.episodes.length - 1]?.episode || 0,
      mac?.eps[mac.eps.length - 1] || 0,
      mac?.total || 0,
      d.episodeHint || 0
    );
  }, [phoneList, macByDrama]);

  // ── 选集 ──
  // 集数不采信剧库列表里的 episodeCount —— 实测那个字段的值是 '1'，是假数据。
  // 三个来源按可信度排：手机本地集数 > task.total（实测真实）> playback/open 的 episodes 长度。
  const openEpisodes = async (incoming: DramaRef) => {
    /**
     * 进选集页前先把剧 id 补上。
     *
     * 「正在追剧」和「本地剧库」两处传进来的是 `id: ''`（原来的代码就是这么写的），
     * 于是 `canPlayOnline = !!picked.id && online` 判成否，选集页的集数全灰、
     * 一集都点不动 —— 用户 10-06 深夜实测就是这样。
     *
     * 两条补法：
     *   1. 新记的追剧条目自带 dramaId（watchHistory 里已加）
     *   2. 老条目没有，就按剧名在**已经拉到内存的剧库**里查一次
     *      （不是去网络搜，dramas 这会儿就在手上，10455 条全在）
     */
    let d = incoming;
    if (!d.id) {
      const hit = dramas.find((x) => x.title === d.title);
      if (hit?.id) {
        d = { ...d, id: hit.id };
        diag('按剧名补到了剧 id', { 剧: d.title, id: hit.id.slice(0, 22) });
      } else {
        diag('这部没找到剧 id（可能不是剧库里的剧）', { 剧: d.title });
      }
    }
    setPicked(d);
    const ph = findPhoneDrama(phoneList, d.title);
    const mac = macByDrama.get(d.title);
    const guess = Math.max(
      ph?.episodes[ph.episodes.length - 1]?.episode || 0,
      mac?.eps[mac.eps.length - 1] || 0,
      mac?.total || 0,
      // 剧库列表里的集数先拿来顶着，选集页不用干等一次网络往返。
      // 红果/罐罐/饭锅这三个站源这个值实测是真的（红果 2631 条里没有一条是 '1'）；
      // 黄豆 56%、大帝 100% 是 '1'，所以 mapDrama 里已经把 1 当「没给」丢掉了。
      d.episodeHint || 0
    );
    setEpTotal(guess);
    setCurrentEp(1);
    setPage('episodes');

    if (d.origin === 'upload') return;
    const id = d.id || mac?.dramaId;
    if (!id || !online) return;
    try {
      const r = await fetchEpisodes(addr, id);
      if (r.total) setEpTotal(r.total);
    } catch {
      // 问不到就先用本地已有的，最差也就只显示存过的那几集
    }
  };

  /**
   * 在线剧（电脑上没下载过的那些）—— 走短剧库的在线播放，边下边播。
   *
   * 之前没这条路，所以剧库首页刷出来的 10455 条剧一集都点不动。
   *
   * **会话必须还回去。** 短剧库每开一个 playback/open 占一个并发名额
   * （ui_playback.go:265，到上限回 429「同时播放数量已达上限」），第一版只
   * abort 了本地流、没通知短剧库，切几集就攒满名额，之后连开都开不出来。
   * 电脑上在播也占名额，所以会「电脑一播手机就 429」。
   */
  const closeOnline = useCallback(() => {
    onlineAbort.current?.abort();
    onlineAbort.current = null;
    onlineCleanup.current?.();
    onlineCleanup.current = null;
    if (onlineSession.current) {
      closeOnlinePlayback(onlineSession.current);
      onlineSession.current = '';
    }
  }, []);

  const loadOnline = useCallback(async (dramaId: string, episode: number) => {
    setDlLoading(true);
    setDlError('');
    setBusyStall(false);
    mediaFallback.current = false;

    // 上一条在线流连同它的会话一起收掉
    closeOnline();

    const ac = new AbortController();
    onlineAbort.current = ac;
    let session = '';
    diag('开始在线播放', { dramaId, ep: episode });
    try {
      const opened = await openOnlinePlayback(dramaId);
      diag('开会话成功', { session: opened.session.slice(0, 10), total: opened.total });
      if (ac.signal.aborted) {
        // 已经被切掉了，但会话已经开出来了，得还回去，不然白占一个名额
        closeOnlinePlayback(opened.session);
        return;
      }
      session = opened.session;
      onlineSession.current = opened.session;

      diag('开始取流');
      const r = await streamOnlineEpisode(session, episode, ac.signal);
      diag('取流成功', { mime: r.mime, src: r.url.slice(0, 24) });
      if (ac.signal.aborted) {
        r.cleanup();
        closeOnlinePlayback(session);
        return;
      }
      setSrcKind('online');
      setBlobEp(episode);
      onlineCleanup.current = r.cleanup;
      setBlobUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return r.url;
      });
      diag('已挂到播放器');
    } catch (e: any) {
      diag('失败', { 报错: String(e?.message || e), 有会话: !!session, 已中止: ac.signal.aborted });
      if (session) closeOnlinePlayback(session);
      if (ac.signal.aborted) return;
      onlineSession.current = '';
      setDlError(e?.message || '在线播不了这一集');
      // 只有「播放位满了」才给一键清空的入口。别的错误给也没用。
      setBusyStall(String(e?.message || '').includes('播放位满了'));
      setBlobUrl('');
    } finally {
      if (!ac.signal.aborted) setDlLoading(false);
    }
  }, [closeOnline, picked?.title]);

  /**
   * 「清空播放位」→ 再重试一次当前这一集。
   *
   * 名额只有 4 个且是全机共享的（电脑网页版在播也占一个），任何一个「忘了关的」
   * 就能把手机堵死。短剧库 2026-10-05 加了 `{"action":"closeAll"}`，这里接上。
   *
   * 只在用户点了之后才清 —— 会把电脑网页版正在看的也一起断掉，
   * 自动清等于擅自替用户关别人的播放。
   */
  const clearStallsAndRetry = useCallback(async () => {
    setBusyStall(false);
    const n = await clearAllOnlinePlayback();
    if (n <= 0) {
      addToast('清空播放位没成功，先看看电脑上短剧库是不是开着', 'error');
      return;
    }
    addToast(`清掉了 ${n} 个占着的播放位，正在重试`, 'info');
    if (picked?.id) loadOnline(picked.id, currentEp);
  }, [loadOnline, addToast, picked?.id, currentEp]);

  // ── 播放 ──
  const loadFromMac = useCallback(async (title: string, episode: number) => {
    setDlLoading(true);
    setDlError('');
    setDlProgress(0);
    mediaFallback.current = false;
    try {
      const r = await fetchVideoBlobUrl(title, episode, (loaded, total) => {
        setDlProgress(total ? loaded / total : 0);
      });
      setSrcKind('mac');
      setBlobEp(episode);
      setBlobUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return r.url;
      });
    } catch (e: any) {
      setDlError(e?.message || '取不到这一集');
      setBlobUrl('');
    } finally {
      setDlLoading(false);
    }
  }, []);

  /**
   * 手机里存着的集直接播本地文件。
   * file:// 在安卓 WebView 里偶尔会被内核拒（https 页面读本地文件），
   * 真拒了就退回「读成 base64 → Blob」，那条路一定通，代价是多占点内存。
   */
  const loadFromPhone = useCallback(async (title: string, episode: number) => {
    setDlLoading(true);
    setDlError('');
    mediaFallback.current = false;
    try {
      const ph = findPhoneDrama(phoneList, title);
      if (!ph) throw new Error('手机里没有这部剧');
      setSrcKind('phone');
      setBlobEp(episode);
      setBlobUrl(await phoneEpisodeUri(ph.key, episode));
    } catch (e: any) {
      setDlError(e?.message || '读不出手机里的文件');
      setBlobUrl('');
    } finally {
      setDlLoading(false);
    }
  }, [phoneList]);

  /**
   * 媒体报错了 —— 但**先别急着想它真的播不出来**。
   *
   * 真机 10-05 22:56 暮色给的图：屏幕上明明白白写着「这个本地地址播不了，
   * 换个方式再试…」，可同一集**其实在正常播**（另一张图里 1:11/1:11 走着）。
   * 也就是说 `error` 事件在安卓 WebView 上会误报 —— 换一个 src 时的中间态、
   * 或者 convertFileSrc 那个地址被内核先拒一次再自己重试成功，都会打 error。
   *
   * 所以这里**延迟判定**：报错先记下来，3 秒内如果 `canplay`/`playing` 来了，
   * 就当它没发生过（什么都不显示）；3 秒过去还是起不来，才真的告诉用户。
   * 用户看到「播不了」却发现它在播，比没提示更糟。
   */
  const mediaBroken = useRef(false);
  const mediaErrTimer = useRef<number | null>(null);

  const onMediaOk = useCallback(() => {
    mediaBroken.current = false;
    if (mediaErrTimer.current) { window.clearTimeout(mediaErrTimer.current); mediaErrTimer.current = null; }
  }, []);

  const onMediaError = useCallback(() => {
    if (srcKind !== 'phone') return;
    if (mediaBroken.current) return;
    mediaBroken.current = true;
    if (mediaErrTimer.current) window.clearTimeout(mediaErrTimer.current);
    mediaErrTimer.current = window.setTimeout(() => {
      if (mediaBroken.current) setDlError('这一集在手机里读不出来，重新下过一次可能就好');
    }, 3000);
  }, [srcKind]);

  // 换集就清掉上一集的判定：旧的那句「读不出来」不该挂到新的一集上
  useEffect(() => {
    if (mediaErrTimer.current) window.clearTimeout(mediaErrTimer.current);
    mediaErrTimer.current = null;
    mediaBroken.current = false;
  }, [blobUrl]);

  useEffect(() => () => {
    if (mediaErrTimer.current) window.clearTimeout(mediaErrTimer.current);
  }, []);

  /**
   * 播第 n 集。
   * drama 传进来是因为：从「本地剧库」「正在追剧」直接点播放时，
   * setPicked 要到下一次渲染才生效，这里闭包里的 picked 还是上一部剧，
   * 直接用就会播错剧。所以谁点的谁把剧名传进来。
   *
   * 换剧必须重算总集数：不重算的话 epTotal 会带着上一部剧的值走
   * （上传的单集剧会被显示成上一部剧的集数，见 guessTotal 的注释）。
   */
  const playEpisode = useCallback((n: number, drama?: DramaRef) => {
    const d = drama || picked;
    if (!d) return;
    // 切剧/切集先把手上的在线会话还回去，别占着短剧库的并发名额
    closeOnline();
    setPicked(d);
    setDrawer(false);
    setCinema(false);
    setCurrentEp(n);
    setCurDuration(0);
    setEpTotal(guessTotal(d));
    setPage('player');
    const st = epState(d.title, n);
    if (st === 'phone') loadFromPhone(d.title, n);
    else if (st === 'mac') loadFromMac(d.title, n);
    else if (d.id && online) loadOnline(d.id, n);
    else setDlError('这一集电脑上没有，手机上也没有');
  }, [picked, epState, loadFromPhone, loadFromMac, loadOnline, online, guessTotal, closeOnline]);

  // ── 观看记录 ──
  const recordWatch = useCallback((force = false) => {
    if (!picked) return;
    const { pos, dur } = posRef.current;
    if (!force && pos < 10) return; // 点开就退不算看过
    const now = Date.now();
    if (!force && now - lastRecord.current < 8000) return;
    lastRecord.current = now;
    // 总集数用当场重算的值，不吃 epTotal 那个可能带着上一部剧的残留
    const total = guessTotal(picked);
    upsertWatch({
      title: picked.title,
      // 存剧 id：从「正在追剧」回去时靠它才能走在线播放（见 watchHistory 的说明）
      dramaId: picked.id || undefined,
      coverUrl: picked.coverUrl,
      episode: currentEp,
      total,
      position: Math.round(pos),
      duration: Math.round(dur || curDuration),
      origin: picked.origin === 'upload' ? 'upload' : 'mac',
    });
    setWatch(listWatch());
  }, [picked, currentEp, curDuration, guessTotal]);

  // 离开剧场（含退到后台被系统回收）时把在线流收掉：
  // 不收的话那条转码长连接会一直挂着，手机上白白耗电耗流量。
  useEffect(() => {
    const stop = () => closeOnline();
    window.addEventListener('pagehide', stop);
    return () => {
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [closeOnline]);

  const onEnded = useCallback(() => {
    recordWatch(true);
    if (!autoNext) return;
    const next = currentEp + 1;
    // 下一集「在不在」按能不能播来判：手机有 / 电脑有 / 电脑上能在线取都算能接着播。
    // 之前只认手机和电脑，在线这条路（剧库首页那批剧）自动连播直接断在这儿。
    const d = picked;
    if (!d) return;
    // 用和网格同一套判据（canPlayEpisode），别再各写各的
    if (!canPlayEpisode(d.title, next)) return;
    playEpisode(next);
  }, [autoNext, currentEp, picked, playEpisode, recordWatch, canPlayEpisode]);

  // ── 存到手机 ──
  // 单集保存的活儿原来在播放页（saveCurrent / saveOne），暮色 10-05 明确
  // 「播放页那个保存和连带的删除一起全都删了，保存只留选集页那一个入口」，
  // 所以这两段连同 savingOne / saveProgress 一起清掉了。批量下载走 downloadEps。
  const delPhoneEp = async (d: DramaRef, ep: number) => {
    const ph = findPhoneDrama(phoneList, d.title);
    if (!ph) return;
    await deletePhoneEpisode(ph.key, ep);
    await reloadPhone();
    addToast(`第 ${ep} 集已从手机删掉`, 'success');
  };

  /**
   * 下载一批集到手机。
   *
   * 暮色 10-05：点「下载到手机」先弹选择窗，可以手输区间（2-20）、全选、全不选，
   * 全选就是整部。所以这里收的是**具体要哪几集**，不是「全部」。
   * 已经在手机里的集默认不勾（macOnly），省得白下一遍。
   */
  const downloadEps = async (d: DramaRef, eps: number[]) => {
    if (!online) return addToast('还没连上电脑，先连上才能下载', 'error');
    if (!eps.length) return addToast('一集都没勾', 'info');

    setSaveAll({ busy: true, done: 0, total: eps.length, cancel: false });
    saveAllCancel.current = false;
    let ok = 0;
    for (const ep of eps) {
      if (saveAllCancel.current) break;
      try {
        // 走原生下载（原来取回内存再转 base64 写进去，真机 22:30 一集就闪退：
        // Java 侧拼 74 MB 字符串把 256 MB 上限穿顶，日志见 localVideos 里的注释）
        await downloadEpisodeToPhone(
          localVideoUrl(addr, d.title, ep),
          { title: d.title, coverUrl: d.coverUrl, origin: 'mac' },
          ep,
          (loaded, total) => {
            if (total > 0) setSaveEpProgress({ ep, pct: loaded / total });
          }
        );
        ok += 1;
        setSaveAll((s) => ({ ...s, done: s.done + 1 }));
      } catch (e: any) {
        addToast(`第 ${ep} 集没存成：${e?.message || '取不到'}`, 'error');
      }
    }
    setSaveEpProgress(null);
    await reloadPhone();
    saveAllCancel.current = false;
    setSaveAll({ busy: false, done: 0, total: 0, cancel: false });
    if (ok) addToast(`存了 ${ok} 集进手机，存完就跟电脑无关了`, 'success');
  };

  /**
   * 打开下载选择窗，默认勾上电脑上所有还没下到手机的集（=「全选就是整部」）。
   * avgBytes 拿手机里已存集的平均大小当参照：转发服务不吐单集真实大小，
   * 用实测值估比不给数字强。
   */
  const openDownloadPicker = (d: DramaRef) => {
    const mac = macByDrama.get(d.title);
    if (!mac) return addToast('电脑上还没有这部剧', 'error');
    const avail = mac.eps.filter((n) => epState(d.title, n) !== 'phone');
    if (!avail.length) return addToast('电脑上有的集都已经在手机里了', 'info');
    setDlPick({ title: d.title, avail });
    setDlChecked(new Set(avail));
    setDlRange('');
  };

  const toggleDlEp = (n: number) => {
    setDlChecked((old) => {
      const next = new Set(old);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  /** 手输区间：「2-20」「2」「5-」都认，认不出来就当没输 */
  const applyDlRange = () => {
    if (!dlPick) return;
    const s = dlRange.trim().replace(/\s/g, '');
    if (!s) return;
    let a = 0;
    let b = 0;
    if (/^\d+$/.test(s)) {
      a = b = Number(s);
    } else {
      const m = s.match(/^(\d*)-(\d*)$/);
      if (!m) return addToast('看不懂这个区间，写成 2-20 这样', 'error');
      a = m[1] ? Number(m[1]) : dlPick.avail[0];
      b = m[2] ? Number(m[2]) : dlPick.avail[dlPick.avail.length - 1];
    }
    if (a > b) [a, b] = [b, a];
    const inRange = dlPick.avail.filter((n) => n >= a && n <= b);
    if (!inRange.length) return addToast(`${a}-${b} 这段里电脑上没有`, 'info');
    setDlChecked(new Set(inRange));
    addToast(`选中了 ${inRange.length} 集`, 'info');
  };

  /** 体积参照：手机里已存集的平均单集大小（转发服务不吐单集真实大小，只能这么估） */
  const avgPhoneEpBytes = useMemo(() => {
    let bytes = 0;
    let n = 0;
    phoneList.forEach((d) =>
      d.episodes.forEach((e) => {
        if (e.size > 0) {
          bytes += e.size;
          n += 1;
        }
      })
    );
    return n > 0 ? Math.round(bytes / n) : 0;
  }, [phoneList]);

  // ── 上传 ──
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setPending(files);
    setPendingName(files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '我传的短剧');
  };

  const doUpload = async () => {
    if (!pending.length) return;
    setUploading(true);
    try {
      const d = await saveUploads(pending, { name: pendingName });
      await reloadPhone();
      setPending([]);
      addToast(`《${d.title}》${d.episodes.length} 集已存进手机`, 'success');
    } catch (e: any) {
      addToast(e?.message || '传不进去', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── 剧库首页数据 ──
  const homeItems = useMemo(() => {
    let list = searched.length ? searchResults : dramas;
    if (srcFilter) list = list.filter((d) => d.source === srcFilter);
    const sorted = [...list];
    if (!searched.length) {
      if (sortKey === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
      else if (sortKey === 'newest' || sortKey === 'oldest') {
        // 剧库实测有真的上线日期（onlineDate: "2026-10-05"，10444 条里 5001 条有）。
        // 没日期的排最后，别混在有日期的中间看着像刚上线的。
        sorted.sort((a, b) => {
          const x = a.onlineDate || '', y = b.onlineDate || '';
          if (!x && !y) return 0;
          if (!x) return 1;
          if (!y) return -1;
          return sortKey === 'newest' ? (x < y ? 1 : x > y ? -1 : 0) : x < y ? -1 : x > y ? 1 : 0;
        });
      }
    }
    return sorted;
  }, [dramas, searchResults, searched, srcFilter, sortKey]);

  const macItems = useMemo<DramaRef[]>(() => {
    const out: DramaRef[] = [];
    macByDrama.forEach((v, title) => {
      const cover = dramas.find((d) => d.title === title)?.coverUrl;
      out.push({ id: v.dramaId, title, coverUrl: cover, origin: 'mac' });
    });
    return out.sort((a, b) => (macByDrama.get(b.title)?.eps.length || 0) - (macByDrama.get(a.title)?.eps.length || 0));
  }, [macByDrama, dramas]);

  const watchItems = useMemo(() => {
    const local = watch.map((w) => ({ ...w, from: 'phone' as const }));
    const mac = macWatch
      .filter((e) => e?.title && !local.some((l) => l.title === e.title))
      .map((e) => ({
        title: e.title,
        coverUrl: (dramas.find((d) => d.title === e.title)?.coverUrl) as string | undefined,
        episode: e.index || 1,
        total: e.total || 0,
        position: e.position || 0,
        duration: e.duration || 0,
        origin: 'mac-history' as const,
        watchedAt: e.watchedAt ? Date.parse(e.watchedAt) || 0 : 0,
        from: 'mac' as const,
      }));
    return [...local, ...mac].sort((a, b) => b.watchedAt - a.watchedAt);
  }, [watch, macWatch, dramas]);

  // 滚到底就再放一批，暮色说的「可以翻看都有什么」
  const onHomeScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
      setVisible((v) => (v < homeItems.length ? v + PAGE : v));
    }
  };

  // ═══════════════ 渲染零件 ═══════════════

  const TopBar: React.FC<{ title: string; onBack?: () => void; right?: React.ReactNode; center?: boolean }> = ({
    title, onBack, right, center,
  }) => (
    <div className={`shrink-0 flex items-center gap-3 px-4 py-3 backdrop-blur-xl border-b border-white/40 ${p.bar}`}>
      {onBack
        ? <button onClick={onBack} className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-white/70'}`}>
            <ArrowLeft size={18} weight="bold" className={p.title} />
          </button>
        : <div className="shrink-0 w-9" />}
      <h1 className={`flex-1 ${center === false ? '' : 'text-center'} text-base font-bold truncate ${p.title}`}>{title}</h1>
      {right || <div className="shrink-0 w-9" />}
    </div>
  );

  const Grid: React.FC<{ items: any[]; onOpen: (it: any) => void }> = ({ items, onOpen }) => (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map((it) => (
        <div key={it.key} onClick={() => onOpen(it)} className="cursor-pointer min-w-0 active:scale-95 transition-transform">
          <div className={`relative w-full aspect-[3/4] rounded-xl overflow-hidden ${p.night ? 'bg-[#1e293b]' : 'bg-slate-200'}`}>
            {it.cover ? (
              <img src={it.cover} className="w-full h-full object-cover pointer-events-none" alt={it.title} />
            ) : (
              <div className={`w-full h-full flex items-center justify-center ${p.night ? 'text-slate-600' : 'text-slate-300'}`}>
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
          <h3 className={`mt-1.5 text-[11px] font-bold truncate ${p.title}`}>{it.title}</h3>
          <p className={`text-[9.5px] truncate ${p.sub}`}>{it.sub}</p>
        </div>
      ))}
    </div>
  );

  const Empty: React.FC<{ text: string }> = ({ text }) => (
    <div className={`text-center text-xs py-10 whitespace-pre-line leading-relaxed ${p.sub}`}>{text}</div>
  );

  const SectionCard: React.FC<{ title?: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
    <div className={`rounded-3xl p-5 ${p.card}`}>
      {title && <h3 className={`text-sm font-bold ${p.title}`}>{title}</h3>}
      {desc && <p className={`mt-1.5 text-[11px] leading-relaxed ${p.sub}`}>{desc}</p>}
      <div className={title || desc ? 'mt-3' : ''}>{children}</div>
    </div>
  );

  // ═══════════ 页面 1：列表 ═══════════
  if (page === 'list') {
    const homeList = homeItems.slice(0, visible);

    return (
      <div className={`absolute inset-0 flex flex-col ${p.page}`}>
        <TopBar title="剧场" right={
          <button onClick={() => setPage('settings')} className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-white/70'}`}>
            <GearSix size={18} className={p.sub} />
          </button>
        } />

        {/* 没连上电脑：先给个能填的地址 */}
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
          <div className={`flex items-center gap-2 rounded-full px-4 py-2.5 ${p.night ? 'bg-[#1e293b]' : 'bg-slate-100/80'}`}>
            <MagnifyingGlass size={16} className={`shrink-0 ${p.sub}`} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="找剧名"
              className={`flex-1 bg-transparent text-sm outline-none ${p.title} ${p.night ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'}`}
            />
            {query && (
              <button onClick={query.trim() ? doSearch : clearSearch} disabled={!online || searching} className="shrink-0">
                <Pill primary>{searching ? '搜着…' : '搜'}</Pill>
              </button>
            )}
          </div>
        </div>

        {/* 四个页签 —— 暮色 10-05 定的语义 */}
        <div className={`px-4 mt-3 shrink-0 flex gap-1 rounded-full p-1 ${p.night ? 'bg-[#1e293b]' : 'bg-slate-100/80'}`}>
          {([['home', '剧库首页'], ['mac', '缓存剧库'], ['phone', '本地剧库'], ['watch', '正在追剧']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-2 rounded-full text-[11px] font-bold transition ${tab === k ? p.chipOn : p.chip}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div ref={scrollRef} onScroll={onHomeScroll} className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {online && loading && <div className={`text-center text-xs py-10 ${p.sub}`}>正在读剧库…</div>}
          {online && !loading && loadError && <div className={`text-center text-xs py-10 ${p.sub}`}>{loadError}</div>}

          {/* ── 剧库首页 ── */}
          {!loading && tab === 'home' && (
            <>
              {searched && (
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[11px] ${p.sub}`}>搜「{searched}」的结果 · {searchResults.length} 部</span>
                  <button onClick={clearSearch} className="text-[11px] text-sky-500">清掉</button>
                </div>
              )}

              {!searched && online && sources.length > 0 && (
                <>
                  <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
                    <button
                      onClick={() => setSrcFilter('')}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${srcFilter === '' ? p.chipOn : p.chip}`}
                    >
                      全部站源
                    </button>
                    {sources.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setSrcFilter(srcFilter === s.key ? '' : s.key)}
                        className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${srcFilter === s.key ? p.chipOn : p.chip}`}
                      >
                        {s.name} {s.count}
                      </button>
                    ))}
                  </div>
                  {!searched && (                    <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
                      {[['default', '默认'], ['newest', '最新'], ['oldest', '最早'], ['title', '剧名']].map(([k, label]) => (
                        <button
                          key={k}
                          onClick={() => setSortKey(k)}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] ${sortKey === k ? `font-bold ${p.title}` : p.sub}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {online && homeList.length === 0 && <Empty text={searched ? '没搜到' : '这个筛选下没有剧'} />}
              {online && homeList.length > 0 && (
                <Grid
                  items={homeList.map((d) => ({
                    key: d.id,
                    title: d.title,
                    cover: d.coverUrl,
                    sub: d.source ? sourceName(d.source) : '',
                    badge: { tone: 'no' as const, text: d.source ? sourceName(d.source) : '剧' },
                    ref: d,
                  }))}
                  onOpen={(it) => openEpisodes({
                    id: it.ref.id,
                    title: it.ref.title,
                    coverUrl: it.ref.coverUrl,
                    origin: 'mac',
                    episodeHint: it.ref.episodeHint,
                  })}
                />
              )}
              {online && visible < homeItems.length && (
                <div className="text-center text-[11px] text-slate-300 py-4">往下划继续看 · 还有 {homeItems.length - visible} 部</div>
              )}
            </>
          )}

          {/* ── 缓存剧库（电脑上的）── */}
          {!loading && tab === 'mac' && (
            <>
              {!online && <Empty text="没连上电脑看不到缓存" />}
              {online && macItems.length === 0 && <Empty text="短剧库里还没有下载好的剧" />}
              {online && macItems.length > 0 && (
                <>
                  <div className={`text-[11px] mb-3 text-center ${p.sub}`}>
                    电脑上缓存了 {macItems.length} 部 · 这些要连着电脑才看得成
                  </div>
                  <Grid
                    items={macItems.map((d) => {
                      const mac = macByDrama.get(d.title)!;
                      const ph = findPhoneDrama(phoneList, d.title);
                      return {
                        key: d.title,
                        title: d.title,
                        cover: d.coverUrl,
                        sub: `电脑 ${mac.eps.length} 集${ph ? ` · 手机 ${ph.episodes.length} 集` : ''}`,
                        badge: ph ? { tone: 'ok' as const, text: `手机 ${ph.episodes.length}` } : { tone: 'mac' as const, text: `电脑 ${mac.eps.length}` },
                        ref: d,
                      };
                    })}
                    onOpen={(it) => openEpisodes(it.ref)}
                  />
                </>
              )}
            </>
          )}

          {/* ── 本地剧库（手机里的）── */}
          {!loading && tab === 'phone' && (
            <>
              <input ref={fileRef} type="file" accept="video/*" multiple className="hidden"
                onChange={onPickFiles} />

              <div className={`rounded-3xl p-4 mb-3 ${p.card}`}>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="shrink-0 flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-2.5 text-xs font-bold text-white active:scale-95"
                  >
                    <UploadSimple size={14} />
                    传视频
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-bold ${p.title}`}>
                      手机里 {usage.dramas} 部 · {usage.count} 集
                    </p>
                    <p className={`text-[10px] mt-0.5 ${p.sub}`}>占了 {fmtBytes(usage.bytes)}</p>
                  </div>
                  {usage.dramas > 0 && (
                    <button
                      onClick={async () => {
                        await clearPhoneLibrary();
                        await reloadPhone();
                        addToast('手机里的剧全清掉了', 'success');
                      }}
                      className="shrink-0 flex items-center gap-1 rounded-full bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-500 active:scale-95"
                    >
                      <Trash size={12} />
                      全清
                    </button>
                  )}
                </div>
                <p className={`text-[10px] mt-2.5 leading-relaxed ${p.sub}`}>
                  传上来的和从电脑存过来的都放这儿，跟电脑断开了也照样能看。
                </p>
              </div>

              {phoneList.length === 0 && <Empty text="手机里还没有剧，先从电脑上存几集过来" />}
              {phoneList.length > 0 && (
                <div className="space-y-2.5">
                  {phoneList.map((d) => {
                    const size = d.episodes.reduce((a, e) => a + (e.size || 0), 0);
                    const open = expandedPhone === d.key;
                    return (
                      <div key={d.key} className={`rounded-3xl p-4 ${p.card}`}>
                        <div className="flex items-center gap-3">
                          <div
                            onClick={() => openEpisodes({ id: '', title: d.title, coverUrl: d.coverUrl, origin: d.origin })}
                            className="shrink-0 w-14 h-[4.2rem] rounded-xl overflow-hidden flex items-center justify-center cursor-pointer active:scale-95"
                            style={{ background: d.coverUrl ? undefined : (p.night ? '#0f172a' : '#f1f5f9') }}
                          >
                            {d.coverUrl
                              ? <img src={d.coverUrl} className="w-full h-full object-cover" alt="" />
                              : <FilmSlate size={20} className={p.faint} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className={`text-xs font-bold truncate ${p.title}`}>{d.title}</h3>
                            <p className={`text-[10px] mt-1 ${p.sub}`}>
                              {d.episodes.length} 集 · {fmtBytes(size)} · {d.origin === 'upload' ? '本地上传' : '从电脑存的'}
                            </p>
                            <div className="flex gap-1.5 mt-2">
                              <button
                                onClick={() => playEpisode(d.episodes[0]?.episode || 1, { id: '', title: d.title, coverUrl: d.coverUrl, origin: d.origin })}
                                className="rounded-full bg-sky-500 px-3 py-1 text-[10px] font-bold text-white active:scale-95"
                              >
                                从第 1 集看
                              </button>
                              <button
                                onClick={() => setExpandedPhone(open ? '' : d.key)}
                                className={`rounded-full px-3 py-1 text-[10px] font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-200' : 'bg-slate-100 text-slate-500'}`}
                              >
                                {open ? '收起' : '看集数'}
                              </button>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              await deletePhoneDrama(d.key);
                              await reloadPhone();
                              addToast(`《${d.title}》已从手机删掉`, 'success');
                            }}
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center active:scale-90"
                            style={{ background: p.night ? '#334155' : '#fff1f2' }}
                          >
                            <Trash size={14} className="text-rose-400" />
                          </button>
                        </div>

                        {open && (
                          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-5 gap-2">
                            {d.episodes.map((e) => (
                              <div key={e.episode} className="relative">
                                <button
                                  onClick={() => playEpisode(e.episode)}
                                  className="w-full aspect-square rounded-xl bg-emerald-50 text-emerald-600 text-xs font-bold active:scale-95"
                                >
                                  {e.episode}
                                </button>
                                <button
                                  onClick={async () => {
                                    await deletePhoneEpisode(d.key, e.episode);
                                    await reloadPhone();
                                  }}
                                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center active:scale-90"
                                >
                                  <X size={10} className="text-rose-400" />
                                </button>
                                <p className="text-[8px] text-center mt-0.5 text-slate-300">{fmtBytes(e.size)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── 正在追剧 ── */}
          {!loading && tab === 'watch' && (
            <>
              {watchItems.length > 0 && (
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[11px] ${p.sub}`}>看过 {watchItems.length} 部</span>
                  <button
                    onClick={async () => {
                      clearWatch();
                      setWatch(listWatch());
                      addToast('追剧记录清空了', 'success');
                    }}
                    className="text-[11px] text-slate-300"
                  >
                    清空记录
                  </button>
                </div>
              )}
              {watchItems.length === 0 && <Empty text="还没看过剧\n看过的会自动记在这儿" />}
              {watchItems.length > 0 && (
                <div className="space-y-2.5">
                  {watchItems.map((w: any) => {
                    const pct = w.duration > 0 ? Math.min(100, Math.round((w.position / w.duration) * 100)) : 0;
                    // 存下来的 total 可能是错的：playEpisode 那时候没重算集数，
                    // 会把上一部剧的集数写进来（真机 10-05 抓到两个自己上传的单集剧
                    // 被记成「/ 39」）。这里只认当场算的，算不出来才退回存的。
                    const wTotal = guessTotal({ id: '', title: w.title, coverUrl: w.coverUrl, origin: 'mac' }) || w.total;
                    return (
                      <div key={w.title} className={`rounded-3xl p-3 flex items-center gap-3 ${p.card}`}>
                        <div
                          onClick={() => openEpisodes({ id: '', title: w.title, coverUrl: w.coverUrl, origin: 'mac' })}
                          className="shrink-0 w-12 h-16 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer active:scale-95"
                          style={{ background: p.night ? '#0f172a' : '#f1f5f9' }}
                        >
                          {w.coverUrl
                            ? <img src={w.coverUrl} className="w-full h-full object-cover" alt="" />
                            : <FilmSlate size={18} className={p.faint} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className={`text-xs font-bold truncate ${p.title}`}>{w.title}</h3>
                          <p className={`text-[10px] mt-1 ${p.sub}`}>
                            看到第 {w.episode} 集{wTotal ? ` / ${wTotal}` : ''}
                            {pct > 0 ? ` · ${pct}%` : ''}
                            {w.from === 'mac' ? ' · 电脑上看的' : ''}
                          </p>
                          <div className={`h-1 rounded-full mt-1.5 overflow-hidden ${p.night ? 'bg-[#334155]' : 'bg-slate-100'}`}>
                            <div className="h-full bg-sky-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <button
                          onClick={() => playEpisode(w.episode, { id: '', title: w.title, coverUrl: w.coverUrl, origin: 'mac' })}
                          className="shrink-0 rounded-full bg-sky-500 px-3.5 py-2 text-[11px] font-bold text-white active:scale-95"
                        >
                          接着看
                        </button>
                        <button
                          onClick={async () => {
                            removeWatch(w.title);
                            setWatch(listWatch());
                          }}
                          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center active:scale-90"
                          style={{ background: p.night ? '#334155' : '#f8fafc' }}
                        >
                          <X size={12} className={p.sub} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* 上传弹窗原来只写在「设置」那个分支里（页面 4 的 return），
            列表页点「传视频」时那段 JSX 根本不会渲染 —— 数据存进去了但弹窗不出现，
            要等用户绕进设置页那个分支，弹窗才突然跳出来。真机 10-05 反馈。
            Modal 自己 createPortal 到 body，所以挂哪个分支都能显示，
            但必须**每个可能触发上传的分支都挂一份**。这里是本地剧库，唯一的上传入口。 */}
        <UploadModal
          p={p}
          files={pending}
          name={pendingName}
          setName={setPendingName}
          uploading={uploading}
          onCancel={() => setPending([])}
          onConfirm={doUpload}
        />
      </div>
    );
  }

  // ═══════════ 页面 2：选集 ═══════════
  if (page === 'episodes' && picked) {
    const mac = macByDrama.get(picked.title);
    const macEps = mac?.eps || [];
    const ph = findPhoneDrama(phoneList, picked.title);
    const phoneEps = ph?.episodes.map((e) => e.episode) || [];
    const total = Math.max(epTotal, macEps[macEps.length - 1] || 0, phoneEps[phoneEps.length - 1] || 0);
    const macOnly = macEps.filter((n) => !phoneEps.includes(n));

    return (
      <div className={`absolute inset-0 flex flex-col ${p.page}`}>
        <TopBar title={picked.title} onBack={() => setPage('list')} />

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {/* 头：封面 + 三个状态说清楚 */}
          <div className="flex gap-3">
            <div className="w-20 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center" style={{ height: '6.7rem', background: p.night ? '#0f172a' : '#e2e8f0' }}>
              {picked.coverUrl && <img src={picked.coverUrl} className="w-full h-full object-cover" alt="" />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className={`text-sm font-bold leading-snug ${p.title}`}>{picked.title}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {phoneEps.length > 0 && <Tag tone="ok">手机 {phoneEps.length} 集</Tag>}
                {macEps.length > 0 && <Tag tone="mac">电脑 {macEps.length} 集</Tag>}
                {total > 0 && <Tag tone="no">共 {total} 集</Tag>}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                {macOnly.length > 0 ? (
                  <Pill primary tone={p} onClick={() => openDownloadPicker(picked)} disabled={!online || saveAll.busy}>
                    {saveAll.busy ? `下载着 ${saveAll.done}/${saveAll.total}` : `下载到手机（${macOnly.length}）`}
                  </Pill>
                ) : macEps.length > 0 ? (
                  /* 电脑上有的都已在手机 —— 这句只在真缓存过的时候才准 */
                  <Pill tone={p} disabled>电脑上有的都已在手机</Pill>
                ) : (
                  /* 电脑上没缓存这部：能在线看，但没法「下载到手机」
                     —— 下载走的是电脑上的文件，电脑没文件就没什么可下载的。
                     这句要跟用户说清楚，不然会以为整部都看不了。 */
                  <Pill tone={p} disabled>电脑没存 · 在线看</Pill>
                )}
                {phoneEps.length > 0 && (
                  <Pill
                    tone={p}
                    onClick={async () => {
                      await deletePhoneDrama(dramaKey(picked.title));
                      await reloadPhone();
                      addToast('这部已从手机删掉', 'success');
                    }}
                  >
                    删除下载
                  </Pill>
                )}
              </div>
              {saveAll.busy && (
                <div className="mt-2 flex items-center gap-2">
                  <div className={`flex-1 h-1 rounded-full overflow-hidden ${p.night ? 'bg-[#334155]' : 'bg-slate-100'}`}>
                    {/* 集内的字节进度也算进去，不然一集十几 MB、
                        整条进度条从头到尾纹丝不动，看着像卡死了 */}
                    <div
                      className="h-full bg-sky-400 rounded-full transition-all"
                      style={{ width: `${saveAll.total ? Math.min(100, ((saveAll.done + (saveEpProgress?.pct || 0)) / saveAll.total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">
                    {saveEpProgress ? `第 ${saveEpProgress.ep} 集 ${Math.round(saveEpProgress.pct * 100)}%` : `${saveAll.done}/${saveAll.total}`}
                  </span>
                  <button onClick={() => { saveAllCancel.current = true; }} className="shrink-0 text-[10px] text-rose-400">停</button>
                </div>
              )}
            </div>
          </div>

          {/* 集数网格：暮色定：选集页不显示简介 */}
          <div className="mt-5">
            <div className="flex items-center gap-3 text-[10px] text-slate-400">
              <span className="flex items-center gap-1"><DeviceMobile size={11} className="text-emerald-500" />手机里</span>
              <span className="flex items-center gap-1"><HardDrive size={11} className="text-sky-500" />电脑里</span>
              {canPlayOnline ? (
                <span className="flex items-center gap-1"><CloudArrowDown size={11} className="text-violet-400" />在线看</span>
              ) : (
                <span className="flex items-center gap-1">
                  <CloudSlash size={11} className="text-slate-300" />
                  {!online ? '没连上电脑' : '没认出来这部剧'}
                </span>
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-5 gap-2">
              {Array.from({ length: Math.max(total, 1) }, (_, i) => i + 1).map((n) => {
                const st = epState(picked.title, n);
                const cur = n === currentEp;
                // 正在播的那一集：格子本身照常按「在不在手机里」上色（绿/蓝/灰），
                // 正在播这件事改成右上角一个小播放键表示。
                // 原来是把整格刷成蓝色，结果「这一集已经在手机里」这个信息
                // 被高亮盖掉了，跟上面的图例对不上（暮色 10-05 提的）。
                return (
                  <button
                    key={n}
                    onClick={() => canPlayEpisode(picked.title, n) && playEpisode(n)}
                    disabled={!canPlayEpisode(picked.title, n)}
                    className={`relative aspect-square rounded-xl text-xs font-bold transition active:scale-95 ${
                      st === 'phone'
                        ? 'bg-emerald-50 text-emerald-600'
                        : st === 'mac'
                        ? 'bg-sky-50 text-sky-600'
                        // 文件不在但能在线播：不能还用那个灰 —— 看着就像点不动
                        : canPlayOnline
                        ? 'bg-violet-50 text-violet-500'
                        : p.night
                        ? 'bg-[#1e293b] text-slate-600'
                        : 'bg-slate-100 text-slate-300'
                    }`}
                  >
                    {n}
                    {cur && (
                      <span
                        className="absolute top-0.5 right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-sky-500 text-white"
                        title="正在播这一集"
                      >
                        <Play size={8} weight="fill" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <p className={`mt-5 text-[10px] leading-relaxed ${p.sub}`}>
            绿的是真躺在手机里的（断网也能看），蓝的还得连电脑。<br />
            下载到手机的这一步是真的写进手机，不是排在电脑的下载队列里。
          </p>
        </div>

        <DownloadPicker
          p={p}
          title={dlPick?.title || ''}
          avail={dlPick?.avail || []}
          checked={dlChecked}
          range={dlRange}
          setRange={setDlRange}
          avgBytes={avgPhoneEpBytes}
          onToggle={toggleDlEp}
          onApplyRange={applyDlRange}
          onAll={() => dlPick && setDlChecked(new Set(dlPick.avail))}
          onNone={() => setDlChecked(new Set())}
          onClose={() => setDlPick(null)}
          onConfirm={async () => {
            const d = picked;
            const eps = Array.from(dlChecked).sort((a, b) => a - b);
            setDlPick(null);
            await downloadEps(d, eps);
          }}
        />
      </div>
    );
  }

  // ═══════════ 页面 3：播放 ═══════════
  if (page === 'player' && picked) {
    const st = epState(picked.title, currentEp);
    const phoneEp = findPhoneDrama(phoneList, picked.title)?.episodes.find((e) => e.episode === currentEp);
    // 「下一集」可不可点：在线能取也算能接着播
    const nextStRaw = epState(picked.title, currentEp + 1);
    const nextSt = nextStRaw === 'none' && (picked.id && online) ? 'mac' : nextStRaw;

    return (
      <div className={`absolute inset-0 flex flex-col ${night ? 'bg-[#0f172a]' : 'bg-white'}`}>
        <TopBar
          title={picked.title}
          onBack={() => { recordWatch(true); setPage('episodes'); }}
          right={
            <button
              onClick={() => setDrawer(true)}
              className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-white/70'}`}
              title="选集"
            >
              <FilmSlate size={17} className={p.sub} />
            </button>
          }
        />

        <PlayerStage
          src={blobUrl}
          episode={currentEp}
          title={picked.title}
          cinema={cinema}
          setCinema={setCinema}
          onEnded={onEnded}
          onTime={(pos, dur) => { posRef.current = { pos, dur }; if (dur) setCurDuration(dur); recordWatch(); }}
          loading={dlLoading}
          loadProgress={dlProgress}
          error={dlError}
          onRetry={() => (st === 'phone' ? loadFromPhone(picked.title, currentEp) : loadFromMac(picked.title, currentEp))}
          onClearAll={busyStall ? clearStallsAndRetry : undefined}
          hasNext={nextSt !== 'none'}
          onNext={() => playEpisode(currentEp + 1)}
          onMediaError={onMediaError}
          onMediaReady={onMediaOk}
          p={p}
        />

        {/* 这一集到底存没存 —— 只做显示。
            暮色 10-05 明确「播放页的『把这一集存到手机』和这个功能连带的
            『从手机删掉』一起全都删了」：下载只留在选集页那一个入口，
            删也只从选集页删，播放页不再提供这两个动作。 */}
        <div className={`shrink-0 px-4 py-2.5 flex items-center gap-2 flex-wrap border-b ${p.line}`}>
          {st === 'phone' ? (
            <Tag tone="ok">已存手机 {fmtBytes(phoneEp?.size || 0)}</Tag>
          ) : st === 'mac' ? (
            <Tag tone="mac">在电脑里</Tag>
          ) : srcKind === 'online' ? (
            <Tag tone="mac">在线播，电脑上没这集</Tag>
          ) : (
            <Tag tone="no">这一集还没有</Tag>
          )}

          <div className="flex-1" />

          <button
            onClick={() => {
              const v = !autoNext;
              setAutoNext(v);
              try { localStorage.setItem(AUTONEXT_KEY, v ? '1' : '0'); } catch {}
            }}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold active:scale-95 ${autoNext ? 'bg-emerald-50 text-emerald-600' : p.night ? 'bg-[#334155] text-slate-400' : 'bg-slate-100 text-slate-400'}`}
          >
            <Sparkle size={11} />
            自动连播 {autoNext ? '开' : '关'}
          </button>
        </div>

        {/* 聊天区：第 2 步接 live */}
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3">
          <div className="h-full flex flex-col items-center justify-center text-center">
            <FilmSlate size={30} className={p.faint} />
            <p className={`mt-2 text-[11px] ${p.faint}`}>
              {char ? `这里会放跟${char.name}聊天的框` : '这里会放聊天的框'}
            </p>
            <p className={`mt-1 text-[10px] ${p.faint}`}>第 2 步才接上</p>
          </div>
        </div>

        {/* 输入框（第 2 步才通）*/}
        <div className={`shrink-0 px-4 py-3 border-t ${p.line}`}>
          <div className={`flex items-center gap-2 rounded-full px-4 py-2.5 ${p.night ? 'bg-[#1e293b]' : 'bg-slate-100'}`}>
            <input
              disabled
              placeholder="说点什么…"
              className={`flex-1 bg-transparent text-sm outline-none ${p.night ? 'text-slate-500' : 'text-slate-400'}`}
            />
          </div>
        </div>

        <EpisodeDrawer
          open={drawer}
          onClose={() => setDrawer(false)}
          title={picked.title}
          total={Math.max(epTotal, macByDrama.get(picked.title)?.total || 0)}
          current={currentEp}
          stateOf={(n) => epState(picked.title, n)}
          canPlayOnline={!!picked.id && online}
          onlineBlockedReason={!online ? '没连上电脑' : !picked.id ? '没认出来这部剧' : ''}
          onPick={(n) => playEpisode(n)}
          onDeletePhone={(n) => delPhoneEp(picked, n)}
          onOpenSettings={() => { setDrawer(false); setPage('settings'); }}
          p={p}
          savingAll={saveAll.busy}
        />
      </div>
    );
  }

  // ═══════════ 页面 4：设置 ═══════════
  return (
    <div className={`absolute inset-0 flex flex-col ${p.page}`}>
      <TopBar title="剧场设置" onBack={() => setPage('list')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3">
        <SectionCard title="夜间模式" desc="只在剧场里换皮，不动其他 app。默认跟着手机系统的深浅色走。">
          <div className={`flex gap-1 rounded-full p-1 ${p.night ? 'bg-[#0f172a]' : 'bg-slate-100'}`}>
            {([['auto', '跟随系统', DeviceMobileCamera], ['light', '白天', Sun], ['dark', '夜间', Moon]] as const).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setThemeMode(k)}
                className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-full text-[11px] font-bold transition ${themeMode === k ? p.chipOn : p.chip}`}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="自动连播" desc="一集放完自动接下一集。下一集手机和电脑都没有的时候不会瞎跳。">
          <div className={`flex gap-1 rounded-full p-1 ${p.night ? 'bg-[#0f172a]' : 'bg-slate-100'}`}>
            {([[true, '开'], [false, '关']] as const).map(([k, label]) => (
              <button
                key={String(k)}
                onClick={() => { setAutoNext(k); try { localStorage.setItem(AUTONEXT_KEY, k ? '1' : '0'); } catch {} }}
                className={`flex-1 py-2 rounded-full text-[11px] font-bold transition ${autoNext === k ? p.chipOn : p.chip}`}
              >
                {label}
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="手机里的剧" desc={`${usage.dramas} 部 · ${usage.count} 集 · 占了 ${fmtBytes(usage.bytes)}`}>
          {usage.dramas > 0 ? (
            <div className="flex justify-center gap-2">
              <Pill
                tone={p}
                onClick={async () => {
                  clearWatch();
                  setWatch(listWatch());
                  addToast('追剧记录清空了', 'success');
                }}
              >
                清追剧记录
              </Pill>
              <Pill
                tone={p}
                onClick={async () => {
                  await clearPhoneLibrary();
                  await reloadPhone();
                  addToast('手机里的剧全清掉了', 'success');
                }}
              >
                全清手机剧库
              </Pill>
            </div>
          ) : (
            <p className={`text-[11px] text-center ${p.sub}`}>手机里还没有剧</p>
          )}
        </SectionCard>

        <SectionCard title="连你的电脑" desc="电脑上打开短剧库和「剧场转发」，它会显示一个地址。手机连同一个 WiFi，填进去就行。">
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="192.168.x.x:8999"
            className={`w-full rounded-2xl px-4 py-3 text-sm outline-none ${p.input}`}
          />
          <div className="mt-3 flex justify-center gap-2">
            <Pill primary onClick={() => saveAddr(addr)} disabled={!addr.trim() || checking}>
              {checking ? '正在试…' : '保存并连'}
            </Pill>
            <Pill tone={p} onClick={refresh}>重试</Pill>
          </div>
          <div className="mt-3 text-center">
            {checking ? <Tag tone="no">正在试…</Tag>
              : online ? <Tag tone="ok">已经连上了</Tag>
              : <Tag tone="no">没连上</Tag>}
          </div>
          {connError && <p className="mt-2.5 text-[11px] text-amber-600 leading-relaxed text-center">{connError}</p>}
        </SectionCard>

        {known.length > 0 && (
          <SectionCard title="之前连过">
            <div className="space-y-2">
              {known.map((k) => (
                <div key={k.base} className="flex items-center gap-2">
                  <button
                    onClick={() => saveAddr(k.base)}
                    className={`flex-1 text-left rounded-2xl px-4 py-2.5 text-xs active:scale-95 ${p.input}`}
                  >
                    {k.base}
                  </button>
                  <button
                    onClick={() => { forgetRelay(k.base); setKnown(getKnownRelays()); }}
                    className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}
                  >
                    <X size={14} className={p.sub} />
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        <SectionCard title="出门在外" desc="装了 Tailscale 之后，出门也能连上家里。不想带电脑就先「存到手机」，存完跟电脑无关，断网也能看。">
          <div className="flex justify-center">
            <Pill tone={p} onClick={() => { setPage('list'); setTab('phone'); }}>去本地剧库</Pill>
          </div>
        </SectionCard>

        <div className="text-center text-[10px] text-slate-300 pt-2 pb-6">
          第 1 步 · 还不接 AI，第 2 步才接
        </div>
      </div>
    </div>
  );
};

export default TheaterApp;
