// xiaoZhiTiaoStyles — 小纸条自定义样式管理（2026-07-22：跟 notebookStyles 完全独立）
// 暮色原话："小纸条完全脱离小小窝 app" — 独立命名 + 独立 storage key + 独立 component 引用
//
// 数据结构（localStorage `sullyos_xiaoZhiTiaoStyles`）：
//   {
//     groups: { [groupName: string]: string[] },
//     activeGroup: string | null,
//   }
//
// 写入时机：useChatAI 解析 [[XIAO_ZHI_TIAO:...|type]] 时调 pickRandomXiaoZhiTiaoImage
//   - 读 localStorage → activeGroup 下的 urls → 随机选一张
//   - 存到 XiaoZhiTiao.styleImageUrl
// 渲染时机：XiaoZhiTiaoCard / FullXiaoZhiTiaoCard 看 note.styleImageUrl 决定走背景图还是纯白兜底
//
// 暮色 2026-08-23 v3：样式合并 — 加 8 套 cjjc 便签 CSS（激活组 = '系统便签' 时用）
//   暮色说"想要画多几个样式"，先搬过去 8 套，后续再细调

import {
    DEFAULT_XIAO_ZHI_TIAO_IMAGES,
    DEFAULT_XIAO_ZHI_TIAO_GROUP_NAME,
    BUILTIN_NOTE_GROUP_NAME,
} from './xiaoZhiTiaoDefaults';

export const XIAO_ZHI_TIAO_STYLES_STORAGE_KEY = 'sullyos_xiaoZhiTiaoStyles';

export interface XiaoZhiTiaoStyles {
    groups: Record<string, string[]>;
    activeGroup: string | null;
}

// 暮色 2026-08-23 v3：8 套 cjjc 便签 CSS（直接照搬 cjjc 的 WHISPER_NOTE_STYLES + 对应 CSS 类名）
// 暮色说"暂时先搬过去，但是这里有些我是不太喜欢的，等后面再细调"
// CSS 定义在 components/notes/NotebookBackground.tsx 末尾（暮色 8-23 后追加）
export const BUILTIN_NOTE_STYLES = [
    'note-lined',   // 横线
    'note-pink',    // 粉色便签
    'note-grid',    // 网格
    'note-kraft',   // 牛皮纸
    'note-blue',    // 蓝色
    'note-polka',   // 波点
    'note-white',   // 纯白
    'note-bread',   // 烤面包
] as const;

export type BuiltinNoteStyle = typeof BUILTIN_NOTE_STYLES[number];

// 暮色 2026-08-23 v3：轮换选样式（替代 cjjc 洗牌算法 — 暮色说"分组里轮换"）
//   激活组 = BUILTIN_NOTE_GROUP_NAME → 8 套 CSS 随机
//   激活组 = 其他（用户上传图组） → 走 pickRandomXiaoZhiTiaoImage
//   返回 { kind: 'css', className } 或 { kind: 'image', url } — caller 决定存哪个字段
export function pickNoteStyle(styles: XiaoZhiTiaoStyles):
    | { kind: 'css'; className: BuiltinNoteStyle }
    | { kind: 'image'; url: string }
    | null {
    if (!styles.activeGroup) return null;
    if (styles.activeGroup === BUILTIN_NOTE_GROUP_NAME) {
        const idx = Math.floor(Math.random() * BUILTIN_NOTE_STYLES.length);
        return { kind: 'css', className: BUILTIN_NOTE_STYLES[idx] };
    }
    const urls = styles.groups[styles.activeGroup];
    if (!Array.isArray(urls) || urls.length === 0) return null;
    return { kind: 'image', url: urls[Math.floor(Math.random() * urls.length)] };
}

// 暮色 2026-08-23 v3：保留老函数（向后兼容 — 老代码可能还在调）
/** 从激活组随机选一张图 */
export function pickRandomXiaoZhiTiaoImage(): string | undefined {
    const styles = getStoredXiaoZhiTiaoStyles();
    if (!styles.activeGroup) return undefined;
    const urls = styles.groups[styles.activeGroup];
    if (!Array.isArray(urls) || urls.length === 0) return undefined;
    return urls[Math.floor(Math.random() * urls.length)];
}

// 暮色 2026-08-23 v3：划线 sanitize — 只放行 <s> / </s> 标签，其他 < > 全 escape
// 用途：XiaoZhiTiaoCard / FullXiaoZhiTiaoCard 渲染 content 时过滤
// cjjc 直接用 innerHTML（XSS 风险），SullyOS 加这一层挡
export function sanitizeNoteHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')           // 先 escape &（避免重复）
        .replace(/</g, '&lt;')            // 再 escape <
        .replace(/>/g, '&gt;')            // 再 escape >
        .replace(/&lt;s&gt;/g, '<s>')     // 还原 s 标签
        .replace(/&lt;\/s&gt;/g, '</s>');  // 还原 /s 标签
}

// 暮色 2026-08-23 v3 反馈修复：老数据兼容
// 升级时间戳（v3 commit 1 时间 — 904029f3）
// 之前写的小纸条：
//   1. 没 revealedAt 字段 → 视作"已看"（否则老便签全显示"未拆封"）
//   2. 有 styleImageUrl（暮色 7-22 上传的"暮色手绘便签"图）→ 忽略，强制走新便签 CSS
//   理由：暮色 7-22 上传图是因为当时没 CSS 选项；现在有 8 套便签了
// 之后写的新便签走正常流程（revealedAt 字段 / 不忽略 styleImageUrl）
export const XIAO_ZHI_TIAO_V3_RELEASE_TS = new Date('2026-08-23T15:00:00+08:00').getTime();

export function isOldXiaoZhiTiao(note: { timestamp: number }): boolean {
    return note.timestamp < XIAO_ZHI_TIAO_V3_RELEASE_TS;
}

// 暮色 2026-08-23 反馈：老便签默认全一个样式不随机
//   按 note.id hash 从 8 套便签里选一套（稳定但不重复看起来一样）
//   新便签写时 pickNoteStyle 已经在 store 里随机（Math.random）— 真正随机
//   老便签是按 id hash 选（每张固定）— 不同便签看起不同
function hashStringToInt(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

export function pickFallbackBuiltinStyle(seed: string): string {
    const idx = hashStringToInt(seed) % BUILTIN_NOTE_STYLES.length;
    return BUILTIN_NOTE_STYLES[idx];
}

// 暮色 2026-08-23 v3：定时投递检查 — 主消息流触发时调用
//   读该角色所有隐藏 + isTimed 藏信，hiddenUntil <= now 的改成 visible + 写 DB + addToast
//   失败静默（同日记 / 主动消息约定）
//   调用时机：useChatAI 收 AI 回复时 + OSContext.runProactive 拿到 aiContent 时
//   简化版：不定 schedule，依赖主消息流触发 — 用户跟角色聊天时顺带触发
//   缺点：用户长时间不跟角色聊时，到期藏信不会自动推送
//   后续优化：加 schedule 触发（commit 后续）
export async function checkAndDeliverTimedXiaoZhiTiaos(
    charId: string,
    charName: string,
    addToast?: (msg: string, type?: 'success' | 'error' | 'info' | 'bell', duration?: number) => void
): Promise<number> {
    let delivered = 0;
    try {
        const all = await DB.getXiaoZhiTiaos(charId);
        const now = Date.now();
        for (const note of all) {
            if (note.visibility === 'hidden' && note.isTimed && note.hiddenUntil && note.hiddenUntil <= now) {
                note.visibility = 'visible';
                await DB.saveXiaoZhiTiao(note);
                delivered++;
                if (addToast) {
                    addToast(`${charName} 投递了一张小纸条`, 'bell', 3000);
                }
                console.log(`📝 [XiaoZhiTiao/Timed] ${charName} 投递定时小纸条: ${note.content.slice(0, 30)}...`);
            }
        }
    } catch (e) {
        console.warn('📝 [XiaoZhiTiao/Timed] 检查失败:', e);
    }
    return delivered;
}

const EMPTY_STYLES: XiaoZhiTiaoStyles = { groups: {}, activeGroup: null };

/** 安全读：解析失败 / quota / 缺字段都 fallback 空对象
 *  2026-07-22：暮色默认组（手绘便签）首次访问 / 老 user 没激活组时自动预置
 *  暮色 2026-08-23 v3：默认组改成 '系统便签'（8 套 CSS 轮换），'暮色手绘便签' 也预置作为可选 */
export function getStoredXiaoZhiTiaoStyles(): XiaoZhiTiaoStyles {
    try {
        const raw = localStorage.getItem(XIAO_ZHI_TIAO_STYLES_STORAGE_KEY);
        let stored: XiaoZhiTiaoStyles;
        if (!raw) {
            stored = { ...EMPTY_STYLES };
        } else {
            const parsed = JSON.parse(raw);
            stored = {
                groups: (parsed?.groups && typeof parsed.groups === 'object') ? parsed.groups : {},
                activeGroup: typeof parsed?.activeGroup === 'string' ? parsed.activeGroup : null,
            };
        }
        // 自动补两个默认组（系统便签是 8 套 CSS 空组 — 实际用 BUILTIN_NOTE_STYLES 轮换；暮色手绘便签是图组）
        if (!stored.groups[BUILTIN_NOTE_GROUP_NAME]) {
            stored.groups[BUILTIN_NOTE_GROUP_NAME] = [];  // CSS 组不需要存图
        }
        if (!stored.groups[DEFAULT_XIAO_ZHI_TIAO_GROUP_NAME]) {
            stored.groups[DEFAULT_XIAO_ZHI_TIAO_GROUP_NAME] = [...DEFAULT_XIAO_ZHI_TIAO_IMAGES];
        }
        if (!stored.activeGroup) {
            // 暮色 2026-08-23 v3：新默认走 8 套便签
            stored.activeGroup = BUILTIN_NOTE_GROUP_NAME;
        }
        return stored;
    } catch {
        // quota / parse fail：fallback 默认组
        return {
            groups: {
                [BUILTIN_NOTE_GROUP_NAME]: [],
                [DEFAULT_XIAO_ZHI_TIAO_GROUP_NAME]: [...DEFAULT_XIAO_ZHI_TIAO_IMAGES],
            },
            activeGroup: BUILTIN_NOTE_GROUP_NAME,
        };
    }
}

/** 写回（整体覆盖） */
export function setStoredXiaoZhiTiaoStyles(styles: XiaoZhiTiaoStyles): void {
    try {
        localStorage.setItem(XIAO_ZHI_TIAO_STYLES_STORAGE_KEY, JSON.stringify(styles));
    } catch (e) {
        console.warn('[xiaoZhiTiaoStyles] 存储失败:', e);
    }
}

/** 压缩图片到 1080px 宽（PNG 保留 alpha） */
export const compressImageForXiaoZhiTiao = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const maxW = 1080;
                const ratio = Math.min(1, maxW / img.width);
                const w = Math.round(img.width * ratio);
                const h = Math.round(img.height * ratio);
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('canvas 不可用'));
                ctx.drawImage(img, 0, 0, w, h);
                const isPng = file.type === 'image/png';
                resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', isPng ? undefined : 0.8));
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

