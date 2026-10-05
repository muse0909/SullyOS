/**
 * 剧场 · 手机本地视频（暮色定：存 App 私有位置）
 *
 * 用 @capacitor/filesystem 写在 App 自己的目录里，不污染用户的电影文件夹，
 * 卸载 App 才跟着没。
 *
 * 存的内容：
 *   <Data>/theater/videos/<id>.mp4          视频本体
 *   <Data>/theater/index.json              列表（名字、集数、时长）
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const DIR = 'theater';
const INDEX = 'theater/index.json';

export type UploadedVideo = {
  id: string;
  name: string;
  episodeCount: number;
  uri: string;
  poster?: string;
  size?: number;
  createdAt: number;
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

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true });
  } catch (e: any) {
    // 已存在时插件会报错，这里忽略
    if (!String(e?.message || '').toLowerCase().includes('exist')) throw e;
  }
}

async function readIndex(): Promise<UploadedVideo[]> {
  try {
    const r = await Filesystem.readFile({ path: INDEX, directory: Directory.Data, encoding: Encoding.UTF8 });
    const list = JSON.parse(r.data as string);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeIndex(list: UploadedVideo[]): Promise<void> {
  await Filesystem.writeFile({
    path: INDEX,
    data: JSON.stringify(list),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
  });
}

export async function listUploadedVideos(): Promise<UploadedVideo[]> {
  if (!isNative()) return [];
  try {
    const list = await readIndex();
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * 存一个视频到手机。
 * file 就是 <input type=file> 选出来的东西。
 */
export async function saveUploadedVideo(file: File, opts?: { name?: string; episodeCount?: number }): Promise<UploadedVideo> {
  if (!isNative()) throw new Error('只有装成 App 才能存');

  await ensureDir();

  const id = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = opts?.name?.trim() || file.name.replace(/\.[^.]+$/, '');
  const path = `${DIR}/${id}.mp4`;

  // 大文件走 blob 二进制，不要用 base64（体积会膨胀三分之一）
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'video/mp4' });
  const base64 = await blobToBase64(blob);

  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });

  const uriRes = await Filesystem.getUri({ directory: Directory.Data, path });

  const entry: UploadedVideo = {
    id,
    name,
    episodeCount: opts?.episodeCount || 1,
    uri: uriRes.uri,
    size: file.size,
    createdAt: Date.now(),
  };

  const list = await readIndex();
  list.push(entry);
  await writeIndex(list);
  return entry;
}

export async function deleteUploadedVideo(id: string): Promise<void> {
  if (!isNative()) return;
  const list = await readIndex();
  await writeIndex(list.filter((x) => x.id !== id));
  try {
    await Filesystem.deleteFile({ path: `${DIR}/${id}.mp4`, directory: Directory.Data });
  } catch {
    // 文件可能已经不在了，索引先清掉更重要
  }
}
