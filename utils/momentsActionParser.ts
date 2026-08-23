// 暮色 2026-08-23：抽离 AI 输出里 [[MOMENT_POST: ...]] / [[MOMENT_COMMENT: ...]] / [[MOMENT_LIKE: ...]]
//   标签的解析逻辑——之前只在 useChatAI 主聊天流程里实现，主动消息流程（OSContext.runProactive）漏了
//   这次抽到独立模块，useChatAI 和 OSContext 都调，保证两条路径行为一致
//
// 用法：
//   let content = parseMomentsActions(aiContent, { char, addToast });
//   // content 是被剥掉 MOMENT_* 标签后的纯文本，可以继续 sanitize / 入库

import { CharacterProfile } from '../types';
import {
  publishPostAsChar,
  commentPostAsChar,
  likePostAsChar,
  countTodayPostsByChar,
} from './momentsAI';
import { getSettings as getMomentsSettings } from './momentsStorage';

export interface ParseMomentsActionsOpts {
  char: CharacterProfile;
  addToast?: (msg: string, type?: 'success' | 'error' | 'info' | 'bell', duration?: number) => void;
  // 测试/灰度用：可强制跳过 action（不真发朋友圈）
  skipActions?: boolean;
}

export interface ParseMomentsActionsResult {
    cleaned: string;        // aiContent 剥掉 MOMENT_* 标签后的纯文本
    posted: number;          // 实际 publishPostAsChar 成功次数（暮色 2026-08-23 v3：给 caller 算发现页红点）
    liked: number;           // 实际 likePostAsChar 成功次数
    commented: number;       // 实际 commentPostAsChar 成功次数
}

export function parseMomentsActions(aiContent: string, opts: ParseMomentsActionsOpts): ParseMomentsActionsResult {
  let content = aiContent;
  let posted = 0;
  let liked = 0;
  let commented = 0;

  if (opts.skipActions) {
    // 仅剥标签，不发任何 action
    return { cleaned: stripMomentTags(content), posted: 0, liked: 0, commented: 0 };
  }

  try {
    const momentsSettings = getMomentsSettings();

    // 📝 [[MOMENT_POST: 内容]] - 发朋友圈
    const postMatches = [...content.matchAll(/\[\[MOMENT_POST:\s*([\s\S]+?)\]\]/g)];
    if (postMatches.length > 0 && !momentsSettings.autoPostByChar) {
      // autoPostByChar=false：跳过发朋友圈
      console.log(`📱 [Moments] autoPostByChar=off，跳过 ${postMatches.length} 个 POST`);
      opts.addToast?.(`${opts.char.name} 的主动发朋友圈已关闭`, 'info');
    } else if (postMatches.length > 0) {
      // 检查 maxPerDay 上限
      const todayCount = countTodayPostsByChar(opts.char.id, momentsSettings.maxPerDay);
      let canPost = todayCount < momentsSettings.maxPerDay;
      if (momentsSettings.maxPerDay <= 0) canPost = false;

      if (!canPost) {
        console.log(`📱 [Moments] 今日已发满 ${momentsSettings.maxPerDay} 条，跳过 ${postMatches.length} 个 POST`);
        opts.addToast?.(`${opts.char.name} 今日朋友圈已达上限`, 'info');
      } else {
        // 限制每次最多发 1 条（避免 AI 一次刷 N 条）
        const toPost = postMatches[0];
        const text = toPost[1].trim();
        if (text) {
          // 不带图（AI 主动发的动态都是纯文字，图片要走 imageGenProvider 这里不做）
          publishPostAsChar(opts.char, text, undefined, 'none');
          posted++;
          console.log(`📱 [Moments] ${opts.char.name} 发了一条朋友圈: ${text.slice(0, 30)}...`);
          opts.addToast?.(`📱 ${opts.char.name} 发了一条新朋友圈`, 'success', 2500);
        }
      }
    }

    // 💬 [[MOMENT_COMMENT: postId | 评论内容]] - 评论朋友圈
    const commentMatches = [...content.matchAll(/\[\[MOMENT_COMMENT:\s*([^\s|]+)\s*\|\s*([\s\S]+?)\]\]/g)];
    for (const m of commentMatches) {
      const postId = m[1].trim();
      const c = m[2].trim();
      if (postId && c) {
        const updated = commentPostAsChar(postId, opts.char.id, c);
        if (updated) {
          commented++;
          console.log(`💬 [Moments] ${opts.char.name} 评论了动态 ${postId}: ${c.slice(0, 30)}...`);
        } else {
          console.warn(`💬 [Moments] 评论失败：找不到动态 ${postId}`);
        }
      }
    }

    // ❤️ [[MOMENT_LIKE: postId]] - 点赞朋友圈
    const likeMatches = [...content.matchAll(/\[\[MOMENT_LIKE:\s*([^\s\]]+)\s*\]\]/g)];
    for (const m of likeMatches) {
      const postId = m[1].trim();
      if (postId) {
        const updated = likePostAsChar(postId, opts.char.id);
        if (updated) {
          liked++;
          console.log(`❤️ [Moments] ${opts.char.name} 点赞了动态 ${postId}`);
        } else {
          console.warn(`❤️ [Moments] 点赞失败：找不到动态 ${postId}`);
        }
      }
    }
  } catch (e) {
    console.warn('📱 [Moments] 解析失败:', e);
  }

  // 无论发没发出去，所有 MOMENT_* 标签都从 aiContent 移除
  return { cleaned: stripMomentTags(content), posted, liked, commented };
}

function stripMomentTags(content: string): string {
  return content
    .replace(/\[\[MOMENT_POST:\s*[\s\S]+?\]\]/g, '')
    .replace(/\[\[MOMENT_COMMENT:\s*[^\s|]+\s*\|\s*[\s\S]+?\]\]/g, '')
    .replace(/\[\[MOMENT_LIKE:\s*[^\s\]]+\s*\]\]/g, '')
    .trim();
}
