import React from 'react';
import ReactDOM from 'react-dom/client';
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

// 暮色 2026-08-27：应用页面缩放（必须在首次 render 之前，React 挂载前 root 还是空的，不会闪）
applyPageZoom();

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
