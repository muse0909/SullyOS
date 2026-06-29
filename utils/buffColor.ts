/**
 * 情绪 buff 配色工具
 *
 * 心声/buff 标签的颜色来源优先级：
 *   1. LLM 在 <emotion> 块里给的 color 字段（hex 字符串）
 *   2. buff.label 哈希到马卡龙色盘
 *
 * 这样既保留了"什么颜色都有"的随机感（LLM 自由发挥），
 * 又能在 LLM 忘了给/给了奇怪颜色时兜底到稳定好看的马卡龙色。
 */

import type { CharacterBuff } from '../types';

/** 马卡龙色盘——浅、柔、糖果感，覆盖暖/冷/中间色调 */
export const MACARON_COLORS: readonly string[] = [
    '#FFB5C5', // 粉红
    '#B5EAD7', // 薄荷绿
    '#C7CEEA', // 淡蓝紫
    '#FFDAC1', // 奶油橘
    '#FFF1B5', // 奶油黄
    '#E2C2FF', // 淡紫
    '#A8E6CF', // 淡绿
    '#FFB7B2', // 蜜桃粉
    '#B5D8FA', // 淡蓝
    '#FFE3A3', // 暖黄
    '#FCD5CE', // 浅珊瑚
    '#D4F0F0', // 浅青
];

/** 验证 hex 颜色字符串（#RGB / #RRGGBB） */
export const isValidHexColor = (s: unknown): s is string => {
    if (typeof s !== 'string') return false;
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
};

/**
 * 把 label 哈希到色盘。同一个 label 永远映射到同一个颜色，
 * 不同 label 之间尽量分散。
 *
 * 用 djb2 哈希（乘子 33），对中文 label 分散性比 31 乘子好得多
 * ——之前 31 乘子下"掩饰性忙碌/有点心虚/CPU过载中"三个 label
 * 全部撞到 #D4F0F0。
 */
export const pickColorByLabel = (label?: string): string => {
    const key = (label || '').trim();
    if (!key) return MACARON_COLORS[0];
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash * 33) + key.charCodeAt(i)) >>> 0;
    }
    return MACARON_COLORS[hash % MACARON_COLORS.length];
};

/**
 * 取 buff 的颜色。**永远走 label 哈希到马卡龙色盘**。
 *
 * 不读 buff.color 字段——之前 LLM 选色会偷懒直接照搬 prompt 示例，
 * 导致所有心声一个色。色盘哈希保证：同 label 同色（视觉一致），
 * 不同 label 分散到 12 色（视觉多样），可控可预期。
 */
export const getBuffColor = (buff: Pick<CharacterBuff, 'label'>): string => {
    return pickColorByLabel(buff.label);
};

/**
 * 把马卡龙浅色压成"同色系深色"，用于文字色（心声卡片正文）。
 *
 * 保持 hue/saturation，只调 lightness（HSL L 减 0.3）——保持同色系感。
 * 参考 SullyOS 现有"请选择日程风格"框样式：
 *   bg-amber-50 (浅底) + border-amber-200 (稍深边) + text-amber-700 (深字)
 * 那三个 amber 值就是同色系明度阶梯，我们这里用 HSL 算法动态算出来，
 * 避免 12 色都要手写一份映射表。
 *
 * @param hex 浅色（马卡龙色盘里的色）
 * @param amount 减多少 lightness，0.3 适合马卡龙浅色 → 中等深色
 * @returns 同色系深色 hex（最低不低于 L=0.15，避免变黑）
 */
export const darkenHex = (hex: string, amount: number = 0.3): string => {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);

    // RGB → HSL
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let hue = 0, sat = 0;
    if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) hue = (gn - bn) / d + (gn < bn ? 6 : 0);
        else if (max === gn) hue = (bn - rn) / d + 2;
        else hue = (rn - gn) / d + 4;
        hue /= 6;
    }

    const newL = Math.max(0.15, l - amount);
    // HSL → RGB
    let dr: number, dg: number, db: number;
    if (sat === 0) {
        dr = dg = db = newL;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = newL < 0.5 ? newL * (1 + sat) : newL + sat - newL * sat;
        const p = 2 * newL - q;
        dr = hue2rgb(p, q, hue + 1 / 3);
        dg = hue2rgb(p, q, hue);
        db = hue2rgb(p, q, hue - 1 / 3);
    }
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
};

/**
 * 把马卡龙色提亮成"同色系浅色"，用于心声卡片底色。
 *
 * 对称 darkenHex：只调 lightness（HSL L 加 amount），保持 hue/saturation，
 * 这样出来的浅色跟原色"同色系"而不是变成另一种色。
 *
 * 参考 SullyOS 现有"请选择日程风格"框的"奶油感"底色：
 *   bg-amber-50 (L≈0.97) / bg-violet-100 (L≈0.95) / bg-teal-100 (L≈0.94)
 * 起点是马卡龙色（典型 L≈0.83-0.90），加 0.4-0.5 后落在 L≈0.95-0.97。
 *
 * @param hex 浅色（马卡龙色盘里的色）
 * @param amount 加多少 lightness，0.4-0.5 适合马卡龙浅色 → 极浅底
 * @returns 同色系浅色 hex（最高不超 L=0.97，避免变白）
 */
export const lightenHex = (hex: string, amount: number = 0.4): string => {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);

    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let hue = 0, sat = 0;
    if (max !== min) {
        const d = max - min;
        sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) hue = (gn - bn) / d + (gn < bn ? 6 : 0);
        else if (max === gn) hue = (bn - rn) / d + 2;
        else hue = (rn - gn) / d + 4;
        hue /= 6;
    }

    const newL = Math.min(0.97, l + amount);
    let dr: number, dg: number, db: number;
    if (sat === 0) {
        dr = dg = db = newL;
    } else {
        const hue2rgb = (p: number, q: number, t: number) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = newL < 0.5 ? newL * (1 + sat) : newL + sat - newL * sat;
        const p = 2 * newL - q;
        dr = hue2rgb(p, q, hue + 1 / 3);
        dg = hue2rgb(p, q, hue);
        db = hue2rgb(p, q, hue - 1 / 3);
    }
    const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(dr)}${toHex(dg)}${toHex(db)}`;
};
