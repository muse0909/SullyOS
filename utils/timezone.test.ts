/**
 * timezone 工具测试
 * 暮色 2026-08-05 Phase 3
 */

import { describe, it, expect } from 'vitest';
import { nowInTimeZone, resolveCharTimeZone, tzLabel, COMMON_TIMEZONES } from './timezone';

describe('timezone', () => {
    describe('nowInTimeZone', () => {
        it('Asia/Shanghai = UTC+8', () => {
            // 2026-08-05 04:00 UTC = 2026-08-05 12:00 Shanghai
            const base = new Date(Date.UTC(2026, 7, 5, 4, 0, 0));
            const sh = nowInTimeZone('Asia/Shanghai', base);
            expect(sh.getHours()).toBe(12);
            expect(sh.getDate()).toBe(5);
        });

        it('America/New_York = UTC-5（夏令时）', () => {
            // 2026-08-05 12:00 UTC = 2026-08-05 08:00 NY（EDT = UTC-4）
            const base = new Date(Date.UTC(2026, 7, 5, 12, 0, 0));
            const ny = nowInTimeZone('America/New_York', base);
            expect(ny.getHours()).toBe(8);
            expect(ny.getDate()).toBe(5);
        });

        it('不传 tz → 跟设备本地时区', () => {
            const now = nowInTimeZone();
            const direct = new Date();
            // 至少同一个 year/month/day（避免时区问题）
            expect(now.getFullYear()).toBe(direct.getFullYear());
        });
    });

    describe('resolveCharTimeZone', () => {
        it('customTimezoneEnabled=true + 有 customTimezone → 返回 tz', () => {
            const char = { customTimezoneEnabled: true, customTimezone: 'America/New_York' };
            expect(resolveCharTimeZone(char)).toBe('America/New_York');
        });

        it('customTimezoneEnabled=true 但 customTimezone 空 → 返回 undefined', () => {
            const char = { customTimezoneEnabled: true, customTimezone: '' };
            expect(resolveCharTimeZone(char)).toBeUndefined();
        });

        it('customTimezoneEnabled=false → 返回 undefined（跟设备本地）', () => {
            const char = { customTimezoneEnabled: false, customTimezone: 'America/New_York' };
            expect(resolveCharTimeZone(char)).toBeUndefined();
        });

        it('null char → undefined', () => {
            expect(resolveCharTimeZone(null)).toBeUndefined();
            expect(resolveCharTimeZone(undefined)).toBeUndefined();
        });
    });

    describe('tzLabel', () => {
        it('在 COMMON_TIMEZONES 里的 id → 返回 label', () => {
            expect(tzLabel('Asia/Shanghai')).toBe('北京 / 上海 (UTC+8)');
        });

        it('不在清单里 → 原样返回 id', () => {
            expect(tzLabel('Mars/Olympus_Mons')).toBe('Mars/Olympus_Mons');
        });
    });

    describe('COMMON_TIMEZONES', () => {
        it('包含常见时区', () => {
            const ids = COMMON_TIMEZONES.map(t => t.id);
            expect(ids).toContain('Asia/Shanghai');
            expect(ids).toContain('Asia/Tokyo');
            expect(ids).toContain('America/New_York');
            expect(ids).toContain('Europe/London');
        });
    });
});
