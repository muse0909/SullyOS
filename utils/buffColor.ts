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
 */
export const pickColorByLabel = (label?: string): string => {
    const key = (label || '').trim();
    if (!key) return MACARON_COLORS[0];
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        // 31 是常见字符串哈希乘子
        hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    return MACARON_COLORS[hash % MACARON_COLORS.length];
};

/**
 * 取 buff 的颜色。优先级：
 *   1. buff.color 字段是有效 hex → 直接用（LLM 自由发挥）
 *   2. 否则用 label 哈希到马卡龙色盘
 */
export const getBuffColor = (buff: Pick<CharacterBuff, 'color' | 'label'>): string => {
    if (isValidHexColor(buff.color)) return buff.color;
    return pickColorByLabel(buff.label);
};
