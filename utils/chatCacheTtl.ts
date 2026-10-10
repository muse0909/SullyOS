/**
 * 聊天请求缓存时长设置（纯聊天模式专用）
 *
 * 麦麦 2026-10-04 暮色拍板：加个开关，默认 5 分钟，再给一档 1 小时。
 *
 * ── 为什么是 5m / 1h / 关闭 三档，而不是别的 ──
 * 这三档就是 Anthropic 官方 cache_control 支持的全部值，没有第四种。
 *
 * ── 为什么只给纯聊天模式用 ──
 * 暮色 2026-10-04 拍板："现在只给纯聊天开就行，完整的现在暂时不用这个"。
 * 原因不是随便定的，是纯聊天的 system 段真的稳定：
 *   纯聊天 = 身份 + 性格 + 内在认知 + 世界观 + 世界书 + 用户画像 + 记忆月度，
 *   全是静态文本，逐字不变 → 每轮都能命中同一段前缀。
 * 完整模式的 system 段里塞着日程时段（按当前时间算）、最近心声（带"X分钟前"时间戳）、
 * 朋友圈/日记/小程序这些每轮都在动的内容 → 前缀一变，后面全废，
 * 开缓存等于每轮白付一次写入费（5/M，是普通输入 4/M 的 1.25 倍）。
 * 所以完整模式那边由 useChatAI 侧硬门挡住，不是靠 UI 藏起来而已。
 *
 * ── 为什么默认 5 分钟（暮色明确选的）──
 * 站长说"5/1h 都能，酒馆打 1h 断点就行"，两个都支持。
 * 暮色选了默认 5m。注意：以暮色实际用法（一条消息十几分钟），
 * 5m 大概率每轮都超时 → 每轮全量重写，比 1h 贵约 2.7 倍。
 * 想要省钱自己切到 1h 档。这是他的选择，不是默认值出错。
 *
 * ── 必须实测的一件事 ──
 * 2026-07-18 那次 1 小时"生效过"是在 /v1/messages 端点上；
 * 同日 bc7034b9 记录：切到该端点 curl 验证，cache_creation / cache_read 始终是 0，
 * 站长当时也说"走 openai 接口不能加 claude 字段，会被 newapi 丢弃"。
 * 现在站长说可以打了，可能是他那边修了。**所以开这个开关之后必须实测一轮**，
 * 看中转站日志里"缓存读取"是不是非零。开完没生效就直接切"关闭"档。
 */

export type ChatCacheTtl = 'off' | '5m' | '1h';

export const CHAT_CACHE_TTL_STORAGE_KEY = 'sullyos_chatCacheTtl';

const VALID: ChatCacheTtl[] = ['off', '5m', '1h'];

/** 默认 5 分钟（暮色 2026-10-04 拍板） */
export const DEFAULT_CHAT_CACHE_TTL: ChatCacheTtl = '5m';

export function getChatCacheTtl(): ChatCacheTtl {
    try {
        const v = localStorage.getItem(CHAT_CACHE_TTL_STORAGE_KEY);
        if (v && (VALID as string[]).includes(v)) return v as ChatCacheTtl;
    } catch {
        /* localStorage 不可用（隐私模式）→ 落到默认 */
    }
    return DEFAULT_CHAT_CACHE_TTL;
}

export function setChatCacheTtl(ttl: ChatCacheTtl): void {
    try {
        localStorage.setItem(CHAT_CACHE_TTL_STORAGE_KEY, ttl);
    } catch {
        /* 存不进去就算了，本次会话内不持久 */
    }
}

const TTL_TO_EPHEMERAL: Record<Exclude<ChatCacheTtl, 'off'>, { type: 'ephemeral'; ttl: '5m' | '1h' }> = {
    '5m': { type: 'ephemeral', ttl: '5m' },
    '1h': { type: 'ephemeral', ttl: '1h' },
};

/**
 * 按设置产出要挂到 system 消息上的 cache_control 字段。
 * 'off' → 返回 null（调用方就不挂这个键，请求体跟现在一模一样）。
 *
 * 麦麦 2026-10-04：这里必须每次 new 一个新对象，不能直接吐 TTL_TO_EPHEMERAL 里的那一份。
 * 挂进请求体之后如果有任何一层顺手改了这个对象（比如加字段、delete），就会污染模块级常量表，
 * 后面每一轮都拿着一个被改坏的 cache_control 发出去。
 */
export function buildCacheControl(ttl: ChatCacheTtl): { type: 'ephemeral'; ttl: '5m' | '1h' } | null {
    if (ttl === 'off') return null;
    return { ...TTL_TO_EPHEMERAL[ttl] };
}
