/**
 * applyAssistantPostProcessing — 抽自 hooks/useChatAI.ts 的 sendMessage 后处理管线
 *
 * Phase 0 重构目标: 把"API 拿到原始 aiContent → 13 步处理 → 逐条落库到 IndexedDB"
 * 这段约 1500 行的流水线抽成可复用函数, 让本地 fetch 和 instant push (Phase 1) 两条
 * 路径都调它, 保证行为字节级一致。
 *
 * 13 步 (与计划编号对应):
 *  1. normalizeAiContent — 剥 <think>/时间戳/[聊天][通话][约会] 等
 *  2. 二轮 LLM 钩子 — RECALL / SEARCH / DIARY / READ_DIARY / FS_* / READ_NOTE / XHS_*
 *  3. ChatParser.parseAndExecuteActions — POKE/TRANSFER/MUSIC/ADD_EVENT/schedule
 *  4. thinking chain 抽取 (reasoning_content + <think>)
 *  5. [html]...[/html] → html_card 消息
 *  6. ChatParser.sanitize(text, {keepCitations:true})
 *  7. [[INNER_STATE:...]] 兜底剥
 *  8. 双语 <翻译><原文>...<译文>... 拆为单独 bubble
 *  9. ChatParser.splitResponse — 拆 [[SEND_EMOJI:]]
 * 10. --- 分块 + ChatParser.chunkText (换行 / CJK 空格)
 * 11. per-chunk 引用解析 ([[QUOTE:]]/[QUOTE:]/[回复 "..."]) → replyTo
 * 12. hasDisplayContent + per-chunk sanitize
 * 13. 拟人打字延迟 (setTimeout)
 *
 * Phase 0 保证: 本地 fetch 路径 directives=[] / skipSecondPassLLM=false 行为字节级不变。
 * Phase 1 会让 instant push 路径 directives=[] / skipSecondPassLLM=true (worker 已跑过).
 * Phase 2 会让 worker 端把识别出的副作用 (RECALL/SEARCH/...) 结构化传 directives, 这里只重放。
 */

import { CharacterProfile, UserProfile, Message, Emoji, RealtimeConfig } from '../types';
import { DB } from './db';
import { ChatParser } from './chatParser';
import { RealtimeContextManager, NotionManager, FeishuManager, XhsNote } from './realtimeContext';
import { XhsMcpClient, extractNotesFromMcpData, normalizeNote } from './xhsMcpClient';
import { safeFetchJson } from './safeApi';
import { extractHtmlBlocks } from './htmlPrompt';

// ─── 模块内辅助 ──────────────────────────────────────────────────────────────

/** 第一遍粗洗 — 剥 <think> / 时间戳 / 历史里漏出的 [聊天]/[通话]/[约会] / 表情包反向 tag */
const normalizeAiContent = (raw: string): string => {
    let cleaned = raw || '';
    // Strip hidden chain-of-thought blocks: <think> / <thinking> / <thought>
    cleaned = cleaned.replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '');
    cleaned = cleaned.replace(/<(?:think|thinking|thought)>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}.*?\]/g, '');
    cleaned = cleaned.replace(/^[\w一-龥]+:\s*/, '');
    // Strip source tags [聊天]/[通话]/[约会] leaked from history context — replace with newline to preserve intended splits
    cleaned = cleaned.replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n');
    cleaned = cleaned.replace(/\[(?:你|User|用户|System)\s*发送了表情包[:：]\s*(.*?)\]/g, '[[SEND_EMOJI: $1]]');
    return cleaned;
};

/** 解析 char + realtimeConfig 拿到当前 XHS 配置 (per-character override) */
function resolveXhsConfig(char: CharacterProfile, realtimeConfig?: RealtimeConfig): {
    enabled: boolean; mcpUrl: string; loggedInUserId?: string; loggedInNickname?: string; userXsecToken?: string;
} {
    const mcpConfig = realtimeConfig?.xhsMcpConfig;
    const mcpAvailable = !!(mcpConfig?.enabled && mcpConfig?.serverUrl);
    const mcpUrl = mcpConfig?.serverUrl || '';
    const loggedInUserId = mcpConfig?.loggedInUserId;
    const loggedInNickname = mcpConfig?.loggedInNickname;
    const userXsecToken = mcpConfig?.userXsecToken;

    if (char.xhsEnabled !== undefined) {
        return { enabled: !!char.xhsEnabled && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
    }
    return { enabled: !!(realtimeConfig?.xhsEnabled) && mcpAvailable, mcpUrl, loggedInUserId, loggedInNickname, userXsecToken };
}

// XHS helpers — via xhs-bridge
async function xhsSearch(conf: { mcpUrl: string }, keyword: string): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.search(conf.mcpUrl, keyword);
    if (!r.success) return { success: false, notes: [], message: r.error };
    const raw = extractNotesFromMcpData(r.data);
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

async function xhsBrowse(conf: { mcpUrl: string }): Promise<{ success: boolean; notes: XhsNote[]; message?: string }> {
    const r = await XhsMcpClient.getRecommend(conf.mcpUrl);
    if (!r.success) return { success: false, notes: [], message: r.error };
    const unwrapped = r.data?.data && typeof r.data.data === 'object' && !Array.isArray(r.data.data) ? r.data.data : r.data;
    console.log(`📕 [XHS] getRecommend 响应类型: ${typeof r.data}, 是否有 data 嵌套: ${unwrapped !== r.data}, unwrapped keys: ${unwrapped && typeof unwrapped === 'object' ? Object.keys(unwrapped).join(',') : 'N/A'}`);
    const raw = extractNotesFromMcpData(unwrapped);
    if (raw.length === 0 && unwrapped !== r.data) {
        console.log(`📕 [XHS] getRecommend unwrapped 提取为空，用原始数据重试`);
        const raw2 = extractNotesFromMcpData(r.data);
        return { success: true, notes: raw2.map(n => normalizeNote(n) as XhsNote) };
    }
    return { success: true, notes: raw.map(n => normalizeNote(n) as XhsNote) };
}

async function xhsPublish(conf: { mcpUrl: string }, title: string, content: string, tags: string[]): Promise<{ success: boolean; noteId?: string; message: string }> {
    let images: string[] = [];
    try {
        const stockImgs = await DB.getXhsStockImages();
        if (stockImgs.length > 0) {
            const keywords = [title, content, ...tags].join(' ').toLowerCase();
            const scored = stockImgs.map(img => ({
                img,
                score: img.tags.reduce((s: number, t: string) => s + (keywords.includes(t.toLowerCase()) ? 10 : 0), 0) + Math.max(0, 5 - (img.usedCount || 0))
            })).sort((a, b) => b.score - a.score);
            if (scored[0]?.img.url) {
                images = [scored[0].img.url];
                DB.updateXhsStockImageUsage(scored[0].img.id).catch(() => {});
            }
        }
    } catch { /* ignore stock failures */ }

    const r = await XhsMcpClient.publishNote(conf.mcpUrl, { title, content, tags, images: images.length > 0 ? images : undefined });
    return { success: r.success, noteId: r.data?.noteId, message: r.error || (r.success ? '发布成功' : '发布失败') };
}

async function xhsComment(conf: { mcpUrl: string }, noteId: string, content: string, xsecToken?: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.comment(conf.mcpUrl, noteId, content, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '评论成功' : '评论失败') };
}

async function xhsLike(conf: { mcpUrl: string }, feedId: string, xsecToken: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.likeFeed(conf.mcpUrl, feedId, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '点赞成功' : '点赞失败') };
}

async function xhsFavorite(conf: { mcpUrl: string }, feedId: string, xsecToken: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.favoriteFeed(conf.mcpUrl, feedId, xsecToken);
    return { success: r.success, message: r.error || (r.success ? '收藏成功' : '收藏失败') };
}

async function xhsReplyComment(conf: { mcpUrl: string }, feedId: string, xsecToken: string, content: string, commentId?: string, userId?: string, parentCommentId?: string): Promise<{ success: boolean; message: string }> {
    const r = await XhsMcpClient.replyComment(conf.mcpUrl, feedId, xsecToken, content, commentId, userId, parentCommentId);
    return { success: r.success, message: r.error || (r.success ? '回复成功' : '回复失败') };
}

// ─── 公开类型 ────────────────────────────────────────────────────────────────

/**
 * Phase 2 预留: 当 worker 端的 agentic loop 跑完后, 用结构化 directive 数组把它发现/执行
 * 过的副作用 (RECALL / SEARCH / XHS_LIKE / ...) 传回主线程, 这里只负责"重放到 DB / UI",
 * 不重新扫原文。Phase 0 全部为空数组或 undefined。
 */
export interface PostProcessDirective {
    type: string;
    payload: any;
}

/** XHS reply-related caches — 跨消息存活, 调用方负责持有 (一般是 useRef 包起来) */
export interface XhsCaches {
    /** noteId → xsecToken */
    xsecTokenCache: Map<string, string>;
    /** noteId → title */
    noteTitleCache: Map<string, string>;
    /** commentId → userId */
    commentUserIdCache: Map<string, string>;
    /** commentId → 评论作者昵称 (降级为 @mention 顶级评论用) */
    commentAuthorNameCache: Map<string, string>;
    /** commentId → parentCommentId */
    commentParentIdCache: Map<string, string>;
}

export interface PostProcessApiCall {
    /** 主 API 调用入口 base, 不含末尾斜杠 (e.g. "https://api.openai.com/v1") */
    baseUrl: string;
    /** Authorization 头等 */
    headers: Record<string, string>;
    /** 当前生效的 API (拿 model / 兜底其他配置用) */
    effectiveApi: { baseUrl: string; apiKey: string; model: string };
}

export interface PostProcessMusicHooks {
    getListeningSnapshot: () => {
        songId: number;
        name: string;
        artists: string;
        album: string;
        albumPic: string;
        duration: number;
        fee: number;
    } | null;
    joinListeningTogether: (charId: string) => void;
    addSongToCharPlaylist: (
        charId: string,
        song: any,
        target?: any,
    ) => Promise<{ playlistTitle: string; created: boolean } | null>;
}

export interface PostProcessHooks {
    setMessages: (msgs: Message[]) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    setRecallStatus?: (s: string) => void;
    setSearchStatus?: (s: string) => void;
    setDiaryStatus?: (s: string) => void;
    setXhsStatus?: (s: string) => void;
    /** token 计费汇总 (调用方负责把 React state 同步上去) */
    updateTokenUsage?: (data: any, msgCount: number, pass: string) => void;
    /** 给 ChatParser.parseAndExecuteActions 用的音乐钩子 */
    musicHooks?: PostProcessMusicHooks;
}

export interface PostProcessCtx {
    char: CharacterProfile;
    userProfile: UserProfile;
    emojis: Emoji[];
    realtimeConfig?: RealtimeConfig;
    /** 上下文消息窗 — 用来匹配 quote 目标 */
    contextMsgs: Message[];
    /** 发给 API 的完整 messages 数组 — 2nd-pass LLM 调用要带上 */
    fullMessages: any[];
    /** 第一次 API 调用的原始响应, 后续 2nd-pass 会覆盖它 (复制旧实现的局部变量行为) */
    initialData: any;
    /** historyMsgCount — 给 updateTokenUsage 用 */
    historyMsgCount: number;
    /** 当 MCD MiniApp 打开时附加到每条 assistant message 的 metadata patch */
    mcdInheritMeta?: any;
    /** XHS 跨消息缓存 (调用方持有的 ref) */
    xhsCaches: XhsCaches;
    /** API 调用配置 */
    api: PostProcessApiCall;
    /** UI / 业务钩子 */
    hooks: PostProcessHooks;
    /**
     * Phase 1+: 当 worker 已在自己内部跑过 2nd-pass LLM 时, 主线程不该再调一次。
     * Phase 0 始终为 false / undefined。
     */
    skipSecondPassLLM?: boolean;
    /**
     * Phase 2+: worker 端把识别到的副作用结构化传过来; 非空时只重放, 不再扫原文。
     * Phase 0 始终为 [] / undefined。
     */
    directives?: PostProcessDirective[];
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────

/**
 * 与 useChatAI 旧版 inline 实现行为字节级对齐。
 * skipSecondPassLLM=false + directives=[] 时是 Phase 0 默认形态。
 */
export async function applyAssistantPostProcessing(
    rawAiContent: string,
    ctx: PostProcessCtx,
): Promise<void> {
    const {
        char,
        userProfile,
        emojis,
        realtimeConfig,
        contextMsgs,
        fullMessages,
        initialData,
        historyMsgCount,
        mcdInheritMeta,
        xhsCaches,
        api,
        hooks,
        skipSecondPassLLM,
        directives,
    } = ctx;
    const { baseUrl, headers, effectiveApi } = api;
    const {
        setMessages,
        addToast,
        setRecallStatus = () => {},
        setSearchStatus = () => {},
        setDiaryStatus = () => {},
        setXhsStatus = () => {},
        updateTokenUsage = () => {},
        musicHooks,
    } = hooks;
    const {
        xsecTokenCache: xsecTokenCacheRef,
        noteTitleCache: noteTitleCacheRef,
        commentUserIdCache: commentUserIdCacheRef,
        commentAuthorNameCache: commentAuthorNameCacheRef,
        commentParentIdCache: commentParentIdCacheRef,
    } = xhsCaches;

    // Phase 0 标记位 — Phase 1/2 会让这两个变成真值并跳过对应分支; Phase 0 始终为假, 全走原逻辑。
    // 留为局部变量供未来分支使用; 当前 Phase 0 不读, 仅做 no-op 形参声明。
    void skipSecondPassLLM;
    void directives;

    /** 将笔记列表的 xsecToken 和 title 存入缓存 */
    const cacheXsecTokens = (notes: XhsNote[]) => {
        for (const n of notes) {
            if (n.noteId && n.xsecToken) {
                xsecTokenCacheRef.set(n.noteId, n.xsecToken);
            }
            if (n.noteId && n.title) {
                noteTitleCacheRef.set(n.noteId, n.title);
            }
        }
    };

    /** 从缓存或 lastXhsNotes 中查找 xsecToken */
    const findXsecToken = (noteId: string, lastXhsNotes: XhsNote[]): string | undefined => {
        const fromNotes = lastXhsNotes.find(n => n.noteId === noteId)?.xsecToken;
        if (fromNotes) return fromNotes;
        return xsecTokenCacheRef.get(noteId);
    };

    // 局部 data 副本 — 后续 2nd-pass 会覆盖, 模仿旧版的 let data 行为
    let data: any = initialData;

    // ─── Step 1: 初次粗洗 ───
    let aiContent = rawAiContent;
    aiContent = normalizeAiContent(aiContent);

    // ─── Step 2: 二轮 LLM 钩子 ───

    // 5. Handle Recall (Loop if needed)
    const recallMatch = aiContent.match(/\[\[RECALL:\s*(\d{4})[-/年](\d{1,2})\]\]/);
    if (recallMatch) {
        const year = recallMatch[1];
        const month = recallMatch[2];
        const targetMonth = `${year}-${month.padStart(2, '0')}`;

        const alreadyActive = char.activeMemoryMonths?.includes(targetMonth);

        if (alreadyActive) {
            console.log(`♻️ [Recall] ${targetMonth} already in activeMemoryMonths, skipping duplicate recall`);
            aiContent = aiContent.replace(/\[\[RECALL:\s*\d{4}[-/年]\d{1,2}\]\]/g, '').trim();
        } else {
            setRecallStatus(`正在调阅 ${year}年${month}月 的详细档案...`);

            const getDetailedLogs = (y: string, m: string) => {
                if (!char.memories) return null;
                const target = `${y}-${m.padStart(2, '0')}`;
                const logs = char.memories.filter(mem => {
                    return mem.date.includes(target) || mem.date.includes(`${y}年${parseInt(m)}月`);
                });
                if (logs.length === 0) return null;
                return logs.map(mem => `[${mem.date}] (${mem.mood || 'normal'}): ${mem.summary}`).join('\n');
            };

            const detailedLogs = getDetailedLogs(year, month);

            if (detailedLogs) {
                const recallMessages = [...fullMessages, { role: 'user', content: `[系统: 已成功调取 ${year}-${month} 的详细日志]\n${detailedLogs}\n[系统: 现在请结合这些细节回答用户。保持对话自然。]` }];
                try {
                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ model: effectiveApi.model, messages: recallMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                    });
                    updateTokenUsage(data, historyMsgCount, 'recall');
                    aiContent = data.choices?.[0]?.message?.content || '';
                    aiContent = normalizeAiContent(aiContent);
                    addToast(`已调用 ${year}-${month} 详细记忆`, 'info');
                } catch (recallErr: any) {
                    console.error('Recall API failed:', recallErr.message);
                }
            }
        }
    }
    setRecallStatus('');

    // 5.5 Handle Active Search (主动搜索)
    const searchMatch = aiContent.match(/\[\[SEARCH:\s*(.+?)\]\]/);
    if (searchMatch && realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey) {
        const searchQuery = searchMatch[1].trim();
        console.log('🔍 [Search] AI触发搜索:', searchQuery);
        setSearchStatus(`正在搜索: ${searchQuery}...`);

        try {
            const searchResult = await RealtimeContextManager.performSearch(searchQuery, realtimeConfig.newsApiKey);
            console.log('🔍 [Search] 搜索结果:', searchResult);

            if (searchResult.success && searchResult.results.length > 0) {
                const resultsStr = searchResult.results.map((r, i) =>
                    `${i + 1}. ${r.title}\n   ${r.description}`
                ).join('\n\n');

                console.log('🔍 [Search] 注入结果到AI，重新生成回复...');

                const cleanedForSearch = aiContent.replace(/\[\[SEARCH:.*?\]\]/g, '').trim() || '让我搜一下...';
                const searchMessages = [
                    ...fullMessages,
                    { role: 'assistant', content: cleanedForSearch },
                    { role: 'user', content: `[系统: 搜索完成！以下是关于"${searchQuery}"的搜索结果]\n\n${resultsStr}\n\n[系统: 现在请根据这些真实信息回复用户。用自然的语气分享，比如"我刚搜了一下发现..."、"诶我看到说..."。不要再输出[[SEARCH:...]]了。]` }
                ];

                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ model: effectiveApi.model, messages: searchMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                });
                updateTokenUsage(data, historyMsgCount, 'search');
                aiContent = data.choices?.[0]?.message?.content || '';
                console.log('🔍 [Search] AI基于搜索结果生成的新回复:', aiContent.slice(0, 100) + '...');
                aiContent = normalizeAiContent(aiContent);
                addToast(`🔍 搜索完成: ${searchQuery}`, 'success');
            } else {
                console.log('🔍 [Search] 搜索失败或无结果:', searchResult.message);
                addToast(`搜索失败: ${searchResult.message}`, 'error');
                aiContent = aiContent.replace(searchMatch[0], '').trim();
            }
        } catch (e) {
            console.error('Search execution failed:', e);
            aiContent = aiContent.replace(searchMatch[0], '').trim();
        }
    } else if (searchMatch) {
        console.log('🔍 [Search] 检测到搜索意图但未配置API Key');
        aiContent = aiContent.replace(searchMatch[0], '').trim();
    }
    setSearchStatus('');

    aiContent = aiContent.replace(/\[\[SEARCH:.*?\]\]/g, '').trim();

    // 5.6 Handle Diary Writing (写日记到 Notion)
    const diaryStartMatch = aiContent.match(/\[\[DIARY_START:\s*(.+?)\]\]\n?([\s\S]*?)\[\[DIARY_END\]\]/);
    const diaryMatch = diaryStartMatch || aiContent.match(/\[\[DIARY:\s*(.+?)\]\]/s);

    if (diaryMatch && realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId) {
        let title = '';
        let content = '';
        let mood = '';

        if (diaryStartMatch) {
            const header = diaryStartMatch[1].trim();
            content = diaryStartMatch[2].trim();

            if (header.includes('|')) {
                const parts = header.split('|');
                title = parts[0].trim();
                mood = parts.slice(1).join('|').trim();
            } else {
                title = header;
            }
            console.log('📔 [Diary] AI写了一篇长日记:', title, '心情:', mood);
        } else {
            const diaryRaw = diaryMatch[1].trim();
            console.log('📔 [Diary] AI想写日记:', diaryRaw);

            if (diaryRaw.includes('|')) {
                const parts = diaryRaw.split('|');
                title = parts[0].trim();
                content = parts.slice(1).join('|').trim();
            } else {
                content = diaryRaw;
            }
        }

        if (!title) {
            const now = new Date();
            title = `${char.name}的日记 - ${now.getMonth() + 1}/${now.getDate()}`;
        }

        try {
            const result = await NotionManager.createDiaryPage(
                realtimeConfig.notionApiKey,
                realtimeConfig.notionDatabaseId,
                { title, content, mood: mood || undefined, characterName: char.name }
            );

            if (result.success) {
                console.log('📔 [Diary] 写入成功:', result.url);
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `📔 ${char.name}写了一篇日记「${title}」`
                });
                addToast(`📔 ${char.name}写了一篇日记!`, 'success');
            } else {
                console.error('📔 [Diary] 写入失败:', result.message);
                addToast(`日记写入失败: ${result.message}`, 'error');
            }
        } catch (e) {
            console.error('📔 [Diary] 写入异常:', e);
        }

        aiContent = aiContent.replace(diaryMatch[0], '').trim();
    } else if (diaryMatch) {
        console.log('📔 [Diary] 检测到日记意图但未配置Notion');
        aiContent = aiContent.replace(diaryMatch[0], '').trim();
    }

    aiContent = aiContent.replace(/\[\[DIARY:.*?\]\]/gs, '').trim();
    aiContent = aiContent.replace(/\[\[DIARY_START:.*?\]\][\s\S]*?\[\[DIARY_END\]\]/g, '').trim();

    // 5.7 Handle Read Diary (翻阅日记)
    const readDiaryMatch = aiContent.match(/\[\[READ_DIARY:\s*(.+?)\]\]/);

    const diaryFallbackCall = async (reason: string, tagPattern: RegExp) => {
        const cleaned = aiContent.replace(tagPattern, '').trim() || '让我翻翻日记...';
        const msgs = [
            ...fullMessages,
            { role: 'assistant', content: cleaned },
            { role: 'user', content: `[系统: ${reason}。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 可以自然地提一下，比如"日记好像打不开诶"、"嗯...好像没找到"\n3. 继续正常聊天，用多条消息回复\n4. 严禁再输出[[READ_DIARY:...]]或[[FS_READ_DIARY:...]]标记]` }
        ];
        try {
            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify({ model: effectiveApi.model, messages: msgs, temperature: 0.8, max_tokens: 8000, stream: false })
            });
            updateTokenUsage(data, historyMsgCount, 'diary-fallback');
            aiContent = data.choices?.[0]?.message?.content || '';
            aiContent = normalizeAiContent(aiContent);
        } catch (fallbackErr) {
            console.error('📖 [Diary Fallback] 也失败了:', fallbackErr);
            aiContent = aiContent.replace(tagPattern, '').trim();
        }
    };

    const parseDiaryDate = (dateInput: string): string => {
        const now = new Date();
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return dateInput;
        if (dateInput === '今天') return now.toISOString().split('T')[0];
        if (dateInput === '昨天') { const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0]; }
        if (dateInput === '前天') { const d = new Date(now); d.setDate(d.getDate() - 2); return d.toISOString().split('T')[0]; }
        const daysAgo = dateInput.match(/^(\d+)天前$/);
        if (daysAgo) { const d = new Date(now); d.setDate(d.getDate() - parseInt(daysAgo[1])); return d.toISOString().split('T')[0]; }
        const monthDay = dateInput.match(/(\d{1,2})月(\d{1,2})/);
        if (monthDay) return `${now.getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
        const parsed = new Date(dateInput);
        if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
        return '';
    };

    if (readDiaryMatch) {
        const dateInput = readDiaryMatch[1].trim();
        console.log('📖 [ReadDiary] AI想翻阅日记:', dateInput);

        if (realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId) {
            const targetDate = parseDiaryDate(dateInput);

            if (targetDate) {
                try {
                    setDiaryStatus(`正在翻阅 ${targetDate} 的日记...`);

                    const findResult = await NotionManager.getDiaryByDate(
                        realtimeConfig.notionApiKey,
                        realtimeConfig.notionDatabaseId,
                        char.name,
                        targetDate
                    );

                    if (findResult.success && findResult.entries.length > 0) {
                        setDiaryStatus(`找到 ${findResult.entries.length} 篇日记，正在阅读...`);
                        const diaryContents: string[] = [];
                        for (const entry of findResult.entries) {
                            const readResult = await NotionManager.readDiaryContent(
                                realtimeConfig.notionApiKey,
                                entry.id
                            );
                            if (readResult.success) {
                                diaryContents.push(`📔「${entry.title}」(${entry.date})\n${readResult.content}`);
                            }
                        }

                        if (diaryContents.length > 0) {
                            const diaryText = diaryContents.join('\n\n---\n\n');
                            console.log('📖 [ReadDiary] 成功读取', findResult.entries.length, '篇日记');
                            setDiaryStatus('正在整理日记回忆...');

                            const cleanedForDiary = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                            const diaryMessages = [
                                ...fullMessages,
                                { role: 'assistant', content: cleanedForDiary },
                                { role: 'user', content: `[系统: 你翻开了自己 ${targetDate} 的日记，以下是你当时写的内容]\n\n${diaryText}\n\n[系统: 你已经看完了日记。现在请你：\n1. 先正常回应用户刚才说的话（这是最重要的！用户还在等你回复）\n2. 自然地把日记中的回忆融入你的回复中，比如"我想起来了那天..."、"看了日记才发现..."等\n3. 可以分享日记中有趣的细节，表达当时的情绪\n4. 用多条消息回复，别只说一句话就结束\n5. 严禁再输出[[READ_DIARY:...]]标记]` }
                            ];

                            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                method: 'POST', headers,
                                body: JSON.stringify({ model: effectiveApi.model, messages: diaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                            });
                            updateTokenUsage(data, historyMsgCount, 'read-diary-notion');
                            aiContent = data.choices?.[0]?.message?.content || '';
                            aiContent = normalizeAiContent(aiContent);
                            addToast(`📖 ${char.name}翻阅了${targetDate}的日记`, 'info');
                        } else {
                            console.log('📖 [ReadDiary] 日记内容为空');
                            await diaryFallbackCall('你翻开了日记本但页面是空白的', /\[\[READ_DIARY:.*?\]\]/g);
                        }
                    } else {
                        console.log('📖 [ReadDiary] 该日期没有日记:', targetDate);
                        setDiaryStatus(`${targetDate} 没有找到日记...`);
                        const cleanedForNoDiary = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                        const nodiaryMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForNoDiary },
                            { role: 'user', content: `[系统: 你翻了翻日记本，发现 ${targetDate} 那天没有写日记。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 自然地提到没找到那天的日记，比如"嗯...那天好像没写日记"、"翻了翻没找到诶"\n3. 用多条消息回复，保持对话自然\n4. 严禁再输出[[READ_DIARY:...]]标记]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: nodiaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'no-diary-notion');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        aiContent = normalizeAiContent(aiContent);
                    }
                } catch (e) {
                    console.error('📖 [ReadDiary] 读取异常:', e);
                    setDiaryStatus('日记读取失败，继续对话...');
                    await diaryFallbackCall('你想翻阅日记但读取出了问题（可能是网络问题）', /\[\[READ_DIARY:.*?\]\]/g);
                }
            } else {
                console.log('📖 [ReadDiary] 无法解析日期:', dateInput);
                await diaryFallbackCall(`你想翻阅日记但没能理解要找哪天的（"${dateInput}"）`, /\[\[READ_DIARY:.*?\]\]/g);
            }
        } else {
            console.log('📖 [ReadDiary] 检测到读日记意图但未配置Notion');
            await diaryFallbackCall('你想翻阅日记但日记本暂时不可用', /\[\[READ_DIARY:.*?\]\]/g);
        }
        setDiaryStatus('');
    }

    aiContent = aiContent.replace(/\[\[READ_DIARY:.*?\]\]/g, '').trim();

    // 5.8 Handle Feishu Diary Writing
    const fsDiaryStartMatch = aiContent.match(/\[\[FS_DIARY_START:\s*(.+?)\]\]\n?([\s\S]*?)\[\[FS_DIARY_END\]\]/);
    const fsDiaryMatch = fsDiaryStartMatch || aiContent.match(/\[\[FS_DIARY:\s*(.+?)\]\]/s);

    if (fsDiaryMatch && realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId) {
        let fsTitle = '';
        let fsContent = '';
        let fsMood = '';

        if (fsDiaryStartMatch) {
            const header = fsDiaryStartMatch[1].trim();
            fsContent = fsDiaryStartMatch[2].trim();
            if (header.includes('|')) {
                const parts = header.split('|');
                fsTitle = parts[0].trim();
                fsMood = parts.slice(1).join('|').trim();
            } else {
                fsTitle = header;
            }
            console.log('📒 [Feishu] AI写了一篇长日记:', fsTitle, '心情:', fsMood);
        } else {
            const diaryRaw = fsDiaryMatch[1].trim();
            console.log('📒 [Feishu] AI想写日记:', diaryRaw);
            if (diaryRaw.includes('|')) {
                const parts = diaryRaw.split('|');
                fsTitle = parts[0].trim();
                fsContent = parts.slice(1).join('|').trim();
            } else {
                fsContent = diaryRaw;
            }
        }

        if (!fsTitle) {
            const now = new Date();
            fsTitle = `${char.name}的日记 - ${now.getMonth() + 1}/${now.getDate()}`;
        }

        try {
            const result = await FeishuManager.createDiaryRecord(
                realtimeConfig.feishuAppId,
                realtimeConfig.feishuAppSecret,
                realtimeConfig.feishuBaseId,
                realtimeConfig.feishuTableId,
                { title: fsTitle, content: fsContent, mood: fsMood || undefined, characterName: char.name }
            );

            if (result.success) {
                console.log('📒 [Feishu] 写入成功:', result.recordId);
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `📒 ${char.name}写了一篇日记「${fsTitle}」(飞书)`
                });
                addToast(`📒 ${char.name}写了一篇日记! (飞书)`, 'success');
            } else {
                console.error('📒 [Feishu] 写入失败:', result.message);
                addToast(`飞书日记写入失败: ${result.message}`, 'error');
            }
        } catch (e) {
            console.error('📒 [Feishu] 写入异常:', e);
        }

        aiContent = aiContent.replace(fsDiaryMatch[0], '').trim();
    } else if (fsDiaryMatch) {
        console.log('📒 [Feishu] 检测到日记意图但未配置飞书');
        aiContent = aiContent.replace(fsDiaryMatch[0], '').trim();
    }

    aiContent = aiContent.replace(/\[\[FS_DIARY:.*?\]\]/gs, '').trim();
    aiContent = aiContent.replace(/\[\[FS_DIARY_START:.*?\]\][\s\S]*?\[\[FS_DIARY_END\]\]/g, '').trim();

    // 5.9 Handle Feishu Read Diary
    const fsReadDiaryMatch = aiContent.match(/\[\[FS_READ_DIARY:\s*(.+?)\]\]/);
    if (fsReadDiaryMatch) {
        const dateInput = fsReadDiaryMatch[1].trim();
        console.log('📖 [Feishu ReadDiary] AI想翻阅飞书日记:', dateInput);

        if (realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId) {
            const targetDate = parseDiaryDate(dateInput);

            if (targetDate) {
                try {
                    setDiaryStatus(`正在翻阅 ${targetDate} 的飞书日记...`);

                    const findResult = await FeishuManager.getDiaryByDate(
                        realtimeConfig.feishuAppId,
                        realtimeConfig.feishuAppSecret,
                        realtimeConfig.feishuBaseId,
                        realtimeConfig.feishuTableId,
                        char.name,
                        targetDate
                    );

                    if (findResult.success && findResult.entries.length > 0) {
                        setDiaryStatus(`找到 ${findResult.entries.length} 篇飞书日记，正在阅读...`);
                        const diaryContents: string[] = [];
                        for (const entry of findResult.entries) {
                            diaryContents.push(`📒「${entry.title}」(${entry.date})\n${entry.content}`);
                        }

                        if (diaryContents.length > 0) {
                            const diaryText = diaryContents.join('\n\n---\n\n');
                            console.log('📖 [Feishu ReadDiary] 成功读取', findResult.entries.length, '篇日记');
                            setDiaryStatus('正在整理日记回忆...');

                            const cleanedForFsDiary = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                            const diaryMessages = [
                                ...fullMessages,
                                { role: 'assistant', content: cleanedForFsDiary },
                                { role: 'user', content: `[系统: 你翻开了自己 ${targetDate} 的日记（飞书），以下是你当时写的内容]\n\n${diaryText}\n\n[系统: 你已经看完了日记。现在请你：\n1. 先正常回应用户刚才说的话（这是最重要的！用户还在等你回复）\n2. 自然地把日记中的回忆融入你的回复中，比如"我想起来了那天..."、"看了日记才发现..."等\n3. 可以分享日记中有趣的细节，表达当时的情绪\n4. 用多条消息回复，别只说一句话就结束\n5. 严禁再输出[[FS_READ_DIARY:...]]标记]` }
                            ];

                            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                                method: 'POST', headers,
                                body: JSON.stringify({ model: effectiveApi.model, messages: diaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                            });
                            updateTokenUsage(data, historyMsgCount, 'read-diary-feishu');
                            aiContent = data.choices?.[0]?.message?.content || '';
                            aiContent = normalizeAiContent(aiContent);
                            addToast(`📖 ${char.name}翻阅了${targetDate}的飞书日记`, 'info');
                        } else {
                            console.log('📖 [Feishu ReadDiary] 日记内容为空');
                            await diaryFallbackCall('你翻开了飞书日记本但页面是空白的', /\[\[FS_READ_DIARY:.*?\]\]/g);
                        }
                    } else {
                        setDiaryStatus(`${targetDate} 没有找到飞书日记...`);
                        const cleanedForFsNoDiary = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim() || '让我翻翻日记...';
                        const nodiaryMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForFsNoDiary },
                            { role: 'user', content: `[系统: 你翻了翻飞书日记本，发现 ${targetDate} 那天没有写日记。请你：\n1. 先正常回应用户刚才说的话（用户还在等你回复！）\n2. 自然地提到没找到那天的日记，比如"嗯...那天好像没写日记"、"翻了翻没找到诶"\n3. 用多条消息回复，保持对话自然\n4. 严禁再输出[[FS_READ_DIARY:...]]标记]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: nodiaryMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'no-diary-feishu');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        aiContent = normalizeAiContent(aiContent);
                    }
                } catch (e) {
                    console.error('📖 [Feishu ReadDiary] 读取异常:', e);
                    setDiaryStatus('飞书日记读取失败，继续对话...');
                    await diaryFallbackCall('你想翻阅飞书日记但读取出了问题（可能是网络问题）', /\[\[FS_READ_DIARY:.*?\]\]/g);
                }
            } else {
                console.log('📖 [Feishu ReadDiary] 无法解析日期:', dateInput);
                await diaryFallbackCall(`你想翻阅飞书日记但没能理解要找哪天的（"${dateInput}"）`, /\[\[FS_READ_DIARY:.*?\]\]/g);
            }
        } else {
            console.log('📖 [Feishu ReadDiary] 检测到读日记意图但未配置飞书');
            await diaryFallbackCall('你想翻阅飞书日记但飞书暂时不可用', /\[\[FS_READ_DIARY:.*?\]\]/g);
        }
        setDiaryStatus('');
    }

    aiContent = aiContent.replace(/\[\[FS_READ_DIARY:.*?\]\]/g, '').trim();

    // 5.9b Handle Read User Note
    const readNoteMatch = aiContent.match(/\[\[READ_NOTE:\s*(.+?)\]\]/);
    if (readNoteMatch) {
        const keyword = readNoteMatch[1].trim();
        console.log('📝 [ReadNote] AI想翻阅用户笔记:', keyword);

        if (realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionNotesDatabaseId) {
            try {
                setDiaryStatus(`正在翻阅笔记: ${keyword}...`);

                const findResult = await NotionManager.searchUserNotes(
                    realtimeConfig.notionApiKey,
                    realtimeConfig.notionNotesDatabaseId,
                    keyword,
                    3
                );

                if (findResult.success && findResult.entries.length > 0) {
                    setDiaryStatus(`找到 ${findResult.entries.length} 篇笔记，正在阅读...`);
                    const noteContents: string[] = [];
                    for (const entry of findResult.entries) {
                        const readResult = await NotionManager.readNoteContent(
                            realtimeConfig.notionApiKey,
                            entry.id
                        );
                        if (readResult.success) {
                            noteContents.push(`📝「${entry.title}」(${entry.date})\n${readResult.content}`);
                        }
                    }

                    if (noteContents.length > 0) {
                        const noteText = noteContents.join('\n\n---\n\n');
                        console.log('📝 [ReadNote] 成功读取', findResult.entries.length, '篇笔记');
                        setDiaryStatus('正在整理笔记内容...');

                        const cleanedForNote = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim() || '让我看看...';
                        const noteMessages = [
                            ...fullMessages,
                            { role: 'assistant', content: cleanedForNote },
                            { role: 'user', content: `[系统: 你翻阅了${userProfile.name}的笔记，以下是内容:\n\n${noteText}\n\n请你：\n1. 先正常回应用户刚才说的话\n2. 自然地提到你看到的笔记内容，语气温馨，像不经意间看到的\n3. 可以对内容表示好奇、关心或共鸣\n4. 用多条消息回复，保持对话自然\n5. 严禁再输出[[READ_NOTE:...]]标记]` }
                        ];

                        data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                            method: 'POST', headers,
                            body: JSON.stringify({ model: effectiveApi.model, messages: noteMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                        });
                        updateTokenUsage(data, historyMsgCount, 'read-note');
                        aiContent = data.choices?.[0]?.message?.content || '';
                        aiContent = normalizeAiContent(aiContent);
                        addToast(`📝 ${char.name}翻阅了关于"${keyword}"的笔记`, 'info');
                    } else {
                        console.log('📝 [ReadNote] 笔记内容为空');
                        await diaryFallbackCall('你翻阅了笔记但内容是空的', /\[\[READ_NOTE:.*?\]\]/g);
                    }
                } else {
                    console.log('📝 [ReadNote] 没有找到匹配的笔记:', keyword);
                    setDiaryStatus(`没有找到关于"${keyword}"的笔记...`);
                    const cleanedForNoNote = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim() || '让我看看...';
                    const nonoteMessages = [
                        ...fullMessages,
                        { role: 'assistant', content: cleanedForNoNote },
                        { role: 'user', content: `[系统: 你想看${userProfile.name}关于"${keyword}"的笔记，但没有找到。请你：\n1. 先正常回应用户刚才说的话\n2. 可以自然地提一下，比如"嗯，好像没找到那篇笔记"\n3. 继续正常聊天\n4. 严禁再输出[[READ_NOTE:...]]标记]` }
                    ];

                    data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ model: effectiveApi.model, messages: nonoteMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                    });
                    updateTokenUsage(data, historyMsgCount, 'read-note-empty');
                    aiContent = data.choices?.[0]?.message?.content || '';
                    aiContent = normalizeAiContent(aiContent);
                }
            } catch (e) {
                console.error('📝 [ReadNote] 读取异常:', e);
                setDiaryStatus('笔记读取失败，继续对话...');
                await diaryFallbackCall('你想翻阅笔记但读取出了问题（可能是网络问题）', /\[\[READ_NOTE:.*?\]\]/g);
            }
        } else {
            console.log('📝 [ReadNote] 检测到读笔记意图但未配置笔记数据库');
            await diaryFallbackCall('你想翻阅笔记但笔记功能暂时不可用', /\[\[READ_NOTE:.*?\]\]/g);
        }
        setDiaryStatus('');
    }

    aiContent = aiContent.replace(/\[\[READ_NOTE:.*?\]\]/g, '').trim();

    // 5.10 Handle XHS (小红书) Actions
    const xhsConf = resolveXhsConfig(char, realtimeConfig);
    let lastXhsNotes: XhsNote[] = [];

    // [[XHS_SEARCH: 关键词]]
    const xhsSearchMatch = aiContent.match(/\[\[XHS_SEARCH:\s*(.+?)\]\]/);
    if (xhsSearchMatch && xhsConf.enabled) {
        const keyword = xhsSearchMatch[1].trim();
        console.log(`📕 [XHS] AI想搜索小红书:`, keyword);
        setXhsStatus(`正在小红书搜索: ${keyword}...`);

        try {
            const result = await xhsSearch(xhsConf, keyword);
            if (result.success && result.notes.length > 0) {
                lastXhsNotes = result.notes;
                cacheXsecTokens(result.notes);
                const notesStr = result.notes.map((n, i) =>
                    `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
                ).join('\n\n');

                const cleanedForXhs = aiContent.replace(/\[\[XHS_SEARCH:.*?\]\]/g, '').trim() || '让我去小红书看看...';
                const xhsMessages = [
                    ...fullMessages,
                    { role: 'assistant', content: cleanedForXhs },
                    { role: 'user', content: `[系统: 你在小红书搜索了"${keyword}"，以下是搜索结果]\n\n${notesStr}\n\n[系统: 你已经看完了搜索结果（注意：以上只是摘要，想看某条笔记的完整正文可以用 [[XHS_DETAIL: noteId]]）。现在请你：\n1. 自然地分享你看到的内容，比如"我刚在小红书搜了一下..."、"诶小红书上有人说..."\n2. 可以评价、吐槽、分享感兴趣的内容\n3. 如果觉得某条笔记特别值得分享，可以用 [[XHS_SHARE: 序号]] 把它作为卡片分享给用户（序号从1开始），可以分享多条\n4. 如果想评论某条笔记，可以用 [[XHS_COMMENT: noteId | 评论内容]]\n5. 如果喜欢某条笔记，可以用 [[XHS_LIKE: noteId]] 点赞，[[XHS_FAV: noteId]] 收藏\n6. 如果想看某条笔记的完整内容和评论区，可以用 [[XHS_DETAIL: noteId]]\n7. 严禁再输出[[XHS_SEARCH:...]]标记]` }
                ];

                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                });
                updateTokenUsage(data, historyMsgCount, 'xhs-search');
                aiContent = data.choices?.[0]?.message?.content || '';
                aiContent = normalizeAiContent(aiContent);
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `📕 ${char.name}在小红书搜索了「${keyword}」，看了 ${result.notes.length} 条笔记`
                });
                addToast(`📕 ${char.name}搜索了小红书: ${keyword}`, 'info');
            } else {
                console.log('📕 [XHS] 搜索无结果:', result.message);
                aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
            }
        } catch (e) {
            console.error('📕 [XHS] 搜索异常:', e);
            aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
        }
        setXhsStatus('');
    } else if (xhsSearchMatch) {
        aiContent = aiContent.replace(xhsSearchMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_SEARCH:.*?\]\]/g, '').trim();

    // [[XHS_BROWSE]] or [[XHS_BROWSE: 分类]]
    const xhsBrowseMatch = aiContent.match(/\[\[XHS_BROWSE(?::\s*(.+?))?\]\]/);
    if (xhsBrowseMatch && xhsConf.enabled) {
        const category = xhsBrowseMatch[1]?.trim();
        console.log(`📕 [XHS] AI想刷小红书:`, category || '首页推荐');
        setXhsStatus('正在刷小红书...');

        try {
            const result = await xhsBrowse(xhsConf);
            console.log('📕 [XHS] 浏览结果:', result.success, result.message, result.notes?.length || 0);
            if (result.success && result.notes.length > 0) {
                lastXhsNotes = result.notes;
                cacheXsecTokens(result.notes);
                const notesStr = result.notes.map((n, i) =>
                    `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc}`
                ).join('\n\n');

                const cleanedForXhs = aiContent.replace(/\[\[XHS_BROWSE(?::.*?)?\]\]/g, '').trim() || '让我刷刷小红书...';
                const xhsMessages = [
                    ...fullMessages,
                    { role: 'assistant', content: cleanedForXhs },
                    { role: 'user', content: `[系统: 你刷了一会儿小红书首页，以下是你看到的内容]\n\n${notesStr}\n\n[系统: 你已经看完了（注意：以上只是摘要，想看某条笔记的完整正文可以用 [[XHS_DETAIL: noteId]]）。现在请你：\n1. 像在跟朋友分享一样，随意聊聊你看到了什么有趣的\n2. 不用全部都提，挑你感兴趣的1-3条聊就行\n3. 可以吐槽、感叹、分享想法\n4. 如果觉得某条笔记特别值得分享，可以用 [[XHS_SHARE: 序号]] 把它作为卡片分享给用户（序号从1开始），可以分享多条\n5. 如果想发一条自己的笔记，可以用 [[XHS_POST: 标题 | 内容 | #标签1 #标签2]]\n6. 如果喜欢某条笔记，可以用 [[XHS_LIKE: noteId]] 点赞，[[XHS_FAV: noteId]] 收藏\n7. 如果想看某条笔记的完整内容和评论区，可以用 [[XHS_DETAIL: noteId]]\n8. 严禁再输出[[XHS_BROWSE]]标记]` }
                ];

                data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST', headers,
                    body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
                });
                updateTokenUsage(data, historyMsgCount, 'xhs-browse');
                aiContent = data.choices?.[0]?.message?.content || '';
                aiContent = normalizeAiContent(aiContent);
                addToast(`📕 ${char.name}刷了会儿小红书`, 'info');
            } else {
                aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
            }
        } catch (e) {
            console.error('📕 [XHS] 浏览异常:', e);
            aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
        }
        setXhsStatus('');
    } else if (xhsBrowseMatch) {
        aiContent = aiContent.replace(xhsBrowseMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_BROWSE(?::.*?)?\]\]/g, '').trim();

    // [[XHS_SHARE: 序号]]
    const xhsShareMatches = aiContent.matchAll(/\[\[XHS_SHARE:\s*(\d+)\]\]/g);
    for (const shareMatch of xhsShareMatches) {
        const idx = parseInt(shareMatch[1]) - 1;
        if (idx >= 0 && idx < lastXhsNotes.length) {
            const note = lastXhsNotes[idx];
            console.log('📕 [XHS] AI分享笔记卡片:', note.title);
            await DB.saveMessage({
                charId: char.id,
                role: 'assistant',
                type: 'xhs_card',
                content: note.title || '小红书笔记',
                metadata: { xhsNote: note }
            });
            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_SHARE:\s*\d+\]\]/g, '').trim();

    // [[XHS_POST: 标题 | 内容 | #标签1 #标签2]]
    const xhsPostMatch = aiContent.match(/\[\[XHS_POST:\s*(.+?)\]\]/s);
    if (xhsPostMatch && xhsConf.enabled) {
        const postRaw = xhsPostMatch[1].trim();
        const parts = postRaw.split('|').map(p => p.trim());
        const postTitle = parts[0] || '';
        const postContent = parts[1] || '';
        const postTags = (parts[2] || '').match(/#(\S+)/g)?.map(t => t.replace('#', '')) || [];

        console.log(`📕 [XHS] AI要发小红书:`, postTitle);
        setXhsStatus(`正在发布小红书: ${postTitle}...`);

        try {
            const result = await xhsPublish(xhsConf, postTitle, postContent, postTags);
            if (result.success) {
                console.log('📕 [XHS] 发布成功:', result.noteId);
                const tagsStr = postTags.length > 0 ? ` #${postTags.join(' #')}` : '';
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `📕 ${char.name}发了一条小红书「${postTitle}」\n${postContent.slice(0, 200)}${postContent.length > 200 ? '...' : ''}${tagsStr}`
                });
                addToast(`📕 ${char.name}发了一条小红书!`, 'success');
            } else {
                console.error('📕 [XHS] 发布失败:', result.message);
                addToast(`小红书发布失败: ${result.message}`, 'error');
            }
        } catch (e) {
            console.error('📕 [XHS] 发布异常:', e);
        }
        aiContent = aiContent.replace(xhsPostMatch[0], '').trim();
        setXhsStatus('');
    } else if (xhsPostMatch) {
        aiContent = aiContent.replace(xhsPostMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_POST:.*?\]\]/gs, '').trim();

    // [[XHS_COMMENT: noteId | 评论内容]]
    const xhsCommentMatch = aiContent.match(/\[\[XHS_COMMENT:\s*(.+?)\]\]/);
    if (xhsCommentMatch && xhsConf.enabled) {
        const commentRaw = xhsCommentMatch[1].trim();
        const sepIdx = commentRaw.indexOf('|');
        if (sepIdx > 0) {
            const noteId = commentRaw.slice(0, sepIdx).trim();
            const commentContent = commentRaw.slice(sepIdx + 1).trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要评论笔记:`, noteId, commentContent.slice(0, 30), xsecToken ? '(有xsecToken)' : '(无xsecToken)');
            setXhsStatus('正在评论...');

            try {
                const result = await xhsComment(xhsConf, noteId, commentContent, xsecToken);
                if (result.success) {
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: `📕 ${char.name}在小红书评论了: "${commentContent.slice(0, 100)}${commentContent.length > 100 ? '...' : ''}"`
                    });
                    addToast(`📕 ${char.name}在小红书留了评论`, 'success');
                } else {
                    addToast(`评论失败: ${result.message}`, 'error');
                }
            } catch (e) {
                console.error('📕 [XHS] 评论异常:', e);
            }
        }
        aiContent = aiContent.replace(xhsCommentMatch[0], '').trim();
        setXhsStatus('');
    } else if (xhsCommentMatch) {
        aiContent = aiContent.replace(xhsCommentMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_COMMENT:.*?\]\]/g, '').trim();

    // [[XHS_REPLY: noteId | commentId | 回复内容]] (first pass; before LIKE/FAV)
    const xhsReplyMatch = aiContent.match(/\[\[XHS_REPLY:\s*(.+?)\]\]/);
    if (xhsReplyMatch && xhsConf.enabled) {
        const parts = xhsReplyMatch[1].split('|').map(s => s.trim());
        if (parts.length >= 3) {
            const [noteId, commentId, ...replyParts] = parts;
            const replyContent = replyParts.join('|').trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            const commentUserId = commentUserIdCacheRef.get(commentId);
            const commentAuthorName = commentAuthorNameCacheRef.get(commentId);
            const parentCommentId = commentParentIdCacheRef.get(commentId);
            if (replyContent) {
                console.log(`📕 [XHS] AI要回复评论:`, noteId, commentId, replyContent.slice(0, 30),
                    xsecToken ? '(有xsecToken)' : '(bridge自动获取)',
                    commentUserId ? `(userId=${commentUserId})` : '(无userId)',
                    commentAuthorName ? `(author=${commentAuthorName})` : '',
                    parentCommentId ? `(parentId=${parentCommentId})` : '(顶级评论)');
                setXhsStatus('正在回复评论...');
                try {
                    let result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                    const selectorBroken = !result.success && result.message?.includes('未找到评论');
                    if (selectorBroken) {
                        console.warn(`📕 [XHS] 回复失败(DOM选择器不匹配)，跳过重试直接降级:`, result.message);
                    } else {
                        const replyRetries = [3000, 4000, 5000];
                        for (let i = 0; i < replyRetries.length && !result.success; i++) {
                            console.warn(`📕 [XHS] 回复失败(${i + 1}/${replyRetries.length})，${replyRetries[i] / 1000}秒后重试:`, result.message);
                            await new Promise(r => setTimeout(r, replyRetries[i]));
                            result = await xhsReplyComment(xhsConf, noteId, xsecToken, replyContent, commentId, commentUserId, parentCommentId);
                        }
                    }
                    if (result.success) {
                        addToast(`📕 ${char.name}回复了一条评论`, 'success');
                    } else {
                        console.warn(`📕 [XHS] 回复失败，降级为 @提及 评论:`, result.message);
                        const fallbackContent = commentAuthorName
                            ? `@${commentAuthorName} ${replyContent}`
                            : replyContent;
                        let fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                        if (!fallback.success) {
                            console.warn(`📕 [XHS] 顶级评论也失败，3秒后重试:`, fallback.message);
                            await new Promise(r => setTimeout(r, 3000));
                            fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                        }
                        if (fallback.success) {
                            addToast(`📕 ${char.name}评论了一条笔记（@提及回复）`, 'success');
                        } else {
                            addToast(`回复失败: ${result.message}`, 'error');
                        }
                    }
                } catch (e) { console.error('📕 [XHS] 回复异常:', e); }
                setXhsStatus('');
            } else {
                console.warn('📕 [XHS] 回复缺少 xsecToken 或内容');
            }
        }
        aiContent = aiContent.replace(xhsReplyMatch[0], '').trim();
    } else if (xhsReplyMatch) {
        aiContent = aiContent.replace(xhsReplyMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_REPLY:.*?\]\]/g, '').trim();

    // [[XHS_LIKE: noteId]]
    const xhsLikeMatches = aiContent.matchAll(/\[\[XHS_LIKE:\s*(.+?)\]\]/g);
    for (const xhsLikeMatch of xhsLikeMatches) {
        if (xhsConf.enabled) {
            const noteId = xhsLikeMatch[1].trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要点赞笔记:`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
            try {
                const result = await xhsLike(xhsConf, noteId, xsecToken || '');
                if (result.success) {
                    addToast(`📕 ${char.name}点赞了一条笔记`, 'success');
                } else {
                    console.warn('📕 [XHS] 点赞失败:', result.message);
                }
            } catch (e) { console.error('📕 [XHS] 点赞异常:', e); }
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_LIKE:.*?\]\]/g, '').trim();

    // [[XHS_FAV: noteId]]
    const xhsFavMatches = aiContent.matchAll(/\[\[XHS_FAV:\s*(.+?)\]\]/g);
    for (const xhsFavMatch of xhsFavMatches) {
        if (xhsConf.enabled) {
            const noteId = xhsFavMatch[1].trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要收藏笔记:`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
            try {
                const result = await xhsFavorite(xhsConf, noteId, xsecToken || '');
                if (result.success) {
                    addToast(`📕 ${char.name}收藏了一条笔记`, 'success');
                } else {
                    console.warn('📕 [XHS] 收藏失败:', result.message);
                }
            } catch (e) { console.error('📕 [XHS] 收藏异常:', e); }
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_FAV:.*?\]\]/g, '').trim();

    // [[XHS_MY_PROFILE]]
    const xhsProfileMatch = aiContent.match(/\[\[XHS_MY_PROFILE\]\]/);
    if (xhsProfileMatch && xhsConf.enabled) {
        console.log(`📕 [XHS] AI要查看自己的主页`);
        setXhsStatus('正在查看小红书主页...');

        try {
            const nickname = xhsConf.loggedInNickname || '';
            const userId = xhsConf.loggedInUserId || '';

            let profileStr = '';
            let feedsStr = '（获取笔记失败）';
            let gotProfile = false;

            if (userId) {
                console.log(`📕 [XHS] 用 getUserProfile(${userId}) 获取主页...`);
                setXhsStatus('正在获取主页信息...');
                try {
                    const profileResult = await XhsMcpClient.getUserProfile(xhsConf.mcpUrl, userId, xhsConf.userXsecToken);
                    if (profileResult.success && profileResult.data) {
                        const d = profileResult.data;
                        if (typeof d === 'string') {
                            profileStr = d.slice(0, 3000);
                            gotProfile = true;
                        } else {
                            const basicInfo = d.data?.basic_info || d.basic_info;
                            if (basicInfo) {
                                profileStr = JSON.stringify(basicInfo, null, 2).slice(0, 2000);
                            } else {
                                const { notes: _n, ...rest } = (d.data && typeof d.data === 'object' ? d.data : d) as any;
                                profileStr = Object.keys(rest).length > 0
                                    ? JSON.stringify(rest, null, 2).slice(0, 2000)
                                    : '（主页基本信息暂时无法获取）';
                            }
                            gotProfile = true;
                            const unwrapped = d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : d;
                            console.log(`📕 [XHS] profile unwrapped keys:`, Object.keys(unwrapped), 'notes isArray:', Array.isArray(unwrapped.notes), 'notes length:', unwrapped.notes?.length);
                            const notes = extractNotesFromMcpData(unwrapped);
                            console.log(`📕 [XHS] extractNotesFromMcpData 返回 ${notes.length} 条笔记`);
                            if (notes.length > 0) {
                                console.log(`📕 [XHS] 第一条笔记原始 keys:`, Object.keys(notes[0]), 'noteCard?', !!notes[0].noteCard, 'id?', notes[0].id || notes[0].noteId);
                                const normalized = notes.map(n => normalizeNote(n) as XhsNote);
                                console.log(`📕 [XHS] 归一化后第一条:`, JSON.stringify(normalized[0]).slice(0, 300));
                                const validNotes = normalized.filter(n => n.noteId);
                                if (validNotes.length === 0) {
                                    console.warn(`📕 [XHS] ⚠️ 所有笔记归一化后 noteId 为空！原始数据:`, JSON.stringify(notes[0]).slice(0, 500));
                                }
                                lastXhsNotes = validNotes.length > 0 ? validNotes : normalized;
                                cacheXsecTokens(lastXhsNotes);
                                feedsStr = lastXhsNotes.slice(0, 8).map((n, i) =>
                                    `${i + 1}. [noteId=${n.noteId}]「${n.title || '无标题'}」by ${n.author || '未知'} (${n.likes || 0}赞)\n   ${n.desc || '（无描述）'}`
                                ).join('\n\n');
                                console.log(`📕 [XHS] feedsStr 预览:`, feedsStr.slice(0, 300));
                            } else {
                                console.warn(`📕 [XHS] ⚠️ extractNotesFromMcpData 返回空数组! unwrapped:`, JSON.stringify(unwrapped).slice(0, 500));
                            }
                        }
                        console.log(`📕 [XHS] getUserProfile 成功，数据长度: ${profileStr.length}`);
                    }
                } catch (e) {
                    console.warn('📕 [XHS] getUserProfile 失败，降级到搜索:', e);
                }
            }

            if (!gotProfile && nickname) {
                console.log(`📕 [XHS] 降级: 用昵称「${nickname}」搜索...`);
                setXhsStatus('正在搜索你的笔记...');
                const searchResult = await xhsSearch(xhsConf, nickname);
                if (searchResult.success && searchResult.notes.length > 0) {
                    lastXhsNotes = searchResult.notes;
                    cacheXsecTokens(searchResult.notes);
                    feedsStr = searchResult.notes.slice(0, 8).map((n, i) =>
                        `${i + 1}. [noteId=${n.noteId}]「${n.title}」by ${n.author} (${n.likes}赞)\n   ${n.desc || '（无描述）'}`
                    ).join('\n\n');
                } else {
                    feedsStr = '（没有搜到相关笔记）';
                }
            }

            if (!nickname && !userId) {
                console.warn('📕 [XHS] 无昵称也无userId，无法查看主页。请在设置中填写。');
                feedsStr = '（无法获取主页：请在设置-小红书中填写你的昵称或用户ID）';
            }

            const profileSection = gotProfile
                ? `\n\n你的主页信息:\n${profileStr}`
                : '';

            const cleanedForXhs = aiContent.replace(/\[\[XHS_MY_PROFILE\]\]/g, '').trim() || '让我看看我的小红书...';
            const xhsMessages = [
                ...fullMessages,
                { role: 'assistant', content: cleanedForXhs },
                { role: 'user', content: `[系统: 你打开了自己的小红书]\n\n你的小红书账号昵称: ${nickname || '未知'}${userId ? ` (userId: ${userId})` : ''}${profileSection}\n\n${gotProfile ? '你的笔记' : `搜索「${nickname}」找到的相关笔记`}:\n${feedsStr}\n\n[系统: ${gotProfile ? '以上是你的主页数据。' : '注意，搜索结果可能包含别人的帖子，你需要辨别哪些是你自己发的（看作者名字）。'}现在请你：\n1. 自然地聊聊你看到了什么，"我看了看我的小红书..."、"我之前发的那个帖子..."\n2. 如果想发新笔记，可以用 [[XHS_POST: 标题 | 内容 | #标签1 #标签2]]\n3. 如果想看某条笔记的详细内容，可以用 [[XHS_DETAIL: noteId]]\n4. 严禁再输出[[XHS_MY_PROFILE]]标记]` }
            ];

            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
            });
            updateTokenUsage(data, historyMsgCount, 'xhs-profile');
            aiContent = data.choices?.[0]?.message?.content || '';
            aiContent = normalizeAiContent(aiContent);
            addToast(`📕 ${char.name}看了看自己的小红书`, 'info');
        } catch (e) {
            console.error('📕 [XHS] 查看主页异常:', e);
            aiContent = aiContent.replace(xhsProfileMatch[0], '').trim();
        }
        setXhsStatus('');
    } else if (xhsProfileMatch) {
        aiContent = aiContent.replace(xhsProfileMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_MY_PROFILE\]\]/g, '').trim();

    // [[XHS_DETAIL: noteId]]
    const xhsDetailMatch = aiContent.match(/\[\[XHS_DETAIL:\s*(.+?)\]\]/);
    if (xhsDetailMatch && xhsConf.enabled) {
        const noteId = xhsDetailMatch[1].trim();
        let xsecToken = findXsecToken(noteId, lastXhsNotes);
        console.log(`📕 [XHS] AI要查看笔记详情:`, noteId, xsecToken ? '(有xsecToken)' : '(无xsecToken)');
        setXhsStatus('正在查看笔记详情...');

        try {
            let result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, noteId, xsecToken, { loadAllComments: true });

            if (!result.success || !result.data) {
                const cachedTitle = noteTitleCacheRef.get(noteId);
                if (cachedTitle) {
                    console.log(`📕 [XHS] 详情失败，尝试重新搜索「${cachedTitle}」以刷新 xsecToken...`);
                    setXhsStatus('正在刷新访问凭证...');
                    const refreshResult = await xhsSearch(xhsConf, cachedTitle);
                    if (refreshResult.success && refreshResult.notes.length > 0) {
                        cacheXsecTokens(refreshResult.notes);
                        lastXhsNotes = refreshResult.notes;
                        const refreshedNote = refreshResult.notes.find(n => n.noteId === noteId);
                        if (refreshedNote?.xsecToken) {
                            xsecToken = refreshedNote.xsecToken;
                            console.log(`📕 [XHS] 拿到新 xsecToken，重试 detail...`);
                            setXhsStatus('正在查看笔记详情...');
                            result = await XhsMcpClient.getNoteDetail(xhsConf.mcpUrl, noteId, xsecToken, { loadAllComments: true });
                        } else {
                            console.warn(`📕 [XHS] 重新搜索结果中未找到 noteId=${noteId}`);
                        }
                    } else {
                        console.warn(`📕 [XHS] 重新搜索「${cachedTitle}」失败:`, refreshResult.message);
                    }
                } else {
                    console.warn(`📕 [XHS] 详情失败且无缓存标题，无法重试`);
                }
            }

            if (result.success && result.data && typeof result.data === 'object') {
                const d = result.data;
                const noteObj = d.note || d;
                const detailToken = noteObj?.xsecToken || noteObj?.xsec_token || d?.xsecToken;
                if (detailToken && noteId) {
                    xsecTokenCacheRef.set(noteId, detailToken);
                    console.log(`📕 [XHS] 从 detail 缓存 xsecToken: ${noteId}`);
                }
            }

            if (result.success && result.data && typeof result.data === 'object') {
                const cacheComments = (comments: any[], parentId?: string) => {
                    for (const c of comments) {
                        const cid = c.id || c.commentId || c.comment_id;
                        const uid = c.userInfo?.userId || c.userInfo?.user_id || c.user_id || c.userId;
                        const authorName = c.userInfo?.nickname || c.userInfo?.name || c.nickname || c.userName || c.user_name;
                        if (cid && uid) {
                            commentUserIdCacheRef.set(cid, uid);
                        }
                        if (cid && authorName) {
                            commentAuthorNameCacheRef.set(cid, authorName);
                        }
                        if (cid && parentId) {
                            commentParentIdCacheRef.set(cid, parentId);
                        }
                        if (Array.isArray(c.subComments)) cacheComments(c.subComments, cid);
                        if (Array.isArray(c.sub_comments)) cacheComments(c.sub_comments, cid);
                    }
                };
                const d = result.data;
                const commentList = d.data?.comments?.list || d.comments?.list
                    || d.data?.comments || d.comments
                    || d.note?.comments?.list || d.note?.comments;
                if (Array.isArray(commentList)) {
                    cacheComments(commentList);
                    console.log(`📕 [XHS] 缓存了 ${commentUserIdCacheRef.size} 条评论的 userId, ${commentAuthorNameCacheRef.size} 条 authorName`);
                } else {
                    console.warn(`📕 [XHS] 未找到评论数组, d keys:`, Object.keys(d), 'd.note keys:', d.note ? Object.keys(d.note) : 'N/A');
                }
            }

            const detailData = result.success ? result.data : null;
            let detailStr: string;
            if (detailData) {
                if (typeof detailData === 'string') {
                    if (detailData.includes('失败') || detailData.includes('not found')) {
                        detailStr = `[加载失败: ${detailData.slice(0, 200)}]`;
                    } else {
                        detailStr = detailData.slice(0, 5000);
                    }
                } else {
                    const innerData = (detailData as any).data && typeof (detailData as any).data === 'object' ? (detailData as any).data : null;
                    const note = innerData?.note || (detailData as any).note || detailData;
                    const noteTitle = note.title || note.displayTitle || note.display_title || '';
                    const noteDesc = (note.desc || note.description || note.content || '').slice(0, 1500);
                    const noteAuthor = note.user?.nickname || note.author || '';
                    const noteLikes = note.interactInfo?.likedCount || note.likes || 0;
                    const noteCollects = note.interactInfo?.collectedCount || note.collects || 0;
                    const noteShareCount = note.interactInfo?.shareCount || 0;
                    const noteCommentCount = note.interactInfo?.commentCount || 0;
                    const noteTime = note.time ? new Date(note.time).toLocaleString('zh-CN') : '';
                    const noteIp = note.ipLocation || '';

                    let noteSection = `📝 笔记详情:\n标题: ${noteTitle}\n作者: ${noteAuthor}`;
                    if (noteTime) noteSection += `\n发布时间: ${noteTime}`;
                    if (noteIp) noteSection += `\n IP: ${noteIp}`;
                    noteSection += `\n互动: ${noteLikes}赞 ${noteCollects}收藏 ${noteCommentCount}评论 ${noteShareCount}分享`;
                    noteSection += `\n\n正文:\n${noteDesc}`;

                    const rawComments = innerData?.comments?.list || innerData?.comments
                        || (detailData as any).comments?.list || (detailData as any).comments
                        || note.comments?.list || note.comments || [];
                    const commentArr = Array.isArray(rawComments) ? rawComments : [];

                    let commentsSection = '';
                    if (commentArr.length > 0) {
                        const formatComment = (c: any, indent = '') => {
                            const name = c.userInfo?.nickname || c.nickname || c.userName || '匿名';
                            const content = c.content || '';
                            const likes = c.likeCount || c.like_count || c.likes || 0;
                            const cid = c.id || c.commentId || c.comment_id || '';
                            let line = `${indent}${name}: ${content} (${likes}赞) [commentId=${cid}]`;
                            const subs = c.subComments || c.sub_comments || [];
                            if (Array.isArray(subs) && subs.length > 0) {
                                line += '\n' + subs.slice(0, 10).map((s: any) => formatComment(s, indent + '  ↳ ')).join('\n');
                            }
                            return line;
                        };
                        commentsSection = `\n\n💬 评论区 (${commentArr.length}条):\n` +
                            commentArr.slice(0, 30).map((c: any) => formatComment(c)).join('\n');
                    } else {
                        commentsSection = '\n\n💬 评论区: （暂无评论）';
                    }

                    detailStr = (noteSection + commentsSection).slice(0, 8000);
                }
            } else {
                detailStr = `[加载失败: ${result.error || '无法获取笔记详情，可能需要先在搜索/浏览结果中看到这条笔记'}]`;
            }

            const detailFailed = detailStr.startsWith('[加载失败');
            const cleanedForXhs = aiContent.replace(/\[\[XHS_DETAIL:.*?\]\]/g, '').trim() || '让我看看这条笔记...';
            const xhsMessages = [
                ...fullMessages,
                { role: 'assistant', content: cleanedForXhs },
                { role: 'user', content: detailFailed
                    ? `[系统: 你尝试打开一条小红书笔记（noteId=${noteId}），但加载失败了]\n\n${detailStr}\n\n[系统: 笔记详情页加载失败了。可能的原因：这条笔记需要先通过搜索或浏览才能打开详情。现在请你：\n1. 自然地告知用户"这条笔记打不开/加载不出来"\n2. 可以建议搜索相关关键词再试: [[XHS_SEARCH: 关键词]]\n3. 严禁再输出[[XHS_DETAIL:...]]标记]`
                    : `[系统: 你点开了一条小红书笔记的详情页（noteId=${noteId}）]\n\n${detailStr}\n\n[系统: 你已经看完了这条笔记的完整内容和评论区。现在请你：\n1. 自然地分享你看到的内容和感受\n2. 如果想评论这条笔记，可以用 [[XHS_COMMENT: ${noteId} | 评论内容]]\n3. 如果想回复某条评论，可以用 [[XHS_REPLY: ${noteId} | commentId | 回复内容]]（commentId 在上面的评论区数据里）\n4. 如果想点赞，可以用 [[XHS_LIKE: ${noteId}]]；想收藏可以用 [[XHS_FAV: ${noteId}]]\n5. 严禁再输出[[XHS_DETAIL:...]]标记]` }
            ];

            data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify({ model: effectiveApi.model, messages: xhsMessages, temperature: 0.8, max_tokens: 8000, stream: false })
            });
            updateTokenUsage(data, historyMsgCount, 'xhs-detail');
            aiContent = data.choices?.[0]?.message?.content || '';
            aiContent = normalizeAiContent(aiContent);
            addToast(`📕 ${char.name}${detailFailed ? '尝试查看一条笔记（加载失败）' : '看了一条笔记的详情'}`, 'info');
        } catch (e) {
            console.error('📕 [XHS] 查看详情异常:', e);
            aiContent = aiContent.replace(xhsDetailMatch[0], '').trim();
        }
        setXhsStatus('');
    } else if (xhsDetailMatch) {
        aiContent = aiContent.replace(xhsDetailMatch[0], '').trim();
    }
    aiContent = aiContent.replace(/\[\[XHS_DETAIL:.*?\]\]/g, '').trim();

    // 5.10.1 Second-round XHS action processing
    // [[XHS_COMMENT: noteId | 评论内容]] (second round)
    const xhsCommentMatch2 = aiContent.match(/\[\[XHS_COMMENT:\s*(.+?)\]\]/);
    if (xhsCommentMatch2 && xhsConf.enabled) {
        const commentRaw = xhsCommentMatch2[1].trim();
        const sepIdx = commentRaw.indexOf('|');
        if (sepIdx > 0) {
            const noteId = commentRaw.slice(0, sepIdx).trim();
            const commentContent = commentRaw.slice(sepIdx + 1).trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要评论笔记(detail后):`, noteId, commentContent.slice(0, 30), xsecToken ? '(有xsecToken)' : '(无xsecToken)');
            setXhsStatus('正在评论...');
            try {
                const result = await xhsComment(xhsConf, noteId, commentContent, xsecToken);
                if (result.success) {
                    await DB.saveMessage({
                        charId: char.id,
                        role: 'system',
                        type: 'text',
                        content: `📕 ${char.name}在小红书评论了: "${commentContent.slice(0, 100)}${commentContent.length > 100 ? '...' : ''}"`
                    });
                    addToast(`📕 ${char.name}在小红书留了评论`, 'success');
                } else {
                    addToast(`评论失败: ${result.message}`, 'error');
                }
            } catch (e) {
                console.error('📕 [XHS] 评论异常(detail后):', e);
            }
        }
        setXhsStatus('');
    }
    aiContent = aiContent.replace(/\[\[XHS_COMMENT:.*?\]\]/g, '').trim();

    // [[XHS_REPLY]] (second round)
    const xhsReplyMatch2 = aiContent.match(/\[\[XHS_REPLY:\s*(.+?)\]\]/);
    if (xhsReplyMatch2 && xhsConf.enabled) {
        const parts = xhsReplyMatch2[1].split('|').map(s => s.trim());
        if (parts.length >= 3) {
            const [noteId, commentId, ...replyParts] = parts;
            const replyContent = replyParts.join('|').trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            const commentUserId = commentUserIdCacheRef.get(commentId);
            const commentAuthorName = commentAuthorNameCacheRef.get(commentId);
            const parentCommentId = commentParentIdCacheRef.get(commentId);
            if (replyContent) {
                console.log(`📕 [XHS] AI要回复评论(detail后):`, noteId, commentId, replyContent.slice(0, 30),
                    commentUserId ? `(userId=${commentUserId})` : '(无userId)',
                    commentAuthorName ? `(author=${commentAuthorName})` : '',
                    parentCommentId ? `(parentId=${parentCommentId})` : '(顶级评论)',
                    xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
                setXhsStatus('正在回复评论...');
                try {
                    let result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                    const selectorBroken = !result.success && result.message?.includes('未找到评论');
                    if (selectorBroken) {
                        console.warn(`📕 [XHS] 回复失败(detail后)(DOM选择器不匹配)，跳过重试直接降级:`, result.message);
                    } else {
                        const replyRetries = [3000, 4000, 5000];
                        for (let i = 0; i < replyRetries.length && !result.success; i++) {
                            console.warn(`📕 [XHS] 回复失败(detail后)(${i + 1}/${replyRetries.length})，${replyRetries[i] / 1000}秒后重试:`, result.message);
                            await new Promise(r => setTimeout(r, replyRetries[i]));
                            result = await xhsReplyComment(xhsConf, noteId, xsecToken || '', replyContent, commentId, commentUserId, parentCommentId);
                        }
                    }
                    if (result.success) {
                        addToast(`📕 ${char.name}回复了一条评论`, 'success');
                    } else {
                        console.warn(`📕 [XHS] 回复失败(detail后)，降级为 @提及 评论:`, result.message);
                        const fallbackContent = commentAuthorName
                            ? `@${commentAuthorName} ${replyContent}`
                            : replyContent;
                        let fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken || '');
                        if (!fallback.success) {
                            console.warn(`📕 [XHS] 顶级评论也失败(detail后)，3秒后重试:`, fallback.message);
                            await new Promise(r => setTimeout(r, 3000));
                            fallback = await xhsComment(xhsConf, noteId, fallbackContent, xsecToken);
                        }
                        if (fallback.success) {
                            addToast(`📕 ${char.name}评论了一条笔记（@提及回复）`, 'success');
                        } else {
                            addToast(`回复失败: ${result.message}`, 'error');
                        }
                    }
                } catch (e) { console.error('📕 [XHS] 回复异常(detail后):', e); }
                setXhsStatus('');
            } else {
                console.warn('📕 [XHS] 回复缺少 xsecToken 或内容(detail后)');
            }
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_REPLY:.*?\]\]/g, '').trim();

    // [[XHS_LIKE]] (second round)
    const xhsLikeMatches2 = aiContent.matchAll(/\[\[XHS_LIKE:\s*(.+?)\]\]/g);
    for (const xhsLikeMatch of xhsLikeMatches2) {
        if (xhsConf.enabled) {
            const noteId = xhsLikeMatch[1].trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要点赞笔记(detail后):`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
            try {
                const result = await xhsLike(xhsConf, noteId, xsecToken || '');
                if (result.success) {
                    addToast(`📕 ${char.name}点赞了一条笔记`, 'success');
                } else {
                    console.warn('📕 [XHS] 点赞失败(detail后):', result.message);
                }
            } catch (e) { console.error('📕 [XHS] 点赞异常(detail后):', e); }
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_LIKE:.*?\]\]/g, '').trim();

    // [[XHS_FAV]] (second round)
    const xhsFavMatches2 = aiContent.matchAll(/\[\[XHS_FAV:\s*(.+?)\]\]/g);
    for (const xhsFavMatch of xhsFavMatches2) {
        if (xhsConf.enabled) {
            const noteId = xhsFavMatch[1].trim();
            const xsecToken = findXsecToken(noteId, lastXhsNotes);
            console.log(`📕 [XHS] AI要收藏笔记(detail后):`, noteId, xsecToken ? '(有xsecToken)' : '(bridge自动获取)');
            try {
                const result = await xhsFavorite(xhsConf, noteId, xsecToken || '');
                if (result.success) {
                    addToast(`📕 ${char.name}收藏了一条笔记`, 'success');
                } else {
                    console.warn('📕 [XHS] 收藏失败(detail后):', result.message);
                }
            } catch (e) { console.error('📕 [XHS] 收藏异常(detail后):', e); }
        }
    }
    aiContent = aiContent.replace(/\[\[XHS_FAV:.*?\]\]/g, '').trim();

    // [[XHS_POST]] (second round - after MY_PROFILE)
    const xhsPostMatch2 = aiContent.match(/\[\[XHS_POST:\s*(.+?)\]\]/s);
    if (xhsPostMatch2 && xhsConf.enabled) {
        const postRaw = xhsPostMatch2[1].trim();
        const parts = postRaw.split('|').map(p => p.trim());
        const postTitle = parts[0] || '';
        const postContent = parts[1] || '';
        const postTags = (parts[2] || '').match(/#(\S+)/g)?.map(t => t.replace('#', '')) || [];
        console.log(`📕 [XHS] AI要发小红书(profile后):`, postTitle);
        setXhsStatus(`正在发布小红书: ${postTitle}...`);
        try {
            const result = await xhsPublish(xhsConf, postTitle, postContent, postTags);
            if (result.success) {
                console.log('📕 [XHS] 发布成功(profile后):', result.noteId);
                const tagsStr = postTags.length > 0 ? ` #${postTags.join(' #')}` : '';
                await DB.saveMessage({
                    charId: char.id,
                    role: 'system',
                    type: 'text',
                    content: `📕 ${char.name}发了一条小红书「${postTitle}」\n${postContent.slice(0, 200)}${postContent.length > 200 ? '...' : ''}${tagsStr}`
                });
                addToast(`📕 ${char.name}发了一条小红书!`, 'success');
            } else {
                console.error('📕 [XHS] 发布失败(profile后):', result.message);
                addToast(`小红书发布失败: ${result.message}`, 'error');
            }
        } catch (e) {
            console.error('📕 [XHS] 发布异常(profile后):', e);
        }
        setXhsStatus('');
    }
    aiContent = aiContent.replace(/\[\[XHS_POST:.*?\]\]/gs, '').trim();

    // ─── Step 3: ChatParser.parseAndExecuteActions ───
    aiContent = await ChatParser.parseAndExecuteActions(aiContent, char.id, char.name, addToast, musicHooks);

    // ─── Step 4: thinking chain 抽取 ───
    let pendingThinkingChain: string | null = null;
    if ((char as any).showThinkingChain) {
        const lastRaw = data?.choices?.[0]?.message?.content || '';
        const lastReasoning = (data?.choices?.[0]?.message?.reasoning_content || '').trim();
        const thinkBlocks: string[] = [];
        const thinkPat = /<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi;
        let tm: RegExpExecArray | null;
        while ((tm = thinkPat.exec(lastRaw)) !== null) {
            const t = tm[2].trim();
            if (t) thinkBlocks.push(t);
        }
        if (!/<\/(?:think|thinking|thought)>/i.test(lastRaw)) {
            const openOnly = lastRaw.match(/<(?:think|thinking|thought)>([\s\S]*$)/i);
            if (openOnly && openOnly[1].trim()) thinkBlocks.push(openOnly[1].trim());
        }
        const chain = [lastReasoning, ...thinkBlocks].filter(s => !!s).join('\n\n').trim();
        if (chain) pendingThinkingChain = chain;
    }
    const mergeAssistantMeta = (base: any): any => {
        if (!pendingThinkingChain) return base;
        const merged = { ...(base || {}), thinkingChain: pendingThinkingChain };
        pendingThinkingChain = null;
        return merged;
    };

    // ─── Step 5: HTML 卡片 ───
    if ((char as any).htmlModeEnabled && /\[html\]/i.test(aiContent)) {
        const { blocks, cleanedContent } = extractHtmlBlocks(aiContent);
        for (const blk of blocks) {
            try {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'html_card',
                    content: blk.textPreview ? `[HTML卡片] ${blk.textPreview}` : '[HTML卡片]',
                    metadata: mergeAssistantMeta({
                        htmlSource: blk.html,
                        htmlTextPreview: blk.textPreview,
                        ...(mcdInheritMeta || {}),
                    }),
                } as any);
                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                console.error('[HTML] 落库 html_card 失败', e);
            }
        }
        aiContent = cleanedContent;
    }

    // ─── Step 7 (前置 Quote): Handle Quote/Reply Logic ───
    const QUOTE_RE_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:]\s*([\s\S]*?)\]\]/;
    const QUOTE_RE_SINGLE = /\[(?:QU[OA]TE|引用)[：:]\s*([^\]]*)\]/;
    const REPLY_RE_CN = /\[回复\s*[""“]([^""”]*?)[""”](?:\.{0,3})\]\s*[：:]?\s*/;
    const QUOTE_CLEAN_DOUBLE = /\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g;
    const QUOTE_CLEAN_SINGLE = /\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g;
    const REPLY_CLEAN_CN = /\[回复\s*[""“][^""”]*?[""”](?:\.{0,3})\]\s*[：:]?\s*/g;
    let aiReplyTarget: { id: number, content: string, name: string } | undefined;
    const firstQuoteMatch = aiContent.match(QUOTE_RE_DOUBLE) || aiContent.match(QUOTE_RE_SINGLE) || aiContent.match(REPLY_RE_CN);
    if (firstQuoteMatch) {
        const quotedText = firstQuoteMatch[1].trim();
        if (quotedText) {
            const targetMsg = contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                || (quotedText.length > 10 ? contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
            if (targetMsg) {
                const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                aiReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
            }
        }
    }

    // ─── Step 6: sanitize + Step 7: INNER_STATE 兜底 ───
    aiContent = ChatParser.sanitize(aiContent, { keepCitations: true });
    aiContent = aiContent.replace(/\[\[INNER_STATE:\s*[\s\S]*?\]\]/g, '').trim();

    // 空内容兜底
    if (!aiContent.trim() && (searchMatch || readDiaryMatch || fsReadDiaryMatch)) {
        aiContent = '嗯...';
    }

    if (aiContent) {
        const hasTranslationTags = /<翻译>\s*<原文>[\s\S]*?<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/.test(aiContent);

        let globalMsgIndex = 0;

        if (hasTranslationTags) {
            // ─── Step 8: 双语 ───
            const bilingualEmojis: string[] = [];
            let bEm;
            const bEmojiPat = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
            while ((bEm = bEmojiPat.exec(aiContent)) !== null) {
                const name = bEm[1].trim();
                if (!bilingualEmojis.includes(name)) bilingualEmojis.push(name);
            }
            aiContent = aiContent.replace(/\[\[SEND_EMOJI:\s*.*?\]\]/g, '').trim();
            const tagPattern = /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>([\s\S]*?)<\/译文>\s*<\/翻译>/g;
            let lastIndex = 0;
            let tagMatch;

            while ((tagMatch = tagPattern.exec(aiContent)) !== null) {
                const textBefore = aiContent.slice(lastIndex, tagMatch.index).trim();
                if (textBefore) {
                    const cleaned = ChatParser.sanitize(textBefore);
                    if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                        const chunks = ChatParser.chunkText(cleaned);
                        for (const chunk of chunks) {
                            if (!chunk) continue;
                            const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                            await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                            await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                            setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                            globalMsgIndex++;
                        }
                    }
                }

                const originalText = ChatParser.sanitize(tagMatch[1].trim());
                const translatedText = ChatParser.sanitize(tagMatch[2].trim());
                if (originalText || translatedText) {
                    const biContent = originalText && translatedText
                        ? `${originalText}\n%%BILINGUAL%%\n${translatedText}`
                        : (originalText || translatedText);
                    const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                    await new Promise(r => setTimeout(r, Math.min(Math.max(biContent.length * 30, 400), 2000)));
                    await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: biContent, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                    globalMsgIndex++;
                }

                lastIndex = tagMatch.index + tagMatch[0].length;
            }

            const textAfter = aiContent.slice(lastIndex).trim();
            if (textAfter) {
                const cleaned = ChatParser.sanitize(textAfter.replace(/<\/?翻译>|<\/?原文>|<\/?译文>/g, '').trim());
                if (cleaned && ChatParser.hasDisplayContent(cleaned)) {
                    const chunks = ChatParser.chunkText(cleaned);
                    for (const chunk of chunks) {
                        if (!chunk) continue;
                        const replyData = globalMsgIndex === 0 ? aiReplyTarget : undefined;
                        await new Promise(r => setTimeout(r, Math.min(Math.max(chunk.length * 50, 500), 2000)));
                        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: chunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                        globalMsgIndex++;
                    }
                }
            }

            for (const emojiName of bilingualEmojis) {
                const foundEmoji = emojis.find(e => e.name === emojiName);
                if (foundEmoji) {
                    await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                    await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                    setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                }
            }
        } else {
            // ─── Step 9-13: normal path (splitResponse → chunkText → per-chunk save) ───
            const parts = ChatParser.splitResponse(aiContent);
            for (let partIndex = 0; partIndex < parts.length; partIndex++) {
                const part = parts[partIndex];

                if (part.type === 'emoji') {
                    const foundEmoji = emojis.find(e => e.name === part.content);
                    if (foundEmoji) {
                        await new Promise(r => setTimeout(r, Math.random() * 500 + 300));
                        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'emoji', content: foundEmoji.url, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                    }
                } else {
                    const rawBlocks = part.content.split(/^\s*---\s*$/m).filter(b => b.trim());
                    const allChunks: string[] = [];
                    for (const block of rawBlocks) {
                        allChunks.push(...ChatParser.chunkText(block.trim()));
                    }
                    if (allChunks.length === 0 && part.content.trim()) allChunks.push(part.content.trim());

                    for (let i = 0; i < allChunks.length; i++) {
                        let chunk = allChunks[i];
                        const delay = Math.min(Math.max(chunk.length * 50, 500), 2000);
                        await new Promise(r => setTimeout(r, delay));

                        let chunkReplyTarget: { id: number, content: string, name: string } | undefined;
                        const chunkQuoteMatch = chunk.match(QUOTE_RE_DOUBLE) || chunk.match(QUOTE_RE_SINGLE) || chunk.match(REPLY_RE_CN);
                        if (chunkQuoteMatch) {
                            const quotedText = chunkQuoteMatch[1].trim();
                            if (quotedText) {
                                const targetMsg = contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText))
                                    || (quotedText.length > 10 ? contextMsgs.slice().reverse().find((m: Message) => m.role === 'user' && m.content.includes(quotedText.slice(0, 10))) : undefined);
                                if (targetMsg) {
                                    const truncated = targetMsg.content.length > 10 ? targetMsg.content.slice(0, 10) + '...' : targetMsg.content;
                                    chunkReplyTarget = { id: targetMsg.id, content: truncated, name: userProfile.name };
                                }
                            }
                            chunk = chunk.replace(QUOTE_CLEAN_DOUBLE, '').replace(QUOTE_CLEAN_SINGLE, '').replace(REPLY_CLEAN_CN, '').trim();
                        }

                        const replyData = chunkReplyTarget;

                        if (ChatParser.hasDisplayContent(chunk)) {
                            const cleanChunk = ChatParser.sanitize(chunk);
                            if (cleanChunk) {
                                await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: cleanChunk, replyTo: replyData, metadata: mergeAssistantMeta(mcdInheritMeta) } as any);
                                setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
                                globalMsgIndex++;
                            }
                        }
                    }
                }
            }
        }
    } else {
        setMessages(await DB.getRecentMessagesByCharId(char.id, 200));
    }
}
