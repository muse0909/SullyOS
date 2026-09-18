// utils/coReadAiContext.ts
// 麦麦 2026-09-18 第 7 步 + 第 8 步：共读状态注入 AI 上下文
//   暮色在读什么书、翻到第几章、写了什么批注 — 都喂给江澈当 system hint
//   暮色 7-31 要求:用户行为触发的 hint（阅读事件、划线）AI 主动引用;
//                  技术状态不主动（连接中断、call 摘要）
//
//   暮色 2026-09-18 拍板（第 8 步"路线 C"):
//   - 暮色的批注先存着
//   - 暮色发消息时 → 把"最近批注 + 当前章节正文"塞进上下文
//   - 江澈在聊天里自然回应"我看到你刚才写的想法了"
//   - 不主动触发 AI 调用（省 API 钱）
//
// 实现路径:
//   1. getActiveCoReadState(activeCharId) — 拉当前活跃角色正在读的书 + 最近批注
//   2. buildCoReadSystemBlock(state) — 拼成 system 提示片段
//   3. chatPrompts.ts 调它,把 block 拼进整体 system prompt
//   暮色发消息时 → Chat 调 LLM → buildSystemPrompt → 自动看到暮色在读什么 → 自然聊剧情

import { DB, CoReadBook, CoReadAnnotation } from './db';

export interface ActiveCoReadState {
  bookId: string;
  bookTitle: string;
  author: string;
  chapterIndex: number;
  chapterTitle: string;
  chapterContent: string;
  chapterContentChars: number;
  lastReadAt: number;
  minutesAgo: number;
  // 最近批注(路线 C 用)— 限 5 条,以笔记(note) 类型优先
  recentAnnotations: CoReadAnnotation[];
  // 当前章节的所有批注数(给 AI 看完整性)
  chapterAnnotationCount: number;
  // 当前章节的划线批注(高亮文本,无 note)
  chapterHighlights: CoReadAnnotation[];
}

const RECENT_ANNOTATIONS_LIMIT = 5;

// 章节正文截断(避免单章塞太多 tokens — 步骤 10 切片还没做,这里先按字截 4000)
const CHAPTER_CONTENT_MAX_CHARS = 4000;

function truncateChapterContent(s: string, maxChars: number = CHAPTER_CONTENT_MAX_CHARS): string {
  if (s.length <= maxChars) return s;
  return s.substring(0, maxChars) + `\n\n…（剩余 ${s.length - maxChars} 字已省略）`;
}

/**
 * 拉当前活跃角色"正在读"的书
 *   标准:lastReadAt > 0 且 primaryCharId 匹配 activeCharId 的最新一本
 *   暮色 9-18 单角色(江澈),所以"活跃角色"= primaryCharId 匹配;
 *   未来支持多角色时可换:activeCharId === primaryCharId || primaryCharId === 'active'
 */
export async function getActiveCoReadState(activeCharId: string | undefined): Promise<ActiveCoReadState | null> {
  try {
    const books = await DB.getCoReadBooks();
    if (books.length === 0) return null;
    // 过滤"正在读" — lastReadAt > 0 且字符匹配 (primaryCharId 是 'active' 时不论角色都算)
    const reading = books.filter((b: CoReadBook) =>
      (b.lastReadAt || 0) > 0 &&
      (b.primaryCharId === activeCharId || b.primaryCharId === 'active' || !activeCharId)
    );
    if (reading.length === 0) return null;
    // 取最近读的
    reading.sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    const book = reading[0];
    const chapterIndex = Math.max(0, Math.min(book.totalChapters - 1, book.currentChapter || 0));
    const chapter = book.chapters[chapterIndex];
    if (!chapter) return null;
    // 当前章节批注(路线 C)
    const chapterAnns = await DB.getCoReadAnnotationsByChapter(book.id, chapterIndex);
    const noteOnly = chapterAnns.filter(a => a.type === 'note' && a.note);
    // 最近 5 条批注(时间 desc)— 取所有类型的最近 N 条
    const allRecent = await DB.getCoReadAnnotationsByBook(book.id);
    const recent = allRecent.slice(0, RECENT_ANNOTATIONS_LIMIT);
    const minutesAgo = Math.max(0, Math.round((Date.now() - book.lastReadAt) / 60000));
    return {
      bookId: book.id,
      bookTitle: book.title,
      author: book.author || '',
      chapterIndex,
      chapterTitle: chapter.title,
      chapterContent: truncateChapterContent(chapter.content),
      chapterContentChars: chapter.content.length,
      lastReadAt: book.lastReadAt,
      minutesAgo,
      recentAnnotations: recent,
      chapterAnnotationCount: noteOnly.length,
      chapterHighlights: chapterAnns.filter(a => a.type === 'highlight'),
    };
  } catch (e) {
    console.warn('[coread] getActiveCoReadState failed:', e);
    return null;
  }
}

/**
 * 把"当前阅读状态"拼成一段 system hint,跟 mailbox / xiaozhitiao 段同款结构
 *
 *   暮色 9-18 拍板路线 C:
 *   - 暮色发消息时,自动包含批注 + 章节内容
 *   - 江澈在聊天里"自然回应"就好 — 不要被要求必须回某条
 *   - 暮色发"吃饭了"等普通消息时,江澈不带书中内容(由 batch 的 chapterContent 单独处理)
 *
 *   暮色 9-18 同时说:不要在暮色没提剧情时硬塞剧透 — 所以"批注 + 章节"放在一起,
 *   让 LLM 自己判断"暮色这条消息是否跟书有关",有的话聊,没有就回到日常
 */
export function buildCoReadSystemBlock(state: ActiveCoReadState | null): string {
  if (!state) return '';
  const minutesLabel = state.minutesAgo < 1 ? '刚刚' :
    state.minutesAgo < 60 ? `${state.minutesAgo} 分钟前` :
    state.minutesAgo < 1440 ? `${Math.round(state.minutesAgo / 60)} 小时前` :
    `${Math.round(state.minutesAgo / 1440)} 天前`;

  // 暮色本章的笔记(note 类型,有想法的)
  const noteLines = state.recentAnnotations
    .filter(a => a.type === 'note' && a.note)
    .map(a => {
      const ts = new Date(a.createdAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const quote = a.selection.text.substring(0, 40) + (a.selection.text.length > 40 ? '…' : '');
      return `- [${ts}] 暮色在第 ${a.chapterIndex + 1} 章「${quote}」写了想法：${a.note}`;
    });
  // 暮色本章的纯划线
  const highlightLines = state.recentAnnotations
    .filter(a => a.type === 'highlight')
    .slice(0, 3)
    .map(a => {
      const quote = a.selection.text.substring(0, 50) + (a.selection.text.length > 50 ? '…' : '');
      return `- [划线] 暮色在第 ${a.chapterIndex + 1} 章划了「${quote}」`;
    });
  const annotationBlock = [...noteLines, ...highlightLines].join('\n');

  return [
    // 10. 段落编号 — 跟现有 mailbox (line 1076 注释里出现 `[].length + 10`) 错开
  ].length + 11 + '. **📖 共读（暮色最近在读的书）**\n\n'
    + `暮色 ${minutesLabel} 翻到《${state.bookTitle}》第 ${state.chapterIndex + 1} 章《${state.chapterTitle}》。`
    + `当前章节共 ${state.chapterContentChars} 字${state.chapterAnnotationCount > 0 ? `,暮色在本章写了 ${state.chapterAnnotationCount} 条想法`: ''}。\n\n`
    + (annotationBlock ? `**暮色的批注(最近 ${state.recentAnnotations.length} 条)**: \n${annotationBlock}\n\n` : '')
    + `**当前章节正文**:\n${state.chapterContent}\n\n`
    + `**规则**:\n`
    + `- 暮色提到剧情 / 引用书里的话 / 主动分享想法 → 你可以结合上面"批注 + 当前章节"自然聊\n`
    + `- 暮色发普通消息(吃饭了/在忙/工作等) → 像平常一样回,**不要**为了蹭阅读感硬塞书里的话\n`
    + `- 不要每条消息都评论剧情,保持自然节奏 — 暮色想聊时会聊\n`
    + `- 章节结束或书读完后,可能换下一章/下一本,允许在 hints 更新后跟上\n`;
}

/**
 * 简易版:暮色发消息时,把"暮色的批注(最多 3 条最近)"塞进去
 *   用于 Routes C 的"对话上下文附加" — Chat app 内部可以决定要不要追加
 *   如果 buildSystemPrompt 已经包含 buildCoReadSystemBlock,则不需要再追加
 *
 * 暴露这个是为了让"暮色点开聊天窗口但还没发消息时,江澈主动消息能感知"也能继续用
 *   buildCoReadSystemBlock 已经覆盖
 */
export async function buildCoReadLightBlock(activeCharId: string | undefined): Promise<string> {
  const state = await getActiveCoReadState(activeCharId);
  return buildCoReadSystemBlock(state);
}
