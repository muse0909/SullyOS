import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, CaretRight, Eye, EyeSlash, Gear, ImageSquare, X } from '@phosphor-icons/react';
import { safeResponseJson } from '../../utils/safeApi';
import type { ApiPreset } from '../../types';

const POS_KEY = 'sullyos_api_quickfloat_pos_v1';
const BALL_SIZE = 40;

type QuickModelTarget = 'main' | 'image' | 'vision';
type QuickPresetKind = 'main' | 'image' | 'vision';

const KEY_INPUT_CLASS = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-20 text-sm font-mono focus:bg-white focus:border-indigo-300 outline-none transition-all';

const VisibleKeyInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
}> = ({ label, value, onChange, placeholder, visible, onToggle }) => (
  <div>
    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">{label}</label>
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={KEY_INPUT_CLASS}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-2.5 rounded-lg text-slate-500 hover:bg-slate-100"
        title={visible ? '隐藏 Key' : '显示 Key'}
      >
        {visible ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
      </button>
    </div>
  </div>
);

const QuickSection: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, isOpen, onToggle, children }) => (
  <div className="mb-3">
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-4 py-4 bg-white/70 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm active:scale-[0.98] transition-all"
    >
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-slate-600 shrink-0">
        {icon}
      </div>
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-bold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-400 truncate">{subtitle}</div>
      </div>
      <CaretRight size={16} className={`text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
    </button>
    {isOpen ? <div className="mt-2 px-1">{children}</div> : null}
  </div>
);

const ApiQuickFloat: React.FC = () => {
  const {
    apiConfig,
    updateApiConfig,
    availableModels,
    setAvailableModels,
    apiPresets,
    removeApiPreset,
    addToast,
    isLocked,
    isDataLoaded,
  } = useOS();

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
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

  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localModel, setLocalModel] = useState(apiConfig.model);

  const [localImageUrl, setLocalImageUrl] = useState(apiConfig.imageBaseUrl || '');
  const [localImageKey, setLocalImageKey] = useState(apiConfig.imageApiKey || '');
  const [localImageModel, setLocalImageModel] = useState(apiConfig.imageModel || '');

  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionBaseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionModel || '');

  const [showMainKey, setShowMainKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  const [openSection, setOpenSection] = useState<QuickPresetKind | null>(null);

  const [showMainModelPicker, setShowMainModelPicker] = useState(false);
  const [showImageModelPicker, setShowImageModelPicker] = useState(false);
  const [showVisionModelPicker, setShowVisionModelPicker] = useState(false);

  const [mainModelFilter, setMainModelFilter] = useState('');
  const [imageModelFilter, setImageModelFilter] = useState('');
  const [visionModelFilter, setVisionModelFilter] = useState('');

  const [loadingTarget, setLoadingTarget] = useState<QuickModelTarget | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [imageStatusMsg, setImageStatusMsg] = useState('');
  const [visionStatusMsg, setVisionStatusMsg] = useState('');

  useEffect(() => {
    setLocalUrl(apiConfig.baseUrl);
    setLocalKey(apiConfig.apiKey);
    setLocalModel(apiConfig.model);
    setLocalImageUrl(apiConfig.imageBaseUrl || '');
    setLocalImageKey(apiConfig.imageApiKey || '');
    setLocalImageModel(apiConfig.imageModel || '');
    setLocalVisionUrl(apiConfig.visionBaseUrl || '');
    setLocalVisionKey(apiConfig.visionApiKey || '');
    setLocalVisionModel(apiConfig.visionModel || '');
  }, [
    apiConfig.baseUrl,
    apiConfig.apiKey,
    apiConfig.model,
    apiConfig.imageBaseUrl,
    apiConfig.imageApiKey,
    apiConfig.imageModel,
    apiConfig.visionBaseUrl,
    apiConfig.visionApiKey,
    apiConfig.visionModel,
  ]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos.x, by: pos.y, moved: false };
    setDragging(true);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true;
    const nextX = Math.max(4, Math.min(window.innerWidth - BALL_SIZE - 4, dragRef.current.bx + dx));
    const nextY = Math.max(4, Math.min(window.innerHeight - BALL_SIZE - 4, dragRef.current.by + dy));
    setPos({ x: nextX, y: nextY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (dragRef.current.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {}
    }
  };

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setOpenSection(null);
    setShowMainModelPicker(false);
    setShowImageModelPicker(false);
    setShowVisionModelPicker(false);
    setShowPanel(true);
  };

  const fetchModelsFor = async (
    target: QuickModelTarget,
    url: string,
    key: string,
    setMessage: (message: string) => void
  ) => {
    if (!url.trim()) {
      setMessage('请先填写 URL');
      return;
    }
    setLoadingTarget(target);
    setMessage('正在连接...');
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data = await safeResponseJson(response);
      const list = data.data || data.models || [];
      if (!Array.isArray(list)) {
        setMessage('格式不兼容');
        return;
      }
      const models = list.map((item: any) => item.id || item).filter(Boolean);
      setAvailableModels(models);
      if (target === 'main') {
        if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
        setShowImageModelPicker(false);
        setShowVisionModelPicker(false);
        setShowMainModelPicker(true);
      } else if (target === 'image') {
        if (models.length > 0 && !models.includes(localImageModel)) setLocalImageModel(models[0]);
        setShowMainModelPicker(false);
        setShowVisionModelPicker(false);
        setShowImageModelPicker(true);
      } else {
        if (models.length > 0 && !models.includes(localVisionModel)) setLocalVisionModel(models[0]);
        setShowMainModelPicker(false);
        setShowImageModelPicker(false);
        setShowVisionModelPicker(true);
      }
      setMessage(`获取到 ${models.length} 个模型`);
    } catch (error) {
      console.error(error);
      setMessage('连接失败');
    } finally {
      setLoadingTarget(null);
    }
  };

  const handleSaveAndClose = () => {
    updateApiConfig({
      ...apiConfig,
      baseUrl: localUrl,
      apiKey: localKey,
      model: localModel,
      imageBaseUrl: localImageUrl,
      imageApiKey: localImageKey,
      imageModel: localImageModel,
      visionBaseUrl: localVisionUrl,
      visionApiKey: localVisionKey,
      visionModel: localVisionModel,
    });
    addToast('API 配置已保存', 'success');
    setShowPanel(false);
  };

  const toggleSection = (section: QuickPresetKind) => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  const loadPreset = (preset: ApiPreset, kind: QuickPresetKind) => {
    if (kind === 'image') {
      setLocalImageUrl(preset.config.imageBaseUrl || preset.config.baseUrl || '');
      setLocalImageKey(preset.config.imageApiKey || preset.config.apiKey || '');
      setLocalImageModel(preset.config.imageModel || preset.config.model || '');
      addToast(`已加载生图预设: ${preset.name}`, 'info');
      return;
    }
    if (kind === 'vision') {
      setLocalVisionUrl(preset.config.visionBaseUrl || preset.config.baseUrl || '');
      setLocalVisionKey(preset.config.visionApiKey || preset.config.apiKey || '');
      setLocalVisionModel(preset.config.visionModel || preset.config.model || '');
      addToast(`已加载识图预设: ${preset.name}`, 'info');
      return;
    }
    setLocalUrl(preset.config.baseUrl || '');
    setLocalKey(preset.config.apiKey || '');
    setLocalModel(preset.config.model || '');
    addToast(`已加载 API 预设: ${preset.name}`, 'info');
  };

  const mainApiPresets = useMemo(
    () => apiPresets.filter((preset) => !preset.kind || preset.kind === 'main'),
    [apiPresets]
  );
  const imageApiPresets = useMemo(
    () => apiPresets.filter((preset) => !preset.kind || preset.kind === 'image'),
    [apiPresets]
  );
  const visionApiPresets = useMemo(
    () => apiPresets.filter((preset) => !preset.kind || preset.kind === 'vision'),
    [apiPresets]
  );

  const filteredMainModels = useMemo(() => {
    const query = mainModelFilter.trim().toLowerCase();
    return query ? availableModels.filter((model) => model.toLowerCase().includes(query)) : availableModels;
  }, [availableModels, mainModelFilter]);

  const filteredImageModels = useMemo(() => {
    const query = imageModelFilter.trim().toLowerCase();
    return query ? availableModels.filter((model) => model.toLowerCase().includes(query)) : availableModels;
  }, [availableModels, imageModelFilter]);

  const filteredVisionModels = useMemo(() => {
    const query = visionModelFilter.trim().toLowerCase();
    return query ? availableModels.filter((model) => model.toLowerCase().includes(query)) : availableModels;
  }, [availableModels, visionModelFilter]);

  const isPresetActive = (preset: ApiPreset, kind: QuickPresetKind) => {
    if (kind === 'image') {
      return (
        (preset.config.imageBaseUrl || preset.config.baseUrl || '') === localImageUrl &&
        (preset.config.imageApiKey || preset.config.apiKey || '') === localImageKey &&
        (preset.config.imageModel || preset.config.model || '') === localImageModel
      );
    }
    if (kind === 'vision') {
      return (
        (preset.config.visionBaseUrl || preset.config.baseUrl || '') === localVisionUrl &&
        (preset.config.visionApiKey || preset.config.apiKey || '') === localVisionKey &&
        (preset.config.visionModel || preset.config.model || '') === localVisionModel
      );
    }
    return (
      (preset.config.baseUrl || '') === localUrl &&
      (preset.config.apiKey || '') === localKey &&
      (preset.config.model || '') === localModel
    );
  };

  if (isLocked || !isDataLoaded) return null;

  return (
    <>
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

      {showPanel ? (
        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center" onClick={() => setShowPanel(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[80vh] overflow-hidden flex flex-col"
            style={{ animation: 'apiQuickFloatSlide 0.25s ease-out' }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
                  <Gear size={16} weight="bold" />
                </div>
                <h2 className="text-base font-bold text-slate-700">API 快捷切换</h2>
              </div>
              <button onClick={() => setShowPanel(false)} className="p-2 hover:bg-slate-100 rounded-full">
                <X size={18} className="text-slate-500" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              <QuickSection
                icon={<Gear size={18} weight="bold" />}
                title="API 设置"
                subtitle="主 AI 通道"
                isOpen={openSection === 'main'}
                onToggle={() => toggleSection('main')}
              >
                <section className="bg-emerald-50/80 rounded-3xl p-4 shadow-sm border border-emerald-100/80 space-y-4">
                  {mainApiPresets.length > 0 ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">我的预设</label>
                      <div className="flex gap-2 flex-wrap">
                        {mainApiPresets.map((preset) => {
                          const active = isPresetActive(preset, 'main');
                          return (
                            <div
                              key={preset.id}
                              className={`flex items-center border rounded-lg pl-3 pr-1 py-1 shadow-sm ${active ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}
                            >
                              <span
                                onClick={() => loadPreset(preset, 'main')}
                                className={`text-xs font-medium cursor-pointer mr-2 ${active ? 'text-emerald-600' : 'text-slate-600 hover:text-primary'}`}
                              >
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
                  ) : null}

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                    <input
                      type="text"
                      value={localUrl}
                      onChange={(e) => setLocalUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-indigo-300 outline-none transition-all"
                    />
                  </div>

                  <VisibleKeyInput
                    label="Key"
                    value={localKey}
                    onChange={setLocalKey}
                    placeholder="sk-..."
                    visible={showMainKey}
                    onToggle={() => setShowMainKey((value) => !value)}
                  />

                  <div>
                    <div className="flex justify-between items-center mb-1.5 pl-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                      <button
                        onClick={() => fetchModelsFor('main', localUrl, localKey, setStatusMsg)}
                        disabled={loadingTarget !== null}
                        className="text-[10px] text-primary font-bold flex items-center gap-1 disabled:opacity-50"
                      >
                        <ArrowsClockwise size={11} className={loadingTarget === 'main' ? 'animate-spin' : ''} />
                        {loadingTarget === 'main' ? '加载中...' : '刷新模型列表'}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setShowMainModelPicker((value) => !value);
                        setShowImageModelPicker(false);
                        setShowVisionModelPicker(false);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center gap-2 active:bg-white transition-all"
                    >
                      <span className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left" style={{ direction: 'rtl', textOverflow: 'ellipsis' }}>
                        <bdi style={{ direction: 'ltr' }}>{localModel || '点击选择...'}</bdi>
                      </span>
                      <CaretRight size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${showMainModelPicker ? 'rotate-90' : ''}`} />
                    </button>

                    {showMainModelPicker ? (
                      <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                        <input
                          type="text"
                          value={mainModelFilter}
                          onChange={(e) => setMainModelFilter(e.target.value)}
                          placeholder={`搜索 ${availableModels.length} 个模型...`}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs mb-2 outline-none"
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {filteredMainModels.length > 0 ? (
                            filteredMainModels.map((model) => (
                              <button
                                key={model}
                                onClick={() => {
                                  setLocalModel(model);
                                  setShowMainModelPicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono break-all ${model === localModel ? 'bg-primary/10 text-primary font-bold' : 'text-slate-600 hover:bg-white'}`}
                              >
                                {model}
                              </button>
                            ))
                          ) : (
                            <div className="text-center text-slate-400 py-4 text-xs">
                              {availableModels.length === 0 ? '点击右上角刷新模型列表获取' : `没有匹配 "${mainModelFilter}" 的模型`}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {statusMsg ? <div className="text-xs text-center text-slate-500">{statusMsg}</div> : null}
                </section>
              </QuickSection>

              <QuickSection
                icon={<ImageSquare size={18} weight="bold" />}
                title="生图"
                subtitle="独立生图通道"
                isOpen={openSection === 'image'}
                onToggle={() => toggleSection('image')}
              >
                <section className="bg-violet-50/80 rounded-3xl p-4 shadow-sm border border-violet-100/80 space-y-4">
                  {imageApiPresets.length > 0 ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">生图预设</label>
                      <div className="flex gap-2 flex-wrap">
                        {imageApiPresets.map((preset) => {
                          const active = isPresetActive(preset, 'image');
                          return (
                            <div
                              key={preset.id}
                              className={`flex items-center border rounded-lg pl-3 pr-1 py-1 shadow-sm ${active ? 'bg-violet-50 border-violet-200' : 'bg-white border-slate-200'}`}
                            >
                              <span
                                onClick={() => loadPreset(preset, 'image')}
                                className={`text-xs font-medium cursor-pointer mr-2 ${active ? 'text-violet-600' : 'text-slate-600 hover:text-violet-500'}`}
                              >
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
                  ) : null}

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                    <input
                      type="text"
                      value={localImageUrl}
                      onChange={(e) => setLocalImageUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-violet-300 outline-none transition-all"
                    />
                  </div>

                  <VisibleKeyInput
                    label="Key"
                    value={localImageKey}
                    onChange={setLocalImageKey}
                    placeholder="sk-..."
                    visible={showImageKey}
                    onToggle={() => setShowImageKey((value) => !value)}
                  />

                  <div>
                    <div className="flex justify-between items-center mb-1.5 pl-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                      <button
                        onClick={() => fetchModelsFor('image', localImageUrl, localImageKey, setImageStatusMsg)}
                        disabled={loadingTarget !== null}
                        className="text-[10px] text-violet-500 font-bold flex items-center gap-1 disabled:opacity-50"
                      >
                        <ArrowsClockwise size={11} className={loadingTarget === 'image' ? 'animate-spin' : ''} />
                        {loadingTarget === 'image' ? '加载中...' : '刷新模型列表'}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setShowImageModelPicker((value) => !value);
                        setShowMainModelPicker(false);
                        setShowVisionModelPicker(false);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center gap-2 active:bg-white transition-all"
                    >
                      <span className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left" style={{ direction: 'rtl', textOverflow: 'ellipsis' }}>
                        <bdi style={{ direction: 'ltr' }}>{localImageModel || '点击选择...'}</bdi>
                      </span>
                      <CaretRight size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${showImageModelPicker ? 'rotate-90' : ''}`} />
                    </button>

                    {showImageModelPicker ? (
                      <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                        <input
                          type="text"
                          value={imageModelFilter}
                          onChange={(e) => setImageModelFilter(e.target.value)}
                          placeholder={`搜索 ${availableModels.length} 个模型...`}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs mb-2 outline-none"
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {filteredImageModels.length > 0 ? (
                            filteredImageModels.map((model) => (
                              <button
                                key={model}
                                onClick={() => {
                                  setLocalImageModel(model);
                                  setShowImageModelPicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono break-all ${model === localImageModel ? 'bg-violet-100 text-violet-700 font-bold' : 'text-slate-600 hover:bg-white'}`}
                              >
                                {model}
                              </button>
                            ))
                          ) : (
                            <div className="text-center text-slate-400 py-4 text-xs">
                              {availableModels.length === 0 ? '点击右上角刷新模型列表获取' : `没有匹配 "${imageModelFilter}" 的模型`}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {imageStatusMsg ? <div className="text-xs text-center text-slate-500">{imageStatusMsg}</div> : null}
                </section>
              </QuickSection>

              <QuickSection
                icon={<Eye size={18} weight="bold" />}
                title="识图"
                subtitle="独立识图通道"
                isOpen={openSection === 'vision'}
                onToggle={() => toggleSection('vision')}
              >
                <section className="bg-sky-50/80 rounded-3xl p-4 shadow-sm border border-sky-100/80 space-y-4">
                  {visionApiPresets.length > 0 ? (
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">识图预设</label>
                      <div className="flex gap-2 flex-wrap">
                        {visionApiPresets.map((preset) => {
                          const active = isPresetActive(preset, 'vision');
                          return (
                            <div
                              key={preset.id}
                              className={`flex items-center border rounded-lg pl-3 pr-1 py-1 shadow-sm ${active ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}
                            >
                              <span
                                onClick={() => loadPreset(preset, 'vision')}
                                className={`text-xs font-medium cursor-pointer mr-2 ${active ? 'text-sky-600' : 'text-slate-600 hover:text-sky-500'}`}
                              >
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
                  ) : null}

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                    <input
                      type="text"
                      value={localVisionUrl}
                      onChange={(e) => setLocalVisionUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-sky-300 outline-none transition-all"
                    />
                  </div>

                  <VisibleKeyInput
                    label="Key"
                    value={localVisionKey}
                    onChange={setLocalVisionKey}
                    placeholder="sk-..."
                    visible={showVisionKey}
                    onToggle={() => setShowVisionKey((value) => !value)}
                  />

                  <div>
                    <div className="flex justify-between items-center mb-1.5 pl-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                      <button
                        onClick={() => fetchModelsFor('vision', localVisionUrl, localVisionKey, setVisionStatusMsg)}
                        disabled={loadingTarget !== null}
                        className="text-[10px] text-sky-500 font-bold flex items-center gap-1 disabled:opacity-50"
                      >
                        <ArrowsClockwise size={11} className={loadingTarget === 'vision' ? 'animate-spin' : ''} />
                        {loadingTarget === 'vision' ? '加载中...' : '刷新模型列表'}
                      </button>
                    </div>
                    <button
                      onClick={() => {
                        setShowVisionModelPicker((value) => !value);
                        setShowMainModelPicker(false);
                        setShowImageModelPicker(false);
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center gap-2 active:bg-white transition-all"
                    >
                      <span className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left" style={{ direction: 'rtl', textOverflow: 'ellipsis' }}>
                        <bdi style={{ direction: 'ltr' }}>{localVisionModel || '点击选择...'}</bdi>
                      </span>
                      <CaretRight size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${showVisionModelPicker ? 'rotate-90' : ''}`} />
                    </button>

                    {showVisionModelPicker ? (
                      <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                        <input
                          type="text"
                          value={visionModelFilter}
                          onChange={(e) => setVisionModelFilter(e.target.value)}
                          placeholder={`搜索 ${availableModels.length} 个模型...`}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs mb-2 outline-none"
                        />
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {filteredVisionModels.length > 0 ? (
                            filteredVisionModels.map((model) => (
                              <button
                                key={model}
                                onClick={() => {
                                  setLocalVisionModel(model);
                                  setShowVisionModelPicker(false);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono break-all ${model === localVisionModel ? 'bg-sky-100 text-sky-700 font-bold' : 'text-slate-600 hover:bg-white'}`}
                              >
                                {model}
                              </button>
                            ))
                          ) : (
                            <div className="text-center text-slate-400 py-4 text-xs">
                              {availableModels.length === 0 ? '点击右上角刷新模型列表获取' : `没有匹配 "${visionModelFilter}" 的模型`}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {visionStatusMsg ? <div className="text-xs text-center text-slate-500">{visionStatusMsg}</div> : null}
                </section>
              </QuickSection>
            </div>

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
      ) : null}
    </>
  );
};

export default ApiQuickFloat;
