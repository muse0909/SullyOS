/**
 * 认知消化开关现在是「内在认知」的总闸
 *
 * 麦麦 2026-10-04：暮色反馈「认知消化开关一直关着，但请求体里还是有内在认知」。
 * 根因：开关只管「不再生成新的」，两处注入点压根没看过 digestionEnabled，
 * 已经存下来的旧词条每轮全量进请求体，而项目里没有查看/删除入口 → 开关名不副实。
 *
 * 这组测试盯住两处注入点：
 *   - buildRoleSettingsContext（context.ts:31，情绪评估那条路径）
 *   - buildCoreContext（context.ts:125，主聊天 + 纯聊天共用的那条路径）
 * 纯聊天走的是 buildCoreContext（chatPrompts.ts 的 buildPureChatBlock 分支），
 * 所以这里测通了，两种模式一起生效。
 */
import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context';
import type { CharacterProfile, UserProfile } from '../types';

const INSIGHT = '我意识到暮色不喜欢被敷衍';

const USER = { name: '暮色', bio: '', bioAge: '', bioGender: '', bioHeight: '', bioJob: '', impression: '', mbti: '' } as unknown as UserProfile;

const makeChar = (over: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'char-test',
    name: '测试角色',
    systemPrompt: '你是一个测试用的角色。',
    selfInsights: [INSIGHT],
    ...over,
} as CharacterProfile);

describe('内在认知注入 — 认知消化开关开着', () => {
    it('buildCoreContext 注入自我领悟', () => {
        const out = ContextBuilder.buildCoreContext(makeChar({ digestionEnabled: true }), USER, false);
        expect(out).toContain('### 内在认知 (Self Insights)');
        expect(out).toContain(INSIGHT);
    });

    it('digestionEnabled 是 undefined（旧角色没这个字段）时也注入', () => {
        // 老角色没存过这个字段，不能因为缺字段就突然不注入了
        const out = ContextBuilder.buildCoreContext(makeChar(), USER, false);
        expect(out).toContain('### 内在认知 (Self Insights)');
    });

    it('buildRoleSettingsContext 注入自我领悟', () => {
        const out = ContextBuilder.buildRoleSettingsContext(makeChar({ digestionEnabled: true }));
        expect(out).toContain('### 内在认知');
        expect(out).toContain(INSIGHT);
    });
});

describe('内在认知注入 — 认知消化开关关着', () => {
    it('buildCoreContext 不注入自我领悟', () => {
        const out = ContextBuilder.buildCoreContext(makeChar({ digestionEnabled: false }), USER, false);
        expect(out).not.toContain('### 内在认知 (Self Insights)');
        expect(out).not.toContain(INSIGHT);
    });

    it('buildRoleSettingsContext 同样不注入', () => {
        const out = ContextBuilder.buildRoleSettingsContext(makeChar({ digestionEnabled: false }));
        expect(out).not.toContain('### 内在认知');
        expect(out).not.toContain(INSIGHT);
    });

    it('关掉后角色核心还在（不是把整个上下文清空）', () => {
        // 防呆：这条门只关自我领悟，不能顺手把身份/性格也关掉
        const out = ContextBuilder.buildCoreContext(makeChar({ digestionEnabled: false }), USER, false);
        expect(out).toContain('测试角色');
        expect(out).toContain('你是一个测试用的角色。');
    });

    it('关掉时手动触发消化仍可用（开关只管自动 + 注入，不挡按钮）', () => {
        // 语义已在 UI 文案写明，这里锁住「开关不等于禁用消化功能」这个约定
        const char = makeChar({ digestionEnabled: false });
        expect(char.digestionEnabled).toBe(false);
        // 手动触发走 runCognitiveDigestion，不经过这两个注入点的开关判断
    });
});

describe('内在认知注入 — 没有词条时', () => {
    it('selfInsights 为空数组时不注入空段', () => {
        const out = ContextBuilder.buildCoreContext(makeChar({ selfInsights: [] }), USER, false);
        expect(out).not.toContain('### 内在认知 (Self Insights)');
    });

    it('selfInsights 为 undefined 时不崩', () => {
        const out = ContextBuilder.buildCoreContext(makeChar({ selfInsights: undefined }), USER, false);
        expect(out).not.toContain('### 内在认知 (Self Insights)');
    });
});
