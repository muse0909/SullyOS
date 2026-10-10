/**
 * 纯聊天缓存时长设置
 *
 * 麦麦 2026-10-04 暮色拍板：加个开关，默认 5 分钟，再加一档 1 小时。
 * 位置：API 快捷切换浮窗 → 主 AI 通道 → 协议 tab 下面。
 *
 * 这组测试盯三件容易出岔子的事：
 *  1. 默认是 5m（暮色明确选的，虽然按他用法 1h 更省）
 *  2. 'off' 产出的字段是 null —— 不是 {type:'ephemeral'}，更不能是 undefined 挂上去
 *  3. 脏值不能把设置搞坏（用户手改 localStorage / 旧版本残留）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getChatCacheTtl,
    setChatCacheTtl,
    buildCacheControl,
    DEFAULT_CHAT_CACHE_TTL,
    CHAT_CACHE_TTL_STORAGE_KEY,
} from './chatCacheTtl';

// vitest 默认环境是 node，没有 localStorage（跟 utils/chatPresenceStorage.test.ts 同一个路子）
const store = new Map<string, string>();
const localStorageMock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
};
vi.stubGlobal('localStorage', localStorageMock);

describe('缓存时长 —— 默认值', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('默认值是 5m（暮色 2026-10-04 拍板）', () => {
        expect(DEFAULT_CHAT_CACHE_TTL).toBe('5m');
        expect(getChatCacheTtl()).toBe('5m');
    });

    it('存了 1h 之后读回来还是 1h', () => {
        setChatCacheTtl('1h');
        expect(getChatCacheTtl()).toBe('1h');
    });

    it('存了 off 之后读回来还是 off（不是落回默认）', () => {
        setChatCacheTtl('off');
        expect(getChatCacheTtl()).toBe('off');
    });

    it('写的键名稳定', () => {
        setChatCacheTtl('1h');
        expect(localStorage.getItem(CHAT_CACHE_TTL_STORAGE_KEY)).toBe('1h');
    });
});

describe('缓存时长 —— 脏值不搞坏设置', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('非法值落回默认 5m', () => {
        localStorage.setItem(CHAT_CACHE_TTL_STORAGE_KEY, '30m');
        expect(getChatCacheTtl()).toBe('5m');
    });

    it('空串落回默认', () => {
        localStorage.setItem(CHAT_CACHE_TTL_STORAGE_KEY, '');
        expect(getChatCacheTtl()).toBe('5m');
    });

    it('大写 OFF 不认（大小写敏感）', () => {
        localStorage.setItem(CHAT_CACHE_TTL_STORAGE_KEY, 'OFF');
        expect(getChatCacheTtl()).toBe('5m');
    });
});

describe('buildCacheControl —— 产出要挂到 system 上的字段', () => {
    it("'off' 产出 null（调用方就不挂这个键）", () => {
        expect(buildCacheControl('off')).toBeNull();
    });

    it('off 不是 undefined 也不是空对象（防调用方漏判挂上去）', () => {
        const cc = buildCacheControl('off');
        expect(cc).not.toBeUndefined();
        expect(cc).toBeNull();
    });

    it("'5m' 产出 {type:'ephemeral', ttl:'5m'}", () => {
        expect(buildCacheControl('5m')).toEqual({ type: 'ephemeral', ttl: '5m' });
    });

    it("'1h' 产出 {type:'ephemeral', ttl:'1h'}", () => {
        expect(buildCacheControl('1h')).toEqual({ type: 'ephemeral', ttl: '1h' });
    });

    it('产出对象都是新对象（别让调用方改到常量表）', () => {
        const a = buildCacheControl('5m');
        const b = buildCacheControl('5m');
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });

    it('只有 ephemeral 里的 5m / 1h 是合法 ttl（Anthropic 官方就这两个值）', () => {
        expect(buildCacheControl('5m')?.ttl).toBe('5m');
        expect(buildCacheControl('1h')?.ttl).toBe('1h');
    });
});
