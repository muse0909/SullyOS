/**
 * 自我领悟词条的合并规则 + 开关总闸
 *
 * 麦麦 2026-10-04：暮色反馈「认知消化开关一直关着，但请求体里还是有内在认知」。
 * 根因是这个开关原本只管「不再生成新的」，已经存下来的旧词条照样每轮全量注入，
 * 而项目里根本没有查看/删除入口 → 关了开关也清不掉。
 * 修完：注入点跟生成点用同一个 digestionEnabled 判据 + 加 mergeSelfInsights 统一合并。
 */
import { describe, it, expect } from 'vitest';
import { mergeSelfInsights, SELF_INSIGHTS_LIMIT } from './digestion';

describe('mergeSelfInsights — 上限', () => {
    it('上限是 10 条', () => {
        expect(SELF_INSIGHTS_LIMIT).toBe(10);
    });

    it('没超上限时原样保留全部', () => {
        const existing = ['a', 'b'];
        expect(mergeSelfInsights(existing, ['c'])).toEqual(['a', 'b', 'c']);
    });

    it('正好 10 条不丢任何一条', () => {
        const existing = Array.from({ length: 9 }, (_, i) => `第${i}条`);
        const result = mergeSelfInsights(existing, ['新来的']);
        expect(result).toHaveLength(10);
        expect(result).toContain('新来的');
        expect(result).toContain('第0条');
    });

    it('超上限时从最旧的开始丢（FIFO），最新的留下', () => {
        const existing = Array.from({ length: 10 }, (_, i) => `第${i}条`);
        const result = mergeSelfInsights(existing, ['最新的']);
        expect(result).toHaveLength(10);
        expect(result).toContain('最新的');
        // 第 0 条是最旧的，被顶掉
        expect(result).not.toContain('第0条');
        expect(result).toContain('第1条');
    });

    it('一次来 5 条、原来已满 10 条，挤掉最旧的 5 条', () => {
        const existing = Array.from({ length: 10 }, (_, i) => `旧${i}`);
        const result = mergeSelfInsights(existing, ['n1', 'n2', 'n3', 'n4', 'n5']);
        expect(result).toHaveLength(10);
        // 旧的 0-4 被顶掉，5-9 留下 + 5 条新的
        expect(result).toEqual(['旧5', '旧6', '旧7', '旧8', '旧9', 'n1', 'n2', 'n3', 'n4', 'n5']);
    });

    it('existing 是 undefined 时也能工作', () => {
        expect(mergeSelfInsights(undefined, ['x'])).toEqual(['x']);
    });
});

describe('mergeSelfInsights — 去重', () => {
    it('完全相同的句子不重复占位', () => {
        const result = mergeSelfInsights(['悟到一件事'], ['悟到一件事']);
        expect(result).toEqual(['悟到一件事']);
    });

    it('前后空格不同但内容相同 → 视为重复', () => {
        const result = mergeSelfInsights(['悟到一件事'], ['  悟到一件事  ']);
        expect(result).toEqual(['悟到一件事']);
    });

    it('中间多个空格视为相同（比较时压缩空白）', () => {
        const result = mergeSelfInsights(['我很在意 他'], ['我很在意    他']);
        expect(result).toHaveLength(1);
    });

    it('不同内容正常共存', () => {
        const result = mergeSelfInsights(['第一条'], ['第二条']);
        expect(result).toEqual(['第一条', '第二条']);
    });

    it('去重发生在截断之前：重复项不占额度', () => {
        const existing = Array.from({ length: 10 }, (_, i) => `第${i}条`);
        // 全部重复已有内容 → 不该挤掉任何一条
        const result = mergeSelfInsights(existing, ['第0条', '第1条']);
        expect(result).toHaveLength(10);
        expect(result).toContain('第0条');
        expect(result).toContain('第9条');
    });

    it('空的和非字符串的项被丢弃', () => {
        const result = mergeSelfInsights(['ok'], ['  ', null as any, undefined as any, 123 as any, '好的']);
        expect(result).toEqual(['ok', '好的']);
    });

    it('首尾空白被裁掉后再存', () => {
        expect(mergeSelfInsights([], ['  有空白  '])).toEqual(['有空白']);
    });
});

describe('mergeSelfInsights — FIFO 顺序语义', () => {
    it('out[0] 始终是最旧的（这是丢 oldest 的前提）', () => {
        const result = mergeSelfInsights(['旧的'], ['新的']);
        expect(result[0]).toBe('旧的');
        expect(result[result.length - 1]).toBe('新的');
    });
});
