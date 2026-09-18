// CoReadSettingsDrawer — 共读设置抽屉（书架页右下角 ⚙ 弹出）
// 麦麦 2026-09-18 第 4/5 步
//   Tab 1 阅读设置 — 步骤 3 阅读器已内置,这里镜像显示(同步 localStorage)
//   Tab 2 帮工 API — 步骤 4:独立配置,默认复用 Chat API (暮色原话「可以获取主 API 预设」)
//   Tab 3 工作台账本 — 步骤 5:总调用/总 tokens/估算花费 + 每本书拆章记录 + 失败重试

import React, { useEffect, useState } from 'react';
import { X as CloseIcon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  loadHelperConfig,
  saveHelperConfig,
  resetHelperConfig,
  DEFAULT_HELPER_CONFIG,
  type CoReadHelperConfig,
} from '../utils/coReadHelperConfig';

interface Props {
  open: boolean;
  onClose: () => void;
  activeTab?: 'reading' | 'helper' | 'workbench';
  onTabChange?: (tab: 'reading' | 'helper' | 'workbench') => void;
}

const CoReadSettingsDrawer: React.FC<Props> = ({ open, onClose, activeTab: externalTab, onTabChange }) => {
  const { apiConfig, addToast } = useOS();
  const [tab, setTab] = useState<'reading' | 'helper' | 'workbench'>(externalTab || 'helper');
  const [cfg, setCfg] = useState<CoReadHelperConfig>(() => loadHelperConfig());

  useEffect(() => {
    if (externalTab) setTab(externalTab);
  }, [externalTab]);

  // 复用主 API
  const inheritFromMain = (cfg.inheritFromMain && apiConfig?.baseUrl && apiConfig?.apiKey);
  const handleInherit = () => {
    if (!apiConfig?.baseUrl || !apiConfig?.apiKey) {
      addToast('主 API 还没配,先去设置里填', 'error');
      return;
    }
    setCfg((c) => ({
      ...c,
      inheritFromMain: true,
      // 即使以后切回"独立",也先把当前的填上以备查看
      baseUrl: c.baseUrl || apiConfig.baseUrl,
      apiKey: c.apiKey || apiConfig.apiKey,
    }));
    addToast('已切换为复用主 API', 'success');
  };

  const handleSave = () => {
    saveHelperConfig(cfg);
    addToast('帮工 API 配置已保存', 'success');
  };

  const handleReset = () => {
    if (!window.confirm('重置帮工 API 配置到默认?')) return;
    const d = resetHelperConfig();
    setCfg(d);
    addToast('已重置', 'info');
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute right-0 top-0 bottom-0 w-[320px] max-w-[88%] overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between px-4 py-3 sticky top-0 bg-white/95 backdrop-blur z-10 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-800">共读设置</span>
          <button onClick={onClose} aria-label="关闭设置">
            <CloseIcon size={16} className="text-slate-500" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-100">
          {(['helper'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setTab(k); onTabChange?.(k); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-slate-500'}`}
            >
              帮工 API
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        {tab === 'helper' && (
          <div className="p-4 space-y-5">
            {/* 总开关 */}
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-3">
                <div className="text-sm font-medium text-slate-800">启用帮工兜底</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  本地正则全部识别失败时,调帮工识别章节标题(只发"疑似标题行 + 行号",不发全文)
                </div>
              </div>
              <button
                onClick={() => setCfg((c) => ({ ...c, enabled: !c.enabled }))}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors ${cfg.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${cfg.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>

            {/* 复用主 API */}
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-3">
                <div className="text-sm font-medium text-slate-800">复用主 API</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  复用 Chat API 的基础地址 + 接口密钥(模型字段独立)
                </div>
              </div>
              <button
                onClick={() => setCfg((c) => ({ ...c, inheritFromMain: !c.inheritFromMain }))}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors ${cfg.inheritFromMain ? 'bg-emerald-500' : 'bg-slate-300'}`}
              >
                <div
                  className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${cfg.inheritFromMain ? 'translate-x-5' : 'translate-x-0.5'}`}
                />
              </button>
            </div>

            {inheritFromMain ? (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-600 space-y-0.5">
                <div>基础地址:<span className="font-mono">{apiConfig?.baseUrl?.replace(/^(https?:\/\/[^\/]+).*/, '$1') || '未配置'}</span></div>
                <div>接口密钥:<span className="font-mono">{apiConfig?.apiKey ? `${apiConfig.apiKey.slice(0, 6)}…${apiConfig.apiKey.slice(-4)}` : '未配置'}</span></div>
                <div className="text-slate-400 mt-1">点上面"复用主 API"开关关闭后,可独立修改</div>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider">基础地址</label>
                  <input
                    value={cfg.baseUrl}
                    onChange={(e) => setCfg((c) => ({ ...c, baseUrl: e.target.value }))}
                    placeholder="https://api.deepseek.com/v1"
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 uppercase tracking-wider">接口密钥</label>
                  <input
                    value={cfg.apiKey}
                    onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))}
                    placeholder="sk-..."
                    type="password"
                    className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              </>
            )}

            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider">模型</label>
              <input
                value={cfg.model}
                onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
                placeholder="deepseek-chat"
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
              <div className="text-[10px] text-slate-400 mt-1">推荐 deepseek-chat / DeepSeek-V3 / MiniMax-Text-01 等,中文拆章准确</div>
            </div>

            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider">协议</label>
              <select
                value={cfg.protocol}
                onChange={(e) => setCfg((c) => ({ ...c, protocol: e.target.value as 'openai' | 'gemini' }))}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="openai">OpenAI 兼容 (DeepSeek / MiniMax / OpenAI 等)</option>
                <option value="gemini">Gemini (暂未支持)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] text-slate-500 uppercase tracking-wider">超时 (毫秒)</label>
              <input
                value={cfg.timeoutMs}
                type="number"
                min={5000}
                max={120000}
                onChange={(e) => setCfg((c) => ({ ...c, timeoutMs: parseInt(e.target.value, 10) || 30000 }))}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="flex-1 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white active:scale-95 transition-transform"
              >
                保存
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2 text-sm text-slate-500 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                重置
              </button>
            </div>

            <div className="text-[10px] text-slate-400 leading-relaxed pt-2 border-t border-slate-100">
              注意:帮工调用会消耗 接口密钥对应账户 的额度。建议用单独的帮工 key,不要跟 Chat 用同一个。工作台账本会记录每次调用的 tokens 用量。
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CoReadSettingsDrawer;
