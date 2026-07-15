import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, CaretRight, Eye, EyeSlash, Gear, ImageSquare, WifiHigh, X } from '@phosphor-icons/react';
import { safeResponseJson } from '../../utils/safeApi';
import type { ApiPreset } from '../../types';

const POS_KEY = 'sullyos_api_quickfloat_pos_v1';
const BALL_SIZE = 40;
const PRESET_LONG_PRESS_MS = 550;

type QuickModelTarget = 'main' | 'image' | 'vision';
type QuickPresetKind = 'main' | 'image' | 'vision';

// ComfyUI checkpoint 短标签：暮色 2026-07-12 要求"留个缩写和风格就行，全文件名太长"
// 已知映射走短形式；未知 fallback 到去掉 .safetensors 截 16 字符
const checkpointLabel = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.includes('realistic')) return '📷 RV · 写实';
  if (lower.includes('pony')) return '🎨 Pony · 动漫';
  const base = filename.replace('.safetensors', '').replace(/[_-]+/g, ' ').trim();
  const short = base.length > 16 ? base.slice(0, 16) + '…' : base;
  return `📦 ${short}`;
};

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

const PresetChip: React.FC<{
  preset: ApiPreset;
  active?: boolean;
  activeClassName: string;
  idleClassName: string;
  textActiveClassName: string;
  textIdleClassName: string;
  onLoad: () => void;
  onRequestDelete: () => void;
}> = ({ preset, active = false, activeClassName, idleClassName, textActiveClassName, textIdleClassName, onLoad, onRequestDelete }) => {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const clearPress = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  };

  useEffect(() => () => clearPress(), []);

  return (
    <button
      type="button"
      title="点击加载，长按删除"
      onPointerDown={() => {
        clearPress();
        longPressedRef.current = false;
        setPressing(true);
        timerRef.current = window.setTimeout(() => {
          longPressedRef.current = true;
          setPressing(false);
          onRequestDelete();
        }, PRESET_LONG_PRESS_MS);
      }}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onClick={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onLoad();
      }}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium border shadow-sm transition-all ${active ? activeClassName : idleClassName} ${pressing ? 'scale-[0.98]' : ''} ${active ? textActiveClassName : textIdleClassName}`}
    >
      {preset.name}
    </button>
  );
};

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
  // 生图 provider 切换（3 档，删了 mcd）
  const [localImageGenProvider, setLocalImageGenProvider] = useState<'openai' | 'comfyui' | 'nai'>(
    apiConfig.imageGenProvider || 'openai'
  );
  // ComfyUI 测试连接状态
  const [comfyuiTestState, setComfyuiTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [comfyuiTestMsg, setComfyuiTestMsg] = useState('');
  const [comfyuiModelList, setComfyuiModelList] = useState<string[]>([]);
  // 暮色 2026-07-04 要求：checkpoint 列表可手动选哪个
  const [localComfyuiSelectedModel, setLocalComfyuiSelectedModel] = useState<string>('');

  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionBaseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionModel || '');

  const [showMainKey, setShowMainKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);

  const [openSection, setOpenSection] = useState<QuickPresetKind>('main');

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
  const [presetPendingDelete, setPresetPendingDelete] = useState<ApiPreset | null>(null);

  useEffect(() => {
    setLocalUrl(apiConfig.baseUrl);
    setLocalKey(apiConfig.apiKey);
    setLocalModel(apiConfig.model);
    setLocalImageUrl(apiConfig.imageBaseUrl || '');
    setLocalImageKey(apiConfig.imageApiKey || '');
    setLocalImageModel(apiConfig.imageModel || '');
    setLocalImageGenProvider(apiConfig.imageGenProvider || 'openai');
    // 暮色 2026-07-12 bug 修复：ApiQuickFloat 之前不从此处初始化，弹窗打开时
    // localComfyuiSelectedModel 永远为空 → 保存时被 fallback 静默覆盖成列表第 0 个
    setLocalComfyuiSelectedModel(apiConfig.imageModel || '');
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
    apiConfig.imageGenProvider,
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
    // 不重置 openSection：保留用户上次选择，关闭再开还是同一个 section 展开
    // （之前 setOpenSection(null) 会强制全部折叠，造成"折叠→展开"的视觉跳变）
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

  // ComfyUI 写死常量（与 Settings.tsx 同步）— model 由用户在 UI 上选
  const COMFYUI_FIXED_URL = 'http://127.0.0.1:8190/v1';
  const COMFYUI_FIXED_KEY = 'comfyui-local-bridge';

  // 测试 ComfyUI 连接
  const testComfyuiConnection = async () => {
    setComfyuiTestState('testing');
    setComfyuiTestMsg('正在连接...');
    try {
      const response = await fetch(`${COMFYUI_FIXED_URL}/models`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${COMFYUI_FIXED_KEY}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await safeResponseJson(response);
      const list = data.data || data.models || [];
      const modelIds: string[] = (Array.isArray(list) ? list : []).map((m: any) => m.id || m).filter(Boolean);
      setComfyuiModelList(modelIds);
      setComfyuiTestState('ok');
      setComfyuiTestMsg(`在线 · ${modelIds.length} 个 checkpoint`);
    } catch (e: any) {
      setComfyuiTestState('fail');
      setComfyuiTestMsg(`连接失败：${e?.message || '未知错误'}`);
      setComfyuiModelList([]);
    }
  };

  const handleSaveAndClose = () => {
    // 暮色 2026-07-03 要求"在哪个 provider 页面保存就用哪个"
    // ComfyUI 页面：写死常量 + 用户选的 checkpoint model
    // OpenAI / NAI 页面：用 localImageUrl/Key/Model 字段值
    // 暮色 2026-07-12 防御性：删 comfyuiModelList[0] fallback，没选过 model 不让走 ComfyUI
    const imageConfig = localImageGenProvider === 'comfyui'
      ? {
          imageBaseUrl: COMFYUI_FIXED_URL,
          imageApiKey: COMFYUI_FIXED_KEY,
          imageModel: localComfyuiSelectedModel,
        }
      : {
          imageBaseUrl: localImageUrl,
          imageApiKey: localImageKey,
          imageModel: localImageModel,
        };
    updateApiConfig({
      ...apiConfig,
      baseUrl: localUrl,
      apiKey: localKey,
      model: localModel,
      ...imageConfig,
      imageGenProvider: localImageGenProvider,
      visionBaseUrl: localVisionUrl,
      visionApiKey: localVisionKey,
      visionModel: localVisionModel,
    });
    addToast(
      localImageGenProvider === 'comfyui'
        ? `ComfyUI 本地已启用 · ${imageConfig.imageModel ? checkpointLabel(imageConfig.imageModel) : '未选 checkpoint'}`
      : localImageGenProvider === 'nai' ? 'NAI 已启用（占位）'
      : 'API 配置已保存',
      'success'
    );
    setShowPanel(false);
  };

  // 暮色 2026-07-12：ComfyUI 模式下，没选 model 或没拿到 checkpoint 列表 → 不让保存
  // 防御性，避免再次出现'以为选了 RV 实际存了 Pony'的事故
  const comfyuiCanSave = localImageGenProvider !== 'comfyui'
    || (comfyuiTestState === 'ok' && localComfyuiSelectedModel !== '' && comfyuiModelList.includes(localComfyuiSelectedModel));

  const toggleSection = (section: QuickPresetKind) => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  const loadPreset = (preset: ApiPreset, kind: QuickPresetKind) => {
    const c = preset.config;
    if (kind === 'image') {
      setLocalImageUrl(c.imageBaseUrl || '');
      setLocalImageKey(c.imageApiKey || '');
      setLocalImageModel(c.imageModel || '');
      setLocalImageGenProvider(c.imageGenProvider || 'openai');
      addToast(`已加载生图预设: ${preset.name}`, 'info');
      return;
    }
    if (kind === 'vision') {
      setLocalVisionUrl(c.visionBaseUrl || '');
      setLocalVisionKey(c.visionApiKey || '');
      setLocalVisionModel(c.visionModel || '');
      addToast(`已加载识图预设: ${preset.name}`, 'info');
      return;
    }
    setLocalUrl(c.baseUrl || '');
    setLocalKey(c.apiKey || '');
    setLocalModel(c.model || '');
    addToast(`已加载 API 预设: ${preset.name}`, 'info');
  };

  const mainApiPresets = useMemo(
    () => apiPresets.filter((preset) => preset.kind === 'main'),
    [apiPresets]
  );
  const imageApiPresets = useMemo(
    () => apiPresets.filter((preset) => preset.kind === 'image'),
    [apiPresets]
  );
  const visionApiPresets = useMemo(
    () => apiPresets.filter((preset) => preset.kind === 'vision'),
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
        (preset.config.imageBaseUrl || '') === localImageUrl &&
        (preset.config.imageApiKey || '') === localImageKey &&
        (preset.config.imageModel || '') === localImageModel
      );
    }
    if (kind === 'vision') {
      return (
        (preset.config.visionBaseUrl || '') === localVisionUrl &&
        (preset.config.visionApiKey || '') === localVisionKey &&
        (preset.config.visionModel || '') === localVisionModel
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
        <WifiHigh size={20} weight="bold" />
      </div>

      {showPanel ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-fade-in" onClick={() => setShowPanel(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl border border-white/20 overflow-hidden animate-slide-up max-h-[80vh] flex flex-col"
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

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
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
                            <PresetChip
                              key={preset.id}
                              preset={preset}
                              active={active}
                              activeClassName="bg-emerald-50 border-emerald-200"
                              idleClassName="bg-white border-slate-200"
                              textActiveClassName="text-emerald-600"
                              textIdleClassName="text-slate-600 hover:text-primary"
                              onLoad={() => loadPreset(preset, 'main')}
                              onRequestDelete={() => setPresetPendingDelete(preset)}
                            />
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
                subtitle="OpenAI / ComfyUI 本地"
                isOpen={openSection === 'image'}
                onToggle={() => toggleSection('image')}
              >
                <section className="bg-violet-50/80 rounded-3xl p-4 shadow-sm border border-violet-100/80 space-y-4">
                  {/* 顶部：当前使用状态条（暮色 2026-07-03 要求"保存即用"） */}
                  <div className="rounded-2xl bg-gradient-to-r from-violet-50 via-purple-50 to-fuchsia-50 border border-purple-200/60 px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">🎨</span>
                      <span className="text-[10px] text-slate-500">当前使用：</span>
                      <span className="text-[11px] font-bold text-purple-700 truncate">
                        {apiConfig.imageGenProvider === 'comfyui' ? 'ComfyUI 本地' : apiConfig.imageGenProvider === 'nai' ? 'NAI（占位未生效）' : 'OpenAI 兼容'}
                      </span>
                    </div>
                    {/* 暮色 2026-07-12：之前是硬编码"默认 RV"，误导。现在动态显示真实选中（短标签） */}
                    {apiConfig.imageGenProvider === 'comfyui' && (
                      <span className="text-[10px] text-slate-500 font-medium shrink-0">
                        {apiConfig.imageModel ? checkpointLabel(apiConfig.imageModel) : '未选 checkpoint'}
                      </span>
                    )}
                    {apiConfig.imageGenProvider === 'openai' && apiConfig.imageModel && (
                      <span className="text-[9px] text-slate-400 font-mono truncate max-w-[120px]">{apiConfig.imageModel}</span>
                    )}
                  </div>
                  {/* 生图 provider 切换（3 档，删 mcd） */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">服务商</label>
                    <div className="flex bg-white border border-slate-200 rounded-xl p-1 gap-1">
                      <button type="button" onClick={() => setLocalImageGenProvider('openai')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${localImageGenProvider === 'openai' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>OpenAI</button>
                      <button type="button" onClick={() => setLocalImageGenProvider('comfyui')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${localImageGenProvider === 'comfyui' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>ComfyUI</button>
                      <button type="button" onClick={() => setLocalImageGenProvider('nai')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${localImageGenProvider === 'nai' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>NAI</button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5 pl-1 leading-relaxed">
                      选哪个页面保存就用哪个（保存即用）
                    </p>
                  </div>

                  {/* === OpenAI 卡片 === */}
                  {localImageGenProvider === 'openai' && (
                    <>
                      {imageApiPresets.length > 0 ? (
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">生图预设</label>
                          <div className="flex gap-2 flex-wrap">
                            {imageApiPresets.map((preset) => {
                              const active = isPresetActive(preset, 'image');
                              return (
                                <PresetChip
                                  key={preset.id}
                                  preset={preset}
                                  active={active}
                                  activeClassName="bg-violet-50 border-violet-200"
                                  idleClassName="bg-white border-slate-200"
                                  textActiveClassName="text-violet-600"
                                  textIdleClassName="text-slate-600 hover:text-violet-500"
                                  onLoad={() => loadPreset(preset, 'image')}
                                  onRequestDelete={() => setPresetPendingDelete(preset)}
                                />
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
                    </>
                  )}

                  {/* === ComfyUI 卡片（暮色 2026-07-03 简化） === */}
                  {localImageGenProvider === 'comfyui' && (
                    <>
                      <div className={`rounded-2xl border px-3 py-2.5 ${comfyuiTestState === 'ok' ? 'bg-emerald-50/50 border-emerald-200' : comfyuiTestState === 'fail' ? 'bg-rose-50/50 border-rose-200' : 'bg-slate-50/50 border-slate-200'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[11px] font-bold ${comfyuiTestState === 'ok' ? 'text-emerald-700' : comfyuiTestState === 'fail' ? 'text-rose-700' : 'text-slate-500'}`}>
                            {comfyuiTestState === 'ok' ? '✓ 在线' : comfyuiTestState === 'fail' ? '✗ 离线' : comfyuiTestState === 'testing' ? '⏳ 测试中...' : '○ 未测试'}
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">127.0.0.1:8190</span>
                        </div>
                        {comfyuiTestMsg && <p className="text-[10px] text-slate-500">{comfyuiTestMsg}</p>}
                        {comfyuiModelList.length > 0 && (
                          <div className="mt-1.5 flex flex-col gap-1">
                            {comfyuiModelList.map(m => {
                              // 暮色 2026-07-12 防御性：不再 fallback 到 comfyuiModelList[0]，
                              // 否则列表会自动高亮第一个，用户以为选过了实际没选
                              const isSelected = localComfyuiSelectedModel === m;
                              return (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => setLocalComfyuiSelectedModel(m)}
                                  className={`w-full text-left px-2 py-1.5 rounded-lg text-[10px] flex items-center gap-2 transition-all ${isSelected ? 'bg-emerald-200/70 border border-emerald-400 text-emerald-800 font-bold' : 'bg-white border border-slate-200 text-slate-600'}`}
                                >
                                  <span className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 ${isSelected ? 'border-emerald-600 bg-emerald-500' : 'border-slate-300'}`} />
                                  {/* 暮色 2026-07-12：全文件名太长，改短标签（缩写+风格） */}
                                  <span className="truncate">{checkpointLabel(m)}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={testComfyuiConnection}
                        disabled={comfyuiTestState === 'testing'}
                        className="w-full py-2.5 rounded-2xl font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 active:scale-95 transition-all disabled:opacity-50 text-sm"
                      >
                        {comfyuiTestState === 'testing' ? '测试中...' : '测试连接'}
                      </button>
                      <p className="text-[10px] text-slate-400 leading-relaxed pl-1">
                        点底部"保存"启用 ComfyUI。{localComfyuiSelectedModel ? `当前选：${checkpointLabel(localComfyuiSelectedModel)}` : '点上面 checkpoint 选一个'}。
                      </p>
                    </>
                  )}

                  {/* === NAI 卡片（占位） === */}
                  {localImageGenProvider === 'nai' && (
                    <div className="rounded-2xl bg-amber-50/80 border border-amber-200/50 px-3 py-2.5">
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        <span className="font-semibold text-amber-700">NAI</span> 占位中。NovelAI 也提供 OpenAI 兼容 API，<span className="font-semibold">切到 OpenAI 页填 NAI 的 URL 即可</span>。
                      </p>
                    </div>
                  )}

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
                            <PresetChip
                              key={preset.id}
                              preset={preset}
                              active={active}
                              activeClassName="bg-sky-50 border-sky-200"
                              idleClassName="bg-white border-slate-200"
                              textActiveClassName="text-sky-600"
                              textIdleClassName="text-slate-600 hover:text-sky-500"
                              onLoad={() => loadPreset(preset, 'vision')}
                              onRequestDelete={() => setPresetPendingDelete(preset)}
                            />
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
                disabled={!comfyuiCanSave}
                className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-indigo-200 bg-gradient-to-r from-indigo-500 to-purple-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存并关闭
              </button>
              {/* 暮色 2026-07-12：ComfyUI 模式下未选 model 时给个明确提示 */}
              {localImageGenProvider === 'comfyui' && !comfyuiCanSave ? (
                <p className="text-[10px] text-rose-500 text-center mt-2">
                  请先点 [测试连接]，再选一个 checkpoint
                </p>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}

      {presetPendingDelete ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onClick={() => setPresetPendingDelete(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          {/* 暮色 2026-07-15：之前按钮 rounded-2xl (16px) + 圆角 24px + p-5(20px) — 按钮被切
              改成 rounded-full 胶囊 + px-2 让按钮距 modal 边缘 20+8=28px > 24px 圆角，刚好不被切 */}
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
            <div className="text-base font-bold text-slate-700">删除预设</div>
            <div className="mt-2 text-sm text-slate-500">确认删除预设“{presetPendingDelete.name}”？</div>
            <div className="mt-5 grid grid-cols-2 gap-3 px-2">
              <button onClick={() => setPresetPendingDelete(null)} className="py-3 rounded-full bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
                取消
              </button>
              <button
                onClick={() => {
                  removeApiPreset(presetPendingDelete.id);
                  addToast(`已删除预设: ${presetPendingDelete.name}`, 'success');
                  setPresetPendingDelete(null);
                }}
                className="py-3 rounded-full bg-red-500 text-white font-bold active:scale-95 transition-all"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ApiQuickFloat;
