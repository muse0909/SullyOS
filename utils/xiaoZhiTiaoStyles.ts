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
// 渲染时机：XiaoZhiTiaoCard / FullXiaoZhiTiaoCard 看 note.styleImageUrl 决定走背景图还是 type 颜色

export const XIAO_ZHI_TIAO_STYLES_STORAGE_KEY = 'sullyos_xiaoZhiTiaoStyles';

export interface XiaoZhiTiaoStyles {
    groups: Record<string, string[]>;
    activeGroup: string | null;
}

const EMPTY_STYLES: XiaoZhiTiaoStyles = { groups: {}, activeGroup: null };

/** 安全读：解析失败 / quota / 缺字段都 fallback 空对象 */
export function getStoredXiaoZhiTiaoStyles(): XiaoZhiTiaoStyles {
    try {
        const raw = localStorage.getItem(XIAO_ZHI_TIAO_STYLES_STORAGE_KEY);
        if (!raw) return { ...EMPTY_STYLES };
        const parsed = JSON.parse(raw);
        return {
            groups: (parsed?.groups && typeof parsed.groups === 'object') ? parsed.groups : {},
            activeGroup: typeof parsed?.activeGroup === 'string' ? parsed.activeGroup : null,
        };
    } catch {
        return { ...EMPTY_STYLES };
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

/** 从激活组随机选一张图 */
export function pickRandomXiaoZhiTiaoImage(): string | undefined {
    const styles = getStoredXiaoZhiTiaoStyles();
    if (!styles.activeGroup) return undefined;
    const urls = styles.groups[styles.activeGroup];
    if (!Array.isArray(urls) || urls.length === 0) return undefined;
    return urls[Math.floor(Math.random() * urls.length)];
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

