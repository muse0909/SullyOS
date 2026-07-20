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
    // 暮色 2026-07-15：记忆宫殿副 API（lightLLM）接到悬浮窗 — 换时方便
    memoryPalaceConfig,
    updateMemoryPalaceConfig,
    // 暮色 2026-07-21：云端备份快捷入口（仿 Settings 云端备份页的精简版）
    //   - 3 按钮（轻量同步 / 完整 / 从云端恢复）+ 状态条 + "去设置" 跳转
    //   - 恢复弹窗在悬浮窗里直接弹，点文件直接调 cloudRestoreFromWebDAV（跟 Settings 一致，不二次确认）
    cloudBackupConfig,
    cloudBackupToWebDAV,
    cloudRestoreFromWebDAV,
    listCloudBackups,
    openApp,
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
  // 暮色 2026-07-17：API 协议（OpenAI / Claude）— 跟 Settings 同步
  const [localProtocol, setLocalProtocol] = useState<'openai' | 'claude'>(apiConfig.protocol || 'openai');

  const [localImageUrl, setLocalImageUrl] = useState(apiConfig.imageBaseUrl || '');
  const [localImageKey, setLocalImageKey] = useState(apiConfig.imageApiKey || '');
  const [localImageModel, setLocalImageModel] = useState(apiConfig.imageModel || '');
  // 暮色 2026-07-15：删 localImageGenProvider / comfyui* state — 生图只走 OpenAI 兼容

  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionBaseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionModel || '');

  // 暮色 2026-07-15：副 API（记忆宫殿后台处理用 lightLLM）— local state
  const [localLightUrl, setLocalLightUrl] = useState(memoryPalaceConfig?.lightLLM?.baseUrl || '');
  const [localLightKey, setLocalLightKey] = useState(memoryPalaceConfig?.lightLLM?.apiKey || '');
  const [localLightModel, setLocalLightModel] = useState(memoryPalaceConfig?.lightLLM?.model || '');

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
    // 暮色 2026-07-17：API 协议同步（Settings 改了这里也要跟着变）
    setLocalProtocol(apiConfig.protocol || 'openai');
    setLocalImageUrl(apiConfig.imageBaseUrl || '');
    setLocalImageKey(apiConfig.imageApiKey || '');
    setLocalImageModel(apiConfig.imageModel || '');
    // 暮色 2026-07-15：删 localImageGenProvider / localComfyuiSelectedModel 同步
    setLocalVisionUrl(apiConfig.visionBaseUrl || '');
    setLocalVisionKey(apiConfig.visionApiKey || '');
    setLocalVisionModel(apiConfig.visionModel || '');
    // 暮色 2026-07-15：同步副 API（记忆宫殿 lightLLM）— 抽原始字段做 deps，避免对象新引用触发重跑
    if (memoryPalaceConfig?.lightLLM) {
      setLocalLightUrl(memoryPalaceConfig.lightLLM.baseUrl || '');
      setLocalLightKey(memoryPalaceConfig.lightLLM.apiKey || '');
      setLocalLightModel(memoryPalaceConfig.lightLLM.model || '');
    }
  }, [
    apiConfig.baseUrl,
    apiConfig.apiKey,
    apiConfig.model,
    apiConfig.imageBaseUrl,
    apiConfig.imageApiKey,
    apiConfig.imageModel,
    // 暮色 2026-07-15：删 imageGenProvider — 永远 openai
    apiConfig.visionBaseUrl,
    apiConfig.visionApiKey,
    apiConfig.visionModel,
    memoryPalaceConfig?.lightLLM?.baseUrl,
    memoryPalaceConfig?.lightLLM?.apiKey,
    memoryPalaceConfig?.lightLLM?.model,
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

  // 暮色 2026-07-15：删 COMFYUI 常量 + testComfyuiConnection + comfyuiCanSave — 生图只走 OpenAI 兼容

  const handleSaveAndClose = () => {
    // 暮色 2026-07-15：删 ComfyUI / NAI 分支，只剩 OpenAI 兼容
    updateApiConfig({
      ...apiConfig,
      baseUrl: localUrl,
      apiKey: localKey,
      model: localModel,
      imageBaseUrl: localImageUrl,
      imageApiKey: localImageKey,
      imageModel: localImageModel,
      imageGenProvider: 'openai', // 暮色 2026-07-15：写死 openai，types 保留 'openai' | 'comfyui' | 'nai' 防以后再加回
      visionBaseUrl: localVisionUrl,
      visionApiKey: localVisionKey,
      visionModel: localVisionModel,
      // 暮色 2026-07-17：API 协议（跟 Settings 同步保存）
      protocol: localProtocol,
    });
    addToast('API 配置已保存', 'success');
    setShowPanel(false);
  };

  // 暮色 2026-07-15：副 API（lightLLM）— 单独保存，浮窗不自动关闭（跟主 API save 不同）
  const handleSaveLightConfig = () => {
    if (!memoryPalaceConfig || !updateMemoryPalaceConfig) {
      addToast('记忆宫殿配置未就绪', 'error');
      return;
    }
    updateMemoryPalaceConfig({
      lightLLM: {
        baseUrl: localLightUrl.trim(),
        apiKey: localLightKey.trim(),
        model: localLightModel.trim(),
      },
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

  // 暮色 2026-07-15：副 API 预设保存 — 弹窗输入名字，存到 apiPresets（kind: memoryPalaceLight）
  const handleSaveLightPreset = () => {
    const name = window.prompt('预设名称', '记忆宫殿副 API')?.trim();
    if (!name) return;
    addApiPreset(name, {
      baseUrl: localLightUrl.trim(),
      apiKey: localLightKey.trim(),
      model: localLightModel.trim(),
    }, 'memoryPalaceLight');
    addToast(`已保存副 API 预设: ${name}`, 'success');
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

  const loadPreset = (preset: ApiPreset, kind: QuickPresetKind) => {
    const c = preset.config;
    if (kind === 'image') {
      setLocalImageUrl(c.imageBaseUrl || '');
      setLocalImageKey(c.imageApiKey || '');
      setLocalImageModel(c.imageModel || '');
      // 暮色 2026-07-15：删 setLocalImageGenProvider — 生图只走 OpenAI 兼容
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
    if (kind === 'lightLLM') {
      // 暮色 2026-07-15：副 API 预设加载 — 用 preset.config.baseUrl/apiKey/model
      // （apiConfig 字段就是 baseUrl/apiKey/model 三个 — 跟 memoryPalaceConfig.lightLLM 一致）
      setLocalLightUrl(c.baseUrl || '');
      setLocalLightKey(c.apiKey || '');
      setLocalLightModel(c.model || '');
      addToast(`已加载副 API 预设: ${preset.name}`, 'info');
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

                  {/* 暮色 2026-07-17：API 协议切换（从 Settings 高级挪出来，方便快速切） */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1 text-center">API 协议</label>
                    <div className="flex gap-1.5 bg-slate-100/60 p-1 rounded-full">
                      <button
                        type="button"
                        onClick={() => setLocalProtocol('openai')}
                        className={`flex-1 py-1.5 text-[11px] font-bold rounded-full transition-all ${localProtocol === 'openai' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                      >OpenAI</button>
                      <button
                        type="button"
                        onClick={() => setLocalProtocol('claude')}
                        className={`flex-1 py-1.5 text-[11px] font-bold rounded-full transition-all ${localProtocol === 'claude' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-500'}`}
                      >Claude</button>
                    </div>
                    {localProtocol === 'claude' && (
                      <p className="text-[9px] text-amber-500 mt-1.5 leading-relaxed text-center">⚠️ Claude 模式要求服务端支持 /v1/messages + cache_control 透传</p>
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
                  {/* 暮色 2026-07-15：删顶部"当前使用"状态条 — 只有一个 provider，section 标题已经说"生图"+ subtitle "OpenAI 兼容"，冗余 */}
                  {/* 暮色 2026-07-15：删 3 档服务商切换，只剩 OpenAI 兼容 */}

                  {/* === OpenAI 卡片（暮色 2026-07-15：永远是 OpenAI，去掉条件渲染） === */}
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

                  {/* 副 API 预设（kind: memoryPalaceLight） */}
                  {lightApiPresets.length > 0 ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">从预设导入</label>
                        <button onClick={handleSaveLightPreset} className="text-[10px] bg-emerald-100 text-emerald-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">
                          保存为预设
                        </button>
                      </div>
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
                    </div>
                  ) : (
                    <div className="flex justify-end">
                      <button onClick={handleSaveLightPreset} className="text-[10px] bg-emerald-100 text-emerald-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">
                        保存为预设
                      </button>
                    </div>
                  )}

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

              {/* 暮色 2026-07-21：云端备份快捷入口（第 5 个 section，仿 Settings 云端备份页精简版） */}
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

                  {/* 2 个并排按钮（轻量同步 + 完整） */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleCloudBackupWithMode('text_only')}
                      disabled={!!cloudBackingMode || !isCloudBackupConfigured}
                      className="py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CloudArrowUp size={16} weight="bold" className="text-sky-500" />
                      <span>备份到云端</span>
                      <span className="text-[9px] text-slate-400 font-normal">
                        {cloudBackingMode === 'text_only' ? '备份中…' : '轻量同步'}
                      </span>
                    </button>
                    <button
                      onClick={() => handleCloudBackupWithMode('full')}
                      disabled={!!cloudBackingMode || !isCloudBackupConfigured}
                      className="py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CloudArrowUp size={16} weight="bold" className="text-violet-500" />
                      <span>备份到云端</span>
                      <span className="text-[9px] text-slate-400 font-normal">
                        {cloudBackingMode === 'full' ? '备份中…' : '完整'}
                      </span>
                    </button>
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
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="text-base font-bold text-slate-700">从云端恢复</div>
              <button onClick={() => setShowCloudRestoreModal(false)} className="p-1.5 hover:bg-slate-100 rounded-full">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {cloudBackupFiles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-[11px] text-slate-400">正在加载云端备份列表…</p>
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
