// notebookStyles — 小纸条自定义样式管理
// 暮色 2026-07-22：多分组 + 写入时随机选图（方案 B）
//
// 数据结构（localStorage `sullyos_notebookStyles`）：
//   {
//     groups: { [groupName: string]: string[] },  // 分组名 → base64 / URL 列表
//     activeGroup: string | null,                  // 当前激活的分组（null = 用 type 默认样式）
//   }
//
// 写入时机：useChatAI 解析 [[PRIVATE_NOTE:...|type]] 时调 pickRandomStyleImage
//   - 读 localStorage → activeGroup 下的 urls → 随机选一张
//   - 存到 RoomNote.styleImageUrl
// 渲染时机：NotebookCard / FullNoteCard 看 note.styleImageUrl 决定走背景图还是 type 颜色

export const NOTEBOOK_STYLES_STORAGE_KEY = 'sullyos_notebookStyles';

export interface NotebookStyles {
    groups: Record<string, string[]>;
    activeGroup: string | null;
}

const EMPTY_STYLES: NotebookStyles = { groups: {}, activeGroup: null };

/** 安全读：解析失败 / quota / 缺字段都 fallback 空对象 */
export function getStoredNotebookStyles(): NotebookStyles {
    try {
        const raw = localStorage.getItem(NOTEBOOK_STYLES_STORAGE_KEY);
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
export function setStoredNotebookStyles(styles: NotebookStyles): void {
    try {
        localStorage.setItem(NOTEBOOK_STYLES_STORAGE_KEY, JSON.stringify(styles));
    } catch (e) {
        // quota 满时静默失败（不阻断 AI 写便签）
        console.warn('[notebookStyles] 存储失败:', e);
    }
}

/** 从激活组随机选一张图（无激活组 / 组空 → undefined 走 type 默认） */
export function pickRandomStyleImage(): string | undefined {
    const styles = getStoredNotebookStyles();
    if (!styles.activeGroup) return undefined;
    const urls = styles.groups[styles.activeGroup];
    if (!Array.isArray(urls) || urls.length === 0) return undefined;
    return urls[Math.floor(Math.random() * urls.length)];
}

/** 压缩图片到 1080px 宽 + JPEG 80%（保持 PNG alpha；用于自定义便签样式） */
export const compressImageForNote = (file: File): Promise<string> => {
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
                // 用户要求 PNG 优先 — 用 image/png 保持透明；如果原图是 jpg 才用 jpeg
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
