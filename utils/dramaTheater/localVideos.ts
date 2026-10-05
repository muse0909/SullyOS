/**
 * 剧场 · 手机本地剧库
 *
 * 暮色 2026-10-05 定的语义：
 *   - 「缓存剧库」= 电脑上短剧库已经下好的
 *   - 「本地剧库」= **真的躺在手机里**的（存过来的 + 自己上传的）
 * 这两个以前混在一个「已下载」标签里，点完「存到手机」用户根本不知道
 * 到底存没存进手机、存了多少、怎么删。这一层就是把「在手机里」这件事做实。
 *
 * 视频本体（暮色定：App 私有位置，不污染系统电影目录）：
 *   <Data>/theater/phone/<safeKey>/<ep>.mp4
 *
 * 索引放 localStorage，不放文件里 —— 这是被真机教训逼的：
 *   索引要判断「文件在不在」，如果用 Filesystem.readFile 去读一个不存在的
 *   index.json，Capacitor 插件会 call.reject("File does not exist", ex)
 *   （FilesystemPlugin.java:72），这个 reject 会冒到页面 console.error，
 *   而 app 那边（context/OSContext.tsx:1034）劫持了 console.error 把报错全收进
 *   systemLogs，状态栏就挂一个红条「SYSTEM ERROR」。
 *   索引本身只有几 KB，放 localStorage 既同步又不会报错，还跟着 app 一起备份。
 *   Filesystem 只剩「写视频 / 删视频 / 取文件地址」这几个动作，都不会凭空报错。
 */

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const ROOT = 'theater/phone';
const INDEX_KEY = 'theater_phone_index';

export type PhoneEpisode = {
  episode: number;
  size: number;      // 字节，存进去的时候量的
  savedAt: number;
  duration?: number; // 秒，能拿到就记，第 4 步摘要要用
};

export type PhoneDrama = {
  key: string;        // 内部唯一键（剧名哈希），文件目录名
  title: string;      // 给人看的剧名
  coverUrl?: string;
  origin: 'mac' | 'upload'; // mac = 从电脑存过来的；upload = 手机自己传的
  createdAt: number;
  updatedAt: number;
  episodes: PhoneEpisode[];
};

const isNative = () => Capacitor.isNativePlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || '');
      resolve(s.includes(',') ? s.split(',')[1] : s);
    };
    fr.onerror = () => reject(new Error('文件读不出来'));
    fr.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, type = 'video/mp4'): Blob {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/**
 * 目录**不要**用 Filesystem.mkdir 单独建。
 *
 * 2026-10-05 真机定位到的（暮色反馈「每一集都会报个 [object object]」，真机上
 * 抓到 33 条 console.error，全是 {"message":"Directory exists"}）：
 *
 *   1. Filesystem.java:80-85 —— mkdir 一进来就 `if (fileObject.exists()) throw
 *      new DirectoryExistsException("Directory exists")`，**recursive: true 也一样**
 *      先判存在。所以一部剧下第 2 集开始，每集都撞一次。
 *   2. @capacitor/core/dist/index.js:137 —— `const handleError = (err) =>
 *      win.console.error(err)`。**Capacitor 核心把所有原生 reject 都丢给
 *      console.error，在你自己 catch 之前就打了**。
 *   3. context/OSContext.tsx:1034 劫持了 console.error 把报错收进 systemLogs
 *      → 状态栏红条，调试终端里显示成 [object Object]。
 *
 * 也就是说**这个错误 try/catch 消不掉**，只能压根别触发。
 * 而 FilesystemPlugin.java:110 里 writeFile 传 recursive: true 就会自己
 * `fileObject.getParentFile().mkdirs()`，目录已存在时走 exists() 分支不报错 ——
 * 所以父目录交给 writeFile 建就行，这一段整体删掉。
 */
function ensureDir(_sub = ''): void {
  // 故意留空：写文件时 recursive: true 会自己建父目录。
  // 真去调 Filesystem.mkdir 会每集产生一次 "Directory exists" reject，
  // 而 Capacitor 核心会把它打上 console.error → 状态栏红条。
}

/**
 * 目录名不能直接用剧名：
 *   1. 剧名里有 / : * ? " < > | 会建不出目录
 *   2. 安卓单个文件名上限 255 字节，中文一字 3 字节，长剧名会直接创建失败
 * 所以截断 + 挂个短哈希，既能认得出又保证不撞车。
 */
export function dramaKey(title: string): string {
  const safe = (title || '未命名').replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 40);
  let h = 0;
  for (let i = 0; i < (title || '').length; i++) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  return `${safe}_${h.toString(36)}`;
}

function epPath(key: string, episode: number): string {
  return `${ROOT}/${key}/${String(episode).padStart(3, '0')}.mp4`;
}

// ── 索引 ──

function readIndex(): PhoneDrama[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter((d) => d && typeof d.key === 'string')
      .map((d: any) => ({
        key: d.key,
        title: d.title || '未命名',
        coverUrl: d.coverUrl,
        origin: d.origin === 'upload' ? 'upload' : 'mac',
        createdAt: d.createdAt || Date.now(),
        updatedAt: d.updatedAt || d.createdAt || Date.now(),
        episodes: Array.isArray(d.episodes) ? d.episodes : [],
      }));
  } catch {
    return [];
  }
}

function writeIndex(list: PhoneDrama[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // 存不下就还是留在内存里这次会话用着，不崩
  }
}

// ── 查询 ──

export async function listPhoneDramas(): Promise<PhoneDrama[]> {
  if (!isNative()) return [];
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findPhoneDrama(list: PhoneDrama[], title: string): PhoneDrama | undefined {
  const k = dramaKey(title);
  return list.find((d) => d.key === k);
}

export function hasPhoneEpisode(list: PhoneDrama[], title: string, episode: number): boolean {
  const d = findPhoneDrama(list, title);
  return !!d?.episodes.some((e) => e.episode === episode);
}

export function phoneEpisodeSize(list: PhoneDrama[], title: string, episode: number): number {
  const d = findPhoneDrama(list, title);
  return d?.episodes.find((e) => e.episode === episode)?.size || 0;
}

/**
 * 拿这一集在手机里的地址，交给播放器直接播（断网也能看）。
 *
 * **必须过 Capacitor.convertFileSrc**，不能把 Filesystem.getUri 给的 file:// 直接用。
 * 真机 10-05 踩的：图上写着「这个本地地址播不了，换个方式再试…」，兜底也失败。
 * 原因是本项目的 androidScheme 是 https（capacitor.config.json），WebView 的
 * origin 被设成 https://localhost，页面里直接塞 file:// 属于跨源，内核不放行。
 * convertFileSrc 就是官方给这个场景的转换：把本地路径翻译成 WebView 认得的地址。
 * 它是同步的，不碰磁盘，也不会触发任何原生 reject（不产生红条）。
 */
export async function phoneEpisodeUri(key: string, episode: number): Promise<string> {
  const path = epPath(key, episode);
  if (!Capacitor.isNativePlatform()) return path;
  // getUri 拿的是标准的 files/data 绝对路径，convertFileSrc 要的就是这个
  const r = await Filesystem.getUri({ path, directory: Directory.Data });
  return Capacitor.convertFileSrc(r.uri);
}

// ── 写入 ──

/**
 * 把一集从电脑上直接下进手机 —— **走原生下载，网页侧一个字节都不碰**。
 *
 * 为什么不能走「取回来 → 转 base64 → 写文件」（原来那条路）：
 * 真机 22:30 直接闪退，日志是 Java 侧的内存爆：
 *
 *   java.lang.OutOfMemoryError: Failed to allocate a 74064696 byte allocation
 *     at java.lang.StringUTF16.newBytesFor(StringUTF16.java:50)
 *     at java.lang.AbstractStringBuilder.append(...)
 *     at com.getcapacitor.Bridge.callPluginMethod(Bridge.java:815)
 *
 * 拆开看就是：一集 11.9 MB → base64 变 ~16 MB 字符串 → 交给原生写文件时，
 * Java 侧 StringBuilder 再把它拼一遍（UTF-16 一次 74 MB 分配）→ WebView 的
 * 256 MB 上限穿顶。日志里「只剩 24 MB 可用、已占 250 MB」说明**不是单集太大，
 * 是内存里本来还堆着别的东西**（没释放的临时地址、在线流…）——这条路迟早炸，
 * 攒到哪一集就随机在哪一集炸。之前整部能下完只是当时还扛得住。
 *
 * `Filesystem.downloadFile` 是原生自己发 HTTP 请求、自己写文件，
 * JS 这边只递一个 URL 字符串过去，内存占用是常数级。
 *
 * ⚠️ **它不会建父目录。** `Filesystem.java:349` 直接 `getFileObject` 就开写，
 * 目录不存在就是 `open ENOENT`（真机 23:23 全军覆没就是这个）。
 * 只有 `writeFile` 会建（`FilesystemPlugin.java:111`：
 * `recursive && fileObject.getParentFile().mkdirs()`）。
 * 而 `mkdir` 不能拿来预建 —— 目录已存在时它**照样 reject**
 * （`Filesystem.java:80-85`），而任何原生 reject 都会被 Capacitor 打上
 * console.error（`@capacitor/core/dist/index.js:137`）→ 状态栏红条。
 *
 * 所以这里的做法是：**先用 writeFile 写一个 0 字节占位文件把目录顶出来**
 * （它带 recursive，会把 `theater/phone/<剧名>/` 一路建好），
 * 下完再把占位文件删掉。全程不报错、不占内存。
 */
export async function downloadEpisodeToPhone(
  url: string,
  meta: { title: string; coverUrl?: string; origin: 'mac' | 'upload' },
  episode: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<PhoneEpisode> {
  if (!Capacitor.isNativePlatform()) throw new Error('只有装成 App 才能存到手机');

  const key = dramaKey(meta.title);
  const rel = epPath(key, episode);
  const keeper = `${ROOT}/${key}/.keep`;

  // 把目录顶出来。data 传空串 → 走 Base64.decode("") → 0 字节文件，
  // 但 `recursive: true` 已经把整条父目录链建好了，那才是我们要的。
  await Filesystem.writeFile({
    path: keeper,
    data: '',
    directory: Directory.Data,
    recursive: true,
  });

  let handle: { remove: () => Promise<void> } | null = null;
  // 原生只报「已下字节 / 总字节」，下完最后一个事件的 contentLength 就是文件真实大小。
  // 索引里的 size 要靠它 —— 没有 onProgress 就只能记 0（「占多少空间」显示不出数，
  // 但不影响播放，播放读的是文件本身不是索引）。
  let lastTotal = 0;
  if (onProgress) {
    handle = await Filesystem.addListener('progress', (p) => {
      // 原生只认自己发起的那次下载，按 url 对一下，别把别的下载的进度算到这一集头上
      if (p.url && p.url !== url) return;
      lastTotal = Number(p.contentLength || 0);
      onProgress(Number(p.bytes || 0), lastTotal);
    });
  }

  try {
    await Filesystem.downloadFile({
      url,
      path: rel,
      directory: Directory.Data,
      // 这个参数对 downloadFile **无效**（它压根不建目录），
      // 留着只是防止以后 Capacitor 改了实现。目录靠上面那个占位文件。
      recursive: true,
    });
  } finally {
    if (handle) await handle.remove().catch(() => {});
    // 占位文件收掉。它是我们自己刚建的，deleteFile 一定成功；
    // 万一失败就留着（0 字节，无害），也绝不在这里抛 —— 视频已经下好了。
    Filesystem.deleteFile({ path: keeper, directory: Directory.Data }).catch(() => {});
  }

  const entry: PhoneEpisode = { episode, size: lastTotal, savedAt: Date.now() };
  const list = readIndex();
  let d = list.find((x) => x.key === key);
  if (!d) {
    d = {
      key,
      title: meta.title,
      coverUrl: meta.coverUrl,
      origin: meta.origin,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      episodes: [],
    };
    list.push(d);
  }
  d.title = meta.title;
  if (meta.coverUrl) d.coverUrl = meta.coverUrl;
  d.episodes = d.episodes.filter((e) => e.episode !== episode);
  d.episodes.push(entry);
  d.episodes.sort((a, b) => a.episode - b.episode);
  d.updatedAt = Date.now();
  writeIndex(list);
  return entry;
}

/**
 * 把一集真的写进手机。
 * blob 是已经取回来的视频字节（从电脑拿的），size 记进索引，「占多少空间」才有依据。
 *
 * ⚠️ 这条路**只给上传用**（用户自己选的视频，本来就在手机上，内存占用是它自己的）。
 * 从电脑下载**一定**要走 `downloadEpisodeToPhone`，理由见上面那条内存爆的日志。
 */
export async function saveEpisodeToPhone(
  meta: { title: string; coverUrl?: string; origin: 'mac' | 'upload' },
  episode: number,
  blob: Blob,
  duration?: number
): Promise<PhoneEpisode> {
  if (!isNative()) throw new Error('只有装成 App 才能存到手机');

  const key = dramaKey(meta.title);
  await ensureDir(key);

  // 大文件必须走 base64：Capacitor 写文件的 Android 实现就是
  // 「有 encoding 走文本，没 encoding 走 Base64.decode」——源码见
  // node_modules/@capacitor/filesystem/.../Filesystem.java 的 saveFile()。
  // 传 encoding 会被当纯文本写进去，视频直接坏掉。
  const base64 = await blobToBase64(blob);
  await Filesystem.writeFile({
    path: epPath(key, episode),
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });

  const entry: PhoneEpisode = { episode, size: blob.size, savedAt: Date.now(), duration };
  const list = readIndex();
  let d = list.find((x) => x.key === key);
  if (!d) {
    d = {
      key,
      title: meta.title,
      coverUrl: meta.coverUrl,
      origin: meta.origin,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      episodes: [],
    };
    list.push(d);
  }
  d.title = meta.title;
  if (meta.coverUrl) d.coverUrl = meta.coverUrl;
  d.episodes = d.episodes.filter((e) => e.episode !== episode);
  d.episodes.push(entry);
  d.episodes.sort((a, b) => a.episode - b.episode);
  d.updatedAt = Date.now();
  writeIndex(list);
  return entry;
}

/**
 * 上传一个视频。
 * 一次选多个文件时按顺序当成一部剧的连续几集 —— 用户一次选一整部剧是很常见的操作。
 */
export async function saveUploads(
  files: File[],
  opts: { name: string; coverUrl?: string }
): Promise<PhoneDrama> {
  if (!isNative()) throw new Error('只有装成 App 才能上传');
  if (!files.length) throw new Error('没选到文件');

  const name = opts.name.trim() || files[0].name.replace(/\.[^.]+$/, '');
  const key = dramaKey(name);
  await ensureDir(key);

  const list = readIndex();
  let d = list.find((x) => x.key === key);
  if (!d) {
    d = {
      key,
      title: name,
      coverUrl: opts.coverUrl,
      origin: 'upload',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      episodes: [],
    };
    list.push(d);
  }
  d.title = name;
  d.origin = 'upload';

  // 从已有的最大集数往后排，重复上传同名剧不会覆盖前面几集
  let next = d.episodes.length ? d.episodes[d.episodes.length - 1].episode + 1 : 1;

  for (const file of files) {
    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: file.type || 'video/mp4' });
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: epPath(key, next),
      data: base64,
      directory: Directory.Data,
      recursive: true,
    });
    d.episodes = d.episodes.filter((e) => e.episode !== next);
    d.episodes.push({ episode: next, size: blob.size, savedAt: Date.now() });
    next += 1;
  }

  d.episodes.sort((a, b) => a.episode - b.episode);
  d.updatedAt = Date.now();
  writeIndex(list);
  return d;
}

// ── 删除 / 清理 ──

export async function deletePhoneEpisode(key: string, episode: number): Promise<void> {
  if (!isNative()) return;
  const list = readIndex();
  const d = list.find((x) => x.key === key);
  if (d) {
    d.episodes = d.episodes.filter((e) => e.episode !== episode);
    d.updatedAt = Date.now();
    // 集数清空 = 这部剧在手机上没了，目录也一起收掉，别留空壳
    if (d.episodes.length === 0) {
      writeIndex(list.filter((x) => x.key !== key));
      await rmdirSafe(key);
      return;
    }
    writeIndex(list);
  }
  try {
    await Filesystem.deleteFile({ path: epPath(key, episode), directory: Directory.Data });
  } catch {
    // 文件可能已经不在了，索引先清掉更重要
  }
}

export async function deletePhoneDrama(key: string): Promise<void> {
  if (!isNative()) return;
  writeIndex(readIndex().filter((x) => x.key !== key));
  await rmdirSafe(key);
}

/** 全部清理：目录整个删掉，索引清空 */
export async function clearPhoneLibrary(): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.rmdir({ path: ROOT, directory: Directory.Data, recursive: true });
  } catch {
    // 目录本来就不在
  }
  writeIndex([]);
}

async function rmdirSafe(key: string): Promise<void> {
  try {
    await Filesystem.rmdir({ path: `${ROOT}/${key}`, directory: Directory.Data, recursive: true });
  } catch {
    // 可能还有别的集，先留着
  }
}

export async function phoneLibraryUsage(): Promise<{ bytes: number; count: number; dramas: number }> {
  const list = readIndex();
  let bytes = 0;
  let count = 0;
  list.forEach((d) =>
    d.episodes.forEach((e) => {
      bytes += e.size || 0;
      count += 1;
    })
  );
  return { bytes, count, dramas: list.length };
}

export function fmtBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
