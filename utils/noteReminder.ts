// noteReminder — 私密记事定时提醒（暮色 2026-07-17）
// 暮色方案：每天到点（用户在设置里配），下次聊天时 system prompt 多一段"提醒"
//   暮色原话："改成每天什么时间提醒一次，告诉角色你可以写日记，写朋友圈，写私密记事，
//             有没有想写下来的东西？如果有就写，没有就忽略。但是写这个需要带聊天记录"
// 实现：
//   - localStorage 存 sullyos_note_reminder_time（默认 21:00）
//   - localStorage 存 sullyos_note_reminder_last_date（今天是否已提醒过）
//   - 每天到点后第一次 useChatAI 流程触发，往 system prompt 拼 buildReminderText
//   - 用户可调时间（默认 21:00），存 localStorage

const STORAGE_TIME = 'sullyos_note_reminder_time';
const STORAGE_LAST_DATE = 'sullyos_note_reminder_last_date';
const DEFAULT_TIME = '21:00';

export const getReminderTime = (): string => {
    try {
        return localStorage.getItem(STORAGE_TIME) || DEFAULT_TIME;
    } catch {
        return DEFAULT_TIME;
    }
};

export const setReminderTime = (time: string): void => {
    try {
        localStorage.setItem(STORAGE_TIME, time);
    } catch (e) {
        console.warn('[noteReminder] 存时间失败:', e);
    }
};

const getLastDate = (): string => {
    try {
        return localStorage.getItem(STORAGE_LAST_DATE) || '';
    } catch {
        return '';
    }
};

const setLastDate = (date: string): void => {
    try {
        localStorage.setItem(STORAGE_LAST_DATE, date);
    } catch {
        // 静默失败
    }
};

const getToday = (): string => {
    // 用本地日期（不是 toISOString，避免时区问题）
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 检查今天是否到了提醒时间（且今天还没提醒过）
export const shouldShowReminder = (): boolean => {
    const today = getToday();
    if (getLastDate() === today) return false;  // 今天已提醒过

    const reminderTime = getReminderTime();
    const parts = reminderTime.split(':');
    if (parts.length !== 2) return false;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return false;
    const now = new Date();
    const reminderMinutes = h * 60 + m;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return nowMinutes >= reminderMinutes;
};

// 标记今天已提醒（调用方在拼完 reminderText 后立即调）
export const markReminderShown = (): void => {
    setLastDate(getToday());
};

// 构造提醒段落（拼到 system prompt 末尾）
// 暮色原话："告诉角色你可以写日记，写朋友圈，写私密记事，有没有想写下来的东西？
//            如果有就写，没有就忽略"
export const buildReminderText = (charName: string, userName: string): string => {
    const time = getReminderTime();
    return `\n\n【主动行为提醒 — 暮色 2026-07-17】
现在是 ${time}，${userName} 已经设置了你的"日常私密记事时间"。
回顾最近的聊天和你的内心状态（参考上面的"最近写过的私密记事"+"最近 innerState"列表），有没有想沉淀下来的东西？
- 想写一条给 ${userName} 的小纸条 → 用 \`[[PRIVATE_NOTE: 内容 | type]]\` 写一条（type: thought/doodle/search/lyric/gossip）
- 想发一条朋友圈分享 → 用 \`[[MOMENT_POST: 内容]]\` 发一条
- 没有特别想写的 → 忽略即可，不必每次都写。
（这是每天一次的提醒，今天已经触发过。再次触发是明天。）`;
};
