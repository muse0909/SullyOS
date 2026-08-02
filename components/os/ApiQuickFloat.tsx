import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { ArrowsClockwise, Brain, CaretRight, CloudArrowDown, CloudArrowUp, Eye, EyeSlash, Gear, ImageSquare, WifiHigh, X } from '@phosphor-icons/react';
import { safeResponseJson } from '../../utils/safeApi';
import { AppID } from '../../types';
import type { ApiPreset, CloudBackupFile } from '../../types';

const POS_KEY = 'sullyos_api_quickfloat_pos_v1';
const BALL_SIZE = 40;
const PRESET_LONG_PRESS_MS = 550;

type QuickModelTarget = 'main' | 'image' | 'vision';
type QuickPresetKind = 'main' | 'image' | 'vision' | 'lightLLM' | 'cloudBackup';

// 暮色 2026-07-15：删 checkpointLabel helper（ComfyUI 专用）— 生图只走 OpenAI 兼容

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

const PROTOCOL_TABS = ['openai', 'claude', 'gemini'] as const;
type ApiProtocol = typeof PROTOCOL_TABS[number];

const ProtocolTabs: React.FC<{
  value: ApiProtocol;
  onChange: (value: ApiProtocol) => void;
}> = ({ value, onChange }) => {
  const labelMap = { openai: 'OpenAI', claude: 'Claude', gemini: 'Gemini' } as const;
  const colorMap = { openai: '#10b981', claude: '#f97316', gemini: '#0ea5e9' } as const;
  return (
    <div className="flex gap-1.5 bg-slate-100/60 p-1 rounded-full">
      {PROTOCOL_TABS.map((protocol) => {
        const active = value === protocol;
        return (
          <button
            key={protocol}
            type="button"
            onClick={() => onChange(protocol)}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-full transition-all flex items-center justify-center gap-1.5 ${active ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${active ? '' : 'bg-slate-300'}`}
              style={active ? { background: colorMap[protocol] } : {}}
            />
            {labelMap[protocol]}
          </button>
        );
      })}
    </div>
  );
};

const PresetHeader: React.FC<{
  label: string;
  buttonClassName: string;
  onSave: () => void;
}> = ({ label, buttonClassName, onSave }) => (
  <div className="flex items-center justify-between gap-3 mb-2">
    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">{label}</label>
    <button
      type="button"
      onClick={onSave}
      className={`text-[10px] px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform shrink-0 ${buttonClassName}`}
    >
      保存为预设
    </button>
  </div>
);

const ApiQuickFloat: React.FC = () => {
  const {
    apiConfig,
    updateApiConfig,
    availableModels,
    setAvailableModels,
    apiPresets,
    // 暮色 2026-08-02 19:00 修：之前 handleSavePreset 调 addApiPreset(name, ...) 但 useOS 没解构 addApiPreset，
    //   TS 不严格检查 free variable，Vite build 通过，运行时 ReferenceError "addApiPreset is not defined"。
    //   修：从 useOS 解构 addApiPreset 出来。
    addApiPreset,
    removeApiPreset,
    addToast,
    isLocked,
    isDataLoaded,
    // 暮色 2026-07-15：记忆宫殿副 API（lightLLM）接到悬浮窗 — 换时方便
    memoryPalaceConfig,
    updateMemoryPalaceConfig,
    // 暮色 2026-07-21：云端备份快捷入口（仿 Settings 云端备份页的精简版）
    //   - 3 按钮（轻量同步 / 完整 / 从云端恢复）+ 状态条 + "去设置" 跳转
    //   - 恢复弹窗在悬浮窗里直接弹，点文件直接调 cloudRestoreFromWebDAV（跟 Settings 一致，不二次确认）
    //   - sysOperation：cloudBackupToWebDAV / cloudRestoreFromWebDAV 内部会 setStatus='processing'，
    //     但这个状态只在 Settings 页面渲染进度弹窗；悬浮窗里要看到加载弹窗得自己监听
    cloudBackupConfig,
    cloudBackupToWebDAV,
    cloudRestoreFromWebDAV,
    listCloudBackups,
    openApp,
    sysOperation,
    setSysOperation,
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
  // 暮色 2026-07-17 → 2026-07-27：API 协议 3 tab 切换（OpenAI / Claude / Gemini）
  const [localProtocol, setLocalProtocol] = useState<'openai' | 'claude' | 'gemini'>(apiConfig.protocol || 'openai');
  // 暮色 2026-07-27：主 API 三平台独立 URL/Key/Model（切 tab 不丢）
  const [localClaudeUrl, setLocalClaudeUrl] = useState(apiConfig.claudeBaseUrl || '');
  const [localClaudeKey, setLocalClaudeKey] = useState(apiConfig.claudeApiKey || '');
  const [localClaudeModel, setLocalClaudeModel] = useState(apiConfig.claudeModel || '');
  const [localGeminiUrl, setLocalGeminiUrl] = useState(apiConfig.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const [localGeminiKey, setLocalGeminiKey] = useState(apiConfig.geminiApiKey || '');
  const [localGeminiModel, setLocalGeminiModel] = useState(apiConfig.geminiModel || 'gemini-2.0-flash');

  const [localImageUrl, setLocalImageUrl] = useState(apiConfig.imageBaseUrl || '');
  const [localImageKey, setLocalImageKey] = useState(apiConfig.imageApiKey || '');
  const [localImageModel, setLocalImageModel] = useState(apiConfig.imageModel || '');
  const [localImageProtocol, setLocalImageProtocol] = useState<ApiProtocol>(
    (apiConfig.imageProtocol as ApiProtocol) || 'openai'
  );
  const [localImageClaudeUrl, setLocalImageClaudeUrl] = useState(apiConfig.imageClaudeBaseUrl || '');
  const [localImageClaudeKey, setLocalImageClaudeKey] = useState(apiConfig.imageClaudeApiKey || '');
  const [localImageClaudeModel, setLocalImageClaudeModel] = useState(apiConfig.imageClaudeModel || '');
  const [localImageGeminiUrl, setLocalImageGeminiUrl] = useState(
    apiConfig.imageGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  );
  const [localImageGeminiKey, setLocalImageGeminiKey] = useState(apiConfig.imageGeminiApiKey || '');
  const [localImageGeminiModel, setLocalImageGeminiModel] = useState(apiConfig.imageGeminiModel || 'gemini-2.0-flash');
  // 暮色 2026-07-15：删 localImageGenProvider / comfyui* state — 生图只走 OpenAI 兼容

  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionBaseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionModel || '');

  // 暮色 2026-07-15：副 API（记忆宫殿后台处理用 lightLLM）— local state
  const [localLightUrl, setLocalLightUrl] = useState(memoryPalaceConfig?.lightLLM?.baseUrl || '');
  const [localLightKey, setLocalLightKey] = useState(memoryPalaceConfig?.lightLLM?.apiKey || '');
  const [localLightModel, setLocalLightModel] = useState(memoryPalaceConfig?.lightLLM?.model || '');
  // 暮色 2026-07-27：副 API 3 tab 协议（OpenAI / Claude / Gemini）
  const [localLightProtocol, setLocalLightProtocol] = useState<'openai' | 'claude' | 'gemini'>(
    ((memoryPalaceConfig?.lightLLM as any)?.protocol as 'openai' | 'claude' | 'gemini') || 'openai'
  );
  const [localLightClaudeUrl, setLocalLightClaudeUrl] = useState((memoryPalaceConfig?.lightLLM as any)?.claudeBaseUrl || '');
  const [localLightClaudeKey, setLocalLightClaudeKey] = useState((memoryPalaceConfig?.lightLLM as any)?.claudeApiKey || '');
  const [localLightClaudeModel, setLocalLightClaudeModel] = useState((memoryPalaceConfig?.lightLLM as any)?.claudeModel || '');
  const [localLightGeminiUrl, setLocalLightGeminiUrl] = useState(
    (memoryPalaceConfig?.lightLLM as any)?.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  );
  const [localLightGeminiKey, setLocalLightGeminiKey] = useState((memoryPalaceConfig?.lightLLM as any)?.geminiApiKey || '');
  const [localLightGeminiModel, setLocalLightGeminiModel] = useState(
    (memoryPalaceConfig?.lightLLM as any)?.geminiModel || 'gemini-2.0-flash'
  );

  // 暮色 2026-07-27：识图 3 tab 协议（OpenAI / Claude / Gemini）
  const [localVisionProtocol, setLocalVisionProtocol] = useState<'openai' | 'claude' | 'gemini'>(
    (apiConfig.visionProtocol as 'openai' | 'claude' | 'gemini') || 'openai'
  );
  const [localVisionClaudeUrl, setLocalVisionClaudeUrl] = useState(apiConfig.visionClaudeBaseUrl || '');
  const [localVisionClaudeKey, setLocalVisionClaudeKey] = useState(apiConfig.visionClaudeApiKey || '');
  const [localVisionClaudeModel, setLocalVisionClaudeModel] = useState(apiConfig.visionClaudeModel || '');
  const [localVisionGeminiUrl, setLocalVisionGeminiUrl] = useState(
    apiConfig.visionGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'
  );
  const [localVisionGeminiKey, setLocalVisionGeminiKey] = useState(apiConfig.visionGeminiApiKey || '');
  const [localVisionGeminiModel, setLocalVisionGeminiModel] = useState(
    apiConfig.visionGeminiModel || 'gemini-2.0-flash'
  );

  const [showMainKey, setShowMainKey] = useState(false);
  const [showImageKey, setShowImageKey] = useState(false);
  const [showVisionKey, setShowVisionKey] = useState(false);
  const [showLightKey, setShowLightKey] = useState(false);
  const [lightStatusMsg, setLightStatusMsg] = useState('');
  const [lightTesting, setLightTesting] = useState(false);

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
  const [presetPendingDelete, setPresetPendingDelete] = useState<ApiPreset | null>(null);
  // 暮色 2026-07-21：云端备份快捷入口 — 备份中是长操作，按钮 disabled 防止重复点
  const [cloudBackingMode, setCloudBackingMode] = useState<'text_only' | 'full' | null>(null);
  // 暮色 2026-07-21：从云端恢复弹窗 state（仿 Settings）— 列文件 + 点选直接恢复
  const [showCloudRestoreModal, setShowCloudRestoreModal] = useState(false);
  const [cloudBackupFiles, setCloudBackupFiles] = useState<CloudBackupFile[]>([]);
  const [cloudRestoring, setCloudRestoring] = useState(false);

  useEffect(() => {
    setLocalUrl(apiConfig.baseUrl);
    setLocalKey(apiConfig.apiKey);
    setLocalModel(apiConfig.model);
    // 暮色 2026-07-17 → 2026-07-27：API 协议同步（3 tab 切换，Settings 改了这里也要跟着变）
    const syncedProtocol: 'openai' | 'claude' | 'gemini' = apiConfig.protocol === 'claude' || apiConfig.protocol === 'gemini' ? apiConfig.protocol : 'openai';
    setLocalProtocol(syncedProtocol);
    setLocalClaudeUrl(apiConfig.claudeBaseUrl || '');
    setLocalClaudeKey(apiConfig.claudeApiKey || '');
    setLocalClaudeModel(apiConfig.claudeModel || '');
    setLocalGeminiUrl(apiConfig.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    setLocalGeminiKey(apiConfig.geminiApiKey || '');
    setLocalGeminiModel(apiConfig.geminiModel || 'gemini-2.0-flash');
    setLocalImageUrl(apiConfig.imageBaseUrl || '');
    setLocalImageKey(apiConfig.imageApiKey || '');
    setLocalImageModel(apiConfig.imageModel || '');
    setLocalImageProtocol((apiConfig.imageProtocol as ApiProtocol) || 'openai');
    setLocalImageClaudeUrl(apiConfig.imageClaudeBaseUrl || '');
    setLocalImageClaudeKey(apiConfig.imageClaudeApiKey || '');
    setLocalImageClaudeModel(apiConfig.imageClaudeModel || '');
    setLocalImageGeminiUrl(apiConfig.imageGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    setLocalImageGeminiKey(apiConfig.imageGeminiApiKey || '');
    setLocalImageGeminiModel(apiConfig.imageGeminiModel || 'gemini-2.0-flash');
    // 暮色 2026-07-15：删 localImageGenProvider / localComfyuiSelectedModel 同步
    setLocalVisionUrl(apiConfig.visionBaseUrl || '');
    setLocalVisionKey(apiConfig.visionApiKey || '');
    setLocalVisionModel(apiConfig.visionModel || '');
    // 暮色 2026-07-27：识图 3 tab 协议 + 3 套独立 URL/Key/Model 同步
    setLocalVisionProtocol((apiConfig.visionProtocol as 'openai' | 'claude' | 'gemini') || 'openai');
    setLocalVisionClaudeUrl(apiConfig.visionClaudeBaseUrl || '');
    setLocalVisionClaudeKey(apiConfig.visionClaudeApiKey || '');
    setLocalVisionClaudeModel(apiConfig.visionClaudeModel || '');
    setLocalVisionGeminiUrl(apiConfig.visionGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
    setLocalVisionGeminiKey(apiConfig.visionGeminiApiKey || '');
    setLocalVisionGeminiModel(apiConfig.visionGeminiModel || 'gemini-2.0-flash');
    // 暮色 2026-07-15：同步副 API（记忆宫殿 lightLLM）— 抽原始字段做 deps，避免对象新引用触发重跑
    if (memoryPalaceConfig?.lightLLM) {
      setLocalLightUrl(memoryPalaceConfig.lightLLM.baseUrl || '');
      setLocalLightKey(memoryPalaceConfig.lightLLM.apiKey || '');
      setLocalLightModel(memoryPalaceConfig.lightLLM.model || '');
      // 暮色 2026-07-27：副 API 3 tab 协议同步
      setLocalLightProtocol(((memoryPalaceConfig.lightLLM as any).protocol as 'openai' | 'claude' | 'gemini') || 'openai');
      setLocalLightClaudeUrl((memoryPalaceConfig.lightLLM as any).claudeBaseUrl || '');
      setLocalLightClaudeKey((memoryPalaceConfig.lightLLM as any).claudeApiKey || '');
      setLocalLightClaudeModel((memoryPalaceConfig.lightLLM as any).claudeModel || '');
      setLocalLightGeminiUrl((memoryPalaceConfig.lightLLM as any).geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      setLocalLightGeminiKey((memoryPalaceConfig.lightLLM as any).geminiApiKey || '');
      setLocalLightGeminiModel((memoryPalaceConfig.lightLLM as any).geminiModel || 'gemini-2.0-flash');
    }
  }, [
    apiConfig.baseUrl,
    apiConfig.apiKey,
    apiConfig.model,
    apiConfig.imageBaseUrl,
    apiConfig.imageApiKey,
    apiConfig.imageModel,
    apiConfig.imageProtocol,
    apiConfig.imageClaudeBaseUrl,
    apiConfig.imageClaudeApiKey,
    apiConfig.imageClaudeModel,
    apiConfig.imageGeminiBaseUrl,
    apiConfig.imageGeminiApiKey,
    apiConfig.imageGeminiModel,
    // 暮色 2026-07-15：删 imageGenProvider — 永远 openai
    apiConfig.visionBaseUrl,
    apiConfig.visionApiKey,
    apiConfig.visionModel,
    // 暮色 2026-07-27：Gemini 直连同步
    apiConfig.geminiBaseUrl,
    apiConfig.geminiApiKey,
    apiConfig.geminiModel,
    // 暮色 2026-07-27：识图 3 tab 协议 + 3 套独立 URL/Key/Model
    apiConfig.visionProtocol,
    apiConfig.visionClaudeBaseUrl,
    apiConfig.visionClaudeApiKey,
    apiConfig.visionClaudeModel,
    apiConfig.visionGeminiBaseUrl,
    apiConfig.visionGeminiApiKey,
    apiConfig.visionGeminiModel,
    memoryPalaceConfig?.lightLLM?.baseUrl,
    memoryPalaceConfig?.lightLLM?.apiKey,
    memoryPalaceConfig?.lightLLM?.model,
    // 暮色 2026-07-27：副 API 3 tab 协议 + 3 套独立 URL/Key/Model
    (memoryPalaceConfig?.lightLLM as any)?.protocol,
    (memoryPalaceConfig?.lightLLM as any)?.claudeBaseUrl,
    (memoryPalaceConfig?.lightLLM as any)?.claudeApiKey,
    (memoryPalaceConfig?.lightLLM as any)?.claudeModel,
    (memoryPalaceConfig?.lightLLM as any)?.geminiBaseUrl,
    (memoryPalaceConfig?.lightLLM as any)?.geminiApiKey,
    (memoryPalaceConfig?.lightLLM as any)?.geminiModel,
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
    // 暮色 2026-07-15：每次点 WiFi 球都重置 openSection=null — 浮窗始终折叠（不让上次打开的 section 残留）
    setOpenSection(null);
    setShowMainModelPicker(false);
    setShowImageModelPicker(false);
    setShowVisionModelPicker(false);
    setShowPanel(true);
  };

  // 暮色 2026-07-15：删 ComfyUI 专用常量 + testComfyuiConnection — 生图只走 OpenAI 兼容

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
      // 暮色 2026-07-27：Gemini 端点识别（自动走 ?key= 参数）
      const isGemini = /generativelanguage\.googleapis\.com/i.test(baseUrl);
      let response: Response;
      if (isGemini) {
        response = await fetch(`${baseUrl}/models?key=${encodeURIComponent(key)}&pageSize=100`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        response = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        });
      }
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }
      const data = await safeResponseJson(response);
      const list = data.data || data.models || [];
      if (!Array.isArray(list)) {
        setMessage('格式不兼容');
        return;
      }
      // 暮色 2026-07-27：Gemini 响应 name 是 'models/gemini-2.0-flash'，剥前缀
      const models = list.map((item: any) => {
        if (typeof item === 'string') return item;
        const id = item.id || item.name || '';
        return isGemini ? id.replace(/^models\//, '') : id;
      }).filter(Boolean);
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

  // 暮色 2026-07-15：删 COMFYUI 常量 + testComfyuiConnection + comfyuiCanSave — 生图只走 OpenAI 兼容

  // 暮色 2026-07-27：主 API 协议 3 tab 切换 handler
  //   跟 Settings 同样逻辑：切走前存当前值到旧协议缓存，从新协议缓存读出
  const switchMainProtocol = (newProtocol: 'openai' | 'claude' | 'gemini') => {
    if (newProtocol === localProtocol) return;
    if (localProtocol === 'claude') {
      setLocalClaudeUrl(localUrl);
      setLocalClaudeKey(localKey);
      setLocalClaudeModel(localModel);
    } else if (localProtocol === 'gemini') {
      setLocalGeminiUrl(localUrl);
      setLocalGeminiKey(localKey);
      setLocalGeminiModel(localModel);
    }
    if (newProtocol === 'openai') {
      setLocalUrl(apiConfig.baseUrl || '');
      setLocalKey(apiConfig.apiKey || '');
      setLocalModel(apiConfig.model || '');
    } else if (newProtocol === 'claude') {
      setLocalUrl(localClaudeUrl || apiConfig.claudeBaseUrl || '');
      setLocalKey(localClaudeKey || apiConfig.claudeApiKey || '');
      setLocalModel(localClaudeModel || apiConfig.claudeModel || '');
    } else {
      setLocalUrl(localGeminiUrl || apiConfig.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      setLocalKey(localGeminiKey || apiConfig.geminiApiKey || '');
      setLocalModel(localGeminiModel || apiConfig.geminiModel || 'gemini-2.0-flash');
    }
    setLocalProtocol(newProtocol);
  };

  // 暮色 2026-07-28：生图卡片 UI 也对齐 3 tab；底层生图仍走 OpenAI 兼容，先保证配置页不崩、不挤。
  const switchImageProtocol = (newProtocol: ApiProtocol) => {
    if (newProtocol === localImageProtocol) return;
    if (localImageProtocol === 'claude') {
      setLocalImageClaudeUrl(localImageUrl);
      setLocalImageClaudeKey(localImageKey);
      setLocalImageClaudeModel(localImageModel);
    } else if (localImageProtocol === 'gemini') {
      setLocalImageGeminiUrl(localImageUrl);
      setLocalImageGeminiKey(localImageKey);
      setLocalImageGeminiModel(localImageModel);
    }
    if (newProtocol === 'openai') {
      setLocalImageUrl(apiConfig.imageBaseUrl || '');
      setLocalImageKey(apiConfig.imageApiKey || '');
      setLocalImageModel(apiConfig.imageModel || '');
    } else if (newProtocol === 'claude') {
      setLocalImageUrl(localImageClaudeUrl || apiConfig.imageClaudeBaseUrl || '');
      setLocalImageKey(localImageClaudeKey || apiConfig.imageClaudeApiKey || '');
      setLocalImageModel(localImageClaudeModel || apiConfig.imageClaudeModel || '');
    } else {
      setLocalImageUrl(localImageGeminiUrl || apiConfig.imageGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      setLocalImageKey(localImageGeminiKey || apiConfig.imageGeminiApiKey || '');
      setLocalImageModel(localImageGeminiModel || apiConfig.imageGeminiModel || 'gemini-2.0-flash');
    }
    setLocalImageProtocol(newProtocol);
  };

  const handleSaveAndClose = () => {
    // 暮色 2026-07-15：删 ComfyUI / NAI 分支，只剩 OpenAI 兼容
    // 暮色 2026-07-27：3 tab 协议 — 同时存 3 套，切回 tab 不丢
    const mainUpdates: any = {
      protocol: localProtocol,
      baseUrl: localProtocol === 'openai' ? localUrl : (apiConfig.baseUrl || ''),
      apiKey: localProtocol === 'openai' ? localKey : (apiConfig.apiKey || ''),
      model: localProtocol === 'openai' ? localModel : (apiConfig.model || ''),
      claudeBaseUrl: localProtocol === 'claude' ? localUrl : localClaudeUrl,
      claudeApiKey: localProtocol === 'claude' ? localKey : localClaudeKey,
      claudeModel: localProtocol === 'claude' ? localModel : localClaudeModel,
      geminiBaseUrl: localProtocol === 'gemini' ? localUrl : localGeminiUrl,
      geminiApiKey: localProtocol === 'gemini' ? localKey : localGeminiKey,
      geminiModel: localProtocol === 'gemini' ? localModel : localGeminiModel,
    };
    // 暮色 2026-07-27：识图 3 tab 协议 — 同时存 3 套
    const visionUpdates: any = {
      visionProtocol: localVisionProtocol,
      visionBaseUrl: localVisionProtocol === 'openai' ? localVisionUrl : (apiConfig.visionBaseUrl || ''),
      visionApiKey: localVisionProtocol === 'openai' ? localVisionKey : (apiConfig.visionApiKey || ''),
      visionModel: localVisionProtocol === 'openai' ? localVisionModel : (apiConfig.visionModel || ''),
      visionClaudeBaseUrl: localVisionProtocol === 'claude' ? localVisionUrl : localVisionClaudeUrl,
      visionClaudeApiKey: localVisionProtocol === 'claude' ? localVisionKey : localVisionClaudeKey,
      visionClaudeModel: localVisionProtocol === 'claude' ? localVisionModel : localVisionClaudeModel,
      visionGeminiBaseUrl: localVisionProtocol === 'gemini' ? localVisionUrl : localVisionGeminiUrl,
      visionGeminiApiKey: localVisionProtocol === 'gemini' ? localVisionKey : localVisionGeminiKey,
      visionGeminiModel: localVisionProtocol === 'gemini' ? localVisionModel : localVisionGeminiModel,
    };
    const imageUpdates: any = {
      imageProtocol: localImageProtocol,
      imageBaseUrl: localImageProtocol === 'openai' ? localImageUrl : (apiConfig.imageBaseUrl || ''),
      imageApiKey: localImageProtocol === 'openai' ? localImageKey : (apiConfig.imageApiKey || ''),
      imageModel: localImageProtocol === 'openai' ? localImageModel : (apiConfig.imageModel || ''),
      imageClaudeBaseUrl: localImageProtocol === 'claude' ? localImageUrl : localImageClaudeUrl,
      imageClaudeApiKey: localImageProtocol === 'claude' ? localImageKey : localImageClaudeKey,
      imageClaudeModel: localImageProtocol === 'claude' ? localImageModel : localImageClaudeModel,
      imageGeminiBaseUrl: localImageProtocol === 'gemini' ? localImageUrl : localImageGeminiUrl,
      imageGeminiApiKey: localImageProtocol === 'gemini' ? localImageKey : localImageGeminiKey,
      imageGeminiModel: localImageProtocol === 'gemini' ? localImageModel : localImageGeminiModel,
    };
    updateApiConfig({
      ...apiConfig,
      ...mainUpdates,
      ...visionUpdates,
      ...imageUpdates,
      imageGenProvider: 'openai', // 暮色 2026-07-15：写死 openai，types 保留 'openai' | 'comfyui' | 'nai' 防以后再加回
    });
    addToast('API 配置已保存', 'success');
    setShowPanel(false);
  };

  // 暮色 2026-07-15：副 API（lightLLM）— 单独保存，浮窗不自动关闭（跟主 API save 不同）
  // 暮色 2026-07-27：3 tab 协议 — 同时存 3 套
  const handleSaveLightConfig = () => {
    if (!memoryPalaceConfig || !updateMemoryPalaceConfig) {
      addToast('记忆宫殿配置未就绪', 'error');
      return;
    }
    updateMemoryPalaceConfig({
      lightLLM: {
        baseUrl: localLightProtocol === 'openai' ? localLightUrl.trim() : (memoryPalaceConfig.lightLLM?.baseUrl || ''),
        apiKey: localLightProtocol === 'openai' ? localLightKey.trim() : (memoryPalaceConfig.lightLLM?.apiKey || ''),
        model: localLightProtocol === 'openai' ? localLightModel.trim() : (memoryPalaceConfig.lightLLM?.model || ''),
        protocol: localLightProtocol,
        claudeBaseUrl: localLightProtocol === 'claude' ? localLightUrl.trim() : localLightClaudeUrl,
        claudeApiKey: localLightProtocol === 'claude' ? localLightKey.trim() : localLightClaudeKey,
        claudeModel: localLightProtocol === 'claude' ? localLightModel.trim() : localLightClaudeModel,
        geminiBaseUrl: localLightProtocol === 'gemini' ? localLightUrl.trim() : localLightGeminiUrl,
        geminiApiKey: localLightProtocol === 'gemini' ? localLightKey.trim() : localLightGeminiKey,
        geminiModel: localLightProtocol === 'gemini' ? localLightModel.trim() : localLightGeminiModel,
      } as any,
    });
    setLightStatusMsg('副 API 配置已保存');
    setTimeout(() => setLightStatusMsg(''), 2500);
  };

  // 暮色 2026-07-15：副 API 测试连接（fetch {url}/models HEAD，参考 MemoryPalaceApp 同款）
  const handleTestLight = async () => {
    const url = localLightUrl.trim();
    if (!url) {
      setLightStatusMsg('请先填 URL');
      return;
    }
    setLightTesting(true);
    setLightStatusMsg('正在连接...');
    try {
      const baseUrl = url.replace(/\/+$/, '');
      const res = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${localLightKey.trim()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await safeResponseJson(res);
      const models = data?.data || data?.models || [];
      const count = Array.isArray(models) ? models.length : 0;
      setLightStatusMsg(`✓ 在线 · ${count} 个模型`);
    } catch (e: any) {
      setLightStatusMsg(`✗ 失败：${e?.message || '未知错误'}`);
    } finally {
      setLightTesting(false);
    }
  };

  // 暮色 2026-07-27：通用"添加预设" — 4 个 API 共用，存当前输入框值
  const handleSavePreset = (target: 'main' | 'image' | 'vision' | 'lightLLM', defaultName: string) => {
    const name = window.prompt('预设名称', defaultName)?.trim();
    if (!name) return;
    // 暮色 2026-08-02 18:50 修：跟记忆宫殿 app 同款 bug。
    // 之前 baseUrl/imageBaseUrl/visionBaseUrl/baseUrl 字段在协议不是 openai 时保留旧值（apiConfig 的旧值），
    //   导致预设的 baseUrl 字段跟当前协议的 URL 不同步，isPresetActive 永远不匹配，预设看上去"没生效"。
    //   修：baseUrl/imageBaseUrl/visionBaseUrl 字段始终用 localUrl/localImageUrl/localVisionUrl/localLightUrl（不分协议），
    //   其他协议字段保留 local*Url / local*ClaudeUrl / local*GeminiUrl（切回那个 tab 不丢）。
    if (target === 'main') {
      addApiPreset(name, {
        baseUrl: localUrl.trim(),
        apiKey: localKey.trim(),
        model: localModel.trim(),
        protocol: localProtocol,
        claudeBaseUrl: localProtocol === 'claude' ? localUrl.trim() : localClaudeUrl,
        claudeApiKey: localProtocol === 'claude' ? localKey.trim() : localClaudeKey,
        claudeModel: localProtocol === 'claude' ? localModel.trim() : localClaudeModel,
        geminiBaseUrl: localProtocol === 'gemini' ? localUrl.trim() : localGeminiUrl,
        geminiApiKey: localProtocol === 'gemini' ? localKey.trim() : localGeminiKey,
        geminiModel: localProtocol === 'gemini' ? localModel.trim() : localGeminiModel,
      } as any, 'main');
    } else if (target === 'image') {
      addApiPreset(name, {
        imageBaseUrl: localImageUrl.trim(),
        imageApiKey: localImageKey.trim(),
        imageModel: localImageModel.trim(),
        imageProtocol: localImageProtocol,
        imageClaudeBaseUrl: localImageProtocol === 'claude' ? localImageUrl.trim() : localImageClaudeUrl,
        imageClaudeApiKey: localImageProtocol === 'claude' ? localImageKey.trim() : localImageClaudeKey,
        imageClaudeModel: localImageProtocol === 'claude' ? localImageModel.trim() : localImageClaudeModel,
        imageGeminiBaseUrl: localImageProtocol === 'gemini' ? localImageUrl.trim() : localImageGeminiUrl,
        imageGeminiApiKey: localImageProtocol === 'gemini' ? localImageKey.trim() : localImageGeminiKey,
        imageGeminiModel: localImageProtocol === 'gemini' ? localImageModel.trim() : localImageGeminiModel,
      } as any, 'image');
    } else if (target === 'vision') {
      addApiPreset(name, {
        visionBaseUrl: localVisionUrl.trim(),
        visionApiKey: localVisionKey.trim(),
        visionModel: localVisionModel.trim(),
        visionProtocol: localVisionProtocol,
        visionClaudeBaseUrl: localVisionProtocol === 'claude' ? localVisionUrl.trim() : localVisionClaudeUrl,
        visionClaudeApiKey: localVisionProtocol === 'claude' ? localVisionKey.trim() : localVisionClaudeKey,
        visionClaudeModel: localVisionProtocol === 'claude' ? localVisionModel.trim() : localVisionClaudeModel,
        visionGeminiBaseUrl: localVisionProtocol === 'gemini' ? localVisionUrl.trim() : localVisionGeminiUrl,
        visionGeminiApiKey: localVisionProtocol === 'gemini' ? localVisionKey.trim() : localVisionGeminiKey,
        visionGeminiModel: localVisionProtocol === 'gemini' ? localVisionModel.trim() : localVisionGeminiModel,
      } as any, 'vision');
    } else {
      addApiPreset(name, {
        baseUrl: localLightUrl.trim(),
        apiKey: localLightKey.trim(),
        model: localLightModel.trim(),
        protocol: localLightProtocol,
        claudeBaseUrl: localLightProtocol === 'claude' ? localLightUrl.trim() : localLightClaudeUrl,
        claudeApiKey: localLightProtocol === 'claude' ? localLightKey.trim() : localLightClaudeKey,
        claudeModel: localLightProtocol === 'claude' ? localLightModel.trim() : localLightClaudeModel,
        geminiBaseUrl: localLightProtocol === 'gemini' ? localLightUrl.trim() : localLightGeminiUrl,
        geminiApiKey: localLightProtocol === 'gemini' ? localLightKey.trim() : localLightGeminiKey,
        geminiModel: localLightProtocol === 'gemini' ? localLightModel.trim() : localLightGeminiModel,
      } as any, 'memoryPalaceLight');
    }
    addToast(`已保存预设: ${name}`, 'success');
  };

  // 暮色 2026-07-21：云端备份快捷入口（仿 Settings 那个云端备份页的精简版）
  //   - 悬浮窗里直接展开 3 按钮（轻量同步 / 完整 / 从云端恢复）+ 状态条
  //   - 配置入口（"去设置" 按钮）跳到 Settings，不在悬浮窗里做配置 modal（太挤）
  //   - 恢复弹窗在悬浮窗里直接弹（点文件直接调 cloudRestoreFromWebDAV，不二次确认 — 跟 Settings 一致）
  const isCloudBackupConfigured = !!(
    (cloudBackupConfig.webdavUrl && cloudBackupConfig.username && cloudBackupConfig.password) ||
    (cloudBackupConfig.githubToken && cloudBackupConfig.githubOwner)
  );

  const formatCloudBackupSubtitle = (timestamp?: number): string => {
    if (!timestamp) return isCloudBackupConfigured ? '从未备份' : '未配置';
    const now = Date.now();
    const diff = now - timestamp;
    if (diff < 60_000) return '刚刚备份';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前备份`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前备份`;
    return `${Math.floor(diff / 86_400_000)} 天前备份`;
  };

  const cloudBackupSubtitle = formatCloudBackupSubtitle(cloudBackupConfig.lastBackupTime);

  const handleCloudBackupWithMode = async (mode: 'text_only' | 'full') => {
    if (cloudBackingMode) return;
    setCloudBackingMode(mode);
    try {
      await cloudBackupToWebDAV(mode);
    } catch {
      // toast 已在 OSContext.cloudBackupToWebDAV 内部 addToast 处理
    } finally {
      setCloudBackingMode(null);
    }
  };

  const handleOpenCloudRestore = async () => {
    setShowCloudRestoreModal(true);
    setCloudBackupFiles([]);
    try {
      const files = await listCloudBackups();
      setCloudBackupFiles(files);
    } catch {
      addToast('获取云端备份列表失败', 'error');
    }
  };

  const handleCloudRestoreFile = async (file: CloudBackupFile) => {
    if (cloudRestoring) return;
    setCloudRestoring(true);
    setShowCloudRestoreModal(false);
    try {
      await cloudRestoreFromWebDAV(file);
    } catch {
      // toast 已在 OSContext.cloudRestoreFromWebDAV 内部 addToast 处理
    } finally {
      setCloudRestoring(false);
    }
  };

  const handleOpenCloudSettings = () => {
    setShowPanel(false); // 关闭悬浮窗
    openApp(AppID.Settings);
  };

  const toggleSection = (section: QuickPresetKind) => {
    setOpenSection((prev) => (prev === section ? null : section));
  };

  // 暮色 2026-07-27：副 API 3 tab 协议切换 handler
  const switchLightProtocol = (newProtocol: 'openai' | 'claude' | 'gemini') => {
    if (newProtocol === localLightProtocol) return;
    if (localLightProtocol === 'claude') {
      setLocalLightClaudeUrl(localLightUrl);
      setLocalLightClaudeKey(localLightKey);
      setLocalLightClaudeModel(localLightModel);
    } else if (localLightProtocol === 'gemini') {
      setLocalLightGeminiUrl(localLightUrl);
      setLocalLightGeminiKey(localLightKey);
      setLocalLightGeminiModel(localLightModel);
    }
    if (newProtocol === 'openai') {
      setLocalLightUrl(memoryPalaceConfig?.lightLLM?.baseUrl || '');
      setLocalLightKey(memoryPalaceConfig?.lightLLM?.apiKey || '');
      setLocalLightModel(memoryPalaceConfig?.lightLLM?.model || '');
    } else if (newProtocol === 'claude') {
      setLocalLightUrl(localLightClaudeUrl || (memoryPalaceConfig?.lightLLM as any)?.claudeBaseUrl || '');
      setLocalLightKey(localLightClaudeKey || (memoryPalaceConfig?.lightLLM as any)?.claudeApiKey || '');
      setLocalLightModel(localLightClaudeModel || (memoryPalaceConfig?.lightLLM as any)?.claudeModel || '');
    } else {
      setLocalLightUrl(localLightGeminiUrl || (memoryPalaceConfig?.lightLLM as any)?.geminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      setLocalLightKey(localLightGeminiKey || (memoryPalaceConfig?.lightLLM as any)?.geminiApiKey || '');
      setLocalLightModel(localLightGeminiModel || (memoryPalaceConfig?.lightLLM as any)?.geminiModel || 'gemini-2.0-flash');
    }
    setLocalLightProtocol(newProtocol);
  };

  // 暮色 2026-07-27：识图 3 tab 协议切换 handler
  const switchVisionProtocol = (newProtocol: 'openai' | 'claude' | 'gemini') => {
    if (newProtocol === localVisionProtocol) return;
    if (localVisionProtocol === 'claude') {
      setLocalVisionClaudeUrl(localVisionUrl);
      setLocalVisionClaudeKey(localVisionKey);
      setLocalVisionClaudeModel(localVisionModel);
    } else if (localVisionProtocol === 'gemini') {
      setLocalVisionGeminiUrl(localVisionUrl);
      setLocalVisionGeminiKey(localVisionKey);
      setLocalVisionGeminiModel(localVisionModel);
    }
    if (newProtocol === 'openai') {
      setLocalVisionUrl(apiConfig.visionBaseUrl || '');
      setLocalVisionKey(apiConfig.visionApiKey || '');
      setLocalVisionModel(apiConfig.visionModel || '');
    } else if (newProtocol === 'claude') {
      setLocalVisionUrl(localVisionClaudeUrl || apiConfig.visionClaudeBaseUrl || '');
      setLocalVisionKey(localVisionClaudeKey || apiConfig.visionClaudeApiKey || '');
      setLocalVisionModel(localVisionClaudeModel || apiConfig.visionClaudeModel || '');
    } else {
      setLocalVisionUrl(localVisionGeminiUrl || apiConfig.visionGeminiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      setLocalVisionKey(localVisionGeminiKey || apiConfig.visionGeminiApiKey || '');
      setLocalVisionModel(localVisionGeminiModel || apiConfig.visionGeminiModel || 'gemini-2.0-flash');
    }
    setLocalVisionProtocol(newProtocol);
  };

  const loadPreset = (preset: ApiPreset, kind: QuickPresetKind) => {
    const c = preset.config;
    if (kind === 'image') {
      const iProto: ApiProtocol = (c as any).imageProtocol || 'openai';
      switchImageProtocol(iProto);
      if (iProto === 'claude') {
        const url = (c as any).imageClaudeBaseUrl || c.imageBaseUrl || '';
        const key = (c as any).imageClaudeApiKey || c.imageApiKey || '';
        const model = (c as any).imageClaudeModel || c.imageModel || '';
        setLocalImageClaudeUrl(url);
        setLocalImageClaudeKey(key);
        setLocalImageClaudeModel(model);
        setLocalImageUrl(url);
        setLocalImageKey(key);
        setLocalImageModel(model);
      } else if (iProto === 'gemini') {
        const url = (c as any).imageGeminiBaseUrl || c.imageBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const key = (c as any).imageGeminiApiKey || c.imageApiKey || '';
        const model = (c as any).imageGeminiModel || c.imageModel || 'gemini-2.0-flash';
        setLocalImageGeminiUrl(url);
        setLocalImageGeminiKey(key);
        setLocalImageGeminiModel(model);
        setLocalImageUrl(url);
        setLocalImageKey(key);
        setLocalImageModel(model);
      } else {
        setLocalImageUrl(c.imageBaseUrl || '');
        setLocalImageKey(c.imageApiKey || '');
        setLocalImageModel(c.imageModel || '');
      }
      setLocalImageProtocol(iProto);
      // 暮色 2026-07-15：删 setLocalImageGenProvider — 生图只走 OpenAI 兼容
      addToast(`已加载生图预设: ${preset.name} (${iProto === 'claude' ? 'Claude' : iProto === 'gemini' ? 'Gemini' : 'OpenAI'})`, 'info');
      return;
    }
    if (kind === 'vision') {
      // 暮色 2026-07-27：加载预设时按预设 protocol 切 tab + 填对应那组
      const vProto: 'openai' | 'claude' | 'gemini' = (c as any).visionProtocol || 'openai';
      switchVisionProtocol(vProto);
      if (vProto === 'claude') {
        const url = (c as any).visionClaudeBaseUrl || c.visionBaseUrl || '';
        const key = (c as any).visionClaudeApiKey || c.visionApiKey || '';
        const model = (c as any).visionClaudeModel || c.visionModel || '';
        setLocalVisionClaudeUrl(url);
        setLocalVisionClaudeKey(key);
        setLocalVisionClaudeModel(model);
        setLocalVisionUrl(url);
        setLocalVisionKey(key);
        setLocalVisionModel(model);
      } else if (vProto === 'gemini') {
        const url = (c as any).visionGeminiBaseUrl || c.visionBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const key = (c as any).visionGeminiApiKey || c.visionApiKey || '';
        const model = (c as any).visionGeminiModel || c.visionModel || 'gemini-2.0-flash';
        setLocalVisionGeminiUrl(url);
        setLocalVisionGeminiKey(key);
        setLocalVisionGeminiModel(model);
        setLocalVisionUrl(url);
        setLocalVisionKey(key);
        setLocalVisionModel(model);
      } else {
        setLocalVisionUrl(c.visionBaseUrl || '');
        setLocalVisionKey(c.visionApiKey || '');
        setLocalVisionModel(c.visionModel || '');
      }
      setLocalVisionProtocol(vProto);
      addToast(`已加载识图预设: ${preset.name} (${vProto === 'claude' ? 'Claude' : vProto === 'gemini' ? 'Gemini' : 'OpenAI'})`, 'info');
      return;
    }
    if (kind === 'lightLLM') {
      // 暮色 2026-07-27：副 API 预设加载时按 protocol 切 tab + 填对应那组
      const lProto: 'openai' | 'claude' | 'gemini' = (c as any).protocol || 'openai';
      switchLightProtocol(lProto);
      if (lProto === 'claude') {
        const url = (c as any).claudeBaseUrl || c.baseUrl || '';
        const key = (c as any).claudeApiKey || c.apiKey || '';
        const model = (c as any).claudeModel || c.model || '';
        setLocalLightClaudeUrl(url);
        setLocalLightClaudeKey(key);
        setLocalLightClaudeModel(model);
        setLocalLightUrl(url);
        setLocalLightKey(key);
        setLocalLightModel(model);
      } else if (lProto === 'gemini') {
        const url = (c as any).geminiBaseUrl || c.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const key = (c as any).geminiApiKey || c.apiKey || '';
        const model = (c as any).geminiModel || c.model || 'gemini-2.0-flash';
        setLocalLightGeminiUrl(url);
        setLocalLightGeminiKey(key);
        setLocalLightGeminiModel(model);
        setLocalLightUrl(url);
        setLocalLightKey(key);
        setLocalLightModel(model);
      } else {
        setLocalLightUrl(c.baseUrl || '');
        setLocalLightKey(c.apiKey || '');
        setLocalLightModel(c.model || '');
      }
      setLocalLightProtocol(lProto);
      addToast(`已加载副 API 预设: ${preset.name} (${lProto === 'claude' ? 'Claude' : lProto === 'gemini' ? 'Gemini' : 'OpenAI'})`, 'info');
      return;
    }
    // main: 暮色 2026-07-27：加载预设时按 protocol 切 tab + 填对应那组
    const mProto: 'openai' | 'claude' | 'gemini' = (c as any).protocol || 'openai';
    switchMainProtocol(mProto);
    if (mProto === 'claude') {
      const url = (c as any).claudeBaseUrl || c.baseUrl || '';
      const key = (c as any).claudeApiKey || c.apiKey || '';
      const model = (c as any).claudeModel || c.model || '';
      setLocalClaudeUrl(url);
      setLocalClaudeKey(key);
      setLocalClaudeModel(model);
      setLocalUrl(url);
      setLocalKey(key);
      setLocalModel(model);
    } else if (mProto === 'gemini') {
      const url = (c as any).geminiBaseUrl || c.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
      const key = (c as any).geminiApiKey || c.apiKey || '';
      const model = (c as any).geminiModel || c.model || 'gemini-2.0-flash';
      setLocalGeminiUrl(url);
      setLocalGeminiKey(key);
      setLocalGeminiModel(model);
      setLocalUrl(url);
      setLocalKey(key);
      setLocalModel(model);
    } else {
      setLocalUrl(c.baseUrl || '');
      setLocalKey(c.apiKey || '');
      setLocalModel(c.model || '');
    }
    setLocalProtocol(mProto);
    addToast(`已加载 API 预设: ${preset.name} (${mProto === 'claude' ? 'Claude' : mProto === 'gemini' ? 'Gemini' : 'OpenAI'})`, 'info');
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
  // 暮色 2026-07-15：副 API 预设（已有 memoryPalaceLight 这个 kind）
  const lightApiPresets = useMemo(
    () => apiPresets.filter((preset) => preset.kind === 'memoryPalaceLight'),
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
    const c: any = preset.config;
    if (kind === 'image') {
      const iProto: ApiProtocol = c.imageProtocol || 'openai';
      const iUrl = iProto === 'claude' ? c.imageClaudeBaseUrl
        : iProto === 'gemini' ? c.imageGeminiBaseUrl
        : c.imageBaseUrl;
      const iKey = iProto === 'claude' ? c.imageClaudeApiKey
        : iProto === 'gemini' ? c.imageGeminiApiKey
        : c.imageApiKey;
      const iModel = iProto === 'claude' ? c.imageClaudeModel
        : iProto === 'gemini' ? c.imageGeminiModel
        : c.imageModel;
      return (
        localImageProtocol === iProto &&
        (iUrl || '') === localImageUrl &&
        (iKey || '') === localImageKey &&
        (iModel || '') === localImageModel
      );
    }
    if (kind === 'vision') {
      // 暮色 2026-07-27：按 visionProtocol + 3 套字段比较（修显示串色 + 跨 tab 高亮）
      const vProto: 'openai' | 'claude' | 'gemini' = c.visionProtocol || 'openai';
      const vUrl = vProto === 'claude' ? c.visionClaudeBaseUrl
        : vProto === 'gemini' ? c.visionGeminiBaseUrl
        : c.visionBaseUrl;
      const vKey = vProto === 'claude' ? c.visionClaudeApiKey
        : vProto === 'gemini' ? c.visionGeminiApiKey
        : c.visionApiKey;
      const vModel = vProto === 'claude' ? c.visionClaudeModel
        : vProto === 'gemini' ? c.visionGeminiModel
        : c.visionModel;
      return localVisionProtocol === vProto
        && localVisionUrl === (vUrl || '')
        && localVisionKey === (vKey || '')
        && localVisionModel === (vModel || '');
    }
    if (kind === 'lightLLM') {
      // 暮色 2026-07-27：副 API 按 protocol + 3 套字段比较
      const lProto: 'openai' | 'claude' | 'gemini' = c.protocol || 'openai';
      const lUrl = lProto === 'claude' ? c.claudeBaseUrl
        : lProto === 'gemini' ? c.geminiBaseUrl
        : c.baseUrl;
      const lKey = lProto === 'claude' ? c.claudeApiKey
        : lProto === 'gemini' ? c.geminiApiKey
        : c.apiKey;
      const lModel = lProto === 'claude' ? c.claudeModel
        : lProto === 'gemini' ? c.geminiModel
        : c.model;
      return localLightProtocol === lProto
        && localLightUrl === (lUrl || '')
        && localLightKey === (lKey || '')
        && localLightModel === (lModel || '');
    }
    // main：暮色 2026-07-27：按 protocol + 3 套字段比较
    const mProto: 'openai' | 'claude' | 'gemini' = c.protocol || 'openai';
    const mUrl = mProto === 'claude' ? c.claudeBaseUrl
      : mProto === 'gemini' ? c.geminiBaseUrl
      : c.baseUrl;
    const mKey = mProto === 'claude' ? c.claudeApiKey
      : mProto === 'gemini' ? c.geminiApiKey
      : c.apiKey;
    const mModel = mProto === 'claude' ? c.claudeModel
      : mProto === 'gemini' ? c.geminiModel
      : c.model;
    return localProtocol === mProto
      && localUrl === (mUrl || '')
      && localKey === (mKey || '')
      && localModel === (mModel || '');
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
              {/* 暮色 2026-07-25：云端备份快捷入口移到第 1 个 section
                  — 暮色刚被恢复覆盖坑了 5 轮对话，要让备份/恢复操作最显眼 */}
              <QuickSection
                icon={<CloudArrowUp size={18} weight="bold" />}
                title="云端备份"
                subtitle={cloudBackupSubtitle}
                isOpen={openSection === 'cloudBackup'}
                onToggle={() => toggleSection('cloudBackup')}
              >
                <section className="bg-teal-50/80 rounded-3xl p-4 shadow-sm border border-teal-100/80 space-y-3">
                  {/* 状态条（已连接 + 去设置入口） */}
                  {isCloudBackupConfigured ? (
                    <div className="flex items-center justify-between rounded-2xl bg-emerald-50/80 border border-emerald-200/60 px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shrink-0" />
                        <span className="text-[11px] text-emerald-900 font-medium truncate">
                          {cloudBackupConfig.provider === 'github'
                            ? `GitHub${cloudBackupConfig.githubOwner ? ` @${cloudBackupConfig.githubOwner}` : ''}`
                            : 'WebDAV'} 已连接
                        </span>
                      </div>
                      <button onClick={handleOpenCloudSettings} className="text-[10px] text-emerald-700 font-bold hover:text-emerald-900 transition-colors shrink-0 ml-2">
                        去设置 →
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-amber-50/80 border border-amber-200/60 px-3 py-2.5 space-y-2">
                      <p className="text-[11px] text-amber-900 leading-relaxed">
                        还没配置云端备份。
                      </p>
                      <button onClick={handleOpenCloudSettings} className="w-full py-2 rounded-xl bg-amber-100 text-amber-800 text-[11px] font-bold active:scale-95 transition-all">
                        去设置配置 →
                      </button>
                    </div>
                  )}

                  {/* 上次备份时间 */}
                  {cloudBackupConfig.lastBackupTime && (
                    <p className="text-[10px] text-slate-400 text-center">
                      上次备份: {new Date(cloudBackupConfig.lastBackupTime).toLocaleString('zh-CN')}
                      {cloudBackupConfig.lastBackupSize && ` (${(cloudBackupConfig.lastBackupSize / 1024 / 1024).toFixed(1)} MB)`}
                    </p>
                  )}

                  {/* 2 个并排按钮（轻量同步 + 完整）— 暮色 2026-07-21：另一个按钮不强制 opacity-50，只"白底+浅灰文字+cursor-not-allowed"提示不可点 */}
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { mode: 'text_only' as const, label: '轻量同步', iconColor: 'text-sky-500', highlight: 'border-sky-300 bg-sky-50 text-slate-700' },
                      { mode: 'full' as const, label: '完整', iconColor: 'text-violet-500', highlight: 'border-violet-300 bg-violet-50 text-slate-700' },
                    ]).map(({ mode, label, iconColor, highlight }) => {
                      const isThisBackingUp = cloudBackingMode === mode;
                      const isOtherBackingUp = !!cloudBackingMode && !isThisBackingUp;
                      return (
                        <button
                          key={mode}
                          onClick={() => handleCloudBackupWithMode(mode)}
                          disabled={!!cloudBackingMode || !isCloudBackupConfigured}
                          className={`py-3 border rounded-xl text-xs font-bold shadow-sm transition-all flex flex-col items-center gap-1 ${
                            isThisBackingUp
                              ? `${highlight} cursor-wait`
                              : isOtherBackingUp
                                ? `bg-white border-slate-200 text-slate-300 cursor-not-allowed`  /* 暮色要：不强制 opacity-50，白底+浅灰文字 */
                                : `bg-white border-slate-200 text-slate-600 active:scale-95`
                          }`}
                        >
                          <CloudArrowUp size={16} weight="bold" className={iconColor} />
                          <span>备份到云端</span>
                          <span className="text-[9px] text-slate-400 font-normal">
                            {isThisBackingUp ? '备份中…' : label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-[10px] text-slate-400 leading-relaxed text-center px-1">
                    • 轻量同步：1-3MB · 完整：含图片/美化
                  </p>

                  {/* 1 个大按钮：从云端恢复 */}
                  <button
                    onClick={handleOpenCloudRestore}
                    disabled={!isCloudBackupConfigured || cloudRestoring}
                    className="w-full py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CloudArrowDown size={16} weight="bold" className="text-emerald-500" />
                    <span>{cloudRestoring ? '恢复中…' : '从云端恢复'}</span>
                  </button>
                </section>
              </QuickSection>

              <QuickSection
                icon={<Gear size={18} weight="bold" />}
                title="API 设置"
                subtitle="主 AI 通道"
                isOpen={openSection === 'main'}
                onToggle={() => toggleSection('main')}
              >
                <section className="bg-emerald-50/80 rounded-3xl p-4 shadow-sm border border-emerald-100/80 space-y-4">
                  <ProtocolTabs value={localProtocol} onChange={switchMainProtocol} />

                  <div>
                    <PresetHeader
                      label="从预设导入"
                      buttonClassName="bg-emerald-100 text-emerald-600"
                      onSave={() => handleSavePreset('main', '主 API 预设')}
                    />
                    {mainApiPresets.length > 0 ? (
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
                    ) : (
                      <p className="text-[10px] text-slate-400 pl-1">暂无预设</p>
                    )}
                  </div>

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
                subtitle="OpenAI 兼容"
                isOpen={openSection === 'image'}
                onToggle={() => toggleSection('image')}
              >
                <section className="bg-violet-50/80 rounded-3xl p-4 shadow-sm border border-violet-100/80 space-y-4">
                  <ProtocolTabs value={localImageProtocol} onChange={switchImageProtocol} />

                  <div>
                    <PresetHeader
                      label="从预设导入"
                      buttonClassName="bg-violet-100 text-violet-600"
                      onSave={() => handleSavePreset('image', '生图预设')}
                    />
                    {imageApiPresets.length > 0 ? (
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
                    ) : (
                      <p className="text-[10px] text-slate-400 pl-1">暂无预设</p>
                    )}
                  </div>

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

              {/* 暮色 2026-07-15：副 API（记忆宫殿后台处理用 lightLLM）— 接到浮窗换 API 方便 */}
              <QuickSection
                icon={<Brain size={18} weight="bold" />}
                title="副API"
                subtitle="记忆宫殿后台处理"
                isOpen={openSection === 'lightLLM'}
                onToggle={() => toggleSection('lightLLM')}
              >
                <section className="bg-emerald-50/80 rounded-3xl p-4 shadow-sm border border-emerald-100/80 space-y-4">
                  {/* 顶部：副 API 橙色提示框 — 跟 MemoryPalaceApp 同款 */}
                  <div className="rounded-2xl bg-amber-50/80 border border-amber-200/60 px-3 py-2.5">
                    <p className="text-[11px] text-amber-900 leading-relaxed">
                      下方不填（URL 留空）时，记忆宫殿会自动回退用主 API 跑后台处理。
                      想让后台任务走更便宜的账户 / 不想占主 API 额度，就在这里填一个便宜模型。
                      后台任务不需要推理力，挑一个每百万 token 几毛钱的模型即可。
                    </p>
                  </div>

                  <ProtocolTabs value={localLightProtocol} onChange={switchLightProtocol} />

                  {/* 副 API 预设（kind: memoryPalaceLight） */}
                  <div>
                    <PresetHeader
                      label="从预设导入"
                      buttonClassName="bg-emerald-100 text-emerald-600"
                      onSave={() => handleSavePreset('lightLLM', '记忆宫殿副 API')}
                    />
                    {lightApiPresets.length > 0 ? (
                      <div className="flex gap-2 flex-wrap">
                        {lightApiPresets.map((preset) => {
                          const active = isPresetActive(preset, 'lightLLM');
                          return (
                            <PresetChip
                              key={preset.id}
                              preset={preset}
                              active={active}
                              activeClassName="bg-emerald-50 border-emerald-200"
                              idleClassName="bg-white border-slate-200"
                              textActiveClassName="text-emerald-600"
                              textIdleClassName="text-slate-600 hover:text-emerald-500"
                              onLoad={() => loadPreset(preset, 'lightLLM')}
                              onRequestDelete={() => setPresetPendingDelete(preset)}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-400 pl-1">暂无预设</p>
                    )}
                  </div>

                  {/* BASE URL */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">BASE URL</label>
                    <input
                      type="text"
                      value={localLightUrl}
                      onChange={(e) => setLocalLightUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                    />
                  </div>

                  {/* API KEY（带显示 toggle） */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5 pl-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">API KEY</label>
                      <button onClick={() => setShowLightKey((v) => !v)} className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                        {showLightKey ? '隐藏' : '显示'}
                      </button>
                    </div>
                    <input
                      type={showLightKey ? 'text' : 'password'}
                      value={localLightKey}
                      onChange={(e) => setLocalLightKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                    />
                  </div>

                  {/* MODEL */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">MODEL</label>
                    <input
                      type="text"
                      value={localLightModel}
                      onChange={(e) => setLocalLightModel(e.target.value)}
                      placeholder="例如 deepseek-ai/DeepSeek-V2.5"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5 pl-1 leading-relaxed">
                      推荐：deepseek-ai/DeepSeek-V2.5 · Qwen/Qwen2.5-7B-Instruct · GLM-4-Flash
                    </p>
                  </div>

                  {/* 保存 + 测试 */}
                  <div className="space-y-2">
                    <button
                      onClick={handleSaveLightConfig}
                      className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-emerald-500/20 bg-emerald-500 active:scale-95 transition-all"
                    >
                      {lightStatusMsg && !lightTesting ? lightStatusMsg : '保存副 API 配置'}
                    </button>
                    <button
                      onClick={handleTestLight}
                      disabled={lightTesting || !localLightUrl.trim()}
                      className="w-full py-2.5 rounded-2xl font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 active:scale-95 transition-all disabled:opacity-50 text-sm"
                    >
                      {lightTesting ? '测试中...' : '测试 API 连接'}
                    </button>
                  </div>
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
                  <ProtocolTabs value={localVisionProtocol} onChange={switchVisionProtocol} />

                  <div>
                    <PresetHeader
                      label="从预设导入"
                      buttonClassName="bg-sky-100 text-sky-600"
                      onSave={() => handleSavePreset('vision', '识图预设')}
                    />
                    {visionApiPresets.length > 0 ? (
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
                    ) : (
                      <p className="text-[10px] text-slate-400 pl-1">暂无预设</p>
                    )}
                  </div>

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
              {/* 暮色 2026-07-15：删 ComfyUI 模式下未选 model 提示 — 只剩 OpenAI 兼容，没这个限制 */}
            </div>
          </div>

        </div>
      ) : null}

      {/* 暮色 2026-07-21：从云端恢复弹窗（仿 Settings）— 列文件 + 点选直接调 cloudRestoreFromWebDAV */}
      {showCloudRestoreModal ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" onClick={() => setShowCloudRestoreModal(false)}>
          {/* 暮色 2026-07-21：遮罩透明度 40 → 60（跟 Settings 全局进度弹窗一致），避免底层 section 透过来"重影" */}
          <div className="absolute inset-0 bg-black/60" />
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="text-base font-bold text-slate-700">从云端恢复</div>
              <button onClick={() => setShowCloudRestoreModal(false)} className="p-1.5 hover:bg-slate-100 rounded-full">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {cloudBackupFiles.length === 0 ? (
                /* 暮色 2026-07-21：加 spinner，遮罩改 60 后"正在加载"还是要更明显 — 用户反映"以为没管用" */
                <div className="text-center py-8 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-slate-200 border-t-emerald-500 rounded-full animate-spin" />
                  <p className="text-[11px] text-slate-500">正在加载云端备份列表…</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cloudBackupFiles.map((file, i) => (
                    <button
                      key={i}
                      onClick={() => handleCloudRestoreFile(file)}
                      className="w-full p-3 bg-white border border-slate-200 rounded-xl text-left hover:bg-sky-50 hover:border-sky-200 transition-colors active:scale-[0.98]"
                    >
                      <p className="text-[11px] text-slate-700 font-medium truncate">{file.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-slate-400">
                          {file.lastModified ? new Date(file.lastModified).toLocaleString('zh-CN') : '未知时间'}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {file.size > 0 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : ''}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 暮色 2026-07-21：项目级进度弹窗（备份/恢复中显示）— 仿 Settings 那个全局进度弹窗
          - 触发：sysOperation.status === 'processing'（由 cloudBackupToWebDAV / cloudRestoreFromWebDAV 内部 set）
          - 暮色反馈：之前悬浮窗点备份看不到加载弹窗，因为这个弹窗只在 Settings 页面渲染
          - 现在悬浮窗自己监听 sysOperation 渲染一份，覆盖所有触发路径（包括 Settings 触发的也兼容——会叠 2 个弹窗？）
            实际上 PhoneShell 根级也可能加一份；目前先只在 ApiQuickFloat 加，Settings 触发时 Settings 弹窗 + 悬浮窗弹窗会同时显示
            — 如果会冲突再把 Settings 那份删掉，统一在 PhoneShell 加 */}
      {sysOperation.status === 'processing' ? (
        <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 w-64">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
            <div className="text-sm font-bold text-slate-700 text-center">{sysOperation.message || '处理中…'}</div>
            {sysOperation.progress > 0 && (
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${sysOperation.progress}%` }} />
              </div>
            )}
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
            {/* 暮色 2026-07-15 反馈按钮挤在一起。前面 4 次只改了 footer 容器（flex→grid, mx-2→mx-4→px-2），
                漏了关键一点：grid grid-cols-2 只分列，按钮还得 w-full 才能填满列宽度。
                没 w-full 时按钮宽度 = 文字宽度（"取消"/"删除" 各 2 字），渲染成两个小圆挤在列左。
                参考左边"消息操作"弹窗 ChatModals.tsx:435 的 pattern。 */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => setPresetPendingDelete(null)} className="w-full py-3 rounded-full bg-slate-100 text-slate-600 font-bold active:scale-95 transition-all">
                取消
              </button>
              <button
                onClick={() => {
                  removeApiPreset(presetPendingDelete.id);
                  addToast(`已删除预设: ${presetPendingDelete.name}`, 'success');
                  setPresetPendingDelete(null);
                }}
                className="w-full py-3 rounded-full bg-red-500 text-white font-bold active:scale-95 transition-all"
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
