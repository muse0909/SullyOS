// 收藏数据存储 — localStorage
// 存储：语音收藏（用户发的 + AI 自动归档 + 用户主动星标）
// 后续：图片收藏 / 文字收藏

const STORAGE_KEY = 'sullyos_favorites_v1';

export interface FavoriteItem {
  id: string;
  type: 'voice' | 'image' | 'text';   // voice/image 需要 url；text 不需要
  url?: string;                         // 优先 remote CDN URL（voice/image 必填，text 留空）
  text: string;                         // UI 显示用（语音是文字版，文本是原文）
  charId: string;
  charName: string;                     // 冗余存，避免 char 改名后找不到
  sourceMessageId: string;              // 关联到原 message
  invalid?: boolean;                    // 远程 URL 失效标记（voice/image 才有）
  starred?: boolean;                    // 用户主动加星标
  createdAt: number;
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
