// keepAlivePlugin — KeepAlive Capacitor 桥（2026-08-29）
//
// 暮色 8-29 后台保活第一步配套：把 MainActivity 里的 KeepAliveService 控制权
// 暴露给前端，让 index.tsx 能在 appStateChange 切回前台时确保服务还活着。
//
// 调用方式：
//   import { KeepAlive } from '../utils/keepAlivePlugin';
//   await KeepAlive.start();   // 幂等，可重入
//   await KeepAlive.stop();    // 谨慎，会让 App 容易被杀
//
// 行为：
//   - Android 真机：调 window.Capacitor.Plugins.KeepAlive.start/stop
//   - web 端 / iOS / Mac 浏览器：no-op（Capacitor.Plugins.KeepAlive 不存在）
//
// 注意：不要在启动时调 start()（MainActivity 8-27 已经直启了），
//   只在 appStateChange 监听里调。

import { Capacitor } from '@capacitor/core';
import type { KeepAlivePluginInterface } from './keepAlivePluginDefinitions';

const getNativePlugin = (): KeepAlivePluginInterface | null => {
    try {
        const cap = (window as any).Capacitor;
        if (!cap || !cap.Plugins || !cap.Plugins.KeepAlive) return null;
        return cap.Plugins.KeepAlive as KeepAlivePluginInterface;
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

export const KeepAlive = {
    /**
     * 启动前台保活服务（幂等）
     * web 端 / 拿不到原生插件时 no-op
     */
    async start(): Promise<void> {
        if (!isNative()) return;
        const p = getNativePlugin();
        if (!p) {
            console.warn('[KeepAlive] Capacitor.Plugins.KeepAlive 不可用，跳过');
            return;
        }
        try {
            await p.start();
        } catch (e) {
            console.warn('[KeepAlive] start() 失败：', e);
        }
    },

    /**
     * 停止前台保活服务
     * web 端 / 拿不到原生插件时 no-op
     */
    async stop(): Promise<void> {
        if (!isNative()) return;
        const p = getNativePlugin();
        if (!p) return;
        try {
            await p.stop();
        } catch (e) {
            console.warn('[KeepAlive] stop() 失败：', e);
        }
    },
};
