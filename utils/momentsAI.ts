/**
 * AI 朋友圈工具
 * 暮色 2026-07-03 拍板：参考 330 couple-space.js 的 prompt 模式，封装 3 个 AI 操作朋友圈的 API
 *  - generatePost: AI 发朋友圈（角色自动发 / 用户点"立即生成"）
 *  - generateComment: AI 评论用户朋友圈（trigger 流程 + AI 自动评论）
 *  - generateDecision: trigger 流程 — 决定 AI 是否要给用户主动发一条消息
 *
 * 关键设计（暮色 2026-07-03 反馈）：
 *  - 每次朋友圈操作都是单独一次 API 请求（不入主对话 prompt）
 *  - 跟定时主动消息（ProactiveChat）独立，不互相影响
 *  - "提醒一次"机制：trigger 流程里 prompt 强制"只能发 0 或 1 条消息"
 */
import { safeResponseJson, extractContent, extractJson } from './safeApi';
import {
  MomentPost,
  MomentSettings,
  MomentComment,
  getAllPosts,
  addPost,
  updatePost,
  genPostId,
  genCommentId,
} from './momentsStorage';
import { CharacterProfile } from '../types';

// === 通用：调 LLM 拿文本响应 ===
async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { jsonMode?: boolean; temperature?: number } = {}
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.9,
  };
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await safeResponseJson(resp);
  return extractContent(data);
}

// === 1. AI 发朋友圈 ===
// 输出 JSON：{ content, imagePrompt, tags }
// 暮色：imagePrompt 是英文生图提示词，配合 settings.imageGenProvider
export interface AIGeneratedPost {
  content: string;
  imagePrompt?: string; // 英文生图提示词（暮色 imageGenProvider 不为 'none' 时用）
  tags?: string[];
}

export async function generatePost(
  char: CharacterProfile,
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  ctx: {
    userName: string;
    userPersona?: string;
    worldbook?: string;
    memory?: string;
    recentChat?: string;
    recentPosts: MomentPost[]; // 最近朋友圈（避免重复）
    anniversary?: string;
  },
  settings: MomentSettings
): Promise<AIGeneratedPost | null> {
  const recentPostsText = ctx.recentPosts
    .slice(0, 5)
    .map(
      (p) =>
        `- [${new Date(p.createdAt).toLocaleDateString('zh-CN')}] ${
          p.authorType === 'user' ? ctx.userName : char.name
        }: ${p.content}${p.tags && p.tags.length > 0 ? ' #' + p.tags.join(' #') : ''}`
    )
    .join('\n');

  const useImageGen = settings.imageGenProvider !== 'none';

  const systemPrompt = `# 你的任务
你是"${char.name}"，现在要在朋友圈发一条动态。

# 你的角色设定
${char.persona || char.description || ''}

# 你的朋友
- 昵称: ${ctx.userName}
${ctx.userPersona ? '- 人设: ' + ctx.userPersona : ''}

${ctx.worldbook ? '# 世界观\n' + ctx.worldbook : ''}
${ctx.memory ? '# 你的记忆\n' + ctx.memory : ''}
${ctx.recentChat ? '# 最近的对话\n' + ctx.recentChat : ''}
${recentPostsText ? '# 最近的动态（避免重复）\n' + recentPostsText : ''}
${ctx.anniversary ? '# 纪念日\n' + ctx.anniversary : ''}

# 当前时间
${new Date().toLocaleString('zh-CN')}

# 输出要求
请以 JSON 格式返回（不要输出任何其他内容、不要代码块标记）：
{
  "content": "朋友圈文字内容（10-150字，像发朋友圈一样自然）",
  ${useImageGen ? '"imagePrompt": "英文生图提示词，描述具体画面、光线、构图、风格",' : ''}
  "tags": ["标签1", "标签2"]
}

# 要求
- content 必须符合你的性格、生活、跟朋友的关系
- 不要和最近发过的动态内容重复
${
  useImageGen
    ? '- imagePrompt 用英文写，描述具体画面（自拍/风景/食物/日常/和伴侣相关等）'
    : '- 不需要配图，不要输出 imagePrompt 字段'
}
- tags 是 1-3 个中文标签
- 绝对不要提到你是 AI`;

  const userPrompt = '请发一条朋友圈。';

  try {
    const raw = await callLLM(
      apiConfig.baseUrl,
      apiConfig.apiKey,
      apiConfig.model,
      systemPrompt,
      userPrompt,
      { jsonMode: true, temperature: 0.9 }
    );
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed.content !== 'string') return null;
    return {
      content: parsed.content.trim(),
      imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : undefined,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map((t: any) => String(t).trim()) : [],
    };
  } catch (e) {
    console.warn('[momentsAI] generatePost failed', e);
    return null;
  }
}

// === 2. AI 评论朋友圈 ===
// 暮色：AI 评论用户发的朋友圈时，要"友善但符合角色"
export interface AIGeneratedComment {
  content: string;
}

export async function generateComment(
  char: CharacterProfile,
  post: MomentPost,
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  ctx: {
    userName: string;
    memory?: string;
  }
): Promise<AIGeneratedComment | null> {
  const systemPrompt = `# 你的任务
${
  post.authorType === 'user'
    ? `${ctx.userName}刚刚在朋友圈发了一条动态，请你作为${char.name}写一条评论。`
    : `你（${char.name}）之前在朋友圈发了一条动态，${ctx.userName}给你写了评论："${post.content}"。请你回复这条评论。`
}

# 你的角色设定
${char.persona || char.description || ''}

# 动态信息
- 内容: ${post.content}
- 配图: ${post.images.length > 0 ? `${post.images.length} 张图` : '无'}
- 作者: ${post.authorType === 'user' ? ctx.userName : char.name}

${ctx.memory ? '# 你的记忆\n' + ctx.memory : ''}

# 输出要求
直接返回评论文本（10-100 字），不要 JSON 格式，不要引号包裹。

# 写作要求
- 像真人在朋友圈下评论一样自然
- 字数在 10-100 字之间
- 语气符合你的角色设定
- 可以夸赞照片、表达感受、调侃、撒娇等
- 绝对不要提到你是 AI`;

  try {
    const raw = await callLLM(
      apiConfig.baseUrl,
      apiConfig.apiKey,
      apiConfig.model,
      systemPrompt,
      '请写评论。',
      { temperature: 0.8 }
    );
    if (!raw) return null;
    return { content: raw.trim() };
  } catch (e) {
    console.warn('[momentsAI] generateComment failed', e);
    return null;
  }
}

// === 3. Trigger 流程：决定 AI 是否要给用户主动发一条消息 ===
// 暮色 2026-07-03：单次 LLM 调用，注入 prompt 提醒 AI 是否要给用户主动发一条聊天消息
// 输出 JSON：{ shouldSend: boolean, message?: string }

export interface AITriggerDecision {
  shouldSend: boolean;
  message?: string; // 当 shouldSend=true 时
}

export async function generateTriggerDecision(
  char: CharacterProfile,
  post: MomentPost,
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  ctx: {
    userName: string;
    userPersona?: string;
    memory?: string;
    recentChat?: string;
  }
): Promise<AITriggerDecision | null> {
  const systemPrompt = `# 你的任务
${ctx.userName}刚刚在朋友圈发了一条动态：
- 内容: ${post.content}
- 配图: ${post.images.length > 0 ? `${post.images.length} 张图` : '无'}

请你（${char.name}）决定：
**要不要给${ctx.userName}主动发一条聊天消息聊聊这条朋友圈？**

# 你的角色设定
${char.persona || char.description || ''}

# 你的朋友
- 昵称: ${ctx.userName}
${ctx.userPersona ? '- 人设: ' + ctx.userPersona : ''}

${ctx.memory ? '# 你的记忆\n' + ctx.memory : ''}
${ctx.recentChat ? '# 你们最近的对话\n' + ctx.recentChat : ''}

# 决策依据
考虑这些因素（不强制）：
- 你跟${ctx.userName}的关系亲密度
- 这条朋友圈的内容是否值得主动聊
- 你们最近聊天是否频繁（太频繁就不发了）
- 你的性格（有的角色不爱主动说话）

# 写作要求
- 不要每次都主动发（看情况决定）
- 如果决定发，message 要像真人发微信一样短（1-2 句话，不超过 60 字），符合你的语气
- message 不要描述动作（"我看了你的朋友圈笑了笑"这种），只输出纯文字聊天内容
- 绝对不要提到你是 AI

# 输出要求
请以 JSON 格式返回（不要输出其他内容、不要代码块标记）：
{
  "shouldSend": true 或 false,
  "message": "如果决定发，填这里；不发改 null"
}`;

  const userPrompt = `请决定要不要主动发消息聊聊这条朋友圈。`;

  try {
    const raw = await callLLM(
      apiConfig.baseUrl,
      apiConfig.apiKey,
      apiConfig.model,
      systemPrompt,
      userPrompt,
      { jsonMode: true, temperature: 0.7 }
    );
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed.shouldSend !== 'boolean') return null;
    return {
      shouldSend: parsed.shouldSend,
      message:
        parsed.shouldSend && typeof parsed.message === 'string'
          ? parsed.message.trim()
          : undefined,
    };
  } catch (e) {
    console.warn('[momentsAI] generateTriggerDecision failed', e);
    return null;
  }
}

// === 工具：检查今天已发朋友圈数（按 charId + date） ===
export function countTodayPostsByChar(charId: string, maxPerDay: number): number {
  if (maxPerDay <= 0) return Infinity; // 0 = 关闭
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const all = getAllPosts();
  return all.filter(
    (p) => p.authorType === 'char' && p.charId === charId && p.createdAt >= todayStart
  ).length;
}

// === Trigger 完整流程：发朋友圈后立即调一次（暮色 2026-07-03 拍板） ===
// 不再用 isTyping 钩子等"下一轮聊天"——用户发完朋友圈立即触发
// 流程：点赞（如 autoCommentMine） → AI 评论 → AI 决定是否主动发消息
// 主动发消息：写进 Chat 的 messages（通过 onAIDirectMessage 回调，UI 层注册）
export interface TriggerResult {
  liked: boolean;
  comment?: string;
  directMessage?: string;
}

export async function triggerAIReaction(
  char: CharacterProfile,
  post: MomentPost,
  settings: MomentSettings,
  apiConfig: { baseUrl: string; apiKey: string; model: string },
  ctx: {
    userName: string;
    userPersona?: string;
    memory?: string;
    recentChat?: string;
  },
  onAIDirectMessage?: (message: string) => void
): Promise<TriggerResult> {
  const result: TriggerResult = { liked: false };

  // 1) 点赞
  if (settings.autoCommentMine) {
    likePostAsChar(post.id, char.id);
    result.liked = true;
  }

  // 2) AI 评论
  try {
    const comment = await generateComment(char, post, apiConfig, {
      userName: ctx.userName,
      memory: ctx.memory,
    });
    if (comment?.content) {
      commentPostAsChar(post.id, char.id, comment.content);
      result.comment = comment.content;
    }
  } catch (e) {
    console.warn('[moments] trigger comment failed', e);
  }

  // 3) AI 决定是否主动发消息
  try {
    const decision = await generateTriggerDecision(char, post, apiConfig, {
      userName: ctx.userName,
      userPersona: ctx.userPersona,
      memory: ctx.memory,
      recentChat: ctx.recentChat,
    });
    if (decision?.shouldSend && decision.message && onAIDirectMessage) {
      onAIDirectMessage(decision.message);
      result.directMessage = decision.message;
    }
  } catch (e) {
    console.warn('[moments] trigger decision failed', e);
  }

  return result;
}

// === 工具：AI 点赞朋友圈（不调 API，纯本地操作） ===
export function likePostAsChar(postId: string, charId: string): MomentPost | null {
  const all = getAllPosts();
  const post = all.find((p) => p.id === postId);
  if (!post) return null;
  if (post.likes.some((l) => l.authorType === 'char' && l.charId === charId)) {
    return post; // 已赞过
  }
  const updated: MomentPost = {
    ...post,
    likes: [...post.likes, { authorType: 'char', charId, createdAt: Date.now() }],
  };
  updatePost(postId, { likes: updated.likes });
  return updated;
}

// === 工具：AI 评论朋友圈（不调 API，纯本地操作） ===
export function commentPostAsChar(
  postId: string,
  charId: string,
  content: string
): MomentPost | null {
  const all = getAllPosts();
  const post = all.find((p) => p.id === postId);
  if (!post) return null;
  const newComment: MomentComment = {
    id: genCommentId(),
    authorType: 'char',
    charId,
    content,
    createdAt: Date.now(),
  };
  const updated: MomentPost = {
    ...post,
    comments: [...post.comments, newComment],
  };
  updatePost(postId, { comments: updated.comments });
  return updated;
}

// === 工具：AI 发朋友圈（不调 API，纯本地操作 + 生图 hook） ===
export function publishPostAsChar(
  char: CharacterProfile,
  content: string,
  imagePrompt: string | undefined,
  imageGenProvider: 'none' | 'comfyui' | 'nai' | 'mcd'
): MomentPost {
  const newPost: MomentPost = {
    id: genPostId(),
    authorType: 'char',
    charId: char.id,
    content,
    images: [], // 生图在 UI 层做（这里只创建 post 骨架，生图完成后追加）
    imageGenPrompt: imagePrompt,
    createdAt: Date.now(),
    likes: [],
    comments: [],
  };
  addPost(newPost);
  return newPost;
  // 注意：imageGenProvider 在调用方处理（utils 不知道具体生图 API）
}
