// 收藏数据存储 — localStorage
// 存储：语音收藏（用户发的 + AI 自动归档 + 用户主动星标）
// 后续：图片收藏 / 文字收藏

const STORAGE_KEY = 'sullyos_favorites_v1';

export interface FavoriteItem {
  id: string;
  type: 'voice' | 'image' | 'text';
  // voice: 新版不再存 blob URL（blob 跨页面失效），改为从 IndexedDB 读；
  //       URL 字段保留兼容老数据，读不到 blob 时回退用 url
  // image: 仍用 remote URL
  // text:  不需要 url
  url?: string;
  text: string;                         // UI 显示用（语音是文字版，文本是原文）
  charId: string;
  charName: string;                     // 冗余存，避免 char 改名后找不到
  sourceMessageId: string;              // 关联到原 message（voice 通过它定位到 voice_msg_${id} IndexedDB key）
  invalid?: boolean;                    // 远程 URL 失效 或 IndexedDB blob 丢失（voice/image 才有）
  starred?: boolean;                    // 用户主动加星标
  createdAt: number;
}

/**
 * 从 IndexedDB 读语音收藏的 blob。
 * voice favorite 通过 sourceMessageId 关联到 Chat 自己存的 voiceAssetKey(`voice_msg_${msgId}`)。
 * 返回 null 表示数据丢失（迁移前的老数据 / Chat 没存过 / IndexedDB 被清）。
 */
export async function getFavoriteVoiceBlob(sourceMessageId: string): Promise<Blob | null> {
  try {
    const { DB } = await import('./db');
    const entry = await DB.getAssetRaw(`voice_msg_${sourceMessageId}`);
    if (entry && entry.blob instanceof Blob) return entry.blob;
    return null;
  } catch {
    return null;
  }
}

/**
 * 云端音频 URL（拼出来，不发起请求）
 * 升级方案：2026-07-13 把收藏的语音从 IndexedDB 搬到 Netlify Blobs。
 * 浏览器跨设备/换浏览器/清缓存都能用，IndexedDB 跟着浏览器走会丢。
 */
export function getFavoriteVoiceCloudUrl(sourceMessageId: string): string {
    return `/api/v1/voice-favorite-store?key=${encodeURIComponent(sourceMessageId)}`;
}

/**
 * 上传语音到云端
 * 成功返回 URL（其实就是 getFavoriteVoiceCloudUrl 的结果），失败返回 null
 * 调用方拿到 URL 后调 updateFavorite(id, { url }) 存到元数据
 */
export async function uploadVoiceFavorite(sourceMessageId: string, blob: Blob): Promise<string | null> {
    try {
        const url = getFavoriteVoiceCloudUrl(sourceMessageId);
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': blob.type || 'audio/mpeg' },
            body: blob,
        });
        if (!res.ok) {
            console.warn('[favorites] cloud upload failed', res.status, await res.text().catch(() => ''));
            return null;
        }
        return url;
    } catch (e) {
        console.warn('[favorites] cloud upload error', e);
        return null;
    }
}

/**
 * 删除云端 blob（用户删收藏时调用）
 * 失败仅 console.warn，不抛错（删除是清理性操作，不影响主流程）
 */
export async function deleteVoiceFavoriteCloud(sourceMessageId: string): Promise<void> {
    try {
        const url = getFavoriteVoiceCloudUrl(sourceMessageId);
        const res = await fetch(url, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
            console.warn('[favorites] cloud delete failed', res.status);
        }
    } catch (e) {
        console.warn('[favorites] cloud delete error', e);
    }
}

export function getAllFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveAllFavorites(items: FavoriteItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('[favorites] save failed', e);
  }
}

export function addFavorite(item: FavoriteItem): FavoriteItem[] {
  const all = getAllFavorites();
  // 防止重复（同 sourceMessageId + same type + non-starred）
  if (!item.starred) {
    const dup = all.find(
      (f) => f.sourceMessageId === item.sourceMessageId && f.type === item.type && !f.starred
    );
    if (dup) return all;
  }
  const next = [item, ...all];
  saveAllFavorites(next);
  return next;
}

export function updateFavorite(id: string, updates: Partial<FavoriteItem>): FavoriteItem[] {
  const all = getAllFavorites();
  const next = all.map((f) => (f.id === id ? { ...f, ...updates } : f));
  saveAllFavorites(next);
  return next;
}

export function removeFavorite(id: string): FavoriteItem[] {
  const all = getAllFavorites();
  const next = all.filter((f) => f.id !== id);
  saveAllFavorites(next);
  return next;
}

export function getFavoritesByChar(charId: string): FavoriteItem[] {
  return getAllFavorites().filter((f) => f.charId === charId);
}

export function getStarredFavorites(): FavoriteItem[] {
  return getAllFavorites().filter((f) => f.starred);
}

export function getVoiceFavorites(): FavoriteItem[] {
  return getAllFavorites().filter((f) => f.type === 'voice');
}

export function genFavoriteId(): string {
  return `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 标记失效（远程 URL 404 时调）
export function markFavoriteInvalid(id: string): void {
  updateFavorite(id, { invalid: true });
}
