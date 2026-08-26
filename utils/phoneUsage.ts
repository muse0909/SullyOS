// phoneUsage — 角色查手机 Capacitor 桥 + web fallback（2026-08-26）
// 暮色 2026-08-26 项目"角色查手机" P0 第 2 步
//
// 职责：
//   1. 在 Android 真机里调 Capacitor.Plugins.PhoneUsage.*（commit 1 写的原生插件）
//   2. web 端（macOS Chrome / 桌面）fallback 到 mock 数据 — 暮色能在 web 端测 LLM 调起链路
//
// 4 个数据方法 + 2 个权限方法：
//   - getCurrentApp()          当前前台 app
//   - getAppUsageToday()       今日各 app 时长（top 10）
//   - getTotalScreenTimeToday() 今日总屏幕时间 + 解锁次数
//   - getRecentApps({limit})   最近切换的 N 个 app
//   - checkPermission()        是否开了 PACKAGE_USAGE_STATS
//   - requestPermission()      跳"使用情况访问"设置页
//
// mock 模式说明：
//   - web 端 Capacitor.isNativePlatform() === false → 走 mock
//   - mock 数据设计成"看得出是 mock 提示"（appName 加 [Mock] 前缀）
//   - 暮色 web 测时 LLM 调起来会拿到 mock 数据，自然地说"你刚才在刷 Chrome 啊"之类
//   - 暮色 Android 真机跑时切到真 Capacitor 调用，拿到真实数据
//
// 格式化辅助 formatUsageForLLM：把数据转成自然语言（"今日用 Chrome 2h 30min"），LLM 拿来直接用
//   - 不用 LLM 自己算时间（"这个 minutes = 240 是几分钟？"）

import { Capacitor } from '@capacitor/core';

// ==================== 类型 ====================

export interface CurrentApp {
    packageName: string;
    appName: string;
    timestamp: number;
}

export interface AppUsage {
    appName: string;
    packageName: string;
    minutes: number;
}

export interface ScreenTimeToday {
    totalMinutes: number;
    unlockCount: number;
}

export interface RecentAppSwitch {
    appName: string;
    packageName: string;
    switchedAt: number;
}

// ==================== Capacitor 桥 ====================

interface PhoneUsagePlugin {
    getCurrentApp(): Promise<CurrentApp>;
    getAppUsageToday(): Promise<{ apps: AppUsage[] }>;
    getTotalScreenTimeToday(): Promise<ScreenTimeToday>;
    getRecentApps(opts: { limit: number }): Promise<{ apps: RecentAppSwitch[] }>;
    checkPermission(): Promise<{ granted: boolean }>;
    requestPermission(): Promise<void>;
}

const getPlugin = (): PhoneUsagePlugin | null => {
    try {
        const cap = (window as any).Capacitor;
        if (!cap || !cap.Plugins || !cap.Plugins.PhoneUsage) return null;
        return cap.Plugins.PhoneUsage as PhoneUsagePlugin;
    } catch {
        return null;
    }
};

const isNative = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

// ==================== Mock 数据（web 端 fallback）===================

const MOCK_TAG = '[Mock]';

const mockCurrentApp = (): CurrentApp => ({
    packageName: 'com.apple.Safari',
    appName: `${MOCK_TAG} Safari`,
    timestamp: Date.now(),
});

const mockAppUsageToday = (): { apps: AppUsage[] } => ({
    apps: [
        { appName: `${MOCK_TAG} 微信`, packageName: 'com.tencent.xinWeChat', minutes: 87 },
        { appName: `${MOCK_TAG} Chrome`, packageName: 'com.google.Chrome', minutes: 54 },
        { appName: `${MOCK_TAG} 抖音`, packageName: 'com.ss.android.ugc.aweme', minutes: 42 },
        { appName: `${MOCK_TAG} 小红书`, packageName: 'com.xingin.discover', minutes: 28 },
        { appName: `${MOCK_TAG} SullyOS`, packageName: 'com.aetheros.simulator', minutes: 19 },
    ],
});

const mockTotalScreenTimeToday = (): ScreenTimeToday => ({
    totalMinutes: 230,
    unlockCount: 12,
});

const mockRecentApps = (limit: number): { apps: RecentAppSwitch[] } => {
    const now = Date.now();
    const items: RecentAppSwitch[] = [
        { appName: `${MOCK_TAG} Safari`, packageName: 'com.apple.Safari', switchedAt: now - 60_000 },
        { appName: `${MOCK_TAG} 微信`, packageName: 'com.tencent.xinWeChat', switchedAt: now - 8 * 60_000 },
        { appName: `${MOCK_TAG} Chrome`, packageName: 'com.google.Chrome', switchedAt: now - 25 * 60_000 },
        { appName: `${MOCK_TAG} 抖音`, packageName: 'com.ss.android.ugc.aweme', switchedAt: now - 47 * 60_000 },
        { appName: `${MOCK_TAG} 小红书`, packageName: 'com.xingin.discover', switchedAt: now - 78 * 60_000 },
        { appName: `${MOCK_TAG} SullyOS`, packageName: 'com.aetheros.simulator', switchedAt: now - 110 * 60_000 },
    ];
    return { apps: items.slice(0, limit) };
};

// ==================== 公开 API（带 fallback）===================

export const phoneUsage = {
    /**
     * 当前前台 app
     * web 端返回 mock
     */
    async getCurrentApp(): Promise<CurrentApp> {
        if (!isNative()) return mockCurrentApp();
        const p = getPlugin();
        if (!p) return mockCurrentApp();
        return await p.getCurrentApp();
    },

    /**
     * 今日各 app 使用时长（top 10）
     */
    async getAppUsageToday(): Promise<{ apps: AppUsage[] }> {
        if (!isNative()) return mockAppUsageToday();
        const p = getPlugin();
        if (!p) return mockAppUsageToday();
        return await p.getAppUsageToday();
    },

    /**
     * 今日总屏幕时间 + 解锁次数
     */
    async getTotalScreenTimeToday(): Promise<ScreenTimeToday> {
        if (!isNative()) return mockTotalScreenTimeToday();
        const p = getPlugin();
        if (!p) return mockTotalScreenTimeToday();
        return await p.getTotalScreenTimeToday();
    },

    /**
     * 最近切换的 N 个 app
     */
    async getRecentApps(limit: number = 5): Promise<{ apps: RecentAppSwitch[] }> {
        if (!isNative()) return mockRecentApps(limit);
        const p = getPlugin();
        if (!p) return mockRecentApps(limit);
        return await p.getRecentApps({ limit });
    },

    /**
     * 权限：是否开了 PACKAGE_USAGE_STATS
     * web 端永远 true（mock 不需要权限）
     */
    async checkPermission(): Promise<{ granted: boolean }> {
        if (!isNative()) return { granted: true };
        const p = getPlugin();
        if (!p) return { granted: false };
        return await p.checkPermission();
    },

    /**
     * 权限：跳"使用情况访问"设置页
     * web 端什么都不做
     */
    async requestPermission(): Promise<void> {
        if (!isNative()) return;
        const p = getPlugin();
        if (!p) return;
        return await p.requestPermission();
    },
};

// ==================== LLM 友好的格式化 ====================

/**
 * 把数据转成自然语言描述
 * LLM 拿到这些字符串可以避免自己算时间
 *
 * 不用严格 JSON — LLM 工具调用要求 content 是 string（OpenAI 协议）
 * tool 消息 content 字段是字符串
 */
export const formatUsageForLLM = {
    currentApp: (data: CurrentApp): string => {
        const dt = new Date(data.timestamp);
        const hh = String(dt.getHours()).padStart(2, '0');
        const mm = String(dt.getMinutes()).padStart(2, '0');
        return `暮色当前在用 ${data.appName}（包名 ${data.packageName}），前台时间 ${hh}:${mm}`;
    },

    appUsageToday: (data: { apps: AppUsage[] }): string => {
        if (data.apps.length === 0) {
            return '今日各 app 使用时长：暂无数据（今天还没用过或系统未统计）';
        }
        const lines = data.apps.map((a, i) =>
            `${i + 1}. ${a.appName} — ${a.minutes} 分钟`
        );
        return `今日各 app 使用时长（按时长降序）：\n${lines.join('\n')}`;
    },

    screenTimeToday: (data: ScreenTimeToday): string => {
        const h = Math.floor(data.totalMinutes / 60);
        const m = data.totalMinutes % 60;
        const time = h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
        return `今日总屏幕时间：${time}，解锁 ${data.unlockCount} 次`;
    },

    recentApps: (data: { apps: RecentAppSwitch[] }): string => {
        if (data.apps.length === 0) {
            return '最近切换的 app：暂无数据';
        }
        const now = Date.now();
        const lines = data.apps.map(a => {
            const agoMin = Math.round((now - a.switchedAt) / 60_000);
            const ago = agoMin < 60 ? `${agoMin} 分钟前` : `${Math.floor(agoMin / 60)} 小时前`;
            return `- ${a.appName}（${ago}）`;
        });
        return `最近切换的 app（按时间倒序）：\n${lines.join('\n')}`;
    },
};
