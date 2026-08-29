// keepAlivePluginDefinitions — KeepAlive Capacitor 插件 TypeScript 类型（2026-08-29）
//
// 暴露 start() / stop() 两个方法，控制 KeepAliveService（前台保活服务）的启停。
// MainActivity 8-27 已在 onCreate 自动启动服务，**前端默认不要调 start()**，
// 只在 appStateChange 切回前台时调一次确认服务还活着。

export interface KeepAlivePluginStartResult {
    /** 是否成功发出启动请求（不是服务真的在前台运行） */
    started: boolean;
}

export interface KeepAlivePluginStopResult {
    /** 是否成功发出停止请求 */
    stopped: boolean;
}

export interface KeepAlivePluginInterface {
    /**
     * 启动前台保活服务（幂等 — Android 不会因重复 startForegroundService 报错）
     * 内部走 startForegroundService（Android 8+）/ startService（老版本）
     */
    start(): Promise<KeepAlivePluginStartResult>;

    /**
     * 停止前台保活服务（会让 App 后台被系统杀的概率大增，谨慎用）
     */
    stop(): Promise<KeepAlivePluginStopResult>;
}
