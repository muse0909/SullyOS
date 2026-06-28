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
