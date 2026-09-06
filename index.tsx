import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as CapacitorApp } from '@capacitor/app';
import App from './App';
import { ActiveMsgRuntime } from './utils/activeMsgRuntime';
import { KeepAlive } from './utils/keepAlive';
import { ProactiveChat } from './utils/proactiveChat';
import { ProactiveDiary } from './utils/proactiveDiary';
import { installIOSStandaloneWorkaround } from './utils/iosStandalone';
import { installWakeListener } from './utils/proactivePushConfig';
// 暮色 2026-08-27：页面缩放（设置页 70%-130% 可调）— 启动时先于 React 渲染恢复，
//   避免首帧按 100% 渲染再跳变；实现见 utils/pageZoom.ts
import { applyPageZoom } from './utils/pageZoom';
// 暮色 2026-08-29 后台保活 P0 第一步：Capacitor 桥 + appStateChange 监听
//   切回前台时调 KeepAliveNative.start() 兜底重启 KeepAliveService
//   启动时不调 start() — MainActivity 8-27 已在 onCreate 直启过
import { KeepAlive as KeepAliveNative } from './utils/keepAlivePlugin';
// 暮色 2026-08-27 第二步：用户自定义聊天白框 CSS —— 启动加载
import { bootstrapUserCustomCss } from './utils/customCssPresets';
// 暮色 2026-07-21：挂 DB 到 window — console 一键 dedup 暴增的 memoryLinks（295555 条）
import { DB } from './utils/db';
(window as any).__SULLYOS_DB__ = DB;

// 麦麦 2026-09-06：APK 后台主动消息桥（混合方案）
//   背景：暮色 9-6 反馈"切到后台（不锁屏）到点仍要触发主动消息"，验收要"在后台生成有真实 AI 内容的通知"，
//   不允许走 D1 补拉路径。Worker 端没 chat history / 记忆宫殿 / 完整提示词，调 LLM 质量不可接受。
//   所以走混合方案：Worker 只发唤醒信号 → APK KeepAliveService 收 → 调 WebView JS 触发
//   → OSContext.runProactive 跑完整流程（LLM + 记忆宫殿 + 状态面板 + 聊天历史）
//   → 生成完后 JS 通过 Capacitor.Plugins.KeepAlive.notifyProactiveComplete 回传 Service
//   → Service 用真实 content 弹 Android 系统通知
//
//   挂载时机：必须在 OSContext 提供 'sullyos:bgProactiveTrigger' 监听之前挂上
//   现状：OSContext 的 useEffect 在 isDataLoaded=true 后才挂监听
//   风险：Service 在 isDataLoaded=true 之前就调 JS（理论上 isDataLoaded 启动期就是 false）
//   防御：window.__sullyosTriggerProactive 检查 listeners 数量，0 时记录 warn + 不派发
//   实际依赖：Service 调 JS 通常在 App 已稳定运行后（WS 已连、user 已交互），isDataLoaded 已 true
(function installBackgroundProactiveBridge() {
    try {
        const w = window as any;

        // 1. 挂全局触发函数（Service 调 WebView.evaluateJavascript("window.__sullyosTriggerProactive('char-xxx')")）
        w.__sullyosTriggerProactive = (charId: string) => {
            try {
                if (!charId || typeof charId !== 'string') {
                    console.warn('[BgProactive/JS] __sullyosTriggerProactive 收到空 charId, ignore');
                    return false;
                }
                // 检查 OSContext 是否已挂监听（isDataLoaded 之后才挂）
                // 用 CustomEvent 派发，多个 listener 都收
                const ev = new CustomEvent('sullyos:bgProactiveTrigger', { detail: { charId } });
                window.dispatchEvent(ev);
                console.log(`[BgProactive/JS] __sullyosTriggerProactive dispatched charId=${charId}`);
                return true;
            } catch (e) {
                console.error('[BgProactive/JS] __sullyosTriggerProactive 派发失败:', e);
                return false;
            }
        };

        // 2. 监听 'sullyos:bgProactiveReady' 事件（OSContext.runProactive 跑完后派发），回传 Service
        //    通过 Capacitor.Plugins.KeepAlive.notifyProactiveComplete 让 Service 弹真实通知
        //    只在原生平台调（web 端没有 Service 接）
        w.addEventListener('sullyos:bgProactiveReady', (e: Event) => {
            try {
                const detail = (e as CustomEvent).detail;
                if (!detail) return;
                const cap: any = w.Capacitor;
                const plugin = cap?.Plugins?.KeepAlive;
                if (!plugin || typeof plugin.notifyProactiveComplete !== 'function') {
                    // web 端 / 拿不到插件 → no-op
                    return;
                }
                const { charId, charName, body } = detail;
                if (!charId || !body) {
                    console.warn('[BgProactive/JS] bgProactiveReady 缺 charId/body, ignore');
                    return;
                }
                console.log(`[BgProactive/JS] bgProactiveReady 收到 → 调 Service notifyProactiveComplete: ${charName} (${body.length} chars)`);
                plugin.notifyProactiveComplete({
                    charId,
                    content: body,
                    messageId: '',
                    charName: charName || '',
                }).then((ret: any) => {
                    console.log(`[BgProactive/JS] notifyProactiveComplete resolved:`, ret);
                }).catch((err: any) => {
                    console.warn('[BgProactive/JS] notifyProactiveComplete 失败:', err);
                });
            } catch (e) {
                console.error('[BgProactive/JS] bgProactiveReady listener 炸了:', e);
            }
        });
    } catch (e) {
        console.error('[BgProactive/JS] 挂载失败:', e);
    }
})();

// 暮色 2026-08-13：挂 Memory Palace Trace 到 window — F12 console 一键跑只读 trace
//   用法：__mpTrace.listBoxes(charId) / traceRetrieve(opts) / traceBox(charId, boxId)
//   严格只读：不写 IDB、不改 scoring、不调 touchAccess / strengthenCoActivated
import './utils/memoryPalace/trace';

// Register the keep-alive Service Worker early so it's ready before any AI calls
KeepAlive.init().then(() => {
  // Resume any active proactive schedule after SW is ready
  ProactiveChat.resume();
  ProactiveDiary.resume();
  void ActiveMsgRuntime.init();
  // Record every wake the SW reports so the diagnostic panel can show "last received".
  installWakeListener();
});

installIOSStandaloneWorkaround();

// 暮色 2026-08-29 后台保活 P0 第一步：监听 App 前后台切换
//   切回前台时调 KeepAliveNative.start()（幂等）兜底重启 KeepAliveService
//   Web 端不触发此事件，Capacitor 插件在非原生平台也是 no-op
void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
  if (isActive) {
    void KeepAliveNative.start();
  }
});

// 暮色 2026-08-27：应用页面缩放（必须在首次 render 之前，React 挂载前 root 还是空的，不会闪）
applyPageZoom();

// 麦麦 2026-09-06：APK WebView 缓存根治（暮色 9-6 反馈反复部署看不到效果）
//   步骤：
//   1. 启动时清 ServiceWorker + Cache API（WebView 自己的缓存不受 server header 控制）
//   2. 检测 index.html 里 script src 的 hash，与 localStorage 比对，
//      不一致 → location.reload(true) 强制刷新 + 清 localStorage 旧 hash
//   3. 写入新 hash（首次访问）
//   4. 兜底：读 <meta name="sullyos-build-id"> 跟 localStorage 比对
//      meta 由 vite.config.ts 里的 sullyos-build-id 插件 transformIndexHtml 注入
//      每次 build 生成新 build id（ISO 时间戳到分钟），部署到 Vercel 后 APK 端 reload
//      修之前"两边都旧"bug：APK 端 WebView 缓存同时持旧 index.html + 旧 js，hash 检测失效
//   必须在所有 init 之前跑（先清缓存 → 触发 reload → 重新加载所有 chunk）
(function bootstrapCacheBustOnLaunch() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    try {
        // 1) 清 ServiceWorker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then((regs) => {
                regs.forEach((reg) => reg.unregister().catch(() => {}));
            }).catch(() => {});
        }
        // 2) 清 Cache API（fetch 缓存的 JS/CSS）
        if ('caches' in window) {
            caches.keys().then((keys) => {
                keys.forEach((k) => caches.delete(k).catch(() => {}));
            }).catch(() => {});
        }
        // 3) 读当前 index.html 引用的 js 文件 hash，跟 localStorage 比对
        const scripts = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
        const currentHash = scripts
            .map((s) => s.src)
            .find((src) => /\/assets\/.+\.[a-z0-9]{8,}\.js$/.test(src)) || '';
        const lastHash = localStorage.getItem('__sullyos_loaded_hash__') || '';
        // 4) 兜底：build id（vite.config.ts 插件往 index.html 注入 <meta name="sullyos-build-id">）
        const buildIdMeta = document.querySelector('meta[name="sullyos-build-id"]') as HTMLMetaElement | null;
        const currentBuildId = buildIdMeta?.getAttribute('content') || '';
        const lastBuildId = localStorage.getItem('__sullyos_build_id__') || '';

        let needReload = false;
        if (currentBuildId && lastBuildId && currentBuildId !== lastBuildId) {
            // build id 不一致 → 硬 reload（修"两边都旧"时 hash 检测不触发的 bug）
            needReload = true;
        } else if (currentHash && lastHash && currentHash !== lastHash) {
            needReload = true;
        }
        if (needReload) {
            try {
                if (currentBuildId) localStorage.setItem('__sullyos_build_id__', currentBuildId);
                if (currentHash) localStorage.setItem('__sullyos_loaded_hash__', currentHash);
            } catch {}
            // 用 location.replace 强制重载（replace 不留 history，prevent 手动回退到旧版）
            window.location.replace(window.location.href);
            return;
        }
        // 首次访问或无变化 → 写入
        if (currentBuildId) { try { localStorage.setItem('__sullyos_build_id__', currentBuildId); } catch {} }
        if (currentHash) { try { localStorage.setItem('__sullyos_loaded_hash__', currentHash); } catch {} }
    } catch (e) {
        console.warn('[cacheBust] bootstrap failed (non-fatal):', e);
    }
})();

// 暮色 2026-08-27 第二步 + 第三步：用户自定义聊天白框 CSS —— 启动时按 localStorage
//   custom_css_active 注入上次激活的预设到 <style id="user-custom-css">。
//   第三步把标签挂到 body 末尾（不是 head），原因见 utils/customCssPresets.syncUserCustomCssToDom。
//   bootstrapUserCustomCss 内部走 syncUserCustomCssToDom，自动 append 到 body 末尾。
(() => {
  if (typeof document === 'undefined') return;
  bootstrapUserCustomCss();
})();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
