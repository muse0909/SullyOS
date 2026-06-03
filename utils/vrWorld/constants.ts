/**
 * 「彼方」虚拟世界 —— 房间与全局常量。
 *
 * 世界观：每个角色都有自己进入这个虚拟现实的方式。它们随时可登入登出，
 * 各自在不同房间里活动，所以不会出现"一边和 user 相处一边又和别的 char
 * 待在一起"的破绽。定时器驱动每个角色独立登入一次，完成一次活动。
 */

import { VRRoomId } from '../../types';

export interface VRRoomDef {
    id: VRRoomId;
    name: string;
    /** 房间一句话说明（喂给角色 + UI 展示） */
    blurb: string;
    /** 角色在这个房间"可以做什么"的说明（进 prompt） */
    affordance: string;
    emoji: string;
    /** v1 是否已实装真实玩法（false = 暂由 LLM 造谣） */
    implemented: boolean;
    /** UI 主题色（tailwind 渐变用） */
    accent: string;
}

export const VR_ROOMS: VRRoomDef[] = [
    {
        id: 'library',
        name: '图书馆',
        blurb: '安静的环形书阁，悬浮的书页在空气里翻动。',
        affordance: '你可以挑一本书往下读，在段落旁写下批注或吐槽，也可以吐槽别人留在书上的批注。',
        emoji: '📚',
        implemented: true,
        accent: 'amber',
    },
    {
        id: 'music',
        name: '听歌房',
        blurb: '漂浮着声波涟漪的房间，一台共享音箱循环播放着大家点的歌。',
        affordance: '你可以从自己歌单里点一首排进队列，锐评正在放的歌，跟着蹦跶、跟唱、或给谁录一段。',
        emoji: '🎧',
        implemented: true,
        accent: 'rose',
    },
    {
        id: 'guestbook',
        name: '留言簿',
        blurb: '一面会发光的墙，谁路过都能留下一句话。',
        affordance: '你可以读读墙上其他角色留下的话，回应它们、交流近况、认识彼此。',
        emoji: '📝',
        implemented: false,
        accent: 'sky',
    },
    {
        id: 'gym',
        name: '活动场',
        blurb: '开阔的全息空间，可以跳舞、健身、玩点小游戏。',
        affordance: '你可以在这里锻炼、跳舞或和别人玩点什么，放松一下。',
        emoji: '🤸',
        implemented: false,
        accent: 'emerald',
    },
];

export const getRoom = (id: VRRoomId): VRRoomDef =>
    VR_ROOMS.find(r => r.id === id) || VR_ROOMS[0];

/** 默认自主登入间隔（分钟）= 2 小时 */
export const VR_DEFAULT_INTERVAL_MIN = 120;

/** 每次登入图书馆固定喂给角色的原文字数预算（含原文+已有批注）。
 *  Gemini 等大上下文模型下，2w字仅约 1.5w tk，加人设/记忆/历史仍宽裕，故给到 4w字。 */
export const VR_NOVEL_FEED_CHARS = 40000;

/** 切块时单个 segment 的目标字数。 */
export const VR_SEGMENT_TARGET_CHARS = 400;
