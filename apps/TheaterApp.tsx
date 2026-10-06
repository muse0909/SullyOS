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
  Eye, EyeSlash,
  DeviceMobile, HardDrive, CloudSlash, CloudArrowDown, Moon, Sun, DeviceMobileCamera, Sparkle,
  CaretDown,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import Modal from '../components/os/Modal';
import PlayerStage, { fmtTime } from '../components/dramaTheater/PlayerStage';
import EpisodeDrawer, { type EpState } from '../components/dramaTheater/EpisodeDrawer';
import {
  getRelayAddr, setRelayAddr, normalizeAddr, pingRelay, forgetRelay, getKnownRelays,
  fetchDramas, fetchTasks, searchDramas, fetchEpisodes, fetchVideoBlobUrl, fetchVideoBytes,
  fetchMacWatchHistory, sourceName, openOnlinePlayback, streamOnlineEpisode, closeOnlinePlayback,
  fetchLocalEpisodes, coverSrc,
  reclaimStaleSessions, localVideoUrl, clearAllOnlinePlayback, queueDownload,
  PLAYBACK_BUSY_MSG,
  type RelayDrama, type RelayTask, type RelaySource,
} from '../utils/dramaTheater/relayClient';
import {
  listPhoneDramas, findPhoneDrama, dramaKey, saveEpisodeToPhone, phoneEpisodeUri,
  deletePhoneEpisode, deletePhoneDrama, clearPhoneLibrary, phoneLibraryUsage,
  saveUploads, base64ToBlob, fmtBytes, downloadEpisodeToPhone, type PhoneDrama,
} from '../utils/dramaTheater/localVideos';
import { listWatch, upsertWatch, removeWatch, clearWatch } from '../utils/dramaTheater/watchHistory';
import { useTheaterTheme, palette, type Palette } from '../utils/dramaTheater/theme';
import { probeCover, pageEnv, refetchOne, resetDiag } from '../utils/dramaTheater/coverDiag';
import { loadCoverBlob, cachedCoverUrl, coverCacheSize } from '../utils/dramaTheater/coverBlob';
import { probeLive, maskKey, type ProbeStep } from '../utils/dramaTheater/liveProbe';
import { useTheaterLive, type UseTheaterLive } from '../hooks/useTheaterLive';
import {
  loadLiveConfig, saveLiveConfig, subscribeLiveConfig, defaultLiveConfig, maskLiveKey,
  LIVE_WS_BASE, type TheaterLiveConfig,
} from '../utils/dramaTheater/liveConfig';

const AUTONEXT_KEY = 'theater_autonext';
const PAGE = 60;
/**
 * 「缓存剧库」里被长按移走的剧。
 *
 * 只存在手机本地，**不碰电脑上的文件** —— 用户原话：
 * 「长按删除，就不在手机列表显示了，不影响电脑里的储存」。
 * 电脑里那份照旧能看、能再下回来；这里只是不再占他手机的列表位置。
 * 「恢复全部」在缓存剧库页顶部。
 */
const MAC_HIDDEN_KEY = 'theater_mac_hidden';
/**
 * 「下载到手机」多久没进展就认输。
 *
 * 红果源有些集拉不下来（续读 403 / 资源已变化），短剧库会一直重试，
 * 不设兜底的话进度条永远停在某个数字上，用户以为死机。
 * 电脑实测单集只要 4 秒，10 分钟足够下完一整部。
 */
const MAC_FETCH_TIMEOUT = 10 * 60 * 1000;
/**
 * 「下到电脑」等到多久就认输。
 *
 * 实测单集中位 4 秒、最长 38 秒（电脑上的 1126 个集实测），一部 58 集也就
 * 四五分钟。给 10 分钟是留足余量 —— 超过就说明有集拉不下来（红果源续读 403 /
 * 资源已变化那种），这时候把已经下到的先存进手机，比干等着强。
 */


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
  /**
   * true = 这部电脑上还没有，选集列的是「全剧集号」，不是电脑上真有的。
   * 弹窗要说清楚：这几集要先让电脑下下来，选中的才会进手机。
   */
  fromNetwork?: boolean;
}> = ({ p, title, avail, checked, range, setRange, avgBytes, onToggle, onApplyRange, onAll, onNone, onClose, onConfirm, fromNetwork = false }) => {
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
      {fromNetwork ? (
        <p className={`text-[11px] text-center mb-3 leading-relaxed ${p.sub}`}>
          电脑上有 {avail.length} 集 · 选中的先让电脑下下来，下完一集就存一集进手机
        </p>
      ) : (
        <p className={`text-[11px] text-center mb-3 ${p.sub}`}>
          电脑里有 {avail.length} 集还没下到手机{min ? ` · 第 ${min}-${max} 集` : ''}
        </p>
      )}

      {!avail.length ? (
        /* 真的一集都没有（比如整部都没下过）：下面那一整套
           （区间 / 全选 / 体积 / 网格）全都不成立，
           硬渲染会因为 avail[0] 是 undefined 出 NaN，直接别画。 */
        <p className={`py-3 text-center text-[11px] ${p.sub}`}>
          这部剧在电脑上一集都还没有，手机上自然也没有。
        </p>
      ) : (
        <>
      {/* 区间输入：2-20 这种。写完点「照这段」才生效。
          电脑上一集都没有的时候没有可选区间，整块藏掉（avail[0] 会是 undefined）*/}
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
        </>
      )}
    </Modal>
  );
};
// ═══════════════════════ 渲染零件 ═══════════════════════
//
// ⚠️⚠️ 这几个组件**必须写在 TheaterApp 外面**（模块级），别再写回函数体里。
//
// 写进函数体 = 每次渲染都造出全新的函数对象 → React 认定组件类型变了 →
// 整棵子树先卸载再挂载 → 网格里每一个 <img> 都被销毁重建 → 所有海报重新加载。
// 转发服务又是 `Cache-Control: no-store`（浏览器不留缓存），于是每次重渲染
// 都要重新走一遍网络 —— 这就是真机 10-06 19:16 / 19:42 的「片名在海报位置一闪一闪」：
// 图片没加载完那一瞬间，内核会把 alt 文字画在图片框里，而 alt 传的正好是片名。
//
// 主题色 `p`、转发地址 `addr` 改成从 props 进来，就是为了能把它们搬出函数体。

const TopBar: React.FC<{ p: Palette; title: string; onBack?: () => void; right?: React.ReactNode; center?: boolean }> = ({
  p, title, onBack, right, center,
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

/**
 * 封面图。
 *
 * ⚠️ 10-06 真机「海报全不显示」——**地址不直接交给图片框**，先取回来变成手机本地的
 * 临时地址再显示（`utils/dramaTheater/coverBlob.ts`）。真机证据：同一个地址、同一个
 * 时刻，程序主动去取 200/98KB，而图片框那条路 60 张全部卡住不动。跟当初放视频
 * 是同一个坑（1f838f27），那次也是「先取回来再播」。
 *
 * 另外三个关键点，少一个就会退回「一闪一闪」：
 *
 * 1. **占位图标铺在下面，图片盖在上面**，不是二选一渲染。图片还在路上的时候
 *    看到的是图标；`alt` 传空串（片名就在下面的 h3 里，重复一遍没意义），
 *    这样内核**任何时候**都不会把文字画进图片框。
 * 2. **记失败的是「哪个地址」，不是「失败过没有」**。记布尔量的话，换剧/换源时
 *    会把新地址也一起判死（上一张的失败连坐下一张）。
 * 3. **不能再用图片框自己的懒加载**。我们自己限并发了（最多 4 张同时在飞），
 *    否则排队的那些在图片框里会一直「卡住不动」—— 正是这次查了两小时的现象。
 *
 * `src` 由调用方用 `coverSrc()` 拼好：相对路径要拼上转发地址，老记录里的 CDN
 * 直链原样用。别在各处单独拼 —— 漏一处就整页海报全挂（10-06 19:15 首页漏拼）。
 */
const CoverImg: React.FC<{ p: Palette; src: string }> = ({ p, src }) => {
  const [badSrc, setBadSrc] = useState('');
  /**
   * 拿同步的缓存值当初始值：缓存里有就**这一帧直接显示**，不会先闪一下占位。
   * 没有才空着，等下面取回来再填。
   */
  const [blobUrl, setBlobUrl] = useState(() => cachedCoverUrl(src));
  const ref = useRef<HTMLImageElement | null>(null);
  const failed = !!src && badSrc === src;

  useEffect(() => {
    let alive = true;
    if (!src) { setBlobUrl(''); return; }

    const hit = cachedCoverUrl(src);
    if (hit) { setBlobUrl(hit); return; }

    setBlobUrl('');
    loadCoverBlob(src)
      .then((u) => { if (alive) setBlobUrl(u); })
      .catch(() => { if (alive) { setBadSrc(src); probeCover(ref.current, src); } });
    return () => { alive = false; };
  }, [src]);

  /**
   * 每张图都报一次状态到 `window.__theaterDiag`（详见 utils/dramaTheater/coverDiag.ts）。
   *
   * 为什么加载完还要再报一次：`currentSrc`（内核最终真去请求的地址）在图片**真正开始加载
   * 之前是空串**，只有 onLoad 之后才拿得到最能说明问题的那份。
   */
  const report = useCallback(() => { if (src) probeCover(ref.current, src); }, [src]);

  useEffect(() => { report(); }, [report]);

  return (
    <div className="absolute inset-0">
      <div className={`w-full h-full flex items-center justify-center ${p.night ? 'text-slate-600' : 'text-slate-300'}`}>
        <FilmSlate size={26} />
      </div>
      {!failed && src && blobUrl && (
        <img
          ref={ref}
          src={blobUrl}
          alt=""
          decoding="async"
          onLoad={report}
          onError={() => { setBadSrc(src); probeCover(ref.current, src); }}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}
    </div>
  );
};

/**
 * 封面诊断窗（10-06「海报完全不显示」取证用）。
 *
 * 电脑这边已经全查过、全是好的（数据、转发、拼地址、apk 配置、混合内容开关），
 * 只有手机不出图。这种 bug 读代码读不出来，只能让页面自己报告。
 *
 * 最要紧的一行是「内核实际请求的地址」—— https 页面里的 http 图片会被自动升级成 https，
 * 电脑上的转发服务没有 https，升级就失败。`<img>` 不报错、不抛异常，
 * 界面上只是一片占位图标，不专门看这个字段永远猜不到。
 *
 * 定位完就能删。留着是因为「电脑好好的、手机就是不出图」这类问题还会有第二次。
 */
const CoverDiagModal: React.FC<{ p: Palette; addr: string; onClose: () => void }> = ({ p, addr, onClose }) => {
  const [env, setEnv] = useState(() => pageEnv());
  const [probe, setProbe] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setEnv(pageEnv()), []);

  /** 绕开 <img> 直接发一次请求：能拿到图 = 地址没问题，问题在内核显示/安全层 */
  const retest = useCallback(async () => {
    const first = pageEnv().records.find((r) => r.src) || (env.records[0] as any);
    if (!first?.src) return setProbe('还没有记录到任何地址');
    setBusy(true);
    const r: any = await refetchOne(first.src);
    setProbe(
      `请求地址：\n${first.src}\n\n` +
      `${r.ok ? '成功' : '失败'} · ${r.ms}ms · ${r.status ?? ''} ${r.type ?? ''} ${r.size ?? r.error ?? ''}\n${r.note}`
    );
    setBusy(false);
    refresh();
  }, [env.records, refresh]);

  return (
    <Modal isOpen title="海报诊断" onClose={onClose} zIndex={130}
      footer={
        <>
          <button onClick={() => { resetDiag(); setProbe(''); refresh(); }}
            className={`flex-1 rounded-full py-2.5 text-xs font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
            清空重记
          </button>
          <button onClick={retest} disabled={busy}
            className="flex-1 rounded-full py-2.5 text-xs font-bold bg-sky-500 text-white active:scale-95 disabled:opacity-40">
            {busy ? '正在测…' : '重新检测'}
          </button>
        </>
      }
    >
      {/**
       * 手机里存的电脑地址 —— 10-06 真机海报全挂的第一嫌疑人。
       * 电脑换 WiFi / 换网段就换 IP（10-05 是 .102，现在是 .106），而设置里存的是
       * 旧地址时：剧目列表还能显示（那是上次拉到的，state 没被清掉），
       * 但图片请求全打到一个不通的地址上，**一直挂着既不成功也不报错**。
       * 这个「失败 0 / 成功 0」就是它的指纹。
       */}
      <div className={`rounded-2xl px-3 py-2.5 mb-2 text-[11px] leading-relaxed ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}>
        <div>手机里存的电脑地址：</div>
        <div className="font-mono font-bold break-all" style={{ color: addr.includes('192.168.0.102') ? '#f59e0b' : undefined }}>
          {addr || '（空）'}
        </div>
        {addr.includes('192.168.0.102') && <div className="text-amber-600 font-bold mt-1">← 这是旧地址，电脑早换了</div>}
      </div>

      <div className={`rounded-2xl px-3 py-2.5 mb-2 text-[11px] leading-relaxed ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}>
        <div>页面协议：<b>{env.protocol || '?'}</b>{env.pageIsHttps ? '（https）' : ''}</div>
        <div>海报张数：共 {env.total} · 成功 {env.loaded} · 失败 {env.failed}{env.total > env.loaded + env.failed ? ` · **还在加载 ${env.total - env.loaded - env.failed}**` : ''}</div>
        <div style={{ color: env.upgraded ? '#f59e0b' : undefined, fontWeight: env.upgraded ? 700 : 400 }}>
          地址被内核改写：{env.upgraded} 张
        </div>
      </div>

      {probe && (
        <div className="rounded-2xl bg-sky-50 px-3 py-2.5 mb-2 text-[10px] text-sky-700 leading-relaxed break-all">
          <div className="whitespace-pre-wrap">{probe}</div>
        </div>
      )}

      <div className="text-[10px] text-slate-400 mb-1.5 text-center">最近 {env.records.length} 张（完整地址）</div>
      {env.records.map((r) => {
        const changed = r.currentSrc && r.currentSrc !== r.src;
        return (
          <div key={r.src} className={`rounded-xl px-2.5 py-1.5 mb-1 text-[10px] leading-tight ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}>
            <div className="font-mono text-slate-500 break-all">{r.src.replace(/\?.*$/, '?…')}</div>
            <div className={r.ok ? 'text-emerald-600' : 'text-rose-500'}>
              {r.ok ? '成功' : r.complete ? '失败' : '卡住不动'} · {r.naturalWidth}×{r.naturalHeight}
            </div>
            {changed && <div className="text-amber-600 font-bold break-all">内核改成了 {r.currentSrc}</div>}
          </div>
        );
      })}

      {/**
       * 浏览器实际发出去几个请求 —— 「压根没发」和「发了没显示」的唯一分界。
       * 只有 0~6 条 = 连接池被别的东西占满，剩下 54 张在排队（所以永远「成功 0 失败 0」）。
       */}
      <div className="text-[10px] text-slate-400 mt-3 mb-1.5 text-center">
        浏览器实际发出的图片请求：{env.perf.length} 条
      </div>
      {env.perf.map((r: any, i: number) => (
        <div key={i} className={`rounded-xl px-2.5 py-1.5 mb-1 text-[10px] leading-tight ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}>
          <div className="font-mono text-slate-500 break-all">{String(r.name).replace(/^https?:\/\//, '').split('/')[0]}</div>
          <div className={r.ms > 0 ? 'text-emerald-600' : 'text-amber-600'}>
            {r.ms > 0 ? `回来了 · ${r.ms}ms · ${r.size}B` : '还飞着'} · 第 {r.started}ms 发出
          </div>
        </div>
      ))}
    </Modal>
  );
};

/**
 * 实时连接测试窗（10-06 21:45）。
 *
 * 存在的理由：「手机能不能连上实时接口」是整套第 2 步的生死关口，而这一步
 * **没法在电脑上验** —— curl 和 nc 不读系统代理，浏览器和 WebView 读，
 * 两种环境结论正好相反。只能让手机自己说。
 *
 * 分三步递进，因为三步失败的原因完全不同：
 *   1 普通 HTTPS 通不通、key 对不对  ← 90% 的情况在这一步就能定性
 *   2 WebSocket 长连接能不能建起来    ← 长连接可能被 NAT / 代理规则单独挡掉
 *   3 真的发 setup，看模型认不认配置
 *
 * ⚠️ key 只显示脱敏后的几位，绝不把完整地址打到日志里（手机上有调试浮标会记录）。
 */
const LiveProbeModal: React.FC<{ p: Palette; apiKey: string; model: string; baseUrl: string; onClose: () => void }> = ({ p, apiKey, model, baseUrl, onClose }) => {
  const [steps, setSteps] = useState<ProbeStep[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setSteps([]);
    await probeLive(apiKey, (s) => setSteps((old) => [...old, s]), model, baseUrl);
    setRunning(false);
  }, [apiKey, model, baseUrl]);

  const passed = steps.length > 0 && steps.every((s) => s.ok);
  const firstFail = steps.find((s) => !s.ok);

  return (
    <Modal isOpen title="实时连接测试" onClose={onClose} zIndex={130}
      footer={
        <>
          <button onClick={onClose}
            className={`flex-1 rounded-full py-2.5 text-xs font-bold active:scale-95 ${p.night ? 'bg-[#334155] text-slate-300' : 'bg-slate-100 text-slate-500'}`}>
            关闭
          </button>
          <button onClick={run} disabled={running}
            className="flex-1 rounded-full py-2.5 text-xs font-bold bg-sky-500 text-white active:scale-95 disabled:opacity-40">
            {running ? '正在试…' : steps.length ? '再试一次' : '开始测试'}
          </button>
        </>
      }
    >
      <div className={`rounded-2xl px-3 py-2 mb-2.5 text-[10px] ${p.night ? 'bg-[#1e293b]' : 'bg-slate-50'}`}>
        用的密钥：<span className="font-mono font-bold">{maskKey(apiKey)}</span>
        <div className="text-slate-400 mt-0.5">模型：<span className="font-mono">{model}</span></div>
        <div className="text-slate-400 mt-0.5">失败很正常，这一步就是用来告诉你卡在哪的</div>
      </div>

      {steps.length === 0 && !running && (
        <p className={`text-[11px] text-center py-4 ${p.sub}`}>点下面开始，一次测三步</p>
      )}

      {steps.map((s, i) => (
        <div key={i} className={`rounded-xl px-3 py-2.5 mb-2 text-[11px] leading-relaxed ${
          s.ok ? (p.night ? 'bg-emerald-950/40' : 'bg-emerald-50')
               : (p.night ? 'bg-rose-950/40' : 'bg-rose-50')
        }`}>
          <div className="flex items-center gap-2">
            <span className={s.ok ? 'text-emerald-600' : 'text-rose-500'}>
              {s.ok ? '✓' : '✗'}
            </span>
            <span className="font-bold">第{s.n}步 · {s.name}</span>
            <span className="text-slate-400 ml-auto">{s.ms}ms</span>
          </div>
          <div className="text-slate-500 mt-1">{s.detail}</div>
        </div>
      ))}

      {running && (
        <div className="text-center py-2">
          <SpinnerIcon />
          <p className={`text-[11px] mt-1 ${p.sub}`}>正在试…</p>
        </div>
      )}

      {passed && (
        <div className={`rounded-2xl px-3 py-2.5 text-[11px] leading-relaxed text-center ${
          p.night ? 'bg-emerald-950/40 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
          三步全过。手机这边能直连实时接口，下一步可以接了。
        </div>
      )}

      {firstFail && (
        <div className={`rounded-2xl px-3 py-2.5 text-[10px] leading-relaxed ${
          p.night ? 'bg-[#1e293b] text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
          {firstFail.n === 1
            ? '第 1 步就断了 = 请求压根发不出去，跟密钥无关，是网络这条路没通。'
            : firstFail.n === 2
              ? '网页能通但长连接不行 = 代理只放行了网页请求，去把长连接也放行。'
              : '前两步都通了、这一步才断 = 密钥或权限有问题。'}
        </div>
      )}
    </Modal>
  );
};

const SpinnerIcon: React.FC = () => (
  <div className="flex justify-center gap-1">
    {[0, 1, 2].map((i) => (
      <span key={i} className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" style={{ animationDelay: `${i * 160}ms` }} />
    ))}
  </div>
);

/**
 * 剧场的实时模型配置（10-06 22:25）。
 *
 * 暮色要求：放在设置页**最上面**、**折叠起来**、点一下才展开。
 * 为什么折叠 —— 这个东西十个页面里用一次，不该占首屏；
 * 为什么在最上面 —— 它是剧场能不能用的开关，卡在下面一堆设置中间找不到。
 *
 * ⚠️ 独立于聊天的主 API（暮色 22:10 指出）：主聊天用别的模型，
 * 只有剧场要用 live 模型，借主 API 的配置既不对也会互相牵连。
 */
const LiveConfigCard: React.FC<{
  p: Palette;
  cfg: TheaterLiveConfig;
  onSave: (c: TheaterLiveConfig) => void;
}> = ({ p, cfg, onSave }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(cfg);
  // 外面换了配置（另一个 app 改了）就把草稿同步过来
  useEffect(() => { setDraft(cfg); }, [cfg]);

  const ready = !!(draft.apiKey && draft.model);
  const dirty = draft.apiKey !== cfg.apiKey || draft.model !== cfg.model || draft.baseUrl !== cfg.baseUrl;

  return (
    <div className={`rounded-3xl p-5 ${p.card}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
      >
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-bold ${p.title}`}>实时模型</h3>
          <p className={`mt-1 text-[11px] ${ready ? (p.night ? 'text-emerald-400' : 'text-emerald-600') : p.sub}`}>
            {ready
              ? `已配置 · ${draft.model}`
              : '还没配密钥 —— 配完才能跟角色边看边聊'}
          </p>
        </div>
        {/* 展开箭头：转 180° 表示「点这里展开」 */}
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          p.night ? 'bg-[#1e293b]' : 'bg-white/70'
        }`}>
          <CaretDown size={16} className={`${p.sub} transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="mt-3">
          <p className={`text-[11px] leading-relaxed ${p.sub}`}>
            跟聊天那边的 API **完全独立** —— 你聊天用哪个模型都行，这里只管剧场的。
            <br />
            实时协议只有 Google 官方有（中转站不做双向流），所以不用切协议，
            密钥填 AIStudio 那个就行。
          </p>

          <label className={`block mt-3 text-[10px] ${p.faint}`}>密钥</label>
          <input
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            placeholder="AIza…"
            autoCapitalize="none"
            autoCorrect="off"
            className={`mt-1 w-full rounded-2xl px-4 py-3 text-sm outline-none ${p.input}`}
          />

          <label className={`block mt-3 text-[10px] ${p.faint}`}>模型</label>
          <input
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="gemini-3.8-live"
            autoCapitalize="none"
            autoCorrect="off"
            className={`mt-1 w-full rounded-2xl px-4 py-3 text-sm outline-none ${p.input}`}
          />

          <label className={`block mt-3 text-[10px] ${p.faint}`}>接口地址（一般不用改）</label>
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder={LIVE_WS_BASE}
            autoCapitalize="none"
            autoCorrect="off"
            className={`mt-1 w-full rounded-2xl px-4 py-3 text-[11px] outline-none ${p.input}`}
          />

          <div className="mt-4 flex justify-center">
            <Pill tone={p} onClick={() => onSave(draft)} disabled={dirty ? false : true}>
              {dirty ? '保存' : '已保存'}
            </Pill>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 剥掉 `<语音>...</语音>` 标签，只留里面的文字。
 *
 * ⚠️ 必须在**模块级**，不能写在组件函数体里 —— 写在函数体里每次渲染都造出
 * 新函数对象，React 认定组件类型变了，整棵子树先卸载再挂载，里面的 `<img>`
 * 全被重建（AGENTS.md §4.3 记着这个坑）。
 *
 * 为什么剧场要剥：角色卡的提示词里可能带着主聊天的语音消息功能说明，
 * 模型就学会吐 `<语音>xxx</语音>`。剧场不播语音，留着就是一串方括号
 * 字符露在气泡里。
 */
const stripVoiceTag = (s: string): string =>
  (s || '')
    .replace(/<\/?语音>/g, '')
    .trim();

/**
 * 剧场聊天区（第 2 步）。
 *
 * 为什么不直接用主聊天那个气泡组件：它依赖一整套主题上下文，而且气泡是给
 * 全屏聊天设计的（带头像、时间戳、右键菜单）。剧场这边聊天区挤在播放器旁边，
 * 空间有限 —— 要的是**能一眼认出是同一段对话**，但气泡本身要轻。
 * 所以手写一个轻量的，配色跟主聊天观感对齐。
 *
 * ⚠️ 「重连中…」必须如实显示。断了就断了，装没事只会让用户以为角色在装死。
 */
const TheaterChat: React.FC<{
  p: Palette;
  live: UseTheaterLive;
  charName?: string;
  disabled?: boolean;
}> = ({ p, live, charName, disabled }) => {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [kbH, setKbH] = useState(0);
  /**
   * 用户自己往上翻了就别再把他拽回底部。
   *
   * ⚠️ 之前是无条件 `scrollTop = scrollHeight`，模型每吐一个字就拽一次 ——
   * 用户想回看上面的话根本看不了，而且每帧强制滚动会把渲染进程压爆
   * （10-06 现场抓到的闪退就是这个：Chromium 渲染进程 native crash）。
   */
  const stickBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // 离底部 40px 以内才算「贴着底部」，中间地带一律视为用户在翻历史
      stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // 流式出字时贴着底部滚 —— 只在「本来就在底部」时才滚
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [live.msgs]);

  /**
   * 安卓软键盘会把 `100vh` 算错（`AGENTS.md` §6.2 记着这个老坑）。
   * 用 visualViewport 拿到键盘真实高度，输入栏跟着抬，**别把播放器挤没**。
   */
  useEffect(() => {
    const vv: any = (window as any).visualViewport;
    if (!vv) return;
    const onResize = () => setKbH(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const submit = () => {
    const t = draft.trim();
    if (!t || disabled) return;
    setDraft('');
    // 用户主动发消息 = 明确要看新回复，解除「别滚到底」的锁定
    stickBottom.current = true;
    live.send(t);
  };

  const stateNote =
    live.state === 'connecting' ? '连上了吗…'
    : live.state === 'reconnecting' ? `重连中…${live.note ? `（${live.note}）` : ''}`
    : live.state === 'failed' ? (live.note || '连不上')
    : live.state === 'ready' ? ''
    : '';

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ paddingBottom: kbH || 0 }}>
      {/* 「邀请一起看」（10-07 02:42 暮色定的）。
          没邀请 = 他自己安静追剧，角色看不见画面也听不见声音；
          邀请了 = 角色才开始看。
          ⚠️ 切换会重连一次（系统提示词变了），所以按钮上写清楚会做什么。 */}
      <div className="shrink-0 px-4 pb-2">
        <button
          onClick={() => live.setInvited(!live.invited)}
          className={`mx-auto flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-bold transition-colors ${
            live.invited
              ? (p.night ? 'bg-sky-900/60 text-sky-200' : 'bg-sky-100 text-sky-600')
              : (p.night ? 'bg-[#1e293b] text-slate-400' : 'bg-slate-100 text-slate-400')
          }`}
        >
          {live.invited ? (
            <>
              <Eye size={13} />
              <span>他正在陪我看 · 点一下收回</span>
            </>
          ) : (
            <>
              <EyeSlash size={13} />
              <span>邀请他一起看</span>
            </>
          )}
        </button>
      </div>

      {/* 状态条：断了就说，别装没事 */}
      {stateNote && (
        <div className={`shrink-0 mx-4 mb-1.5 rounded-full px-3 py-1 text-center text-[10px] ${
          live.state === 'failed'
            ? (p.night ? 'bg-rose-950/50 text-rose-300' : 'bg-rose-50 text-rose-500')
            : (p.night ? 'bg-[#1e293b] text-slate-400' : 'bg-amber-50 text-amber-600')
        }`}>
          {stateNote}
          {live.state === 'failed' && (
            <button onClick={live.retry} className="ml-2 underline font-bold">再试一次</button>
          )}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-3">
        {live.msgs.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <FilmSlate size={28} className={p.faint} />
            <p className={`mt-2 text-[11px] ${p.faint}`}>
              {charName ? `这里会放跟${charName}聊天的框` : '这里会放聊天的框'}
            </p>
            <p className={`mt-1 text-[10px] ${p.faint}`}>
              他现在只知道你在看剧，还看不到画面
            </p>
          </div>
        )}

        {live.msgs.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-2`}>
            <div className={`max-w-[78%] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? (p.night ? 'bg-sky-900/60 text-slate-100 rounded-[1.1rem] rounded-br-md' : 'bg-sky-100 text-slate-700 rounded-[1.1rem] rounded-br-md')
                : (p.night ? 'bg-[#1e293b] text-slate-200 rounded-[1.1rem] rounded-bl-md' : 'bg-white text-slate-700 rounded-[1.1rem] rounded-bl-md shadow-sm')
            }`}>
              {/* ⚠️ 这里**不显示**剧名集数（暮色 23:54 定的）。
                  剧名集数是给 LLM 的上下文线索（存在 metadata.theaterTag），
                  不是给人看的角标 —— 每个气泡都顶一行小字太吵。

                  顺带把 <语音> 标签剥掉：那是主聊天的语音消息功能，
                  剧场不播语音，留着就是一串方括号字符露在气泡里。 */}
              {stripVoiceTag(m.text) || (m.streaming ? <span className="opacity-40">…</span> : null)}
            </div>
          </div>
        ))}
      </div>

      {/* 输入框 */}
      <div className={`shrink-0 px-4 pt-2 pb-3 border-t ${p.line}`}>
        <div className={`flex items-center gap-2 rounded-full px-4 py-2.5 ${
          p.night ? 'bg-[#1e293b]' : 'bg-slate-100'
        }`}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={disabled ? '先选个角色' : '说点什么…'}
            disabled={disabled}
            className={`flex-1 bg-transparent text-sm outline-none ${
              disabled ? (p.night ? 'text-slate-600' : 'text-slate-400') : (p.night ? 'text-slate-100' : 'text-slate-700')
            }`}
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || disabled}
            className="shrink-0 w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center active:scale-95 disabled:opacity-30"
          >
            <Play size={14} weight="fill" className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 长按识别。用 touch 起手 + 500ms 计时器，不依赖 `onContextMenu` ——
 * 安卓上长按会先弹系统的「复制 / 保存图片」，那一下就把事件吃掉了。
 * 手指按住不动 500 毫秒就算长按；按住期间动了或松开了就不算。
 */
const HoldItem: React.FC<{
  children: React.ReactNode;
  onClick: () => void;
  onHold?: () => void;
}> = ({ children, onClick, onHold }) => {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => clear, []);
  return (
    <div
      className="cursor-pointer min-w-0 active:scale-95 transition-transform"
      onClick={() => { if (!fired.current) onClick(); fired.current = false; }}
      onTouchStart={() => {
        fired.current = false;
        if (!onHold) return;
        clear();
        timer.current = window.setTimeout(() => { fired.current = true; onHold(); }, 500);
      }}
      onTouchMove={clear}
      onTouchEnd={clear}
      onTouchCancel={clear}
    >
      {children}
    </div>
  );
};

/**
 * 网格。`onHold` 不传就没有长按。
 * 长按用 touch 计时（500ms）而不是 HTML 的 onContextMenu ——
 * 安卓上 onContextMenu 会先弹系统的「复制/保存图片」，抢在长按之前。
 *
 * 封面地址在这里统一用 `coverSrc()` 拼好再交给 CoverImg，
 * CoverImg 自己不再管拼地址 —— 别在两处都拼。
 */
const Grid: React.FC<{
  p: Palette;
  addr: string;
  items: any[];
  onOpen: (it: any) => void;
  onHold?: (it: any) => void;
}> = ({ p, addr, items, onOpen, onHold }) => (
  <div className="grid grid-cols-3 gap-2.5">
    {items.map((it) => (
      <HoldItem key={it.key} onClick={() => onOpen(it)} onHold={onHold ? () => onHold(it) : undefined}>
        <div className={`relative w-full aspect-[3/4] rounded-xl overflow-hidden ${p.night ? 'bg-[#1e293b]' : 'bg-slate-200'}`}>
          <CoverImg p={p} src={coverSrc(addr, it.cover)} />
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
      </HoldItem>
    ))}
  </div>
);

const Empty: React.FC<{ p: Palette; text: string }> = ({ p, text }) => (
  <div className={`text-center text-xs py-10 whitespace-pre-line leading-relaxed ${p.sub}`}>{text}</div>
);

const SectionCard: React.FC<{ p: Palette; title?: string; desc?: string; children: React.ReactNode }> = ({ p, title, desc, children }) => (
  <div className={`rounded-3xl p-5 ${p.card}`}>
    {title && <h3 className={`text-sm font-bold ${p.title}`}>{title}</h3>}
    {desc && <p className={`mt-1.5 text-[11px] leading-relaxed ${p.sub}`}>{desc}</p>}
    <div className={title || desc ? 'mt-3' : ''}>{children}</div>
  </div>
);

const TheaterApp: React.FC = () => {
  /**
   * 返回：回**打开剧场时所在的那个聊天**，不是桌面。
   *
   * 用 `closeApp()` 回的是 `parentApp`，而剧场这个入口历史上没传 parent，
   * 于是 `closeApp()` 落到 Launcher = 回桌面（用户 10-06 19:15 实测）。
   * `activeCharacterId` 就是当时那个聊天，直接跳回去最稳。
   */
  /**
   * ⚠️ `apiConfig` 必须在这里解构出来：第 2 步的实时连接测试要用密钥。
   * 漏解构是真机崩过的事（悬浮窗漏 addApiPreset、剧场漏 jumpToMessage），
   * 而 `vite build` 只转译不查作用域、`typecheck` 也只在用得到的地方才报 ——
   * **改动后一定要跑 `npm run typecheck:theater`，别只跑 build。**
   *
   * 第 2 步补的：`userProfile` / `memoryPalaceConfig` / `updateCharacter` 也是
   * 照抄陪伴模式要用到的 —— 三个都不是 theater 的，漏一个就是崩。
   */
  const {
    activeCharacterId, characters, addToast, jumpToChat, apiConfig,
    userProfile, memoryPalaceConfig, updateCharacter,
  } = useOS();
  const char = useMemo(
    () => characters.find((c: any) => c.id === activeCharacterId),
    [characters, activeCharacterId]
  );

  const { mode: themeMode, night, setMode: setThemeMode } = useTheaterTheme();
  const p = useMemo(() => palette(night), [night]);

  const [page, setPage] = useState<Page>('list');
  const [tab, setTab] = useState<Tab>('home');
  const [diagOpen, setDiagOpen] = useState(false);
  const [probeOpen, setProbeOpen] = useState(false);

  /**
   * 剧场的实时模型配置（独立的，不跟聊天共用）。
   * 独立的原因见 utils/dramaTheater/liveConfig.ts 顶部注释。
   */
  const [liveCfg, setLiveCfg] = useState<TheaterLiveConfig>(() => loadLiveConfig());
  useEffect(() => subscribeLiveConfig(() => setLiveCfg(loadLiveConfig())), []);

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
  /**
   * 每部剧在电脑上**真有哪些集**（转发服务数磁盘得来的）。
   * 用来盖掉短剧库那份会说谎的 playable 名单，见 macByDrama 的注释。
   * 转发服务是旧版、拉不到时这里就是空的，自动退回旧行为。
   */
  const [localEps, setLocalEps] = useState<Map<string, number[]>>(new Map());
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

  // ── 选中的剧 / 集 ──
  const [picked, setPicked] = useState<DramaRef | null>(null);
  const [epTotal, setEpTotal] = useState(0);
  const [currentEp, setCurrentEp] = useState(1);

  /**
   * 第 2 步：接实时模型。
   *
   * ⚠️ 必须在组件顶层无条件调用 —— 放进 `if (page === 'player')` 里是违反
   * Hooks 规则，React 会直接崩。「什么时候连」靠 `active` 开关控制。
   * ⚠️ scene 每次 render 都新建，但它**不能**进 useTheaterLive 的依赖，
   *    否则 hook 每次渲染都重连。里面靠闭包读 picked/currentEp 就够了。
   */
  const live = useTheaterLive({
    char,
    userProfile,
    // ⚠️ 用剧场自己的配置，不是聊天的主 API —— 暮色 22:10 要求的独立
    apiKey: liveCfg.apiKey,
    liveModel: liveCfg.model,
    liveBaseUrl: liveCfg.baseUrl,
    memoryPalaceConfig,
    apiConfig,
    updateCharacter,
    addToast,
    scene: () => ({ title: picked?.title || '', episode: currentEp, at: 0 }),
    active: page === 'player',
  });
  const [curDuration, setCurDuration] = useState(0);
  /**
   * 「接着看」要跳到的秒数。只在从「正在追剧 → 接着看」进来时设一次，
   * 正常从选集页点集数进来不给（那就是「我要从头看」）。
   */
  const [resumeAt, setResumeAt] = useState(0);

  // ── 存到手机 ──
  const [expandedPhone, setExpandedPhone] = useState('');
  const [macHidden, setMacHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(MAC_HIDDEN_KEY) || '[]'); } catch { return []; }
  });

  /**
   * 正在往电脑上下的剧。
   *
   * 电脑上完全没有的剧，**没法直接「下载到手机」** —— 原来那条路是拿电脑上的
   * 文件（`localVideoUrl` 去电脑下载目录里找），电脑没文件就没什么可拷。
   * 所以点下载得先排进短剧库的下载队列（实测单集中位 4 秒），
   * 下完了再自动接着拷进手机。
   *
   * 为什么不让手机直接从在线流下载：在线流是「边转边送」，一集要实时流完
   * （服务器忽略 Range），比电脑直接拉源文件慢好几倍，而且**占播放名额** ——
   * 名额总共才 4 个（playback_resources.go:39），拿它来下载等于下载期间
   * 手机和电脑都看不了剧。电脑下载走的是任务队列，不占名额。
   */


  // ── 下载选集窗（点「下载到手机」先选要哪几集）──
  /**
   * `avail` 是**电脑上磁盘上真有的、还没进手机的集**，不是短剧库那份名单
   * （那份会把 666 集全报成可播，实际磁盘上只有 22 个文件，见 macByDrama）。
   *
   * 电脑上**一集都没有**的剧这里 avail 是空的 → 弹窗改成「整部下」，
   * 让电脑先下、下完一集拷一集（还是走 startPhoneDownload 那一条路）。
   */
  const [dlPick, setDlPick] = useState<{ title: string; avail: number[]; total: number; allFromNetwork?: boolean } | null>(null);
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

  /**
   * 电脑上真有哪些集 —— **直接数磁盘，优先于短剧库那份名单**。
   *
   * `localEps` 来自转发服务新加的 `/relay/local/episodes`（它 `listdir` 下载目录，
   * 只认完整的 `NNN.mp4`，把 `.part.mp4` 半截文件和 `.drama-id` 排除在外）。
   * 拉不到（转发服务是旧的）就退回 tasks 里的 playable 名单。
   *
   * 为什么不直接信 `tasks[].playable`：那个标志把「已排进队列」和
   * 「文件已落盘」混在一起了。10-06 在电脑上逐集比对过 ——
   * 「咱家剑宗团宠小师妹第二季」系统里 666 个集全部 playable，
   * 磁盘上只有 22 个完整文件（另外 2 个是下到一半的 `.part.mp4`）。
   * 照着假名单画格子、算「下载到手机（644）」，点下去 644 个 404。
   */
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
    map.forEach((v, title) => {
      const real = localEps.get(title);
      if (real) {
        // 磁盘上真实存在的那几集才是「电脑里有的」
        v.eps = real.slice();
        // total 也不能信 tasks 的：说的是全剧 666 集，磁盘上就 22 集
        v.total = Math.max(v.total, real[real.length - 1] || 0);
      }
      v.eps.sort((a, b) => a - b);
      // task.total 实测是真实集数，比剧库列表里那个假的 episodeCount 靠谱
      if (v.total < v.eps[v.eps.length - 1]) v.total = v.eps[v.eps.length - 1];
    });
    return map;
  }, [tasks, localEps]);

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

  /**
   * 把任务列表里出现的每部剧，都问一遍转发服务「你磁盘上真有哪些集」。
   *
   * ⚠️ **必须串行，一次一个，不能 `Promise.all`。**
   * 17:11 实测翻车：进剧场时对 11 部剧**并行**发 11 个请求，同一次刷新里
   * 还有一个 21 MB 的剧库列表要转发，连接队列直接打满，多出来的那个请求
   * **压根没发出去**，手机报 `Failed to fetch`，服务器日志里连记录都没有
   * （对比：同秒之后的 11 个批量请求全部 200）。
   *
   * 串行之后最坏 11 × 几十毫秒，反正本地网络。而且拉不到就跳过，
   * 那一部暂时退回旧名单（可能不准），下次进剧场再补。
   */
  const pullLocalEps = async (base: string, ts: RelayTask[]) => {
    const map = new Map<string, number[]>();
    // 类型守卫：filter((x) => !!x) 不会让 TS 收窄出 string
    const titles = Array.from(new Set(ts.map((t) => t.dramaTitle).filter((x): x is string => !!x)));
    for (const t of titles) {
      const eps = await fetchLocalEpisodes(base, t);
      if (eps) map.set(t, eps);
    }
    diag('数了一遍电脑上真实有的集', { 部数: titles.length, 数到: map.size });
    return map;
  };

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
      setLocalEps(new Map());
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
      // 数一遍磁盘：短剧库那份 playable 名单会说谎（详见 macByDrama 的注释）。
      // **故意不 await** —— 这是串行的十一几个请求，await 会把首屏卡住两秒。
      pullLocalEps(addr, ts).then(setLocalEps);
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

  /**
   * 把剧 id 补上 —— **进选集页和直接点播放，两个入口都得走这一条**。
   *
   * 为什么要有这个函数：没有剧 id，在线播放这条路整个判死
   * （`canPlayOnline = !!id && online`、`playEpisode` 里 `d.id && online`）。
   * 10-06 深夜先修了选集页那条（`openEpisodes`），结果 10-06 下午「正在追剧 →
   * 接着看」还是弹「这一集电脑上没有，手机上也没有」—— 那是**另一个入口**，
   * 直接跳播放页，压根没经过 `openEpisodes`，补 id 的逻辑一次都没跑。
   *
   * 同一个 bug 藏在两个入口里，只修一个就等于没修。规矩记死：
   * **任何拿 `DramaRef` 往里跳的地方，都要先过 `resolveDramaId`。**
   *
   * 两条补法：
   *   1. 新记的追剧条目自带 dramaId（watchHistory 里已加）
   *   2. 老条目没有，就按剧名在**已经拉到内存的剧库**里查一次
   *      （不是去网络搜，dramas 这会儿就在手上，一万多条全在）
   */
  const resolveDramaId = useCallback((incoming: DramaRef): DramaRef => {
    if (incoming.id) return incoming;
    const hit = dramas.find((x) => x.title === incoming.title);
    if (hit?.id) {
      diag('按剧名补到了剧 id', { 剧: incoming.title, id: hit.id.slice(0, 22) });
      return { ...incoming, id: hit.id };
    }
    diag('这部没找到剧 id（可能不是剧库里的剧）', { 剧: incoming.title });
    return incoming;
  }, [dramas]);

  const openEpisodes = async (incoming: DramaRef) => {
    const d = resolveDramaId(incoming);
    setPicked(d);
    /**
     * 进选集页时把**这一部**的磁盘实况单独拉一次。
     * 后台那批是「进剧场时拉的全部」，可能不包含这部（刚搜出来的、或名字对不上），
     * 而这一部的集数格子、颜色、「下载到手机（N）」全靠它。
     */
    if (d.id || macByDrama.has(d.title)) {
      fetchLocalEpisodes(addr, d.title).then((eps) => {
        if (eps) setLocalEps((old) => { const m = new Map(old); m.set(d.title, eps); return m; });
      });
    }
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
    /**
     * ⚠️ 问集数**也要占一个播放名额**，这里必须用完就还。
     *
     * `/api/ui/playback/open` 开的是**真的播放会话**（不是只读的「查集数」接口），
     * 短剧库给它记一条、算进并发名额。原来拿到 `r.session` 就扔了，
     * **每进一次选集页漏一个名额**，进几次就再也开不出来（真机 10-06 反复 429 的真凶）。
     *
     * 复现数据：连开 3 次，第 3 次就 429，而清空一次关掉了 4 个 ——
     * 说明其中 2 个是历史泄漏的。
     *
     * `closeOnlinePlayback` 放在 finally 里：成功、失败、页面中途切走都得还。
     */
    let probeSession = '';
    try {
      const r = await fetchEpisodes(addr, id);
      probeSession = r.session;
      if (r.total) setEpTotal(r.total);
    } catch {
      // 问不到就先用本地已有的，最差也就只显示存过的那几集
    } finally {
      if (probeSession) closeOnlinePlayback(probeSession);
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
    /**
     * `closed: 0` **不是失败** —— 它的意思是「本来就没有占着的播放位」。
     *
     * 之前一律判成失败并 return，结果用户点了没反应、白等一场。
     * 真失败是**请求压根没发出去**（短剧库没开 / 网络不通），
     * 那在 `clearAllOnlinePlayback` 里已经抛异常了，走到这里的都是成功的。
     *
     * 而且不管关掉了几个，都要重试一次当前这一集 —— 名额腾出来了就试，
     * 没腾出来重试也只是再撞一次 429，不会更糟。
     */
    addToast(n > 0 ? `清掉了 ${n} 个占着的播放位，正在重试` : '本来就没有占着的播放位，重新试一次', 'info');
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
    const raw = drama || picked;
    if (!raw) return;
    // 剧 id 必补 —— 见 resolveDramaId 的注释（同一个 bug 藏在两个入口里）
    const d = resolveDramaId(raw);
    // 切剧/切集先把手上的在线会话还回去，别占着短剧库的并发名额
    closeOnline();
    // 第 3 步：换集就把画面时钟归零。下一帧强制送，
    // 不然它还拿着上一集的最后位置说话（幕色 01:39「第 3 步」定）
    live.resetFrames();

    /**
     * **把上一段视频彻底拆掉**，再开始取新的。
     *
     * 之前这里只 `closeOnline()`（那只是还短剧库的播放名额，跟播放器没关系），
     * `blobUrl` 里还挂着上一集/上一部剧的视频地址，所以切过去的头几秒
     * 屏幕上还是旧画面、声音也还在放 —— 10-06 下午用户实机反馈。
     *
     * 只 `setPage('player')` / `setCurrentEp(n)` 是拆不掉的：PlayerStage 拿到
     * 的还是同一个 `src`，`useEffect(..., [src])` 压根不触发，旧流继续拉、继续解码。
     *
     * 这里先 revoke 再置空，PlayerStage 那边用 `key={src}` 强制重建 `<video>`，
     * 新元素不带任何源，什么都不请求。
     */
    setBlobUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return '';
    });
    setSrcKind('');
    setBlobEp(0);
    // 从选集页点进来的不算「接着看」，除非「接着看」按钮刚设过
    if (!drama) setResumeAt(0);
    setCurDuration(0);
    // 遮罩要在取新片**之前**就挂上，否则空 src 的那一帧会闪一帧黑屏/旧画面
    setDlLoading(true);
    setDlError('');
    setBusyStall(false);
    mediaBroken.current = false;
    if (mediaErrTimer.current) { window.clearTimeout(mediaErrTimer.current); mediaErrTimer.current = null; }

    setPicked(d);
    setDrawer(false);
    setCinema(false);
    setCurrentEp(n);
    setEpTotal(guessTotal(d));
    setPage('player');
    diag('切到', { 剧: d.title, 集: n, 剧id: d.id ? d.id.slice(0, 22) : '没有' });
    const st = epState(d.title, n);
    if (st === 'phone') loadFromPhone(d.title, n);
    else if (st === 'mac') loadFromMac(d.title, n);
    else if (d.id && online) loadOnline(d.id, n);
    else {
      setDlLoading(false);
      setDlError('这一集电脑上没有，手机上也没有');
    }
  }, [picked, epState, loadFromPhone, loadFromMac, loadOnline, online, guessTotal, closeOnline, resolveDramaId]);

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

  /**
   * 只要「不在播放页了」就把在线流收掉、播放位还回去。
   *
   * 之前只有两个时机：切集时（playEpisode 里）和整个页面被回收时（pagehide）。
   * **中间漏了一大段**：从播放页按返回回选集页、点标题栏回聊天页、
   * 打开选集抽屉挑另一部 —— 这些都会让流一直挂着、名额一直占着。
   * 名额一共才 2 个（实测），漏两三次就再也开不出新片了。
   *
   * 靠 `page !== 'player'` 触发，而不是在每个返回按钮上补 —— 少一个入口就少一处漏。
   */
  useEffect(() => {
    if (page === 'player') return;
    closeOnline();
  }, [page, closeOnline]);

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
  // 所以这两段连同 savingOne / saveProgress 一起清掉了。存进手机统一走 startPhoneDownload。
  const delPhoneEp = async (d: DramaRef, ep: number) => {
    const ph = findPhoneDrama(phoneList, d.title);
    if (!ph) return;
    await deletePhoneEpisode(ph.key, ep);
    await reloadPhone();
    addToast(`第 ${ep} 集已从手机删掉`, 'success');
  };


  // ── 下载到手机（一步到位，10-06 按用户要求重做）──────────────
  /**
   * 电脑那边**照旧得先下** —— 往手机拷的就是电脑磁盘上的文件，电脑没有就没什么可拷。
   * 但这一步**对用户不可见**：下完一集就立刻拷一集，全程只有一个进度
   * 「已存进手机 x/N」。不用管中间发生了什么，也不用再去缓存剧库点第二次。
   *
   * 之前是两段式（等整部下完 → 再统一拷），用户看到「正在下到电脑 12/58」干等，
   * 拷的时候还得自己去缓存剧库找这部剧再点一次 —— 反馈是「整个下载逻辑又有点乱」。
   */
  const [phoneDl, setPhoneDl] = useState<{ title: string; id: string; want: number[]; saved: number[] } | null>(null);
  /** 这一轮正在拷哪一集，避免下一轮又挑到同一集 */
  const phoneDlBusy = useRef(false);
  /** 试过一次还拿不到的集，别无限重试 */
  const phoneDlSkip = useRef<Set<number>>(new Set());
  /** 上次真往手机里存进一集的时间 —— 10 分钟没进展就认输，别让人干等 */
  const phoneDlAt = useRef(0);
  /**
   * 定时器的闭包会一直拿着 effect 建立那一刻的 phoneDl，saved 永远停在初始值，
   * 同一集会被反复挑中。用 ref 拿最新的。
   */
  const phoneDlRef = useRef(phoneDl);
  useEffect(() => { phoneDlRef.current = phoneDl; }, [phoneDl]);

  /** 点「下载到手机」。只此一个入口，没有中间步骤。 */
  /**
   * 开始把指定的那几集下载到手机。`eps` 是**明确的集号列表**（不是「前 N 集」），
   * 所以「点一下下整部」和「选了 2-20 才下」走的是同一条路，只是列表不同。
   *
   * 界面，全程只有这一个进度「已存进手机 x/N」：
   *   电脑上没有这部 → 先排进短剧库的队列让它下，下完一集立刻拷一集到手机
   *   电脑上有 → 直接开始拷
   */
  const startPhoneDownload = async (d: DramaRef, eps: number[]) => {
    if (!online) return addToast('还没连上电脑，先连上才能下载', 'error');
    if (phoneDlRef.current) return addToast('还有一部在下，等它下完', 'info');
    if (!eps.length) return addToast('一集都没选', 'info');
    // 手机里已经有的先划掉，别白下一遍
    const need = eps.filter((n) => epState(d.title, n) !== 'phone').sort((a, b) => a - b);
    if (!need.length) return addToast('这几集手机里已经有了', 'info');

    phoneDlSkip.current = new Set();
    phoneDlAt.current = Date.now();
    setPhoneDl({ title: d.title, id: d.id, want: need, saved: [] });

    // 电脑上一集都没有 → 排进短剧库的队列让它开始下，下载在它那边后台进行
    const mac = macByDrama.get(d.title);
    if (!mac || !mac.eps.length) {
      if (!d.id) {
        setPhoneDl(null);
        return addToast('没认出这部剧的编号，下不了', 'error');
      }
      try {
        await queueDownload(addr, [d.id], 0);
      } catch (e: any) {
        setPhoneDl(null);
        return addToast(`电脑那边没接下：${e?.message || '下不了'}`, 'error');
      }
    }
  };

  /**
   * 打开选集窗。默认全选 = 整部，用户可以改成「只要 2-20」。
   *
   * 「全选」按**磁盘上真有的集**给，不是按系统那份假名单 —— 否则会默认勾上
   * 几百集下不下来的，用户一脸莫名其妙还得自己一个个取消。
   */
  const openDownloadPicker = (d: DramaRef, total: number) => {
    const mac = macByDrama.get(d.title);
    const onDisk = mac?.eps || [];
    let avail = onDisk.filter((n) => epState(d.title, n) !== 'phone').sort((a, b) => a - b);
    /**
     * 电脑上**一集都还没有**时（剧库首页那批从没下过的），照样给选集窗，
     * 可选集用全剧集号。
     *
     * 之前的做法是退化成一个「整部下」按钮 —— 用户反馈「还是只能整部下载」。
     * 现在按他的原话做：**电脑照旧下整部（那是电脑自己的队列），
     * 手机只拷他选中的那几集**，拷完就停，剩下的电脑继续下它的。
     */
    if (!avail.length && total > 0) {
      avail = Array.from({ length: total }, (_, i) => i + 1)
        .filter((n) => epState(d.title, n) !== 'phone');
    }
    setDlPick({ title: d.title, avail, total, allFromNetwork: avail.length > 0 && onDisk.length === 0 });
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

  /**
   * 主循环：每隔一会儿看一次「电脑磁盘上现在真有哪些集」，
   * 有新的、手机里还没有的，就立刻拷一集过来。
   *
   * 一次只拷一集：同时下好几集会把 WiFi 带宽吃满，失败时也不好定位是哪一集。
   * 实测电脑下单集只要 4 秒，串行拷完全够快。
   */
  useEffect(() => {
    if (!phoneDl) return;
    let alive = true;
    const pump = async () => {
      if (phoneDlBusy.current || !alive) return;
      const cur = phoneDlRef.current;
      if (!cur) return;
      phoneDlBusy.current = true;
      const { title, want } = cur;
      // want 现在是**明确的集号列表**（选集窗可能只选了 2-20），不是「前 N 集」
      const wantSet = new Set(want);
      const coverUrl = dramas.find((x) => x.title === title)?.coverUrl;
      try {
        // 直接问转发服务要磁盘上真实存在的集（短剧库那份 playable 名单会骗人）
        const eps = await fetchLocalEpisodes(addr, title);
        if (!alive || !eps) return;
        setLocalEps((old) => { const m = new Map(old); m.set(title, eps); return m; });

        const savedSet = new Set(cur.saved);
        const next = eps
          .filter((n) => wantSet.has(n) && !savedSet.has(n) && !phoneDlSkip.current.has(n))
          .sort((a, b) => a - b)[0];

        if (next === undefined) {
          // 一个都没有了：要么全下完，要么剩下的电脑拉不下来
          const stalled = Date.now() - phoneDlAt.current > MAC_FETCH_TIMEOUT;
          if (savedSet.size >= want.length || stalled) {
            setPhoneDl(null);
            await reloadPhone();
            if (savedSet.size > 0) {
              addToast(
                savedSet.size >= want.length
                  ? `${savedSet.size} 集都存进手机了，断网也能看`
                  : `存了 ${savedSet.size}/${want.length} 集，剩下几集电脑那边拉不下来`,
                savedSet.size >= want.length ? 'success' : 'error'
              );
            }
          }
          return;
        }

        // 先占住（saved 立刻加上），成功失败都在里面，失败会进 skip
        setPhoneDl((d) => (d ? { ...d, saved: [...d.saved, next] } : d));
        try {
          await downloadEpisodeToPhone(
            localVideoUrl(addr, title, next),
            { title, coverUrl, origin: 'mac' },
            next,
            (loaded, total) => { if (total > 0) setSaveEpProgress({ ep: next, pct: loaded / total }); }
          );
          setSaveEpProgress(null);
          phoneDlAt.current = Date.now();
          await reloadPhone();
        } catch {
          // 这一集电脑上说有、实际取不到：记住并跳过，别卡在这集上无限重试
          phoneDlSkip.current.add(next);
          setSaveEpProgress(null);
          diag('这一集没存成，跳过', { 剧: title, 集: next });
        }
      } finally {
        phoneDlBusy.current = false;
      }
    };
    pump();
    const timer = window.setInterval(pump, 1200);
    return () => { alive = false; window.clearInterval(timer); };
    // 只在「下载的是哪部剧」变化时重建定时器；进度变化靠 ref 读，不重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneDl?.title, addr]);



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

  const macItemsAll = useMemo<DramaRef[]>(() => {
    const out: DramaRef[] = [];
    macByDrama.forEach((v, title) => {
      const cover = dramas.find((d) => d.title === title)?.coverUrl;
      out.push({ id: v.dramaId, title, coverUrl: cover, origin: 'mac' });
    });
    return out.sort((a, b) => (macByDrama.get(b.title)?.eps.length || 0) - (macByDrama.get(a.title)?.eps.length || 0));
  }, [macByDrama, dramas]);

  /** 缓存剧库列表 = 全部减去「被长按移走」的（只影响手机列表，不碰电脑上的文件） */
  const macItems = useMemo(
    () => macItemsAll.filter((d) => !macHidden.includes(d.title)),
    [macItemsAll, macHidden]
  );

  const hideMacDrama = useCallback((title: string) => {
    setMacHidden((old) => {
      if (old.includes(title)) return old;
      const next = [...old, title];
      try { localStorage.setItem(MAC_HIDDEN_KEY, JSON.stringify(next)); } catch { /* 存不下就算了 */ }
      return next;
    });
    addToast(`《${title}》手机端已移除，电脑里的文件没动`, 'success');
  }, [addToast]);

  const restoreMacHidden = useCallback(() => {
    setMacHidden([]);
    try { localStorage.removeItem(MAC_HIDDEN_KEY); } catch { /* 忽略 */ }
    addToast('都恢复了', 'success');
  }, [addToast]);

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


  // ═══════════ 页面 1：列表 ═══════════
  if (page === 'list') {
    const homeList = homeItems.slice(0, visible);

    return (
      <div className={`absolute inset-0 flex flex-col ${p.page}`}>
        <TopBar
          p={p}
          title="剧场"
          onBack={() => { closeOnline(); if (activeCharacterId) jumpToChat(activeCharacterId); }}
          right={
            <div className="flex items-center gap-2">
              {/* 取证用：海报出不来时点开，让页面自己报告每张图卡在哪一步 */}
              <button onClick={() => setDiagOpen(true)} title="海报诊断"
                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-white/70'}`}>
                <FilmSlate size={18} className={p.sub} />
              </button>
              <button onClick={() => setPage('settings')} className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center active:scale-95 ${p.night ? 'bg-[#1e293b]' : 'bg-white/70'}`}>
                <GearSix size={18} className={p.sub} />
              </button>
            </div>
          }
        />

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

              {online && homeList.length === 0 && <Empty p={p} text={searched ? '没搜到' : '这个筛选下没有剧'} />}
              {online && homeList.length > 0 && (
                <Grid
                  p={p}
                  addr={addr}
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
              {!online && <Empty p={p} text="没连上电脑看不到缓存" />}
              {online && macItems.length === 0 && (
                macHidden.length > 0 ? (
                  /* 全被长按移走了 —— 给一条回来的路，不然用户以为剧没了 */
                  <div className="py-10 text-center">
                    <p className={`text-xs mb-3 leading-relaxed ${p.sub}`}>
                      你移走了 {macHidden.length} 部。<br />
                      电脑里的文件都还在，没删。
                    </p>
                    <button
                      onClick={restoreMacHidden}
                      className="rounded-full bg-sky-500 px-5 py-2.5 text-xs font-bold text-white active:scale-95"
                    >
                      全部恢复
                    </button>
                  </div>
                ) : (
                  <Empty p={p} text="短剧库里还没有下载好的剧" />
                )
              )}
              {online && macItems.length > 0 && (
                <>
                  <div className={`text-[11px] mb-3 text-center ${p.sub}`}>
                    电脑上缓存了 {macItems.length} 部 · 这些要连着电脑才看得成<br />
                    <span className="text-slate-300">长按某部可以把它从这页移走（不会删电脑里的文件）</span>
                  </div>
                  <Grid
                    p={p}
                    addr={addr}
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
                    onHold={(it) => hideMacDrama(it.key)}
                  />
                  {/* 恢复提示放最底下（用户 10-06 19:16 要求） */}
                  <p className={`mt-4 text-center text-[10px] leading-relaxed ${p.sub}`}>
                    已移除剧集可搜索重新下载恢复
                  </p>
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

              {phoneList.length === 0 && <Empty p={p} text="手机里还没有剧，先从电脑上存几集过来" />}
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
                            className="shrink-0 w-14 h-[4.2rem] rounded-xl overflow-hidden flex items-center justify-center relative cursor-pointer active:scale-95"
                            style={{ background: d.coverUrl ? undefined : (p.night ? '#0f172a' : '#f1f5f9') }}
                          >
                            {d.coverUrl
                              ? <CoverImg p={p} src={coverSrc(addr, d.coverUrl)} />
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
              {watchItems.length === 0 && <Empty p={p} text="还没看过剧\n看过的会自动记在这儿" />}
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
                          className="shrink-0 w-12 h-16 rounded-xl overflow-hidden flex items-center justify-center relative cursor-pointer active:scale-95"
                          style={{ background: p.night ? '#0f172a' : '#f1f5f9' }}
                        >
                          {w.coverUrl
                            ? <CoverImg p={p} src={coverSrc(addr, w.coverUrl)} />
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
                          /* 剧 id 必须一起传过去（原来硬编码 id: ''）：
                             没它就判不出「这一集能在线播」，直接弹「这一集电脑上没有」。
                             老的追剧条目没存 dramaId，playEpisode 里的 resolveDramaId
                             会再按剧名兜底查一次。 */
                          onClick={() => {
                            // 记着上次看到哪儿，「接着看」才真的是接着看
                            setResumeAt(Math.max(0, Number(w.position) || 0));
                            playEpisode(w.episode, { id: w.dramaId || '', title: w.title, coverUrl: w.coverUrl, origin: 'mac' });
                          }}
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
        {diagOpen && <CoverDiagModal p={p} addr={addr} onClose={() => setDiagOpen(false)} />}
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
    /**
     * 「正在往手机里下」的是不是当前这部剧。
     *
     * ⚠️ 这个必须提到 return 之前、跟其它值一个层级 —— 10-06 下午在这儿栽了：
     * 它原来是写在下面那个当场执行的小函数里的，**只有按钮那段能用**，
     * 而进度条在函数外面 → 真机直接 `ReferenceError: mine is not defined`，
     * 整个剧场页崩掉。作用域不对的错 `vite build` 是拦不住的
     * （esbuild 只转译不做检查），所以别再往那个小函数里塞外面要用的值。
     */
    const mine = phoneDl?.title === picked.title ? phoneDl : null;

    return (
      <div className={`absolute inset-0 flex flex-col ${p.page}`}>
        <TopBar p={p} title={picked.title} onBack={() => setPage('list')} />

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4">
          {/* 头：封面 + 三个状态说清楚 */}
          <div className="flex gap-3">
            <div className="w-20 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center relative" style={{ height: '6.7rem', background: p.night ? '#0f172a' : '#e2e8f0' }}>
              {picked.coverUrl && <CoverImg p={p} src={coverSrc(addr, picked.coverUrl)} />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className={`text-sm font-bold leading-snug ${p.title}`}>{picked.title}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {phoneEps.length > 0 && <Tag tone="ok">手机 {phoneEps.length} 集</Tag>}
                {macEps.length > 0 && <Tag tone="mac">电脑 {macEps.length} 集</Tag>}
                {total > 0 && <Tag tone="no">共 {total} 集</Tag>}
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                {/**
                 * 只有一个「下载到手机」入口，点了就下，没有中间步骤、不弹选择窗。
                 * 电脑上没缓存这部也一样下 —— 内部会先让电脑把它下下来、下完一集拷一集，
                 * 这一段对用户完全不可见（10-06 明确要求：别让他自己去缓存剧库点第二次）。
                 *
                 * 手机里已经有的不算进 want，所以按钮上的数字是「还要下几集」。
                 */}
                {(() => {
                  const pending = Math.max(
                    0,
                    total - new Set(phoneEps).size
                  );
                  if (pending === 0) {
                    return (
                      <Pill tone={p} disabled>
                        {phoneEps.length > 0 ? `手机里 ${phoneEps.length} 集都存好了` : '手机里还没存'}
                      </Pill>
                    );
                  }
                  return (
                    <Pill
                      primary
                      tone={p}
                      onClick={() => openDownloadPicker(picked, total)}
                      disabled={!online || !!phoneDl}
                    >
                      {mine
                        ? `下载到手机 ${mine.saved.length}/${mine.want.length}`
                        : `下载到手机（${pending} 集）`}
                    </Pill>
                  );
                })()}
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
              {mine && (
                /* 一条进度：从 0 走到 100%，全程只有这一个。
                   集内的字节进度也算进去，不然一集十几 MB、
                   整条进度条从头到尾纹丝不动，看着像卡死了。 */
                <div className="mt-2 flex items-center gap-2">
                  <div className={`flex-1 h-1 rounded-full overflow-hidden ${p.night ? 'bg-[#334155]' : 'bg-slate-100'}`}>
                    <div
                      className="h-full bg-sky-400 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((mine.saved.length - 1 + (saveEpProgress?.pct || 0)) / mine.want.length) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">
                    {saveEpProgress
                      ? `${mine.saved.length}/${mine.want.length} · 第 ${saveEpProgress.ep} 集 ${Math.round(saveEpProgress.pct * 100)}%`
                      : `${mine.saved.length}/${mine.want.length}`}
                  </span>
                  <button onClick={() => { setPhoneDl(null); setSaveEpProgress(null); }} className="shrink-0 text-[10px] text-rose-400">停</button>
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
            // 一集都没勾就是不下，不偷偷变成「整部下」
            if (!eps.length) return;
            await startPhoneDownload(d, eps);
          }}
          fromNetwork={!!dlPick?.allFromNetwork}
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
          p={p}
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
          loadHint={srcKind === 'online' ? '正在从电脑取这一集（边下边播）' : srcKind === 'phone' ? '正在打开手机里的这一集' : '正在从电脑取这一集'}
          error={dlError}
          onRetry={() => (st === 'phone' ? loadFromPhone(picked.title, currentEp) : loadFromMac(picked.title, currentEp))}
          onClearAll={busyStall ? clearStallsAndRetry : undefined}
          hasNext={nextSt !== 'none'}
          onNext={() => playEpisode(currentEp + 1)}
          onMediaError={onMediaError}
          onMediaReady={onMediaOk}
          onVideoEl={live.attachVideo}
          resumeAt={resumeAt}
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

        {/* 聊天区 + 输入框（第 2 步：接 live） */}
        <TheaterChat p={p} live={live} charName={char?.name} disabled={!char} />

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
          savingAll={!!phoneDl}
        />
      </div>
    );
  }

  // ═══════════ 页面 4：设置 ═══════════
  return (
    <div className={`absolute inset-0 flex flex-col ${p.page}`}>
      <TopBar p={p} title="剧场设置" onBack={() => setPage('list')} />

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-3">
        {/* 暮色 22:10：放在设置最上面 + 折叠 */}
        <LiveConfigCard p={p} cfg={liveCfg} onSave={(c) => { saveLiveConfig(c); setLiveCfg(loadLiveConfig()); }} />

        <SectionCard p={p} title="夜间模式" desc="只在剧场里换皮，不动其他 app。默认跟着手机系统的深浅色走。">
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

        <SectionCard p={p} title="自动连播" desc="一集放完自动接下一集。下一集手机和电脑都没有的时候不会瞎跳。">
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

        <SectionCard p={p} title="手机里的剧" desc={`${usage.dramas} 部 · ${usage.count} 集 · 占了 ${fmtBytes(usage.bytes)}`}>
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

        <SectionCard p={p} title="连你的电脑" desc="电脑上打开短剧库和「剧场转发」，它会显示一个地址。手机连同一个 WiFi，填进去就行。">
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
          <SectionCard p={p} title="之前连过">
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

        <SectionCard p={p} title="出门在外" desc="装了 Tailscale 之后，出门也能连上家里。不想带电脑就先「存到手机」，存完跟电脑无关，断网也能看。">
          <div className="flex justify-center">
            <Pill tone={p} onClick={() => { setPage('list'); setTab('phone'); }}>去本地剧库</Pill>
          </div>
        </SectionCard>

        {/**
         * 第 2 步的前置闸门：连不上实时接口，后面全部白做。
         * 三步递进测试的原因写在这个组件的注释里，别删。
         */}
        <SectionCard p={p} title="实时模型（接下来接）" desc="测一下这台手机能不能连上。分三步，一步步卡住了会告诉你卡在哪。">
          <div className="flex flex-col items-center gap-2">
            <Pill tone={p} onClick={() => setProbeOpen(true)}>测一下能不能连</Pill>
            <p className={`text-[10px] text-center ${p.faint}`}>
              用的密钥：{maskLiveKey(liveCfg.apiKey)}
            </p>
          </div>
        </SectionCard>

        {probeOpen && (
          <LiveProbeModal p={p} apiKey={liveCfg.apiKey} model={liveCfg.model} baseUrl={liveCfg.baseUrl} onClose={() => setProbeOpen(false)} />
        )}

        <div className="text-center text-[10px] text-slate-300 pt-2 pb-6">
          第 1 步 · 还不接 AI，第 2 步才接
        </div>
      </div>
    </div>
  );
};

export default TheaterApp;
