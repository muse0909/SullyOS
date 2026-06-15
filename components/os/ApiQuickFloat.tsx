import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOS } from '../../context/OSContext';
import { Gear, X, ArrowsClockwise } from '@phosphor-icons/react';
import { safeResponseJson } from '../../utils/safeApi';

const POS_KEY = 'sullyos_api_quickfloat_pos_v1';
const BALL_SIZE = 40;

const ApiQuickFloat: React.FC = () => {
  const {
    apiConfig, updateApiConfig,
    availableModels, setAvailableModels,
    apiPresets, removeApiPreset,
    addToast, isLocked, isDataLoaded,
  } = useOS();

  // 悬浮球位置：默认右上，可拖动，存 localStorage
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.y === 'number') return p;
      }
    } catch {}
    if (typeof window !== 'undefined') {
      return { x: window.innerWidth - BALL_SIZE - 12, y: 80 };
    }
    return { x: 320, y: 80 };
  });

  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ sx: 0, sy: 0, bx: 0, by: 0, moved: false });

  const [showPanel, setShowPanel] = useState(false);

  // 编辑态
  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localModel, setLocalModel] = useState(apiConfig.model);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    setLocalUrl(apiConfig.baseUrl);
    setLocalKey(apiConfig.apiKey);
    setLocalModel(apiConfig.model);
  }, [apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model]);

  // 拖动逻辑（pointer events 同时兼容鼠标和触摸）
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y, moved: false };
    setDragging(true);
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    const nx = Math.max(4, Math.min(window.innerWidth - BALL_SIZE - 4, dragRef.current.bx + dx));
    const ny = Math.max(4, Math.min(window.innerHeight - BALL_SIZE - 4, dragRef.current.by + dy));
    setPos({ x: nx, y: ny });
  };

  const onPointerUp = (e: React.PointerEvent) => {
  if (!dragging) return;
  setDragging(false);
  try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  if (dragRef.current.moved) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch {}
  }
};

const onClick = (e: React.MouseEvent) => {
  e.stopPropagation();
  if (dragRef.current.moved) {
    dragRef.current.moved = false;
    return;
  }
  setShowPanel(true);
};


  // 刷新模型列表
  const fetchModels = async () => {
    if (!localUrl) { setStatusMsg('先填 URL'); return; }
    setIsLoadingModels(true);
    setStatusMsg('正在连接...');
    try {
      const baseUrl = localUrl.replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await safeResponseJson(res);
      const list = data.data || data.models || [];
      if (Array.isArray(list)) {
        const models = list.map((m: any) => m.id || m);
        setAvailableModels(models);
        if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
        setStatusMsg(`获取到 ${models.length} 个模型`);
        setShowModelPicker(true);
      } else {
        setStatusMsg('格式不兼容');
      }
    } catch {
      setStatusMsg('连接失败');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSaveAndClose = () => {
    updateApiConfig({
      ...apiConfig,
      baseUrl: localUrl,
      apiKey: localKey,
      model: localModel,
    });
    addToast('API 配置已保存', 'success');
    setShowPanel(false);
  };

  const loadPreset = (preset: typeof apiPresets[0]) => {
    setLocalUrl(preset.config.baseUrl);
    setLocalKey(preset.config.apiKey);
    setLocalModel(preset.config.model);
    addToast(`已加载: ${preset.name}`, 'info');
  };

  const filteredModels = useMemo(() => {
    const q = modelFilter.trim().toLowerCase();
    return q ? availableModels.filter(m => m.toLowerCase().includes(q)) : availableModels;
  }, [modelFilter, availableModels]);

  const mainApiPresets = useMemo(
    () => apiPresets.filter(preset => !preset.kind || preset.kind === 'main'),
    [apiPresets]
  );



  if (isLocked || !isDataLoaded) return null;

  return (
    <>
      {/* 悬浮球 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          width: BALL_SIZE,
          height: BALL_SIZE,
          touchAction: 'none',
          cursor: dragging ? 'grabbing' : 'grab',
        }}
      className="z-[100] rounded-full bg-white/90 backdrop-blur-md shadow-lg shadow-slate-300/50 border border-slate-200/60 flex items-center justify-center text-slate-600 active:scale-95 transition-transform select-none"

        title="API 快捷设置（可拖动）"
      >
        <Gear size={20} weight="bold" />
        
      </div>

      {/* 半屏 Modal */}
      {showPanel && (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center" onClick={() => setShowPanel(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            onClick={e => e.stopPropagation()}
            className="relative bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[80vh] overflow-hidden flex flex-col"
            style={{ animation: 'apiQuickFloatSlide 0.25s ease-out' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
                  <Gear size={16} weight="bold" />
                </div>
                <h2 className="text-base font-bold text-slate-700">API 快捷设置</h2>
              </div>
              <button onClick={() => setShowPanel(false)} className="p-2 hover:bg-slate-100 rounded-full">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* 预设区 */}
              {mainApiPresets.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">我的预设</label>
                  <div className="flex gap-2 flex-wrap">
                    {mainApiPresets.map(preset => {
                      const active = preset.config.baseUrl === apiConfig.baseUrl &&
                                     preset.config.apiKey === apiConfig.apiKey &&
                                     preset.config.model === apiConfig.model;
                      return (
                        <div key={preset.id} className={`flex items-center border rounded-lg pl-3 pr-1 py-1 shadow-sm ${active ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
                          <span onClick={() => loadPreset(preset)} className={`text-xs font-medium cursor-pointer mr-2 ${active ? 'text-emerald-600' : 'text-slate-600 hover:text-primary'}`}>
                            {preset.name}
                          </span>
                          <button onClick={() => removeApiPreset(preset.id)} className="p-1 rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                            <X size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* URL */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                <input
                  type="text"
                  value={localUrl}
                  onChange={e => setLocalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-indigo-300 outline-none transition-all"
                />
              </div>

              {/* Key */}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Key</label>
                <input
                  type="password"
                  value={localKey}
                  onChange={e => setLocalKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-indigo-300 outline-none transition-all"
                />
              </div>

              {/* Model */}
              <div>
                <div className="flex justify-between items-center mb-1.5 pl-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                  <button onClick={fetchModels} disabled={isLoadingModels} className="text-[10px] text-primary font-bold flex items-center gap-1 disabled:opacity-50">
                    <ArrowsClockwise size={11} className={isLoadingModels ? 'animate-spin' : ''} />
                    {isLoadingModels ? '加载中...' : '刷新模型列表'}
                  </button>
                </div>
                <button
                  onClick={() => setShowModelPicker(p => !p)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center gap-2 active:bg-white transition-all"
                >
                  <span className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left" style={{ direction: 'rtl', textOverflow: 'ellipsis' }}>
                    <bdi style={{ direction: 'ltr' }}>{localModel || '点击选择...'}</bdi>
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${showModelPicker ? 'rotate-180' : ''}`}>
                    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                  </svg>
                </button>

                {showModelPicker && availableModels.length > 0 && (
                  <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                    <input
                      type="text"
                      value={modelFilter}
                      onChange={e => setModelFilter(e.target.value)}
                      placeholder={`🔍 搜索 ${availableModels.length} 个模型...`}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs mb-2 outline-none"
                    />
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {filteredModels.length > 0 ? filteredModels.map(m => (
                        <button
                          key={m}
                          onClick={() => { setLocalModel(m); setShowModelPicker(false); }}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono break-all ${m === localModel ? 'bg-primary/10 text-primary font-bold' : 'text-slate-600 hover:bg-white'}`}
                        >
                          {m}
                        </button>
                      )) : (
                        <div className="text-center text-slate-400 py-4 text-xs">没有匹配 "{modelFilter}" 的模型</div>
                      )}
                    </div>
                  </div>
                )}
                {showModelPicker && availableModels.length === 0 && (
                  <div className="mt-2 text-center text-[11px] text-slate-400 py-2">点击右上角"刷新模型列表"获取</div>
                )}
              </div>

              {statusMsg && (
                <div className="text-xs text-center text-slate-500">{statusMsg}</div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 shrink-0">
              <button
                onClick={handleSaveAndClose}
                className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-indigo-200 bg-gradient-to-r from-indigo-500 to-purple-600 active:scale-95 transition-all"
              >
                保存并关闭
              </button>
            </div>
          </div>

          <style>{`
            @keyframes apiQuickFloatSlide {
              from { transform: translateY(100%); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </>
  );
};

export default ApiQuickFloat;
