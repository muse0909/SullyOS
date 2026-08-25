// mailboxStorage — 信箱（双向信件）存储封装（2026-08-25）
// 暮色 8-25 信箱方案：
//   - 暮色写给角色 + 角色写给暮色（双向），都存 mailbox_letters store
//   - fromUser / toUser: 'user' | 'char'
//   - envelope: 'classic' | 'love' | 'handwrite' | 'wax'（4 种，暮色方案去掉了 plain）
//   - deliverAt: 定时发送时间戳（null = 立即发送）
//   - status: 'pending'（待投递）| 'delivered'（已投递未读）| 'read'（已读）
//   - 无字数限制（content 直接存原文字符串）

import { DB } from './db';

export type MailboxFromUser = 'user' | 'char';
export type MailboxEnvelope = 'classic' | 'love' | 'handwrite' | 'wax';
export type MailboxStatus = 'pending' | 'delivered' | 'read';

export interface MailboxLetter {
    id: string;
    charId: string;             // 绑定的对话角色
    fromUser: MailboxFromUser;
    toUser: MailboxFromUser;
    title: string;
    content: string;            // 无字数限制
    envelope: MailboxEnvelope;
    sentAt: number;             // 写入时间戳
    deliverAt: number | null;   // 定时发送时间（null = 立即）
    readAt: number | null;       // 角色/暮色已读时间
    status: MailboxStatus;       // 'pending' | 'delivered' | 'read'
    replyToId: string | null;    // 回信关联到原信
    /** 收件人(暮色)读信时的提醒已读。toUser='user' 时用。
     *  暮色写完信后第一次看到这封信的时间，区别于 readAt（角色读信）。 */
    userNotifiedAt?: number | null;
}

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** 创建一封新信。发送选项：
 *   - deliverAt=null → status: 'delivered'（立即发送）
 *   - deliverAt=<未来时间戳> → status: 'pending'（定时发送）
 */
export async function createLetter(opts: {
    charId: string;
    fromUser: MailboxFromUser;
    title: string;
    content: string;
    envelope: MailboxEnvelope;
    deliverAt?: number | null;
    replyToId?: string | null;
}): Promise<MailboxLetter> {
    const id = genId(opts.fromUser === 'user' ? 'mbl_user' : 'mbl_char');
    const letter: MailboxLetter = {
        id,
        charId: opts.charId,
        fromUser: opts.fromUser,
        toUser: opts.fromUser === 'user' ? 'char' : 'user',
        title: opts.title.trim() || '无题',
        content: opts.content,
        envelope: opts.envelope,
        sentAt: Date.now(),
        deliverAt: opts.deliverAt ?? null,
        readAt: null,
        status: opts.deliverAt && opts.deliverAt > Date.now() ? 'pending' : 'delivered',
        replyToId: opts.replyToId ?? null,
        userNotifiedAt: null,
    };
    await DB.saveMailboxLetter(letter);
    return letter;
}

/** 角色"读信"(标已读 + 返回信) */
export async function markRead(letterId: string): Promise<MailboxLetter | null> {
    const letter = await DB.getMailboxLetter(letterId);
    if (!letter) return null;
    if (letter.status === 'read') return letter;
    letter.status = 'read';
    letter.readAt = Date.now();
    await DB.saveMailboxLetter(letter);
    return letter;
}

/** 暮色"看了"(只是标记已看,不进角色记忆) */
export async function markUserSeen(letterId: string): Promise<MailboxLetter | null> {
    const letter = await DB.getMailboxLetter(letterId);
    if (!letter) return null;
    if (letter.userNotifiedAt) return letter;
    letter.userNotifiedAt = Date.now();
    // 如果信还没被角色读(status='delivered' 不是 'read')，不要改 status
    if (letter.status === 'delivered') {
        // 暮色"看到"了角色写给她的信 = 角色写的信已被收到
        // 但 readAt 仍是 null（暮色读 / 角色读 是两回事）
    }
    await DB.saveMailboxLetter(letter);
    return letter;
}

/** 拉指定角色的所有信（按时间倒序） */
export async function getLetters(charId: string): Promise<MailboxLetter[]> {
    return (await DB.getMailboxLetters(charId)) as MailboxLetter[];
}

/** 我寄出的(fromUser='user') */
export async function getSentByUser(charId: string): Promise<MailboxLetter[]> {
    const all = await getLetters(charId);
    return all.filter(l => l.fromUser === 'user');
}

/** 我收到的(toUser='user') */
export async function getReceivedByUser(charId: string): Promise<MailboxLetter[]> {
    const all = await getLetters(charId);
    return all.filter(l => l.toUser === 'user');
}

/** 角色收件箱(待读 + 已读) — 包含 deliverAt<=now 的 pending（定时发送已到） */
export async function getCharInbox(charId: string, now: number = Date.now()): Promise<MailboxLetter[]> {
    const all = await getLetters(charId);
    return all.filter(l => l.toUser === 'char' && (l.status === 'delivered' || (l.status === 'pending' && l.deliverAt && l.deliverAt <= now)));
}

/** 未读数(给 system prompt 注入 + UI 徽标) */
export async function getUnreadCount(charId: string, now: number = Date.now()): Promise<number> {
    const inbox = await getCharInbox(charId, now);
    return inbox.filter(l => l.status === 'delivered').length;
}

/** 拉所有待投递(给调度器) */
export async function getPendingForDelivery(now: number = Date.now()): Promise<MailboxLetter[]> {
    return (await DB.getPendingMailboxLetters(now)) as MailboxLetter[];
}

/** 把待投递标为已投递（给调度器调） */
export async function markDelivered(letterId: string): Promise<MailboxLetter | null> {
    const letter = await DB.getMailboxLetter(letterId);
    if (!letter) return null;
    letter.status = 'delivered';
    await DB.saveMailboxLetter(letter);
    return letter;
}

/** 删信（暮色主动删 / 角色回信后清理老信） */
export async function deleteLetter(letterId: string): Promise<void> {
    await DB.deleteMailboxLetter(letterId);
}
