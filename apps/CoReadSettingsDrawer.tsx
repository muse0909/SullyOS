// CoReadSettingsDrawer — 共读设置抽屉（书架页顶栏 ⚙ 弹出）
// 麦麦 2026-09-18 17:40 重做"我的预设"段:
//   暮色反馈 17:18:"API样式对了,但预设又没有了"
//   暮色想要的"预设"是指 ChatSettingsDrawer 角色独立 API 段那种"我的预设"胶囊组(主 API 已存的预设)
//   我之前误删,现在加上:
//     - 跟角色 API 完全一样:"📚 我的预设" 胶囊组(从 mainApi apiPresets 数组拉)
//     - 点胶囊直接把 baseUrl/apiKey/model 填进 cfg
//     - 用户当前选中的胶囊用 emerald-500 高亮
//
//   协议切换 / 顶部主 API 状态卡 / emerald-50 圆角卡 → 跟之前一样保留

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X as CloseIcon } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import Modal from '../components/os/Modal';
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

// 🛟 麦麦 2026-09-21：预设胶囊样式照搬主 API 设置（components/chat/ChatSettingsDrawer.tsx:18-81 PerCharPresetChip）
//   - 只显示名字，不显示协议名
//   - active 态 emerald-100，hover emerald-200 边框
//   - 长按 500ms 删除 + 右键菜单删除（跟主 API 一致）
//   - 因为预设可能很多（截图里 20+），按主 API 同款 11px 粗体紧凑胶囊
const PRESET_LONG_PRESS_MS = 500;
const HelperPresetChip: React.FC<{
  preset: { id: string; name: string };
  active: boolean;
  proto: string;
  activeUrl?: string;
  onLoad: () => void;
  onRequestDelete: () => void;
}> = ({ preset, active, proto, activeUrl, onLoad, onRequestDelete }) => {
  const timerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const clearPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPressing(false);
  }, []);

  const handlePointerDown = useCallback(() => {
    clearPress();
    longPressedRef.current = false;
    setPressing(true);
    timerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setPressing(false);
      onRequestDelete();
    }, PRESET_LONG_PRESS_MS);
  }, [clearPress, onRequestDelete]);

  const handleClick = useCallback(() => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onLoad();
  }, [onLoad]);

  useEffect(() => () => clearPress(), [clearPress]);

  return (
    <button
      type="button"
      title={`${proto} · ${activeUrl || ''} · 点击加载，长按删除`}
      onPointerDown={handlePointerDown}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => {
        e.preventDefault();
        onRequestDelete();
      }}
      onClick={handleClick}
      className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all cursor-pointer ${
        active
          ? 'bg-emerald-100 border-emerald-300 text-emerald-700'
          : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-200'
      } ${pressing ? 'scale-[0.98]' : ''}`}
    >
      {preset.name}
    </button>
  );
};

const CoReadSettingsDrawer: React.FC<Props> = ({ open, onClose, activeTab: externalTab, onTabChange }) => {
  const { apiPresets = [], addToast, removeApiPreset } = useOS();
  // 🛟 麦麦 2026-09-21：共读只显示主聊天预设 — 跟 Chat.tsx:237 / Like520Event.tsx:3537 同款过滤
  const mainPresets = apiPresets.filter((p: any) => !p.kind || p.kind === 'main');
  const [presetPendingDelete, setPresetPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [tab, setTab] = useState<'helper' | 'workbench'>(externalTab || 'helper');
  const [cfg, setCfg] = useState<CoReadHelperConfig>(() => loadHelperConfig());

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
  // 🛟 麦麦 2026-09-21：长按预设胶囊 → 弹确认 → 删全局预设（与 ChatSettingsDrawer 长按删除同模式）
  const handleConfirmDeletePreset = () => {
    if (!presetPendingDelete) return;
    removeApiPreset(presetPendingDelete.id);
    addToast(`已删除预设「${presetPendingDelete.name}」`, 'success');
    setPresetPendingDelete(null);
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

  // 选用预设 — 暮色 2026-09-21 反馈 4：按 protocol 分支读对应那组字段（修 Gemini 预设 URL/Key/Model 全是 OpenAI 那组的 bug）
  //   跟 apps/Chat.tsx:334-351 handleLoadPresetIntoPerChar 同款逻辑
  const handlePickPreset = (preset: typeof apiPresets[number]) => {
    const c: any = preset.config || {};
    const loadedProto = (c.protocol || 'openai') as 'openai' | 'gemini';
    if (loadedProto === 'gemini') {
      setCfg((cur) => ({
        ...cur,
        inheritFromMain: true,
        protocol: 'gemini',
        baseUrl: c.geminiBaseUrl || c.baseUrl || '',
        apiKey: c.geminiApiKey || c.apiKey || '',
        model: c.geminiModel || c.model || '',
      }));
    } else {
      setCfg((cur) => ({
        ...cur,
        inheritFromMain: true,
        protocol: 'openai',
        baseUrl: c.baseUrl || '',
        apiKey: c.apiKey || '',
        model: c.model || '',
      }));
    }
    addToast(`已选用「${preset.name}」`, 'success');
  };

  if (!open) return null;

  // 🛟 麦麦 2026-09-21：当前使用哪个 API — 根据 cfg 状态匹配预设，没匹配上显示「独立配置」
  const matchedPreset = mainPresets.find((p: any) => {
    const c = p.config || {};
    const pProto = c.protocol || 'openai';
    const pUrl = pProto === 'gemini' ? (c.geminiBaseUrl || c.baseUrl) : c.baseUrl;
    const pKey = pProto === 'gemini' ? (c.geminiApiKey || c.apiKey) : c.apiKey;
    const pModel = pProto === 'gemini' ? (c.geminiModel || c.model) : c.model;
    return cfg.protocol === pProto && cfg.baseUrl === pUrl && cfg.apiKey === pKey && cfg.model === pModel;
  });

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
            {/* === 帮工 API 同步开关：标明默认行为 === */}
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
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${cfg.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </section>

            {/* === 协议切换 + 我的预设 + 当前使用显示（emerald 圆角卡） === */}
            <section className="pt-2 border-t border-slate-100">
              <div className="text-[11px] font-bold text-slate-500 mb-2 mt-2">🔌 这个帮工的 API</div>
              <p className="text-[10px] text-slate-400 mb-3 leading-relaxed">
                留空就用全局 API 设置。设了的话,帮工独立走自己的通道（不影响 Chat 用量）。
              </p>

              <div className="bg-emerald-50/80 rounded-3xl p-4 shadow-sm border border-emerald-100/80 space-y-4">
                {/* 🛟 麦麦 2026-09-21：当前使用哪个 API — 根据 cfg 状态匹配预设，没匹配上显示「独立配置」 */}
                <div className="text-[10px] text-slate-500 px-1 leading-relaxed">
                  当前使用：<span className="font-bold text-emerald-700">{matchedPreset?.name || '独立配置'}</span> · {cfg.protocol}
                </div>

                {/* 协议切换胶囊 — 修暮色反馈的 Gemini 点着没反应 */}
                <div className="bg-slate-50/60 rounded-2xl p-1 flex gap-1 border border-slate-200/50">
                  {(['openai', 'gemini'] as const).map((p) => {
                    const labelMap = { openai: 'OpenAI', gemini: 'Gemini' } as const;
                    const colorMap = { openai: '#10b981', gemini: '#0ea5e9' } as const;
                    const active = cfg.protocol === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCfg((c) => ({ ...c, protocol: p }))}
                        className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${active ? 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-500 active:bg-white/40'}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${active ? '' : 'bg-slate-300'}`}
                          style={active ? { background: colorMap[p] } : {}}
                        />
                        {labelMap[p]}
                      </button>
                    );
                  })}
                </div>

                {/* 📚 我的预设（暮色 21:22 反馈：只显示主聊天预设 + 胶囊样式照搬主 API 设置） */}
                {mainPresets.length > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 block pl-1">📚 我的预设</label>
                    <div className="flex gap-2 flex-wrap">
                      {mainPresets.map((preset) => {
                        // 麦麦 2026-09-21：active 判断按 protocol 选对应那组字段（修 Gemini 预设漏判 bug — 跟 ChatSettingsDrawer.tsx:381-391 同款）
                        const c: any = preset.config || {};
                        const proto = (c.protocol || 'openai') as 'openai' | 'gemini';
                        const presetUrl = proto === 'gemini' ? (c.geminiBaseUrl || c.baseUrl) : c.baseUrl;
                        const presetKey = proto === 'gemini' ? (c.geminiApiKey || c.apiKey) : c.apiKey;
                        const presetModel = proto === 'gemini' ? (c.geminiModel || c.model) : c.model;
                        const active =
                          cfg.protocol === proto &&
                          cfg.baseUrl === presetUrl &&
                          cfg.apiKey === presetKey &&
                          cfg.model === presetModel;
                        return (
                          <HelperPresetChip
                            key={preset.id}
                            preset={preset}
                            active={active}
                            proto={proto}
                            activeUrl={presetUrl}
                            onLoad={() => handlePickPreset(preset)}
                            onRequestDelete={() => setPresetPendingDelete({ id: preset.id, name: preset.name })}
                          />
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 px-1 mt-1.5 leading-relaxed">
                      点胶囊直接复制这套预设的 baseUrl + 接口密钥 + 模型。长按胶囊可删除。帮工独立用 key,不消耗 Chat 通道。
                    </p>
                  </div>
                )}

                {/* 🛟 麦麦 2026-09-21：URL/Key/Model/超时 输入框全删 — 共读帮工配置改用预设 + 协议切换管理，
                    字段值仍由 cfg 保留（点预设时填进去，调 helper 用到），只是不再让用户手敲。 */}
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

      {/* 🛟 麦麦 2026-09-21：长按预设胶囊 → 删除确认（跟 ChatSettingsDrawer 同款 Modal） */}
      <Modal
        isOpen={!!presetPendingDelete}
        title="删除预设"
        onClose={() => setPresetPendingDelete(null)}
        zIndex={220}
        footer={
          <div className="w-full grid grid-cols-2 gap-3">
            <button
              onClick={() => setPresetPendingDelete(null)}
              className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-full active:scale-95 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleConfirmDeletePreset}
              className="w-full py-3 bg-red-500 text-white font-bold rounded-full active:scale-95 transition-all"
            >
              删除
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-700 leading-relaxed">
          确认删除预设 <span className="font-bold text-slate-900">「{presetPendingDelete?.name}」</span> 吗？
        </p>
        <p className="text-xs text-slate-500 leading-relaxed mt-2">
          这个预设会从全局预设列表里移除,删除后无法恢复。
        </p>
      </Modal>
    </div>
  );
};

export default CoReadSettingsDrawer;
