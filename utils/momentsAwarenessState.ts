// momentsAwarenessState — 朋友圈 awareness 注入状态
// 暮色 2026-08-07 19:31 反馈：
//   现在 buildSystemPrompt 每次都把最近 5 条朋友圈塞进 system prompt（包括 AI 已经看过的旧 post）
//   prompt 太长 + 每次都重复
//   改成：只带"AI 没看过的新 post"
//
// 字段（按 charId 分开持久化）：
//   { [charId]: { lastSeenAt: number /*朋友圈 createdAt*/ } }
//
// 调用：
//   - getNewPostsForAwareness(charId, allPosts) → 过滤"新发"（createdAt > lastSeenAt）
//   - markMomentsSeen(charId, post) → 持久化这次看到的最新朋友圈 createdAt
//
// 首次构建（没 lastSeen）：只带最新 1 条作为基线，避免一次性塞 5 条老 post
// 后续：createdAt > lastSeenAt 的 post 全带（最多 5 条）
//
// 跟 chatPrompts.buildMomentsAwareness 配合：buildMomentsAwareness 接已经过滤过的 posts
// 这层只负责"哪些是新的"判断，buildMomentsAwareness 负责"怎么拼成 prompt 文本"

import type { MomentPost } from './momentsStorage';

const STORAGE_KEY = 'sullyos_moments_awareness_seen_v1';
const INITIAL_BASELINE_LIMIT = 1; // 首次只给 1 条
const MAX_NEW_POSTS = 5; // 新发朋友圈最多带 5 条

export interface MomentsAwarenessState {
  [charId: string]: {
    lastSeenAt: number; // 朋友圈 createdAt（毫秒）
    lastSeenId?: string;
  };
}

const loadState = (): MomentsAwarenessState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as MomentsAwarenessState;
  } catch {
    return {};
  }
};

const saveState = (state: MomentsAwarenessState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[momentsAwarenessState] save failed', e);
  }
};

/**
 * 拉"AI 没看过"的朋友圈：
 * - 首次（没 char 状态）：返回最近 INITIAL_BASELINE_LIMIT 条作基线
 * - 后续：返回 createdAt > lastSeenAt 的全部（按 createdAt 升序，上限 MAX_NEW_POSTS）
 */
export const getNewPostsForAwareness = (charId: string, allPosts: MomentPost[]): MomentPost[] => {
  if (!allPosts || allPosts.length === 0) return [];
  const state = loadState();
  const charState = state[charId];

  // 按 createdAt 升序排序
  const sorted = [...allPosts].sort((a, b) => a.createdAt - b.createdAt);

  if (!charState || !charState.lastSeenAt) {
    // 首次：取最后 INITIAL_BASELINE_LIMIT 条作基线
    return sorted.slice(-INITIAL_BASELINE_LIMIT);
  }

  // 后续：createdAt > lastSeenAt 的新发朋友圈
  return sorted.filter(p => p.createdAt > charState.lastSeenAt).slice(-MAX_NEW_POSTS);
};

/**
 * 标记"char 看到了哪些"：传入这次返回给 AI 的 posts（一般是 getNewPostsForAwareness 的结果）
 * 持久化最新一条的 createdAt——下次只会带比这更新的。
 */
export const markMomentsSeen = (charId: string, posts: MomentPost[]): void => {
  if (!posts || posts.length === 0) return;
  const sorted = [...posts].sort((a, b) => a.createdAt - b.createdAt);
  const latest = sorted[sorted.length - 1];
  const state = loadState();
  state[charId] = {
    lastSeenAt: latest.createdAt,
    lastSeenId: latest.id,
  };
  saveState(state);
};

/** 测试 / 调试用：清空所有 char 状态。 */
export const resetMomentsAwareness = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
};
