
import React from 'react';
import { OSProvider } from './context/OSContext';
import { MusicProvider } from './context/MusicContext';
import PhoneShell from './components/PhoneShell';
import Amsg2DebugPanel from './components/Amsg2DebugPanel';
import { isIOSStandaloneWebApp } from './utils/iosStandalone';

const App: React.FC = () => {
  const useAbsoluteShell = typeof window !== 'undefined' && isIOSStandaloneWebApp();
  const shellClassName = useAbsoluteShell
    ? 'fixed inset-0 w-full h-full bg-transparent overflow-hidden'
    : 'relative w-full bg-transparent overflow-hidden';
  const shellStyle = useAbsoluteShell
    ? { height: 'var(--app-height, 100lvh)', minHeight: 'var(--app-height, 100lvh)' }
    : { height: 'var(--app-height, 100lvh)', minHeight: 'var(--app-height, 100lvh)' };

  // 暮色 2026-09-09：App 第一次 commit 后派发 sullyos:app-ready 事件
  //   index.html 里的 loading 监听这个事件后淡出
  //   时机：React 树至少渲染一帧（不必等 OSContext isDataLoaded——PhoneShell 内子组件还有自己的 loading）
  React.useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('sullyos:app-ready'));
    } catch {}
  }, []);

  return (
    <div
      className={shellClassName}
      style={shellStyle}
    >
      <div
        className={`${useAbsoluteShell ? 'absolute' : 'fixed'} inset-0 w-full h-full z-0 bg-transparent`}
        style={{ transform: 'translateZ(0)' }}
      >
        <OSProvider>
          <MusicProvider>
            <PhoneShell />
            {/* 麦麦 2026-09-15 同步上游：挂在 Provider 里能直接读 characters（省掉轮询 IndexedDB），
                面板自身用 portal 渲染到 body，绕开上面那层 transform 对 fixed 定位的影响。 */}
            <Amsg2DebugPanel />
          </MusicProvider>
        </OSProvider>
      </div>
    </div>
  );
};

export default App;
