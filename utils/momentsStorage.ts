// 朋友圈数据存储 — localStorage 封装
// 存储：posts 列表（用户和 AI 角色混合流）、signature（签名）、coverImage（封面图）
// 后续：可迁移到 Neon Postgres（云端同步），接口保持不变

const STORAGE_KEY_POSTS = 'sullyos_moments_posts_v1';
const STORAGE_KEY_SIGNATURE = 'os_moments_signature';
const STORAGE_KEY_COVER = 'os_moments_cover_image';
const STORAGE_KEY_SETTINGS = 'sullyos_moments_settings_v1';

export interface MomentPost {
  id: string;
  authorType: 'user' | 'char';
  charId?: string;          // authorType === 'char' 时填
  content: string;
  images: string[];         // dataURL 或 URL
  imageGenPrompt?: string;  // 生图 prompt（AI 配图时记录，方便用户收藏/重看）
  createdAt: number;
  likes: { type: 'user' | 'char'; charId?: string; createdAt: number }[];
  comments: MomentComment[];
}

export interface MomentComment {
  id: string;
  authorType: 'user' | 'char';
  charId?: string;
  content: string;
  createdAt: number;
  replyTo?: string;         // 评论的评论（指向另一条 comment.id）
}

export interface MomentSettings {
  autoCommentMine: boolean;     // 自动评论我的动态
  autoPostByChar: boolean;      // 角色自动发朋友圈
  autoCharInteraction: boolean; // 角色间自动互动
  // 频率控制（用户填）
  maxPerDay: number;            // 每天最多 N 条 AI 朋友圈，0 = 关闭
}

const DEFAULT_SETTINGS: MomentSettings = {
  autoCommentMine: true,
  autoPostByChar: true,
  autoCharInteraction: false,
  maxPerDay: 2,
};

// === posts 列表 ===

export function getAllPosts(): MomentPost[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveAllPosts(posts: MomentPost[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_POSTS, JSON.stringify(posts));
  } catch (e) {
    console.error('[moments] save posts failed', e);
  }
}

export function addPost(post: MomentPost): MomentPost[] {
  const all = getAllPosts();
  const next = [post, ...all];
  saveAllPosts(next);
  return next;
}

export function updatePost(id: string, updates: Partial<MomentPost>): MomentPost[] {
  const all = getAllPosts();
  const next = all.map((p) => (p.id === id ? { ...p, ...updates } : p));
  saveAllPosts(next);
  return next;
}

export function deletePost(id: string): MomentPost[] {
  const all = getAllPosts();
  const next = all.filter((p) => p.id !== id);
  saveAllPosts(next);
  return next;
}

export function getPostById(id: string): MomentPost | null {
  return getAllPosts().find((p) => p.id === id) || null;
}

// === 签名 / 封面图 / 设置 ===

export function getSignature(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_SIGNATURE) || '慢一点也没关系，走过的每一步都算数。';
  } catch {
    return '慢一点也没关系，走过的每一步都算数。';
  }
}

export function setSignature(text: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_SIGNATURE, text);
  } catch (e) {
    console.error('[moments] save signature failed', e);
  }
}

export function getCoverImage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_COVER);
  } catch {
    return null;
  }
}

export function setCoverImage(dataUrl: string | null): void {
  try {
    if (dataUrl) {
      localStorage.setItem(STORAGE_KEY_COVER, dataUrl);
    } else {
      localStorage.removeItem(STORAGE_KEY_COVER);
    }
  } catch (e) {
    console.error('[moments] save cover failed', e);
  }
}

export function getSettings(): MomentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function setSettings(updates: Partial<MomentSettings>): MomentSettings {
  const current = getSettings();
  const next = { ...current, ...updates };
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(next));
  } catch (e) {
    console.error('[moments] save settings failed', e);
  }
  return next;
}

// === 工具函数 ===

export function genPostId(): string {
  return `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function genCommentId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
