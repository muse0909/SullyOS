// mailboxScheduler — 信箱定时发送调度器（2026-08-25）
// 暮色 8-25 信箱方案：
//   - 暮色写信时若选"定时发送"，存 status='pending' + deliverAt=<未来时间戳>
//   - 调度器每 60 秒扫一次 mailbox_letters store，把 deliverAt<=now 的 pending 标为 delivered
//   - 跟 proactiveChat 用一个共享主循环，节省资源
//   - 失败静默（同 proactiveChat / 小纸条约定）
//
// 设计决策：
//   - 用 60 秒间隔（不是 30 秒）：信箱不像小纸条那么高频
//   - 跟小纸条的 checkAndDeliverTimedXiaoZhiTiaos 一样简化版："不主动调度，依赖 OSContext 启动时调一次 + 角色主动消息触发时再调一次"
//   - 但增加一个 setInterval 兜底（暮色长时间不聊也能投递）

import { getPendingForDelivery, markDelivered } from './mailboxStorage';

const MAILBOX_CHECK_INTERVAL = 60_000;   // 60 秒扫一次
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;

/** 扫描所有待投递信，到点变 delivered
 *  返回投递成功的数量
 */
export async function checkAndDeliverPendingMailbox(): Promise<number> {
    let delivered = 0;
    try {
        const now = Date.now();
        const pending = await getPendingForDelivery(now);
        for (const letter of pending) {
            await markDelivered(letter.id);
            delivered++;
            console.log(`📬 [Mailbox/Scheduler] 定时信已投递: id=${letter.id} title="${letter.title}"`);
        }
    } catch (e) {
        console.warn('📬 [Mailbox/Scheduler] 扫描失败:', e);
    }
    return delivered;
}

/** 启动主循环定时器（OSContext boot 时调一次） */
export function startMailboxScheduler(): void {
    if (mainThreadTimer) return;
    // 立即跑一次
    void checkAndDeliverPendingMailbox();
    // 然后每 60 秒
    mainThreadTimer = setInterval(() => {
        void checkAndDeliverPendingMailbox();
    }, MAILBOX_CHECK_INTERVAL);
    console.log('📬 [Mailbox/Scheduler] 启动（60s 间隔）');
}

/** 停止主循环定时器（OSContext unmount 时调，理论上不会触发，安全网） */
export function stopMailboxScheduler(): void {
    if (mainThreadTimer) {
        clearInterval(mainThreadTimer);
        mainThreadTimer = null;
        console.log('📬 [Mailbox/Scheduler] 停止');
    }
}
