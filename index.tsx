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
        if (currentHash && lastHash && currentHash !== lastHash) {
            // hash 不一致 → 强制 reload（绕过 WebView 缓存）
            try {
                localStorage.setItem('__sullyos_loaded_hash__', currentHash);
            } catch {}
            // 用 location.replace 强制重载（replace 不留 history，prevent 手动回退到旧版）
            window.location.replace(window.location.href);
            return;
        }
        if (currentHash) {
            try { localStorage.setItem('__sullyos_loaded_hash__', currentHash); } catch {}
        }
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
