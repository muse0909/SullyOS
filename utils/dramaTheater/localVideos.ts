/**
 * 剧场 · 手机本地剧库
 *
 * 暮色 2026-10-05 定的语义：
 *   - 「缓存剧库」= 电脑上短剧库已经下好的
 *   - 「本地剧库」= **真的躺在手机里**的（存过来的 + 自己上传的）
 * 这两个以前混在一个「已下载」标签里，点完「存到手机」用户根本不知道
 * 到底存没存进手机、存了多少、怎么删。这一层就是把「在手机里」这件事做实。
 *
 * 存在哪（暮色定：App 私有位置，不污染系统电影目录）：
 *   <Data>/theater/phone/<safeKey>/<ep>.mp4     视频本体
 *   <Data>/theater/phone/index.json              索引（剧名、集数、字节数、存的时间）
 *
 * 为什么索引要自己维护：Capacitor 的 Filesystem 只能列目录，不能查每个文件多大。
 * 存的时候我们自己记下字节数，显示「占了多少空间」和「清理」都靠这份索引。
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const ROOT = 'theater/phone';
const INDEX = 'theater/phone/index.json';
const BOOT_KEY = 'theater_phone_booted';

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

async function ensureDir(sub = ''): Promise<void> {
  const path = sub ? `${ROOT}/${sub}` : ROOT;
  try {
    await Filesystem.mkdir({ path, directory: Directory.Data, recursive: true });
  } catch (e: any) {
    // 已经存在时插件会报错，这里吞掉
    if (!String(e?.message || '').toLowerCase().includes('exist')) throw e;
  }
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

let indexReady: Promise<void> | null = null;

/**
 * 第一次进来先把索引文件建出来。
 *
 * 不能靠「先 readFile 读一下，读不到就当空」来探文件在不在 ——
 * Capacitor 的 Filesystem 插件读不到文件时会自己 console.error 一条
 * {message: "File does not exist"}，而 app 那边（context/OSContext.tsx:1034）
 * 劫持了 console.error 把所有报错收进 systemLogs，状态栏就会挂一个红条
 * 「SYSTEM ERROR」。真机 10-05 抓到的就是这条：剧场一打开必红。
 *
 * 所以这里用 localStorage 记一个「已经初始化过」，第一次直接把索引写出来，
 * 之后 readIndex 读的一定读得到，一次报错都不会有。
 */
function ensureIndex(): Promise<void> {
  if (!indexReady) {
    indexReady = (async () => {
      let booted = false;
      try { booted = localStorage.getItem(BOOT_KEY) === '1'; } catch {}
      if (booted) return;
      try {
        await ensureDir();
        await Filesystem.writeFile({
          path: INDEX,
          data: JSON.stringify([]),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        localStorage.setItem(BOOT_KEY, '1');
      } catch {
        // 建不出来就让下面的 readIndex 自己兜底
      }
    })().catch(() => {});
  }
  return indexReady;
}

async function readIndex(): Promise<PhoneDrama[]> {
  await ensureIndex();
  try {
    const r = await Filesystem.readFile({ path: INDEX, directory: Directory.Data, encoding: Encoding.UTF8 });
    const list = JSON.parse(r.data as string);
    if (!Array.isArray(list)) return [];
    // 兼容只有 uploaded 字段的老索引
    return list
      .filter((d) => d && typeof d.key === 'string')
      .map((d: any) => ({
        key: d.key,
        title: d.title || d.name || '未命名',
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

async function writeIndex(list: PhoneDrama[]): Promise<void> {
  await ensureDir();
  await Filesystem.writeFile({
    path: INDEX,
    data: JSON.stringify(list),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

export async function listPhoneDramas(): Promise<PhoneDrama[]> {
  if (!isNative()) return [];
  try {
    const list = await readIndex();
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
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

/** 拿这一集在手机里的真实文件地址，交给播放器直接播（断网也能看） */
export async function phoneEpisodeUri(key: string, episode: number): Promise<string> {
  const r = await Filesystem.getUri({
    path: epPath(key, episode),
    directory: Directory.Data,
  });
  return r.uri;
}

/**
 * 把一集真的写进手机。
 * blob 是已经取回来的视频字节（从电脑拿的），size 记进索引，「占多少空间」才有依据。
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
  const list = await readIndex();
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
  await writeIndex(list);
  return entry;
}

export async function deletePhoneEpisode(key: string, episode: number): Promise<void> {
  if (!isNative()) return;
  const list = await readIndex();
  const d = list.find((x) => x.key === key);
  if (d) {
    d.episodes = d.episodes.filter((e) => e.episode !== episode);
    d.updatedAt = Date.now();
    // 集数清空 = 这部剧在手机上没了，目录也一起收掉，别留空壳
    if (d.episodes.length === 0) {
      await writeIndex(list.filter((x) => x.key !== key));
      await rmdirSafe(key);
      return;
    }
    await writeIndex(list);
  }
  try {
    await Filesystem.deleteFile({ path: epPath(key, episode), directory: Directory.Data });
  } catch {
    // 文件可能已经不在了，索引先清掉更重要
  }
}

export async function deletePhoneDrama(key: string): Promise<void> {
  if (!isNative()) return;
  await writeIndex((await readIndex()).filter((x) => x.key !== key));
  await rmdirSafe(key);
}

/** 全部清理：目录整个删掉再重建，索引清空 */
export async function clearPhoneLibrary(): Promise<void> {
  if (!isNative()) return;
  try {
    await Filesystem.rmdir({ path: ROOT, directory: Directory.Data, recursive: true });
  } catch {
    // 目录本来就不在
  }
  await writeIndex([]);
}

async function rmdirSafe(key: string): Promise<void> {
  try {
    await Filesystem.rmdir({ path: `${ROOT}/${key}`, directory: Directory.Data, recursive: true });
  } catch {
    // 可能还有别的集，先留着
  }
}

export async function phoneLibraryUsage(): Promise<{ bytes: number; count: number; dramas: number }> {
  const list = await readIndex();
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

// ── 上传（手机自己选的视频）──

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

  const list = await readIndex();
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
  await writeIndex(list);
  return d;
}
