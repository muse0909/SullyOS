import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useOS } from '../context/OSContext';
import {
    ArrowLeft, Plus, Trash, BookOpen, Planet, Clock, Play, CaretRight, X,
    UploadSimple, PencilSimple, FlipHorizontal, CaretLeft, Sparkle,
    CircleNotch, TextAa, Palette, Pause, MusicNotes, Queue,
} from '@phosphor-icons/react';
import { CreatorIframe, type ChibiResult } from '../components/Like520Event';
import { useMusic, type Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { VRScheduler } from '../utils/vrWorld/scheduler';
import { VR_ROOMS, getRoom, VR_DEFAULT_INTERVAL_MIN } from '../utils/vrWorld/constants';
import { buildNovelAsync, groupAnnotationsBySeg, getBookmark } from '../utils/vrWorld/novel';
import { decodeTextFile } from '../utils/vrWorld/decodeText';
import type { CharacterProfile, VRWorldNovel, VRNovelAnnotation, VRCardMeta, VRRoomId, VRMusicRoomState, CharPlaylistSong } from '../types';

// ============ chibi 形象解析（vrState.chibi → 立绘 → 头像） ============
interface ChibiDisplay { img: string; scale: number; offsetY: number; flip: boolean; isFallback: boolean; }
const getChibi = (char: CharacterProfile): ChibiDisplay => {
    const c = char.vrState?.chibi;
    if (c?.img) return { img: c.img, scale: c.scale ?? 1, offsetY: c.offsetY ?? 0, flip: !!c.flip, isFallback: false };
    const sprites = (char.activeSkinSetId && char.dateSkinSets?.find(s => s.id === char.activeSkinSetId)?.sprites)
        || char.sprites || {};
    const fb = sprites['happy'] || sprites['normal'] || sprites['smile'] || char.avatar || '';
    return { img: fb, scale: 1, offsetY: 0, flip: false, isFallback: true };
};

type Tab = 'world' | 'library' | 'settings';

interface FeedItem {
    msgId: number; charId: string; charName: string; avatar: string;
    timestamp: number; meta: VRCardMeta; content: string;
}

// 每个房间的 chibi 站位（百分比坐标，底对齐）
const ROOM_SLOTS: Record<VRRoomId, { x: number; y: number }[]> = {
    library:   [{ x: 24, y: 72 }, { x: 50, y: 78 }, { x: 74, y: 70 }, { x: 38, y: 64 }, { x: 62, y: 64 }],
    music:     [{ x: 30, y: 74 }, { x: 55, y: 78 }, { x: 72, y: 70 }, { x: 45, y: 66 }],
    guestbook: [{ x: 28, y: 76 }, { x: 52, y: 78 }, { x: 73, y: 74 }, { x: 40, y: 68 }],
    gym:       [{ x: 26, y: 74 }, { x: 50, y: 80 }, { x: 74, y: 74 }, { x: 38, y: 66 }, { x: 62, y: 66 }],
};

const IDLE_QUIPS: Record<VRRoomId, string[]> = {
    library: ['翻着书页…', '这本还挺好看', '嘘，安静', '又是看书的一天'],
    music: ['🎵～', '这首单曲循环', '戴上耳机', '调一下音量'],
    guestbook: ['写点什么呢', '路过留个名', '看看墙上的话', '嗯…'],
    gym: ['活动一下', '再来一组！', '伸个懒腰', '热身中'],
};

const VRWorldApp: React.FC = () => {
    const { closeApp, characters, updateCharacter, addToast } = useOS();
    const [tab, setTab] = useState<Tab>('world');
    const [novels, setNovels] = useState<VRWorldNovel[]>([]);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [enterRoom, setEnterRoom] = useState<VRRoomId | null>(null);
    const [readerNovel, setReaderNovel] = useState<VRWorldNovel | null>(null);
    const [showUpload, setShowUpload] = useState(false);
    const [chibiEditChar, setChibiEditChar] = useState<CharacterProfile | null>(null);
    // 启用流程：设定 chibi 后回调启用
    const [pendingEnable, setPendingEnable] = useState<string | null>(null);

    const loadNovels = useCallback(async () => setNovels(await DB.getVRNovels()), []);
    const loadFeed = useCallback(async () => {
        const items: FeedItem[] = [];
        for (const c of characters) {
            const msgs = await DB.getRecentMessagesByCharId(c.id, 40);
            for (const m of msgs) {
                if (m.type === 'vr_card' && m.metadata?.vrCard) {
                    items.push({ msgId: m.id, charId: c.id, charName: c.name, avatar: c.avatar, timestamp: m.timestamp, meta: m.metadata as VRCardMeta, content: m.content });
                }
            }
        }
        items.sort((a, b) => b.timestamp - a.timestamp);
        setFeed(items.slice(0, 50));
    }, [characters]);

    const reloadAll = useCallback(async () => {
        setLoading(true);
        await Promise.all([loadNovels(), loadFeed()]);
        setLoading(false);
    }, [loadNovels, loadFeed]);

    useEffect(() => { void reloadAll(); }, [reloadAll]);
    useEffect(() => {
        const handler = () => { void reloadAll(); };
        window.addEventListener('vr-session-done', handler);
        return () => window.removeEventListener('vr-session-done', handler);
    }, [reloadAll]);

    // 最近一条动态（按角色）
    const latestByChar = useMemo(() => {
        const map: Record<string, FeedItem> = {};
        for (const f of feed) if (!map[f.charId]) map[f.charId] = f;
        return map;
    }, [feed]);

    const occupantsByRoom = useMemo(() => {
        const map: Record<string, CharacterProfile[]> = {};
        for (const c of characters) {
            if (c.vrState?.enabled) {
                const room = c.vrState.currentRoom || 'library';
                (map[room] ||= []).push(c);
            }
        }
        return map;
    }, [characters]);

    const enabledCount = characters.filter(c => c.vrState?.enabled).length;

    // 启用某角色（带 chibi 设定门槛）
    const enableChar = (char: CharacterProfile) => {
        const interval = char.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
        updateCharacter(char.id, { vrState: { ...(char.vrState || {}), enabled: true, intervalMinutes: interval } });
        VRScheduler.start(char.id, interval);
    };
    const requestEnable = (char: CharacterProfile) => {
        // 没设过专属 chibi → 先要求设定形象
        if (!char.vrState?.chibi?.img) {
            setPendingEnable(char.id);
            setChibiEditChar(char);
        } else {
            enableChar(char);
        }
    };

    return (
        <div className="h-full w-full flex flex-col text-white relative overflow-hidden"
            style={{ background: 'radial-gradient(150% 110% at 50% -10%, #3a2e6e 0%, #211b46 45%, #0f0d22 100%)' }}>
            <VRStyleTag />
            {/* 漂浮星点 */}
            <div className="pointer-events-none absolute inset-0 opacity-60"
                style={{ backgroundImage: 'radial-gradient(1.5px 1.5px at 20% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1.5px 1.5px at 70% 20%, rgba(180,200,255,.5), transparent), radial-gradient(1.5px 1.5px at 85% 60%, rgba(255,220,255,.4), transparent), radial-gradient(1.5px 1.5px at 40% 75%, rgba(200,220,255,.4), transparent)' }} />

            {/* 顶栏 */}
            <div className="relative flex items-center gap-2 px-4 pt-3 pb-2 shrink-0 z-10">
                <button onClick={closeApp} className="p-1.5 -ml-1.5 rounded-full active:bg-white/10"><ArrowLeft size={22} weight="bold" /></button>
                <div className="flex items-center gap-1.5">
                    <Planet size={22} weight="fill" className="text-indigo-300 drop-shadow-[0_0_8px_rgba(150,150,255,0.8)]" />
                    <span className="text-xl font-black tracking-[0.15em]"
                        style={{ background: 'linear-gradient(90deg,#c9b8ff,#fff,#b8e0ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 0 6px rgba(170,160,255,.5))' }}>彼方</span>
                </div>
                <span className="ml-auto text-[11px] text-indigo-200/70 flex items-center gap-1">
                    <Sparkle size={11} weight="fill" className="text-amber-200" />{enabledCount > 0 ? `${enabledCount} 位已接入` : '尚无接入'}
                </span>
            </div>

            {/* Tab */}
            <div className="relative flex px-4 gap-1.5 shrink-0 z-10">
                {([['world', '世界'], ['library', '书库'], ['settings', '接入']] as [Tab, string][]).map(([t, label]) => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-4 py-1.5 rounded-full text-[13px] font-bold transition-all ${tab === t ? 'text-white shadow-[0_4px_14px_rgba(120,100,255,0.5)]' : 'text-indigo-200/60 active:bg-white/10'}`}
                        style={tab === t ? { background: 'linear-gradient(135deg,#8b7bf0,#b06ad6)' } : {}}>
                        {label}
                    </button>
                ))}
            </div>

            <div className="relative flex-1 overflow-y-auto px-4 py-3 z-10">
                {loading ? (
                    <div className="text-center text-indigo-300/60 text-sm py-10">载入彼方…</div>
                ) : tab === 'world' ? (
                    <WorldView occupantsByRoom={occupantsByRoom} feed={feed} novelCount={novels.length}
                        onEnterRoom={setEnterRoom} onGoLibrary={() => setTab('library')} />
                ) : tab === 'library' ? (
                    <LibraryView novels={novels} characters={characters} onOpen={setReaderNovel}
                        onAdd={() => setShowUpload(true)}
                        onDelete={async (id) => { await DB.deleteVRNovel(id); await loadNovels(); addToast?.('已删除', 'success'); }} />
                ) : (
                    <SettingsView characters={characters} updateCharacter={updateCharacter} addToast={addToast}
                        novelCount={novels.length} onReload={reloadAll}
                        onRequestEnable={requestEnable} onEditChibi={setChibiEditChar} />
                )}
            </div>

            {/* 进入房间场景 */}
            {enterRoom && (
                <RoomScene roomId={enterRoom} occupants={occupantsByRoom[enterRoom] || []}
                    latestByChar={latestByChar} onClose={() => setEnterRoom(null)} />
            )}
            {readerNovel && <ReaderModal novel={readerNovel} characters={characters} onClose={() => setReaderNovel(null)} />}
            {showUpload && (
                <UploadModal onClose={() => setShowUpload(false)}
                    onCommit={async (novel) => {
                        await DB.saveVRNovel(novel); await loadNovels(); setShowUpload(false);
                        addToast?.(`《${novel.title}》已上架（${novel.segments.length} 段）`, 'success');
                    }}
                    onError={(msg) => addToast?.(msg, 'error')} />
            )}
            {chibiEditChar && (
                <ChibiEditor char={chibiEditChar}
                    onClose={() => { setChibiEditChar(null); setPendingEnable(null); }}
                    onSave={(chibi) => {
                        updateCharacter(chibiEditChar.id, { vrState: { ...(chibiEditChar.vrState || { enabled: false, intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), chibi } });
                        const wasPending = pendingEnable === chibiEditChar.id;
                        const charSnap = chibiEditChar;
                        setChibiEditChar(null);
                        if (wasPending) {
                            setPendingEnable(null);
                            // 用最新 interval 启用
                            const interval = charSnap.vrState?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
                            updateCharacter(charSnap.id, { vrState: { ...(charSnap.vrState || {}), chibi, enabled: true, intervalMinutes: interval } });
                            VRScheduler.start(charSnap.id, interval);
                            addToast?.(`${charSnap.name} 已接入彼方`, 'success');
                        } else {
                            addToast?.('形象已更新', 'success');
                        }
                    }} />
            )}
        </div>
    );
};

// ============ 通用：CSS 房间场景背景 ============
const RoomBackground: React.FC<{ roomId: VRRoomId; className?: string }> = ({ roomId, className }) => {
    if (roomId === 'library') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#3a2a1c 0%,#2a1d12 60%,#1c130b 100%)' }}>
                {/* 暖光窗 */}
                <div className="absolute top-[8%] right-[10%] w-20 h-28 rounded-md" style={{ background: 'linear-gradient(180deg,rgba(255,224,150,.55),rgba(255,180,90,.2))', boxShadow: '0 0 50px 18px rgba(255,200,120,.35)' }} />
                {/* 书架 */}
                <div className="absolute left-0 right-0 top-[20%] bottom-[28%]" style={{
                    backgroundImage: 'repeating-linear-gradient(90deg, #6b4a2b 0 4px, #8a5a30 4px 7px, #5a3a22 7px 14px, #9a6a3a 14px 18px, #4a2f1c 18px 22px)',
                    opacity: 0.85,
                }} />
                {/* 隔板 */}
                {[28, 44, 60].map(t => <div key={t} className="absolute left-0 right-0 h-1.5" style={{ top: `${t}%`, background: 'linear-gradient(180deg,#3a2615,#1c120a)' }} />)}
                {/* 地板 */}
                <div className="absolute left-0 right-0 bottom-0 h-[28%]" style={{ background: 'linear-gradient(180deg,#46301c,#241608)' }} />
            </div>
        );
    }
    if (roomId === 'music') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#2a1140 0%,#16082a 70%,#0a0418 100%)' }}>
                <div className="absolute inset-x-0 top-[18%] flex items-end justify-center gap-1 h-[40%] px-6 opacity-70">
                    {Array.from({ length: 22 }).map((_, i) => (
                        <div key={i} className="flex-1 rounded-t" style={{ height: `${30 + (Math.sin(i * 1.7) + 1) * 35}%`, background: 'linear-gradient(180deg,#ff7bd5,#7b5bff)', animation: `vrwave 1.2s ${i * 0.05}s ease-in-out infinite alternate` }} />
                    ))}
                </div>
                <div className="absolute left-0 right-0 bottom-0 h-[26%]" style={{ background: 'linear-gradient(180deg,#1a0a30,#0a0418)' }} />
            </div>
        );
    }
    if (roomId === 'guestbook') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#103050 0%,#0a2038 70%,#06121f 100%)' }}>
                <div className="absolute left-0 right-0 top-[14%] bottom-[28%]" style={{ background: 'linear-gradient(180deg,rgba(120,200,255,.10),rgba(80,160,230,.04))', boxShadow: 'inset 0 0 60px rgba(120,200,255,.2)' }}>
                    {[[18, 22, -6], [44, 30, 5], [68, 20, -3], [30, 55, 4], [60, 60, -5], [80, 48, 6]].map(([l, t, r], i) => (
                        <div key={i} className="absolute w-10 h-10 rounded-sm shadow-lg text-[7px] p-1 text-stone-700"
                            style={{ left: `${l}%`, top: `${t}%`, transform: `rotate(${r}deg)`, background: ['#fff7a8', '#ffd6e7', '#c8f7d4', '#cfe3ff'][i % 4] }}>♡</div>
                    ))}
                </div>
                <div className="absolute left-0 right-0 bottom-0 h-[26%]" style={{ background: 'linear-gradient(180deg,#0c2236,#06121f)' }} />
            </div>
        );
    }
    // gym
    return (
        <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#0a3a30 0%,#08261f 65%,#041511 100%)' }}>
            <div className="absolute left-0 right-0 bottom-0 h-[45%]" style={{
                backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 38px, rgba(120,255,200,.18) 38px 40px), repeating-linear-gradient(0deg, transparent 0 38px, rgba(120,255,200,.12) 38px 40px)',
                transform: 'perspective(300px) rotateX(58deg)', transformOrigin: 'bottom',
            }} />
            <div className="absolute top-[14%] left-1/2 -translate-x-1/2 w-32 h-10 rounded-full" style={{ background: 'radial-gradient(ellipse,rgba(120,255,200,.3),transparent)' }} />
        </div>
    );
};

// ============ chibi 小人渲染 ============
const Chibi: React.FC<{ char: CharacterProfile; bubble?: string; onTap?: () => void; size?: number; dance?: boolean }> = ({ char, bubble, onTap, size = 96, dance }) => {
    const c = getChibi(char);
    return (
        <div className="absolute flex flex-col items-center" style={{ transform: 'translate(-50%, -100%)' }} onClick={onTap}>
            {bubble && (
                <div className="relative mb-1 max-w-[120px] px-2 py-1 rounded-xl bg-white/95 text-stone-700 text-[10px] leading-snug font-medium shadow-[0_3px_10px_rgba(0,0,0,.3)] text-center">
                    {bubble.length > 22 ? bubble.slice(0, 22) + '…' : bubble}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 rotate-45" />
                </div>
            )}
            <div className="relative" style={{ animation: `${dance ? 'vrdance 0.9s' : 'vrfloat 3.2s'} ease-in-out infinite`, animationDelay: `${(char.id.charCodeAt(0) % 10) * 0.15}s` }}>
                {c.img ? (
                    <img src={c.img} alt={char.name}
                        style={{ height: size * c.scale, transform: `scaleX(${c.flip ? -1 : 1}) translateY(${c.offsetY}px)`, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}
                        className="object-contain" />
                ) : (
                    <div className="rounded-full flex items-center justify-center font-bold text-white"
                        style={{ width: size * 0.55, height: size * 0.55, background: 'linear-gradient(135deg,#8b7bf0,#b06ad6)', fontSize: size * 0.22 }}>
                        {char.name.slice(0, 1)}
                    </div>
                )}
            </div>
            {/* 地面投影 */}
            <div className="rounded-[50%] -mt-1" style={{ width: size * 0.5, height: size * 0.12, background: 'radial-gradient(ellipse,rgba(0,0,0,.45),transparent)' }} />
            <div className="text-[9px] text-white/90 font-bold mt-0.5 px-1.5 rounded-full bg-black/30 backdrop-blur-sm whitespace-nowrap">{char.name}</div>
        </div>
    );
};

// ============ 世界视图 ============
const WorldView: React.FC<{
    occupantsByRoom: Record<string, CharacterProfile[]>;
    feed: FeedItem[]; novelCount: number;
    onEnterRoom: (r: VRRoomId) => void; onGoLibrary: () => void;
}> = ({ occupantsByRoom, feed, novelCount, onEnterRoom, onGoLibrary }) => (
    <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
            {VR_ROOMS.map(room => {
                const occupants = occupantsByRoom[room.id] || [];
                return (
                    <button key={room.id} onClick={() => room.implemented && onEnterRoom(room.id)}
                        className={`relative rounded-2xl h-36 overflow-hidden border text-left active:scale-[0.98] transition-transform ${room.implemented ? 'border-white/20' : 'border-white/8 opacity-70'}`}
                        style={{ boxShadow: '0 6px 20px rgba(0,0,0,.35)' }}>
                        <RoomBackground roomId={room.id} />
                        {/* 顶部渐隐 + 标题 */}
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(0,0,0,.35),transparent 40%,transparent 70%,rgba(0,0,0,.55))' }} />
                        <div className="absolute top-2 left-2.5 flex items-center gap-1">
                            <span className="text-base drop-shadow">{room.emoji}</span>
                            <span className="text-[12px] font-black drop-shadow">{room.name}</span>
                            {!room.implemented && <span className="text-[7px] text-white/70 border border-white/30 rounded px-1 ml-0.5">待开放</span>}
                        </div>
                        {/* 角色小头像缩影 */}
                        <div className="absolute bottom-2 left-2.5 right-2.5 flex items-end justify-between">
                            <div className="flex -space-x-2">
                                {occupants.slice(0, 4).map(c => {
                                    const ch = getChibi(c);
                                    return ch.img
                                        ? <img key={c.id} src={ch.img} className="h-9 w-9 object-contain object-bottom drop-shadow" alt="" style={{ transform: `scaleX(${ch.flip ? -1 : 1})` }} />
                                        : <div key={c.id} className="h-6 w-6 rounded-full bg-indigo-400/70 border border-white/40 flex items-center justify-center text-[9px]">{c.name.slice(0, 1)}</div>;
                                })}
                            </div>
                            {room.implemented && <span className="text-[9px] text-white/80 font-bold flex items-center gap-0.5">进入 <CaretRight size={10} weight="bold" /></span>}
                        </div>
                    </button>
                );
            })}
        </div>

        {novelCount === 0 && (
            <button onClick={onGoLibrary} className="w-full rounded-xl border border-dashed border-indigo-300/40 py-3 text-[12px] text-indigo-200/80 active:bg-white/5">
                书库还空着，去上传一本小说，角色登入后就能在图书馆读它 →
            </button>
        )}

        <div>
            <div className="text-[12px] font-bold text-indigo-100/90 mb-2 flex items-center gap-1.5"><Clock size={14} weight="bold" /> 彼方动态</div>
            {feed.length === 0 ? (
                <p className="text-[11px] text-indigo-300/50 py-4 text-center">还没有人留下痕迹。在「接入」里启用角色，它们到点会自己登入。</p>
            ) : (
                <div className="space-y-2">
                    {feed.map(item => {
                        const room = getRoom(item.meta.room);
                        return (
                            <div key={item.msgId} className="rounded-xl p-2.5 border border-white/10 flex gap-2.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
                                {item.avatar ? <img src={item.avatar} className="h-8 w-8 rounded-full object-cover shrink-0" alt="" /> : <div className="h-8 w-8 rounded-full bg-indigo-400/40 shrink-0" />}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 text-[11px]">
                                        <span className="font-bold text-amber-200">{item.charName}</span>
                                        <span className="text-indigo-300/50">{room.emoji} {room.name}</span>
                                        <span className="ml-auto text-indigo-300/40 text-[9px]">{new Date(item.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p className="text-[11.5px] text-indigo-50/90 mt-0.5 leading-snug">{item.meta.activity}</p>
                                    {item.meta.annotationExcerpts && item.meta.annotationExcerpts.length > 0 && (
                                        <div className="mt-1 space-y-0.5">
                                            {item.meta.annotationExcerpts.slice(0, 2).map((ex, i) => (
                                                <div key={i} className="text-[10.5px] text-indigo-200/70 pl-2 border-l-2 border-amber-300/40 leading-snug">{ex}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    </div>
);

// ============ 房间场景（全屏） ============
const toSong = (s: CharPlaylistSong): Song => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, albumPic: s.albumPic, duration: s.duration, fee: s.fee ?? 0 });

const RoomScene: React.FC<{
    roomId: VRRoomId; occupants: CharacterProfile[];
    latestByChar: Record<string, FeedItem>; onClose: () => void;
}> = ({ roomId, occupants, latestByChar, onClose }) => {
    const room = getRoom(roomId);
    const slots = ROOM_SLOTS[roomId];
    const isMusic = roomId === 'music';
    const [detail, setDetail] = useState<CharacterProfile | null>(null);
    const [musicState, setMusicState] = useState<VRMusicRoomState | null>(null);
    const music = useMusic();

    useEffect(() => {
        if (!isMusic) return;
        const load = async () => setMusicState(await DB.getVRMusicRoom());
        void load();
        const onDone = () => { void load(); };
        window.addEventListener('vr-session-done', onDone);
        return () => window.removeEventListener('vr-session-done', onDone);
    }, [isMusic]);

    const np = musicState?.nowPlaying;
    const npPlaying = !!np && music.current?.id === np.song.id && music.playing;
    const playNow = () => {
        if (!np) return;
        if (music.current?.id === np.song.id) music.togglePlay();
        else music.playSong(toSong(np.song));
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col">
            <VRStyleTag />
            <div className="relative flex-1 overflow-hidden">
                <RoomBackground roomId={roomId} />
                {/* 顶栏 */}
                <div className="absolute top-0 left-0 right-0 flex items-center gap-2 px-4 pt-3 pb-2 z-20"
                    style={{ background: 'linear-gradient(180deg,rgba(0,0,0,.5),transparent)' }}>
                    <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full bg-black/30 active:bg-black/50 text-white"><CaretLeft size={20} weight="bold" /></button>
                    <span className="text-base font-black text-white drop-shadow flex items-center gap-1.5">{room.emoji} {room.name}</span>
                    <span className="ml-auto text-[10px] text-white/70">{occupants.length} 人在场</span>
                </div>

                {/* 听歌房：正在放 + 队列面板 */}
                {isMusic && (
                    <div className="absolute top-12 left-3 right-3 z-20">
                        {np ? (
                            <div className="rounded-2xl p-2.5 flex items-center gap-3 backdrop-blur-md"
                                style={{ background: 'rgba(20,8,40,0.6)', border: '1px solid rgba(255,123,213,0.35)', boxShadow: '0 6px 20px rgba(120,40,160,.4)' }}>
                                {np.song.albumPic
                                    ? <img src={np.song.albumPic} className={`h-14 w-14 rounded-xl object-cover ${npPlaying ? 'animate-spin-slow' : ''}`} style={npPlaying ? { animation: 'spin 8s linear infinite' } : {}} alt="" />
                                    : <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><MusicNotes size={22} weight="fill" className="text-white/80" /></div>}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[9px] text-pink-200/70 tracking-wide flex items-center gap-1"><MusicNotes size={9} weight="fill" /> NOW PLAYING · {np.charName} 点的</div>
                                    <div className="text-[13px] font-bold text-white truncate">{np.song.name}</div>
                                    <div className="text-[10.5px] text-pink-100/60 truncate">{np.song.artists}</div>
                                </div>
                                <button onClick={playNow} className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center active:scale-90 transition-transform shrink-0">
                                    {npPlaying ? <Pause size={18} weight="fill" className="text-purple-700" /> : <Play size={18} weight="fill" className="text-purple-700 ml-0.5" />}
                                </button>
                            </div>
                        ) : (
                            <div className="rounded-2xl p-3 text-center backdrop-blur-md" style={{ background: 'rgba(20,8,40,0.5)', border: '1px solid rgba(255,123,213,0.25)' }}>
                                <p className="text-[11px] text-pink-100/80">还没有人放歌。让有音乐人格的角色逛进来，ta 就会点一首。</p>
                                <p className="text-[9.5px] text-pink-200/50 mt-1">没有音乐人格？去「音乐」App 给角色生成一个网易云档案。</p>
                            </div>
                        )}
                        {musicState?.queue && musicState.queue.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-full overflow-x-auto no-scrollbar" style={{ background: 'rgba(20,8,40,0.45)' }}>
                                <Queue size={12} weight="bold" className="text-pink-200/70 shrink-0" />
                                {musicState.queue.slice(0, 6).map((q, i) => (
                                    <span key={i} className="text-[9.5px] text-pink-100/70 whitespace-nowrap shrink-0">《{q.song.name}》<span className="text-pink-200/40">·{q.charName}</span>{i < Math.min(5, musicState.queue.length - 1) ? ' ·' : ''}</span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* chibi 站位 */}
                {occupants.map((c, i) => {
                    const slot = slots[i % slots.length];
                    const latest = latestByChar[c.id];
                    const idle = IDLE_QUIPS[roomId][i % IDLE_QUIPS[roomId].length];
                    const bubble = latest?.meta.activity || idle;
                    return (
                        <div key={c.id} className="absolute" style={{ left: `${slot.x}%`, top: `${slot.y}%`, zIndex: Math.round(slot.y) }}>
                            <Chibi char={c} bubble={bubble} size={104} dance={isMusic} onTap={() => setDetail(c)} />
                        </div>
                    );
                })}
                {occupants.length === 0 && !isMusic && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-white/70 text-[12px] bg-black/30 rounded-full px-4 py-2">这个房间还没有人。去「接入」启用角色吧。</p>
                    </div>
                )}
            </div>

            {/* 角色活动详情 —— 盖在 chibi 之上（zIndex 高于任何 chibi） */}
            {detail && (
                <div className="absolute inset-0 flex items-end bg-black/45" style={{ zIndex: 200 }} onClick={() => setDetail(null)}>
                    <div className="w-full rounded-t-2xl p-4 text-white" style={{ background: 'linear-gradient(180deg,#2a2350,#1b1838)' }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-2">
                            {detail.avatar ? <img src={detail.avatar} className="h-9 w-9 rounded-full object-cover" alt="" /> : <div className="h-9 w-9 rounded-full bg-indigo-400/40" />}
                            <span className="font-bold">{detail.name}</span>
                            <button onClick={() => setDetail(null)} className="ml-auto p-1 text-white/60"><X size={18} /></button>
                        </div>
                        {latestByChar[detail.id] ? (() => {
                            const m = latestByChar[detail.id].meta;
                            return (
                                <>
                                    <p className="text-[12.5px] text-indigo-50/90 leading-relaxed">{m.activity}</p>
                                    {m.behavior && <p className="text-[11px] text-pink-200/80 mt-1.5">🎧 {m.behavior}</p>}
                                    {m.annotationExcerpts?.map((ex, i) => (
                                        <div key={i} className="mt-1.5 text-[11.5px] text-indigo-200/80 pl-2 border-l-2 border-amber-300/50 leading-snug">{ex}</div>
                                    ))}
                                    <p className="text-[9px] text-indigo-300/50 mt-2">{new Date(latestByChar[detail.id].timestamp).toLocaleString('zh-CN')}</p>
                                </>
                            );
                        })() : (
                            <p className="text-[12px] text-indigo-300/60">还没有留下动态，等 ta 下一次登入吧。</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ============ 书库 ============
const LibraryView: React.FC<{
    novels: VRWorldNovel[]; characters: CharacterProfile[];
    onOpen: (n: VRWorldNovel) => void; onAdd: () => void; onDelete: (id: string) => void;
}> = ({ novels, characters, onOpen, onAdd, onDelete }) => (
    <div className="space-y-3">
        <button onClick={onAdd} className="w-full rounded-xl py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform shadow-[0_4px_14px_rgba(120,100,255,0.4)]"
            style={{ background: 'linear-gradient(135deg,#8b7bf0,#b06ad6)' }}>
            <Plus size={16} weight="bold" /> 上传小说（支持 .txt）
        </button>
        {novels.length === 0 ? (
            <p className="text-[11px] text-indigo-300/50 py-6 text-center">书库空空如也。上传的小说是所有角色共享的读物，每个角色各自留批注、各自记书签。</p>
        ) : novels.map(novel => {
            const readers = characters.filter(c => getBookmark(c.vrState?.novelBookmarks, novel.id) > 0);
            return (
                <div key={novel.id} className="rounded-xl p-3 border border-white/10" style={{ background: 'rgba(255,255,255,0.05)' }}>
                    <div className="flex items-start gap-2">
                        <BookOpen size={18} weight="fill" className="text-amber-200 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-bold truncate">{novel.title}</div>
                            {novel.author && <div className="text-[10px] text-indigo-300/60">{novel.author}</div>}
                            <div className="text-[10px] text-indigo-300/50 mt-0.5">{novel.segments.length} 段 · {novel.totalChars.toLocaleString()} 字</div>
                        </div>
                        <button onClick={() => onDelete(novel.id)} className="p-1.5 rounded-full active:bg-white/10 text-indigo-300/50"><Trash size={15} /></button>
                    </div>
                    {readers.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {readers.map(c => {
                                const bm = getBookmark(c.vrState?.novelBookmarks, novel.id);
                                const pct = Math.round((bm / Math.max(1, novel.segments.length)) * 100);
                                return <span key={c.id} className="text-[9.5px] bg-white/10 rounded-full px-2 py-0.5 text-indigo-100/80">{c.name} {pct}%</span>;
                            })}
                        </div>
                    )}
                    <button onClick={() => onOpen(novel)} className="mt-2 text-[11px] text-indigo-300 font-semibold flex items-center gap-0.5 active:opacity-70">翻开阅读 / 看批注 <CaretRight size={12} weight="bold" /></button>
                </div>
            );
        })}
    </div>
);

// ============ 阅读器主题 ============
interface ReaderTheme { id: string; name: string; bg: string; paper: string; text: string; sub: string; accent: string; annBg: string; }
const READER_THEMES: ReaderTheme[] = [
    { id: 'paper', name: '纸白', bg: '#e9e3d6', paper: '#f7f3ea', text: '#322d25', sub: '#8a7f6c', accent: '#a0673b', annBg: '#efe7d4' },
    { id: 'sepia', name: '羊皮', bg: '#d8c6a3', paper: '#ece0c6', text: '#48381f', sub: '#917a52', accent: '#8a5a2b', annBg: '#e2d3b2' },
    { id: 'green', name: '护眼', bg: '#bcd4bc', paper: '#d6e8d4', text: '#26331f', sub: '#5d7350', accent: '#3f6b3a', annBg: '#cadfc6' },
    { id: 'night', name: '夜阅', bg: '#15161a', paper: '#1f2128', text: '#cfc9bd', sub: '#7d7869', accent: '#c0915a', annBg: '#262932' },
    { id: 'ink', name: '墨黑', bg: '#0a0a0e', paper: '#131319', text: '#b9b4ab', sub: '#6f6a78', accent: '#8b9bff', annBg: '#1a1a24' },
];
const FONT_SIZES = [13, 15, 17, 20];
const READER_THEME_KEY = 'vr_reader_theme';
const READER_FONT_KEY = 'vr_reader_font';
const READER_MODE_KEY = 'vr_reader_mode'; // 'page' | 'scroll'
// 用户书签（段索引，per-novel，独立于角色书签）
const userBmKey = (id: string) => `vr_user_bm_${id}`;
const readUserBm = (id: string): number => {
    const v = Number(localStorage.getItem(userBmKey(id)));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};
const writeUserBm = (id: string, idx: number) => {
    try { localStorage.setItem(userBmKey(id), String(Math.max(0, idx))); } catch { /* ignore */ }
};

// 单段渲染（翻页/滚动共用）
const SegBlock: React.FC<{
    seg: { idx: number; text: string }; anns: VRNovelAnnotation[];
    theme: ReaderTheme; fontSize: number; nameOf: (id: string) => string | undefined;
}> = ({ seg, anns, theme, fontSize, nameOf }) => (
    <div data-seg={seg.idx} className="mb-5">
        <p className="whitespace-pre-wrap" style={{ color: theme.text, fontSize, lineHeight: 1.9, textIndent: '2em' }}>{seg.text}</p>
        {anns.map(a => (
            <div key={a.id} className="mt-2 ml-2 rounded-lg px-3 py-2" style={{ background: theme.annBg, borderLeft: `3px solid ${theme.accent}` }}>
                <span className="font-bold" style={{ color: theme.accent, fontSize: fontSize - 3 }}>{nameOf(a.authorId) || a.authorName}</span>
                {a.targetAnnotationId && <span style={{ color: theme.sub, fontSize: fontSize - 3 }}> 回应</span>}
                <span style={{ color: theme.text, fontSize: fontSize - 3 }}>：{a.content}</span>
            </div>
        ))}
    </div>
);

const ReaderModal: React.FC<{ novel: VRWorldNovel; characters: CharacterProfile[]; onClose: () => void; }> = ({ novel, characters, onClose }) => {
    const PAGE_SIZE = 8;
    const total = novel.segments.length;
    const initialBm = useMemo(() => Math.min(readUserBm(novel.id), Math.max(0, total - 1)), [novel.id, total]);

    const [annotations, setAnnotations] = useState<VRNovelAnnotation[]>([]);
    const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(READER_THEME_KEY) || 'paper');
    const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(READER_FONT_KEY)) || 15);
    const [mode, setMode] = useState<'page' | 'scroll'>(() => (localStorage.getItem(READER_MODE_KEY) === 'scroll' ? 'scroll' : 'page'));
    const [showCtl, setShowCtl] = useState(false);

    // 翻页态
    const [page, setPage] = useState(() => Math.floor(initialBm / PAGE_SIZE));
    // 滚动态：窗口 [winStart, winEnd)，初始落在书签处
    const [winStart, setWinStart] = useState(() => initialBm);
    const [winEnd, setWinEnd] = useState(() => Math.min(total, initialBm + 30));
    const [topSeg, setTopSeg] = useState(initialBm);

    const scrollRef = useRef<HTMLDivElement>(null);
    const prevHeightRef = useRef<number | null>(null);
    const bmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { void (async () => setAnnotations(await DB.getVRAnnotations(novel.id)))(); }, [novel.id]);
    useEffect(() => { localStorage.setItem(READER_THEME_KEY, themeId); }, [themeId]);
    useEffect(() => { localStorage.setItem(READER_FONT_KEY, String(fontSize)); }, [fontSize]);

    // 翻页：换页存书签 + 回顶
    useEffect(() => {
        if (mode !== 'page') return;
        writeUserBm(novel.id, page * PAGE_SIZE);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [page, mode, novel.id]);

    // 滚动：prepend 后补偿滚动位置，避免跳动
    useLayoutEffect(() => {
        if (prevHeightRef.current != null && scrollRef.current) {
            const el = scrollRef.current;
            el.scrollTop += el.scrollHeight - prevHeightRef.current;
            prevHeightRef.current = null;
        }
    }, [winStart]);

    const switchMode = (m: 'page' | 'scroll') => {
        if (m === mode) return;
        if (m === 'scroll') {
            const bm = page * PAGE_SIZE;
            setWinStart(bm); setWinEnd(Math.min(total, bm + 30)); setTopSeg(bm);
        } else {
            setPage(Math.floor(readUserBm(novel.id) / PAGE_SIZE));
        }
        setMode(m);
        localStorage.setItem(READER_MODE_KEY, m);
    };

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el || mode !== 'scroll') return;
        // 触底加载更多
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && winEnd < total) {
            setWinEnd(e => Math.min(total, e + 20));
        }
        // 触顶往回加载
        if (el.scrollTop < 400 && winStart > 0) {
            prevHeightRef.current = el.scrollHeight;
            setWinStart(s => Math.max(0, s - 20));
        }
        // 节流存书签（取顶部首个可见段）
        if (bmTimerRef.current) return;
        bmTimerRef.current = setTimeout(() => {
            bmTimerRef.current = null;
            const cur = scrollRef.current;
            if (!cur) return;
            const top = cur.scrollTop;
            const nodes = cur.querySelectorAll<HTMLElement>('[data-seg]');
            for (const n of Array.from(nodes)) {
                if (n.offsetTop + n.offsetHeight > top + 4) {
                    const idx = Number(n.dataset.seg);
                    setTopSeg(idx); writeUserBm(novel.id, idx);
                    break;
                }
            }
        }, 300);
    };

    const theme = READER_THEMES.find(t => t.id === themeId) || READER_THEMES[0];
    const annBySeg = useMemo(() => groupAnnotationsBySeg(annotations), [annotations]);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const renderSegs = mode === 'page'
        ? novel.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        : novel.segments.slice(winStart, winEnd);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: theme.bg }}>
            {/* 顶栏 */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.accent}22` }}>
                <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full active:bg-black/5" style={{ color: theme.text }}><X size={20} weight="bold" /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold truncate" style={{ color: theme.text }}>{novel.title}</div>
                    <div className="text-[10px]" style={{ color: theme.sub }}>
                        {mode === 'page'
                            ? `第 ${page * PAGE_SIZE + 1}~${Math.min((page + 1) * PAGE_SIZE, total)} 段 / 共 ${total} 段`
                            : `读到第 ${topSeg + 1} 段 / 共 ${total} 段 · ${Math.round((topSeg / Math.max(1, total)) * 100)}%`}
                    </div>
                </div>
                <button onClick={() => setShowCtl(s => !s)} className="p-1.5 rounded-full active:bg-black/5" style={{ color: theme.accent }}><Palette size={18} weight="bold" /></button>
            </div>

            {/* 控制条：主题 / 字号 / 模式 */}
            {showCtl && (
                <div className="px-4 py-2.5 shrink-0 space-y-2.5" style={{ background: theme.paper, borderBottom: `1px solid ${theme.accent}22` }}>
                    <div className="flex items-center gap-2">
                        <Palette size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {READER_THEMES.map(t => (
                                <button key={t.id} onClick={() => setThemeId(t.id)}
                                    className="flex-1 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all"
                                    style={{ background: t.paper, color: t.text, border: themeId === t.id ? `2px solid ${t.accent}` : `1px solid ${t.accent}33` }}>
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TextAa size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {FONT_SIZES.map(fs => (
                                <button key={fs} onClick={() => setFontSize(fs)}
                                    className="w-9 h-7 rounded-lg font-bold transition-all"
                                    style={{ background: fontSize === fs ? theme.accent : 'transparent', color: fontSize === fs ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44`, fontSize: Math.min(fs, 15) }}>
                                    A
                                </button>
                            ))}
                        </div>
                        {/* 模式切换 */}
                        <div className="flex gap-1.5">
                            {(['page', 'scroll'] as const).map(m => (
                                <button key={m} onClick={() => switchMode(m)}
                                    className="px-2.5 h-7 rounded-lg text-[11px] font-bold transition-all"
                                    style={{ background: mode === m ? theme.accent : 'transparent', color: mode === m ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44` }}>
                                    {m === 'page' ? '翻页' : '滚动'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 正文 */}
            <div ref={scrollRef} onScroll={mode === 'scroll' ? onScroll : undefined}
                className="flex-1 overflow-y-auto px-5 py-4" style={{ background: theme.bg, fontFamily: `'Noto Serif SC','Songti SC','Noto Serif','Georgia',serif` }}>
                {mode === 'scroll' && winStart > 0 && (
                    <div className="text-center text-[10px] mb-3" style={{ color: theme.sub }}>—— 上滑加载更早内容 ——</div>
                )}
                {renderSegs.map(seg => (
                    <SegBlock key={seg.idx} seg={seg} anns={annBySeg.get(seg.idx) || []} theme={theme} fontSize={fontSize} nameOf={nameOf} />
                ))}
            </div>

            {/* 底栏 */}
            {mode === 'page' ? (
                <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22` }}>
                    <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>‹ 上一页</button>
                    <span className="text-[11px]" style={{ color: theme.sub }}>{page + 1} / {totalPages}</span>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>下一页 ›</button>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-4 px-5 py-2 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22` }}>
                    <button onClick={() => { setWinStart(0); setWinEnd(Math.min(total, 30)); setTopSeg(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
                        className="text-[11px] font-semibold" style={{ color: theme.accent }}>↑ 从头</button>
                    <span className="text-[10px]" style={{ color: theme.sub }}>滚动阅读 · 自动记录位置</span>
                </div>
            )}
        </div>
    );
};

// ============ 上传弹窗（支持大文件 .txt，内容不入 DOM） ============
const UploadModal: React.FC<{
    onClose: () => void;
    onCommit: (novel: VRWorldNovel) => Promise<void> | void;
    onError: (msg: string) => void;
}> = ({ onClose, onCommit, onError }) => {
    const [title, setTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [summary, setSummary] = useState('');
    // 手动粘贴的小段文本走 state；大文件内容只存 ref，不进 textarea（否则 12MB 会冻 UI）
    const [pasteText, setPasteText] = useState('');
    const [fileInfo, setFileInfo] = useState<{ name: string; chars: number; preview: string; encoding: string } | null>(null);
    const fileContentRef = useRef<string>('');
    const fileRef = useRef<HTMLInputElement>(null);
    const [reading, setReading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);

    const onFile = async (f: File | undefined) => {
        if (!f) return;
        setReading(true);
        try {
            const { text: content, encoding } = await decodeTextFile(f);
            fileContentRef.current = content;
            setFileInfo({
                name: f.name,
                chars: content.length,
                preview: content.slice(0, 300).replace(/\s+/g, ' ').trim(),
                encoding,
            });
            setPasteText(''); // 文件优先，清掉粘贴框
            if (!title.trim()) setTitle(f.name.replace(/\.(txt|text)$/i, ''));
        } catch (e) {
            console.error('[VRWorld] decode file failed', e);
            onError('文件读取失败');
        } finally {
            setReading(false);
        }
    };

    const clearFile = () => {
        fileContentRef.current = '';
        setFileInfo(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const totalChars = fileInfo ? fileInfo.chars : pasteText.length;
    const canSave = !!title.trim() && totalChars > 0 && !busy;

    const handleSave = async () => {
        const content = fileInfo ? fileContentRef.current : pasteText;
        if (!title.trim() || !content) { onError('书名和正文都要填'); return; }
        setBusy(true);
        setProgress(0);
        try {
            // 让出一帧，先让"处理中"渲染出来
            await new Promise<void>(r => setTimeout(r));
            const novel = await buildNovelAsync(title, content, {
                author, summary,
                onProgress: (r) => setProgress(Math.round(r * 100)),
            });
            if (novel.segments.length === 0) { onError('正文是空的'); setBusy(false); return; }
            await onCommit(novel);
        } catch (e) {
            console.error('[VRWorld] build novel failed', e);
            onError('处理失败，文件可能太大或格式异常');
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={busy ? undefined : onClose}>
            <div className="w-full max-w-md rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto" style={{ background: '#1b1838' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-3">
                    <span className="text-[15px] font-bold text-white">上传小说</span>
                    {!busy && <button onClick={onClose} className="ml-auto p-1 text-indigo-300/60"><X size={18} /></button>}
                </div>

                <input ref={fileRef} type="file" accept=".txt,text/plain" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                {reading ? (
                    <div className="w-full rounded-xl border border-indigo-300/30 py-5 mb-3 flex items-center justify-center gap-2 text-indigo-100/90">
                        <CircleNotch size={18} weight="bold" className="animate-spin" /> 读取并识别编码中…
                    </div>
                ) : fileInfo ? (
                    <div className="rounded-xl border border-indigo-300/30 p-3 mb-3 bg-white/5">
                        <div className="flex items-center gap-2">
                            <BookOpen size={16} weight="fill" className="text-amber-200 shrink-0" />
                            <span className="text-[12.5px] text-white font-semibold truncate flex-1">{fileInfo.name}</span>
                            <span className="text-[8.5px] text-indigo-300/60 border border-indigo-300/30 rounded px-1 uppercase">{fileInfo.encoding}</span>
                            {!busy && <button onClick={clearFile} className="text-indigo-300/60 p-1"><X size={14} /></button>}
                        </div>
                        <div className="text-[10px] text-indigo-300/60 mt-1">{fileInfo.chars.toLocaleString()} 字 · 预计 ~{Math.ceil(fileInfo.chars / 400).toLocaleString()} 段</div>
                        <p className="text-[10.5px] text-indigo-200/50 mt-1.5 leading-snug line-clamp-2">{fileInfo.preview}…</p>
                    </div>
                ) : (
                    <button onClick={() => fileRef.current?.click()}
                        className="w-full rounded-xl border border-dashed border-indigo-300/40 py-3 mb-3 text-[12.5px] text-indigo-100/90 flex items-center justify-center gap-2 active:bg-white/5">
                        <UploadSimple size={16} weight="bold" /> 选择 .txt 文件（大文件也 OK）
                    </button>
                )}

                <div className="space-y-2.5">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="书名（必填）" className="w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] text-white placeholder-indigo-300/40 outline-none" />
                    <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者（选填）" className="w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] text-white placeholder-indigo-300/40 outline-none" />
                    <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="一句话简介（选填，喂给角色当背景）" className="w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] text-white placeholder-indigo-300/40 outline-none" />
                    {!fileInfo && (
                        <>
                            <div className="text-[10px] text-indigo-300/50">或直接粘贴正文（小段文本用；大文件请走上面的文件选择）↓</div>
                            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="粘贴正文…" rows={6}
                                className="w-full rounded-lg bg-white/8 px-3 py-2 text-[12.5px] text-white placeholder-indigo-300/40 outline-none leading-relaxed" />
                        </>
                    )}
                    <div className="text-[10px] text-indigo-300/50">{totalChars.toLocaleString()} 字</div>
                </div>

                {busy ? (
                    <div className="mt-3">
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#8b7bf0,#b06ad6)' }} />
                        </div>
                        <div className="text-[11px] text-indigo-200/70 text-center mt-1.5">处理中… {progress}%（大文件需要点时间）</div>
                    </div>
                ) : (
                    <button onClick={handleSave} disabled={!canSave}
                        className="w-full mt-3 rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#8b7bf0,#b06ad6)' }}>
                        上架到书库
                    </button>
                )}
            </div>
        </div>
    );
};

// ============ chibi 形象编辑器（复用特别时光的捏人系统） ============
type ChibiSave = { img: string; state?: any; scale: number; offsetY: number; flip: boolean };
const ChibiEditor: React.FC<{
    char: CharacterProfile;
    onClose: () => void;
    onSave: (chibi: ChibiSave) => void;
}> = ({ char, onClose, onSave }) => {
    const existing = char.vrState?.chibi;
    // 已捏过的：进入"预览 + 微调"页；点"重新捏"再开捏人器。没捏过：直接进捏人器。
    const [creating, setCreating] = useState<boolean>(!existing?.img);
    const [img, setImg] = useState<string>(existing?.img || '');
    const [state, setState] = useState<any>(existing?.state);
    const [scale, setScale] = useState<number>(existing?.scale ?? 1);
    const [offsetY, setOffsetY] = useState<number>(existing?.offsetY ?? 0);
    const [flip, setFlip] = useState<boolean>(!!existing?.flip);

    const isSully = (char.name || '').toLowerCase().includes('sully');
    // 回填：捏人器 init 读 presets（扁平 map），用上次导出的 state.selected
    const presets = existing?.state?.selected || (isSully ? { skin: 'skin_1', fronthair: 'fronthair_99', eyes: 'eyes_99' } : undefined);

    const onConfirm = (r: ChibiResult) => {
        setImg(r.transparentDataUrl);
        setState(r.state);
        setScale(1); setOffsetY(0); setFlip(false);
        setCreating(false);
    };

    if (creating) {
        return (
            <div className="fixed inset-0 z-[60] flex flex-col bg-black">
                <div className="flex items-center gap-2 px-4 py-2 shrink-0 text-white" style={{ background: '#1b1838' }}>
                    <button onClick={() => existing?.img ? setCreating(false) : onClose()} className="p-1.5 -ml-1.5 rounded-full active:bg-white/10"><CaretLeft size={20} weight="bold" /></button>
                    <span className="text-[14px] font-bold">捏 {char.name} 的小人</span>
                </div>
                <div className="flex-1 min-h-0">
                    <CreatorIframe mode="char" charName={char.name} isSully={isSully} presets={presets}
                        draftKey={`vr_${char.id}`} title={`捏一个小人 · ${char.name}`} subtitle="彼方 · CHIBI"
                        onConfirm={onConfirm} />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55" onClick={onClose}>
            <VRStyleTag />
            <div className="w-full max-w-md rounded-t-2xl p-4" style={{ background: '#1b1838' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-1">
                    <span className="text-[15px] font-bold text-white">{char.name} 的彼方形象</span>
                    <button onClick={onClose} className="ml-auto p-1 text-indigo-300/60"><X size={18} /></button>
                </div>
                <p className="text-[10.5px] text-indigo-300/60 mb-3">这个 Q 版小人会站在彼方的房间里。可以重新捏，或微调站位。</p>

                <div className="relative rounded-xl h-48 overflow-hidden mb-3 flex items-end justify-center" style={{ background: 'linear-gradient(180deg,#2a2350,#15132b)' }}>
                    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(1.5px 1.5px at 30% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1.5px 1.5px at 70% 50%, rgba(200,220,255,.4), transparent)' }} />
                    {img && <img src={img} alt="" className="object-contain mb-3" style={{ height: 140 * scale, transform: `scaleX(${flip ? -1 : 1}) translateY(${offsetY}px)`, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.5))', animation: 'vrfloat 3.2s ease-in-out infinite' }} />}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[50%]" style={{ width: 76, height: 17, background: 'radial-gradient(ellipse,rgba(0,0,0,.5),transparent)' }} />
                </div>

                <button onClick={() => setCreating(true)} className="w-full rounded-lg border border-indigo-300/40 py-2 mb-3 text-[12px] text-indigo-100 flex items-center justify-center gap-1.5 active:bg-white/5">
                    <PencilSimple size={14} weight="bold" /> 重新捏小人
                </button>

                <div className="space-y-2.5 mb-3">
                    <label className="flex items-center gap-2 text-[11px] text-indigo-200/80">
                        <UploadSimple size={14} className="rotate-90" /> 大小
                        <input type="range" min={0.5} max={1.6} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value))} className="flex-1 accent-indigo-400" />
                    </label>
                    <button onClick={() => setFlip(f => !f)} className={`text-[11px] rounded-full px-3 py-1 flex items-center gap-1.5 ${flip ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/80'}`}>
                        <FlipHorizontal size={13} /> 水平翻转
                    </button>
                </div>

                <button onClick={() => { if (img) onSave({ img, state, scale, offsetY, flip }); }} disabled={!img}
                    className="w-full rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#8b7bf0,#b06ad6)' }}>
                    保存形象{char.vrState?.enabled ? '' : ' 并接入'}
                </button>
            </div>
        </div>
    );
};

// ============ 接入设置 ============
const INTERVAL_OPTIONS = [60, 120, 180, 360, 720];
const SettingsView: React.FC<{
    characters: CharacterProfile[];
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    addToast?: (msg: string, type?: any) => void;
    novelCount: number; onReload: () => void;
    onRequestEnable: (char: CharacterProfile) => void;
    onEditChibi: (char: CharacterProfile) => void;
}> = ({ characters, updateCharacter, addToast, novelCount, onReload, onRequestEnable, onEditChibi }) => {

    const disable = (char: CharacterProfile) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || { intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), enabled: false } as any });
        VRScheduler.stop(char.id);
    };
    const setInterval = (char: CharacterProfile, minutes: number) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || {}), enabled: char.vrState?.enabled ?? true, intervalMinutes: minutes } });
        if (char.vrState?.enabled) VRScheduler.start(char.id, minutes);
    };

    return (
        <div className="space-y-3">
            <p className="text-[11px] text-indigo-300/60 leading-relaxed">
                启用后，角色会按设定的间隔自己登入「彼方」，在图书馆读你上传的小说、写批注。每次活动会在 ta 的聊天里留下动态卡片，也会被记忆总结捕捉。
                {novelCount === 0 && <span className="text-amber-300/80"> 书库还空着，先去「书库」上传一本。</span>}
            </p>
            {characters.length === 0 && <p className="text-[11px] text-indigo-300/50 py-4 text-center">还没有角色。</p>}
            {characters.map(char => {
                const st = char.vrState;
                const enabled = !!st?.enabled;
                const interval = st?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
                const chibi = getChibi(char);
                return (
                    <div key={char.id} className="rounded-xl p-3 border border-white/10" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <div className="flex items-center gap-2.5">
                            {/* chibi 缩略 */}
                            <button onClick={() => onEditChibi(char)} className="relative h-12 w-12 rounded-xl overflow-hidden bg-black/20 flex items-end justify-center shrink-0 active:opacity-80">
                                {chibi.img ? <img src={chibi.img} className="h-11 object-contain object-bottom" style={{ transform: `scaleX(${chibi.flip ? -1 : 1})` }} alt="" /> : <span className="text-lg text-indigo-300/60 mb-2">？</span>}
                                <span className="absolute bottom-0 right-0 bg-indigo-500/90 rounded-tl-md p-0.5"><PencilSimple size={9} weight="bold" /></span>
                            </button>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold truncate">{char.name}</div>
                                {enabled ? <div className="text-[10px] text-indigo-300/60">每 {interval >= 60 ? `${interval / 60} 小时` : `${interval} 分`}登入一次</div>
                                    : <div className="text-[10px] text-indigo-300/40">{chibi.isFallback ? '未设形象 · 未接入' : '未接入'}</div>}
                            </div>
                            <button onClick={() => enabled ? disable(char) : onRequestEnable(char)}
                                className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-indigo-400' : 'bg-white/15'}`}>
                                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>
                        {enabled && (
                            <>
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {INTERVAL_OPTIONS.map(opt => (
                                        <button key={opt} onClick={() => setInterval(char, opt)}
                                            className={`text-[10.5px] rounded-full px-2.5 py-1 font-semibold ${interval === opt ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/70'}`}>
                                            {opt >= 60 ? `${opt / 60}h` : `${opt}min`}
                                        </button>
                                    ))}
                                </div>
                                <button onClick={() => { VRScheduler.triggerNow(char.id); addToast?.(`${char.name} 正在登入彼方…`, 'info'); setTimeout(onReload, 4000); }}
                                    className="mt-2.5 text-[11px] text-amber-200 font-semibold flex items-center gap-1 active:opacity-70">
                                    <Play size={12} weight="fill" /> 让 ta 现在去逛一次
                                </button>
                            </>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// ============ 动画关键帧 ============
const VRStyleTag: React.FC = () => (
    <style>{`
        @keyframes vrfloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes vrwave { from { transform: scaleY(0.5); } to { transform: scaleY(1.05); } }
        @keyframes vrdance { 0%{transform:translateY(0) rotate(-5deg)} 25%{transform:translateY(-9px) rotate(3deg)} 50%{transform:translateY(0) rotate(5deg)} 75%{transform:translateY(-9px) rotate(-3deg)} 100%{transform:translateY(0) rotate(-5deg)} }
    `}</style>
);

export default VRWorldApp;
