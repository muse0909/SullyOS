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
 * 语音收藏的音频**自己存一份**，不再借用 Chat 的 `voice_msg_*`。
 *
 * 2026-09-30 暮色反馈「收藏的每次都存不住，做了缓存也很快失效」。查下来两条路都是断的：
 *
 *   1. **云端那条从一开始就没通过**。`getFavoriteVoiceCloudUrl` 指向
 *      `/api/v1/voice-favorite-store`——那是 **Netlify** 的路径。项目早就搬到 Vercel，
 *      `api/v1/` 这个目录压根不存在，上传过去只有 404。何况 2026-07-22 取消「语音自动
 *      加入收藏」时，Chat 里那整段上传代码已经被删了，现在收藏时**根本不会去上传**，
 *      `item.url` 自然是空的。
 *   2. **本地那条是「借」来的**。收藏自己不存音频，只记一个 `sourceMessageId`，
 *      播放时跑去 `voice_msg_<消息id>` 找 Chat 存的那份。于是只要 Chat 那边没存过
 *      （那条消息你还没点过播放）或被清了，收藏跟着一起失效。
 *
 * 改成收藏自己落一份，键 `fav_voice_<收藏id>`。从此不依赖聊天那边——清聊天缓存、
 * 删原消息都不影响收藏。代价是同一段音频可能存两份（聊天一份、收藏一份），
 * 一段 5 秒的话约 100–300 KB。
 */
const favVoiceKey = (favId: string) => `fav_voice_${favId}`;

/** 把收藏的语音存进 IndexedDB，返回键。存不进去返回空串（不抛）。 */
export async function saveFavoriteVoiceBlob(favId: string, blob: Blob): Promise<string> {
  try {
    const key = favVoiceKey(favId);
    const { DB } = await import('./db');
    await DB.saveAssetRaw(key, { blob, createdAt: Date.now() });
    return key;
  } catch (e) {
    console.warn('[favorites] 保存语音失败', e);
    return '';
  }
}

/**
 * 取收藏的语音。按**收藏自己的键**优先，老数据（改动前存的、没自己留底的）
 * 再回退去借 Chat 的 `voice_msg_*`。
 */
export async function getFavoriteVoiceBlobByFavId(favId: string, sourceMessageId: string): Promise<Blob | null> {
  if (favId) {
    try {
      const { DB } = await import('./db');
      const entry = await DB.getAssetRaw(favVoiceKey(favId));
      if (entry && entry.blob instanceof Blob) return entry.blob;
    } catch { /* 落到下面的老路径 */ }
  }
  return getFavoriteVoiceBlob(sourceMessageId);
}

/** 删收藏时把它自己存的那份也删掉（老数据借的那份归 Chat 管，不动）。 */
export async function deleteFavoriteVoiceBlob(favId: string): Promise<void> {
  if (!favId) return;
  try {
    const { DB } = await import('./db');
    await DB.deleteAsset(favVoiceKey(favId));
  } catch {
    /* 删不掉只是留个孤儿文件，不影响功能 */
  }
}

/**
 * 从 IndexedDB 读语音收藏的 blob。
 * voice favorite 通过 sourceMessageId 关联到 Chat 自己存的 voiceAssetKey(`voice_msg_${msgId}`)。
 * 返回 null 表示数据丢失（迁移前的老数据 / Chat 没存过 / IndexedDB 被清）。
 *
 * ⚠️ 这是**老路径**，只作为回退。新的收藏走 `getFavoriteVoiceBlobByFavId`。
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
