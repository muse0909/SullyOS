import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ActiveMsgRuntime } from './utils/activeMsgRuntime';
import { KeepAlive } from './utils/keepAlive';
import { ProactiveChat } from './utils/proactiveChat';
import { installIOSStandaloneWorkaround } from './utils/iosStandalone';
import { installWakeListener } from './utils/proactivePushConfig';
// 暮色 2026-07-21：挂 DB 到 window — console 一键 dedup 暴增的 memoryLinks（295555 条）
import { DB } from './utils/db';
(window as any).__SULLYOS_DB__ = DB;

// Register the keep-alive Service Worker early so it's ready before any AI calls
KeepAlive.init().then(() => {
  // Resume any active proactive schedule after SW is ready
  ProactiveChat.resume();
  void ActiveMsgRuntime.init();
  // Record every wake the SW reports so the diagnostic panel can show "last received".
  installWakeListener();
});

installIOSStandaloneWorkaround();

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
