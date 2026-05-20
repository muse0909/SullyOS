/**
 * SullyOS-specific business-tag classifier for the amsg-instant 0.8 agentic loop.
 *
 * Scans `ctx.llmOutputText` and decides:
 *   - DATA tags (RECALL / SEARCH / READ_DIARY / FS_READ_DIARY / READ_NOTE / XHS_*) →
 *     tool-request: worker截断, 推送 toolCalls, 客户端跑工具后 POST /continue.
 *   - SIDE-EFFECT tags (ACTION:POKE / TRANSFER / ADD_EVENT / MUSIC_ACTION / XHS_LIKE /
 *     XHS_FAV / XHS_COMMENT / XHS_REPLY / XHS_POST / XHS_SHARE / schedule_message) →
 *     finish + directive metadata. worker 识别但不执行, 客户端 applyAssistantPostProcessing
 *     看到 directives 非空时只重放、不再扫原文.
 *   - 其他 (结构型 + 纯文本) → finish, 原文给客户端 13 步管线消化.
 *
 * 同时返回 sanitizedBody / sanitizedPrefix — push notification.body 终态文本.
 * 跟 message 原文不重叠时由 onLLMOutput 条件塞进 payload.notification.body.
 *
 * 故意没有任何 sullyOS 业务执行逻辑 — 这层只做"看见什么标签 → 出什么 decision".
 * tool 实际跑在 utils/agenticTools.ts (客户端), directive 实际重放在 utils/directiveReplayer.ts.
 *
 * 把分类逻辑放独立文件方便单测 (不需要起整个 cf adapter).
 */

import { sanitizeForNotification } from '../../../utils/sanitize';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type Directive =
  | { type: 'poke' }
  | { type: 'transfer'; amount: number }
  | { type: 'add_event'; title: string; date: string }
  | { type: 'schedule_message'; time: string; text: string }
  | { type: 'music_action'; verb: string; args: string[] }
  | { type: 'xhs_like'; noteId: string }
  | { type: 'xhs_fav'; noteId: string }
  | { type: 'xhs_comment'; noteId: string; text: string }
  | { type: 'xhs_reply'; noteId: string; commentId: string; text: string }
  | { type: 'xhs_post'; title: string; content: string; tags: string }
  | { type: 'xhs_share'; idx: number };

export type ClassificationResult =
  | {
      kind: 'tool-request';
      /** 用户可见的前置 narration (剥掉了数据标签); 可能为空串 */
      prefix: string;
      /**
       * sanitizeForNotification(prefix). 给 push notification.body 用 — 业务标签 /
       * markdown / 时间戳 leak 都剥光. 跟 prefix 字节相同时 onLLMOutput 不重复塞,
       * 节省 payload size.
       */
      sanitizedPrefix: string;
      toolCalls: ToolCall[];
    }
  | {
      kind: 'finish';
      /** 剥光数据标签 + 副作用标签后的纯文本; 给客户端管线消化 */
      cleanedText: string;
      /**
       * sanitizeForNotification(cleanedText). 给 push notification.body 用. 见
       * sanitizedPrefix 注释 — 同样的"跟 cleanedText 相同则不塞"逻辑.
       */
      sanitizedBody: string;
      directives: Directive[];
    };

// ── 数据型 (tool-request) ────────────────────────────────────────────────

interface DataTagSpec {
  /** 全局正则; 一定要带 g flag 才能 matchAll 出多个调用 */
  re: RegExp;
  toolName: string;
  /** 把单条 match 转成 args 对象; 返回 null 跳过这条 (兼容降级) */
  toArgs: (m: RegExpMatchArray) => Record<string, unknown> | null;
}

const DATA_TAGS: DataTagSpec[] = [
  // [[RECALL: 2024-05]] / [[RECALL: 2024年5]]
  {
    re: /\[\[RECALL:\s*(\d{4})[-/年](\d{1,2})\]\]/g,
    toolName: 'recall',
    toArgs: (m) => ({ year: m[1], month: m[2].padStart(2, '0') }),
  },
  // [[SEARCH: query]]
  {
    re: /\[\[SEARCH:\s*(.+?)\]\]/g,
    toolName: 'web_search',
    toArgs: (m) => ({ query: m[1].trim() }),
  },
  // [[READ_DIARY: 2024-05-19]] / [[READ_DIARY: 今天]]
  {
    re: /\[\[READ_DIARY:\s*(.+?)\]\]/g,
    toolName: 'notion_read_diary',
    toArgs: (m) => ({ date: m[1].trim() }),
  },
  // [[FS_READ_DIARY: 2024-05-19]]
  {
    re: /\[\[FS_READ_DIARY:\s*(.+?)\]\]/g,
    toolName: 'feishu_read_diary',
    toArgs: (m) => ({ date: m[1].trim() }),
  },
  // [[READ_NOTE: keyword]]
  {
    re: /\[\[READ_NOTE:\s*(.+?)\]\]/g,
    toolName: 'read_note',
    toArgs: (m) => ({ keyword: m[1].trim() }),
  },
  // [[XHS_SEARCH: keyword]]
  {
    re: /\[\[XHS_SEARCH:\s*(.+?)\]\]/g,
    toolName: 'xhs_search',
    toArgs: (m) => ({ keyword: m[1].trim() }),
  },
  // [[XHS_BROWSE]] / [[XHS_BROWSE: category]]
  {
    re: /\[\[XHS_BROWSE(?::\s*(.+?))?\]\]/g,
    toolName: 'xhs_browse',
    toArgs: (m) => (m[1] ? { category: m[1].trim() } : {}),
  },
  // [[XHS_DETAIL: noteId]]
  {
    re: /\[\[XHS_DETAIL:\s*(.+?)\]\]/g,
    toolName: 'xhs_detail',
    toArgs: (m) => ({ noteId: m[1].trim() }),
  },
  // [[XHS_MY_PROFILE]]
  {
    re: /\[\[XHS_MY_PROFILE\]\]/g,
    toolName: 'xhs_my_profile',
    toArgs: () => ({}),
  },
];

// ── 副作用型 (finish + directives) ───────────────────────────────────────

interface SideEffectSpec {
  re: RegExp;
  toDirective: (m: RegExpMatchArray) => Directive | null;
}

const SIDE_EFFECT_TAGS: SideEffectSpec[] = [
  // [[ACTION:POKE]]
  {
    re: /\[\[ACTION:POKE\]\]/g,
    toDirective: () => ({ type: 'poke' }),
  },
  // [[ACTION:TRANSFER:123]]
  {
    re: /\[\[ACTION:TRANSFER:(\d+)\]\]/g,
    toDirective: (m) => ({ type: 'transfer', amount: Number(m[1]) }),
  },
  // [[ACTION:ADD_EVENT|title|date]]
  {
    re: /\[\[ACTION:ADD_EVENT\s*\|\s*(.*?)\s*\|\s*(.*?)\]\]/g,
    toDirective: (m) => ({ type: 'add_event', title: m[1], date: m[2] }),
  },
  // [schedule_message | time | fixed | text]  (note: 单方括号, 跟原 chatParser 一致)
  {
    re: /\[schedule_message\s*\|\s*(.+?)\s*\|\s*fixed\s*\|\s*(.+?)\]/g,
    toDirective: (m) => ({ type: 'schedule_message', time: m[1], text: m[2] }),
  },
  // [[MUSIC_ACTION:verb]] 或 [[MUSIC_ACTION:verb|arg1|arg2]]
  {
    re: /\[\[MUSIC_ACTION:(join|add|add_new|join_and_add|join_and_add_new)(?:\|([^\]]*))?\]\]/g,
    toDirective: (m) => ({
      type: 'music_action',
      verb: m[1],
      args: m[2] ? m[2].split('|').map((s) => s.trim()) : [],
    }),
  },
  // [[XHS_LIKE: noteId]]
  {
    re: /\[\[XHS_LIKE:\s*(.+?)\]\]/g,
    toDirective: (m) => ({ type: 'xhs_like', noteId: m[1].trim() }),
  },
  // [[XHS_FAV: noteId]]
  {
    re: /\[\[XHS_FAV:\s*(.+?)\]\]/g,
    toDirective: (m) => ({ type: 'xhs_fav', noteId: m[1].trim() }),
  },
  // [[XHS_COMMENT: noteId | text]]
  {
    re: /\[\[XHS_COMMENT:\s*([^|]+?)\s*\|\s*([^\]]+?)\]\]/g,
    toDirective: (m) => ({ type: 'xhs_comment', noteId: m[1].trim(), text: m[2].trim() }),
  },
  // [[XHS_REPLY: noteId | commentId | text]]
  {
    re: /\[\[XHS_REPLY:\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^\]]+?)\]\]/g,
    toDirective: (m) => ({
      type: 'xhs_reply',
      noteId: m[1].trim(),
      commentId: m[2].trim(),
      text: m[3].trim(),
    }),
  },
  // [[XHS_POST: title | content | tags]]   (用 s flag 兼容多行 content)
  {
    re: /\[\[XHS_POST:\s*([^|]+?)\s*\|\s*([\s\S]+?)\s*\|\s*([^\]]+?)\]\]/g,
    toDirective: (m) => ({
      type: 'xhs_post',
      title: m[1].trim(),
      content: m[2].trim(),
      tags: m[3].trim(),
    }),
  },
  // [[XHS_SHARE: 3]]
  {
    re: /\[\[XHS_SHARE:\s*(\d+)\]\]/g,
    toDirective: (m) => ({ type: 'xhs_share', idx: Number(m[1]) }),
  },
];

/**
 * 把 LLM 输出分类成一个 decision payload.
 *
 * @param text  ctx.llmOutputText (可能为空串 —— 纯 tool_calls 响应也合法; 不过那种情况我们
 *              不会进 SullyOS 分类器, 因为 SullyOS 走的是文本协议 [[...]], 不是 OpenAI tool
 *              格式. 但保留兼容性: 空字符串 → finish + 空 cleanedText)
 */
export function classifyLLMOutput(text: string): ClassificationResult {
  // 1. 先扫数据标签. 任意一个命中就走 tool-request, 同一轮多个 SEARCH/RECALL 也一次性收集.
  const toolCalls: ToolCall[] = [];
  for (const spec of DATA_TAGS) {
    // matchAll 拿迭代器, 转 array 才能多次遍历
    const matches = Array.from(text.matchAll(spec.re));
    for (const m of matches) {
      const args = spec.toArgs(m);
      if (!args) continue;
      toolCalls.push({
        id: `call_${spec.toolName}_${toolCalls.length}_${Date.now().toString(36)}`,
        type: 'function',
        function: { name: spec.toolName, arguments: JSON.stringify(args) },
      });
    }
  }

  if (toolCalls.length > 0) {
    // 把数据标签从可见 prefix 剥掉; 副作用标签**保留**在 prefix 里, SW 会把 prefix 写到
    // inbox, 客户端 applyAssistantPostProcessing 会在那次扫到并执行 (跟本地 fetch 路径一致).
    let prefix = text;
    for (const spec of DATA_TAGS) prefix = prefix.replace(spec.re, '');
    prefix = prefix.trim();
    const sanitizedPrefix = sanitizeForNotification(prefix);
    return { kind: 'tool-request', prefix, sanitizedPrefix, toolCalls };
  }

  // 2. 没数据标签 → 扫副作用标签, 凑成 directives.
  const directives: Directive[] = [];
  for (const spec of SIDE_EFFECT_TAGS) {
    const matches = Array.from(text.matchAll(spec.re));
    for (const m of matches) {
      const d = spec.toDirective(m);
      if (d) directives.push(d);
    }
  }

  // 3. 不管 directives 有没有, 都剥光所有标签 (数据 + 副作用) 出干净文本.
  let cleanedText = text;
  for (const spec of DATA_TAGS) cleanedText = cleanedText.replace(spec.re, '');
  for (const spec of SIDE_EFFECT_TAGS) cleanedText = cleanedText.replace(spec.re, '');
  cleanedText = cleanedText.trim();
  const sanitizedBody = sanitizeForNotification(cleanedText);

  return { kind: 'finish', cleanedText, sanitizedBody, directives };
}
