import ApiLogPanel from "../components/settings/ApiLogPanel";
import { useApiLogStore } from "../hooks/useApiLogStore";

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { safeResponseJson } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import { NotionManager, FeishuManager } from '../utils/realtimeContext';
import { XhsMcpClient } from '../utils/xhsMcpClient';
import { getMcdToken, setMcdToken as saveMcdToken, isMcdEnabled, setMcdEnabled as saveMcdEnabled, testMcdConnection, resetMcdSession } from '../utils/mcdMcpClient';
import { Sun, Newspaper, NotePencil, Notebook, Book, ForkKnife, Terminal } from '@phosphor-icons/react';
import { loadPushConfig, savePushConfig, registerScheduleOnWorker, startHeartbeat, stopHeartbeat, isPushConfigAvailable, ensureSubscribed, sendTestPush, getPushDiagnostics, resetSubscription, type PushDiagnostics } from '../utils/proactivePushConfig';
import { ProactiveChat } from '../utils/proactiveChat';
import { useApiLogStore } from '../hooks/useApiLogStore';
const DiagRow: React.FC<{ label: string; value: string; bad?: boolean }> = ({ label, value, bad }) => (
    <div className="flex items-start justify-between gap-3">
        <span className="text-slate-500 shrink-0">{label}</span>
        <span className={`text-right ${bad ? 'text-rose-600 font-medium' : 'text-slate-700'}`}>{value}</span>
    </div>
);

const Settings: React.FC = () => {
  const {
      apiConfig, updateApiConfig, closeApp, availableModels, setAvailableModels,
      exportSystem, importSystem, addToast, resetSystem,
      apiPresets, addApiPreset, removeApiPreset,
      sysOperation, // Get progress state
      realtimeConfig, updateRealtimeConfig, // 实时感知配置
      cloudBackupConfig, updateCloudBackupConfig,
      cloudBackupToWebDAV, cloudRestoreFromWebDAV, listCloudBackups,
  } = useOS();
  
  const [localKey, setLocalKey] = useState(apiConfig.apiKey);
  const [localUrl, setLocalUrl] = useState(apiConfig.baseUrl);
  const [localModel, setLocalModel] = useState(apiConfig.model);
  const [localVisionUrl, setLocalVisionUrl] = useState(apiConfig.visionBaseUrl || '');
  const [localVisionKey, setLocalVisionKey] = useState(apiConfig.visionApiKey || '');
  const [localVisionModel, setLocalVisionModel] = useState(apiConfig.visionModel || '');
const [localImageUrl, setLocalImageUrl] = useState(apiConfig.imageBaseUrl || '');
const [localImageKey, setLocalImageKey] = useState(apiConfig.imageApiKey || '');
const [localImageModel, setLocalImageModel] = useState(apiConfig.imageModel || '');
const [localStream, setLocalStream] = useState<boolean>(apiConfig.stream === true);
  const [localTemperature, setLocalTemperature] = useState<number>(
    typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85
  );
    const [localTtsProvider, setLocalTtsProvider] = useState<'minimax' | 'volink'>(apiConfig.ttsProvider || 'minimax');
const [localVolinkTtsBaseUrl, setLocalVolinkTtsBaseUrl] = useState(apiConfig.volinkTtsBaseUrl || '');
const [localVolinkTtsApiKey, setLocalVolinkTtsApiKey] = useState(apiConfig.volinkTtsApiKey || '');
const [localVolinkTtsVoice, setLocalVolinkTtsVoice] = useState(apiConfig.volinkTtsVoice || '');
const [localVolinkTtsModel, setLocalVolinkTtsModel] = useState(apiConfig.volinkTtsModel || '');
const [ttsStatusMsg, setTtsStatusMsg] = useState('');
    
  const [localMiniMaxKey, setLocalMiniMaxKey] = useState(apiConfig.minimaxApiKey || '');
  const [localMiniMaxGroupId, setLocalMiniMaxGroupId] = useState(apiConfig.minimaxGroupId || '');
  const [localMiniMaxRegion, setLocalMiniMaxRegion] = useState<'domestic' | 'overseas'>(
    apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic'
  );
  const [localAceStepKey, setLocalAceStepKey] = useState(apiConfig.aceStepApiKey || '');
  const [showAceStepGuide, setShowAceStepGuide] = useState(false);
  const [otherStatusMsg, setOtherStatusMsg] = useState('');
  // 高级设置（流式/温度）默认折叠 — 大多数用户不需要碰
  const [showApiAdvanced, setShowApiAdvanced] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  
  // UI States
  const [showModelModal, setShowModelModal] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [showExportModal, setShowExportModal] = useState(false); // Used for completion now
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showRealtimeModal, setShowRealtimeModal] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [showGithubModal, setShowGithubModal] = useState(false);
  const [showCloudRestoreModal, setShowCloudRestoreModal] = useState(false);
  const [cloudBackupFiles, setCloudBackupFiles] = useState<import('../types').CloudBackupFile[]>([]);
  const [cloudTestResult, setCloudTestResult] = useState<string>('');
  const [cloudTesting, setCloudTesting] = useState(false);

  // Cloud backup local config state (WebDAV)
  const [cbUrl, setCbUrl] = useState(cloudBackupConfig.webdavUrl);
  const [cbUsername, setCbUsername] = useState(cloudBackupConfig.username);
  const [cbPassword, setCbPassword] = useState(cloudBackupConfig.password);
  const [cbPath, setCbPath] = useState(cloudBackupConfig.remotePath || '/SullyBackup/');

  // GitHub local state
  const [ghToken, setGhToken] = useState(cloudBackupConfig.githubToken || '');
  const [ghRepo, setGhRepo] = useState(cloudBackupConfig.githubRepo || 'sully-backup');
  // Default proxy ON — most users in mainland China can't reach github.com
  // directly. Only flip to false if the user has explicitly opted out before.
  const [ghUseProxy, setGhUseProxy] = useState(cloudBackupConfig.githubUseProxy !== false);
  const [ghShowAdvanced, setGhShowAdvanced] = useState(false);
  const [ghTesting, setGhTesting] = useState(false);
  const [ghTestResult, setGhTestResult] = useState<string>('');

  // 实时感知配置的本地状态
  const [rtWeatherEnabled, setRtWeatherEnabled] = useState(realtimeConfig.weatherEnabled);
  const [rtWeatherKey, setRtWeatherKey] = useState(realtimeConfig.weatherApiKey);
  const [rtWeatherCity, setRtWeatherCity] = useState(realtimeConfig.weatherCity);
  const [rtNewsEnabled, setRtNewsEnabled] = useState(realtimeConfig.newsEnabled);
  const [rtNewsApiKey, setRtNewsApiKey] = useState(realtimeConfig.newsApiKey || '');
  const [rtNotionEnabled, setRtNotionEnabled] = useState(realtimeConfig.notionEnabled);
  const [rtNotionKey, setRtNotionKey] = useState(realtimeConfig.notionApiKey);
  const [rtNotionDbId, setRtNotionDbId] = useState(realtimeConfig.notionDatabaseId);
  const [rtNotionNotesDbId, setRtNotionNotesDbId] = useState(realtimeConfig.notionNotesDatabaseId || '');
  const [rtFeishuEnabled, setRtFeishuEnabled] = useState(realtimeConfig.feishuEnabled);
  const [rtFeishuAppId, setRtFeishuAppId] = useState(realtimeConfig.feishuAppId);
  const [rtFeishuAppSecret, setRtFeishuAppSecret] = useState(realtimeConfig.feishuAppSecret);
  const [rtFeishuBaseId, setRtFeishuBaseId] = useState(realtimeConfig.feishuBaseId);
  const [rtFeishuTableId, setRtFeishuTableId] = useState(realtimeConfig.feishuTableId);
  const [rtXhsEnabled, setRtXhsEnabled] = useState(realtimeConfig.xhsEnabled);
  const [rtXhsMcpEnabled, setRtXhsMcpEnabled] = useState(realtimeConfig.xhsMcpConfig?.enabled || false);
  const [rtXhsMcpUrl, setRtXhsMcpUrl] = useState(realtimeConfig.xhsMcpConfig?.serverUrl || 'http://localhost:18060/mcp');
  const [rtXhsNickname, setRtXhsNickname] = useState(realtimeConfig.xhsMcpConfig?.loggedInNickname || '');
  const [rtXhsUserId, setRtXhsUserId] = useState(realtimeConfig.xhsMcpConfig?.loggedInUserId || '');
  const [rtTestStatus, setRtTestStatus] = useState('');

  // 麦当劳 MCP (token / 启用态都直接存 localStorage, 不进 realtimeConfig)
  const [mcdToken, setMcdTokenState] = useState(() => getMcdToken());
  const [mcdEnabled, setMcdEnabledState] = useState(() => isMcdEnabled());
  const [mcdTestStatus, setMcdTestStatus] = useState('');
  const [mcdTesting, setMcdTesting] = useState(false);

  // Proactive Push 加速器（Worker URL / VAPID 公钥写死在 proactivePushConfig.ts 常量里）
  const initialPushCfg = loadPushConfig();
  const ppAvailable = isPushConfigAvailable();
  const [ppEnabled, setPpEnabled] = useState(initialPushCfg.enabled);
  const [ppStatus, setPpStatus] = useState<string>('');
  const [ppBusy, setPpBusy] = useState(false);
  const [showPpConfirm, setShowPpConfirm] = useState(false);
  const [ppDiag, setPpDiag] = useState<PushDiagnostics | null>(null);
  const [ppTestBusy, setPpTestBusy] = useState(false);
  const [ppResetBusy, setPpResetBusy] = useState(false);

  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const toggleSection = (id: string) => setExpandedSection(prev => prev === id ? null : id);

  // 模型选择 Modal 的过滤 + 公共前缀（memo 掉，避免每次 Settings 重渲染都重算）
  const modelPickerView = useMemo(() => {
      const q = modelFilter.trim().toLowerCase();
      const filtered = q ? availableModels.filter(m => m.toLowerCase().includes(q)) : availableModels;
      let commonPrefix = '';
      if (filtered.length >= 2) {
          let p = filtered[0];
          for (let i = 1; i < filtered.length; i++) {
              const s = filtered[i];
              let j = 0;
              while (j < p.length && j < s.length && p[j] === s[j]) j++;
              p = p.slice(0, j);
              if (!p) break;
          }
          const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('-'));
          if (cut > 3) p = p.slice(0, cut + 1);
          if (p.length >= 4) commonPrefix = p;
      }
      return { filtered, commonPrefix };
  }, [modelFilter, availableModels]);

  const SettingsSection: React.FC<{
    id: string;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    statusText?: string;
    statusColor?: string;
    children: React.ReactNode;
  }> = ({ id, icon, title, subtitle, statusText, statusColor, children }) => {
    const isOpen = expandedSection === id;
    return (
      <div className="mb-3">
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center gap-3 px-4 py-4 bg-white/70 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm active:scale-[0.98] transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center text-lg shrink-0">
            {icon}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-bold text-slate-800">{title}</div>
            <div className="text-[11px] text-slate-400 truncate">{subtitle}</div>
          </div>
          {statusText && (
            <span className={`text-[10px] font-semibold mr-1 ${statusColor || 'text-slate-400'}`}>
              {statusText}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-300 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        {isOpen && (
          <div className="mt-2 px-1 animate-fadeIn">
            {children}
          </div>
        )}
      </div>
    );
  };

  const refreshPpDiag = useCallback(async () => {
      try { setPpDiag(await getPushDiagnostics()); } catch { /* ignore */ }
  }, []);

  const doEnablePushAccelerator = async () => {
      if (ppBusy) return;
      setPpBusy(true);
      setPpStatus('正在连接 Worker…');
      try {
          const res = await fetch(`${initialPushCfg.workerUrl}/health`);
          if (!res.ok) { setPpStatus(`失败：Worker HTTP ${res.status}`); setPpBusy(false); return; }
      } catch (e: any) {
          setPpStatus(`失败：${e?.message || '网络错误'}`); setPpBusy(false); return;
      }

      setPpStatus('正在请求通知权限并创建订阅…');
      const sub = await ensureSubscribed();
      if (!sub.ok) {
          setPpStatus(`失败：${sub.reason || '订阅创建失败'}`);
          setPpBusy(false);
          await refreshPpDiag();
          return;
      }

      savePushConfig(true);
      setPpEnabled(true);
      startHeartbeat();

      const schedules = ProactiveChat.getSchedules();
      let okCount = 0;
      for (const s of schedules) {
          if (await registerScheduleOnWorker(s.charId, s.intervalMs)) okCount++;
      }

      if (schedules.length === 0) {
          setPpStatus('已启用（订阅已建立。暂无主动消息定时，下次开启角色主动消息时会自动注册）');
      } else if (okCount < schedules.length) {
          setPpStatus(`已启用：${okCount}/${schedules.length} 个定时注册成功`);
      } else {
          setPpStatus(`已启用，${okCount} 个主动消息定时已注册`);
      }
      setPpBusy(false);
      await refreshPpDiag();
  };

  const doDisablePushAccelerator = async () => {
      savePushConfig(false);
      setPpEnabled(false);
      stopHeartbeat();
      setPpStatus('已关闭（主动消息退回本地计时器）');
      await refreshPpDiag();
  };

  const doSendTestPush = async () => {
      if (ppTestBusy) return;
      setPpTestBusy(true);
      setPpStatus('正在让 Worker 发一条测试推送…');
      const res = await sendTestPush();
      if (res.ok) {
          setPpStatus('测试推送已发出。如果 5 秒内系统通知里没出现"推送测试成功"，说明送达环节有问题——看下方诊断面板。');
      } else if (res.deadSubscription) {
          setPpStatus('订阅已被浏览器吊销（zombie endpoint）。请点下方"重置订阅"重建一次再测。');
      } else {
          setPpStatus(`测试失败：${res.reason || '未知错误'}${res.status ? `（HTTP ${res.status}）` : ''}`);
      }
      setPpTestBusy(false);
      await refreshPpDiag();
  };

  const doResetSubscription = async () => {
      if (ppResetBusy) return;
      setPpResetBusy(true);
      setPpStatus('正在重置订阅…');
      const res = await resetSubscription();
      if (res.ok) {
          setPpStatus('订阅已重建。可以再点"发一条测试推送"试一下。');
      } else {
          setPpStatus(`重置失败：${res.reason || '未知错误'}`);
      }
      setPpResetBusy(false);
      await refreshPpDiag();
  };

  useEffect(() => {
      void refreshPpDiag();
  }, [refreshPpDiag, ppEnabled]);

  const [downloadUrl, setDownloadUrl] = useState<string>('');
  
  const [statusMsg, setStatusMsg] = useState('');
  const [testingApi, setTestingApi] = useState(false);
  const [visionStatusMsg, setVisionStatusMsg] = useState('');
  const [imageStatusMsg, setImageStatusMsg] = useState('');
  const [testApiResult, setTestApiResult] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
      setLocalUrl(apiConfig.baseUrl);
      setLocalKey(apiConfig.apiKey);
      setLocalModel(apiConfig.model);
      setLocalStream(apiConfig.stream === true);
      setLocalTemperature(typeof apiConfig.temperature === 'number' ? apiConfig.temperature : 0.85);
      setLocalMiniMaxKey(apiConfig.minimaxApiKey || '');
      setLocalMiniMaxGroupId(apiConfig.minimaxGroupId || '');
      setLocalMiniMaxRegion(apiConfig.minimaxRegion === 'overseas' ? 'overseas' : 'domestic');
      setLocalAceStepKey(apiConfig.aceStepApiKey || '');
      setLocalTtsProvider(apiConfig.ttsProvider || 'minimax');
setLocalVolinkTtsBaseUrl(apiConfig.volinkTtsBaseUrl || '');
setLocalVolinkTtsApiKey(apiConfig.volinkTtsApiKey || '');
setLocalVolinkTtsVoice(apiConfig.volinkTtsVoice || '');
setLocalVolinkTtsModel(apiConfig.volinkTtsModel || '');
  }, [apiConfig]);

  const loadPreset = (preset: typeof apiPresets[0]) => {
      setLocalUrl(preset.config.baseUrl);
      setLocalKey(preset.config.apiKey);
      setLocalModel(preset.config.model);
      setLocalStream(preset.config.stream === true);
      setLocalTemperature(typeof preset.config.temperature === 'number' ? preset.config.temperature : 0.85);
      addToast(`已加载配置: ${preset.name}`, 'info');
  };

  const handleSavePreset = () => {
      if (!newPresetName.trim()) {
          addToast('请输入预设名称', 'error');
          return;
      }
      addApiPreset(newPresetName, {
        baseUrl: localUrl,
        apiKey: localKey,
        model: localModel,
        stream: localStream,
        temperature: localTemperature,
      });
      setNewPresetName('');
      setShowPresetModal(false);
      addToast('预设已保存', 'success');
  };

    const handleSaveApi = () => {
    updateApiConfig({
      ...apiConfig,
      apiKey: localKey,
      baseUrl: localUrl,
      model: localModel,
      stream: localStream,
      temperature: localTemperature,
    });
    setStatusMsg('配置已保存');
    setTimeout(() => setStatusMsg(''), 2000);
  };

     const handleSaveVisionApi = () => {
    updateApiConfig({
      ...apiConfig,
      visionBaseUrl: localVisionUrl,
      visionApiKey: localVisionKey,
      visionModel: localVisionModel,
    });
    setVisionStatusMsg('识图配置已保存'); 
    setTimeout(() => setVisionStatusMsg(''), 2000); 
  };

const handleSaveImageApi = () => {
    updateApiConfig({
      ...apiConfig,
      imageBaseUrl: localImageUrl,
      imageApiKey: localImageKey,
      imageModel: localImageModel,
    });
    setImageStatusMsg('生图配置已保存');
    setTimeout(() => setImageStatusMsg(''), 2000);
  };
    
const handleSaveTts = () => {
  updateApiConfig({
    ...apiConfig,
    ttsProvider: localTtsProvider,
    volinkTtsBaseUrl: localVolinkTtsBaseUrl,
    volinkTtsApiKey: localVolinkTtsApiKey,
    volinkTtsVoice: localVolinkTtsVoice,
    volinkTtsModel: localVolinkTtsModel,
  });
  setTtsStatusMsg('已保存');
  setTimeout(() => setTtsStatusMsg(''), 2000);
};

  const handleSaveOtherApis = () => {
    updateApiConfig({
      minimaxApiKey: localMiniMaxKey,
      minimaxGroupId: localMiniMaxGroupId,
      minimaxRegion: localMiniMaxRegion,
      aceStepApiKey: localAceStepKey,
    });
    setOtherStatusMsg('已保存');
    setTimeout(() => setOtherStatusMsg(''), 2000);
  };

  const fetchModels = async () => {
    if (!localUrl) { setStatusMsg('请先填写 URL'); return; }
    setIsLoadingModels(true);
    setStatusMsg('正在连接...');
    try {
        const baseUrl = localUrl.replace(/\/+$/, '');
        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${localKey}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await safeResponseJson(response);
        const list = data.data || data.models || [];
        if (Array.isArray(list)) {
            const models = list.map((m: any) => m.id || m);
            setAvailableModels(models);
            if (models.length > 0 && !models.includes(localModel)) setLocalModel(models[0]);
            setStatusMsg(`获取到 ${models.length} 个模型`);
            setShowModelModal(true);
        } else { setStatusMsg('格式不兼容'); }
    } catch (error: any) {
        console.error(error);
        setStatusMsg('连接失败');
    } finally {
        setIsLoadingModels(false);
    }
  };

  const handleExport = async (mode: 'text_only' | 'media_only' | 'full') => {
      try {
          const blob = await exportSystem(mode);
          
          if (Capacitor.isNativePlatform()) {
              const reader = new FileReader();
              reader.readAsDataURL(blob);
              reader.onloadend = async () => {
                  const base64data = String(reader.result);
                  const fileName = `Sully_Backup_${mode}_${Date.now()}.zip`;
                  
                  try {
                      await Filesystem.writeFile({
                          path: fileName,
                          data: base64data,
                          directory: Directory.Cache,
                      });
                      const uriResult = await Filesystem.getUri({
                          directory: Directory.Cache,
                          path: fileName,
                      });
                      await Share.share({
                          title: `Sully Backup`,
                          files: [uriResult.uri],
                      });
                  } catch (e) {
                      console.error("Native write failed", e);
                      addToast("保存文件失败", "error");
                  }
              };
          } else {
              const url = URL.createObjectURL(blob);
              setDownloadUrl(url);
              setShowExportModal(true);
              
              const a = document.createElement('a');
              a.href = url;
              a.download = `Sully_Backup_${mode}_${new Date().toISOString().slice(0,10)}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
          }
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      importSystem(file).catch(err => {
          console.error(err);
          addToast(err.message || '恢复失败', 'error');
      });
      if (importInputRef.current) importInputRef.current.value = '';
  };

  const handleTestCloudConnection = async () => {
      setCloudTesting(true);
      setCloudTestResult('');
      try {
          const { testConnection } = await import('../utils/webdavClient');
          const tempConfig = { ...cloudBackupConfig, webdavUrl: cbUrl, username: cbUsername, password: cbPassword, remotePath: cbPath };
          const result = await testConnection(tempConfig);
          setCloudTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
      } catch (e: any) {
          setCloudTestResult(`✗ ${e.message}`);
      }
      setCloudTesting(false);
  };

  const handleSaveCloudConfig = () => {
      updateCloudBackupConfig({
          enabled: true,
          provider: 'webdav',
          webdavUrl: cbUrl, username: cbUsername, password: cbPassword,
          remotePath: cbPath,
      });
      addToast('云端备份配置已保存', 'success');
      setShowCloudModal(false);
  };

  const handleCloudBackup = async (mode: 'text_only' | 'full') => {
      try { await cloudBackupToWebDAV(mode); } catch { /* toast handled in context */ }
  };

  const handleOpenCloudRestore = async () => {
      setShowCloudRestoreModal(true);
      setCloudBackupFiles([]);
      try {
          const files = await listCloudBackups();
          setCloudBackupFiles(files);
      } catch { addToast('获取云端备份列表失败', 'error'); }
  };

  const handleCloudRestore = async (file: import('../types').CloudBackupFile) => {
      setShowCloudRestoreModal(false);
      try { await cloudRestoreFromWebDAV(file); } catch { /* toast handled in context */ }
  };

  const handleTestGithub = async () => {
      if (!ghToken.trim()) { setGhTestResult('✗ 请先粘贴 Token'); return; }
      setGhTesting(true);
      setGhTestResult('');
      try {
          const { testConnection } = await import('../utils/githubClient');
          const result = await testConnection({
              ...cloudBackupConfig,
              githubToken: ghToken.trim(),
              githubRepo: ghRepo.trim() || 'sully-backup',
              githubUseProxy: ghUseProxy,
          });
          setGhTestResult(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
          if (result.ok && result.login) {
              updateCloudBackupConfig({
                  enabled: true,
                  provider: 'github',
                  githubToken: ghToken.trim(),
                  githubOwner: result.login,
                  githubRepo: ghRepo.trim() || 'sully-backup',
                  githubUseProxy: ghUseProxy,
              });
          }
      } catch (e: any) {
          setGhTestResult(`✗ ${e?.message || '连接失败'}`);
      }
      setGhTesting(false);
  };

  const handleDisableCloud = () => {
      updateCloudBackupConfig({ enabled: false });
      setShowCloudModal(false);
      setShowGithubModal(false);
      addToast('云端备份已关闭', 'info');
  };

  const switchToGithub = () => {
      if (cloudBackupConfig.githubToken && cloudBackupConfig.githubOwner) {
          updateCloudBackupConfig({ provider: 'github' });
          addToast(`已切换到 GitHub @${cloudBackupConfig.githubOwner}`, 'success');
      } else {
          setShowGithubModal(true);
      }
  };
  const switchToWebDAV = () => {
      if (cloudBackupConfig.webdavUrl && cloudBackupConfig.username) {
          updateCloudBackupConfig({ provider: 'webdav' });
          addToast('已切换回 WebDAV，旧备份依旧在', 'success');
      } else {
          setShowCloudModal(true);
      }
  };

  const confirmReset = () => {
      resetSystem();
      setShowResetConfirm(false);
  };

  const handleSaveRealtimeConfig = () => {
      updateRealtimeConfig({
          weatherEnabled: rtWeatherEnabled,
          weatherApiKey: rtWeatherKey,
          weatherCity: rtWeatherCity,
          newsEnabled: rtNewsEnabled,
          newsApiKey: rtNewsApiKey,
          notionEnabled: rtNotionEnabled,
          notionApiKey: rtNotionKey,
          notionDatabaseId: rtNotionDbId,
          notionNotesDatabaseId: rtNotionNotesDbId || undefined,
          feishuEnabled: rtFeishuEnabled,
          feishuAppId: rtFeishuAppId,
          feishuAppSecret: rtFeishuAppSecret,
          feishuBaseId: rtFeishuBaseId,
          feishuTableId: rtFeishuTableId,
          xhsEnabled: rtXhsEnabled,
          xhsMcpConfig: {
              enabled: rtXhsMcpEnabled,
              serverUrl: rtXhsMcpUrl,
              loggedInNickname: rtXhsNickname || undefined,
              loggedInUserId: rtXhsUserId || undefined,
              userXsecToken: realtimeConfig.xhsMcpConfig?.userXsecToken,
          }
      });
      addToast('实时感知配置已保存', 'success');
      setShowRealtimeModal(false);
  };

  const testWeatherApi = async () => {
      if (!rtWeatherKey) { setRtTestStatus('请先填写 API Key'); return; }
      setRtTestStatus('正在测试...');
      try {
          const url = `https://api.openweathermap.org/data/2.5/weather?q=${rtWeatherCity}&appid=${rtWeatherKey}&units=metric&lang=zh_cn`;
          const res = await fetch(url);
          if (res.ok) {
              const data = await safeResponseJson(res);
              setRtTestStatus(`连接成功！${data.name}: ${data.weather[0]?.description}, ${Math.round(data.main.temp)}°C`);
          } else { setRtTestStatus(`连接失败: HTTP ${res.status}`); }
      } catch (e: any) { setRtTestStatus(`网络错误: ${e.message}`); }
  };

  const testNotionApi = async () => {
      if (!rtNotionKey || !rtNotionDbId) { setRtTestStatus('请填写 Notion API Key 和 Database ID'); return; }
      setRtTestStatus('正在测试 Notion 连接...');
      try { const result = await NotionManager.testConnection(rtNotionKey, rtNotionDbId); setRtTestStatus(result.message); }
      catch (e: any) { setRtTestStatus(`网络错误: ${e.message}`); }
  };

  const testFeishuApi = async () => {
      if (!rtFeishuAppId || !rtFeishuAppSecret || !rtFeishuBaseId || !rtFeishuTableId) { setRtTestStatus('请填写飞书配置'); return; }
      setRtTestStatus('正在测试飞书连接...');
      try { const result = await FeishuManager.testConnection(rtFeishuAppId, rtFeishuAppSecret, rtFeishuBaseId, rtFeishuTableId); setRtTestStatus(result.message); }
      catch (e: any) { setRtTestStatus(`网络错误: ${e.message}`); }
  };

  const testXhsMcp = async () => {
      if (!rtXhsMcpUrl) { setRtTestStatus('请填写 Bridge Server URL'); return; }
      setRtTestStatus('正在连接 MCP Server...');
      try {
          const result = await XhsMcpClient.testConnection(rtXhsMcpUrl);
          if (result.connected) {
              const toolCount = result.tools?.length || 0;
              const tokenInfo = result.xsecToken ? ' | xsecToken 已获取' : '';
              const loginInfo = result.loggedIn ? ` | ${result.nickname ? `账号: ${result.nickname}` : '已登录'}${result.userId ? ` (ID: ${result.userId})` : ''}${tokenInfo}` : ' | 未登录';
              setRtTestStatus(`连接成功! ${toolCount} 个功能可用${loginInfo}`);
              if (result.nickname && !rtXhsNickname) setRtXhsNickname(result.nickname);
              if (result.userId && !rtXhsUserId) setRtXhsUserId(result.userId);
              updateRealtimeConfig({
                  xhsMcpConfig: {
                      enabled: rtXhsMcpEnabled, serverUrl: rtXhsMcpUrl,
                      loggedInNickname: rtXhsNickname || result.nickname,
                      loggedInUserId: rtXhsUserId || result.userId,
                      userXsecToken: result.xsecToken,
                  }
              });
          } else { setRtTestStatus(`连接失败: ${result.error}`); }
      } catch (e: any) { setRtTestStatus(`网络错误: ${e.message}`); }
  };

  const handleMcdTokenChange = (v: string) => { setMcdTokenState(v); saveMcdToken(v); resetMcdSession(); setMcdTestStatus(''); };
  const handleMcdEnabledChange = (v: boolean) => { setMcdEnabledState(v); saveMcdEnabled(v); if (!v) resetMcdSession(); };
  const testMcdApi = async () => {
      if (!mcdToken.trim()) { setMcdTestStatus('请先填写 MCP Token'); return; }
      setMcdTesting(true); setMcdTestStatus('正在连接麦当劳 MCP...');
      try {
          const r = await testMcdConnection();
          if (r.ok) { const names = (r.tools || []).map(t => t.name).slice(0, 6).join(', '); setMcdTestStatus(`✅ ${r.message}${names ? `\n工具: ${names}${(r.tools || []).length > 6 ? ' ...' : ''}` : ''}`); }
          else { setMcdTestStatus(`❌ ${r.message}`); }
      } catch (e: any) { setMcdTestStatus(`❌ ${e?.message || String(e)}`); } finally { setMcdTesting(false); }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-50/80 to-white/90 overflow-hidden">
      {sysOperation.status === 'processing' && (
          <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center animate-fade-in">
              <div className="bg-white p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 w-64">
                  <div className="w-12 h-12 border-4 border-slate-200 border-t-primary rounded-full animate-spin"></div>
                  <div className="text-sm font-bold text-slate-700">{sysOperation.message}</div>
                  {sysOperation.progress > 0 && (
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${sysOperation.progress}%` }}></div>
                      </div>
                  )}
              </div>
          </div>
      )}

      <div className="flex items-center gap-3 px-4 pt-3 pb-2 shrink-0">
        <button onClick={closeApp} className="p-1 -ml-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-xl font-black text-slate-800">系统设置</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
        {/* 1 - ZIP */}
        <SettingsSection id="zipBackup" icon="💾" title="ZIP 备份" subtitle="导出/导入数据·格式化系统">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-blue-100 rounded-xl text-blue-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" /></svg>
              </div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">备份与恢复 (ZIP)</h2>
            </div>
            <div className="mb-3">
              <button onClick={() => handleExport('full')} className="w-full py-4 bg-gradient-to-r from-violet-500 to-purple-600 border border-violet-300 rounded-xl text-xs font-bold text-white shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 relative overflow-hidden mb-3">
                <div className="absolute top-0 right-0 px-1.5 py-0.5 bg-white/20 text-[9px] text-white rounded-bl-lg font-bold">完整</div>
                <div className="p-2 bg-white/20 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg></div>
                <span>整合导出 (文字+媒体)</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-400 px-1 mb-3 text-center">以下为分步导出，适合低配设备分次备份</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <button onClick={() => handleExport('text_only')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 relative overflow-hidden">
                <div className="p-2 bg-blue-50 rounded-full text-blue-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg></div>
                <span>纯文字备份</span>
              </button>
               <button onClick={() => handleExport('media_only')} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2">
                <div className="p-2 bg-pink-50 rounded-full text-pink-500"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" /></svg></div>
                <span>媒体与美化素材</span>
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 mb-4">
               <div onClick={() => importInputRef.current?.click()} className="py-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-2 cursor-pointer hover:bg-emerald-50 hover:border-emerald-200">
                <div className="p-2 bg-emerald-100 rounded-full text-emerald-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg></div>
                <span>导入备份 (.zip / .json)</span>
              </div>
              <input type="file" ref={importInputRef} className="hidden" accept=".json,.zip" onChange={handleImport} />
            </div>
            <p className="text-[10px] text-slate-400 px-1 mb-4 leading-relaxed">
              • <b>整合导出</b>: 一次性导出所有数据（文字+媒体），适合设备性能充足的用户。<br/>
              • <b>纯文字备份</b>: 包含所有聊天记录、角色设定、剧情数据。所有图片会被移除（减小体积）。<br/>
              • <b>媒体与美化素材</b>: 导出相册、表情包、聊天图片、头像、主题气泡、壁纸、图标等图片资源和外观配置。<br/>
              • 兼容旧版 JSON 备份文件的导入。
            </p>
            <button onClick={() => setShowResetConfirm(true)} className="w-full py-3 bg-red-50 border border-red-100 text-red-500 rounded-xl text-xs font-bold flex items-center justify-center gap-2">
              格式化系统 (出厂设置)
            </button>
          </section>
        </SettingsSection>

        {/* 2 - 云端备份 */}
        <SettingsSection id="cloudBackup" icon="☁️" title="云端备份" subtitle="GitHub / WebDAV">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-sky-100 rounded-xl text-sky-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>
              </div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">云端备份</h2>
            </div>
            {!cloudBackupConfig.enabled ? (
              <div className="space-y-3 py-2">
                <p className="text-[11px] text-slate-400 leading-relaxed text-center">把备份上传到你自己的云端，换设备、丢手机都不怕。<br/>国内推荐 <b>GitHub</b>（不用梯子，2GB/份）。</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setShowGithubModal(true)} className="py-3 px-2 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1.5 relative">
                    <span className="absolute top-1 right-1.5 text-[8px] bg-amber-300 text-slate-800 px-1.5 py-0.5 rounded-full font-bold">推荐</span>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                    <span>GitHub</span>
                    <span className="text-[9px] text-slate-300 font-normal">不用梯子 · 2GB</span>
                  </button>
                  <button onClick={() => setShowCloudModal(true)} className="py-3 px-2 bg-gradient-to-br from-sky-500 to-blue-600 text-white rounded-xl text-xs font-bold shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>
                    <span>WebDAV</span>
                    <span className="text-[9px] text-sky-100 font-normal">日本/NAS · 需梯子</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className={`flex items-center justify-between rounded-xl px-3 py-2 ${cloudBackupConfig.provider === 'github' ? 'bg-slate-100' : 'bg-sky-50'}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <span className="text-[11px] text-slate-600 font-medium">已连接 · {cloudBackupConfig.provider === 'github' ? `GitHub${cloudBackupConfig.githubOwner ? ` (@${cloudBackupConfig.githubOwner})` : ''}` : 'WebDAV'}</span>
                  </div>
                  <button onClick={() => cloudBackupConfig.provider === 'github' ? setShowGithubModal(true) : setShowCloudModal(true)} className={`text-[10px] font-medium ${cloudBackupConfig.provider === 'github' ? 'text-slate-600' : 'text-sky-500'}`}>修改配置</button>
                </div>
                {cloudBackupConfig.provider === 'github' && cloudBackupConfig.githubOwner && (
                  <a href={`https://github.com/${cloudBackupConfig.githubOwner}/${cloudBackupConfig.githubRepo || 'sully-backup'}/releases`} target="_blank" rel="noopener noreferrer" className="block text-center text-[10px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline transition-colors">🔗 在 GitHub 上查看备份 ↗</a>
                )}
                {cloudBackupConfig.provider !== 'github' ? (
                  <>
                    <button onClick={switchToGithub} className="w-full py-2 bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-xl text-[11px] font-bold shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                      <span>{cloudBackupConfig.githubToken ? '切换到 GitHub' : '试试 GitHub 备份（不用梯子 · 2GB/份）'}</span>
                    </button>
                    <p className="text-[10px] text-slate-400 text-center">你 WebDAV 上的旧备份不会被动，可随时切回。</p>
                  </>
                ) : (
                  <button onClick={switchToWebDAV} className="w-full py-1.5 text-[10px] text-slate-400 hover:text-sky-500 transition-colors">{cloudBackupConfig.webdavUrl ? '切换回 WebDAV →' : '改用 WebDAV 备份 →'}</button>
                )}
                {cloudBackupConfig.lastBackupTime && (
                  <p className="text-[10px] text-slate-400 text-center">上次备份: {new Date(cloudBackupConfig.lastBackupTime).toLocaleString('zh-CN')}{cloudBackupConfig.lastBackupSize && ` (${(cloudBackupConfig.lastBackupSize / 1024 / 1024).toFixed(1)} MB)`}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => handleCloudBackup('text_only')} className="py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-sky-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                    <span>备份到云端</span><span className="text-[9px] text-slate-400">(纯文字)</span>
                  </button>
                  <button onClick={() => handleCloudBackup('full')} className="py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex flex-col items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-violet-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                    <span>备份到云端</span><span className="text-[9px] text-slate-400">(完整)</span>
                  </button>
                </div>
                <button onClick={handleOpenCloudRestore} className="w-full py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                  从云端恢复
                </button>
              </div>
            )}
            <p className="text-[10px] text-slate-400 px-1 mt-3 leading-relaxed">数据存储在你自己的账号下，我们不保存任何凭据到服务器。</p>
          </section>
        </SettingsSection>

        {/* 3 - API */}
        <SettingsSection id="api" icon="🔗" title="API 配置" subtitle="主 AI 连接·深度沉浸模式"
          statusText={apiConfig.baseUrl ? '' : '未配置'} statusColor="text-slate-400">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
             <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-100/50 rounded-xl text-emerald-600">
                   <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" /></svg>
                </div>
                <h2 className="text-sm font-semibold text-slate-600 tracking-wider">API 配置</h2>
              </div>
              <button onClick={() => setShowPresetModal(true)} className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">保存为预设</button>
            </div>
            {apiPresets.length > 0 && (
              <div className="mb-4">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">我的预设 (Presets)</label>
                <div className="flex gap-2 flex-wrap">
                  {apiPresets.map(preset => (
                    <div key={preset.id} className="flex items-center bg-white border border-slate-200 rounded-lg pl-3 pr-1 py-1 shadow-sm">
                      <span onClick={() => loadPreset(preset)} className="text-xs font-medium text-slate-600 cursor-pointer hover:text-primary mr-2">{preset.name}</span>
                      <button onClick={() => removeApiPreset(preset.id)} className="p-1 rounded-full text-slate-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">URL</label>
                <input type="text" value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} placeholder="https://..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
              </div>
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Key</label>
                <input type="password" value={localKey} onChange={(e) => setLocalKey(e.target.value)} placeholder="sk-..." className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
              </div>
              <div className="pt-1">
                <button type="button" onClick={() => setShowApiAdvanced(v => !v)} className="text-[10px] text-slate-300 hover:text-slate-400 transition-colors flex items-center gap-1 pl-1 active:scale-95">
                  <span>高级（不建议修改）</span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-2.5 h-2.5 transition-transform ${showApiAdvanced ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                </button>
                {showApiAdvanced && (
                  <div className="mt-2 pl-2 border-l-2 border-slate-100 space-y-3 py-2">
                    <p className="text-[10px] text-slate-300 leading-relaxed">这两项绝大多数用户保持默认即可。除非接口报错"only stream supported"或对回复风格有强需求，否则不建议改。</p>
                    <div className="flex items-center justify-between">
                      <div><span className="text-[10px] text-slate-400">流式输出 (Stream)</span><p className="text-[9px] text-slate-300 mt-0.5">仅在你的 API 强制要求时打开</p></div>
                      <button type="button" onClick={() => setLocalStream(v => !v)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${localStream ? 'bg-slate-400' : 'bg-slate-200'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${localStream ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div>
                      <div className="flex items-center justify-between"><span className="text-[10px] text-slate-400">温度 (Temperature)</span><span className="text-[10px] font-mono text-slate-400">{localTemperature.toFixed(2)}</span></div>
                      <input type="range" min="0" max="2" step="0.05" value={localTemperature} onChange={(e) => setLocalTemperature(parseFloat(e.target.value))} className="w-full accent-slate-400 mt-1" />
                      <p className="text-[9px] text-slate-300 mt-0.5">默认 0.85；只作用于聊天和约会的主回复</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-2">
                 <div className="flex justify-between items-center mb-1.5 pl-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model</label>
                  <button onClick={fetchModels} disabled={isLoadingModels} className="text-[10px] text-primary font-bold">{isLoadingModels ? 'Fetching...' : '刷新模型列表'}</button>
                </div>
                <button onClick={() => setShowModelModal(true)} title={localModel || 'Select Model...'} className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-3 text-sm text-slate-700 flex justify-between items-center gap-2 active:bg-white transition-all shadow-sm">
                  <span className="font-mono overflow-hidden whitespace-nowrap min-w-0 flex-1 text-left" style={{ direction: 'rtl', textOverflow: 'ellipsis' }}><bdi style={{ direction: 'ltr' }}>{localModel || 'Select Model...'}</bdi></span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-slate-400 flex-shrink-0"><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                </button>
              </div>
              <button onClick={handleSaveApi} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-primary/20 bg-primary active:scale-95 transition-all mt-2">{statusMsg || '保存配置'}</button>
              <button onClick={async () => { if (!localUrl.trim() || !localKey.trim() || !localModel.trim()) return; setTestingApi(true); setTestApiResult(null); try { const res = await fetch(`${localUrl.trim().replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localKey.trim()}` }, body: JSON.stringify({ model: localModel.trim(), messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5, stream: localStream, }) }); if (res.ok) { const data = await safeResponseJson(res); const reply = data.choices?.[0]?.message?.content || ''; setTestApiResult(`✅ 连接成功 — 模型回复: "${reply.slice(0, 30)}"`); } else { const text = await res.text().catch(() => ''); setTestApiResult(`❌ HTTP ${res.status}: ${text.slice(0, 100)}`); } } catch (err: any) { setTestApiResult(`❌ 连接失败: ${err.message}`); } finally { setTestingApi(false); } }} disabled={testingApi || !localUrl.trim() || !localKey.trim() || !localModel.trim()} className={`w-full py-2.5 rounded-2xl font-bold text-sm border mt-2 active:scale-95 transition-all ${testingApi || !localUrl.trim() || !localKey.trim() || !localModel.trim() ? 'border-slate-200 text-slate-400 bg-slate-50' : 'border-primary/30 text-primary bg-primary/5 hover:bg-primary/10'}`}>{testingApi ? '测试中...' : '🧪 测试连接'}</button>
              {testApiResult && (<div className={`mt-2 text-xs px-3 py-2 rounded-xl ${testApiResult.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{testApiResult}</div>)}
            </div>
          </section>
        </SettingsSection>

        {/* 4 - 识图 */}
        <SettingsSection id="secondaryApi" icon="🖼️" title="识图配置" subtitle="独立识图通道">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-blue-100/50 rounded-xl text-blue-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg></div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">独立识图配置</h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed pl-1">当检测到图片时，系统将自动切换到此通道。支持 Gemini / GPT-4o / Claude 3.5 等。</p>
            <div className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">识图模型 URL</label>
                <input type="text" value={localVisionUrl} onChange={(e) => setLocalVisionUrl(e.target.value)} placeholder="例如: https://api.openai.com/v1" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
              </div>
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">识图模型 Key</label>
                <input type="password" value={localVisionKey} onChange={(e) => setLocalVisionKey(e.target.value)} placeholder="填入该地址对应的 API Key" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
              </div>
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">识图模型名字 (Model)</label>
                <input type="text" value={localVisionModel} onChange={(e) => setLocalVisionModel(e.target.value)} placeholder="例如: gemini-1.5-flash" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
              </div>
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">图床 imgbb API Key</label>
                <input type="password" value={(apiConfig as any)?.imgbbApiKey || ''} onChange={(e) => updateApiConfig({ ...apiConfig, imgbbApiKey: e.target.value })} placeholder="imgbb.com 注册后免费获取" className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 border-slate-200" />
                <p className="text-[10px] text-slate-300 mt-1 pl-1">配置后发图自动上传图床转 URL，解决卡顿</p>
              </div>
              <button onClick={handleSaveVisionApi} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-blue-500/20 bg-blue-500 active:scale-95 transition-all mt-2">{visionStatusMsg || '保存识图配置'}</button>
              <p className="text-[10px] text-center text-slate-300 italic mt-2">提示：修改后请点击此按钮生效</p>
            </div>
          </section>
        </SettingsSection>

        {/* 5 - TTS */}
        <SettingsSection id="tts" icon="🔊" title="语音合成" subtitle="MiniMax / ElevenLabs·通话声线">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border-white/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-purple-100/50 rounded-xl text-purple-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" /></svg>
              </div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">语音 TTS</h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed pl-1">AI 回复自动转语音。选择服务商后填写对应配置，角色页可单独设置声音 ID。</p>
            <div className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">TTS 服务商</label>
                <div className="flex bg-white/50 border border-slate-200/60 rounded-xl p-1 gap-1">
                  <button type="button" onClick={() => setLocalTtsProvider('minimax')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${localTtsProvider === 'minimax' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>MiniMax</button>
                  <button type="button" onClick={() => setLocalTtsProvider('volink')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${localTtsProvider === 'volink' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>Volink</button>
                </div>
              </div>
              {localTtsProvider === 'minimax' && (
                <div className="rounded-2xl bg-slate-50/80 border border-slate-200/50 px-4 py-3"><p className="text-[11px] text-slate-500 leading-relaxed">使用下方「其他 API」里的 MiniMax Key / Group ID / 服务器配置。角色声音 ID 在角色编辑页设置。</p></div>
              )}
              {localTtsProvider === 'volink' && (
                <>
                  <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Volink Base URL</label><input type="text" value={localVolinkTtsBaseUrl} onChange={(e) => setLocalVolinkTtsBaseUrl(e.target.value)} placeholder="https://api.volink.ai（留空用默认）" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /></div>
                  <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Volink API Key</label><input type="password" value={localVolinkTtsApiKey} onChange={(e) => setLocalVolinkTtsApiKey(e.target.value)} placeholder="Volink API Key" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /></div>
                  <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">默认声音 ID</label><input type="text" value={localVolinkTtsVoice} onChange={(e) => setLocalVolinkTtsVoice(e.target.value)} placeholder="从 Volink 账户复制声音 ID" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /><p className="text-[11px] text-slate-400 mt-1 pl-1">角色单独设置了声音 ID 时优先用角色的，否则用这里的默认值。</p></div>
                  <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">模型 (可选)</label><input type="text" value={localVolinkTtsModel} onChange={(e) => setLocalVolinkTtsModel(e.target.value)} placeholder="tts-1（留空用默认）" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /><p className="text-[11px] text-slate-400 mt-1 pl-1">例如 tts-1、tts-1-hd、gpt-4o-mini-tts，具体看 Volink 账户支持的模型。</p></div>
                </>
              )}
            </div>
            <button onClick={handleSaveTts} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-purple-500/20 bg-purple-500 active:scale-95 transition-all mt-4">{ttsStatusMsg || '保存语音配置'}</button>
          </section>
        </SettingsSection>

        {/* 6 - STT */}
        <SettingsSection id="stt" icon="🎙️" title="语音识别" subtitle="Groq / 硅基流动 STT">
          <div className="py-6 text-center text-xs text-slate-400">语音识别使用 Groq Whisper，通话时自动启用，无需额外配置。</div>
        </SettingsSection>

        {/* 7 - 生图 */}
        <SettingsSection id="imageGen" icon="🎨" title="生图服务" subtitle="NAI / OpenAI·分离风格"
          statusText={apiConfig.imageBaseUrl ? '' : '未配置'} statusColor="text-slate-400">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-purple-100/50 rounded-xl text-purple-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg></div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">独立生图配置</h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed pl-1">AI 需要画图时将调用此通道。支持 GPT Image / DALL·E 3 等图像生成模型。</p>
            <div className="space-y-4">
              <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">生图模型 URL</label><input type="text" value={localImageUrl} onChange={(e) => setLocalImageUrl(e.target.value)} placeholder="例如: https://api.openai.com/v1" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /></div>
              <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">生图模型 Key</label><input type="password" value={localImageKey} onChange={(e) => setLocalImageKey(e.target.value)} placeholder="填入该地址对应的 API Key" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /></div>
              <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">生图模型名字 (Model)</label><input type="text" value={localImageModel} onChange={(e) => setLocalImageModel(e.target.value)} placeholder="例如: gpt-image-1" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /></div>
              <button onClick={handleSaveImageApi} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-purple-500/20 bg-purple-500 active:scale-95 transition-all mt-2">{imageStatusMsg || '保存生图配置'}</button>
            </div>
          </section>
        </SettingsSection>

        {/* 8 - 实时感知 */}
        <SettingsSection id="realtime" icon="🌐" title="实时感知" subtitle="天气 / 资讯 / 微博热搜 / 笔记与日程"
          statusText={(rtWeatherEnabled || rtNewsEnabled) ? '' : '未开启'} statusColor="text-slate-400">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-violet-100/50 rounded-xl text-violet-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg></div>
                <h2 className="text-sm font-semibold text-slate-600 tracking-wider">实时感知</h2>
              </div>
              <button onClick={() => setShowRealtimeModal(true)} className="text-[10px] bg-violet-100 text-violet-600 px-3 py-1.5 rounded-full font-bold shadow-sm active:scale-95 transition-transform">配置</button>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">让AI角色感知真实世界：天气、新闻热点、当前时间。角色可以根据天气关心你、聊聊最近的热点话题。</p>
            <div className="grid grid-cols-5 gap-2 text-center">
              {[
                { key: 'rtWeatherEnabled', label: '天气', sun: true },
                { key: 'rtNewsEnabled', label: '新闻', sun: false },
                { key: 'rtNotionEnabled', label: 'Notion', sun: false },
                { key: 'rtFeishuEnabled', label: '飞书', sun: false },
                { key: 'rtXhsEnabled', label: '小红书', sun: false },
              ].map(({ key, label }) => {
                const enabled = key === 'rtWeatherEnabled' ? rtWeatherEnabled : key === 'rtNewsEnabled' ? rtNewsEnabled : key === 'rtNotionEnabled' ? rtNotionEnabled : key === 'rtFeishuEnabled' ? rtFeishuEnabled : rtXhsEnabled;
                return (
                  <div key={key} className={`py-3 rounded-xl text-xs font-bold ${enabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                    <div className="text-lg mb-1">{enabled ? '✅' : '❌'}</div>
                    {label}
                  </div>
                );
              })}
            </div>
          </section>
        </SettingsSection>

        {/* 9 - 其他API */}
        <SettingsSection id="proactive" icon="🤖" title="其他API" subtitle="MiniMax / Replicate·独立API">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 bg-amber-100/50 rounded-xl text-amber-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" /></svg></div>
              <h2 className="text-sm font-semibold text-slate-600 tracking-wider">其他 API</h2>
            </div>
            <p className="text-[11px] text-slate-400 mb-4 leading-relaxed pl-1">语音 / 写歌等非 LLM 类 API。这些设置 <span className="font-semibold text-slate-500">不会随预设切换</span>，通常只配置一次。</p>
            <div className="space-y-4">
              <div className="group">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">MiniMax 服务器</label>
                <div className="flex bg-white/50 border border-slate-200/60 rounded-xl p-1 gap-1">
                  <button type="button" onClick={() => setLocalMiniMaxRegion('domestic')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${localMiniMaxRegion === 'domestic' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>国服</button>
                  <button type="button" onClick={() => setLocalMiniMaxRegion('overseas')} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${localMiniMaxRegion === 'overseas' ? 'bg-primary text-white shadow-sm' : 'text-slate-600 active:bg-white/60'}`}>海外</button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 pl-1">{localMiniMaxRegion === 'overseas' ? '海外站（api.minimax.io）— 请使用海外账号签发的 Key。' : '国服（api.minimaxi.com）— 默认，适配国内账号。'}</p>
              </div>
              <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">MiniMax Key (可选)</label><input type="password" value={localMiniMaxKey} onChange={(e) => setLocalMiniMaxKey(e.target.value)} placeholder="MiniMax API Secret（留空则复用 Key）" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /><p className="text-[11px] text-slate-400 mt-1 pl-1">电话 / 音色查询优先使用这个 Key，空着时回退通用 Key。</p></div>
              <div className="group"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">MiniMax Group ID (可选)</label><input type="text" value={localMiniMaxGroupId} onChange={(e) => setLocalMiniMaxGroupId(e.target.value)} placeholder="group_id（部分账号/模型需要）" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" /><p className="text-[11px] text-slate-400 mt-1 pl-1">如控制台给了 group_id，请填这里；会透传到 TTS 请求体和代理日志。</p></div>
              <div className="group">
                <div className="flex items-center justify-between mb-1.5 pl-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">写歌 · Replicate Token (可选)</label>
                  <button type="button" onClick={() => setShowAceStepGuide(v => !v)} className="text-[10px] font-semibold text-rose-500 hover:text-rose-600 active:scale-95 transition-all flex items-center gap-1">{showAceStepGuide ? '收起' : '怎么拿？'}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 transition-transform ${showAceStepGuide ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg></button>
                </div>
                <input type="password" value={localAceStepKey} onChange={(e) => setLocalAceStepKey(e.target.value)} placeholder="r8_xxx（写歌 App 调 ACE-Step 出整首歌用）" className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white transition-all" />
                <p className="text-[11px] text-slate-400 mt-1 pl-1">填了之后写歌 App 的歌词页能一键调 ACE-Step 出真人声整首歌（约 ¥0.1/首，走 sfworker 代理免梯子）。</p>
                {showAceStepGuide && (
                  <div className="mt-3 rounded-2xl overflow-hidden border border-rose-200/60 bg-gradient-to-br from-rose-50 via-orange-50 to-amber-50 shadow-sm animate-slide-down">
                    <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 border-b border-rose-200/40">
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center text-base shadow-sm shadow-rose-500/30">🎤</div>
                      <div className="flex-1"><div className="text-[12px] font-bold text-stone-700">3 步搞定 Replicate Token</div><div className="text-[10px] text-stone-500">让 ACE-Step 帮你把歌唱出来</div></div>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      <div className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">1</span><div className="flex-1 min-w-0"><div className="text-[12px] text-stone-700 font-medium">注册 Replicate 账号</div><p className="text-[11px] text-stone-500 leading-relaxed mt-0.5">用 GitHub 一键登录最快。</p></div></div>
                      <div className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-orange-500 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">2</span><div className="flex-1 min-w-0"><div className="text-[12px] text-stone-700 font-medium">复制 API Token</div><p className="text-[11px] text-stone-500 leading-relaxed mt-0.5">复制以 r8_ 开头的那一串。</p></div></div>
                      <div className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">3</span><div className="flex-1 min-w-0"><div className="text-[12px] text-stone-700 font-medium">绑卡充值</div><p className="text-[11px] text-stone-500 leading-relaxed mt-0.5">Replicate 需绑信用卡。</p></div></div>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={handleSaveOtherApis} className="w-full py-3 rounded-2xl font-bold text-white shadow-lg shadow-amber-500/20 bg-amber-500 active:scale-95 transition-all mt-2">{otherStatusMsg || '保存其他 API'}</button>
            </div>
          </section>
        </SettingsSection>

        {/* 10 - 消息加速 */}
        <SettingsSection id="proactivePush" icon="🔔" title="消息加速" subtitle="主动消息频率·推送通知">
          {ppAvailable && (
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-teal-100/60 rounded-xl text-teal-600"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" /></svg></div>
                <h2 className="text-sm font-semibold text-slate-600 tracking-wider">主动消息 Push 加速</h2>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${ppEnabled ? 'bg-teal-100 text-teal-600' : 'bg-slate-100 text-slate-400'}`}>{ppEnabled ? '已启用' : '未启用'}</span>
            </div>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">让主动消息在浏览器后台标签里也能准点触发。AI 仍在本地生成，云端只管"到点喊醒浏览器"。</p>
            {ppStatus && (<div className={`mb-3 p-3 rounded-xl text-xs font-medium text-center ${ppStatus.includes('成功') || ppStatus.includes('已启用') || ppStatus.includes('OK') ? 'bg-emerald-100 text-emerald-700' : ppStatus.includes('失败') || ppStatus.includes('错误') || ppStatus.includes('拒绝') ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-600'}`}>{ppStatus}</div>)}
            <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
              <div><p className="text-[11px] text-slate-600 font-medium">启用 Push 加速</p><p className="text-[10px] text-slate-400">关闭则退回纯本地计时器</p></div>
              <button disabled={ppBusy} onClick={() => { if (ppBusy) return; if (ppEnabled) { void doDisablePushAccelerator(); } else { setShowPpConfirm(true); } }} className={`w-10 h-5 rounded-full transition-colors ${ppEnabled ? 'bg-teal-500' : 'bg-slate-300'} ${ppBusy ? 'opacity-60' : ''}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${ppEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <div className="mt-4 bg-slate-50/70 rounded-2xl p-4 border border-slate-100">
              <div className="flex items-center justify-between mb-3"><p className="text-xs font-semibold text-slate-600">Web Push 状态</p><button onClick={() => void refreshPpDiag()} className="text-[10px] px-2.5 py-1 rounded-full bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">刷新</button></div>
              {ppDiag ? (
                <div className="space-y-1.5 text-[11px]">
                  <DiagRow label="浏览器支持" value={ppDiag.capacitorNative ? '否（当前在 App 里运行）' : ppDiag.supported ? '是' : '否'} bad={!ppDiag.supported || ppDiag.capacitorNative} />
                  <DiagRow label="通知权限" value={ppDiag.permission === 'granted' ? '已授权' : ppDiag.permission === 'denied' ? '已拒绝' : ppDiag.permission === 'default' ? '未决定' : '不可用'} bad={ppDiag.permission !== 'granted'} />
                  <DiagRow label="Service Worker" value={ppDiag.swState === 'activated' ? '已激活' : ppDiag.swState === 'none' ? '未注册' : ppDiag.swState || '?'} bad={ppDiag.swState !== 'activated'} />
                  <DiagRow label="订阅" value={!ppDiag.endpoint ? '不存在' : ppDiag.endpointDead ? '已失效' : '已建立'} bad={!ppDiag.endpoint || ppDiag.endpointDead} />
                </div>
              ) : (<p className="text-[10px] text-slate-400">加载中…</p>)}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button disabled={ppTestBusy || ppResetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative} onClick={() => void doSendTestPush()} className={`py-2 rounded-xl text-xs font-bold ${ppTestBusy || ppResetBusy || !ppDiag?.endpoint || ppDiag?.endpointDead || ppDiag?.capacitorNative ? 'bg-slate-200 text-slate-400' : 'bg-teal-500 text-white hover:bg-teal-600'}`}>{ppTestBusy ? '测试中…' : '发一条测试推送'}</button>
                <button disabled={ppResetBusy || ppTestBusy || ppDiag?.capacitorNative} onClick={() => void doResetSubscription()} className={`py-2 rounded-xl text-xs font-bold border ${ppResetBusy || ppTestBusy || ppDiag?.capacitorNative ? 'bg-slate-100 text-slate-400 border-slate-200' : ppDiag?.endpointDead ? 'bg-rose-500 text-white border-rose-500 hover:bg-rose-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{ppResetBusy ? '重置中…' : '重置订阅'}</button>
              </div>
            </div>
          </section>
          )}
        </SettingsSection>

        {/* 11 - API Log */}
        <SettingsSection id="apiLog" icon="📋" title="API 请求账本" subtitle="本地调试日志·脱敏导出">
          <section className="bg-white/80 rounded-3xl p-5 shadow-sm border border-white/50">
            <ApiLogPanel />
          </section>
        </SettingsSection>

        <div className="text-center text-[10px] text-slate-300 pb-8 font-mono tracking-widest uppercase mt-2">
          v2.2 (Realtime Awareness)
        </div>
      </div>

      {/* Modals */}
      <Modal isOpen={showPpConfirm} title="启用 Push 加速？" onClose={() => setShowPpConfirm(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => setShowPpConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button><button onClick={() => { setShowPpConfirm(false); void doEnablePushAccelerator(); }} className="flex-1 py-3 bg-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-teal-200">我知道了，启用</button></div>}>
        <div className="space-y-3 text-[12px] leading-relaxed text-slate-600">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3"><p className="font-bold text-amber-800 mb-1">启用后会做三件事</p><ol className="list-decimal pl-4 space-y-1 text-amber-900"><li>浏览器会弹允许通知对话框</li><li>生成推送订阅凭证，上传到 Cloudflare</li><li>开标签页时每 2 分钟发心跳</li></ol></div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3"><p className="font-bold text-emerald-800 mb-1">谁能看到什么</p><div className="space-y-1.5 text-emerald-900"><p>Cloudflare 只能看到推送订阅凭证 + 角色 ID（随机字符串）+ 间隔分钟数。看不到聊天内容。</p></div></div>
        </div>
      </Modal>

      <Modal isOpen={showCloudModal} title="云端备份配置" onClose={() => setShowCloudModal(false)}>
        <div className="space-y-4 p-1">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3"><p className="text-[10px] text-rose-700 leading-relaxed"><b>🪜 需要梯子</b><br/>InfiniCloud 是日本的服务，国内直连通常打不开。</p></div>
          <div><label className="text-[11px] text-slate-500 font-medium mb-1 block">WebDAV 地址</label><input type="url" value={cbUrl} onChange={(e) => setCbUrl(e.target.value)} placeholder="https://xxx.infini-cloud.net/dav/" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[11px] text-slate-500 font-medium mb-1 block">用户名</label><input type="text" value={cbUsername} onChange={(e) => setCbUsername(e.target.value)} className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700" /></div>
            <div><label className="text-[11px] text-slate-500 font-medium mb-1 block">密码</label><input type="password" value={cbPassword} onChange={(e) => setCbPassword(e.target.value)} className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700" /></div>
          </div>
          <div><label className="text-[11px] text-slate-500 font-medium mb-1 block">备份目录</label><input type="text" value={cbPath} onChange={(e) => setCbPath(e.target.value)} placeholder="/SullyBackup/" className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700" /></div>
          <button onClick={handleTestCloudConnection} disabled={cloudTesting || !cbUrl || !cbUsername || !cbPassword} className="w-full py-2.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 disabled:opacity-40">{cloudTesting ? '测试中...' : '测试连接'}</button>
          {cloudTestResult && (<p className={`text-[11px] text-center font-medium ${cloudTestResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{cloudTestResult}</p>)}
          <div className="grid grid-cols-2 gap-3 pt-2"><button onClick={() => setShowCloudModal(false)} className="py-2.5 bg-slate-100 rounded-xl text-xs font-bold text-slate-500">取消</button><button onClick={handleSaveCloudConfig} disabled={!cbUrl || !cbUsername || !cbPassword} className="py-2.5 bg-sky-500 rounded-xl text-xs font-bold text-white">保存配置</button></div>
          {cloudBackupConfig.enabled && (<button onClick={() => { updateCloudBackupConfig({ enabled: false }); setShowCloudModal(false); addToast('云端备份已关闭', 'info'); }} className="w-full py-2 text-[11px] text-red-400 font-medium">关闭云端备份</button>)}
        </div>
      </Modal>

      {/* GitHub Modal */}
      <Modal isOpen={showGithubModal} title="GitHub 备份" onClose={() => setShowGithubModal(false)}>
        <div className="space-y-4 p-1">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3"><p className="text-[11px] text-slate-700 leading-relaxed"><b>三步搞定，不用梯子：</b><br/>① 点击下方按钮创建 Token<br/>② 复制 token 粘贴到下面<br/>③ 点测试并连接</p></div>
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=Sully%20%E5%A4%87%E4%BB%BD" target="_blank" rel="noopener noreferrer" className="block w-full py-3 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-xl text-xs font-bold text-center">去 GitHub 创建 Token ↗</a>
          <div><label className="text-[11px] text-slate-500 font-medium mb-1 block">Personal Access Token</label><input type="password" value={ghToken} onChange={(e) => setGhToken(e.target.value)} placeholder="ghp_..." className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-700 font-mono" /></div>
          <button onClick={handleTestGithub} disabled={ghTesting || !ghToken.trim()} className="w-full py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl text-xs font-bold">{ghTesting ? '连接中...' : '测试并连接'}</button>
          {ghTestResult && (<p className={`text-[11px] text-center font-medium ${ghTestResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{ghTestResult}</p>)}
        </div>
      </Modal>

      <Modal isOpen={showCloudRestoreModal} title="从云端恢复" onClose={() => setShowCloudRestoreModal(false)}>
        <div className="space-y-2 p-1">
          {cloudBackupFiles.length === 0 ? (<div className="text-center py-8"><p className="text-[11px] text-slate-400">正在加载...</p></div>) : (
            <><p className="text-[10px] text-slate-400 mb-2">选择要恢复的备份文件:</p><div className="max-h-[50vh] overflow-y-auto space-y-2">{cloudBackupFiles.map((file, i) => (<button key={i} onClick={() => handleCloudRestore(file)} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-left"><p className="text-[11px] text-slate-700 font-medium truncate">{file.name}</p></button>))}</div></>
          )}
        </div>
      </Modal>

      <Modal isOpen={showModelModal} title="选择模型" onClose={() => setShowModelModal(false)}>
        <div className="space-y-3 p-1">
          <div className="flex gap-2">
            <input type="text" value={localModel} onChange={(e) => setLocalModel(e.target.value)} placeholder="手动输入模型名称..." className="flex-1 bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono" />
            <button onClick={() => setShowModelModal(false)} className="px-4 py-2.5 bg-primary text-white text-sm font-bold rounded-xl">确定</button>
          </div>
          {availableModels.length > 0 && (
            <div className="relative">
              <input type="text" value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder={`搜索 ${availableModels.length} 个模型...`} className="w-full bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2 text-xs" />
              {modelFilter && (<button onClick={() => setModelFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs px-2">×</button>)}
            </div>
          )}
          <div className="max-h-[40vh] overflow-y-auto space-y-2">
            {availableModels.length === 0 ? (<div className="text-center text-slate-400 py-8 text-xs">列表为空</div>) : (
              (modelFilter.trim() ? availableModels.filter(m => m.toLowerCase().includes(modelFilter.trim().toLowerCase())) : availableModels).map(m => (
                <button key={m} onClick={() => { setLocalModel(m); setShowModelModal(false); }} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-mono ${m === localModel ? 'bg-primary/10 text-primary font-bold' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                  <span className="break-all">{m}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal isOpen={showPresetModal} title="保存预设" onClose={() => setShowPresetModal(false)} footer={<button onClick={handleSavePreset} className="w-full py-3 bg-primary text-white font-bold rounded-2xl">保存</button>}>
        <div className="space-y-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase">预设名称</label>
          <input value={newPresetName} onChange={e => setNewPresetName(e.target.value)} className="w-full bg-slate-100 rounded-xl px-4 py-3 text-sm" autoFocus placeholder="Name..." />
        </div>
      </Modal>

      <Modal isOpen={showExportModal} title="备份下载" onClose={() => setShowExportModal(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => setShowExportModal(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">关闭</button></div>}>
        <div className="space-y-4 text-center py-4">
          <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-2"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg></div>
          <p className="text-sm font-bold text-slate-700">备份文件已生成！</p>
          {downloadUrl && <a href={downloadUrl} download="Sully_Backup.zip" className="text-primary text-sm underline block py-2">点击手动下载 .zip</a>}
        </div>
      </Modal>

      <Modal isOpen={showRealtimeModal} title="实时感知配置" onClose={() => setShowRealtimeModal(false)} footer={<button onClick={handleSaveRealtimeConfig} className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl shadow-lg">保存配置</button>}>
        <div className="space-y-5 max-h-[60vh] overflow-y-auto no-scrollbar">
          <div className="bg-emerald-50/50 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><Sun size={20} weight="fill" /><span className="text-sm font-bold text-emerald-700">天气感知</span></div>
              <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={rtWeatherEnabled} onChange={e => setRtWeatherEnabled(e.target.checked)} className="sr-only peer" /><div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div></label>
            </div>
            {rtWeatherEnabled && (
              <div className="space-y-2">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">API Key</label><input type="password" value={rtWeatherKey} onChange={e => setRtWeatherKey(e.target.value)} className="w-full bg-white/80 border border-emerald-200 rounded-xl px-3 py-2 text-sm font-mono" /></div>
                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">城市 (英文)</label><input type="text" value={rtWeatherCity} onChange={e => setRtWeatherCity(e.target.value)} className="w-full bg-white/80 border border-emerald-200 rounded-xl px-3 py-2 text-sm" /></div>
                <button onClick={testWeatherApi} className="w-full py-2 bg-emerald-100 text-emerald-600 text-xs font-bold rounded-xl">测试天气API</button>
              </div>
            )}
          </div>
          <div className="bg-orange-50/50 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><NotePencil size={20} weight="fill" /><span className="text-sm font-bold text-orange-700">Notion 日记</span></div>
              <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={rtNotionEnabled} onChange={e => setRtNotionEnabled(e.target.checked)} className="sr-only peer" /><div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div></label>
            </div>
            {rtNotionEnabled && (
              <div className="space-y-2">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Integration Token</label><input type="password" value={rtNotionKey} onChange={e => setRtNotionKey(e.target.value)} className="w-full bg-white/80 border border-orange-200 rounded-xl px-3 py-2 text-sm font-mono" /></div>
                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Database ID</label><input type="text" value={rtNotionDbId} onChange={e => setRtNotionDbId(e.target.value)} className="w-full bg-white/80 border border-orange-200 rounded-xl px-3 py-2 text-sm font-mono" /></div>
                <button onClick={testNotionApi} className="w-full py-2 bg-orange-100 text-orange-600 text-xs font-bold rounded-xl">测试连接</button>
              </div>
            )}
          </div>
          <div className="bg-yellow-50/60 p-4 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><ForkKnife size={20} weight="fill" className="text-yellow-600" /><span className="text-sm font-bold text-yellow-700">麦当劳 MCP</span></div>
              <label className="relative inline-flex items-center cursor-pointer"><input type="checkbox" checked={mcdEnabled} onChange={e => handleMcdEnabledChange(e.target.checked)} className="sr-only peer" /><div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-500"></div></label>
            </div>
            {mcdEnabled && (
              <div className="space-y-2">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">MCP Token</label><input type="password" value={mcdToken} onChange={e => handleMcdTokenChange(e.target.value)} className="w-full bg-white/80 border border-yellow-200 rounded-xl px-3 py-2 text-sm font-mono" /></div>
                <button onClick={testMcdApi} disabled={mcdTesting} className="w-full py-2 bg-yellow-100 text-yellow-700 text-xs font-bold rounded-xl">{mcdTesting ? '测试中…' : '测试连接'}</button>
                {mcdTestStatus && (<div className={`p-2 rounded-lg text-[11px] ${mcdTestStatus.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{mcdTestStatus}</div>)}
              </div>
            )}
          </div>
          {rtTestStatus && (<div className={`p-3 rounded-xl text-xs font-medium text-center ${rtTestStatus.includes('成功') ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{rtTestStatus}</div>)}
        </div>
      </Modal>

      <Modal isOpen={showResetConfirm} title="系统警告" onClose={() => setShowResetConfirm(false)} footer={<div className="flex gap-2 w-full"><button onClick={() => setShowResetConfirm(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">取消</button><button onClick={confirmReset} className="flex-1 py-3 bg-red-500 text-white font-bold rounded-2xl">确认格式化</button></div>}>
        <div className="flex flex-col items-center gap-3 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 text-red-500"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
          <p className="text-center text-sm text-slate-600 font-medium">这将<span className="text-red-500 font-bold">永久删除</span>所有角色、聊天记录和设置，且无法恢复！</p>
        </div>
      </Modal>
    </div>
  );
};

export default Settings;