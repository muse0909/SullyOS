/**
 * 「彼方」会话运行器 —— 一次自主登入的完整闭环。
 *
 * 触发某角色后：
 *   1. 在"有意义的已实装房间"里随机 roll 一个（图书馆永远可选；听歌房当角色
 *      有音乐人格、或房里正放着歌时可选）—— 每次只进一个房间、只做一件事，
 *      天然避免不同玩法的提示词互相打架。
 *   2. 取角色既有人设/向量记忆/最近 contextLimit 上下文（buildChatRequestPayload），
 *      叠加「彼方」世界观 + 该房间现场（user turn）。
 *   3. 调一次 LLM（per-char API 覆盖 → 回落全局）。
 *   4. 解析输出，做房间各自的副作用（图书馆：落批注/推书签；听歌房：点歌进队列/
 *      乐评/推进循环队列），更新 vrState。
 *   5. 向 1v1 聊天注入一条 vr_card，天然被上下文与记忆总结捕捉。
 *   6. fire-and-forget 触发记忆管线。
 */

import {
    CharacterProfile, UserProfile, GroupProfile, RealtimeConfig, APIConfig,
    VRWorldNovel, VRCardMeta, VRRoomId, VRMusicRoomState, CharPlaylistSong, CharMusicReview,
} from '../../types';
import { DB } from '../db';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { safeFetchJson } from '../safeApi';
import { processNewMessages } from '../memoryPalace/pipeline';
import { loadMusicCfgStandalone } from '../../context/MusicContext';
import { getCharLyricSnippet } from '../charLyricCache';
import { getRoom, VR_DEFAULT_INTERVAL_MIN } from './constants';
import { getReadingWindow, getBookmark, buildAnnotation } from './novel';
import {
    buildVRSystemAddendum, buildLibraryRoomTurn, parseVROutput,
    buildMusicRoomTurn, parseMusicOutput,
} from './prompts';

/** 记忆管线所需配置的最小形状（避免从 OSContext 反向 import 造成循环依赖）。 */
interface MemoryConfigLike {
    embedding?: { baseUrl?: string; apiKey?: string; model?: string; dimensions?: number };
    lightLLM?: { baseUrl?: string; apiKey?: string; model?: string };
}

export interface VRSessionDeps {
    char: CharacterProfile;
    /** 全部角色（算听歌房在场名单用） */
    characters: CharacterProfile[];
    apiConfig: APIConfig;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => Promise<void> | void;
}

export interface VRSessionResult {
    ok: boolean;
    room?: VRRoomId;
    reason?: string;
    activity?: string;
}

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const running = new Set<string>();

/** 选一本要读的书：优先续读未读完的，否则取最近更新的一本。 */
function pickNovel(novels: VRWorldNovel[], char: CharacterProfile): VRWorldNovel | null {
    if (novels.length === 0) return null;
    const bookmarks = char.vrState?.novelBookmarks;
    const unfinished = novels.filter(n => getBookmark(bookmarks, n.id) < n.segments.length);
    const pool = unfinished.length > 0 ? unfinished : novels;
    pool.sort((a, b) => {
        const aStarted = getBookmark(bookmarks, a.id) > 0 ? 1 : 0;
        const bStarted = getBookmark(bookmarks, b.id) > 0 ? 1 : 0;
        if (aStarted !== bStarted) return bStarted - aStarted;
        return b.updatedAt - a.updatedAt;
    });
    return pool[0];
}

/** 汇总角色可点的歌（歌单 + 最近在听，按 id 去重，最近优先，最多 20）。 */
function gatherCharSongs(char: CharacterProfile): CharPlaylistSong[] {
    const mp = char.musicProfile;
    if (!mp) return [];
    const map = new Map<number, CharPlaylistSong>();
    for (const pl of mp.playlists || []) for (const s of pl.songs || []) if (!map.has(s.id)) map.set(s.id, s);
    for (const r of mp.recentPlays || []) if (r.song && !map.has(r.song.id)) map.set(r.song.id, r.song);
    return Array.from(map.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 20);
}

/** roll 一个房间：图书馆需有书；听歌房需角色有歌单 或 房里正在放歌。 */
function rollRoom(char: CharacterProfile, novels: VRWorldNovel[], musicState: VRMusicRoomState | null): VRRoomId | null {
    const pool: VRRoomId[] = [];
    if (novels.length > 0) pool.push('library');
    if (gatherCharSongs(char).length > 0 || musicState?.nowPlaying) pool.push('music');
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

export async function runVRSession(deps: VRSessionDeps): Promise<VRSessionResult> {
    const { char, characters, apiConfig, userProfile, groups, realtimeConfig, memoryPalaceConfig, updateCharacter } = deps;

    if (running.has(char.id)) return { ok: false, reason: 'busy' };

    const vrApi = char.vrState?.api?.baseUrl ? char.vrState.api : apiConfig;
    if (!vrApi.baseUrl) return { ok: false, reason: 'no-api' };

    const novels = await DB.getVRNovels();
    const musicState = await DB.getVRMusicRoom();
    const roomId = rollRoom(char, novels, musicState);
    if (!roomId) return { ok: false, reason: 'no-content' };
    const room = getRoom(roomId);

    running.add(char.id);
    try {
        window.dispatchEvent(new CustomEvent('vr-session-start', {
            detail: { charId: char.id, charName: char.name, room: room.id },
        }));
    } catch { /* SSR */ }

    try {
        // 公共材料：人设 + 向量记忆 + 最近上下文
        const emojis = await DB.getEmojis();
        const categories = await DB.getEmojiCategories();
        const contextLimit = char.contextLimit || 500;
        const historyMsgs = await DB.getRecentMessagesByCharId(char.id, contextLimit);
        const payload = await buildChatRequestPayload({
            char, userProfile, groups, emojis, categories,
            historyMsgs, contextLimit, realtimeConfig,
        });
        const systemPrompt = payload.systemPrompt + buildVRSystemAddendum(room, char.name);

        // 房间现场（user turn）
        let roomTurn: string;
        // library 用
        let novel: VRWorldNovel | null = null;
        let win: ReturnType<typeof getReadingWindow> | null = null;
        let allAnn: Awaited<ReturnType<typeof DB.getVRAnnotations>> = [];
        // music 用
        let pickable: CharPlaylistSong[] = [];

        if (room.id === 'library') {
            novel = pickNovel(novels, char)!;
            const bm = getBookmark(char.vrState?.novelBookmarks, novel.id);
            win = getReadingWindow(novel, bm >= novel.segments.length ? 0 : bm);
            allAnn = await DB.getVRAnnotations(novel.id);
            const windowAnn = allAnn.filter(a => a.segIdx >= win!.from && a.segIdx < win!.to);
            roomTurn = buildLibraryRoomTurn(novel, win, windowAnn, char.id);
        } else {
            pickable = gatherCharSongs(char);
            const occupantNames = characters
                .filter(c => c.vrState?.enabled && c.vrState.currentRoom === 'music')
                .map(c => c.name);
            if (!occupantNames.includes(char.name)) occupantNames.push(char.name);
            // 按网易云 id 拉一段当前在放歌曲的歌词（双层缓存；拉不到则无损降级）
            let nowLyric: string[] = [];
            const np = musicState?.nowPlaying;
            if (np) {
                try {
                    nowLyric = await getCharLyricSnippet(loadMusicCfgStandalone(), np.song.id, `${char.id}-${np.song.id}`, 10);
                } catch { /* 歌词拉取失败不影响 */ }
            }
            roomTurn = buildMusicRoomTurn(musicState, occupantNames, pickable, char.name, nowLyric);
        }

        // 调 LLM
        const baseUrl = vrApi.baseUrl.replace(/\/+$/, '');
        const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vrApi.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: vrApi.model,
                messages: [{ role: 'system', content: systemPrompt }, ...payload.cleanedApiMessages, { role: 'user', content: roomTurn }],
                temperature: 0.9, stream: false,
            }),
        });
        let aiContent: string = data.choices?.[0]?.message?.content || '';
        aiContent = aiContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        const prevState = char.vrState || { enabled: true, intervalMinutes: VR_DEFAULT_INTERVAL_MIN };
        let activity = '';
        let cardLines: string[] = [];
        let meta: VRCardMeta;

        if (room.id === 'library') {
            // === 图书馆：落批注 + 推书签 ===
            const parsed = parseVROutput(aiContent);
            const label2id = new Map<string, string>();
            for (const a of allAnn) label2id.set(a.id.slice(-4), a.id);
            const savedExcerpts: string[] = [];
            let written = 0;
            for (const pa of parsed.annotations) {
                if (pa.segIdx < win!.from || pa.segIdx >= win!.to) continue;
                const targetId = pa.refLabel ? label2id.get(pa.refLabel) : undefined;
                const ann = buildAnnotation({ novelId: novel!.id, segIdx: pa.segIdx, authorId: char.id, authorName: char.name, content: pa.content, targetAnnotationId: targetId });
                await DB.saveVRAnnotation(ann);
                label2id.set(ann.id.slice(-4), ann.id);
                savedExcerpts.push(pa.content.length > 60 ? pa.content.slice(0, 60) + '…' : pa.content);
                written += 1;
            }
            const nextBookmark = win!.reachedEnd ? novel!.segments.length : win!.to;
            await updateCharacter(char.id, {
                vrState: { ...prevState, novelBookmarks: { ...(prevState.novelBookmarks || {}), [novel!.id]: nextBookmark }, currentRoom: 'library', lastActiveAt: Date.now() },
            });
            activity = parsed.activity || `读了《${novel!.title}》第 ${win!.from + 1}~${win!.to} 段${written ? `，留下了 ${written} 条批注` : '，安静读完没多说什么'}。`;
            cardLines = [`「${room.emoji} 彼方·${room.name}」`, `${char.name}${activity}`];
            if (savedExcerpts.length) { cardLines.push('批注：'); for (const ex of savedExcerpts) cardLines.push(`· ${ex}`); }
            meta = { vrCard: true, room: 'library', activity, novelId: novel!.id, novelTitle: novel!.title, segRange: [win!.from, win!.to], annotationExcerpts: savedExcerpts };
        } else {
            // === 听歌房：点歌进队列 + 乐评 + 推进循环队列 ===
            const parsed = parseMusicOutput(aiContent);
            const state: VRMusicRoomState = musicState || { id: 'state', queue: [], updatedAt: Date.now() };
            const curSong = state.nowPlaying;

            // 点歌进队列
            let queuedLabel: string | undefined;
            if (parsed.pickIdx !== undefined && pickable[parsed.pickIdx]) {
                const s = pickable[parsed.pickIdx];
                state.queue = [...(state.queue || []), { song: s, charId: char.id, charName: char.name }];
                queuedLabel = `${s.name} - ${s.artists}`;
            }
            // 推进：队列非空则把队首切为正在放（房间随每次到访"往前走"）
            if (state.queue.length > 0) {
                const next = state.queue.shift()!;
                state.nowPlaying = { song: next.song, charId: next.charId, charName: next.charName, since: Date.now() };
            }
            state.updatedAt = Date.now();
            await DB.saveVRMusicRoom(state);

            // 乐评落入角色音乐人格（continuity）
            if (parsed.review && curSong && char.musicProfile) {
                const review: CharMusicReview = {
                    id: genId('rev'), targetType: 'song', targetId: String(curSong.song.id),
                    targetTitle: `${curSong.song.name} - ${curSong.song.artists}`, content: parsed.review, createdAt: Date.now(),
                };
                const mp = char.musicProfile;
                await updateCharacter(char.id, { musicProfile: { ...mp, reviews: [...(mp.reviews || []), review].slice(-50), updatedAt: Date.now() } });
            }

            await updateCharacter(char.id, { vrState: { ...prevState, currentRoom: 'music', lastActiveAt: Date.now() } });

            const songLabel = curSong ? `${curSong.song.name} - ${curSong.song.artists}` : undefined;
            activity = parsed.activity || (curSong ? `在听歌房听着《${curSong.song.name}》晃了一会儿。` : `进了听歌房，戴上耳机放空。`);
            cardLines = [`「${room.emoji} 彼方·${room.name}」`, `${char.name}${activity}`];
            if (parsed.review && songLabel) cardLines.push(`评《${songLabel}》：${parsed.review}`);
            if (queuedLabel) cardLines.push(`点了《${queuedLabel}》排进队列`);
            if (parsed.behavior) cardLines.push(`· ${parsed.behavior}`);
            meta = { vrCard: true, room: 'music', activity, songLabel, queuedLabel, behavior: parsed.behavior };
        }

        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'vr_card', content: cardLines.join('\n'), metadata: meta });

        // 记忆管线（fire-and-forget）
        try {
            const mpEmb = memoryPalaceConfig?.embedding;
            const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
            const mpLLM = (mpLLMConfigured?.baseUrl) ? mpLLMConfigured : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
            if (char.memoryPalaceEnabled && mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl) {
                const recentMsgs = await DB.getRecentMessagesByCharId(char.id, 50);
                void processNewMessages(recentMsgs, char.id, char.name, mpEmb as any, mpLLM as any, userProfile?.name || '', false).catch(() => {});
            }
        } catch { /* 记忆失败不影响主流程 */ }

        try {
            window.dispatchEvent(new CustomEvent('vr-session-done', { detail: { charId: char.id, room: room.id, activity } }));
        } catch { /* SSR */ }

        return { ok: true, room: room.id, activity };
    } catch (err) {
        console.error('[VRWorld] session error:', err);
        return { ok: false, room: room.id, reason: 'error' };
    } finally {
        running.delete(char.id);
        try { window.dispatchEvent(new CustomEvent('vr-session-end', { detail: { charId: char.id } })); } catch { /* SSR */ }
    }
}
