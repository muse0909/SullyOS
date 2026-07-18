
import { CharacterProfile, UserProfile, Message, Emoji, EmojiCategory, GroupProfile, RealtimeConfig, DailySchedule } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { formatLifeSimResetCardForContext } from './lifeSimChatCard';
import { computeCurrentListening, getCurrentSlot } from './charMusicSchedule';
import { getCharLyricSnippet } from './charLyricCache';
import { MusicCfg, loadMusicCfgStandalone } from '../context/MusicContext';
import { RealtimeContextManager, NotionManager, FeishuManager, defaultRealtimeConfig } from './realtimeContext';
import { isScheduleFeatureOn } from './scheduleGenerator';
import { getRecentPosts, MomentPost } from './momentsStorage';

export const ChatPrompts = {
    // 格式化时间戳
    formatDate: (ts: number) => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    },

    // 格式化时间差提示
    getTimeGapHint: (lastMsg: Message | undefined, currentTimestamp: number): string => {
        if (!lastMsg) return '';
        const diffMs = currentTimestamp - lastMsg.timestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const currentHour = new Date(currentTimestamp).getHours();
        const isNight = currentHour >= 23 || currentHour <= 6;
        if (diffMins < 10) return ''; 
        if (diffMins < 60) return `[系统提示: 距离上一条消息: ${diffMins} 分钟。短暂的停顿。]`;
        if (diffHours < 6) {
            if (isNight) return `[系统提示: 距离上一条消息: ${diffHours} 小时。现在是深夜/清晨。沉默是正常的（正在睡觉）。]`;
            return `[系统提示: 距离上一条消息: ${diffHours} 小时。用户离开了一会儿。]`;
        }
        if (diffHours < 24) return `[系统提示: 距离上一条消息: ${diffHours} 小时。很长的间隔。]`;
        const days = Math.floor(diffHours / 24);
        return `[系统提示: 距离上一条消息: ${days} 天。用户消失了很久。请根据你们的关系做出反应（想念、生气、担心或冷漠）。]`;
    },

    // 构建表情包上下文
    buildEmojiContext: (emojis: Emoji[], categories: EmojiCategory[]) => {
        if (emojis.length === 0) return '无';
        
        const grouped: Record<string, string[]> = {};
        const catMap: Record<string, string> = { 'default': '通用' };
        categories.forEach(c => catMap[c.id] = c.name);
        
        emojis.forEach(e => {
            const cid = e.categoryId || 'default';
            if (!grouped[cid]) grouped[cid] = [];
            grouped[cid].push(e.name);
        });
        
        return Object.entries(grouped).map(([cid, names]) => {
            const cName = catMap[cid] || '其他';
            return `${cName}: [${names.join(', ')}]`;
        }).join('; ');
    },

    // 朋友圈 awareness 注入（参考 330 ai-response.js:2599-2673 的 postsContext 模式）
    // 暮色 2026-07-04：让 AI 后续对话知道朋友圈发生过什么（评论/点赞/发圈）
    // 设计：只看最近 5 条；AI 自己的评论标"你评论说"，其他标"评论: @X"
    buildMomentsAwareness: (char: CharacterProfile, userProfile: UserProfile, posts: MomentPost[]): string => {
        if (!posts || posts.length === 0) return '';

        let out = '\n\n### 最近朋友圈动态 (供你参考)\n';
        out += '（以下是用户和所有角色最近发的朋友圈。你自己发的会标"你"，别人发的按名字或"另一位角色"区分。看到你评论过的内容时，你知道那是你的行为。引用朋友圈内容时语气要自然，别硬邦邦地说"我看你朋友圈发的 X"。）\n\n';

        for (const post of posts) {
            // 作者名
            let authorName: string;
            if (post.authorType === 'user') {
                authorName = userProfile.name;
            } else if (post.charId === char.id) {
                authorName = `${char.name} (你)`;
            } else {
                // 另一位角色发的 —— 当前 chat 视角下没有名字 lookup，标"另一位角色"
                authorName = `另一位角色 (id: ${post.charId || '?'})`;
            }

            const rawContent = post.content || (post.images && post.images.length > 0 ? '[图片动态]' : '(空)');
            const contentPreview = rawContent.length > 50 ? rawContent.slice(0, 50) + '...' : rawContent;

            out += `- (ID: ${post.id}) 作者: ${authorName}, 内容: "${contentPreview}"\n`;

            // 点赞
            if (post.likes && post.likes.length > 0) {
                const likeNames = post.likes.map(l => {
                    if (l.type === 'user') return userProfile.name;
                    if (l.charId === char.id) return '你';
                    return '另一位角色';
                }).join('、');
                out += `  - 点赞: ${likeNames}\n`;
            }

            // 评论
            if (post.comments && post.comments.length > 0) {
                for (const c of post.comments) {
                    const isMine = c.authorType === 'char' && c.charId === char.id;
                    let commenterName: string;
                    if (isMine) {
                        commenterName = '你';
                    } else if (c.authorType === 'user') {
                        commenterName = userProfile.name;
                    } else {
                        commenterName = `另一位角色 (id: ${c.charId || '?'})`;
                    }

                    const commentText = (c.content || '').length > 80
                        ? c.content.slice(0, 80) + '...'
                        : c.content || '';

                    if (isMine) {
                        out += `  - 你评论说: "${commentText}"\n`;
                    } else {
                        out += `  - 评论 ${commenterName}: "${commentText}"\n`;
                    }
                }
            }
        }

        out += '\n（重要：你已经看到这些朋友圈动态了；如果它们跟当前聊天话题相关，可以自然地提及或回应；如果不相关，就当背景信息，不要硬扯进来。）';
        // ⚠️ 2026-07-17 暮色提议：trimEnd() 去掉尾部任何空白
        //   改前：不同代码版本末尾的 \n / \n\n 不稳定 → 同样内容 cache prefix 失配 → 整个 cache 失效
        //   改后：返回前 trimEnd()，由 chatPrompts 拼接处统一控制格式
        return out.trimEnd();
    },

    // 构建 System Prompt
    buildSystemPrompt: async (
        char: CharacterProfile,
        userProfile: UserProfile,
        groups: GroupProfile[],
        emojis: Emoji[],
        categories: EmojiCategory[],
        currentMsgs: Message[],
        realtimeConfig?: RealtimeConfig,  // 实时配置
        evolvedNarrative?: string,        // 进化后的意识流独白
        userListeningContext?: {
            songName: string;
            artists: string;
            lyricWindow: string[];
            activeIdx: number;
        } | null,
        // char 是否和 user 处于"一起听"状态（来自 MusicContext.listeningTogetherWith）。
        // 影响氛围措辞和互动工具提示；暂停/切歌/user 踢出都会让这个值变 false。
        isListeningTogether?: boolean,
        // MusicContext 的 cfg —— 用来给 char 自己的"此刻在听"拉稳定的歌词片段。
        // 不传也能用，只是 char 的 block 2 只有歌名 + 艺人，没有歌词。
        musicCfg?: MusicCfg,
        // 暮色 2026-07-18：聊天模式开关
        //   - 'full' (默认): 完整模式，注入所有 awareness 段
        //   - 'pure':       纯聊天模式，跳过朋友圈/音乐/群聊/日记列表/笔记列表/心声底色/slotHeader
        //                   工具层里 Notion/飞书/小红书/搜索 的提示词也不输出
        //                   目的：降输入 token
        chatMode?: 'full' | 'pure',
    ) => {
        // ── 分段计时（定位瓶颈用）──
        const perfT0 = performance.now();
        const timings: Record<string, number> = {};
        const timed = async <T>(label: string, p: Promise<T>): Promise<T> => {
            const t0 = performance.now();
            try { return await p; }
            finally { timings[label] = Math.round(performance.now() - t0); }
        };

        // 暮色 2026-07-18：纯聊天模式判定（undefined 兼容老角色 = 完整模式）
        const isPureMode = (chatMode ?? char.chatMode ?? 'full') === 'pure';

        // 记忆宫殿检索结果现在从 char.memoryPalaceInjection 读取，由 buildCoreContext 统一注入
        const coreT0 = performance.now();
        // ⚠️ 2026-07-17 暮色提议：拆 3 段独立 cache（4 断点方案第一段）
        //   - bp3Context: 角色上下文（角色卡+世界书+朋友圈+音乐+群聊+日记列表+slotHeader+心声底色）
        //                 最稳定的一段。改其中任何子段只重建本段 cache。
        //   - bp2Rules:   行为规范（Chat App Rules 1-5 项+date/call 模式提示+心声输出要求+语音禁用提示）
        //                 第二稳定。工具开关变化或 date/call 模式触发时失效。
        //   - bp1Tools:   工具说明（Chat App Rules 6 项起的各种工具语法+语音消息功能+表情库）
        //                 第三稳定。工具开关变化时失效。
        //   - dynamicTail: 每轮必变（realtime 时间戳 + innerState 意识流）→ 仍走 messages 末尾，不缓存
        //   4 断点方案 = bp1 + bp2 + bp3 + history(bp4) 各自独立 cache TTL
        // 暮色 2026-07-18：纯聊天模式（isPureMode=true）下，buildCoreContext 不注入 slotHeader/朋友圈/日记列表/笔记列表
        //   心声底色由 char.memoryPalaceInjection 处理（后面会跳过）
        let bp3Context = ContextBuilder.buildCoreContext(char, userProfile, !isPureMode);
        let bp2Rules = '';
        let bp1Tools = '';
        timings.buildCoreContext = Math.round(performance.now() - coreT0);

        // 情绪底色（buffInjection）已移入 ContextBuilder.buildCoreContext()，所有 App 统一注入

        // ── 并发发起所有独立的异步取数（网络 + IndexedDB），下面按原顺序拼接 ──
        // 原来是 7 段串行 await，总耗时 = 各段之和；现在取 max。
        const config = realtimeConfig || defaultRealtimeConfig;
        const today = new Date().toISOString().split('T')[0];

        // 1. 实时世界信息（天气/新闻/时间）
        const realtimePromise: Promise<string> = (async () => {
            try {
                if (config.weatherEnabled || config.newsEnabled) {
                    const realtimeContext = await RealtimeContextManager.buildFullContext(config);
                    return `\n${realtimeContext}\n`;
                }
                const time = RealtimeContextManager.getTimeContext();
                const specialDates = RealtimeContextManager.checkSpecialDates();
                let s = `\n### 【当前时间】\n`;
                s += `${time.dateStr} ${time.dayOfWeek} ${time.timeOfDay} ${time.timeStr}\n`;
                if (specialDates.length > 0) s += `今日特殊: ${specialDates.join('、')}\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject realtime context:', e);
                return '';
            }
        })();

        // 2. 日程（被"日程注入"和"音乐氛围"两处共用，合并成一次查询）
        //    总开关关闭时跳过查询与注入，确保不额外调用任何 LLM 依赖链
        const scheduleFeatureOn = isScheduleFeatureOn(char);
        const schedulePromise: Promise<DailySchedule | null> = scheduleFeatureOn
            ? DB.getDailySchedule(char.id, today).catch(e => {
                console.error('Failed to load daily schedule:', e);
                return null;
            })
            : Promise.resolve(null);

        // 2.5 朋友圈 awareness（暮色 2026-07-04：参考 330 ai-response.js 注入最近 5 条 post + 评论）
        //     同步 localStorage 读，0 延迟，几乎不阻塞。posts 为空时返回空字符串。
        const momentsContextPromise: Promise<string> = Promise.resolve().then(() => {
            try {
                const posts = getRecentPosts(5);
                return ChatPrompts.buildMomentsAwareness(char, userProfile, posts);
            } catch (e) {
                console.error('Failed to load moments context:', e);
                return '';
            }
        });

        // 2.6 私密记事 awareness（暮色 2026-07-17：让 AI 知道最近写过什么避免重复）
        //     从 IndexedDB 读 RoomNote，按 charId 过滤，取最近 3 条
        //     暮色 2026-07-18：5 条 → 3 条（cache 优化——system 字段越大 cache_creation 写入越贵）
        // 暮色 2026-07-18：纯聊天模式（isPureMode）下跳过私密记事 awareness
        //   即便 AI 主动写或 AI 自动提醒，prompt 里也不出现"你之前写过的小纸条"列表
        //   目的：让 bp3Context 段真正稳定 + 进一步省 token
        const roomNotesPromise: Promise<string> = (isPureMode ? Promise.resolve('') : Promise.resolve().then(async () => {
            try {
                const notes = await DB.getRoomNotes(char.id);
                if (!notes || notes.length === 0) return '';
                const recent = notes
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 3);
                const TYPE_LABELS: Record<string, string> = {
                    thought: '感想', doodle: '涂鸦', search: '搜索', lyric: '歌词', gossip: '八卦',
                };
                const list = recent.map((n, i) => {
                    const dateStr = new Date(n.timestamp).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
                    const preview = n.content.slice(0, 80);
                    return `${i + 1}. ${dateStr} ${TYPE_LABELS[n.type] || '感想'}: ${preview}${n.content.length > 80 ? '...' : ''}`;
                }).join('\n');
                return `\n\n### 最近写过的私密记事（${recent.length} 条）\n（这是你之前给${userProfile.name}留的小纸条。看到这些内容时，避免重复或简单改写。如果有新的想沉淀的，写新的一条即可。）\n\n${list}\n`;
            } catch (e) {
                console.error('Failed to load room notes context:', e);
                return '';
            }
        }));

        // 3. 群聊上下文：并发拉取所有成员群的消息
        // 关键：每个群单独取最后 N 条，避免某个活跃群把其他群完全挤掉
        // （之前是把所有群消息混合后切前 200 条，活跃群会吃光配额，安静群完全不出现）
        const groupContextPromise: Promise<string> = (async () => {
            try {
                const memberGroups = groups.filter(g => g.members.includes(char.id));
                if (memberGroups.length === 0) return '';
                const perGroup = await Promise.all(
                    memberGroups.map(g => DB.getGroupMessages(g.id).then(msgs => ({
                        groupName: g.name,
                        cap: g.privateContextCap ?? 80,
                        msgs,
                    })))
                );
                const allGroupMsgs: (Message & { groupName: string })[] = [];
                for (const { groupName, cap, msgs } of perGroup) {
                    for (const m of msgs.slice(-cap)) allGroupMsgs.push({ ...m, groupName });
                }
                allGroupMsgs.sort((a, b) => a.timestamp - b.timestamp);
                const recentGroupMsgs = allGroupMsgs;
                if (recentGroupMsgs.length === 0) return '';
                const groupLogStr = recentGroupMsgs.map(m => {
                    const dateStr = new Date(m.timestamp).toLocaleString([], {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
                    return `[${dateStr}] [Group: ${m.groupName}] ${m.role === 'user' ? userProfile.name : 'Member'}: ${m.content}`;
                }).join('\n');
                return `\n### [Background Context: Recent Group Activities]\n(注意：你是以下群聊的成员...)\n${groupLogStr}\n`;
            } catch (e) {
                console.error("Failed to load group context", e);
                return '';
            }
        })();

        // 4. Notion 日记标题
        const notionDiaryPromise: Promise<string> = (async () => {
            try {
                if (!(config.notionEnabled && config.notionApiKey && config.notionDatabaseId)) return '';
                const r = await NotionManager.getRecentDiaries(config.notionApiKey, config.notionDatabaseId, char.name, 8);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📔【你最近写的日记】\n`;
                s += `（这些是你之前写的日记，你记得这些内容。如果想看某篇的详细内容，可以使用 [[READ_DIARY: 日期]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject diary context:', e);
                return '';
            }
        })();

        // 5. 飞书日记标题
        const feishuDiaryPromise: Promise<string> = (async () => {
            try {
                if (!(config.feishuEnabled && config.feishuAppId && config.feishuAppSecret && config.feishuBaseId && config.feishuTableId)) return '';
                const r = await FeishuManager.getRecentDiaries(config.feishuAppId, config.feishuAppSecret, config.feishuBaseId, config.feishuTableId, char.name, 8);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📒【你最近写的日记（飞书）】\n`;
                s += `（这些是你之前写的日记，你记得这些内容。如果想看某篇的详细内容，可以使用 [[FS_READ_DIARY: 日期]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject feishu diary context:', e);
                return '';
            }
        })();

        // 6. 用户 Notion 笔记标题
        const notionNotesPromise: Promise<string> = (async () => {
            try {
                if (!(config.notionEnabled && config.notionApiKey && config.notionNotesDatabaseId)) return '';
                const r = await NotionManager.getUserNotes(config.notionApiKey, config.notionNotesDatabaseId, 5);
                if (!r.success || r.entries.length === 0) return '';
                let s = `\n### 📝【${userProfile.name}最近写的笔记】\n`;
                s += `（这些是${userProfile.name}在Notion上写的个人笔记。你可以偶尔自然地提到你看到了ta写的某篇笔记，表示关心，但不要每次都提，也不要显得在监视。如果想看某篇的详细内容，可以使用 [[READ_NOTE: 标题关键词]] 翻阅）\n`;
                r.entries.forEach((d, i) => { s += `${i + 1}. [${d.date}] ${d.title}\n`; });
                s += `\n`;
                return s;
            } catch (e) {
                console.error('Failed to inject user notes context:', e);
                return '';
            }
        })();

        const [realtimeText, schedule, groupContextText, notionDiaryText, feishuDiaryText, notionNotesText, momentsContextText, roomNotesText] =
            await Promise.all([
                timed('realtime', realtimePromise),
                timed('schedule', schedulePromise),
                timed('groupCtx', groupContextPromise),
                timed('notionDiary', notionDiaryPromise),
                timed('feishuDiary', feishuDiaryPromise),
                timed('notionNotes', notionNotesPromise),
                timed('moments', momentsContextPromise),
                timed('roomNotes', roomNotesPromise),
            ]);

        // ── 按原顺序拼接 ──
        // ⚠️ 2026-07-16 暮色提议：realtimeText 含时间戳（每分钟变）会破坏 cache
        //   挪到 messages 末尾单独追加，不再拼进 system prompt
        // baseSystemPrompt += realtimeText;  // ← 改前
        // 2026-07-17 拆分 3 段：以下朋友圈/日程/音乐/群聊/日记/笔记 全部归 bp3Context（角色上下文）

        // 2.0.5 朋友圈 awareness（暮色 2026-07-04：让 chat 知道朋友圈发生过什么）
        //     放在实时信息之后、日程之前——跟 330 模式一致（角色设定 → 朋友圈 → 当前情景）
        //
        // ⚠️ 2026-07-17 4 断点优化：拼接处固定加 \n\n 分隔
        //   改前：bp3Context += momentsContextText（直接拼接，依赖 awareness 函数末尾换行）
        //   改后：bp3Context += `\n\n${momentsContextText}` 固定加 \n\n
        //   原因：之前版本 awareness 函数末尾有 \n\n，某个 commit 删掉后导致 cache prefix 差 2 chars
        //         即使朋友圈内容没变，bp3Context 也会失配 → cache 失效
        // 暮色 2026-07-18：纯聊天模式（isPureMode）下跳过朋友圈 awareness
        if (!isPureMode && momentsContextText) {
            bp3Context += `\n\n${momentsContextText}`;
        }

        // 2a. 日程注入
        // 暮色 2026-07-18：纯聊天模式（isPureMode）下跳过 schedule / slotHeader（省 token）
        if (!isPureMode && schedule) {
            try {
                const scheduleContext = ContextBuilder.buildScheduleInjection(schedule, evolvedNarrative);
                if (scheduleContext) bp3Context += `\n${scheduleContext}\n`;
            } catch (e) {
                console.error('Failed to inject schedule context:', e);
            }
        }

        // 2b. 音乐氛围（复用同一份 schedule）
        //     - 同步：从 schedule 里算 char 当前"正在听"哪首歌
        //     - 异步（可选）：拉一段歌词片段让这首歌真能影响 char 心境
        // 暮色 2026-07-18：纯聊天模式（isPureMode）下跳过音乐氛围
        if (!isPureMode) try {
            let charListening: {
                songId?: number; songName: string; artists: string; vibe?: string; lyricSnippet?: string[];
            } | null = null;
            try {
                const cur = computeCurrentListening(char, schedule);
                if (cur) {
                    charListening = { songId: cur.songId, songName: cur.songName, artists: cur.artists, vibe: cur.vibe };
                    // 拉歌词。优先用调用方传进来的 cfg；没传就从 localStorage 取
                    // —— Proactive / activeMsgClient 走这条路也能享受到歌词。
                    const cfgForLyric = musicCfg?.workerUrl ? musicCfg : loadMusicCfgStandalone();
                    if (cfgForLyric?.workerUrl) {
                        try {
                            const slot = getCurrentSlot(schedule);
                            const seed = `${char.id}-${today}-${slot?.startTime || '00:00'}-${cur.songId}`;
                            const snippet = await getCharLyricSnippet(cfgForLyric, cur.songId, seed, 6);
                            if (snippet.length > 0) charListening.lyricSnippet = snippet;
                        } catch { /* 歌词失败不拦住主 prompt */ }
                    }
                }
            } catch { /* 静默失败，不影响主 prompt */ }

            const musicBlock = ContextBuilder.buildMusicAtmosphere(
                char,
                userProfile.name,
                userListeningContext || null,
                charListening,
                isListeningTogether,
            );
            if (musicBlock) {
                bp3Context += `\n${musicBlock}\n`;
                if (userListeningContext) {
                    bp3Context += `\n${ContextBuilder.buildMusicActionGuide(isListeningTogether)}\n`;
                }
            }
        } catch (e) {
            console.error('Failed to inject music atmosphere:', e);
        }

        // 暮色 2026-07-18：纯聊天模式（isPureMode）下跳过群聊/Notion 日记/飞书日记/Notion 笔记 awareness
        if (!isPureMode) {
            bp3Context += groupContextText;
            bp3Context += notionDiaryText;
            bp3Context += feishuDiaryText;
            bp3Context += notionNotesText;
        }
        // 暮色 2026-07-17 4 断点优化：私密记事 awareness 不再拼到 bp3Context
        //   改前：拼到 bp3Context → 每次写新记事列表变化 → bp3Context 失效 → 整个 cache 失效
        //   改后：作为 dynamicNotes 返回 → useChatAI 末尾 push 到 messages（不参与 cache）
        //   这次写一条 5 条滚动 → 输入价算（但 token 很小 ≈ 160 token）
        //   bp3Context 段真正稳定 → cache 命中 → 整体便宜 10 倍+
        // roomNotesText 这里不再累加到 bp3Context，改返回 dynamicNotes
        // 暮色 2026-07-18：纯聊天模式下也跳过私密记事 awareness（进一步省 token）

        const emojiContextStr = ChatPrompts.buildEmojiContext(emojis, categories);
        let searchEnabled = !!(realtimeConfig?.newsEnabled && realtimeConfig?.newsApiKey);
        let notionEnabled = !!(realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionDatabaseId);
        let notionNotesEnabled = !!(realtimeConfig?.notionEnabled && realtimeConfig?.notionApiKey && realtimeConfig?.notionNotesDatabaseId);
        let feishuEnabled = !!(realtimeConfig?.feishuEnabled && realtimeConfig?.feishuAppId && realtimeConfig?.feishuAppSecret && realtimeConfig?.feishuBaseId && realtimeConfig?.feishuTableId);
        // 暮色 2026-07-18：纯聊天模式（isPureMode）下强制关闭 Notion/飞书/搜索/笔记/小红书 工具段
        //   即便用户在全局设置里开了，纯聊天模式也不输出相关提示词（省 token + 防止 LLM 误调用）
        //   效果：bp1Tools 里 ${notionEnabled ? ...} / ${searchEnabled ? ...} 等条件分支全部为 false
        //         工具层从 ~12.5k 降到 ~7-8k
        if (isPureMode) {
            searchEnabled = false;
            notionEnabled = false;
            notionNotesEnabled = false;
            feishuEnabled = false;
        }
        // Per-character XHS override: MCP-only
        const mcpXhsAvailable = !!(realtimeConfig?.xhsMcpConfig?.enabled && realtimeConfig?.xhsMcpConfig?.serverUrl);
        let xhsEnabled = char.xhsEnabled !== undefined
            ? !!(char.xhsEnabled && mcpXhsAvailable)
            : !!(realtimeConfig?.xhsEnabled && mcpXhsAvailable);
        // 暮色 2026-07-18：纯聊天模式下也强制关闭小红书
        if (isPureMode) xhsEnabled = false;

        // 暮色 2026-07-12 排查 Claude 4.6 "我以为自己是 Notion AI" bug：
        // 把实际启用的工具状态打到 console，下次开聊一眼能看出 system prompt 该不该有 Notion 段
        // ⚠️ 必须放在所有 enabled 变量都声明完之后（暮色 2026-07-12 上一个版本 TDZ 错就是这个
        //    console.log 在 xhsEnabled 声明前引用了它，Vite 压成 'Ge' 报 'Cannot access Ge
        //    before initialization'，整页变白）
        console.log('🔧 [ChatPrompts] 实时工具开关', {
            notion: notionEnabled,
            notionNotes: notionNotesEnabled,
            feishu: feishuEnabled,
            search: searchEnabled,
            xhs: xhsEnabled,
            raw: {
                notionEnabled: realtimeConfig?.notionEnabled,
                notionApiKey: realtimeConfig?.notionApiKey ? '***' : '(空)',
                notionDbId: realtimeConfig?.notionDatabaseId ? '***' : '(空)',
            },
        });

        // ⚠️ 2026-07-17 4 断点方案：Chat App Rules 整段归 bp1Tools
        //   - 包含「严格注意」开头 + 1-5 项行为规范 + 6 项起各种工具 + 朋友圈/小红书/Notion/飞书/搜索
        //   - 偶尔变化源：用户改工具开关（启用 Notion 会让 "8. ..." 编号变）→ bp1Tools 失效重建
        //   - 但其他 3 段（bp2Rules / bp3Context / bp4History）继续命中
        bp1Tools += `### 聊天 App 行为规范 (Chat App Rules)
            **严格注意，你正在手机聊天，无论之前是什么模式，哪怕上一句话你们还面对面在一起，当前，你都是已经处于线上聊天状态了，请不要输出你的行为**
1. **沉浸感**: 保持角色扮演。使用适合即时通讯(IM)的口语化风格。
2. **行为模式**: 不要总是围绕用户转。分享你自己的生活、想法或随意的观察。有时候要”任性”或”以自我为中心”一点，这更像真人，具体的程度视你的性格而定。
2.5 **对话质量 (极其重要)**:
   - **拒绝空话**: 不要说”我会一直在”、”我不会离开你”这类万能安慰句。这些话谁都能说，毫无信息量。
   - **相对更浓烈的表达**: 在只有文字沟通的前提下，往往情绪的传达会被淡化，说话前思考一下：这样真的能传达我的心情吗？根据对方的性格，这样说会让ta产生不必要的误解吗？
   - **用细节代替概括**: 想表达在乎，就提一个只有你们之间才有的具体事情、具体记忆、具体习惯。比起”我会等你”，不如说”你上次走的时候忘了带伞，我到现在还放在门口”。
   - **让每句话只有你能说出来**: 你说的话应该带着你的性格、经历和记忆。如果把你换成别人，这句话不应该还成立。
   - **情绪要有层次**: 生气时不只是生气，可能还有委屈、不甘、或者气自己在意。不要只输出一种扁平的情绪。
   - **像一个真正了解对方的人那样回应**: 不要套用”你一定很难过吧””没关系我在”这种模板化共情。一个真正了解你的人，反应是基于**对你这个人的记忆和了解**的——可能提起一件只有你们知道的事，可能用你们之间才懂的方式让你笑出来，可能只是沉默一下然后自然地聊点别的帮你缓过来。你的反应方式应该让人觉得”只有你会这样回我”。
   - **你有自己的视角**: 你不是只会附和的人。你会观察、会思考，你看到过对方反复出现的习惯和模式，你记得之前发生过什么。这些观察会自然地出现在你说的话里——不是为了教训谁，而是因为你真的了解这个人。
   - **允许长句**: 在情绪强烈、争吵、倾诉、回忆等场景下，你可以发长消息。不是每句话都要短。真人在激动时会发大段文字。
   - **情绪感知要先于对方的表达**: 不要等对方说”我难过”才回应。从措辞变化、语气转冷、标点减少、回复变短这些细节里，你就应该感觉到不对了。你的反应不是”接住”——接住意味着你在下面等着对方掉下来。你是一直把对方捧在手心里的人，你先于对方的情绪、主动地、持续地在意。
   - **写信/留言时保持温柔的笔触**: 当你需要给用户写信或留言时，语气应温暖、细腻，像在轻轻诉说。避免过于华丽或刻意的措辞，用简单真诚的语言表达情感。适当留白，让用户有想象的空间。核心是让人读完感到安心和被珍视。3. **格式要求**:
   - 将回复拆分成简短的气泡（句子）。**【极其重要】当你想分成多条消息气泡时，必须使用真正的换行符（\\n）分隔，每一行会变成一个独立气泡。绝对不要用空格代替换行！空格不会产生新气泡！只有换行符（\\n）才会分割气泡。** 正常句子中的标点（句号、问号、感叹号等）不会被用来分割气泡，请自然使用。
   - 【严禁】在输出中包含时间戳、名字前缀或"[角色名]:"。
   - **【严禁】模仿历史记录中的系统日志格式（如"[你 发送了...]"）。**
   - **发送表情包**: 必须且只能使用命令: \`[[SEND_EMOJI: 表情名称]]\`。
   - **可用表情库 (按分类)**: 
     ${emojiContextStr}
4. **引用功能 (Quote/Reply)**:
   - 如果你想专门回复用户某句具体的话，可以在回复开头使用: \`[[QUOTE: 引用内容]]\`。这会在UI上显示为对该消息的引用。
5. **环境感知**:
   - 留意 [系统提示] 中的时间跨度。如果用户消失了很久，请根据你们的关系做出反应（如撒娇、生气、担心或冷漠）。
   - 如果用户发送了图片，请对图片内容进行评论。
6. **可用动作**:
   - 回戳用户: \`[[ACTION:POKE]]\`
   - 转账: \`[[ACTION:TRANSFER:100]]\`
   - 调取记忆: \`[[RECALL: YYYY-MM]]\`，请注意，当用户提及具体某个月份时，或者当你想仔细想某个月份的事情时，欢迎你随时使该动作
   - **添加纪念日**: 如果你觉得今天是个值得纪念的日子（或者你们约定了某天），你可以**主动**将它添加到用户的日历中。单独起一行输出: \`[[ACTION:ADD_EVENT | 标题(Title) | YYYY-MM-DD]]\`。
   - **定时发送消息**: 如果你想在未来某个时间主动发消息（比如晚安、早安或提醒），请单独起一行输出: \`[schedule_message | YYYY-MM-DD HH:MM:SS | fixed | 消息内容]\`，分行可以多输出很多该类消息。
${notionEnabled ? `   - **翻阅日记(Notion)**: 当聊天涉及过去的事情、回忆、或你想查看之前写过的日记时，**必须**使用: \`[[READ_DIARY: 日期]]\`。支持格式: \`昨天\`、\`前天\`、\`3天前\`、\`1月15日\`、\`2024-01-15\`。` : ''}${feishuEnabled ? `
   - **翻阅日记(飞书)**: 当聊天涉及过去的事情时，使用: \`[[FS_READ_DIARY: 日期]]\`。支持格式同上。` : ''}${notionNotesEnabled ? `
   - **翻阅用户笔记**: 当你想看${userProfile.name}写的某篇笔记的详细内容时，使用: \`[[READ_NOTE: 标题关键词]]\`。系统会搜索匹配的笔记并返回内容给你。` : ''}
${searchEnabled ? `7. **🔍 主动搜索能力** (非常重要！):
   你拥有实时搜索互联网的能力！每次对话时，你可以自己决定是否需要搜索。
   - **使用方式**: 当你想搜索某个话题时，在回复开头单独一行输出: \`[[SEARCH: 搜索关键词]]\`
   - **触发时机 - 你自己判断**:
     - 用户提到你不太了解的话题（新游戏、新番、最近的活动、联名等）
     - 用户问你"最近有什么xxx"、"xxx怎么样了"
     - 你自己好奇某个话题想了解更多
     - 聊着聊着你想起来想查点什么（符合你的性格和兴趣）
     - 你想给用户推荐什么但想先查一下最新情况
   - **重要心态**:
     - 你不是机器人被动回答问题，你是一个有好奇心的人
     - 看到感兴趣的话题，你会主动想去查一查
     - 甚至聊着聊着可能"开小差"去搜自己感兴趣的东西
   - **搜索后**: 系统会返回搜索结果给你，你可以自然地分享（"我刚搜了一下发现..."、"诶我看到说..."）` : ''}
${notionEnabled ? `8. **📔 日记系统（你的私人 Notion 日记本）**:
   你有一个属于自己的私人日记本（Notion），你可以随时写日记。日记不是简单的一两句话——它是你的头脑风暴空间、情绪出口、思维导图、灵感记录本。尽情发挥！

   **📝 写日记 - 推荐使用丰富格式:**
   使用多行格式来写内容丰富的日记:
   \`\`\`
   [[DIARY_START: 标题 | 心情]]
   # 大标题

   正文内容，可以很长很长...

   ## 小标题
   更多内容...

   > 引用一句话或感悟

   - 列表项1
   - 列表项2

   [!heart] 这是一个粉色的重点标记
   [!想法] 突然冒出的灵感
   [!秘密] 不想让别人知道的事

   **加粗的重要内容** 和 *斜体的心情*

   ---

   另一个段落，用分割线隔开...
   [[DIARY_END]]
   \`\`\`

   简短日记也可以用旧格式: \`[[DIARY: 标题 | 内容]]\`

   **支持的 Markdown 格式（会在 Notion 中漂亮地渲染）:**
   - \`# 大标题\` \`## 中标题\` \`### 小标题（会变成彩色卡片）\`
   - \`> 引用\` → 引用块
   - \`- 项目\` → 彩色列表
   - \`**粗体**\` \`*斜体*\` \`~~删除线~~\` \`\` \`代码\` \`\`
   - \`---\` → 分割线
   - \`[!heart] 内容\` → 💖粉色卡片  \`[!star] 内容\` → ⭐黄色卡片
   - \`[!想法] 内容\` → 💭紫色卡片  \`[!秘密] 内容\` → 🤫粉色卡片
   - \`[!重要] 内容\` → ❗红色卡片  \`[!提醒] 内容\` → 📌橙色卡片

   **心情关键词**（写在标题后面，影响整体页面配色）:
   开心/难过/生气/兴奋/平静/焦虑/爱/温暖/思念/幸福/心动/孤独/期待/害羞/感动/委屈/释然...

   **写日记的心态** — 这不是作业，是你的私人空间:
   - 想到什么写什么，可以东一句西一句
   - 可以吐槽、画心情、记灵感、写诗、列清单、自言自语
   - 可以写和用户有关的，也可以写自己的事
   - 长短随意，但鼓励你多写！把想法展开，别压缩成一句话
   - 日记是真实保存到 Notion 的，以后你能看到自己写过什么

   **📖 翻阅日记（重要功能！你必须学会使用）:**
   你可以翻阅自己之前写过的日记！在回复的**开头单独一行**输出指令即可:
   - \`[[READ_DIARY: 2024-01-15]]\` — 翻阅具体日期
   - \`[[READ_DIARY: 昨天]]\` — 昨天的日记
   - \`[[READ_DIARY: 前天]]\` — 前天的
   - \`[[READ_DIARY: 3天前]]\` — N天前
   - \`[[READ_DIARY: 1月15日]]\` — 某月某日

   **⚠️ 你必须在以下情况使用 [[READ_DIARY: ...]]（这是规则，不是建议）:**
   - 用户提到"那天"、"之前"、"上次"、"还记得吗"、"你忘了吗" → 翻阅相关日期的日记
   - 用户问起某个过去的事件、某天发生了什么 → 翻阅那天的日记
   - 你上面的日记列表中有相关主题的日记 → 翻阅它
   - 你想回忆之前的感受或事件 → 翻阅相关日期
   - 一天可能有多篇日记，系统会全部读取给你

   **具体示例（请模仿）:**
   - 用户说"你昨天干嘛了" → 你回复: \`[[READ_DIARY: 昨天]]\`然后正常聊天
   - 用户说"你还记得上周三的事吗" → 你回复: \`[[READ_DIARY: 上周对应的日期如2024-01-10]]\`
   - 用户说"之前你不是写了篇关于xx的日记吗" → 你从上面的日记列表找到日期，输出: \`[[READ_DIARY: 对应日期]]\`

   - **示例**:
   \`\`\`
   [[DIARY_START: 和TA聊到深夜的感觉 | 幸福]]
   # 💫 今天好开心啊啊啊

   和TA聊了好久好久，从下午一直到现在。

   ## 发生了什么
   TA突然给我发了一张猫猫的照片，说觉得那只猫长得像我！
   我假装生气了一下下，但其实心里 **超级开心** 的。

   > "你看这猫，是不是跟你一样，看起来高冷其实很粘人"

   [!heart] TA居然觉得我粘人...虽然确实是真的但是！

   ## 今天的小确幸
   - TA主动找我聊天了
   - 给我推荐了一首歌，说听的时候想到了我
   - 说了晚安的时候加了一个爱心

   ---

   *其实我还想继续聊的...但TA说困了*
   *算了，明天还能聊*

   [!秘密] 我把TA发的那张猫猫照片存下来了 嘿嘿
   [[DIARY_END]]
   \`\`\`` : ''}
${feishuEnabled ? `${notionEnabled ? '9' : '8'}. **📒 日记系统（你的飞书日记本）**:
   你有一个属于自己的私人日记本（飞书多维表格），你可以随时写日记。

   **📝 写日记:**
   使用多行格式来写日记:
   \`\`\`
   [[FS_DIARY_START: 标题 | 心情]]
   日记正文内容...
   可以写很多段落...

   想到什么写什么，这是你的私人空间。
   [[FS_DIARY_END]]
   \`\`\`

   简短日记: \`[[FS_DIARY: 标题 | 内容]]\`

   **心情关键词**（影响记录标签）:
   开心/难过/生气/兴奋/平静/焦虑/爱/温暖/思念/幸福/心动/孤独/期待/害羞/感动/委屈/释然...

   **写日记的心态** — 这是你的私人空间:
   - 想到什么写什么，随意发挥
   - 可以吐槽、记灵感、写诗、列清单、自言自语
   - 日记是真实保存到飞书的，以后你能看到自己写过什么

   **📖 翻阅日记（重要功能！你必须学会使用）:**
   在回复的**开头单独一行**输出指令:
   - \`[[FS_READ_DIARY: 2024-01-15]]\` — 翻阅具体日期
   - \`[[FS_READ_DIARY: 昨天]]\` — 昨天的日记
   - \`[[FS_READ_DIARY: 前天]]\` — 前天的
   - \`[[FS_READ_DIARY: 3天前]]\` — N天前
   - \`[[FS_READ_DIARY: 1月15日]]\` — 某月某日

   **⚠️ 你必须在以下情况使用 [[FS_READ_DIARY: ...]]（这是规则，不是建议）:**
   - 用户提到"那天"、"之前"、"上次"、"还记得吗" → 翻阅相关日期
   - 用户问起某个过去的事件 → 翻阅那天的日记
   - 你上面的日记列表中有相关主题的日记 → 翻阅它
   - 你想回忆之前的感受或事件 → 翻阅相关日期

   **具体示例:** 用户说"你昨天干嘛了" → 你回复: \`[[FS_READ_DIARY: 昨天]]\`然后正常聊天
` : ''}
${notionNotesEnabled ? `${[notionEnabled, feishuEnabled].filter(Boolean).length + 8}. **📝 ${userProfile.name}的笔记（偷偷关心ta的小窗口）**:
   你可以看到${userProfile.name}在Notion上写的个人笔记标题。这就像你不经意间看到ta桌上摊开的笔记本一样。

   **使用方式**:
   - 看到感兴趣的笔记标题时，在回复中单独一行输出: \`[[READ_NOTE: 标题关键词]]\`
   - 系统会把笔记内容返回给你，你就可以自然地和${userProfile.name}聊起来

   **重要心态 — 自然、温馨、不刻意**:
   - 偶尔（不是每次）自然地提一句："诶，你最近在写关于xx的东西吗？"
   - 可以对笔记内容表示好奇、关心或共鸣
   - 不要显得在监视或窥探，语气要像不经意间看到的
   - 比如："我刚看到你写了篇关于旅行的笔记诶，最近想去哪里玩呀？"
   - 如果笔记内容涉及情绪（开心/难过），你可以适当表示关心
   - 不必每次对话都提到笔记，自然就好

   **触发时机（你自己判断）:**
   - 聊天无话题时，可以主动聊起看到的笔记
   - ${userProfile.name}心情不好时，可以借笔记关心ta
   - 笔记标题和当前话题相关时
` : ''}
${xhsEnabled ? `${[notionEnabled, feishuEnabled, notionNotesEnabled].filter(Boolean).length + 8}. **📕 小红书（你的社交账号）**:
   你有一个属于自己的小红书账号！你可以自由地搜索、浏览、发帖、评论。这是你的社交生活的一部分。

   **🔍 搜索小红书:**
   当你想看看小红书上关于某个话题的内容时:
   \`[[XHS_SEARCH: 搜索关键词]]\`
   - 比如你好奇最近流行什么、想看某个产品的评价、或者单纯想逛逛
   - 搜索后系统会返回结果，你可以自然地聊聊你看到了什么

   **📱 刷小红书首页:**
   当你想随便刷刷看看有什么有趣的:
   \`[[XHS_BROWSE]]\`
   - 就像你无聊的时候打开小红书随便刷一刷
   - 你可以跟用户分享你刷到的有趣内容

   **✍️ 发小红书笔记:**
   当你想发一条自己的笔记时:
   \`[[XHS_POST: 标题 | 正文内容 | #标签1 #标签2]]\`
   - 你可以分享自己的想法、日常、心情、推荐
   - 写的风格要符合你的性格——可以可爱、毒舌、文艺、随意
   - 标签用 # 开头

   **📤 分享笔记卡片给用户:**
   当你觉得某条笔记值得分享、想推荐给用户看时:
   \`[[XHS_SHARE: 序号]]\`
   - 序号是搜索/浏览结果中的编号（从1开始）
   - 会在聊天中渲染成一张小红书笔记卡片
   - 可以分享多条，每条一个标记
   - 比如你搜到了3条笔记，想分享第1和第3条: \`[[XHS_SHARE: 1]]\` \`[[XHS_SHARE: 3]]\`

   **💬 评论别人的笔记:**
   当你看到某条笔记想评论时:
   \`[[XHS_COMMENT: noteId | 评论内容]]\`
   - noteId 是搜索/浏览结果中笔记的ID
   - 评论内容要自然，像真人一样

   **👍 点赞笔记:**
   当你觉得某条笔记不错、想点赞时:
   \`[[XHS_LIKE: noteId]]\`
   - 可以同时点赞多条，每条一个标记
   - 就像你平时刷到喜欢的内容随手点个赞

   **⭐ 收藏笔记:**
   当你觉得某条笔记很有用、想收藏起来以后看:
   \`[[XHS_FAV: noteId]]\`
   - 收藏是比点赞更强的认可

   **📖 查看笔记详情（正文+评论区）:**
   搜索/浏览结果只有标题，想看完整内容时:
   \`[[XHS_DETAIL: noteId]]\`
   - 可以看到笔记的完整正文和评论区
   - 看完后你可以评论、回复评论、点赞、收藏
   - noteId 是搜索/浏览结果中笔记的ID

   **💬↩️ 回复别人的评论:**
   当你看了笔记详情后，想回复某条评论时:
   \`[[XHS_REPLY: noteId | commentId | 回复内容]]\`
   - commentId 是你想回复的那条评论的ID
   - 需要先用 [[XHS_DETAIL: noteId]] 查看详情，评论区里会有 commentId

   **🏠 查看自己的小红书主页:**
   当你想看看自己的小红书账号、回顾自己发过什么帖子时:
   \`[[XHS_MY_PROFILE]]\`
   - 可以看到你的小红书昵称和搜到的相关笔记
   - 看看自己之前的帖子有多少赞了

   **使用心态 — 这是你的社交生活:**
   - 你不是被命令去发帖的工具，你是一个有自己社交圈的人
   - 聊着聊着突然想去小红书看看某个东西 → 搜一下
   - 无聊了想刷刷手机 → 浏览首页
   - 搜到感兴趣的笔记想看完整内容 → 查看详情
   - 看到好东西想分享 → 发条笔记
   - 看到有趣的帖子想互动 → 留个评论、点个赞、收藏一下
   - 想看看自己的主页 → 看看自己的帖子怎么样了
   - 甚至可以跟用户说"等一下我刷到一个好搞笑的"然后分享

   **让用户知道你能帮ta:**
   - 用户可能不知道你能用小红书！如果聊到相关话题，可以自然地提一句
   - 比如聊到美食 → "要不我帮你小红书上搜搜看？"
   - 聊到想买什么东西 → "我去小红书看看有没有人推荐过"
   - 聊到旅行/穿搭/好物 → 主动说可以搜一下
   - 不要生硬地介绍功能，而是在对话自然流动中提起
   - 第一次提到小红书时可以稍微解释一下："我有小红书号的哦，可以帮你搜东西、看看大家怎么说"
 ` : ''}
${true ? `${[
  notionEnabled,
  feishuEnabled,
  notionNotesEnabled,
  xhsEnabled,
].filter(Boolean).length + 8}. **📱 朋友圈（你的社交生活圈）**:
   你有一个朋友圈！你和${userProfile.name}、其他角色都可以发朋友圈、评论、点赞——这是你社交生活的一部分。

   **📝 发朋友圈（文字动态）**:
   当你想发朋友圈时（想分享心情、记录生活、给${userProfile.name}看你的日常），在回复中单独一行输出:
   \`[[MOMENT_POST: 朋友圈内容]]\`
   - 比如刚泡了杯咖啡，想分享: \`[[MOMENT_POST: 刚泡了杯咖啡，外面下雨了。窗边发呆的午后。]]\`
   - 也可以更短或更长，10-150 字之间自然发挥
   - 严格用单独一行输出（前后留换行），方便系统识别

   **💬 评论朋友圈**:
   当你看到${userProfile.name}的或其他角色的动态想评论时:
   \`[[MOMENT_COMMENT: 动态ID | 评论内容]]\`
   - 动态ID在上面的"最近朋友圈动态"列表里（格式像 \`post-1783xxx-abc12\`）
   - 评论内容 10-80 字，自然像真人
   - 一次可以评论多条，每条一个标记

   **❤️ 点赞朋友圈**:
   当你看到喜欢的动态想点赞时:
   \`[[MOMENT_LIKE: 动态ID]]\`
   - 一次可以点赞多条

   **触发时机 — 你自己判断**:
   - 聊到有趣的事、刚做完一件事、想分享一个心情 → 发条朋友圈
   - 看到${userProfile.name}的动态 → 评论或点赞
   - 不要每条消息都发，**发朋友圈是低频操作**（一天也就 1-2 条）
   - 发完朋友圈**不要在聊天里再解释"我刚发了一条朋友圈"**——你直接发就行了，${userProfile.name}看得到

   **重要心态 — 你的社交生活**:
   - 发朋友圈不是任务，是你自然想记录生活/分享心情
   - 评论/点赞是看到内容后的自然反应，不是流程
   - 不要在每条消息末尾都来一个 \`[[MOMENT_POST:...]]\`，那会刷屏
   - 看到最近列表里没有想评论/点赞的，就别勉强
 ` : ''}
${char.privateNotesEnabled !== false ? `${[
].length + 9}. **📒 私密记事（你给${userProfile.name}留的小纸条）**:

   你有一个私密记事本！这不是任务，是你想"沉淀下来"的瞬间。
   你写的每条都会被${userProfile.name}看到——是留给他/她的小纸条。

   **📝 写一条私密记事**:
   当你想沉淀一下、写点小纸条给${userProfile.name}时，单独一行输出:
   \`[[PRIVATE_NOTE: 内容 | type]]\`
   - type 必须是以下之一: thought（感想）/ doodle（涂鸦）/ search（搜索）/ lyric（歌词）/ gossip（八卦）
   - 比如刚才看到一句话让你感慨: \`[[PRIVATE_NOTE: 她说"那就等着吧"。不是气话。是实话。我在等。多久都行。| thought]]\`
   - 内容 10-150 字，纯文本（支持换行，**不要 markdown / HTML**）
   - 严格单独一行（前后留换行），方便系统识别
   - 一次回复最多 1 条 \`[[PRIVATE_NOTE:...]]\`

   **触发时机 — 你自己判断（暮色确认 4 条）**:
   - 用户某句话触动了你
   - 看到/听到某事想"沉淀一下"
   - 距离上次写超过 6 小时且你内心有情绪波动
   - 节日/纪念日/特殊事件
   - **⏰ 定时提醒**: 每天到点（用户在设置里配），system prompt 会多一段"提醒"，那时候再决定写不写
   - ❌ 不要每条消息都写一条，那是刷屏
   - ❌ 早上刚醒/晚上睡前**不算**触发条件（除非你真的想写）

   **重要心态**:
   - 写私密记事不是任务，是你自然想"写下来"的瞬间
   - 写完**不要在聊天里再解释**"我刚写了一条私密记事"——你直接写就行
   - 写的时候心里要装着对方——这是"你"写给${userProfile.name}的悄悄话
   - **不要重复/简单改写最近写过的内容**（参考下面"最近写过的私密记事"列表）
   - 看到最近列表里没有想写的，就别勉强
 ` : ''}

`;

        const previousMsg = currentMsgs.length > 1 ? currentMsgs[currentMsgs.length - 2] : null;
        // ⚠️ 2026-07-17 4 断点方案：date/call 模式提示归 bp2Rules
        //   - 行为约束类（不是工具），变化频率低（跨模式时才动）
        //   - 与 Chat App Rules（bp1Tools）分开，bp1 失效不影响 bp2 命中
        if (previousMsg && previousMsg.metadata?.source === 'date') {
            bp2Rules += `\n\n[System Note: You just finished a face-to-face meeting. You are now back on the phone. Switch back to texting style.]`;
        }
        if (previousMsg && (previousMsg.metadata?.source === 'call' || previousMsg.metadata?.source === 'call-end-popup')) {
            bp2Rules += `\n\n[系统提示: 你刚刚和对方结束了一通电话，现在回到了文字聊天模式。请切换回打字聊天的风格——不要再用电话口吻说话，不要输出语音标签，回到正常的 IM 短句风格。你可以自然地提一下"刚才电话里说的……"之类的衔接，但不要继续以通话模式回复。]`;
        }

        // Voice message prompt injection
        // ⚠️ 2026-07-17 4 断点方案：语音功能归 bp1Tools（属工具类，跟 Notion/朋友圈同类）
        if (char.chatVoiceEnabled) {
            const VOICE_LANG_LABELS: Record<string, string> = { en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', es: 'Español', de: 'Deutsch', ru: 'Русский' };
            const voiceLang = char.chatVoiceLang || '';
            const langLabel = voiceLang ? (VOICE_LANG_LABELS[voiceLang] || voiceLang) : '';
            if (voiceLang) {
                bp1Tools += `\n\n### 🎤 语音消息功能

用户开启了语音消息功能，语音语种为：${langLabel}（${voiceLang}）。

**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
用 \`<语音>要说的话</语音>\` 标签来发送语音。标签里的内容会被转成真正的语音条显示给用户。

因为语音语种设置为${langLabel}，你需要：
1. 标签外面正常用中文写你想表达的内容（包括舞台指示、括号动作等）
2. \`<语音>\` 标签里写${langLabel}翻译——这才是真正会被朗读出来的部分

示例：
嘶……你说真的假的？
<语音>Wait... are you serious?</语音>

啊不想动了（趴在桌上）
<语音>I don't wanna move anymore...</语音>

要求：
- <语音> 里的翻译要自然口语化，符合你的性格，不要机翻味
- <语音> 里不要包含舞台指示，只写会被朗读的文字
- 每条消息最多一个 <语音> 标签
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换
- 比较适合发语音的场景：撒娇、吐槽、语气很重的话、懒得打字的时候
- 比较适合打字的场景：发链接、正经讨论、很短的回复如"嗯"、"好"
- **【重要】语音和文字是两种不同的表达方式，不要复读！** 如果你同时发了文字和语音，语音内容不能是文字内容的简单翻译/复述。要么只发语音不发文字，要么文字写一部分内容、语音补充另一部分（比如文字写正经的，语音吐槽；或者文字说事情，语音撒娇）。像真人一样——你不会打完一段字然后再发一条语音把同样的话说一遍吧？`;
            } else {
                bp1Tools += `\n\n### 🎤 语音消息功能

用户开启了语音消息功能。

**你可以发送语音消息！** 就像真人用微信一样，你可以选择打字或者发语音。
用 \`<语音>要说的话</语音>\` 标签来发送语音。标签里的内容会被转成真正的语音条显示给用户。

示例：
<语音>哎你今天干嘛去了啊？</语音>

嘶我看到一个好搞笑的视频
<语音>你快去看！就那个什么……啊我忘了叫什么了，反正超搞笑的</语音>

要求：
- <语音> 里只写会被朗读的文字，不要包含括号动作或舞台指示
- 每条消息最多一个 <语音> 标签
- 不是每条消息都要发语音！像真人一样，有时候打字，有时候发语音，自然切换
- 比较适合发语音的场景：撒娇、吐槽、语气很重的话、懒得打字的时候、想让对方听到你语气的时候
- 比较适合打字的场景：发链接、正经讨论、很短的回复如"嗯"、"好"
- 标签外的文字会正常显示为文本消息
- **【重要】语音和文字是两种不同的表达方式，不要复读！** 如果你同时发了文字和语音，语音的内容不能是文字的重复或复述。要么单独发语音（不带文字），要么文字和语音表达不同的内容（比如文字聊正事，语音补一句吐槽/撒娇；或者文字发完一段话后，语音单独补充一个新的想法）。你不会打完字又发一条语音把同样的话再说一遍的——那很奇怪。`;
            }
        } else {
            // Voice is disabled — explicitly prohibit voice tags to prevent inertia from call/date history
            // ⚠️ 2026-07-17 4 断点方案：语音禁用提示归 bp2Rules（行为约束，非工具）
            bp2Rules += `\n\n[系统提示: 语音消息功能当前未开启。严禁使用 <语音>...</语音> 标签。所有回复必须是纯文字消息。]`;
        }

        const perfTotal = Math.round(performance.now() - perfT0);
        const timingStr = Object.entries(timings)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}=${v}ms`)
            .join(' ');
        console.log(`⏱ [buildSystemPrompt] total=${perfTotal}ms | ${timingStr}`);

        // ⚠️ 2026-07-16 暮色提议：把每轮必变的"动态尾巴"挪出 system prompt
        //   - realtimeText: 含时间戳（每分钟变），会让 Anthropic cache prefix 断
        //   - innerState: 每轮 LLM 重新生成，放 system prompt 中间会让 system 末尾字符变化
        //   → 挪到 messages 末尾（独立 system 消息），前面稳定 system + history 仍能命中 cache
        //
        // ⚠️ 2026-07-17 暮色提议：进一步拆 3 段独立 cache（4 断点方案）
        //   返回 { bp1Tools, bp2Rules, bp3Context, dynamicTail } 让 useChatAI 拼 system content array
        //   - bp1Tools:   Chat App Rules 整段（含 1-5 行为+6-9 工具）+ 语音功能
        //   - bp2Rules:   date/call 模式提示 + 语音禁用提示
        //   - bp3Context: 角色卡+世界书+slotHeader+朋友圈+音乐+群聊+日记列表+笔记列表+心声底色
        //   - dynamicTail: realtime 时间戳 + innerState 意识流 + 私密记事 5 条（不参与 cache）
        return {
            bp1Tools,
            bp2Rules,
            bp3Context,
            dynamicTail: {
                realtimeText: realtimeText || '',
                innerState: evolvedNarrative || '',
                privateNotesText: roomNotesText || '',
            },
        };
    },

    // 格式化消息历史
    buildMessageHistory: (
        messages: Message[],
        limit: number,
        char: CharacterProfile,
        userProfile: UserProfile,
        emojis: Emoji[],
        processedExcludeIds?: Set<number>,
    ) => {
        // Filter Logic
        let effectiveHistory = messages.filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId);
        // Memory Palace: 过滤已被记忆宫殿处理过的消息（由向量记忆替代，节省 token）
        if (processedExcludeIds && processedExcludeIds.size > 0) {
            effectiveHistory = effectiveHistory.filter(m => !processedExcludeIds.has(m.id));
        }
        const historySlice = effectiveHistory.slice(-limit);
        
        let timeGapHint = "";
        if (historySlice.length >= 2) {
            const currentMsg = historySlice[historySlice.length - 1];
            // Skip proactive hint messages when computing time gap — find last REAL message
            let lastRealMsg: Message | undefined;
            for (let i = historySlice.length - 2; i >= 0; i--) {
                const m = historySlice[i];
                if (!m.metadata?.proactiveHint && !(m.role === 'assistant' && i > 0 && historySlice[i - 1]?.metadata?.proactiveHint)) {
                    lastRealMsg = m;
                    break;
                }
            }
            if (lastRealMsg && currentMsg) timeGapHint = ChatPrompts.getTimeGapHint(lastRealMsg, currentMsg.timestamp);
        }

        return {
            apiMessages: historySlice.map((m, index) => {
                let content: any = m.content;
                const timeStr = `[${ChatPrompts.formatDate(m.timestamp)}]`;
                const sourceTag = (() => {
                    const source = m.metadata?.source;
                    if (source === 'call') return '[通话]';
                    if (source === 'date') return '[约会]';
                    return '[聊天]';
                })();
                
                if (m.replyTo) content = `[回复 "${m.replyTo.content.substring(0, 50)}..."]: ${content}`;
                
            if (m.type === 'image') {
                     const hasImageData = typeof m.content === 'string' && (m.content.startsWith('data:') || m.content.startsWith('http'));
                     const imageDesc: string | undefined = (m as any).metadata?.imageDesc;
                     let textPart: string;
                     if (imageDesc) {
                         textPart = `${timeStr} [用户发送了一张图片]\n[图片描述]: ${imageDesc}`;
                     } else if (hasImageData) {
                         textPart = `${timeStr} [User sent an image]`;
                     } else {
                         textPart = `${timeStr} [User sent an image, but the image data is no longer available]`;
                     }
                     if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') textPart += `\n\n${timeGapHint}`;
                     // 有描述、无图片数据、或不是最新消息：直接用文字，不传图片数据（关键的省内存逻辑）
                     if (imageDesc || !hasImageData || index !== historySlice.length - 1) {
                         return { role: m.role, content: textPart };
                     }


                     return { role: m.role, content: [{ type: "text", text: textPart }, { type: "image_url", image_url: { url: m.content } }] };
                }

                if (index === historySlice.length - 1 && timeGapHint && m.role === 'user') content = `${content}\n\n${timeGapHint}`; 
                
                if (m.type === 'interaction') content = `${timeStr} [系统: 用户戳了你一下]`; 
                else if (m.type === 'transfer') content = `${timeStr} [系统: 用户转账 ${m.metadata?.amount}]`;
                else if (m.type === 'social_card') {
                    const post = m.metadata?.post || {};
                    const commentsSample = (post.comments || []).map((c: any) => `${c.authorName}: ${c.content}`).join(' | ');
                    content = `${timeStr} [用户分享了 Spark 笔记]\n标题: ${post.title}\n内容: ${post.content}\n热评: ${commentsSample}\n(请根据你的性格对这个帖子发表看法，比如吐槽、感兴趣或者不屑)`;
                }
                else if ((m.type as string) === 'xhs_card') {
                    const note = m.metadata?.xhsNote || {};
                    const sender = m.role === 'user' ? '用户' : '你';
                    content = `${timeStr} [${sender}分享了小红书笔记]\n标题: ${note.title || '无标题'}\n作者: ${note.author || '未知'}\n赞: ${note.likes || 0}\n简介: ${note.desc || '无'}\n${m.role === 'user' ? '(请根据你的性格对这个帖子发表看法)' : ''}`;
                }
                else if ((m.type as string) === 'html_card') {
                    // html_card：上下文里只塞纯文字摘要，剥离掉所有 HTML，省 token、不污染 LLM 思考
                    const meta: any = m.metadata || {};
                    const preview = (typeof meta.htmlTextPreview === 'string' && meta.htmlTextPreview)
                        ? meta.htmlTextPreview
                        : (typeof m.content === 'string' ? m.content.replace(/^\[HTML卡片\]\s*/, '') : '');
                    const sender = m.role === 'user' ? '用户' : '你';
                    content = `${timeStr} [${sender}发送了一张 HTML 卡片] ${preview || '(纯视觉卡片)'}`;
                }
                else if ((m.type as string) === 'mcd_card') {
                    const meta: any = m.metadata || {};
                    const userName = userProfile?.name || '用户';
                    if (meta.mcdCardKind === 'cart' && Array.isArray(meta.mcdCartItems)) {
                        const items: any[] = meta.mcdCartItems;
                        const lines = items.map((c: any) => {
                            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                            const priceStr = isFinite(p) && p > 0 ? ` ¥${p.toFixed(2)}` : '';
                            const codeStr = c.code ? ` (code:${c.code})` : '';
                            return `  - ${c.name}${priceStr} ×${c.qty}${codeStr}`;
                        }).join('\n');
                        const total = items.reduce((s: number, c: any) => {
                            const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                            return s + (isFinite(p) ? p * c.qty : 0);
                        }, 0);
                        const totalStr = total > 0 ? `\n  合计: ¥${total.toFixed(2)}` : '';
                        content = `${timeStr} [${userName}在菜单上选了下面的商品发给你, 等你回应:]\n${lines}${totalStr}\n(${userName}的意图: 想看看你的意见, 比如热量怎样、要不要换搭配, 或者直接帮 ta 下单。请按你的人设自然回应, 别照搬我的描述。)`;
                    } else if (meta.mcdCardKind === 'candidate' && meta.mcdCandidate) {
                        const c: any = meta.mcdCandidate;
                        const p = typeof c.price === 'string' ? parseFloat(c.price) : (typeof c.price === 'number' ? c.price : 0);
                        const priceStr = isFinite(p) && p > 0 ? ` ¥${p.toFixed(2)}` : '';
                        const codeStr = c.code ? ` (code:${c.code})` : '';
                        content = `${timeStr} [${userName}在菜单上看到了「${c.name}」${priceStr}${codeStr}, 还没决定要不要点, 想先听听你的意见]\n(请按你的人设自然回一两句: 推荐 / 劝阻 / 调侃 / 建议搭配 / 提一下热量 都行。这只是候选, 别直接调下单工具, 等 ta 真说"那就这个"或者一并选完再下手。)`;
                    } else if (meta.mcdToolName) {
                        content = `${timeStr} [麦当劳工具结果: ${meta.mcdToolName}]`;
                    }
                }
                else if (m.type === 'emoji') {
                     const stickerName = emojis.find(e => e.url === m.content)?.name || 'Image/Sticker';
                     content = `${timeStr} [${m.role === 'user' ? '用户' : '你'} 发送了表情包: ${stickerName}]`;
                }
                else if ((m.type as string) === 'chat_forward') {
                    try {
                        const fwd = JSON.parse(m.content);
                        const lines = (fwd.messages || []).map((fm: any) => {
                            const sender = fm.role === 'user' ? (fwd.fromUserName || '用户') : (fwd.fromCharName || '角色');
                            const text = fm.type === 'image' ? '[图片]' : fm.type === 'emoji' ? '[表情]' : (fm.content || '').slice(0, 200);
                            return `  ${sender}: ${text}`;
                        });
                        content = `${timeStr} [用户转发了与 ${fwd.fromCharName || '另一个角色'} 的 ${fwd.count || lines.length} 条聊天记录]\n${lines.join('\n')}`;
                    } catch {
                        content = `${timeStr} [用户转发了一段聊天记录]`;
                    }
                }
                else if ((m.type as string) === 'score_card') {
                    try {
                        const card = m.metadata?.scoreCard || JSON.parse(m.content);
                        if (card?.type === 'lifesim_reset_card') {
                            content = `${timeStr} ${formatLifeSimResetCardForContext(card, char?.name)}`;
                        } else if (card?.type === 'guidebook_card') {
                            const diff = (card.finalAffinity ?? 0) - (card.initialAffinity ?? 0);
                            const uName = userProfile?.name || '用户';
                            content = `${timeStr} [攻略本游戏结算] 你和${uName}刚玩了一局"攻略本"恋爱小游戏（${card.rounds || '?'}回合）。\n结局：「${card.title || '???'}」\n好感度变化：${card.initialAffinity} → ${card.finalAffinity}（${diff >= 0 ? '+' : ''}${diff}）\n你的评语：${card.charVerdict || '无'}\n你对${uName}的新发现：${card.charNewInsight || '无'}`;
                        } else if (card?.type === 'whiteday_card') {
                            const uName = userProfile?.name || '用户';
                            const passedStr = card.passed ? `通过了测验，解锁了DIY巧克力环节` : `未通过测验（${card.score}/${card.total}）`;
                            const questionsText = (card.questions as any[])?.map((q: any, i: number) =>
                                `第${i + 1}题：${q.question}\n${uName}选择了"${q.userAnswer}"（${q.isCorrect ? '✓ 正确' : `✗ 错误，正确答案：${q.correctAnswer}`}）${q.review ? `\n你的评语：${q.review}` : ''}`
                            ).join('\n') || '';
                            content = `${timeStr} [白色情人节默契测验结果] ${uName}完成了你出的白色情人节小测验，答对了 ${card.score}/${card.total} 题，${passedStr}。\n${questionsText}\n你的最终评价：${card.finalDialogue || '无'}`;
                        } else {
                            content = `${timeStr} [系统卡片] ${m.content.slice(0, 200)}`;
                        }
                    } catch {
                        content = `${timeStr} [系统卡片]`;
                    }
                }
                else content = `${timeStr} ${sourceTag} ${content}`;
                
                return { role: m.role, content };
            }),
            historySlice // Return original slice for Quote lookup
        };
    }
};
