// CoReadSettingsDrawer — 共读设置抽屉（书架页 ⚙ 弹出）
// 麦麦 2026-09-18 重写:帮工 API Tab 改用 ChatSettingsDrawer 角色独立 API 同款样式
//   Tab 1 帮工 API — emerald-50 圆角卡 + 预设胶囊（直接显示主 API 现有预设）+ 协议切换 + URL/Key/Model 输入
//                    顶部加一个"当前主 API"状态卡(暮色 9-18 反馈原来不显示主 API 预设)
//   Tab 2 工作台账本 — 步骤 5:总调用/总 tokens/估算花费 + 失败重试

import React, { useEffect, useState } from 'react';
import { X as CloseIcon, Eye as EyeIcon, EyeSlash as EyeSlashIcon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import {
  loadHelperConfig,
  saveHelperConfig,
  resetHelperConfig,
  DEFAULT_HELPER_CONFIG,
  type CoReadHelperConfig,
} from '../utils/coReadHelperConfig';
import { DB } from '../utils/db';
import {
  getCoReadHelperStats,
  type CoReadHelperStats,
} from '../utils/coReadHelperLogger';

interface Props {
  open: boolean;
  onClose: () => void;
  activeTab?: 'helper' | 'workbench';
  onTabChange?: (tab: 'helper' | 'workbench') => void;
}

const STORAGE_KEY = 'co_read_helper_config_v1';

const CoReadSettingsDrawer: React.FC<Props> = ({ open, onClose, activeTab: externalTab, onTabChange }) => {
  const { apiConfig, apiPresets = [], addToast } = useOS();
  const [tab, setTab] = useState<'helper' | 'workbench'>(externalTab || 'helper');
  const [cfg, setCfg] = useState<CoReadHelperConfig>(() => loadHelperConfig());
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (externalTab) setTab(externalTab);
  }, [externalTab]);

  // 工作台账本
  const [stats, setStats] = useState<CoReadHelperStats | null>(null);
  const reloadStats = async () => {
    try {
      const s = await getCoReadHelperStats();
      setStats(s);
    } catch (e) {
      console.warn('[coread] load stats failed:', e);
    }
  };
  useEffect(() => {
    if (open && tab === 'workbench') reloadStats();
  }, [open, tab]);

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
  const handleClearLogs = async () => {
    if (!window.confirm('清空所有帮工日志？此操作不可撤销。')) return;
    try {
      await DB.clearCoReadHelperLogs();
      addToast('已清空帮工日志', 'info');
      await reloadStats();
    } catch (e: any) {
      addToast(`清空失败:${e?.message || e}`, 'error');
    }
  };

  // 选用预设 — 把 preset 的 baseUrl/apiKey/model 复制进 cfg
  const handlePickPreset = (preset: typeof apiPresets[number]) => {
    const c: any = preset.config || {};
    setCfg((cur) => ({
      ...cur,
      inheritFromMain: true,
      baseUrl: c.baseUrl || cur.baseUrl,
      apiKey: c.apiKey || cur.apiKey,
      model: c.model || cur.model,
      protocol: c.protocol || 'openai',
    }));
    addToast(`已选用预设「${preset.name}」`, 'success');
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="absolute right-0 top-0 bottom-0 w-[340px] max-w-[90%] overflow-y-auto bg-white shadow-xl"
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
          {(['helper', 'workbench'] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setTab(k); onTabChange?.(k); }}
              className={`flex-1 py-2.5 text-sm ${tab === k ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-slate-500'}`}
            >
              {k === 'helper' ? '帮工 API' : '工作台账本'}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        {tab === 'helper' && (
          <div className="p-4 space-y-4">
            {/* === 当前主 API 状态卡（暮色 9-18:现在直接显示主 API 预设） === */}
            <section className="bg-sky-50/80 rounded-2xl p-3 border border-sky-100/80">
              <div className="text-[10px] font-bold text-sky-600 uppercase tracking-widest mb-1.5 pl-1">📡 当前主 API（Chat 用）</div>
              {apiConfig?.baseUrl ? (
                <div className="text-[11px] text-slate-700 space-y-0.5">
                  <div>基础地址:<span className="font-mono">{(apiConfig as any).baseUrl.replace(/^(https?:\/\/[^\/]+).*/, '$1')}</span></div>
                  <div>接口密钥:<span className="font-mono">{(apiConfig as any).apiKey ? `${(apiConfig as any).apiKey.slice(0, 6)}…${(apiConfig as any).apiKey.slice(-4)}` : '未配置'}</span></div>
                  <div>模型:<span className="font-mono">{(apiConfig as any).model || '未配置'}</span></div>
                  <div>协议:<span className="font-mono">{(apiConfig as any).protocol || 'openai'}</span></div>
                </div>
              ) : (
                <div className="text-[11px] text-rose-500">主 API 还没配置,先去 Chat 设置页填</div>
              )}
            </section>

            {/* === 总开关 === */}
            <section className="bg-emerald-50/80 rounded-3xl p-4 shadow-sm border border-emerald-100/80 space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-3">
                  <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest">启用帮工兜底</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                    本地正则全部识别失败时,调帮工识别章节标题(只发"疑似标题行+行号",不发全文)
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
            </section>

            {/* === 协议切换（参考 ChatSettingsDrawer 角色独立 API 段） === */}
            <section className="pt-2 border-t border-slate-100">
              <div className="text-[11px] font-bold text-slate-500 mb-2 mt-2">🔌 协议</div>
              <div className="bg-slate-50/60 rounded-2xl p-1 flex gap-1 border border-slate-200/50">
                {(['openai', 'gemini'] as const).map((p) => {
                  const labelMap = { openai: 'OpenAI 兼容', gemini: 'Gemini' } as const;
                  const colorMap = { openai: '#10b981', gemini: '#0ea5e9' } as const;
                  const active = cfg.protocol === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCfg((c) => ({ ...c, protocol: p }))}
                      className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${active ? 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-500 active:bg-white/40'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${active ? '' : 'bg-slate-300'}`}
                        style={active ? { background: colorMap[p] } : {}}
                      ></span>
                      {labelMap[p]}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* === 我的预设 胶囊（暮色要的"主 API 预设直接选"） === */}
            <section className="pt-2 border-t border-slate-100">
              <div className="text-[11px] font-bold text-slate-500 mb-2 mt-2">📚 我的预设</div>
              {apiPresets.length === 0 ? (
                <p className="text-[10px] text-slate-400 px-1 leading-relaxed">主 API 还没保存预设。去 Chat 设置页加几个,这里就能直接选。</p>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {apiPresets.map((preset) => {
                    const c: any = preset.config || {};
                    const host = (c.baseUrl || '').replace(/^(https?:\/\/[^\/]+).*/, '$1');
                    const active =
                      cfg.inheritFromMain &&
                      cfg.baseUrl === c.baseUrl &&
                      cfg.apiKey === c.apiKey &&
                      cfg.model === c.model &&
                      cfg.protocol === (c.protocol || 'openai');
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePickPreset(preset)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] transition-all ${active ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 active:scale-95'}`}
                      >
                        <span>{preset.name}</span>
                        <span className={`text-[9px] ${active ? 'text-white/80' : 'text-slate-400'}`}>{host}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {apiPresets.length > 0 && (
                <p className="text-[10px] text-slate-400 px-1 mt-2 leading-relaxed">
                  点胶囊就复制这套预设的 baseUrl + 接口密钥 + 模型。帮工独立用 key,不消耗 Chat 通道。
                </p>
              )}
            </section>

            {/* === URL / Key / Model 输入 === */}
            <section className="pt-2 border-t border-slate-100 space-y-3 mt-3">
              <div>
                <div className="flex justify-between items-end mb-1 pl-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">URL</label>
                  <button
                    onClick={() => setCfg((c) => ({ ...c, baseUrl: (apiConfig as any).baseUrl || '', inheritFromMain: true }))}
                    className="text-[10px] text-emerald-600 hover:text-emerald-700"
                  >
                    同步主 API
                  </button>
                </div>
                <input
                  type="text"
                  value={cfg.baseUrl}
                  onChange={(e) => setCfg((c) => ({ ...c, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">Key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={cfg.apiKey}
                    onChange={(e) => setCfg((c) => ({ ...c, apiKey: e.target.value }))}
                    placeholder="sk-…"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-16 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                  />
                  <button onClick={() => setShowKey((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 font-bold px-2 py-0.5">
                    {showKey ? '隐藏' : '显示'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">模型</label>
                <input
                  type="text"
                  value={cfg.model}
                  onChange={(e) => setCfg((c) => ({ ...c, model: e.target.value }))}
                  placeholder="deepseek-chat"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                />
                <div className="text-[10px] text-slate-400 mt-1">推荐 deepseek-chat / DeepSeek-V3 / MiniMax-Text-01 等,中文拆章准确</div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block pl-1">超时 (毫秒)</label>
                <input
                  type="number"
                  min={5000}
                  max={120000}
                  value={cfg.timeoutMs}
                  onChange={(e) => setCfg((c) => ({ ...c, timeoutMs: parseInt(e.target.value, 10) || 30000 }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:bg-white focus:border-emerald-300 outline-none transition-all"
                />
              </div>
            </section>

            {/* === 操作按钮 === */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 text-sm font-bold rounded-2xl bg-emerald-500 text-white shadow-sm active:scale-95 transition-transform"
              >
                保存配置
              </button>
              <button
                onClick={handleReset}
                className="px-4 py-2.5 text-sm text-slate-500 rounded-2xl border border-slate-200 hover:bg-slate-50"
              >
                重置
              </button>
            </div>

            <div className="text-[10px] text-slate-400 leading-relaxed pt-2 border-t border-slate-100">
              注意:帮工调用会消耗 key 对应账户的额度。建议用单独的帮工 key,不要跟 Chat 用同一个。工作台账本会记录每次调用的 tokens 用量。
            </div>
          </div>
        )}

        {tab === 'workbench' && (
          <div className="p-4 space-y-4">
            {!stats ? (
              <div className="text-center text-sm text-slate-400 py-8">载入中...</div>
            ) : stats.totalCalls === 0 ? (
              <div className="text-center text-sm text-slate-400 py-8">
                <div>还没有帮工调用记录</div>
                <div className="text-[11px] mt-1">遇到本地拆不出章节的怪格式 txt 时,会自动调帮工</div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-lg font-semibold text-slate-800">{stats.totalCalls}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">总调用</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">成功 {stats.successCalls} / 失败 {stats.failureCalls}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-lg font-semibold text-slate-800">{stats.totalTokens.toLocaleString()}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">总 tokens</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">输入 {stats.totalPromptTokens.toLocaleString()} / 输出 {stats.totalCompletionTokens.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-lg font-semibold text-slate-800">${stats.totalCostUsd.toFixed(4)}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">估算花费</div>
                    <div className="text-[9px] text-slate-400 mt-0.5">按模型计费算</div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">按书分组的拆章记录</div>
                  {stats.byBook.length === 0 ? (
                    <div className="text-[11px] text-slate-400 text-center py-3">还没记录</div>
                  ) : (
                    <div className="space-y-1.5">
                      {stats.byBook.map((b) => (
                        <div
                          key={b.bookTitle}
                          className={`rounded-lg border p-2.5 ${b.failureCalls > 0 ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-medium text-slate-800 truncate">{b.bookTitle}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                {b.calls} 次调用 · 成功 {b.successCalls} / 失败 {b.failureCalls}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-[11px] text-slate-600">{b.totalTokens.toLocaleString()} tokens</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">${b.totalCostUsd.toFixed(4)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-between pt-2 border-t border-slate-100">
                  <button onClick={reloadStats} className="px-3 py-1.5 text-[11px] text-slate-500 rounded-lg border border-slate-200 hover:bg-slate-50">刷新</button>
                  <button onClick={handleClearLogs} className="px-3 py-1.5 text-[11px] text-rose-500 rounded-lg border border-rose-200 hover:bg-rose-50">清空账本</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CoReadSettingsDrawer;
