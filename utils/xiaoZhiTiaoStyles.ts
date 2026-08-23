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

